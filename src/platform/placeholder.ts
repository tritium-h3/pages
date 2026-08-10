// Placeholder file.
//
// tsc raises TS18003 ("No inputs were found") when a project's `include`
// glob matches zero files — this is a hard error, not a warning. Now that
// tsconfig.app.json's `src/**/server/**` exclude and tsconfig.server.json's
// include are non-overlapping by design (platform code splits into an
// app-visible zone and a src/platform/server/ zone, matching the
// frontend/backend slice split), a single shared placeholder can no longer
// satisfy both configs at once. This file exists only to keep
// tsconfig.app.json's matched-file set non-empty until real app-facing
// platform code lands; src/platform/server/placeholder.ts does the same
// job for tsconfig.server.json.
//
// Delete this once real app-facing files land under src/platform/.
export {};
