# Image Hunt — Design Spec

**Date:** 2026-06-29
**Status:** Approved (design); ready for implementation planning

## Overview

A new page, **Image Hunt** (`/imagehunt`), where the user types an arbitrary
description (e.g. "circle orientation", "happy person"), presses **Start**, and
the backend continuously pulls random Wikimedia Commons images and asks a local
vision model whether each one matches the description. Matching images stream
into a gallery. The hunt runs until the user presses **Stop** or navigates away.

This is a toy/hobby page consistent with the other mostly-disconnected pages in
this project. **No automated tests** (deliberate decision — see Non-Goals).

## User experience

1. User opens `/imagehunt` from the app menu.
2. User types a description and presses **Start**.
3. A progress meter shows live counts: `Checked: N · Matches: M`, plus a
   "checking…" status line naming the current candidate.
4. As matches are found, thumbnails append to a gallery. Each tile links to the
   Commons file page (`target=_blank`) and shows the model's one-line reason as a
   caption/tooltip.
5. The hunt continues indefinitely until the user presses **Stop** or leaves the
   page. Stopping leaves the accumulated matches on screen.

## Architecture

The scan loop is inherently server-side (the backend fetches each image and runs
the Ollama vision model). Results stream to the page over **Server-Sent Events**,
reusing the pattern already established in `src/backend/routes/wikipedia-story.ts`.
Stopping is achieved by the client closing the `EventSource`; the backend detects
the disconnect and halts the loop. No bidirectional channel is needed.

```
ImageHunt.tsx ──GET /api/image-hunt?description=…──▶ image-hunt.ts (SSE)
     ▲                                                    │
     │  match / checking / error events                   │ loop:
     └────────────────────────────────────────────────────┤  1. random Commons file
        Stop = close EventSource ──▶ req 'close' ──▶ stop  │  2. skip non-images
                                                           │  3. fetch 768px thumb → base64
                                                           │  4. qwen3-vl judge {match,reason}
                                                           │  5. emit checking / match
```

## Components

### Backend route — `src/backend/routes/image-hunt.ts` (new)

- **Endpoint:** `GET /api/image-hunt?description=…`, responds as `text/event-stream`.
- Mounted under `/api` in `src/backend/index.ts` (`app.use('/api', imageHuntRouter)`).
- **Loop**, until the request closes:
  1. Fetch one random file from Commons:
     `https://commons.wikimedia.org/w/api.php?action=query&generator=random&grnnamespace=6&grnlimit=1&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=768&format=json`
     (namespace 6 = File).
  2. If `imageinfo.mime` is not `image/*` (audio/video/PDF/etc.), increment the
     attempt counter, emit a `checking` tick, and continue without judging.
  3. Download the **scaled 768px thumbnail** (`iiurlwidth` thumburl), not the
     full-res original — faster and smaller. Base64-encode it.
  4. Ask Ollama to judge it (see "Vision judgment" below).
  5. Emit a `checking` event (running `attempts` count + current `title`). If the
     verdict is `match: true`, also emit a `match` event.
- **Stop semantics:** a `closed` flag set by `req.on('close')` is checked each
  iteration; closing the `EventSource` (Stop button or component unmount) ends the
  loop server-side, preventing a zombie loop. The loop runs **sequentially** (one
  image at a time) — natural pacing given the model is the slow step.

**SSE events:**
- `checking` — `{ attempts: number, title: string }`
- `match` — `{ id: string, thumbUrl: string, pageUrl: string, title: string, reason: string }`
- `error` — `{ message: string }` (terminal only; transient errors are skipped)

### Vision judgment

- Model: `qwen3-vl:30b`, `keep_alive: '60m'` (keep it resident across iterations).
- Request uses `format: 'json'` and an image. Prompt asks for a strict JSON object:
  `{ "match": boolean, "reason": string }` — does the image match the user's
  description? `reason` is one short sentence.
- If the model returns non-JSON or unparseable output, treat it as **no match**
  and continue (logged, not fatal).

### Ollama client change — `src/backend/ollama.ts`

The client has no image support today. Minimal, backward-compatible additions to
`OllamaGenerateRequest`:
- `images?: string[]` — base64-encoded images, passed straight through to
  `/api/generate`.
- `format?: 'json'` — passed straight through.

Existing callers are unaffected (both fields optional). The judgment uses the
existing non-streaming `generate()` method.

### Frontend page — `src/frontend/ImageHunt.tsx` (new)

- Registered in `src/frontend/App.jsx`: a `pathname === '/imagehunt'` branch plus a
  menu button (following the existing per-page pattern).
- UI: a description `<input>`, a **Start/Stop** toggle button, a progress meter
  (`Checked: N · Matches: M`) with a "checking…" status line, and a Tailwind grid
  of match tiles.
- Opens `new EventSource(apiUrl('/image-hunt?description=' + encodeURIComponent(d)))`
  — a relative URL via `backendApi.ts`, so it rides the Vite `/api` proxy and works
  over HTTPS.
- `checking` → update `attempts` and status line. `match` → append a tile
  (thumbnail linking to `pageUrl`, `reason` as caption/tooltip). `error` → show a
  message and stop.
- The `EventSource` is held in a ref and closed on **Stop** and on **component
  unmount** (covers "browse away").
- Styling in `src/frontend/ImageHunt.css` (consistent with sibling pages that ship
  a co-located CSS file).

## Data flow

1. User submits description → page opens the `EventSource`.
2. Backend loops, emitting `checking` every candidate and `match` on hits.
3. Page updates the meter on every `checking`, appends a tile on every `match`.
4. Stop / navigate away → page closes the `EventSource` → backend `req 'close'` →
   loop ends.

## Error handling

- **Transient and skipped (loop continues):** Commons fetch failure, non-image
  mime type, thumbnail download failure, model returns non-JSON. All logged
  server-side; the hunt keeps going rather than dying.
- **Terminal (emit `error`, end stream):** Ollama unreachable / hard failure.
- Frontend surfaces a terminal `error` in the status line and flips back to the
  stopped state.

## Progress meter

The meter reflects **attempts** (every random Commons file pulled, including
skipped non-images) and **matches** (tiles in the gallery). `attempts` is authored
server-side and carried on each `checking` event so the count is accurate even
across skips; `matches` is derived client-side from the number of `match` events.

## Non-goals (YAGNI)

- No automated tests (deliberate — toy project).
- No persistence: matches are in-memory for the session and lost on reload/leave.
- No selectable model, threshold slider, pause/resume, or mid-stream description
  change (the SSE design can be upgraded to WebSocket later if these are wanted).
- No photo/diagram filtering beyond the `image/*` mime check.

## Out-of-band cleanup (not part of this feature)

`CLAUDE.md` currently lists the Ollama port as `11343`; the real port (per
`src/backend/ollama.ts`) is `11434`. This was inherited from the former
`copilot-instructions.md` and should be corrected.
