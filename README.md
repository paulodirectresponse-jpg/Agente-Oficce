# Agent Office

Agent Office is a local-first Windows desktop orchestration environment for AI Agents, Subagents, Teams and temporary Workforces.

The current product includes:
- Tauri desktop runtime with bundled Node backend;
- local SQLite/WAL persistence;
- Universal Providers and multiple models;
- dynamic Agents;
- permanent Teams with Subagents;
- temporary Workforces;
- Central Orchestrator with capability/gap routing;
- durable Execution Plans/DAGs, retries, replanning and recovery;
- Full Access tools with audit and approvals;
- persistent Project workspaces;
- Chat Workspace;
- Analytics;
- benchmark and release gates.

## Core hierarchy

```text
Project
  ├─ Chat / Runs
  ├─ Execution Plans
  ├─ Workforces (temporary)
  └─ Agents
       └─ Teams
            └─ Subagents
```

An Agent does not become subordinate to another Agent. Delegated workers below an Agent are Subagents. Workforces are temporary execution compositions and do not replace permanent Team structure.

## Development

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
```

## Desktop

```bash
npm run tauri:dev
npm run tauri:build
```

The production desktop gate validates Windows build, bundled backend startup, dynamic loopback health, SQLite initialization, MSI installation and clean shutdown without leaving an orphan backend process.

## Benchmark and release

The standard deterministic gate does not call paid providers:

```bash
npm run benchmark
npm run release:preflight
npm run release:gate
```

Additional release commands:

```bash
npm run benchmark:stress
npm run release:version
npm run release:manifest
```

Benchmark results and release metadata are written under:

```text
artifacts/release/
  benchmark-results.json
  preflight.json
  release-manifest.json
```

The release manifest records product version, Git SHA, migration version, benchmark/preflight result and MSI SHA-256 when an MSI is available.

## Release gates

Every PR to `main` runs the desktop gate with:
- dependency install;
- version consistency;
- unit/integration tests;
- deterministic benchmark;
- release preflight;
- typecheck;
- frontend/server build;
- Tauri/MSI build;
- bundled backend smoke;
- installed desktop lifecycle smoke;
- MSI verification;
- release diagnostics artifact.

The heavier `Agent Office Release Gate` is manual/tag-driven and additionally runs stress benchmarks plus an MSI upgrade test that installs the previous build, persists local data, upgrades to the current build, and verifies that Project/conversation/settings survive.

## Data and secrets

The application is local-first. Provider secrets are stored outside SQLite by the encrypted local secret store. Audit/log payloads must not expose secrets.

Migrations are additive and existing user data must be preserved across upgrades.

## Current version

`0.3.0`

Current detailed state is tracked in `BUILD_STATUS.md`. Architectural blueprints live under `docs/`, but code on the latest `main` is the operational source of truth.
