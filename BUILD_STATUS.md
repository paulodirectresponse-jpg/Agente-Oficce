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
| 7 | Kimi | DONE | Kimi adapter over the official Moonshot Server API (openai_compatible) sharing the local tool layer; health, streaming, cancel, timeout covered by mocked-fetch tests. Kimi CLI/ACP upgrade path documented; real validation needs a KIMI_API_KEY. |
| 8 | Codex | DONE | codexAdapter spawns `codex exec --json` (ChatGPT-auth CLI, no paid API), maps JSONL events, cancel/timeout/prompt guards; deadlock fixed. Registry probes `codex --version` before registering. Real validation needs the CLI on PATH (auth.json exists under ~/.codex). |
| 9 | Router | DONE | Rule classifier (15 categories + risk heuristics), blueprint routing defaults, failure escalation (kimi→claude→codex), manual override @agent, Codex Protected Mode (25%/10% thresholds, unknown-quota state), team plans. 10 router tests pass. |
| 10 | Usage | DONE | UsageTracker persists run usage to usage_snapshots, per-agent 30-day aggregation, GET /agent-office/usage; no fabricated values when empty. 3 usage tests pass. |
| 11 | UI Final | DONE | SPA with workspace, tasks (run + live events polling), usage, provider settings, pt-BR, dark desktop theme, empty/loading/error states. |
| 12 | Office View | DONE | CSS-only 2D office: 3 desks (Kimi/Claude/Codex) with idle/working/blocked states derived from tasks; click desk sets manual agent override. |
| 13 | Release Gate | DONE | 83/83 tests, lint, client+server builds pass; Tauri v2 MSI built: `src-tauri/target/release/bundle/msi/Agent Office_0.1.0_x64_en-US.msi`; user README (README-USUARIO.md) written; provider setup via Settings view. |
| 14 | Dogfooding | BLOCKED_REAL_VALIDATION | Requires real provider credentials (Claude Gateway key, KIMI_API_KEY) and Codex CLI login; blocked until user supplies them. |

## Verified local checks
- `npm test`: 17 files, 83 tests passing.
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
