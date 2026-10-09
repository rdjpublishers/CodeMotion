# Desktop Mockup & Recorder

A CodeMotion tool. Drop a `.zip` of any static website into a MacBook mockup, interact with it,
and record **only the laptop screen** as a video.

100% static — no React, no Vite, no npm, no build step. It runs by opening `index.html` and
deploys to GitHub Pages as-is.

```
tools/desktop-mockup/
├── index.html
├── style.css
├── script.js
└── libs/
    ├── jszip.min.js        3.10.1   — unzip in the browser
    ├── rrweb.min.js        2.0.0-alpha.4 — record + replay (full bundle)
    ├── rrweb.css                    — replay cursor styling
    └── html2canvas.min.js  1.4.1    — pixel capture for the video
```

---

## Deploy to GitHub Pages

### 1. Commit the folder

```bash
cd CodeMotion
cp -r /path/to/desktop-mockup tools/
git add tools/desktop-mockup
git commit -m "Add Desktop Mockup & Recorder tool"
git push
```

> `tools/desktop-mockup/rrweb.css` is one extra file beyond the original five. The rrweb replay
> player needs it for the mouse cursor. The tool will still run without it — only the replay
> cursor styling is lost.

### 2. Turn on Pages

**Settings → Pages → Build and deployment → Source: _Deploy from a branch_**
→ branch `main`, folder `/ (root)` → **Save**.

Your tool then lives at:

```
https://rdjpublishers.github.io/CodeMotion/tools/desktop-mockup/
```

or, for a custom domain with a folder-style URL:

```
https://rdjpublishers.com/CodeMotion/tools/desktop-mockup/
```

### 3. Add it to the CodeMotion nav

In CodeMotion's `index.html`, inside the existing `<nav class="topnav">`:

```html
<a href="/tools/desktop-mockup/">
  <svg class="nav-ico" viewBox="0 0 24 24" width="14" height="14" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true">
    <rect x="2" y="4" width="20" height="14" rx="2"/>
    <path d="M8 21h8M12 18v3"/>
    <circle cx="6.5" cy="8" r="1" fill="currentColor" stroke="none"/>
  </svg>
  Desktop Mockup
</a>
```

Add this once to `css/styles.css` so the icon sits inline with the word:

```css
.topnav a { display: inline-flex; align-items: center; gap: 6px; }
.nav-ico { flex: none; }
```

If you host CodeMotion at a sub-path rather than the domain root, use a **relative** href
instead of the leading slash — `href="tools/desktop-mockup/"` — so it works from both
`file://` and any sub-directory.

### 4. Card on a tools page

```html
<a class="card" href="/tools/desktop-mockup/">
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
       stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="13" rx="2"/>
    <path d="M2 20h20"/><path d="M9 17h6"/>
    <circle cx="6.5" cy="8.5" r="1.1" fill="currentColor" stroke="none"/>
  </svg>
  <h3>Desktop Mockup</h3>
  <p>Zip a site, preview it in a MacBook, record the screen as a video.</p>
</a>
```

---

## How to use it

1. **Zip the whole site.** `index.html`, every folder, CSS, fonts and images. A single top-level
   folder (`mysite/`) is fine — it is detected and stripped automatically.
2. **Drop the zip** on the dropzone, or click *Browse files*, or paste it with `Ctrl`/`Cmd`+`V`.
3. **Pick a resolution** — 1920×1080, 1440×900, 1280×720, 1024×768, or type your own.
4. **Interact with the page** inside the MacBook: click, scroll, hover, type. Links load the next
   page *from the zip*, never from the internet.
5. **Hit `● Record Preview`** (or press `R`). Interact as you would. Press `R` again to stop.
6. **Export** — Download Video (`.webm`), Replay Data (`.json`), or Instant Replay.

Keyboard: `R` start/stop · `F` fullscreen · `Esc` close a dialog.

---

## What gets recorded

Two independent streams, both captured from **inside the preview iframe only** — the sidebar,
toolbar and mockup frame are never in the output.

| Output | Engine | Good for |
|---|---|---|
| `.webm` | `html2canvas` → `canvas.captureStream()` → `MediaRecorder` | Social posts, previews, anything that has to be a video |
| `.json` | `rrweb` DOM event log | Lossless text, any playback speed, small files |
| Instant Replay | `rrweb.Replayer` | Scrub, pause, 0.5×–4× speed — no re-render |

