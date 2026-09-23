# Agent Office UX V2 — Implementation Status

This file is the continuity handoff for Kimi Code, ChatGPT, Claude Code or any other implementation agent.

Update it **before every work session ends**.

## Current state

- Overall: PHASE 1 IN PROGRESS
- Current macro phase: Phase 1 — Foundation + Trabalho
- Current checkpoint: 1.1 Shell V2 (done) → next 1.2 design tokens/primitives, then 1.3 Trabalho V2
- Implementation branch: `ux-v2-redesign`
- Baseline from main: `c153ea4e61b3456ef18c435afaa83a360bb14fca`
- Last implementation checkpoint: `ux: establish V2 shell and project switcher` (see handoff below)
- Blocked: no
- Stable backend baseline: Agent Office 0.4.0 / Blocks 1–11

## Completed

- UX audit of every existing primary surface.
- UX V2 information architecture approved.
- Calm Control Room visual direction approved.
- Repository-local UX/design skills installed.
- Root `DESIGN.md` approved contract created.
- 3-phase implementation plan created.
- Shell V2 (checkpoint 1.1): primary nav reduced to Trabalho / Equipe / Conexões / Configurações; compact Project Switcher dropdown (switch, Novo projeto, Todos os projetos, Configurações do projeto); compact system status footer opening System Center; System Center shell with Atividade / Uso & Custo / Saúde / Orquestração / Diagnóstico; legacy views kept reachable via quiet "Áreas antigas" disclosure group in sidebar (compatibility routing, nothing deleted).

## In progress

Next: checkpoint 1.2 (design tokens + shared primitives: AppShell, PageHeader, Tabs, Drawer, EmptyState, Status, Modal, List) and 1.3 (Trabalho V2 conversation-first workspace merging Office + DevChat, execution summary, Inspector, Sala mode).

## Next exact action

Continue Phase 1 on `ux-v2-redesign`:

1. extract design tokens from `App.css` Experience V2 variables into a documented token set (checkpoint 1.2);
2. build shared primitives under `src/agent-office/shell/` or `src/agent-office/components/`;
3. build Trabalho V2 (checkpoint 1.3): conversation-first layout with composer, compact execution status, contextual Preview/Inspector, Sala secondary mode;
4. keep old OfficeView/DevChatView reachable until parity;
5. verify typecheck/build/tests; commit and push each checkpoint.

## Known UX defects to eliminate

- excessive primary navigation;
- duplicate Office/Chat concepts;
- Orchestrator exposed as primary user destination;
- Agents page too long and technically dense;
- Teams page separate from Agent ownership;
- Workforces shown as a standalone administrative concept;
- Providers and Integrations fragmented;
- Projects overloaded with technical tabs;
- Analytics exposes data-quality internals by default;
- Settings mixes normal preferences and release diagnostics;
- Chat layout can collapse normal text letter-by-letter;
- permanent empty panes consume workspace;
- Event Stream occupies permanent screen space;
- too many cards/borders/badges;
- backend terminology appears before user-facing outcomes.

## Verification log

Add entries newest first.

### 2026-09-23 — Kimi Code (checkpoint 1.1: Shell V2 + Project Switcher)

- tests: `npm test` → 45 files / 249 tests passed
- typecheck: `npm run lint` (tsc --noEmit) → clean
- build: `npm run build` (vite client + tsc server) → clean
- runtime code changed: frontend shell only (`src/agent-office/AgentOfficeApp.tsx`, new `src/agent-office/shell/*`, `App.css` new "UX V2 Shell" section); backend untouched
- legacy views preserved via "Áreas antigas" group; no functionality deleted

### Planning baseline

- tests: not rerun; planning/documentation only
- runtime code changed: no
- docs/skills changed: yes
- implementation not started

---

## Handoff template

Copy this section and fill it whenever stopping:

### YYYY-MM-DD HH:MM — <agent>

**Remote commit**
`<sha>`

**Completed**
- ...

**In progress**
- ...

**Known issue / blocker**
- none / ...

**Verification**
- `npm test ...`
- `npm run lint ...`
- `npm run build ...`

**Files most relevant**
- ...

**Next exact action**
1. ...

**Do not redo**
- ...
