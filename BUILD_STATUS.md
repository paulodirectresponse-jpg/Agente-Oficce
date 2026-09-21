# Build Status - Agent Office (Standalone)

## Current checkpoint
- Updated: 2026-09-21
- Branch: `main`
- Evidence scope: local code, tests, typecheck, and build only unless explicitly marked otherwise.

## Phase status

| Phase | Description | Status | Evidence / blocker |
|---:|---|---|---|
| 0 | Bootstrap | DONE | Standalone config, server, client entrypoint, health route, and tests exist. |
| 1 | SQLite + Projects | DONE | WAL, migrations 1–3, project-scoped writer lock, persisted retry counters, cancellation registry, FTS triggers, and fresh-manager crash recovery test pass locally. |
| 2 | Single Conversation | DONE | Conversation and message repositories plus integration tests pass locally. |
| 3 | Adapter Framework | DONE | Adapter contract, registry, mock adapter, and integration tests pass locally. |
| 4 | Claude / Gateway | BLOCKED_REAL_VALIDATION | Tool-use loop fully implemented and covered by 19 deterministic mock/SSE tests; capabilities now advertise the 9 local tools. Real provider smoke test is blocked until valid Gateway credentials/base URL are supplied. |
| 5 | Tasks + Autonomous Loop | DONE | TaskOrchestrator drives runs with event persistence (dedup via event_key), retry with diagnosis up to 3 attempts, blocked on max_tool_steps/max attempts, waiting_approval on denied dangerous ops, cancelled runs idempotent. 7 orchestrator tests pass. |
| 6 | Context Pack + Shared Memory | DONE | MemoryRepository (project memory, FTS5-ranked chunks, handoffs), ContextPackBuilder with 8 sections inside token budgets, orchestrator checkpoint summaries; raw history preserved. 5 memory tests pass. |
| 7 | Kimi | NOT_STARTED | No documented provider adapter implementation in this standalone checkpoint. |
| 8 | Codex | NOT_STARTED | No documented provider adapter implementation in this standalone checkpoint. |
| 9 | Router | NOT_STARTED | No deterministic multi-provider routing implementation in this standalone checkpoint. |
| 10 | Usage | NOT_STARTED | Provider usage persistence and aggregation are not yet implemented. |
| 11 | UI Final | IN_PROGRESS | Minimal health page and Vite entrypoint build; task/project UI is not complete. |
| 12 | Office View | NOT_STARTED | Not implemented. |
| 13 | Release Gate | NOT_STARTED | Tauri packaging and release evidence are not complete. |
| 14 | Dogfooding | NOT_STARTED | No real-user validation recorded. |

## Verified local checks
- `npm test`: 13 files, 53 tests passing.
- `npm run lint`: TypeScript no-emit check passing.
- `npm run build`: client and server build passing.
- Crash recovery test: a fresh SQLite connection marks an orphan run failed, blocks the task, clears the writer lock, and permits a subsequent successful run.

## Claude tool-use loop (Phase 4 core)
- `providerProtocol.ts`: internal `ModelTurn`/`ToolRequest`/`ToolResult`/`ToolDefinition` model plus `ProviderProtocol` abstraction; `AnthropicMessagesProtocol` with a stateful SSE parser that accumulates `input_json_delta` chunks into complete tool inputs. `openai_compatible` and `custom` strategies are declared but intentionally unimplemented until needed.
- `toolLoop.ts`: provider-agnostic loop — model turn → validate tool schema/permissions → execute local tool → append tool results → next turn, until `complete`, `error`, `cancelled`, or `max_tool_steps` (default 20). Streams `delta`/`tool_start`/`tool_end` events through an async queue.
- `claudeAdapter.ts`: `startRun` now drives the tool loop with `executeLocalTool` scoped to `projectRoot`; unknown tools, invalid arguments, and denials are fed back to the model as error tool results; destructive commands produce `approval_required` + `warning` events (waiting_approval semantics, never auto-executed); run timeout yields `RUN_TIMEOUT`.
- Security verifications: path traversal, symlink escape, destructive command denial, unknown tool, invalid args, timeout, cancellation, and max-tool-steps all covered by tests.

## Security boundaries
- Provider configuration persists nonsecret fields in `provider_configs`; SQLite stores only `secret_ref`, never the secret value.
- `DevelopmentSecretStore` stores local development secrets outside SQLite in an ignored file with restrictive permissions.
- `SystemSecretStore` is an explicit unavailable boundary until a Tauri credential-manager implementation exists.
- Local tools constrain paths to the canonical project root, reject traversal and symlink escapes, bound file/output sizes, and use allowlisted executables without a shell.
- Destructive command forms return a denial rather than executing.
- `max_tool_steps` is persisted per provider config (migration 3, default 20).

## Known blockers and next work
- Real Claude validation is blocked only by unavailable credentials/reachable provider in this local environment.
- Provider config repository and secret store need bootstrapping into adapter creation (routes currently construct adapters directly).
- Phase 5: wire run lifecycle to the autonomous loop (test → retry → blocked at 3 attempts), persist orchestration checkpoints.
- Kimi, Codex, routing, usage aggregation, Office View, Tauri release, and dogfooding remain unimplemented.
