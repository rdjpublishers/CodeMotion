# CodeMotion

Turns source code into an animated video file, entirely in the browser.

```
CODE → ANIMATION TIMELINE → RENDER → VIDEO FILE → DOWNLOAD
```

There is nothing to capture. Every frame is drawn programmatically on a canvas
and encoded into a real MP4, so the downloaded file is frame-identical to what
the preview played.

---

## How the video is made

| Stage | What happens |
|---|---|
| Timeline | `js/animator.js` computes a deterministic state for any time `t` — how many characters have been typed, where the caret is, which row is active, where the camera sits. |
| Frame | `Animator.draw(ctx, W, H, t, cfg)` paints exactly one frame. The preview passes the live playback clock; the encoder passes `frame / fps`. Same function, same pixels. |
| Encode | `VideoEncoder` (WebCodecs) encodes each `VideoFrame` with an explicit timestamp. |
| Mux | `js/mp4.js` writes a progressive MP4 — `ftyp · moov · mdat` with a real sample table. |

### Why WebCodecs and not MediaRecorder

`MediaRecorder` timestamps frames with **wall-clock time**. If the machine can
only draw 15 frames per second for a 30 fps clip, the file comes out as a
30 fps slow-motion video — the duration in the filename would be a lie.

WebCodecs hands back chunks that carry their own timestamps, so a 5-second
clip is exactly 5.000 seconds no matter how long the render takes. A 5s
1080p clip renders roughly 4× faster than realtime on a normal laptop, and a
slow machine produces a *smaller* render time, never a longer video.

`MediaRecorder` + `canvas.captureStream(0)` is kept as a fallback for browsers
without WebCodecs (older Safari). That path is paced in real time by necessity.

### One muxer detail worth knowing

ISO 14496-12 describes the `avc1` sample entry's width/height as 16.16 fixed
point, but every demuxer in practice reads them as two 16-bit fields, and every
muxer writes them that way. Using the 16.16 form shifts all following fields by
four bytes and lands `avcC` on the wrong boundary — the file then fails with
"no supported streams" in every player. See the note in `js/mp4.js`.

---

## Layout

```
index.html          page shell, nav, sidebar, render bar, footer
css/styles.css      dark UI
js/themes.js        13 colour themes
js/highlight.js     tokenizer (18 languages) + per-line token buckets
js/animator.js      the deterministic frame renderer — preview and export share it
js/mp4.js           progressive MP4 muxer for WebCodecs output
js/exporter.js      encode orchestration, progress, file naming, download
js/examples.js      starter snippets
js/app.js           state machine, controls, config save/load, history
```

No build step, no bundler, no framework, no dependencies. Plain classic
scripts, so it also runs from `file://`.

---

## Deploy

Copy the whole folder to the web root as `/CodeMotion/`. Nothing to compile.

If your host does not serve `.js` as `text/javascript`, this is the only thing
that can go wrong; everything else is static.

---

## Button states

| Phase | Primary button | Download |
|---|---|---|
| Nothing generated yet | `▶ Generate Animation` | disabled |
| Rendering | `Rendering… 62%` + progress bar | previous file, if any |
| Done | `✓ Animation Ready` → `Generate New Animation` | enabled |
| Settings changed | banner: *Settings changed — Generate new animation* | previous file still downloads |

Downloading never re-renders. The blob produced by the last render is handed
straight to the browser's download flow. Up to six previous renders stay
available in the history strip until the page is reloaded.

---

## Keyboard

- `Ctrl`/`Cmd` + `Enter` — generate the animation
- `Space` — play / pause the preview
- Drag the preview — orbit · `Shift` + drag — roll · scroll — zoom
  (the manual camera eases back to the scripted path after a couple of seconds)

---

## Browser support

| Browser | Encoder | Notes |
|---|---|---|
| Chrome / Edge 94+ | WebCodecs H.264 → MP4 | exact timing, preferred |
| Chrome / Edge older | MediaRecorder → MP4 | paced in real time |
| Safari 17+ | MediaRecorder → MP4 | MP4 where supported, else WebM |
| Firefox | MediaRecorder → WebM | downloads as `.webm` |

The extension always follows the encoder the browser actually offers, so the
filename matches the file you get.