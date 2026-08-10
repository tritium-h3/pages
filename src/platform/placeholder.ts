// Placeholder file.
//
// tsc raises TS18003 ("No inputs were found") when a project's `include`
// glob matches zero files — this is a hard error, not a warning, even
// though nothing has moved into src/platform/ yet. This file exists only
// to give tsconfig.app.json and tsconfig.server.json at least one real
// file to check so `npm run typecheck` can pass before any code migrates.
//
// Delete this once real files land under src/platform/.
export {};
