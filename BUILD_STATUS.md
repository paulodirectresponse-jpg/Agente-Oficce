# Build Status - Agent Office (Standalone)

## Current checkpoint
- Updated: 2026-09-21
- Branch: `main`
- Evidence scope: local code, tests, typecheck, and build only unless explicitly marked otherwise.

## Phase status

| Phase | Description | Status | Evidence / blocker |
|---:|---|---|---|
| 0 | Bootstrap | DONE | Standalone config, server, client entrypoint, health route, and tests exist. |
| 1 | SQLite + Projects | DONE | WAL, migrations 1–2, project-scoped writer lock, persisted retry counters, cancellation registry, FTS triggers, and fresh-manager crash recovery test pass locally. |
| 2 | Single Conversation | DONE | Conversation and message repositories plus integration tests pass locally. |
| 3 | Adapter Framework | DONE | Adapter contract, registry, mock adapter, and integration tests pass locally. |
| 4 | Claude / Gateway | IN_PROGRESS | Configurable auth and health probe exist; real provider validation remains blocked until credentials and a reachable provider are supplied. |
| 5 | Tasks + Autonomous Loop | NOT_STARTED | Depends on bounded tool execution and persisted orchestration checkpoints. |
| 6 | Context Pack + Shared Memory | NOT_STARTED | Existing schema is present; context-pack behavior is not yet implemented and validated. |
| 7 | Kimi | NOT_STARTED | No documented provider adapter implementation in this standalone checkpoint. |
| 8 | Codex | NOT_STARTED | No documented provider adapter implementation in this standalone checkpoint. |
| 9 | Router | NOT_STARTED | No deterministic multi-provider routing implementation in this standalone checkpoint. |
| 10 | Usage | NOT_STARTED | Provider usage persistence and aggregation are not yet implemented. |
| 11 | UI Final | IN_PROGRESS | Minimal health page and Vite entrypoint build; task/project UI is not complete. |
| 12 | Office View | NOT_STARTED | Not implemented. |
| 13 | Release Gate | NOT_STARTED | Tauri packaging and release evidence are not complete. |
| 14 | Dogfooding | NOT_STARTED | No real-user validation recorded. |

## Verified local checks
- `npm test`: 8 files, 16 tests passing.
- `npm run lint`: TypeScript no-emit check passing.
- `npm run build`: client and server build passing.
- Crash recovery test: a fresh SQLite connection marks an orphan run failed, blocks the task, clears the writer lock, and permits a subsequent successful run.

## Security boundaries
- Provider configuration persists nonsecret fields in `provider_configs`; SQLite stores only `secret_ref`, never the secret value.
- `DevelopmentSecretStore` stores local development secrets outside SQLite in an ignored file with restrictive permissions.
- `SystemSecretStore` is an explicit unavailable boundary until a Tauri credential-manager implementation exists.
- Local tools constrain paths to the canonical project root, reject traversal and symlink escapes, bound file/output sizes, and use allowlisted executables without a shell.
- Destructive command forms return a denial rather than executing.

## Known blockers and next work
- Claude tool-use loop is not yet connected to `localTools`; adapter capabilities remain `tools: []` until the protocol loop is implemented and tested.
- Provider config repository and secret store need integration tests and bootstrapping into adapter creation.
- Real Claude validation is blocked only by unavailable credentials/reachable provider in this local environment.
- Kimi, Codex, routing, usage aggregation, Office View, Tauri release, and dogfooding remain unimplemented.
