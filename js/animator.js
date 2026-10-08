/* CodeMotion — deterministic animation engine.

   ONE function paints every frame:  draw(ctx, W, H, t, cfg, opts)

   `t` is seconds. Preview passes the live playback clock; the exporter passes
   frame/fps. Because the same pure function serves both, the downloaded file is
   frame-identical to what the user watched — no capture, no re-timing.        */
(function (CM) {
  'use strict';

  var FONT_MONO = '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace';
  var FONT_UI = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  /* ---------- small math helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOutCubic(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  /* ---------- cached glyph metrics ---------- */
  var charWCache = {};
  function charWidth(ctx, font) {
    if (charWCache[font] != null) return charWCache[font];
    ctx.font = font;
    var w = ctx.measureText('M0il').width / 4;
    charWCache[font] = w;
    return w;
  }
  function clearMetrics() { charWCache = {}; }

  /* ---------- deterministic film grain ---------- */
  var grainTile = null;
  function getGrainTile() {
    if (grainTile) return grainTile;
    var S = 128;
    var c = document.createElement('canvas');
    c.width = S; c.height = S;
    var g = c.getContext('2d');
    var img = g.createImageData(S, S);
    var seed = 20240611;
    for (var i = 0; i < S * S; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      var v = 128 + (((seed >>> 16) & 255) - 128) * 0.5;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    grainTile = c;
    return c;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rr); return; }
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function withAlpha(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ---------- filename inference ---------- */
  var EXT = {
    python: '.py', javascript: '.js', typescript: '.ts', java: '.java', c: '.c',
    cpp: '.cpp', go: '.go', rust: '.rs', php: '.php', ruby: '.rb',
    sql: '.sql', bash: '.sh', json: '.json', yaml: '.yaml', markdown: '.md',
    html: '.html', css: '.css', plain: '.txt'
  };
  var RESERVED = ['import ', 'from ', 'const ', 'let ', 'var ', 'function ', 'package ', 'using ', 'use ', '#include', 'def ', 'class '];

  function deriveFilename(code, lang) {
    var lines = code.split('\n');
    var name = null;
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s || s[0] === '#' || s.startsWith('//') || s.startsWith('/*') || s.startsWith('<!--')) continue;
      var m = /(?:def|class|function|interface|struct|type|const|let|var|fn|enum)\s+([A-Za-z_$][\w$]*)/.exec(s);
      if (m) { name = m[1]; break; }
      var skip = false;
      for (var r = 0; r < RESERVED.length; r++) if (s.startsWith(RESERVED[r])) { skip = true; break; }
      if (skip) continue;
      m = /([A-Za-z_$][\w$-]*)/.exec(s);
      if (m) { name = m[1]; break; }
    }
    name = name || CM.langLabel(lang).toLowerCase().replace(/\s+/g, '-');
    return name.replace(/[^\w$-]/g, '') + (EXT[lang] || '.txt');
  }

  /* ---------- layout ---------- */
  function layout(cfg, W, H) {
    var theme = CM.getTheme(cfg.theme);
    var scale = clamp(Math.min(W, H) / 900, 0.75, 2.4);
    var fontSize = Math.round(21 * scale * (cfg.fontScale || 1));
    var font = '400 ' + fontSize + 'px ' + FONT_MONO;
    var uiFont = '600 ' + Math.round(fontSize * 0.62) + 'px ' + FONT_UI;

    var measureCtx = layout._mc || (layout._mc = document.createElement('canvas').getContext('2d'));
    var cw = charWidth(measureCtx, font);
    var lineHeight = Math.round(fontSize * 1.62);

    var margin = Math.round(W * 0.065);
    var maxW = W - margin * 2;
    var maxH = H - margin * 2;

    var chromeH = cfg.showChrome ? Math.round(fontSize * 2.7) : 0;
    var gutter = cfg.showLineNumbers ? Math.round(fontSize * 2.9) : 0;
    var padX = Math.round(fontSize * 1.35);
    var padY = Math.round(fontSize * 1.15);

    var codeW = Math.round(maxW * clamp(cfg.panelWidth != null ? cfg.panelWidth : 0.86, 0.35, 1));
    var panelW = Math.min(codeW, maxW);

    var availRows = Math.max(3, Math.floor((maxH - chromeH - padY * 2) / lineHeight));
    var nLines = (cfg._lines && cfg._lines.length) || 1;
    var shownRows = Math.min(nLines, availRows);
    var panelH = chromeH + padY * 2 + shownRows * lineHeight;

    panelW = Math.min(panelW, maxW);
    panelH = Math.min(panelH, maxH);

    var panelX = Math.round((W - panelW) / 2);
    var panelY = Math.round((H - panelH) / 2);

    var contentX = panelX + padX + gutter;
    var contentY = panelY + chromeH + padY;
    var contentW = panelW - padX * 2 - gutter;
    var maxCols = Math.max(8, Math.floor(contentW / cw));

    return {
      theme: theme, scale: scale, W: W, H: H, maxW: maxW, maxH: maxH,
      font: font, uiFont: uiFont, fontSize: fontSize, cw: cw, lineHeight: lineHeight,
      margin: margin, panelX: panelX, panelY: panelY, panelW: panelW, panelH: panelH,
      chromeH: chromeH, gutter: gutter, padX: padX, padY: padY,
      contentX: contentX, contentY: contentY, contentW: contentW, maxCols: maxCols,
      maxRows: availRows, rows: shownRows,
      radius: Math.round(fontSize * (cfg.radius != null ? cfg.radius : 0.9)),
      filename: cfg._filename || 'snippet' + (EXT[cfg.language] || '.txt')
    };
  }

  /* ---------- timeline ---------- */
  function stateAt(cfg, t) {
    var lines = cfg._lines || [''];
    var cum = cfg._cum;
    var total = cfg._totalChars || 1;

    var duration = Math.max(0.5, cfg.duration || 10);
    var typingDur = Math.max(0.6, duration * 0.74);
    var holdStart = typingDur + 0.12;

    var typeT = clamp(t - 0.12, 0, typingDur);
    var chars = Math.round(easeInOutCubic(typeT / typingDur) * total);
    if (t >= holdStart) chars = total;
    chars = clamp(chars, 0, total);

    /* locate caret */
    var line = 0, col = 0, lo = 0;
    while (line < lines.length && cum[line + 1] <= chars) { lo = cum[line + 1]; line++; }
    if (line >= lines.length) { line = lines.length - 1; lo = cum[line]; }
    col = chars - lo;

    /* Continuous row position. Unlike the integer `line`, this does not jump when
       a line finishes, so the code scrolls instead of cutting. */
    var rowFloat = line + (lines[line].length ? clamp(col / lines[line].length, 0, 1) : 0);

    var done = t >= holdStart;
    var holdP = done ? clamp((t - holdStart) / Math.max(0.4, duration - holdStart), 0, 1) : 0;

    return {
      lines: lines, cum: cum, total: total, clock: t,
      chars: chars, line: line, col: col, rowFloat: rowFloat,
      progress: total ? chars / total : 1,
      done: done, holdP: holdP,
      typingDur: typingDur, holdStart: holdStart, duration: duration,
      intro: easeOutCubic(clamp(t / 0.5, 0, 1)),
      outro: easeInOutCubic(clamp((t - (duration - 0.6)) / 0.6, 0, 1))
    };
  }

  /* ---------- camera ----------
     The card stays centred and fully framed; motion comes from scrolling the
     code inside it plus a bounded push-in. That way no code setting can ever
     push the panel out of frame. */
  function camera(cfg, st, L) {
    var zoomAmt = clamp(cfg.zoom != null ? cfg.zoom : 0.3, 0, 1.2);
    var drift = clamp(cfg.drift != null ? cfg.drift : 1, 0, 2);
    var mode = cfg.camera || 'follow';

    /* where in the code viewport the caret should sit (0 = top, 0.5 = middle) */
    var anchor = clamp(0.5 - 0.3 * clamp(cfg.follow != null ? cfg.follow : 0.9, 0, 1), 0.12, 0.5);

    var maxScroll = Math.max(0, st.lines.length - L.rows);
    var scroll = st.lines.length <= L.rows ? 0
      : clamp(st.rowFloat - L.rows * anchor, 0, maxScroll);

    var p = easeInOutCubic(st.progress);
    var scale = 1 + zoomAmt * smooth(clamp(p / 0.75, 0, 1));
    if (st.done) scale = lerp(scale, 1 + zoomAmt * 0.15, easeOutQuint(st.holdP));
    if (mode === 'static') scale = 1;

    /* keep the push-in from cropping the card away */
    var cap = Math.max(1, Math.min((L.maxW * 1.12) / L.panelW, (L.maxH * 1.18) / L.panelH));
    scale = Math.min(scale, cap);

    var roll = Math.sin(st.clock * 0.28) * 0.006 * drift;
    var dx = Math.sin(st.clock * 0.41) * L.fontSize * 0.28 * drift;
    var dy = Math.cos(st.clock * 0.33) * L.fontSize * 0.24 * drift;

    if (mode === 'static') { roll = 0; dx = 0; dy = 0; }
    if (mode === 'orbit') {
      roll = Math.sin(st.clock * 0.5) * 0.028 * drift;
      dx = Math.cos(st.clock * 0.4) * L.panelW * 0.035 * drift;
      dy = Math.sin(st.clock * 0.33) * L.panelH * 0.045 * drift;
    }

    return { scale: scale, roll: roll, dx: dx, dy: dy, scroll: scroll, mode: mode };
  }

  /* ---------- background ---------- */
  function drawBackground(ctx, W, H, th, cfg, st) {
    var g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, th.bg2);
    g.addColorStop(1, th.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var mode = cfg.background || 'glow';

    if (mode === 'grid' || mode === 'dots') {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = th.text; ctx.fillStyle = th.text;
      var step = Math.round(Math.min(W, H) / (mode === 'grid' ? 22 : 26));
      if (mode === 'grid') {
        ctx.lineWidth = Math.max(1, W / 1400);
        ctx.beginPath();
        for (var x = 0; x <= W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
        for (var y = 0; y <= H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
      } else {
        for (var dx = step / 2; dx < W; dx += step) {
          for (var dy = step / 2; dy < H; dy += step) {
            ctx.beginPath();
            ctx.arc(dx, dy, Math.max(1, W / 900), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }

    if (mode === 'glow' || mode === 'grid' || mode === 'dots') {
      var rg = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, Math.max(W, H) * 0.72);
      rg.addColorStop(0, withAlpha(th.accent, 0.18));
      rg.addColorStop(0.55, withAlpha(th.accent2, 0.06));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    if (th.grain > 0) {
      var pat = ctx.createPattern(getGrainTile(), 'repeat');
      if (pat) {
        ctx.save();
        ctx.globalAlpha = th.grain;
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = pat;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    if (th.vignette > 0) {
      var vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.28, W / 2, H / 2, Math.max(W, H) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,' + th.vignette + ')');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ---------- panel ---------- */
  function drawPanel(ctx, L, th, cfg, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = L.fontSize * 2.2;
    ctx.shadowOffsetY = L.fontSize * 0.7;
    ctx.fillStyle = th.panel;
    roundRectPath(ctx, L.panelX, L.panelY, L.panelW, L.panelH, L.radius);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = withAlpha(th.border, 0.9);
    ctx.lineWidth = Math.max(1, L.W / 1600);
    roundRectPath(ctx, L.panelX, L.panelY, L.panelW, L.panelH, L.radius);
    ctx.stroke();

    if (cfg.showChrome) {
      ctx.save();
      roundRectPath(ctx, L.panelX, L.panelY, L.panelW, L.panelH, L.radius);
      ctx.clip();
      ctx.fillStyle = withAlpha(th.bg, 0.55);
      ctx.fillRect(L.panelX, L.panelY, L.panelW, L.chromeH);
      ctx.strokeStyle = withAlpha(th.border, 0.75);
      ctx.lineWidth = Math.max(1, L.W / 1600);
      ctx.beginPath();
      ctx.moveTo(L.panelX, L.panelY + L.chromeH);
      ctx.lineTo(L.panelX + L.panelW, L.panelY + L.chromeH);
      ctx.stroke();

      var r = L.fontSize * 0.30;
      var cy = L.panelY + L.chromeH / 2;
      var lights = [th.accent2, th.number, th.fn];
      for (var i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(L.panelX + L.padX + i * r * 3.1, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(lights[i], 0.85);
        ctx.fill();
      }

      ctx.font = L.uiFont;
      ctx.fillStyle = withAlpha(th.muted, 0.95);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(L.filename, L.panelX + L.panelW / 2, cy);
      ctx.restore();
    }

    ctx.restore();   /* every save() in this function is matched */
  }

  /* ---------- code ---------- */
  function drawCode(ctx, L, cfg, st, th, scroll) {
    var toks = cfg._tokens || [];
    var cum = st.cum;
    var firstRow = clamp(Math.round(scroll || 0), 0, Math.max(0, st.lines.length - 1));

    ctx.save();
    roundRectPath(ctx, L.panelX, L.panelY, L.panelW, L.panelH, L.radius);
    ctx.clip();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    for (var r = 0; r < L.rows; r++) {
      var li = firstRow + r;
      if (li >= st.lines.length) break;

      var y = L.contentY + r * L.lineHeight + L.lineHeight / 2;
      var lineStart = cum[li];
      var revealed = clamp(st.chars - lineStart, 0, st.lines[li].length);

      /* active line band */
      if (li === st.line && st.progress < 1) {
        ctx.fillStyle = withAlpha(th.accent, 0.07);
        ctx.fillRect(L.panelX, y - L.lineHeight / 2, L.panelW, L.lineHeight);
        ctx.fillStyle = withAlpha(th.accent, 0.9);
        ctx.fillRect(L.panelX, y - L.lineHeight / 2, Math.max(2, L.fontSize * 0.14), L.lineHeight);
      }

      /* line number */
      if (cfg.showLineNumbers) {
        ctx.font = L.font;
        ctx.fillStyle = li === st.line ? withAlpha(th.accent, 0.95) : withAlpha(th.muted, 0.6);
        ctx.textAlign = 'right';
        ctx.fillText(String(li + 1), L.contentX - L.gutter * 0.45, y);
        ctx.textAlign = 'left';
      }

      if (revealed <= 0) continue;

      var lineToks = toks[li] || [];
      var left = revealed;
      var x = L.contentX;
      ctx.font = L.font;

      for (var k = 0; k < lineToks.length && left > 0; k++) {
        var tk = lineToks[k];
        var txt = tk.text.length <= left ? tk.text : tk.text.slice(0, left);
        if (txt === '') break;
        var w = txt.length * L.cw;
        if (x + w > L.contentX + L.contentW + L.cw) break;   /* horizontal clip */
        ctx.fillStyle = th[tk.type] || th.text;
        ctx.fillText(txt, x, y);
        x += w;
        left -= txt.length;
      }

      /* caret */
      if (li === st.line && st.progress < 1) {
        var blink = (Math.floor(st.chars / 2) % 2) === 0;
        if (blink) {
          ctx.fillStyle = th.caret;
          ctx.globalAlpha = 0.9;
          ctx.fillRect(x + L.cw * 0.06, y - L.fontSize * 0.55, Math.max(2, L.cw * 0.5), L.fontSize * 1.12);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }

  /* ---------- HUD ---------- */
  function drawHud(ctx, W, H, cfg, st, th) {
    var u = Math.min(W, H) / 900;
    ctx.save();
    ctx.textBaseline = 'middle';

    if (cfg.watermark) {
      ctx.globalAlpha = 0.5;
      ctx.font = '600 ' + Math.round(15 * u) + 'px ' + FONT_UI;
      ctx.fillStyle = th.muted;
      ctx.textAlign = 'left';
      ctx.fillText('CodeMotion', W * 0.045, H * 0.955);
      ctx.textAlign = 'right';
      ctx.fillStyle = withAlpha(th.accent, 0.85);
      ctx.fillText('@rdjpublishers', W * 0.955, H * 0.955);
      ctx.globalAlpha = 1;
    }

    if (cfg.showProgress) {
      var pw = W * 0.16, ph = Math.max(2, 3 * u);
      var px = (W - pw) / 2, py = H * 0.955 - ph / 2;
      ctx.fillStyle = withAlpha(th.text, 0.14);
      roundRectPath(ctx, px, py, pw, ph, ph / 2); ctx.fill();
      var fw = Math.max(ph, pw * st.progress);
      ctx.fillStyle = th.accent;
      roundRectPath(ctx, px, py, fw, ph, ph / 2); ctx.fill();
    }
    ctx.restore();
  }

  /* ---------- public API ---------- */
  /* Re-tokenises when the source or language actually changed, so a caller that
     hands us a config it edited elsewhere can never render stale glyphs. */
  function prepare(cfg) {
    if (cfg._code === cfg.code && cfg._lang === cfg.language && cfg._lines) return cfg;

    var lines = cfg.code.split('\n');
    var res = CM.tokenize(cfg.code, cfg.language);
    var cum = [0], total = 0;
    for (var i = 0; i < lines.length; i++) {
      total += lines[i].length + 1;
      cum.push(total);
    }
    cfg._lines = lines;
    cfg._tokens = res.lines;
    cfg._cum = cum;
    cfg._totalChars = Math.max(1, total);
    cfg._filename = deriveFilename(cfg.code, cfg.language);
    cfg._code = cfg.code;
    cfg._lang = cfg.language;
    return cfg;
  }

  function draw(ctx, W, H, t, cfg, opts) {
    opts = opts || {};
    prepare(cfg);
    var th = CM.getTheme(cfg.theme);
    var L = layout(cfg, W, H);
    var st = stateAt(cfg, clamp(t, 0, cfg.duration));
    var cam = camera(cfg, st, L);

    ctx.save();
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx, W, H, th, cfg, st);

    /* world transform — bounded, so the card is always in frame */
    var o = opts.orbit || { yaw: 0, pitch: 0, roll: 0, zoom: 1 };
    var scale = cam.scale * (o.zoom || 1);
    var roll = cam.roll + (o.roll || 0);
    var dx = cam.dx + (o.yaw || 0) * L.fontSize * 5;
    var dy = cam.dy + (o.pitch || 0) * L.fontSize * 5;

    ctx.translate(W / 2, H / 2);
    if (roll) ctx.rotate(roll);
    ctx.scale(scale, scale);
    ctx.translate(-W / 2 + dx, -H / 2 + dy);

    drawPanel(ctx, L, th, cfg, st.intro);
    drawCode(ctx, L, cfg, st, th, cam.scroll);
    ctx.restore();

    /* HUD is world-independent */
    drawHud(ctx, W, H, cfg, st, th);
    return { layout: L, state: st, camera: cam };
  }

  CM.Animator = {
    prepare: prepare,
    layout: layout,
    stateAt: stateAt,
    draw: draw,
    deriveFilename: deriveFilename,
    clearMetrics: clearMetrics,
    FONT_MONO: FONT_MONO,
    FONT_UI: FONT_UI
  };
})(window.CM = window.CM || {});