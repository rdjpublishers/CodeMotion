/* CodeMotion — UI wiring.

   Phase machine (drives every button label and the download flow):

     idle ──Generate──▶ rendering ──▶ ready ──settings change──▶ stale
       ▲                     │            │                       │
       └────cancel───────────┘            └────Generate new───────┘
                                                     ▼
                                                  ready

   The video blob produced in `ready` is what Download Video hands back. It is
   never re-encoded. */
(function (CM) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var STORAGE_KEY = 'codemotion.project.v1';

  var cfg = {
    code: '',
    language: 'python',
    theme: 'dracula',
    panelWidth: 0.86, fontScale: 1, radius: 0.9,
    showChrome: true, showLineNumbers: true, showProgress: true, watermark: false,
    background: 'glow',
    width: 1920, height: 1080, duration: 10, fps: 30, quality: 'standard',
    camera: 'follow', zoom: 0.3, follow: 0.9, drift: 1
  };

  var state = {
    phase: 'idle',
    video: null,          /* { blob, filename, ... } — the downloadable file */
    renderedKey: null,
    history: [],
    renderToken: null,
    error: null
  };

  var preview = {
    canvas: null, ctx: null,
    t: 0, playing: false, last: 0, raf: 0,
    orbit: { yaw: 0, pitch: 0, roll: 0, zoom: 1 },
    dragging: false, lastX: 0, lastY: 0, idleAt: 0
  };

  /* ══════════════ config plumbing ══════════════ */

  var VIDEO_FIELDS = ['code', 'language', 'theme', 'panelWidth', 'fontScale', 'radius',
    'showChrome', 'showLineNumbers', 'showProgress', 'watermark', 'background',
    'width', 'height', 'duration', 'fps', 'camera', 'zoom', 'follow', 'drift'];

  function videoKey(c) {
    return JSON.stringify(VIDEO_FIELDS.map(function (k) { return c[k]; }));
  }

  var saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) {}
    }, 400);
  }

  function restore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object') return false;
      Object.keys(saved).forEach(function (k) {
        if (k in cfg && typeof saved[k] === typeof cfg[k]) cfg[k] = saved[k];
      });
      if (!saved.code || !saved.code.trim()) return false;
      return true;
    } catch (e) { return false; }
  }

  /* ══════════════ preview ══════════════ */

  function fitPreview() {
    var frame = $('stageFrame');
    var avail = frame.clientWidth || 800;
    var aspect = cfg.width / cfg.height;
    var w = avail, h = avail / aspect;
    var cap = Math.max(360, Math.min(620, window.innerHeight * 0.62));
    if (h > cap) { h = cap; w = cap * aspect; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    preview.canvas.style.width = Math.round(w) + 'px';
    preview.canvas.style.height = Math.round(h) + 'px';
    preview.canvas.width = Math.max(2, Math.round(w * dpr));
    preview.canvas.height = Math.max(2, Math.round(h * dpr));
    paintOnce();
  }

  function paintOnce() {
    if (!preview.ctx) return;
    CM.Animator.draw(preview.ctx, preview.canvas.width, preview.canvas.height,
      preview.t, cfg, { orbit: preview.orbit });
  }

  function tick(now) {
    preview.raf = 0;
    var dt = preview.last ? Math.min(0.1, (now - preview.last) / 1000) : 0;
    preview.last = now;

    /* ease the manual orbit back to the scripted camera path */
    if (!preview.dragging && now - preview.idleAt > 1800) {
      var o = preview.orbit, k = 0.94;
      o.yaw *= k; o.pitch *= k; o.roll *= k;
      o.zoom = 1 + (o.zoom - 1) * k;
    }

    if (preview.playing) {
      preview.t += dt;
      if (preview.t >= cfg.duration) { preview.t = cfg.duration; setPlaying(false); }
    }

    paintOnce();
    syncScrub();

    if (preview.playing || preview.dragging) schedule();
    else preview.last = 0;
  }

  function schedule() {
    if (!preview.raf) preview.raf = requestAnimationFrame(tick);
  }

  function setPlaying(on) {
    preview.playing = on;
    preview.last = 0;
    $('btnPlay').textContent = on ? '❚❚ Pause' : '▶ Play';
    if (on) schedule();
    else paintOnce();
  }

  function syncScrub() {
    var s = $('scrub');
    if (document.activeElement !== s) {
      s.value = Math.round((preview.t / cfg.duration) * 1000);
    }
    $('timeLabel').textContent = preview.t.toFixed(1) + 's';
  }

  /* ══════════════ status / phases ══════════════ */

  function setPhase(next, pct) {
    state.phase = next;
    var dot = $('statusDot'), txt = $('statusText'), sub = $('statusSub');
    var gen = $('btnGenerate'), genLabel = $('btnGenerateLabel');
    var dl = $('btnDownload'), pv = $('btnPreview2'), cancel = $('btnCancel');
    var wrap = $('progressWrap'), bar = $('progressBar'), pc = $('progressPct');
    var badge = $('stageBadge'), stale = $('staleNotice');

    dot.className = 'dot';
    gen.disabled = false;
    cancel.hidden = true;
    wrap.hidden = true;
    stale.hidden = true;
    badge.hidden = true;

    var dims = cfg.duration + 's · ' + cfg.width + ' × ' + cfg.height + ' · ' + cfg.fps + ' fps';
    sub.textContent = dims;

    var hasVideo = !!state.video;

    if (next === 'rendering') {
      dot.classList.add('is-rendering');
      var p = Math.round((pct || 0) * 100);
      txt.textContent = 'Rendering… ' + p + '%';
      genLabel.textContent = 'Rendering… ' + p + '%';
      gen.disabled = true;
      wrap.hidden = false;
      bar.style.width = p + '%';
      pc.textContent = p + '%';
      badge.hidden = false;
      badge.textContent = 'Rendering… ' + p + '%';
      cancel.hidden = false;
      dl.disabled = !hasVideo;
      pv.disabled = !hasVideo;
      return;
    }

    if (next === 'ready') {
      dot.classList.add('is-ready');
      txt.textContent = '✓ Animation Ready';
      genLabel.textContent = 'Generate New Animation';
      dl.disabled = false;
      pv.disabled = false;
      if (state.video) {
        sub.textContent = dims + ' · ' + state.video.ext.toUpperCase() + ' · ' +
          CM.Exporter.humanSize(state.video.bytes);
      }
      return;
    }

    if (next === 'stale') {
      dot.classList.add('is-stale');
      txt.textContent = 'Settings changed — Generate new animation';
      genLabel.textContent = 'Generate New Animation';
      stale.hidden = false;
      dl.disabled = false;      /* previous file stays available (spec §65) */
      pv.disabled = false;
      return;
    }

    if (next === 'error') {
      dot.classList.add('is-error');
      txt.textContent = 'Render failed';
      sub.textContent = state.error || 'Unknown error';
      genLabel.textContent = 'Try Again';
      dl.disabled = !hasVideo;
      pv.disabled = !hasVideo;
      return;
    }

    /* idle */
    txt.textContent = 'Ready to render';
    genLabel.textContent = 'Generate Animation';
    dl.disabled = true;
    pv.disabled = true;
  }

  /* ══════════════ render ══════════════ */

  function generate() {
    if (state.phase === 'rendering') return;
    if (!cfg.code.trim()) {
      setPhase('error');
      state.error = 'Add some code first — the renderer needs something to draw.';
      setPhase('error');
      return;
    }

    var token = { cancelled: false };
    state.renderToken = token;
    state.error = null;
    setPhase('rendering', 0);

    var frozen = Object.assign({}, cfg);
    var t0 = performance.now();

    CM.Exporter.render(frozen, {
      signal: token,
      quality: frozen.quality,
      onProgress: function (p) { setPhase('rendering', p); }
    }).then(function (res) {
      state.renderToken = null;
      state.video = res;
      state.renderedKey = videoKey(cfg);
      addHistory(res, frozen);
      setPhase('ready');
      preview.t = 0;
      setPlaying(true);
    }).catch(function (err) {
      state.renderToken = null;
      if (err && err.cancelled) {
        setPhase(state.video ? 'stale' : 'idle');
      } else {
        state.error = err && err.message ? err.message : String(err);
        setPhase('error');
      }
    });
  }

  function cancelRender() {
    if (state.renderToken) state.renderToken.cancelled = true;
  }

  /* ══════════════ history ══════════════ */

  function addHistory(res, snapshot) {
    state.history.unshift({
      blob: res.blob, filename: res.filename, ext: res.ext,
      width: res.width, height: res.height, fps: res.fps, duration: res.duration,
      bytes: res.bytes, ms: res.ms, at: Date.now(), snapshot: snapshot,
      thumb: null
    });
    state.history = state.history.slice(0, 6);
    renderHistory();
  }

  function renderHistory() {
    var list = $('historyList'), wrap = $('history');
    if (!state.history.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    $('historyMeta').textContent = state.history.length +
      (state.history.length === 1 ? ' version' : ' versions') +
      ' · kept until you clear the page';

    list.innerHTML = '';
    state.history.forEach(function (item, idx) {
      var card = document.createElement('article');
      card.className = 'hcard' + (idx === 0 ? ' is-current' : '');

      var img = document.createElement('img');
      img.alt = 'Preview of ' + item.filename;
      try { img.src = CM.Exporter.thumbnail(item.snapshot, 320, 180); } catch (e) {}
      card.appendChild(img);

      if (idx === 0) {
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'Current';
        card.appendChild(tag);
      }

      var body = document.createElement('div');
      body.className = 'hbody';

      var meta = document.createElement('div');
      meta.className = 'hmeta';
      meta.textContent = item.duration + 's · ' + item.width + '×' + item.height + ' · ' +
        item.fps + 'fps · ' + CM.Exporter.humanSize(item.bytes);

      var name = document.createElement('div');
      name.className = 'hname';
      name.textContent = item.filename;

      var btns = document.createElement('div');
      btns.className = 'hbtns';

      var dl = document.createElement('button');
      dl.type = 'button';
      dl.className = 'pbtn';
      dl.textContent = '↓ Download';
      dl.addEventListener('click', function () { CM.Exporter.download(item.blob, item.filename); });

      var replay = document.createElement('button');
      replay.type = 'button';
      replay.className = 'pbtn';
      replay.textContent = '▶ Preview';
      replay.addEventListener('click', function () {
        Object.assign(cfg, item.snapshot);
        syncControls();
        preview.t = 0;
        setPlaying(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });

      btns.appendChild(replay);
      btns.appendChild(dl);
      body.appendChild(meta);
      body.appendChild(name);
      body.appendChild(btns);
      card.appendChild(body);
      list.appendChild(card);
    });
  }

  /* ══════════════ settings changed ══════════════ */

  function onSettingChanged(repaint) {
    persist();
    CM.Animator.prepare(cfg);
    if (preview.t > cfg.duration) preview.t = cfg.duration;
    if (state.video && videoKey(cfg) !== state.renderedKey) setPhase('stale');
    else if (state.phase !== 'rendering' && state.phase !== 'ready') setPhase(state.phase);
    updateMeta();
    if (repaint !== false) paintOnce();
  }

  function updateMeta() {
    var lines = cfg.code.split('\n').length;
    var chars = cfg.code.length;
    $('codeMeta').textContent = lines + (lines === 1 ? ' line' : ' lines') +
      ' · ' + chars + (chars === 1 ? ' char' : ' chars');
    var cost = Math.round(cfg.width * cfg.height * cfg.fps * cfg.duration / 1e6);
    $('statusSub').textContent = cfg.duration + 's · ' + cfg.width + ' × ' +
      cfg.height + ' · ' + cfg.fps + ' fps' + (cost ? ' · ~' + cost + 'M px' : '');
  }

  /* ══════════════ controls ══════════════ */

  function buildSelects() {
    var lang = $('selLang');
    CM.langIds.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id; o.textContent = CM.langLabel(id);
      lang.appendChild(o);
    });

    var th = $('selTheme');
    CM.THEME_ORDER.forEach(function (id) {
      var o = document.createElement('option');
      o.value = id; o.textContent = CM.getTheme(id).name;
      th.appendChild(o);
    });

    var ex = $('exampleSelect');
    CM.EXAMPLES.forEach(function (e, i) {
      var o = document.createElement('option');
      o.value = String(i); o.textContent = e.label;
      ex.appendChild(o);
    });
  }

  function chipGroup(containerId, attr, apply) {
    var box = $(containerId);
    box.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.chip');
      if (!btn) return;
      Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (c) { c.classList.remove('is-on'); });
      btn.classList.add('is-on');
      apply(btn.dataset[attr]);
      onSettingChanged();
    });
  }

  function syncChips() {
    Array.prototype.forEach.call($('sizeChips').children, function (c) {
      c.classList.toggle('is-on', +c.dataset.w === cfg.width && +c.dataset.h === cfg.height);
    });
    Array.prototype.forEach.call($('durChips').children, function (c) {
      c.classList.toggle('is-on', +c.dataset.d === cfg.duration);
    });
    Array.prototype.forEach.call($('fpsChips').children, function (c) {
      c.classList.toggle('is-on', +c.dataset.f === cfg.fps);
    });
  }

  function syncControls() {
    $('selLang').value = cfg.language;
    $('selTheme').value = cfg.theme;
    $('code').value = cfg.code;
    $('selBackground').value = cfg.background;
    $('selQuality').value = cfg.quality;
    $('selCamera').value = cfg.camera;

    var setRange = function (id, v) { $(id).value = String(Math.round(v * 1000)); };
    setRange('rngPanelWidth', cfg.panelWidth);
    setRange('rngFontScale', cfg.fontScale);
    setRange('rngRadius', cfg.radius);
    setRange('rngZoom', cfg.zoom);
    setRange('rngFollow', cfg.follow);
    setRange('rngDrift', cfg.drift);

    $('valPanelWidth').textContent = Math.round(cfg.panelWidth * 100) + '%';
    $('valFontScale').textContent = Math.round(cfg.fontScale * 100) + '%';
    $('valRadius').textContent = cfg.radius.toFixed(1);
    $('valZoom').textContent = cfg.zoom.toFixed(2);
    $('valFollow').textContent = cfg.follow.toFixed(2);
    $('valDrift').textContent = cfg.drift.toFixed(1);

    $('chkChrome').checked = cfg.showChrome;
    $('chkNumbers').checked = cfg.showLineNumbers;
    $('chkProgress').checked = cfg.showProgress;
    $('chkWatermark').checked = cfg.watermark;

    $('inpW').value = cfg.width;
    $('inpH').value = cfg.height;
    syncChips();
    updateMeta();
    fitPreview();
  }

  function bindControls() {
    $('selLang').addEventListener('change', function (e) { cfg.language = e.target.value; onSettingChanged(); });
    $('selTheme').addEventListener('change', function (e) { cfg.theme = e.target.value; onSettingChanged(); });
    $('selBackground').addEventListener('change', function (e) { cfg.background = e.target.value; onSettingChanged(); });
    $('selQuality').addEventListener('change', function (e) { cfg.quality = e.target.value; onSettingChanged(false); });
    $('selCamera').addEventListener('change', function (e) { cfg.camera = e.target.value; onSettingChanged(); });

    var code = $('code');
    code.addEventListener('input', function () { cfg.code = code.value; onSettingChanged(); });
    code.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      var s = code.selectionStart, en = code.selectionEnd;
      code.value = code.value.slice(0, s) + '    ' + code.value.slice(en);
      code.selectionStart = code.selectionEnd = s + 4;
      cfg.code = code.value;
      onSettingChanged();
    });

    var ranges = [
      ['rngPanelWidth', 'panelWidth', 'valPanelWidth', function (v) { return Math.round(v * 100) + '%'; }],
      ['rngFontScale', 'fontScale', 'valFontScale', function (v) { return Math.round(v * 100) + '%'; }],
      ['rngRadius', 'radius', 'valRadius', function (v) { return v.toFixed(1); }],
      ['rngZoom', 'zoom', 'valZoom', function (v) { return v.toFixed(2); }],
      ['rngFollow', 'follow', 'valFollow', function (v) { return v.toFixed(2); }],
      ['rngDrift', 'drift', 'valDrift', function (v) { return v.toFixed(1); }]
    ];
    ranges.forEach(function (r) {
      var el = $(r[0]);
      el.addEventListener('input', function (e) {
        cfg[r[1]] = +e.target.value / 1000;
        $(r[2]).textContent = r[3](cfg[r[1]]);
        onSettingChanged();
      });
    });

    var checks = [
      ['chkChrome', 'showChrome'], ['chkNumbers', 'showLineNumbers'],
      ['chkProgress', 'showProgress'], ['chkWatermark', 'watermark']
    ];
    checks.forEach(function (c) {
      $(c[0]).addEventListener('change', function (e) { cfg[c[1]] = e.target.checked; onSettingChanged(); });
    });

    $('inpW').addEventListener('input', function (e) {
      var v = Math.max(240, Math.min(3840, +e.target.value || 1920));
      cfg.width = Math.round(v / 2) * 2; syncChips(); onSettingChanged();
    });
    $('inpH').addEventListener('input', function (e) {
      var v = Math.max(240, Math.min(3840, +e.target.value || 1080));
      cfg.height = Math.round(v / 2) * 2; syncChips(); onSettingChanged();
    });

    chipGroup('sizeChips', 'w', function () { });
    $('sizeChips').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.chip');
      if (!btn) return;
      cfg.width = +btn.dataset.w; cfg.height = +btn.dataset.h;
      $('inpW').value = cfg.width; $('inpH').value = cfg.height;
      onSettingChanged();
    });
    chipGroup('durChips', 'd', function (v) { cfg.duration = +v; });
    chipGroup('fpsChips', 'f', function (v) { cfg.fps = +v; });

    $('exampleSelect').addEventListener('change', function (e) {
      var ex = CM.EXAMPLES[+e.target.value];
      if (!ex) return;
      cfg.code = ex.code; cfg.language = ex.language; cfg.theme = ex.theme;
      preview.t = 0;
      syncControls();
      onSettingChanged();
      e.target.value = '';
    });

    /* tabs */
    function showTab(which) {
      var style = which === 'style';
      $('tabStyle').classList.toggle('is-on', style);
      $('tabView').classList.toggle('is-on', !style);
      $('tabStyle').setAttribute('aria-selected', String(style));
      $('tabView').setAttribute('aria-selected', String(!style));
      $('paneStyle').hidden = !style;
      $('paneView').hidden = style;
      $('paneStyle').classList.toggle('is-on', style);
      $('paneView').classList.toggle('is-on', !style);
    }
    $('tabStyle').addEventListener('click', function () { showTab('style'); });
    $('tabView').addEventListener('click', function () { showTab('view'); });

    /* actions */
    $('btnGenerate').addEventListener('click', generate);
    $('btnGenerateTop').addEventListener('click', generate);
    $('btnRegen').addEventListener('click', generate);
    $('btnCancel').addEventListener('click', cancelRender);

    $('btnDownload').addEventListener('click', function () {
      if (!state.video) return;
      CM.Exporter.download(state.video.blob, state.video.filename);
    });

    $('btnPreview2').addEventListener('click', function () { preview.t = 0; setPlaying(true); });
    $('btnPlay').addEventListener('click', function () {
      if (!preview.playing && preview.t >= cfg.duration) preview.t = 0;
      setPlaying(!preview.playing);
    });
    $('btnReplay').addEventListener('click', function () { preview.t = 0; setPlaying(true); });

    $('scrub').addEventListener('input', function (e) {
      preview.t = (+e.target.value / 1000) * cfg.duration;
      setPlaying(false);
      paintOnce();
    });

    /* config save / load */
    $('btnSave').addEventListener('click', function () {
      var payload = JSON.stringify({ app: 'CodeMotion', version: 1, config: cfg }, null, 2);
      var blob = new Blob([payload], { type: 'application/json' });
      CM.Exporter.download(blob, 'codemotion-config.json');
    });
    $('btnLoad').addEventListener('click', function () { $('fileConfig').click(); });
    $('fileConfig').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(String(reader.result));
          var incoming = data && data.config ? data.config : data;
          Object.keys(cfg).forEach(function (k) {
            if (k in incoming && typeof incoming[k] === typeof cfg[k]) cfg[k] = incoming[k];
          });
          syncControls();
          onSettingChanged();
        } catch (err) {
          state.error = 'That file is not a CodeMotion config.';
          setPhase('error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    window.addEventListener('keydown', function (e) {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); }
      if (e.key === ' ') { e.preventDefault(); setPlaying(!preview.playing); }
    });
  }

  /* ══════════════ pointer orbit ══════════════ */

  function bindPointer() {
    var cv = preview.canvas;
    cv.addEventListener('pointerdown', function (e) {
      preview.dragging = true;
      preview.lastX = e.clientX; preview.lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
      schedule();
    });
    cv.addEventListener('pointermove', function (e) {
      if (!preview.dragging) return;
      var dx = e.clientX - preview.lastX, dy = e.clientY - preview.lastY;
      preview.lastX = e.clientX; preview.lastY = e.clientY;
      if (e.shiftKey) {
        preview.orbit.roll += dx * 0.004;
      } else {
        preview.orbit.yaw += dx * 0.055;
        preview.orbit.pitch += dy * 0.045;
      }
      preview.orbit.yaw = Math.max(-90, Math.min(90, preview.orbit.yaw));
      preview.orbit.pitch = Math.max(-90, Math.min(90, preview.orbit.pitch));
      preview.idleAt = performance.now();
      schedule();
    });
    function stop(e) {
      if (!preview.dragging) return;
      preview.dragging = false;
      preview.idleAt = performance.now();
      try { cv.releasePointerCapture(e.pointerId); } catch (err) {}
      schedule();
    }
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      preview.orbit.zoom = Math.max(0.6, Math.min(2.2, preview.orbit.zoom * (e.deltaY > 0 ? 0.92 : 1.087)));
      preview.idleAt = performance.now();
      schedule();
    }, { passive: false });
  }

  /* ══════════════ boot ══════════════ */

  function init() {
    preview.canvas = $('preview');
    preview.ctx = preview.canvas.getContext('2d', { alpha: false });

    $('year').textContent = new Date().getFullYear();

    buildSelects();

    var hadSaved = restore();
    if (!hadSaved) {
      cfg.code = CM.EXAMPLES[0].code;
      cfg.language = CM.EXAMPLES[0].language;
      cfg.theme = CM.EXAMPLES[0].theme;
    }

    CM.Animator.clearMetrics();
    CM.Animator.prepare(cfg);
    bindControls();
    syncControls();
    bindPointer();

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { CM.Animator.clearMetrics(); paintOnce(); });
    }

    var ro = window.ResizeObserver ? new ResizeObserver(fitPreview) : null;
    if (ro) ro.observe($('stageFrame'));
    window.addEventListener('resize', fitPreview);

    /* encoder report */
    var p = CM.Exporter.probe();
    if (p.ok) {
      $('codecInfo').textContent = 'Output: ' + p.codec.label + '. Files are named ' +
        'codemotion-<seconds>s-<width>x<height>.' + p.codec.ext + '.';
      if (p.modern && CM.Mp4) {
        CM.Mp4.pickCodec(cfg.width, cfg.height, cfg.fps, 4000000).then(function (c) {
          if (!c) return;
          $('codecInfo').textContent = 'Output: MP4 (H.264, ' + c + '). Frames carry exact ' +
            'timestamps, so a ' + cfg.duration + 's clip is ' + cfg.duration +
            's long however long the render takes.';
        });
      }
    } else {
      $('codecInfo').textContent = p.reason + ' Try a recent Chrome, Edge or Safari.';
      $('btnGenerate').disabled = true;
      $('btnGenerateTop').disabled = true;
    }

    setPhase('idle');
    setPlaying(true);
    renderHistory();

    /* Ad units are placed in the markup; the Auto Ads loader in <head> covers
       the rest, so there is nothing to push here. */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  CM.app = { cfg: cfg, state: state, generate: generate };
})(window.CM = window.CM || {});