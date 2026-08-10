// Placeholder file.
//
// tsc raises TS18003 ("No inputs were found") when a project's `include`
// glob matches zero files — this is a hard error, not a warning. This file
// exists only to keep tsconfig.server.json's matched-file set non-empty
// until src/platform/config.ts and real src/platform/server/** code land
// (Task 2). See ../placeholder.ts for tsconfig.app.json's counterpart —
// the two configs' includes are non-overlapping by design, so one shared
// placeholder can't satisfy both anymore.
//
// Task 2 deletes this once config.ts / storage.ts land.
export {};