The video is a true real-time recording: a 3-second interaction produces a 3-second video, not a
sped-up clip. The live `fps captured` readout tells you the real capture rate — roughly 4–5 fps
at 1024×768, dropping at 1920×1080.

## Capture fidelity — read this if overlays vanish from your video

### The path your recording takes

A badge in the recorder sidebar tells you which of these will run, before you hit Record:

| Path | When it runs | What you get |
|---|---|---|
| **Compositor capture** (default in Chrome and Firefox) | `HTMLIFrameElement.captureStream(fps)` exists on the iframe | The browser's own compositor output as a `MediaStream` → `MediaRecorder`. Pixel-perfect. Real `filter`, real `mask-image`, real blend modes, real `clip-path`. 30fps is easy because there is nothing to serialise. |
| **Canvas capture** (Safari and old browsers) | `captureStream` is missing | A hidden canvas, html2canvas at the chosen renderer, `canvas.captureStream`, `MediaRecorder`. Slower and lossy. |

The compositor path exists because it is the *only* way to get a video that matches
what you see: the real browser painting the real DOM, captured by the real compositor.
No serialisation step, no lossy rasteriser, no CSS features missing.

If the badge says **Compositor capture ready**, a `filter: blur(38px)` overlay will
fade smoothly in the video, a `mask-image` radial will keep its soft edge, a
`mix-blend-mode` will blend. That is a guarantee, not a hope.

### The canvas path (when compositor isn't available)

html2canvas has two renderers, and the default one **silently drops modern CSS**:

| Renderer | How it works | Result |
|---|---|---|
| **Faithful** | Serialises the live DOM into an `<svg><foreignObject>` and lets the *browser* rasterise it | Real CSS. `filter`, `mask-image`, `mix-blend-mode`, `clip-path`, `backdrop-filter` all survive |
| **Compatible** | html2canvas's own painter | Fast and taint-proof, but drops the effects above |

Measured against the browser's own painting of the same frame at 1024×768
(percentage of pixels that differ):

| region | Compatible | Faithful |
|---|---|---|
| `filter: blur()` overlay | 24.9% wrong | **0%** |
| `mix-blend-mode` | 22.5% wrong | **0%** |
| `mask-image` | 24.0% wrong | 0.5% |
| `clip-path` | 28.8% wrong | 7% |
| **whole frame** | **12.4%** | **1.3%** |

Faithful is the default. Compatible stays available as a taint-proof fallback.

### Cross-origin assets

Faithful needs every asset **same-origin**. A cross-origin asset the browser cannot
read either taints the canvas or is dropped from the capture.

- **Tainted** → the recorder detects it on the first frame, switches itself to
  Compatible, finishes the recording, and tells you which effects you are losing.
  It never dies mid-take.
- **Dropped** (what Chromium does with a non-CORS image) → the asset is simply
  missing from the video, and the Capture note says so by name.

**Inline remote assets** (on by default) re-fetches the page's `http(s)` images,
stylesheets, `@import`s and `url()`s as blobs after each page settles. It only works
when the CDN sends `Access-Control-Allow-Origin`; if it cannot, self-host the asset
or add the header.

### Tuning

- **Resolution `0.5×`** — halves the pixels; roughly 4× faster. Use it for big presets.
- **Frame rate** — 10 / 15 / 30 fps. Higher costs more CPU; the timing stays correct either way.
- In the canvas path, Faithful and Compatible cost about the same per frame (~4–5 fps at 1024×768
  on a mid laptop). In the compositor path, the bottleneck is the page itself — 30fps is the norm.
- If a frame fails, it is retried once and then repeats the previous image. You only get
  a warning if the page is genuinely uncapturable.

## Instant Replay — and what it cannot replay

The Instant Replay is a **DOM event log** (rrweb). It records every click, input
change, scroll, and DOM mutation, then re-runs them. It is lossless for *content*
and *interactions*: text changes, image swaps, form state, scroll position, cursor
movements are exact.

It is **stepped for smooth CSS animations**. A `@keyframes` blur that eases in over
half a second will appear as a series of snapshot frames in the replay, not as a
smooth motion. This is a fundamental limit of DOM-based replay — rrweb does not
record animation timing, only the DOM state at each moment.

