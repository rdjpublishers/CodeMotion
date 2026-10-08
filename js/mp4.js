/* CodeMotion — minimal MP4 muxer for WebCodecs output.

   Why this exists: MediaRecorder stamps frames with wall-clock time, so a slow
   machine silently produces slow-motion. WebCodecs hands back chunks that carry
   their own timestamps, so we can mux them with exact timing regardless of how
   long the render actually took.

   Layout: ftyp | mdat | moov, with a complete sample table in stbl so players
   can seek instantly. This is an ordinary progressive MP4 — Chrome, Safari,
   QuickTime, VLC and every upload pipeline read it.                       */
(function (CM) {
  'use strict';

  function concat(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len), o = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], o); o += parts[i].length; }
    return out;
  }

  function box(type, parts) {
    var inner = 0, i;
    for (i = 0; i < parts.length; i++) inner += parts[i].length;
    var head = new Uint8Array(8);
    var dv = new DataView(head.buffer);
    dv.setUint32(0, 8 + inner);
    head[4] = type.charCodeAt(0); head[5] = type.charCodeAt(1);
    head[6] = type.charCodeAt(2); head[7] = type.charCodeAt(3);
    return concat([head].concat(parts));
  }

  function fullBox(type, version, flags, parts) {
    var vf = new Uint8Array(4);
    vf[0] = version & 255;
    vf[1] = (flags >>> 16) & 255; vf[2] = (flags >>> 8) & 255; vf[3] = flags & 255;
    return box(type, [vf].concat(parts));
  }

  function u8(n) { return new Uint8Array([n & 255]); }
  function u16(n) { var a = new Uint8Array(2); new DataView(a.buffer).setUint16(0, n & 0xFFFF); return a; }
  function u24(n) {
    return new Uint8Array([(n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  }
  function u32(n) { var a = new Uint8Array(4); new DataView(a.buffer).setUint32(0, n >>> 0); return a; }
  function u64(n) {
    var a = new Uint8Array(8), dv = new DataView(a.buffer);
    dv.setUint32(0, Math.floor(n / 4294967296));
    dv.setUint32(4, n >>> 0);
    return a;
  }
  function zeros(n) { return new Uint8Array(n); }

  var UNITY_MATRIX = concat([
    u32(0x00010000), u32(0), u32(0),
    u32(0), u32(0x00010000), u32(0),
    u32(0), u32(0), u32(0x40000000)
  ]);

  var TIMESCALE = 90000;   /* standard video timescale; exact for 24/25/30/60 */

  /* NOTE on avc1 dimensions: ISO 14496-12 describes width/height as 16.16
     fixed point, but every demuxer in practice (ffmpeg, Chrome, QuickTime)
     reads them as two 16-bit fields, and every muxer writes them that way.
     Using the 16.16 form shifts every subsequent field by four bytes and
     lands avcC on the wrong boundary — the file then parses as "no supported
     streams". So: 16-bit here. tkhd genuinely does use the 16.16 form. */

  function Muxer(opts) {
    this.width = opts.width;
    this.height = opts.height;
    this.fps = opts.fps;
    this.delta = Math.max(1, Math.round(TIMESCALE / opts.fps));
    this.description = opts.description;     /* AVCDecoderConfigurationRecord */
    this.samples = [];                       /* { data, key } */
    this.sequence = 1;
  }

  Muxer.prototype.addChunk = function (chunk) {
    var data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.samples.push({ data: data, key: chunk.type === 'key' });
  };

  Muxer.prototype.sampleCount = function () { return this.samples.length; };

  Muxer.prototype.toBlob = function (mime) {
    var ftyp = this._ftyp();

    /* Fast-start layout: ftyp | moov | mdat.
       The chunk offset is patched in a second pass — moov's size does not
       depend on the offset value, only on the sample/entry counts. */
    var moovProbe = this._moov(0);
    var payload = concat(this.samples.map(function (s) { return s.data; }));
    var mdatDataStart = ftyp.length + moovProbe.length + 8;
    var moov = this._moov(mdatDataStart);

    return new Blob([ftyp, moov, box('mdat', [payload])], { type: mime || 'video/mp4' });
  };

  Muxer.prototype._ftyp = function () {
    return box('ftyp', [
      new Uint8Array([105, 115, 111, 109]),  /* isom */
      u32(0x200),
      new Uint8Array([105, 115, 111, 109]),  /* isom */
      new Uint8Array([105, 115, 111, 50]),   /* iso2 */
      new Uint8Array([97, 118, 99, 49]),     /* avc1 */
      new Uint8Array([109, 112, 52, 49])     /* mp41 */
    ]);
  };

  Muxer.prototype._moov = function (dataOffset) {
    var n = this.samples.length;
    var dur = n * this.delta;

    var mvhd = fullBox('mvhd', 0, 0, [
      u32(0), u32(0), u32(TIMESCALE), u32(dur),
      u32(0x00010000), u16(0x0100), zeros(10),
      UNITY_MATRIX, zeros(24), u32(2)
    ]);

    var tkhd = fullBox('tkhd', 0, 3, [
      u32(0), u32(0), u32(1), u32(0), u32(dur),
      zeros(8), u16(0), u16(0), u16(0), u16(0),
      UNITY_MATRIX,
      u32(this.width * 65536), u32(this.height * 65536)
    ]);

    var mdhd = fullBox('mdhd', 0, 0, [
      u32(0), u32(0), u32(TIMESCALE), u32(dur), u16(0x55C4), u16(0)
    ]);

    var hdlr = fullBox('hdlr', 0, 0, [
      u32(0),
      new Uint8Array([118, 105, 100, 101]),  /* vide */
      zeros(12),
      new Uint8Array([86, 105, 100, 101, 111, 72, 97, 110, 100, 108, 101, 114, 0]) /* "VideoHandler" */
    ]);

    var vmhd = fullBox('vmhd', 0, 1, [u16(0), u16(0), u16(0), u16(0)]);
    var dref = fullBox('dref', 0, 0, [u32(1), fullBox('url ', 0, 1, [])]);
    var dinf = box('dinf', [dref]);

    var avcC = box('avcC', [this.description]);

    var avc1 = box('avc1', [
      zeros(6), u16(1),                 /* reserved + data_reference_index */
      u16(0), u16(0), zeros(12),        /* pre_defined / reserved */
      u16(this.width), u16(this.height), /* 16-bit dims — see note below */
      u32(0x00480000), u32(0x00480000),  /* 72 dpi */
      u32(0), u16(1),                   /* reserved, frame_count */
      zeros(32),                        /* compressorname */
      u16(0x0018), u16(0xFFFF),         /* depth, pre_defined = -1 */
      avcC
    ]);

    var stsd = fullBox('stsd', 0, 0, [u32(1), avc1]);

    /* every frame has the same duration, so one stts entry covers the track */
    var stts = fullBox('stts', 0, 0, [u32(1), u32(n), u32(this.delta)]);

    /* all samples live in a single chunk */
    var stsc = fullBox('stsc', 0, 0, [u32(1), u32(1), u32(n), u32(1)]);

    var sizes = [u32(0), u32(n)];
    for (var i = 0; i < n; i++) sizes.push(u32(this.samples[i].data.length));
    var stsz = fullBox('stsz', 0, 0, sizes);

    var stco = fullBox('stco', 0, 0, [u32(1), u32(dataOffset)]);

    /* sync samples let a player seek without decoding from the start */
    var syncs = [];
    for (var j = 0; j < n; j++) syncs.push(u32(this.samples[j].key ? j + 1 : 0));
    syncs.unshift(u32(n));
    var stss = fullBox('stss', 0, 0, syncs);

    var stbl = box('stbl', [stsd, stts, stss, stsc, stsz, stco]);
    var minf = box('minf', [vmhd, dinf, stbl]);
    var mdia = box('mdia', [mdhd, hdlr, minf]);
    var trak = box('trak', [tkhd, mdia]);

    return box('moov', [mvhd, trak]);
  };

  /* ---- capability probe ---------------------------------------------- */

  var CANDIDATES = ['avc1.4D401F', 'avc1.4D402A', 'avc1.640028', 'avc1.42E01E'];

  function pickCodec(width, height, fps, bitrate) {
    if (typeof VideoEncoder === 'undefined') return Promise.resolve(null);
    var chain = Promise.resolve(null);
    CANDIDATES.forEach(function (codec) {
      chain = chain.then(function (found) {
        if (found) return found;
        return VideoEncoder.isConfigSupported({
          codec: codec, width: width, height: height,
          bitrate: bitrate, framerate: fps
        }).then(function (s) {
          return s && s.supported ? codec : null;
        }).catch(function () { return null; });
      });
    });
    return chain;
  }

  CM.Mp4 = {
    Muxer: Muxer,
    pickCodec: pickCodec,
    TIMESCALE: TIMESCALE
  };
})(window.CM = window.CM || {});