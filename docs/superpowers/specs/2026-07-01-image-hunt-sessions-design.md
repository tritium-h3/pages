# Image Hunt — Persistent Sessions

Date: 2026-07-01

Adds durable, selectable, continuable sessions to the Image Hunt page
(`/imagehunt`). Today a hunt is ephemeral: Stop or reload discards all matches.
This design persists hunts so they can be revisited and extended.

## Concept

A **session** is a persistent pool of matches. Each hunt run (Start or Continue)
supplies a *description* and *model*; those live at the **run** level, so a single
session can accumulate matches found by different prompts and/or models. Every
match records the description + model that found it, so a mixed pool stays legible.

## Persistence ownership

The backend SSE loop owns writing to storage — not the frontend. A match that is
found is saved even if the browser disconnects mid-hunt. This follows the existing
JSON-storage pattern used by `todos.ts` / `sprite-groups.ts` (read/write helpers +
an init function).

## Files

- **`src/backend/image-hunt-sessions.ts`** (new) — storage module. Exports:
  - `initSessionStorage()` — create the JSON file if absent.
  - `listSessions()` — summaries (no full match arrays) for the picker.
  - `getSession(id)` — one session with full matches.
  - `createSession(label)` — new session, returns it.
  - `appendMatch(id, match)` — push a match, touch `updatedAt`.
  - `bumpAttempts(id, attempts)` — set cumulative attempt count, touch `updatedAt`.
  - `renameSession(id, label)`.
  - `deleteSession(id)`.
  - All writes serialized through a tiny in-process mutex (chained promise) so two
    concurrent hunts cannot clobber the single JSON file. Reads tolerate a missing
    or corrupt file by returning empty, like `todos.ts`.
- **`src/backend/routes/image-hunt.ts`** (existing) — HTTP/SSE only; delegates all
  persistence to the storage module. Stays focused on request/stream handling.
- **`src/frontend/ImageHunt.tsx`** (existing) — split layout: session sidebar +
  hunt area.
- **`src/frontend/ImageHunt.css`** (existing) — styles for the sidebar and match
  captions.

## Data model — `src/backend/image-hunt-sessions.json`

```json
{
  "sessions": [
    {
      "id": "1719800000000",
      "label": "happy person",
      "createdAt": "2026-07-01T12:00:00.000Z",
      "updatedAt": "2026-07-01T12:05:00.000Z",
      "attempts": 123,
      "matches": [
        {
          "id": "1",
          "thumbUrl": "https://…",
          "pageUrl": "https://…",
          "title": "File:Example.jpg",
          "reason": "The person is smiling broadly.",
          "description": "happy person",
          "model": "qwen3-vl:30b",
          "foundAt": "2026-07-01T12:01:00.000Z"
        }
      ]
    }
  ]
}
```

- `attempts` is **cumulative** across all runs of the session.
- `label` auto-fills from the first run's description; user-editable.
- `matches` are stored newest-last in the file; the UI renders newest-first.

## Endpoints (all mounted under `/api`)

- `GET /image-hunt/sessions` — array of summaries
  `{ id, label, attempts, matchCount, createdAt, updatedAt }`, sorted by
  `updatedAt` descending. Feeds the picker.
- `GET /image-hunt/sessions/:id` — full session incl. `matches`; `404` if missing.
- `PATCH /image-hunt/sessions/:id` — body `{ label }`; renames; `404` if missing.
- `DELETE /image-hunt/sessions/:id` — deletes; `404` if missing.
- `GET /image-hunt` (SSE) — extended with an optional `sessionId` query param:
  - **With `sessionId`** (Continue): load the session; each new match is appended
    to it; `attempts` accrues onto the stored total.
  - **Without `sessionId`** (fresh): run ephemerally until the **first match**, at
    which point **lazily create** the session (label = this run's description) and
    emit a new `session` event `{ id, label }` so the client adopts it. Subsequent
    matches append as above.
  - Existing `checking` / `match` / `error` events are unchanged in shape, except
    `match` payloads now also carry `description` and `model`.
  - Attempts made before a session exists (pre-first-match) are folded into
    `attempts` when the session is created.

## Frontend behavior

### Layout
Split view: a **left sidebar** listing sessions, and the existing hunt **main
area** (controls + meter + gallery). On narrow screens the sidebar stacks above
the main area.

### Sidebar
- One row per session: label · match count · relative date.
- Click a row → load that session (see field rules below).
- Inline rename (click a pencil/label → edit → `PATCH`).
- Delete button per row (`DELETE`). Deleting the active/running session stops the
  hunt first.
- A **"New hunt"** action at the top clears the active session and gallery.

### Start vs Continue
- Button reads **Continue** when a session is active (sends its `sessionId`),
  **Start** when fresh.
- On the `session` event (fresh hunt's first match), adopt the returned `id` as
  active and refresh the sidebar list.
- Live `match` events prepend to the gallery as today; on session load the gallery
  is populated from `GET /image-hunt/sessions/:id`.

### Field-population rules (description + model inputs)
- **Fresh page load / "New hunt":** reset to defaults — empty description, default
  model `qwen3-vl:30b`. A new hunt always starts clean.
- **Resume a saved session:** pre-fill from that session's most recent run
  (description + model), editable before Continue.
- Values persist **only** when resuming an existing session; never carried into a
  new hunt.

### Match tiles
Each tile gains a small caption showing the `model` that found it, and the
`description` when it differs from the currently-active description (so a
mixed-prompt pool is readable).

## Edge cases

- Selecting a different session while a hunt runs → stop the current hunt, then
  load.
- Deleting the active/running session → stop the hunt, then delete, then clear the
  main area.
- Concurrent hunts writing the same file → serialized by the storage mutex.
- Missing/corrupt session file → treated as empty (reads never throw).
- `404` from `getSession`/`rename`/`delete` on an unknown id is surfaced to the UI
  as a non-fatal error.

## Out of scope (YAGNI)

- Pagination of the session list.
- Server-side thumbnail caching (we keep Commons `thumbUrl` as today; dead
  thumbnails are tolerated).
- Session export/import.
- Cross-device sync beyond the single shared backend JSON file.

## Testing

Per project convention for this toy page: no automated tests. Verification is
manual through the HTTPS dev proxy (curl the SSE + REST endpoints, exercise
save/select/continue/rename/delete in the browser).