The webm is the canonical recording; the Instant Replay is a re-run of what the
DOM *did*. Use the webm for animations, the Replay for inspection and scrubbing.

### Replay controls

- Space / `▶` button: play / pause
- Drag the seek bar to jump
- Speed: 0.5×, 1×, 2×, 4×

---

## How the preview stays self-contained

`script.js` unzips into memory, gives every file a `URL.createObjectURL`, then rewrites the entry
page before it ever reaches the iframe:

- `<link rel=stylesheet>` → read, rewritten, and inlined as a `<style>` (a blob-URL stylesheet
  could not resolve its own `url()` references)
- `url(...)` inside CSS, `@import "…"` chains, `<style>` blocks and `style="…"` attributes
- `<script src>` → re-served as a blob; `type="module"` imports/exports are rewritten too, so a
  local `./helper.js` still resolves
- `<img> <video> <audio> <source> <track> <embed> <iframe> <object>` + `srcset` and `poster`
- `/style.css`, `./assets/img.png` and `../css/app.css` all resolve against the zip root
- `<a href>` to a page inside the zip becomes an internal route; external links get
  `target="_blank"` and are flagged
- A small bridge script is injected first, which patches `history.pushState`/`replaceState` and
  traps clicks and form submits so navigation always comes back to the parent
- If the page ever tries to navigate off-origin, the `load` handler restores the zip page

### What the bridge also rewrites (so runtime-painted canvases work)

HTML attributes are only the *first* place a page asks for a resource. A page can
also do `new Image(); img.src = 'img/foo.webp'` at runtime, or call `fetch('data.json')`,
or spawn `new Worker('worker.js')`. A srcdoc iframe resolves those relative paths
against the **parent** page's URL — so `'img/foo.webp'` becomes
`https://your-site/CodeMotion/tools/desktop-mockup/img/foo.webp` and 404s, even
though the file is right there in the zip.

The bridge ships the zip's full `path → blob URL` map into the iframe (with the
parent's path prefix stripped) and patches every runtime entry point:

- `src` / `srcset` / `href` setters on `<img>`, `<source>`, `<video>`, `<audio>`,
  `<track>`, `<script>`, `<link>`, `<a>`, `<embed>`, `<iframe>`, `<object>`,
  `<input type=image>`, `<svg:use>`, `<svg:image>`
- `window.fetch` and `XMLHttpRequest.prototype.open`
- `new Worker(url)` and `new EventSource(url)`

So a page that paints a canvas from a `new Image()` whose `src` is set in JavaScript
now loads it from the zip, and a runtime-painted reveal / hydration / animation
behaves the same in the preview as it does in production.

The **Rewritten HTML** tab in the left sidebar shows the exact markup the iframe receives — handy
when a path does not resolve.

---

## Browser support

| | Preview | Record | Replay |
|---|---|---|---|
| Chrome / Edge | ✅ | ✅ | ✅ |
| Firefox | ✅ | ✅ | ✅ |
| Safari | ✅ | ⚠️ limited | ✅ |

Recording needs `MediaRecorder` + `HTMLCanvasElement.captureStream`. Safari does not implement
`captureStream`, so recording is unavailable there — preview and Instant Replay still work. The
tool detects this and says so instead of failing silently.

Recording is **video only**. Audio playing inside the preview is not captured, because a canvas
capture stream has no audio track and browsers do not expose a page's output for taping.

---

## Notes

- Nothing is uploaded. Everything happens in the page; the "100% local" pill in the header is
  literal. The only outbound requests are the optional Tailwind CDN and Google Fonts links.
- Works offline-ish: layout, mockup and all logic live in `style.css` / `script.js`. If the CDN is
  blocked the page still looks and behaves correctly (Tailwind preflight is disabled on purpose).
- Works from `file://` too — opening `index.html` directly unzips, previews and records.
- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups allow-modals
  allow-pointer-lock`). `allow-same-origin` is required so the parent can rewrite and record the
  document; do not use this tool to preview untrusted zips on a shared machine.
- Tailwind preflight is turned off so it cannot fight `style.css`. The theme is driven by the CSS
  variables at the top of `style.css`, copied 1:1 from CodeMotion's own tokens, plus an optional
  light theme under `html[data-theme="light"]`.
