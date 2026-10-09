/* ═══════════════════════════════════════════════════════════════════════════
   Desktop Mockup & Recorder  ·  CodeMotion tool
   100% static. No framework, no bundler, no network calls except the optional
   Tailwind CDN and Google Fonts in index.html.

   Pipeline:
     zip ──▶ JSZip ──▶ blob-URL map ──▶ DOM rewrite ──▶ srcdoc iframe
                                                     └──▶ rrweb + html2canvas
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ─────────────────────────── tiny helpers ─────────────────────────── */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const MIME = {
    html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
    css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript',
    json: 'application/json', map: 'application/json', webmanifest: 'application/manifest+json',
    xml: 'application/xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
    svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
    mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime', m4v: 'video/mp4',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
    woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
    pdf: 'application/pdf', zip: 'application/zip', wasm: 'application/wasm',
    ttf2: 'font/ttf', ts: 'text/plain', tsx: 'text/plain', vue: 'text/plain', glsl: 'text/plain'
  };
  const extOf = (p) => (p.slice(p.lastIndexOf('.') + 1) || '').toLowerCase();
  const mimeOf = (p) => MIME[extOf(p)] || 'application/octet-stream';
  const isPage = (p) => /\.(x?html?)$/i.test(p);
  const humanSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB');

  /* ─────────────────────────── state ─────────────────────────── */
  const state = {
    file: null,
    strippedRoot: '',
    files: new Map(),     // root-relative path -> {path,name,dir,ext,size,blob,url}
    entry: null,
    currentPage: null,
    pageCache: new Map(), // path -> processed html
    cssCache: new Map(),  // css path -> processed css
    modCache: new Map(),  // js path -> blob url (for ES modules)
    textCache: new Map(), // path -> text
    urls: [],             // every blob url we minted, for revoke
    tree: null,
    view: { w: 1440, h: 900, z: 1 },
    capMode: 'faithful',
    pendingRender: false,
    renderSeq: 0,
  };

  const rec = {
    active: false, busy: false, stopRR: null, mr: null, chunks: [],
    canvas: null, timerId: null, watchdog: null, startedAt: 0, frames: 0,
    events: [], rrwebOk: false, videoBlob: null, mime: '', duration: 0, h2cFailed: false,
    failed: 0, failedRun: 0, lastError: '', mrStarted: false,
    track: null, manual: false, lastShot: null, stream: null,
    mode: 'stream', statsTimer: null
  };
  let player = null, rpTimer = null;

  /* ═══════════════════════════ paths ═══════════════════════════ */
  function normPath(p) { return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, ''); }

  function dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }

  function joinPath(baseDir, ref) {
    let r = String(ref).split('#')[0].split('?')[0].trim();
    if (!r) return null;
    if (/^\/\//.test(r)) return null;                       // protocol-relative
    if (/^[a-z][a-z0-9+.\-]*:/i.test(r)) return null;        // data:, blob:, http:, mailto: …
    if (r.charAt(0) === '/') r = r.slice(1);                 // site-root absolute
    else if (baseDir) r = baseDir.replace(/\/+$/, '') + '/' + r;
    const out = [];
    for (const seg of r.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return out.join('/') || null;
  }

  /* Resolve a markup reference to a file inside the zip. */
  function resolveAsset(ref, dir) {
    const p = joinPath(dir, ref);
    if (!p) return null;
    if (state.files.has(p)) return p;
    if (state.files.has(p + '/index.html')) return p + '/index.html';
    return null;
  }
  function blobOf(p) { const f = state.files.get(p); return f ? f.url : null; }
  function resolveUrl(ref, dir) { const p = resolveAsset(ref, dir); return p ? blobOf(p) : null; }
  function resolvePageRef(ref, dir) {
    const p = resolveAsset(ref, dir);
    return p && isPage(p) ? p : null;
  }

  /* ═══════════════════════════ text + blob plumbing ═══════════════════════════ */
  function makeBlobUrl(blob) { const u = URL.createObjectURL(blob); state.urls.push(u); return u; }
  function textUrl(path, text) {
    const key = 'txt:' + path;
    if (state.modCache.has(key)) return state.modCache.get(key);
    const u = makeBlobUrl(new Blob([text], { type: mimeOf(path) }));
    state.modCache.set(key, u);
    return u;
  }
  async function readText(path) {
    if (state.textCache.has(path)) return state.textCache.get(path);
    const f = state.files.get(path);
    if (!f) return '';
    const t = await f.blob.text();
    state.textCache.set(path, t);
    return t;
  }

  /* ═══════════════════════════ CSS rewriting ═══════════════════════════ */
  const CSS_URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]+))\s*\)/gi;
  const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)"|([^;'")\s]+))\s*\)?\s*([^;]*);/gi;

  function rewriteCss(css, dir, seen, depth) {
    if (!css) return '';
    seen = seen || new Set();
    depth = depth || 0;

    css = css.replace(CSS_IMPORT_RE, (m, a, b, c, tail) => {
      if (depth > 8) return '';
      const ref = (a || b || c || '').trim();
      const p = resolveAsset(ref, dir);
      if (!p || !/\.css$/i.test(p) || seen.has(p)) return '';
      seen.add(p);
      return rewriteCss(state.cssCache.get(p) || '', dirOf(p), seen, depth + 1) + (tail || '');
    });

    return css.replace(CSS_URL_RE, (m, a, b, c) => {
      const ref = String(a || b || c || '').trim();
      const u = resolveUrl(ref, dir);
      return u ? 'url("' + u + '")' : m;
    });
  }

  async function loadCss(path) {
    if (state.cssCache.has(path)) return state.cssCache.get(path);
    const raw = await readText(path);
    const out = rewriteCss(raw, dirOf(path), new Set([path]), 0);
    state.cssCache.set(path, out);
    return out;
  }

  /* ═══════════════════════════ ES module rewriting ═══════════════════════════ */
  /* Only rewrites a specifier when it actually resolves to a file in the zip,
     so strings in comments or unrelated code are left alone. */
  async function processModule(code, dir, seen, depth) {
    if (depth > 6) return code;
    seen = seen || new Set();
    const sub = async (spec) => {
      const p = resolveAsset(spec, dir);
      if (!p || !/\.(m?js|json)$/i.test(p) || seen.has(p)) return null;
      seen.add(p);
      if (/\.json$/i.test(p)) return textUrl(p, await readText(p));
      if (state.modCache.has(p)) return state.modCache.get(p);
      const body = await processModule(await readText(p), dirOf(p), seen, depth + 1);
      const u = textUrl(p, body);
      state.modCache.set(p, u);
      return u;
    };
    const rules = [
      /(\bfrom\s*)(['"])([^'"]+)\2/g,
      /(\bimport\s*\(\s*)(['"])([^'"]+)\2/g,
      /(\bimport\s+)(['"])([^'"]+)\2/g,
      /(\bexport\s*\*\s*from\s*)(['"])([^'"]+)\2/g
    ];
    for (const re of rules) {
      const specs = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(code))) specs.push({ i: m.index, len: m[0].length, pre: m[1], q: m[2], spec: m[3] });
      for (let i = specs.length - 1; i >= 0; i--) {
        const s = specs[i];
        const u = await sub(s.spec);
        if (u) code = code.slice(0, s.i) + s.pre + s.q + u + s.q + code.slice(s.i + s.len);
      }
    }
    return code;
  }

  /* ═══════════════════════════ bridge (runs inside the preview) ═══════════════════════════
     The bridge is rebuilt fresh for every page render, with the current zip's
     path -> blob-URL map baked in. It rewrites EVERY URL the page tries to load —
     not just HTML attributes (which processPage handles), but also JS-set
     `img.src = '...'`, `fetch('...')`, `new Worker('...')`, and so on. Without
     this, a page that does `new Image(); img.src = 'img/night.webp'` at runtime
     fetches the relative path against the PARENT page's URL, 404s, and any
     runtime-painted canvas stays blank. */
  function buildBridge() {
    var map = Object.create(null);
    state.files.forEach(function (f, p) { map[p] = f.url; });
    var mapJson = JSON.stringify(map);
    /* The iframe is srcdoc, so its document.baseURI borrows the parent's URL
       (e.g. /CodeMotion/tools/desktop-mockup/index.html). When the page's JS does
       new URL('img/foo', baseURI) it ends up with that full parent prefix;
       strip the parent's directory so the lookup matches our zip-relative keys. */
    var baseDir = location.pathname.replace(/[^/]*$/, '');
    var baseDirJson = JSON.stringify(baseDir);

    return '(' + function () {
      var P = window.parent;
      var CM = /*__CM__*/ null;
      var CM_BASE = /*__CM_BASE__*/ null;
      function post(type, data) {
        try { data = data || {}; data.__cm = 1; data.type = type; P.postMessage(data, '*'); } catch (e) {}
      }
      function elFrom(e) { var n = e.target; while (n && n.nodeType !== 1) n = n.parentNode; return n; }
      function closestA(n) { while (n && n.nodeType === 1) { if (n.tagName === 'A' || n.tagName === 'AREA') return n; n = n.parentNode; } return null; }

      /* Relative paths in a sandboxed srcdoc iframe resolve against the
         parent page's URL, so the browser asks the wrong origin and 404s.
         Resolve them against the zip's own path map instead. */
      var ABS = /^(?:[a-z][a-z0-9+.\-]*:|\/\/)/i;
      function resolveUrl(url) {
        if (url == null || typeof url !== 'string') return url;
        if (ABS.test(url)) return url;                       // absolute, data:, blob:, mailto:, …
        var abs;
        try { abs = new URL(url, document.baseURI || location.href).href; } catch (e) { return url; }
        var p = abs.replace(/^[a-z]+:\/\/[^/]+/i, '');
        if (CM_BASE && p.indexOf(CM_BASE) === 0) p = p.slice(CM_BASE.length);
        p = p.replace(/^\/+/, '');
        return CM[p] || CM[p.replace(/^index\.html\/?/, '')] || (CM['index.html/' + p] || url);
      }
      function resolveSrcset(value) {
        if (!value || value.indexOf('data:') === 0) return value;
        return value.split(',').map(function (part) {
          var bits = part.trim().split(/\s+/);
          if (bits[0]) bits[0] = resolveUrl(bits[0]);
          return bits.join(' ');
        }).join(', ');
      }

      /* Patch every DOM-attribute setter that loads a resource. */
      function patch(Proto, attr, transform) {
        try {
          var d = Object.getOwnPropertyDescriptor(Proto, attr);
          if (!d || !d.set || !d.configurable) return;
          Object.defineProperty(Proto, attr, {
            get: d.get, configurable: true, enumerable: d.enumerable,
            set: function (v) { d.set.call(this, transform ? transform(v) : resolveUrl(v)); }
          });
        } catch (e) {}
      }
      patch(HTMLImageElement.prototype, 'src');
      patch(HTMLImageElement.prototype, 'srcset', resolveSrcset);
      patch(HTMLSourceElement.prototype, 'src');
      patch(HTMLSourceElement.prototype, 'srcset', resolveSrcset);
      patch(HTMLMediaElement.prototype, 'src');
      patch(HTMLMediaElement.prototype, 'poster');
      patch(HTMLTrackElement.prototype, 'src');
      patch(HTMLScriptElement.prototype, 'src');
      patch(HTMLLinkElement.prototype, 'href');
      patch(HTMLAnchorElement.prototype, 'href');
      patch(HTMLEmbedElement.prototype, 'src');
      patch(HTMLIFrameElement.prototype, 'src');
      patch(HTMLObjectElement.prototype, 'data');
      patch(HTMLInputElement.prototype, 'src');
      if (typeof SVGUseElement !== 'undefined') { patch(SVGUseElement.prototype, 'href'); patch(SVGUseElement.prototype, 'xlink:href'); }
      if (typeof SVGImageElement !== 'undefined') patch(SVGImageElement.prototype, 'href');

      /* fetch / XHR / Worker / EventSource */
      try {
        var origFetch = window.fetch;
        window.fetch = function (input, init) {
          if (typeof input === 'string') return origFetch.call(this, resolveUrl(input), init);
          if (input && typeof input === 'object' && 'url' in input) {
            var r = resolveUrl(input.url);
            if (r !== input.url) { try { input = new Request(r, input); } catch (e) {} }
          }
          return origFetch.call(this, input, init);
        };
      } catch (e) {}
      try {
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
          return origOpen.apply(this, [method, resolveUrl(url)].concat([].slice.call(arguments, 2)));
        };
      } catch (e) {}
      try {
        var OrigWorker = window.Worker;
        if (OrigWorker) {
          window.Worker = function (url, opts) { return new OrigWorker(resolveUrl(url), opts); };
        }
        var OrigES = window.EventSource;
        if (OrigES) {
          window.EventSource = function (url, opts) { return new OrigES(resolveUrl(url), opts); };
        }
      } catch (e) {}

      /* Navigation patches (existing behaviour). */
      try {
        ['pushState', 'replaceState'].forEach(function (fn) {
          var orig = history[fn];
          if (!orig) return;
          history[fn] = function () {
            var r = orig.apply(this, arguments);
            post('route', { href: location.pathname + location.search + location.hash });
            return r;
          };
        });
      } catch (e) {}

      document.addEventListener('click', function (e) {
        var a = closestA(elFrom(e));
        if (!a) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (e.button && e.button !== 0)) return;
        var p = a.getAttribute('data-cm-path');
        var h = p || a.getAttribute('href');
        if (!h) return;
        if (h.charAt(0) === '#' && h.indexOf('#__cm:') !== 0) return;
        e.preventDefault();
        post('route', { href: h });
      }, true);

      document.addEventListener('submit', function (e) {
        e.preventDefault();
        post('route', { href: e.target.getAttribute('data-cm-form') || '' });
      }, true);

      window.__cm = { post: post, at: Date.now(), resolve: resolveUrl };
      window.__cmMap = CM;

      function hi() { post('ready', { title: document.title, url: location.href, scroll: [window.pageXOffset, window.pageYOffset] }); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hi); else hi();
      window.addEventListener('load', function () { post('loaded', { title: document.title }); });

      /* html2canvas's foreignObject renderer can null-deref its own clone iframe
         while tearing it down. The capture still completes correctly — the
         console just spams. Swallow exactly that and count it. */
      window.__cmIgnored = 0;
      window.addEventListener('error', function (e) {
        var m = String((e && e.message) || '');
        if (m.indexOf('scrollLeft') > -1 && m.indexOf('null') > -1) {
          e.preventDefault(); e.stopPropagation();
          window.__cmIgnored++;
          return;
        }
        post('error', { message: m });
      });
    }.toString().replace('/*__CM__*/ null', mapJson).replace('/*__CM_BASE__*/ null', baseDirJson) + ')()';
  }


  /* ═══════════════════════════ HTML rewriting ═══════════════════════════ */
  const ASSET_ATTRS = [
    ['img[src]', 'src', 'url'], ['img[longdesc]', 'longdesc', 'url'],
    ['source[src]', 'src', 'url'], ['video[src]', 'src', 'url'], ['video[poster]', 'poster', 'url'],
    ['audio[src]', 'src', 'url'], ['track[src]', 'src', 'url'], ['embed[src]', 'src', 'url'],
    ['iframe[src]', 'src', 'url'], ['object[data]', 'data', 'url'],
    ['input[type="image"][src]', 'src', 'url'],
    ['use[href]', 'href', 'url'], ['use[xlink\\:href]', 'xlink:href', 'url'],
    ['image[href]', 'href', 'url'], ['image[xlink\\:href]', 'xlink:href', 'url']
  ];
  const SRCSET_ATTRS = [['img[srcset]', 'srcset'], ['source[srcset]', 'srcset']];

  function rewriteSrcset(value, dir) {
    if (!value || value.indexOf('data:') === 0) return value;     // commas inside data URIs — leave alone
    return value.split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) return part;
      const u = resolveUrl(bits[0], dir);
      if (u) bits[0] = u;
      return bits.join(' ');
    }).join(', ');
  }

  async function processPage(path, text) {
    const dir = dirOf(path);
    const doc = new DOMParser().parseFromString(text, 'text/html');
    $$('base', doc).forEach((b) => b.remove());

    /* 1 ─ stylesheets become inline <style> so url() never loses its base */
    for (const link of $$('link[href]', doc)) {
      const rel = (link.getAttribute('rel') || '').toLowerCase();
      if (rel.indexOf('stylesheet') === -1) {
        const u = resolveUrl(link.getAttribute('href'), dir);
        if (u) link.setAttribute('href', u);
        link.removeAttribute('integrity');
        link.removeAttribute('crossorigin');
        continue;
      }
      const ref = link.getAttribute('href');
      const p = resolveAsset(ref, dir);
      const style = doc.createElement('style');
      style.setAttribute('data-cm-src', ref);
      style.textContent = p ? await loadCss(p) : '';
      link.replaceWith(style);
    }

    /* 2 ─ inline CSS */
    for (const s of $$('style', doc)) s.textContent = rewriteCss(s.textContent, dir);
    for (const el of $$('[style]', doc)) el.setAttribute('style', rewriteCss(el.getAttribute('style') || '', dir));

    /* 3 ─ media / image attributes */
    for (const [sel, attr] of ASSET_ATTRS) {
      for (const el of $$(sel, doc)) {
        const u = resolveUrl(el.getAttribute(attr), dir);
        if (u) el.setAttribute(attr, u);
      }
    }
    for (const [sel, attr] of SRCSET_ATTRS) {
      for (const el of $$(sel, doc)) el.setAttribute(attr, rewriteSrcset(el.getAttribute(attr) || '', dir));
    }

    /* 4 ─ external scripts become blob URLs (keeps type="module" + avoids </script> collisions) */
    for (const s of $$('script[src]', doc)) {
      const ref = s.getAttribute('src');
      const p = resolveAsset(ref, dir);
      s.removeAttribute('integrity');
      s.removeAttribute('crossorigin');
      if (!p) { s.removeAttribute('src'); continue; }
      const isModule = (s.getAttribute('type') || '').toLowerCase() === 'module';
      const body = isModule ? await processModule(await readText(p), dirOf(p), new Set([p]), 0) : await readText(p);
      s.setAttribute('src', textUrl(p, body));
    }

    /* 5 ─ navigation is routed through the parent, never to the network */
    for (const a of $$('a[href], area[href]', doc)) {
      const h = a.getAttribute('href');
      if (!h || h.charAt(0) === '#') continue;
      const p = resolvePageRef(h, dir);
      if (p) {
        a.setAttribute('href', '#__cm:' + p);
        a.setAttribute('data-cm-path', p);
      } else if (/^(https?:)?\/\//i.test(h) || /^(mailto|tel|sms):/i.test(h)) {
        a.setAttribute('data-cm-ext', '1');
        if (/^https?:/i.test(h) && !a.getAttribute('target')) a.setAttribute('target', '_blank');
      }
    }
    for (const f of $$('form', doc)) f.setAttribute('data-cm-form', f.getAttribute('action') || location.pathname);

    /* 6 ─ bridge, first thing in <head> so history patching happens early */
    const head = doc.head || doc.documentElement;
    const b = doc.createElement('script');
    b.setAttribute('data-cm-bridge', '1');
    b.textContent = buildBridge();
    head.insertBefore(b, head.firstChild);

    return '<!DOCTYPE html>\n<!-- CodeMotion Desktop Mockup · ' + state.file.name + ' · ' + path + ' -->\n' + doc.documentElement.outerHTML;
  }

  /* ═══════════════════════════ zip loading ═══════════════════════════ */
  function releaseUrls() {
    state.urls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (e) {} });
    state.urls = [];
  }

  function detectRoot(paths) {
    if (!paths.length) return '';
    const tops = new Set(paths.map((p) => p.split('/')[0]));
    if (tops.size === 1) {
      const t = tops.values().next().value;
      if (paths.every((p) => p.indexOf('/') > 0)) return t;   // everything lives in one folder
    }
    return '';
  }

  async function loadZip(file) {
    if (!/\.zip$/i.test(file.name) && file.type !== 'application/zip') {
      toast('That is not a .zip file.', 'bad'); return;
    }
    setStatus('busy', 'Reading ' + file.name + '…');
    try {
      const zip = await JSZip.loadAsync(file);
      releaseUrls();
      state.files.clear(); state.pageCache.clear(); state.cssCache.clear();
      state.modCache.clear(); state.textCache.clear(); state.strippedRoot = '';

      const raw = [];
      zip.forEach((rel, entry) => {
        const p = normPath(rel);
        if (!p || entry.dir) return;
        if (p.split('/')[0] === '__MACOSX' || /(^|\/)\.[^/]*$/.test(p) || p.indexOf('._') === 0) return;
        raw.push(p);
      });
      if (!raw.length) { toast('That zip is empty (or only contains hidden files).', 'bad'); setStatus('', 'Nothing to show'); return; }

      state.strippedRoot = detectRoot(raw);
      const prefix = state.strippedRoot ? state.strippedRoot + '/' : '';

      setStatus('busy', 'Unpacking ' + raw.length + ' files…');
      const batch = 24;
      for (let i = 0; i < raw.length; i += batch) {
        await Promise.all(raw.slice(i, i + batch).map(async (full) => {
          const path = full.slice(prefix.length) || full;
          if (!path) return;
          const blob = await zip.file(full).async('blob');
          const url = makeBlobUrl(blob.type ? blob : new Blob([blob], { type: mimeOf(path) }));
          state.files.set(path, {
            path, name: path.split('/').pop(), dir: dirOf(path),
            ext: extOf(path), size: blob.size, blob, url
          });
        }));
      }

      const pages = [...state.files.keys()].filter(isPage).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
      if (!pages.length) {
        toast('No .html file found inside the zip.', 'bad', 6000);
        setStatus('', 'No HTML pages in this zip');
        return;
      }
      state.entry = pages.indexOf('index.html') > -1 ? 'index.html'
        : pages.indexOf('index.htm') > -1 ? 'index.htm'
        : pages[0];

      state.file = file;
      $('#zipName').textContent = file.name + (state.strippedRoot ? '  ·  /' + state.strippedRoot : '');
      buildTree();
      fillEntrySelect(pages);
      $('#dropwrap').hidden = true;
      $('#workbench').hidden = false;
      $('#recBtn').disabled = false;

      await renderPage(state.entry);
      const note = state.strippedRoot ? ' Stripped top folder "/' + state.strippedRoot + '".' : '';
      toast(raw.length + ' files unpacked. Entry page: ' + state.entry + '.' + note, 'good', 5200);
    } catch (err) {
      console.error(err);
      toast('Could not read that zip — ' + (err && err.message ? err.message : 'corrupt file'), 'bad', 6000);
      setStatus('', 'Load failed');
    }
  }

  /* ═══════════════════════════ file tree ═══════════════════════════ */
  function buildTree() {
    const root = { name: '', dir: true, children: new Map() };
    for (const f of state.files.values()) {
      const parts = f.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!node.children.has(parts[i])) node.children.set(parts[i], { name: parts[i], dir: true, children: new Map() });
        node = node.children.get(parts[i]);
      }
      node.children.set(parts[parts.length - 1], { name: parts[parts.length - 1], dir: false, file: f });
    }
    state.tree = root;
    renderTree('');
  }

  const CARET = '<svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  const FOLDER = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
  const FILE = '<svg class="fi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';

  function renderTree(filter) {
    const host = $('#tree');
    const q = (filter || '').trim().toLowerCase();
    host.innerHTML = '';
    const ul = document.createElement('ul');
    const matches = (node) => {
      if (!q) return true;
      if (!node.dir) return node.file.path.toLowerCase().indexOf(q) > -1;
      for (const c of node.children.values()) if (matches(c)) return true;
      return false;
    };
    const walk = (node, target, depth) => {
      const kids = Array.from(node.children.values()).filter(matches).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      for (const k of kids) {
        const li = document.createElement('li');
        const row = document.createElement('div');
        row.className = 'tnode' + (k.dir ? '' : (isPage(k.file.path) ? ' is-page' : ''));
        row.setAttribute('data-path', k.dir ? '' : k.file.path);
        row.setAttribute('tabindex', '0');
        row.setAttribute('role', 'treeitem');
        if (k.dir) {
          const open = !q;
          row.innerHTML = CARET + FOLDER + '<span class="tname">' + esc(k.name) + '</span>';
          row.classList.toggle('is-closed', !open);
          const sub = document.createElement('ul');
          if (!open) sub.hidden = true;
          walk(k, sub, depth + 1);
          li.appendChild(row); li.appendChild(sub);
          row.addEventListener('click', () => { const c = row.classList.toggle('is-closed'); sub.hidden = c; });
        } else {
          const sz = k.file.size < 1024 ? k.file.size + 'B' : (k.file.size / 1024).toFixed(0) + 'KB';
          row.innerHTML = CARET.replace('<svg class="caret"', '<svg class="caret" style="visibility:hidden"') + FILE
            + '<span class="tname">' + esc(k.file.name) + '</span><span class="tsize">' + sz + '</span>';
          li.appendChild(row);
          row.addEventListener('click', () => openFile(k.file));
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFile(k.file); } });
        }
        target.appendChild(li);
      }
    };
    walk(state.tree, ul, 0);
    if (!ul.children.length) {
      const e = document.createElement('div');
      e.className = 'empty';
      e.textContent = q ? 'No file matches “' + filter + '”.' : 'This zip has no files.';
      host.appendChild(e);
      return;
    }
    host.appendChild(ul);
    markCurrent();
  }

  function markCurrent() {
    $$('#tree .tnode').forEach((n) => n.classList.toggle('is-cur', n.dataset.path === state.currentPage));
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function fillEntrySelect(pages) {
    const sel = $('#entrySel');
    sel.innerHTML = pages.map((p) => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join('');
    sel.value = state.entry;
  }

  function openFile(f) {
    if (isPage(f.path)) { renderPage(f.path); return; }
    if (/^(png|jpe?g|gif|webp|avif|bmp|svg|ico)$/i.test(f.ext)) { showImage(f); return; }
    showSource(f);
  }

  /* ═══════════════════════════ modals ═══════════════════════════ */
  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  async function showSource(f) {
    $('#srcTitle').textContent = f.path;
    $('#srcImage').hidden = true;
    $('#srcText').hidden = false;
    $('#srcText').firstElementChild.textContent = 'Loading…';
    openModal('#srcModal');
    const t = await readText(f.path);
    const clipped = t.length > 400000 ? t.slice(0, 400000) + '\n\n… [truncated, ' + t.length.toLocaleString() + ' chars total]' : t;
    $('#srcText').firstElementChild.textContent = clipped || '(empty file)';
  }

  async function showImage(f) {
    $('#srcTitle').textContent = f.path + '  ·  ' + f.ext.toUpperCase() + '  ·  ' + humanSize(f.size);
    $('#srcText').hidden = true;
    $('#srcImage').hidden = false;
    $('#srcImage').src = f.url;
    openModal('#srcModal');
  }

  /* ═══════════════════════════ rendering + routing ═══════════════════════════ */
  const frame = $('#frame');

  async function renderPage(path, opts) {
    opts = opts || {};
    if (!state.files.has(path)) { toast('“' + path + '” is not in the zip.', 'bad'); return; }
    if (rec.active) { toast('Stop the recording before navigating.', 'warn'); return; }

    setStatus('busy', 'Rendering ' + path + '…');
    state.pendingRender = true;
    state.currentPage = path;
    clearTimeout(state.renderWatch);

    let html = state.pageCache.get(path);
    if (!html) { html = await processPage(path, await readText(path)); state.pageCache.set(path, html); }
    if (opts.fresh) state.pageCache.delete(path);

    const token = ++state.renderSeq;
    /* the comment makes every srcdoc string unique so identical pages still reload */
    frame.srcdoc = html.replace('<!-- CodeMotion Desktop Mockup', '<!-- cm#' + token + ' · CodeMotion Desktop Mockup');

    state.renderWatch = setTimeout(() => { state.pendingRender = false; }, 4000);
    $('#macUrl').textContent = path;
    markCurrent();
    updateCaptureBadge();
    if (!$('#srcPane').hidden) dumpRewritten();
  }

  frame.addEventListener('load', () => {
    if (state.pendingRender) { state.pendingRender = false; return; }
    if (!state.currentPage) return;
    /* Something navigated the preview away from the zip (window.location = …,
       history.pushState, a target=_blank mishap). Put the page back. */
    toast('An outside navigation was blocked — the page was restored from the zip.', 'warn', 4200);
    renderPage(state.currentPage);
  });

  window.addEventListener('message', async (ev) => {
    const d = ev.data;
    if (!d || d.__cm !== 1) return;
    if (ev.source !== frame.contentWindow) return;
    if (d.type === 'ready' || d.type === 'loaded') {
      setStatus('ready', (d.title ? d.title + ' — ' : '') + state.currentPage);
      if (d.type === 'ready' && d.scroll) {
        try { frame.contentWindow.scrollTo(d.scroll[0], d.scroll[1]); } catch (e) {}
      }
      if (d.type === 'loaded') scheduleRemoteInline();
      return;
    }
    if (d.type === 'route') handleRoute(d.href);
    if (d.type === 'error') console.warn('[preview]', d.message);
  });

  let remoteTimer = null;
  function scheduleRemoteInline() {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(async () => {
      if (rec.active || !$('#inlineRemote').checked) return;
      if (!countRemoteAssets()) return;
      const r = await inlineRemoteAssets();
      if (rec.active) return;
      if (r.done) {
        setStatus('ready', state.currentPage + ' — ' + r.done + ' remote asset' + (r.done > 1 ? 's' : '') + ' inlined');
      }
      if (r.failed && capMode() === 'faithful') {
        /* Chromium drops a cross-origin image it cannot read instead of
           erroring, so the asset just vanishes from the recording. Say so. */
        setCapMode('faithful', '');
        $('#capNote').innerHTML = '<b>' + r.failed + ' remote asset' + (r.failed > 1 ? 's could' : ' could') +
          ' not be inlined</b> — the server blocks cross-origin reads, so ' +
          (r.failed > 1 ? 'they will be missing' : 'it will be missing') +
          ' from the recording. Self-host ' + (r.failed > 1 ? 'them' : 'it') +
          ', or serve with an <code>Access-Control-Allow-Origin</code> header.';
      }
    }, 500);
  }

  function handleRoute(href) {
    if (!href) return;
    let h = String(href);
    if (h.indexOf('#__cm:') === 0) h = h.slice(5);
    else if (h.charAt(0) === '#') return;                     // pure in-page anchor
    const dir = dirOf(state.currentPage || '');
    const p = resolvePageRef(h, dir);
    if (p) { renderPage(p); return; }
    if (/^(mailto|tel|sms):/i.test(h)) { window.open(h); return; }
    if (/^(https?:)?\/\//i.test(h)) {
      const bare = h.replace(/^https?:\/\//i, '');
      const hit = [...state.files.keys()].filter((k) => bare === k || bare.endsWith('/' + k));
      if (hit.length === 1) { renderPage(hit[0]); return; }
      toast('Blocked external link: ' + bare.split('/')[0] + ' — not part of the zip.', 'warn', 4200);
      return;
    }
    toast('No page named “' + h + '” inside the zip.', 'warn', 3800);
  }

  /* ═══════════════════════════ stage sizing ═══════════════════════════ */
  const screen = $('#screen'), screenFit = $('#screenFit'), macbook = $('#macbook'), stageScroll = $('#stageScroll');

  function applySize(w, h, z) {
    state.view = { w: Math.round(w), h: Math.round(h), z: z };
    screen.style.width = state.view.w + 'px';
    screen.style.height = state.view.h + 'px';
    screen.style.transform = 'scale(' + z + ')';
    frame.style.width = state.view.w + 'px';
    frame.style.height = state.view.h + 'px';
    screenFit.style.width = Math.round(state.view.w * z) + 'px';
    screenFit.style.height = Math.round(state.view.h * z) + 'px';
    $('#zoomVal').textContent = Math.round(z * 100) + '%';
    fitMockup();
  }

  function fitMockup() {
    const avail = (stageScroll.clientWidth || 900) - 46;
    const macW = state.view.w * state.view.z + 30;
    const f = clamp(avail / macW, 0.15, 1);
    const prev = macbook.style.transform;
    macbook.style.transform = 'none';
    const natural = macbook.offsetHeight || state.view.h;
    macbook.style.transform = f < 1 ? 'scale(' + f.toFixed(4) + ')' : prev;
    if (f >= 1) macbook.style.transform = prev === '' ? 'none' : prev;
    const visual = natural * (f < 1 ? f : 1);
    macbook.style.marginBottom = (visual - natural) + 'px';
    $('#fitReadout').textContent = state.view.w + '×' + state.view.h
      + '  ·  ' + Math.round((f < 1 ? f : 1) * state.view.z * 100) + '% on screen';
  }

  function setZoom(z) { $('#zoom').value = Math.round(z * 100); applySize(state.view.w, state.view.h, z); }

  function markPreset(w, h) {
    $$('#presetChips .chip').forEach((c) => c.classList.toggle('is-on', +c.dataset.w === w && +c.dataset.h === h));
  }

  function useSize(w, h) {
    w = clamp(Math.round(w) || 1440, 240, 3840);
    h = clamp(Math.round(h) || 900, 240, 2160);
    $('#cw').value = w; $('#ch').value = h;
    markPreset(w, h);
    applySize(w, h, state.view.z);
    if (state.currentPage) renderPage(state.currentPage);
  }

  if (window.ResizeObserver) new ResizeObserver(() => fitMockup()).observe(stageScroll);
  window.addEventListener('resize', () => { fitMockup(); fitReplay(); });

  /* ═══════════════════════════ recorder ═══════════════════════════ */
  function pickVideoMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (const m of list) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {} }
    return '';
  }

  /* The fast path: the iframe itself can hand us a MediaStream of its own
     compositor output. This is pixel-perfect (real CSS, real filters, real
     blend modes) and 30fps is trivial because there's nothing to serialise.
     The stream cannot be cross-origin, since we already allow-same-origin
     on the iframe, but cross-origin IMAGES inside the iframe are fine —
     the compositor doesn't expose raw pixels cross-origin, so the stream
     stays untainted. Safari doesn't implement this; we fall back. */
  function getIframeStream(fps) {
    try {
      if (typeof frame.captureStream === 'function') {
        const s = frame.captureStream(fps);
        if (s && s.getVideoTracks().length) return s;
      }
    } catch (e) { /* fall through */ }
    return null;
  }

  /* Update the visible capture-mode badge so the user knows which path their
     browser will take. This is what determines whether the video will be
     pixel-perfect or a lossy html2canvas rasterisation. */
  function updateCaptureBadge() {
    const el = $('#captureBadge');
    if (!el) return;
    if (typeof frame.captureStream === 'function') {
      el.className = 'capture-mode good';
      el.textContent = 'Compositor capture ready';
      el.title = 'Recording will use the browser\'s own compositor output — pixel-perfect, 30fps, no html2canvas.';
    } else {
      el.className = 'capture-mode warn';
      el.textContent = 'Canvas capture (fallback)';
      el.title = 'Your browser does not expose iframe.captureStream. Recording will go through html2canvas, which is slower and loses some modern CSS effects.';
    }
  }

  async function ensureRRwebInFrame(doc) {
    const win = frame.contentWindow;
    if (win && win.rrweb && typeof win.rrweb.record === 'function') return true;
    const url = new URL('libs/rrweb.min.js', document.baseURI).href;
    let text = null;
    try { const res = await fetch(url); if (res.ok) text = await res.text(); } catch (e) { /* file:// — fall back to <script src> */ }
    return new Promise((resolve) => {
      const s = doc.createElement('script');
      if (text) {
        /* inline scripts never fire `load`, so resolve as soon as it is parsed */
        s.textContent = text;
        (doc.body || doc.documentElement).appendChild(s);
        resolve(!!(win && win.rrweb));
      } else {
        s.src = url;
        s.onload = s.onerror = () => resolve(!!(win && win.rrweb));
        setTimeout(() => resolve(!!(win && win.rrweb)), 4000);
        (doc.body || doc.documentElement).appendChild(s);
      }
    });
  }

  /* ── capture fidelity ───────────────────────────────────────────────────
     html2canvas has two renderers.
       faithful — serialises the live DOM into an <svg><foreignObject> and lets
                  the browser rasterise it. Real CSS, so filter, mask-image,
                  mix-blend-mode, clip-path and backdrop-filter all survive.
       compat   — html2canvas's own painter. Fast and taint-proof, but it
                  silently DROPS CSS filters and masks, which turns a soft
                  blurred blob into a hard-edged disc.
     Faithful is the default. Its one weakness is that a cross-origin asset
     taints the canvas, which would break the video entirely — so we detect
     that on the first frame and fall back rather than dying. */
  function capMode() { const s = $('#capMode'); return (s && s.value) || 'faithful'; }

  function isTainted(canvas) {
    try { canvas.getContext('2d').getImageData(0, 0, 1, 1); return false; }
    catch (e) { return true; }
  }

  function setCapMode(m, why) {
    const sel = $('#capMode');
    if (sel) sel.value = m;
    state.capMode = m;
    $('#capNote').innerHTML = m === 'faithful'
      ? 'Faithful hands the real DOM to the browser, so blur, masks, blend modes and clip paths survive. It needs every asset same-origin.'
      : 'Compatible is a taint-proof fallback. It cannot render <b>filter: blur()</b>, <b>mask-image</b>, <b>mix-blend-mode</b> or <b>clip-path</b> — blurred or masked overlays will look wrong or vanish.' + (why ? ' <b>' + why + '</b>' : '');
  }

  /* Best-effort: pull cross-origin assets into blob URLs so Faithful mode does
     not taint. Runs once after a page settles, never while recording. */
  const REMOTE_RE = /^(https?:)?\/\//i;
  async function inlineRemoteAssets() {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return { done: 0, failed: 0 };
    const jobs = [];

    const tryBlob = async (url) => {
      if (!REMOTE_RE.test(url)) return null;
      const abs = new URL(url, doc.baseURI).href;
      if (abs.indexOf(location.origin) === 0) return null;      // already same-origin
      try {
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(abs, { mode: 'cors', signal: ctl.signal, credentials: 'omit' });
        clearTimeout(to);
        if (!res.ok) return null;
        const blob = await res.blob();
        if (!blob.size) return null;
        return { url: abs, href: makeBlobUrl(blob) };
      } catch (e) { return null; }                              // no CORS — leave it alone
    };

    for (const el of $$('img[src], source[src], video[poster], video[src], audio[src], input[type="image"][src]', doc)) {
      jobs.push((async () => {
        const r = await tryBlob(el.getAttribute('src') || el.getAttribute('poster') || '');
        if (r) { el.setAttribute(el.hasAttribute('src') ? 'src' : 'poster', r.href); return true; }
        return false;
      })());
    }
    for (const el of $$('[style]', doc)) {
      const v = el.getAttribute('style') || '';
      if (!REMOTE_RE.test(v)) continue;
      const urls = v.match(/url\((['"]?)(https?:)?\/\/[^)'"]+\1\)/gi) || [];
      if (!urls.length) continue;
      jobs.push((async () => {
        let out = v, any = false;
        for (const raw of urls) {
          const inner = raw.replace(/^url\(\s*['"]?/, '').replace(/['"]?\s*\)$/, '');
          const r = await tryBlob(inner);
          if (r) { out = out.split(raw).join('url("' + r.href + '")'); any = true; }
        }
        if (any) el.setAttribute('style', out);
        return any;
      })());
    }
    for (const el of $$('link[rel~="stylesheet"][href]', doc)) {
      const href = el.getAttribute('href') || '';
      if (!REMOTE_RE.test(href)) continue;
      jobs.push((async () => {
        const abs = new URL(href, doc.baseURI).href;
        try {
          const res = await fetch(abs, { mode: 'cors', credentials: 'omit' });
          if (!res.ok) return false;
          let css = await res.text();
          /* pull the CSS's own url()s and @imports in too, otherwise inlining
             the stylesheet just moves the cross-origin problem down a level */
          const nested = css.match(/url\(\s*(['"]?)(https?:)?\/\/[^)'"]+\1\s*\)|@import\s+(?:url\(\s*)?(['"])(https?:)?\/\/[^'"]+\2/gi) || [];
          for (const raw of nested) {
            const inner = (raw.replace(/^url\(\s*['"]?/, '').replace(/['"]?\s*\)$/, '')
                             .replace(/^@import\s+(?:url\(\s*)?['"]?/, '').replace(/['"]?$/, ''));
            const r = await tryBlob(inner);
            if (r) css = css.split(raw).join(raw.startsWith('@import') ? '@import url("' + r.href + '")"' : 'url("' + r.href + '")');
          }
          const st = doc.createElement('style');
          st.setAttribute('data-cm-inlined', abs);
          st.textContent = css;
          el.replaceWith(st);
          return true;
        } catch (e) { return false; }
      })());
    }
    const out = await Promise.all(jobs);
    return { done: out.filter(Boolean).length, failed: out.length - out.filter(Boolean).length };
  }

  function countRemoteAssets() {
    const doc = frame.contentDocument;
    if (!doc) return 0;
    let n = 0;
    for (const el of $$('img[src], source[src], video[poster], video[src], audio[src], link[href], [style]', doc)) {
      const v = (el.getAttribute('src') || el.getAttribute('poster') || el.getAttribute('href') || el.getAttribute('style') || '');
      if (REMOTE_RE.test(v)) n++;
    }
    return n;
  }

  async function grabFrame(ctx, w, h) {
    const doc = frame.contentDocument;
    if (!doc || !doc.documentElement || !doc.body) return;
    const win = frame.contentWindow;
    const sy = (win && win.pageYOffset) || doc.documentElement.scrollTop || 0;
    const sx = (win && win.pageXOffset) || doc.documentElement.scrollLeft || 0;
    const cv = rec.canvas;
    const faithful = capMode() === 'faithful';
    /* Render first, paint second. Clearing the canvas up front would leave it
       white for the whole (slow) capture pass, and the capture stream would
       bake those white frames into the video. drawImage overwrites atomically. */
    const shot = await html2canvas(doc.documentElement, {
      backgroundColor: '#ffffff',
      scale: cv.width / w,
      x: Math.max(0, sx), y: Math.max(0, sy),
      width: w, height: h,
      windowWidth: w, windowHeight: h,
      scrollX: 0, scrollY: 0,
      useCORS: true, allowTaint: false, logging: false, imageTimeout: 10000,
      foreignObjectRendering: faithful,
      removeContainer: true
    });
    if (faithful && isTainted(shot)) {
      throw Object.assign(new Error('cross-origin assets taint a faithful capture'), { tainted: true });
    }
    ctx.drawImage(shot, 0, 0, cv.width, cv.height);
    rec.lastShot = shot;      // held so a slow capture can repeat the last frame
  }

  function abortRecording(msg) {
    rec.active = false;
    if (rec.timerId) { clearTimeout(rec.timerId); rec.timerId = null; }
    if (rec.statsTimer) { clearInterval(rec.statsTimer); rec.statsTimer = null; }
    if (rec.stopRR) { try { rec.stopRR(); } catch (e) {} rec.stopRR = null; }
    if (rec.stream) { try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} rec.stream = null; }
    if (rec.canvas) { rec.canvas = null; rec.lastShot = null; }
    clearInterval(clockId);
    macbook.classList.remove('is-recording');
    const btn = $('#recBtn');
    btn.classList.remove('is-rec');
    btn.setAttribute('aria-pressed', 'false');
    $('#recBtnLabel').textContent = 'Record Preview';
    $('#recClock').textContent = '00:00';
    $('#recHint').textContent = 'Only the laptop screen is captured — never the sidebar or toolbar.';
    setStatus('', 'Ready to record');
    toast(msg, 'bad', 7000);
  }
  function startStreamRecording(stream, fps, w, h) {
    rec.mode = 'stream';
    rec.stream = stream;
    rec.track = null;
    rec.manual = false;
    const mime = pickVideoMime();
    const bitrate = clamp(Math.round(w * h * fps * 0.11), 2.5e6, 12e6);
    try {
      rec.mr = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate })
                    : new MediaRecorder(stream);
      rec.mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      rec.mime = rec.mr.mimeType || 'video/webm';
      rec.mrStarted = true;
      rec.mr.start(500);
    } catch (err) {
      console.error('stream mode failed:', err);
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      return false;
    }
    rec.startedAt = performance.now();
    setStatus('rec', 'Recording — interact with the page inside the MacBook');
    /* The browser does the frame production; we just keep the live counter honest. */
    rec.statsTimer = setInterval(() => {
      if (!rec.active) return;
      if (rec.rrwebOk) $('#recStats').textContent = 'Live · ' + rec.events.length + ' events';
    }, 250);
    return true;
  }
  function startCanvasRecording(fps, w, h) {
    rec.mode = 'canvas';
    const scale = parseFloat($('#capScale').value) || 1;
    const cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(w * scale));
    cv.height = Math.max(2, Math.round(h * scale));
    rec.canvas = cv;
    const ctx = cv.getContext('2d', { alpha: false });
    if (!ctx) { abortRecording('Could not create a 2D capture context.'); return; }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);

    const mime = pickVideoMime();
    try {
      let stream, manual = false, track = null;
      try {
        stream = cv.captureStream(0);
        track = stream.getVideoTracks()[0];
        manual = !!(track && typeof track.requestFrame === 'function');
      } catch (e) { stream = null; }
      if (!stream || !manual) { stream = cv.captureStream(fps); track = stream.getVideoTracks()[0] || null; }
      rec.stream = stream;
      rec.track = track;
      rec.manual = manual;
      const bitrate = clamp(Math.round(cv.width * cv.height * fps * 0.11), 2.5e6, 12e6);
      rec.mr = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate })
                    : new MediaRecorder(stream);
      rec.mr.ondataavailable = (e) => { if (e.data && e.data.size) rec.chunks.push(e.data); };
      rec.mime = rec.mr.mimeType || 'video/webm';
      rec.mrStarted = false;                                     // started on the first real frame
    } catch (err) {
      abortRecording('MediaRecorder refused to start: ' + (err && err.message ? err.message : 'unknown'));
      return;
    }

    setStatus('rec', 'Warming up the first frame…');
    const interval = 1000 / fps;
    let last = 0;
    const loop = async () => {
      if (!rec.active) return;
      const now = performance.now();
      if (!rec.busy && now - last >= interval * 0.85) {
        last = now; rec.busy = true;
        for (let attempt = 0; attempt < 2 && rec.active; attempt++) {
          try {
            await grabFrame(ctx, w, h);
            rec.frames++;
            rec.failedRun = 0;
            if (!rec.mrStarted) {
              rec.mrStarted = true;
              rec.mr.start(500);
              rec.startedAt = performance.now();
              setStatus('rec', 'Recording — interact with the page inside the MacBook');
            }
            break;
          } catch (err) {
            if (err && err.tainted) {
              setCapMode('compat', 'Switched automatically: this page pulls assets from a CDN that blocks cross-origin reads.');
              toast('A faithful capture was blocked by a cross-origin asset, so the recorder switched to Compatible mode. Blurred or masked overlays may not appear. Turn on "Inline remote assets" and reload to try again.', 'warn', 11000);
              attempt--; continue;
            }
            rec.failed++;
            rec.failedRun++;
            rec.lastError = (err && err.message) || String(err);
            if (attempt === 0) await wait(30);
          }
        }
        rec.busy = false;
        if (rec.failedRun >= 3 && !rec.h2cFailed) {
          rec.h2cFailed = true;
          console.warn('[recorder] capture failing:', rec.lastError);
          toast('Pixel capture keeps failing on this page (' + rec.lastError + '). The .json replay still works — or try turning off "Fast render mode".', 'warn', 9000);
        }
        const el = performance.now() - rec.startedAt;
        if (rec.active && el > 800) {
          $('#recStats').textContent = (rec.frames / (el / 1000)).toFixed(1) + ' fps captured'
            + (rec.failed ? ' · ' + rec.failed + ' skipped' : '');
        }
      } else if (rec.manual && rec.lastShot) {
        ctx.drawImage(rec.lastShot, 0, 0, rec.canvas.width, rec.canvas.height);
      }
      if (rec.manual) { try { rec.track.requestFrame(); } catch (e) {} }
      if (rec.active) rec.timerId = setTimeout(loop, Math.max(8, interval - (performance.now() - last)));
    };
    rec.timerId = setTimeout(loop, 0);
  }
  async function startRecording() {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) { toast('The preview is not loaded yet.', 'bad'); return; }
    if (typeof MediaRecorder === 'undefined') {
      toast('This browser cannot record (no MediaRecorder). Try Chrome, Edge or Firefox.', 'bad', 7000);
      return;
    }

    const w = state.view.w, h = state.view.h;
    const fps = clamp(parseInt($('#capFps').value, 10) || 30, 5, 60);

    rec.active = true; rec.busy = false; rec.frames = 0; rec.chunks = [];
    rec.events = []; rec.rrwebOk = false; rec.h2cFailed = false;
    rec.failed = 0; rec.failedRun = 0; rec.lastError = ''; rec.mrStarted = false;
    rec.track = null; rec.manual = false; rec.lastShot = null; rec.stream = null;
    rec.mode = 'stream';
    rec.statsTimer = null;
    rec.startedAt = performance.now();

    /* UI flips first: the setup below is async and must never look like a hang */
    const btn = $('#recBtn');
    btn.classList.add('is-rec');
    btn.setAttribute('aria-pressed', 'true');
    $('#recBtnLabel').textContent = 'Stop';
    $('#result').hidden = true;
    $('#resultEmpty').hidden = false;
    $('#recStats').textContent = '';
    $('#recHint').textContent = 'Click, scroll, hover and type inside the screen. Press R or the button to stop.';
    macbook.classList.add('is-recording');
    setStatus('rec', 'Starting the recorder…');
    tickClock();

    /* rrweb runs in the background, independent of which capture path we take */
    ensureRRwebInFrame(doc).then(() => {
      if (!rec.active) return;
      const rr = frame.contentWindow && frame.contentWindow.rrweb;
      if (rr && typeof rr.record === 'function') {
        try {
          rec.stopRR = rr.record({
            emit: (ev, isCheckout) => { if (!isCheckout) rec.events.push(ev); },
            recordCanvas: true, collectFonts: true, inlineStylesheet: true, mouseTail: false,
            sampling: { mousemove: false, scroll: 60, media: 800, input: 'last' }
          });
          rec.rrwebOk = true;
        } catch (e) { console.warn('rrweb failed', e); }
      }
      if (!rec.rrwebOk && rec.active) {
        toast('rrweb did not start — the video will still record, but Instant Replay is unavailable.', 'warn', 6000);
      }
    });

    /* Fast path: record the iframe's actual compositor output. Pixel-perfect. */
    const direct = getIframeStream(fps);
    if (direct) {
      if (startStreamRecording(direct, fps, w, h)) return;
      toast('Compositor capture failed at startup, falling back to the html2canvas path.', 'warn', 5000);
    }
    /* Fallback: html2canvas (faithful → compat) for Safari and old browsers. */
    startCanvasRecording(fps, w, h);
  }



  async function stopRecording() {
    if (!rec.active) return;
    rec.active = false;
    clearTimeout(rec.timerId); rec.timerId = null;
    clearInterval(rec.statsTimer); rec.statsTimer = null;
    clearInterval(clockId);
    if (rec.stopRR) { try { rec.stopRR(); } catch (e) {} rec.stopRR = null; }

    const dur = rec.mrStarted ? performance.now() - rec.startedAt : 0;
    const mr = rec.mr;
    rec.mr = null;
    if (mr && rec.mrStarted) {
      await new Promise((resolve) => {
        mr.onstop = resolve;
        try { mr.stop(); } catch (e) { resolve(); }
        setTimeout(resolve, 2500);
      });
    }
    if (rec.stream) { try { rec.stream.getTracks().forEach((t) => t.stop()); } catch (e) {} }
    rec.stream = null;
    rec.mrStarted = false;
    rec.duration = dur;
    rec.videoBlob = rec.chunks.length ? new Blob(rec.chunks, { type: rec.mime || 'video/webm' }) : null;
    rec.chunks = [];
    rec.canvas = null;
    rec.lastShot = null;
    rec.track = null;

    macbook.classList.remove('is-recording');
    const btn = $('#recBtn');
    btn.classList.remove('is-rec');
    btn.setAttribute('aria-pressed', 'false');
    $('#recBtnLabel').textContent = 'Record Preview';
    $('#recClock').textContent = fmt(0);
    $('#recHint').textContent = 'Only the laptop screen is captured — never the sidebar or toolbar.';

    if (!rec.videoBlob) { toast('No frames were captured. Give the page a moment, then try again.', 'bad', 6000); return; }

    const v = $('#outVideo');
    if (v.src) URL.revokeObjectURL(v.src);
    v.src = URL.createObjectURL(rec.videoBlob);
    $('#result').hidden = false;
    $('#resultEmpty').hidden = true;
    const mb = rec.videoBlob.size >= 1048576 ? (rec.videoBlob.size / 1048576).toFixed(1) + ' MB'
                                                : (rec.videoBlob.size / 1024).toFixed(0) + ' KB';
    const lines = [fmt(dur / 1000) + ' · ' + mb];
    if (rec.mode === 'canvas') lines.push(rec.frames + ' frames' + (rec.failed ? ' · ' + rec.failed + ' skipped' : ''));
    else lines.push('compositor capture');
    if (rec.rrwebOk) lines.push(rec.events.length + ' events');
    $('#recStats').textContent = lines.join(' · ');
    setStatus('ready', 'Recording ready — ' + (rec.mode === 'canvas' ? rec.frames + ' frames' : fmt(dur / 1000) + ' captured'));
    toast('Recorded ' + fmt(dur / 1000) + ' · ' + mb + ' webm'
      + (rec.failed ? ' (' + rec.failed + ' frames skipped)' : ''), 'good');
  }


  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  };
  let clockId = null;
  function tickClock() {
    clearInterval(clockId);
    clockId = setInterval(() => {
      if (!rec.active) return;
      $('#recClock').textContent = fmt((performance.now() - rec.startedAt) / 1000);
    }, 200);
  }

  /* ═══════════════════════════ downloads + discard ═══════════════════════════ */
  function download(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }
  const baseName = () => ((state.file && state.file.name) || 'site').replace(/\.zip$/i, '') + '-desktop-mockup';

  function discard() {
    if (rec.active) { stopRecording(); }
    const v = $('#outVideo');
    v.pause();
    if (v.src) { URL.revokeObjectURL(v.src); v.removeAttribute('src'); v.load(); }
    rec.videoBlob = null; rec.events = []; rec.frames = 0; rec.duration = 0;
    if (rec.statsTimer) { clearInterval(rec.statsTimer); rec.statsTimer = null; }
    closeReplay();
    $('#result').hidden = true;
    $('#resultEmpty').hidden = false;
    $('#recStats').textContent = '';
    closeModal('#replayModal');
  }

  /* ═══════════════════════════ instant replay ═══════════════════════════ */
  /* rrweb@2.0.0-alpha.4 has no getDuration()/seek()/$destroy()/on().
     It does have: play(timeOffsetMs) · pause(timeOffsetMs?) · resume(ms) ·
     getCurrentTime() (ms) · setConfig({speed, mouseTail}) · subscribe(fn) ·
     destroy(). Event names come from the exported ReplayerEvents enum, so we
     read them instead of hard-coding strings. */
  function replayDurationSec(events) {
    if (!events || events.length < 2) return 0;
    const first = events[0].timestamp, last = events[events.length - 1].timestamp;
    return Math.max(0, (last - first) / 1000);
  }

  function openReplay() {
    if (!rec.events || rec.events.length < 2) { toast('No replay events were captured.', 'bad'); return; }
    if (!window.rrweb || !window.rrweb.Replayer) { toast('The rrweb replay player is not available.', 'bad'); return; }

    const host = $('#replayStage');
    if (player) { try { player.destroy(); } catch (e) {} player = null; }
    host.innerHTML = '';

    try {
      player = new window.rrweb.Replayer(rec.events, {
        speed: parseFloat($('#rpSpeed').value) || 1,
        root: host,
        triggerFocus: false,
        skipInactive: true,
        mouseTail: $('#capMouse').checked
          ? { show: true, style: { background: 'rgba(189,147,249,.35)', border: '2px solid #bd93f9', width: 12, height: 12, borderRadius: '50%' } }
          : false
      });
    } catch (e) {
      console.error(e);
      player = null;
      toast('The replay data could not be played: ' + (e && e.message ? e.message : 'corrupt stream'), 'bad', 6000);
      return;
    }

    const RE = window.rrweb.ReplayerEvents || {};
    const btn = $('#rpPlay'), time = $('#rpTime'), seek = $('#rpSeek');
    const dur = replayDurationSec(rec.events);
    let playing = false, finished = false;

    const cur = () => {
      let ms = 0;
      try { ms = player.getCurrentTime() || 0; } catch (e) {}
      return clamp(ms / 1000, 0, dur);
    };
    const paint = () => {
      const c = finished ? dur : cur();
      seek.value = dur ? Math.round((c / dur) * 1000) : 0;
      time.textContent = c.toFixed(1) + 's / ' + dur.toFixed(1) + 's';
    };
    const setBtn = (on) => { playing = on; btn.innerHTML = on ? '&#10074;&#10074;' : '&#9654;'; };

    if (typeof player.subscribe === 'function') {
      player.subscribe((e) => {
        const k = e && (e.type !== undefined ? e.type : e.event);
        if (k === RE.Start || k === RE.Resume || k === RE.PlayBack) {
          setBtn(true);
          if (cur() >= dur - 0.05) { finished = true; setBtn(false); }
        } else if (k === RE.Pause) { setBtn(false); }
        else if (k === RE.Finish || k === RE.SkipEnd || k === RE.Destroy) { finished = true; setBtn(false); }
        paint();
      });
    }

    btn.onclick = () => {
      try {
        if (playing) { player.pause(); setBtn(false); return; }
        /* rrweb's play()/pause() take an ABSOLUTE playhead in ms — calling
           play() bare would restart the replay from zero. */
        const from = finished ? 0 : cur() * 1000;
        finished = false;
        player.play(from);
        setBtn(true);
      } catch (e) {}
    };
    seek.oninput = () => {
      const ms = (seek.value / 1000) * dur * 1000;
      try {
        if (playing) player.play(ms); else player.pause(ms);
        finished = false;
      } catch (e) {}
      paint();
    };
    $('#rpSpeed').onchange = () => {
      const sp = parseFloat($('#rpSpeed').value) || 1;
      try { player.setConfig({ speed: sp }); } catch (e) { try { player.speed = sp; } catch (e2) {} }
    };

    openModal('#replayModal');
    try { player.play(0); } catch (e) {}
    setBtn(true);
    fitReplay();
    setTimeout(fitReplay, 350);
    rpTimer = setInterval(() => {
      if ($('#replayModal').hidden) return;
      if (playing && !finished && cur() >= dur - 0.05) { finished = true; setBtn(false); }
      paint();
    }, 150);
  }

  /* scale the replayed viewport down if it is wider than the modal */
  function fitReplay() {
    const host = $('#replayStage');
    if (!host || host.hidden || !$('#replayModal') || $('#replayModal').hidden) return;
    const wrap = host.querySelector('.replayer-wrapper') || host.querySelector('iframe');
    if (!wrap) return;
    const w = wrap.offsetWidth, h = wrap.offsetHeight;
    if (!w || !h) return;
    const f = Math.min(1, (host.clientWidth - 2) / w, Math.max(160, window.innerHeight * 0.64) / h);
    wrap.style.transform = f < 1 ? 'scale(' + f.toFixed(4) + ')' : '';
    host.style.height = Math.max(170, Math.round(h * f)) + 'px';
  }

  function closeReplay() {
    clearInterval(rpTimer); rpTimer = null;
    if (player) { try { player.destroy(); } catch (e) {} player = null; }
    $('#replayStage').innerHTML = '';
    $('#replayStage').style.height = '';
  }

  /* ═══════════════════════════ toasts + status ═══════════════════════════ */
  function toast(msg, kind, ms) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' is-' + kind : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 300); }, ms || 3600);
  }

  function setStatus(kind, text) {
    const d = $('#statusDot');
    d.className = 'dot' + (kind ? ' is-' + kind : '');
    $('#statusText').textContent = text;
  }

  /* ═══════════════════════════ theme ═══════════════════════════ */
  const THEME_KEY = 'cm-mockup-theme';
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    $('#themeLabel').textContent = t === 'dark' ? 'Light' : 'Dark';
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }
  try { setTheme(localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'); } catch (e) { setTheme('dark'); }

  /* ═══════════════════════════ wiring ═══════════════════════════ */
  function onFile(f) { if (f) loadZip(f); }

  const dz = $('#dropzone');
  const fi = $('#fileInput');
  $('#browseBtn').addEventListener('click', (e) => { e.stopPropagation(); fi.click(); });
  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { onFile(fi.files[0]); fi.value = ''; });
  $('#newZipBtn').addEventListener('click', () => { fi.click(); });

  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
  dz.addEventListener('drop', (e) => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) onFile(f); });

  /* never let a stray drop navigate the whole page away */
  ['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => {
    if (e.target.closest && e.target.closest('#dropzone')) return;
    e.preventDefault();
  }));
  document.addEventListener('paste', (e) => {
    const f = e.clipboardData && e.clipboardData.files && e.clipboardData.files[0];
    if (f && /\.zip$/i.test(f.name)) onFile(f);
  });

  /* file tree */
  let treeTimer = null;
  $('#fileSearch').addEventListener('input', (e) => {
    const v = e.target.value;
    clearTimeout(treeTimer);
    treeTimer = setTimeout(() => renderTree(v), 140);
  });
  $('#entrySel').addEventListener('change', (e) => { state.entry = e.target.value; renderPage(state.entry); });

  /* sidebar tabs: file explorer ⇄ the exact rewritten markup */
  function showTab(which) {
    $$('.tab[data-tab]').forEach((t) => t.classList.toggle('is-on', t.dataset.tab === which));
    $('#filesPane').hidden = which !== 'files';
    $('#srcPane').hidden = which !== 'source';
    if (which === 'source') dumpRewritten();
  }
  function dumpRewritten() {
    const path = state.currentPage;
    const pre = $('#srcDump');
    if (!path) { pre.textContent = 'Load a zip first.'; return; }
    const html = state.pageCache.get(path);
    if (!html) { pre.textContent = 'Rendering ' + path + '…'; return; }
    $('#srcPaneTitle').textContent = path;
    const cap = 220000;
    pre.textContent = html.length > cap
      ? html.slice(0, cap) + '\n\n… [' + html.length.toLocaleString() + ' chars total]'
      : html;
  }
  $$('.tab[data-tab]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
  $('#srcCopy').addEventListener('click', async () => {
    const html = state.pageCache.get(state.currentPage) || '';
    try { await navigator.clipboard.writeText(html); toast('Rewritten markup copied.', 'good', 2200); }
    catch (e) { toast('Clipboard blocked by the browser — select the text instead.', 'warn', 3600); }
  });

  /* stage controls */
  $$('#presetChips .chip').forEach((c) => c.addEventListener('click', () => useSize(+c.dataset.w, +c.dataset.h)));
  $('#applyCustom').addEventListener('click', () => useSize(+$('#cw').value, +$('#ch').value));
  $('#cw').addEventListener('keydown', (e) => { if (e.key === 'Enter') useSize(+$('#cw').value, +$('#ch').value); });
  $('#ch').addEventListener('keydown', (e) => { if (e.key === 'Enter') useSize(+$('#cw').value, +$('#ch').value); });
  $('#zoom').addEventListener('input', (e) => setZoom(+e.target.value / 100));
  $('#fitBtn').addEventListener('click', () => {
    const avail = (stageScroll.clientWidth || 900) - 46;
    setZoom(clamp((avail - 30) / state.view.w, 0.25, 1));
  });
  $('#reloadBtn').addEventListener('click', () => {
    if (state.currentPage) { state.pageCache.delete(state.currentPage); state.textCache.delete(state.currentPage); renderPage(state.currentPage, { fresh: true }); }
  });
  $('#fsBtn').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if ($('#stage').requestFullscreen) $('#stage').requestFullscreen();
    else toast('Fullscreen is not available in this browser.', 'warn');
  });
  document.addEventListener('fullscreenchange', () => setTimeout(fitMockup, 80));

  /* recorder */
  $('#recBtn').addEventListener('click', () => (rec.active ? stopRecording() : startRecording()));
  $('#capMode').addEventListener('change', (e) => setCapMode(e.target.value, ''));
  $('#inlineRemote').addEventListener('change', () => { if ($('#inlineRemote').checked) scheduleRemoteInline(); });
  $('#dlVideo').addEventListener('click', () => {
    if (!rec.videoBlob) return;
    download(rec.videoBlob, baseName() + '.webm');
  });
  $('#dlJson').addEventListener('click', () => {
    if (!rec.events || !rec.events.length) { toast('No replay events were captured.', 'bad'); return; }
    download(new Blob([JSON.stringify(rec.events)], { type: 'application/json' }), baseName() + '-replay.json');
  });
  $('#playReplay').addEventListener('click', openReplay);
  $('#discardBtn').addEventListener('click', discard);
  $('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  /* modals */
  function closeAnyModal() {
    closeModal('#srcModal');
    const wasReplay = !$('#replayModal').hidden;
    closeModal('#replayModal');
    if (wasReplay) closeReplay();
  }
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('.modal').id;
    closeModal('#' + id);
    if (id === 'replayModal') closeReplay();
  }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeAnyModal(); return; }
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if ($('#workbench').hidden) return;
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rec.active ? stopRecording() : startRecording(); }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); $('#fsBtn').click(); }
  });

  /* ═══════════════════════════ boot ═══════════════════════════ */
  applySize(1440, 900, 1);
  setStatus('', 'Waiting for a zip…');
  $('#year').textContent = new Date().getFullYear();
  setTimeout(fitMockup, 120);
  updateCaptureBadge();
})();
