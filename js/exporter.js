/* CodeMotion — video encoder.

   Two paths, same input:

   1. WebCodecs (preferred). Frames go in as VideoFrames carrying explicit
      timestamps and come back as encoded chunks; js/mp4.js muxes them into a
      progressive MP4. Because the timing comes from the timestamps, the clip is
      exactly `duration` seconds no matter how long this machine took to draw
      it — a slow laptop produces a slower *render*, never a longer *video*.

   2. MediaRecorder + canvas.captureStream(0) (fallback, no WebCodecs).
      MediaRecorder stamps frames with wall-clock time, so this path must be
      paced in real time: frame N is released once N/fps of wall time has
      elapsed. Pushing 300 frames instantly would yield a 0.2s clip instead of
      a 10s one. The progress readout is truthful in both paths.            */
(function (CM) {
  'use strict';

  var MIME_CANDIDATES = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'MP4 (H.264)' },
    { mime: 'video/mp4;codecs=h264', ext: 'mp4', label: 'MP4 (H.264)' },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'WebM (VP9)' },
    { mime: 'video/webm;codecs=vp8', ext: 'webm', label: 'WebM (VP8)' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM' }
  ];

  function hasRecorder() {
    return typeof window.MediaRecorder === 'function';
  }

  function pickCodec() {
    if (!hasRecorder()) return null;
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      var c = MIME_CANDIDATES[i];
      var ok = false;
      try { ok = MediaRecorder.isTypeSupported(c.mime); } catch (e) { ok = false; }
      if (ok) return c;
    }
    return null;
  }

  function probe() {
    var canvasOK = typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.captureStream === 'function';
    var codec = pickCodec();
    var modern = typeof VideoEncoder !== 'undefined';
    return {
      ok: (modern || (canvasOK && !!codec)),
      canvas: canvasOK,
      modern: modern,
      codec: codec,
      reason: !modern && !canvasOK
        ? 'This browser cannot capture a canvas stream.'
        : (!modern && !codec ? 'This browser has no supported video encoder (MediaRecorder).' : '')
    };
  }

  function bitrateFor(width, height, fps, quality) {
    var mult = quality === 'high' ? 1.7 : quality === 'draft' ? 0.55 : 1;
    var bps = width * height * fps * 0.115 * mult;
    return Math.round(Math.min(26000000, Math.max(1400000, bps)));
  }

  function sleepUntil(targetMs) {
    return new Promise(function (resolve) {
      function tick() {
        if (performance.now() >= targetMs) resolve();
        else requestAnimationFrame(tick);
      }
      tick();
    });
  }

  function filenameFor(cfg, ext) {
    var d = String(cfg.duration).replace(/\.\d+$/, '');
    return 'codemotion-' + d + 's-' + cfg.width + 'x' + cfg.height + '.' + ext;
  }

  /**
   * Render cfg.code into a real video file.
   * opts: { onProgress(0..1, phase), signal, quality }
   * Resolves with { blob, mime, ext, filename, width, height, fps, duration, frames, ms }
   */
  function render(cfg, opts) {
    opts = opts || {};
    var p = probe();
    if (!p.ok) return Promise.reject(new Error(p.reason));

    var width = cfg.width, height = cfg.height, fps = cfg.fps || 30;
    var duration = cfg.duration;
    var totalFrames = Math.max(1, Math.round(duration * fps));
    var work = CM.Animator.prepare(Object.assign({}, cfg));
    var bitrate = bitrateFor(width, height, fps, opts.quality);

    var canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d', { alpha: false });

    /* ── preferred path: WebCodecs + fragmented MP4 ──────────────────────
       Frames carry their own timestamps, so the clip is exactly `duration`
       seconds long no matter how long this machine takes to draw them. */
    var choose = p.modern && CM.Mp4
      ? CM.Mp4.pickCodec(width, height, fps, bitrate)
      : Promise.resolve(null);

    return choose.then(function (codec) {
      if (!codec) return renderWithRecorder(ctx, canvas, cfg, work, opts, width, height, fps, duration, totalFrames, p);
      return renderWithWebCodecs(ctx, canvas, codec, cfg, work, opts, width, height, fps, duration, totalFrames, bitrate);
    });
  }


  function renderWithWebCodecs(ctx, canvas, codec, cfg, work, opts, width, height, fps, duration, totalFrames, bitrate) {
    var t0 = performance.now();

    var muxer = null;
    var encoderError = null;
    var pending = [];

    var encoder = new VideoEncoder({
      output: function (chunk, meta) {
        if (!muxer && meta && meta.decoderConfig && meta.decoderConfig.description) {
          muxer = new CM.Mp4.Muxer({
            width: width, height: height, fps: fps,
            description: new Uint8Array(meta.decoderConfig.description)
          });
        }
        if (muxer) muxer.addChunk(chunk);
      },
      error: function (e) { encoderError = e; }
    });

    encoder.configure({
      codec: codec,
      width: width,
      height: height,
      bitrate: bitrate,
      framerate: fps,
      avc: { format: 'avc' },
      latencyMode: 'quality'
    });

    var gopSize = Math.max(1, Math.round(fps * 2));

    function yieldFrame() {
      /* let the encoder drain so we never queue unbounded work */
      while (encoder.encodeQueueSize > 12 && !encoderError) {
        return new Promise(function (r) { setTimeout(r, 4); }).then(yieldFrame);
      }
      return Promise.resolve();
    }

    function frame(i) {
      if (opts.signal && opts.signal.cancelled) {
        try { encoder.close(); } catch (e) {}
        var ce = new Error('Render cancelled'); ce.cancelled = true;
        return Promise.reject(ce);
      }
      if (encoderError) return Promise.reject(encoderError);

      if (i >= totalFrames) {
        return encoder.flush().then(function () {
          try { encoder.close(); } catch (e) {}
          if (!muxer || !muxer.sampleCount()) {
            return Promise.reject(new Error('Encoder produced no frames.'));
          }
          var blob = muxer.toBlob('video/mp4');
          if (!blob.size) return Promise.reject(new Error('Encoder produced an empty file.'));
          return {
            blob: blob, mime: 'video/mp4', ext: 'mp4',
            codecLabel: 'MP4 (H.264, WebCodecs)',
            filename: filenameFor(cfg, 'mp4'),
            width: width, height: height, fps: fps, duration: duration,
            frames: muxer.sampleCount(), ms: Math.round(performance.now() - t0),
            bytes: blob.size, engine: 'webcodecs'
          };
        });
      }

      CM.Animator.draw(ctx, width, height, i / fps, work, {});

      var frameObj = new VideoFrame(canvas, {
        timestamp: Math.round((i * 1e6) / fps),
        duration: Math.round(1e6 / fps)
      });
      encoder.encode(frameObj, { keyFrame: i % gopSize === 0 });
      frameObj.close();

      if (opts.onProgress) opts.onProgress((i + 1) / totalFrames, 'render');

      return yieldFrame().then(function () { return frame(i + 1); });
    }

    return frame(0);
  }

  /* ── fallback: MediaRecorder, paced to wall clock ───────────────────── */
  function renderWithRecorder(ctx, canvas, cfg, work, opts, width, height, fps, duration, totalFrames, p) {
    var stream = canvas.captureStream(0);
    var track = stream.getVideoTracks()[0];
    var manual = !!(track && typeof track.requestFrame === 'function');

    var chunks = [];
    var rec;
    try {
      rec = new MediaRecorder(stream, {
        mimeType: p.codec.mime,
        videoBitsPerSecond: bitrateFor(width, height, fps, opts.quality)
      });
    } catch (e) {
      return Promise.reject(new Error('Encoder refused this format: ' + e.message));
    }

    var done = new Promise(function (resolve, reject) {
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onerror = function (ev) { reject(new Error('Encoding failed: ' + ((ev.error && ev.error.name) || 'unknown'))); };
      rec.onstop = function () { resolve(); };
    });

    rec.start(250);

    var t0 = performance.now();
    var i = 0;

    function frame() {
      return new Promise(function (resolve, reject) {
        if (opts.signal && opts.signal.cancelled) {
          try { rec.stop(); } catch (e) {}
          var ce = new Error('Render cancelled'); ce.cancelled = true;
          reject(ce);
          return;
        }

        if (i >= totalFrames) {
          try { rec.stop(); } catch (e) {}
          done.then(function () {
            stream.getTracks().forEach(function (t) { t.stop(); });
            var blob = new Blob(chunks, { type: p.codec.mime.split(';')[0] });
            if (!blob.size) throw new Error('Encoder produced an empty file.');
            resolve({
              blob: blob, mime: p.codec.mime, ext: p.codec.ext, codecLabel: p.codec.label,
              filename: filenameFor(cfg, p.codec.ext),
              width: width, height: height, fps: fps, duration: duration,
              frames: totalFrames, ms: Math.round(performance.now() - t0),
              bytes: blob.size, engine: 'mediarecorder'
            });
          }, reject);
          return;
        }

        var target = t0 + (i * 1000) / fps;
        var wait = target - performance.now();

        var paint = function () {
          CM.Animator.draw(ctx, width, height, i / fps, work, {});
          if (manual) track.requestFrame();
          i++;
          if (opts.onProgress) opts.onProgress(i / totalFrames, 'render');
          frame().then(resolve, reject);
        };

        if (wait > 6) sleepUntil(target).then(paint);
        else setTimeout(paint, Math.max(0, wait));
      });
    }

    return frame();
  }

  /* Non-realtime "fast preview render": paints a handful of key frames to a
     single canvas. Used for the thumbnail in the render history list. */
  function thumbnail(cfg, W, H, atT) {
    var c = document.createElement('canvas');
    c.width = W || 480;
    c.height = H || Math.round((W || 480) * (cfg.height / cfg.width));
    var g = c.getContext('2d');
    CM.Animator.draw(g, c.width, c.height, atT != null ? atT : cfg.duration * 0.62,
      CM.Animator.prepare(Object.assign({}, cfg)), {});
    return c.toDataURL('image/jpeg', 0.72);
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 4000);
  }

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  CM.Exporter = {
    render: render,
    thumbnail: thumbnail,
    download: download,
    probe: probe,
    pickCodec: pickCodec,
    filenameFor: filenameFor,
    humanSize: humanSize,
    hasRecorder: hasRecorder
  };
})(window.CM = window.CM || {});