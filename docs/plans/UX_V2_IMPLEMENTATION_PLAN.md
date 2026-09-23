# Agent Office UX V2 — Implementation Plan

Status: approved for implementation  
Base: latest `main` after PR #43  
Implementation branch: `ux-v2-redesign`

## Goal

Rebuild the frontend experience around one principle:

> **Complex inside. Calm outside.**

The backend architecture from Blocks 1–11 remains intact. UX V2 primarily recomposes existing functionality into a simpler product surface for vibe coders.

This plan intentionally uses only **3 macro phases**. Inside each phase, work is split into small Git checkpoints so Kimi Code or another agent can stop at any moment without losing progress.

---

# Phase 1 — Foundation + Trabalho

This phase creates the new shell and the primary workspace. It must make the product usable before any secondary area is redesigned.

## 1.1 Shell V2

Replace the current 11-item navigation with:

- Trabalho
- Equipe
- Conexões
- Configurações

Add:

- compact Project Switcher;
- All Projects / New Project / Project Settings entry points;
- compact system status footer;
- System Center shell;
- responsive/collapsible sidebar;
- compatibility routing so old functionality is not deleted prematurely.

Do not delete legacy views yet. Re-home them gradually.

## 1.2 Design tokens and shared primitives

Refactor the current `App.css` foundation into semantic tokens and reusable layout primitives.

Minimum primitives:

- AppShell
- Sidebar
- ProjectSwitcher
- PageHeader
- Tabs
- Drawer / Inspector
- Status
- EmptyState
- ErrorState
- Modal
- List/Table
- Resizable split workspace where appropriate

Do not introduce a large UI framework unless it clearly reduces complexity without changing product identity.

## 1.3 Trabalho V2

Merge the functional role of the old Office + Chat workspace.

Default surface:

- conversation as primary region;
- composer always easy to find;
- compact execution status;
- Preview/Result pane only when useful;
- Inspector on demand;
- Activity/Execution drawer;
- Sala as a secondary mode.

Re-home:

- Run/Plan/Workforce state → execution drawer;
- Preview → contextual pane;
- Files/Changes/Terminal/Logs/Artifacts → contextual Inspector;
- Event Stream → Activity/Diagnostics;
- Office visualization → Sala.

## 1.4 Responsive hardening

Fix the current structural layout issues as part of the new shell, not as a later patch.

Hard requirements:

- no letter-by-letter prose wrapping;
- `min-width: 0` in shrinkable flex/grid regions;
- secondary pane becomes drawer/overlay when width is constrained;
- safe long-text behavior;
- sidebar collapse;
- 1366/1440/1920/ultrawide verification;
- 200% zoom/text expansion sanity check.

## Phase 1 done when

A user can:

1. open Agent Office;
2. switch/create a Project;
3. type a request immediately;
4. watch a simple execution summary;
5. inspect Preview/Files/Logs only when desired;
6. open Sala;
7. use the app without seeing the old technical navigation.

### Mandatory Git checkpoints inside Phase 1

These are commits, not extra phases:

- `ux: establish V2 shell and project switcher`
- `ux: build Trabalho conversation-first workspace`
- `ux: add contextual inspector activity and Sala`
- `fix: harden responsive workspace layout`

After each checkpoint: test, commit, push, update `docs/plans/UX_V2_IMPLEMENTATION_STATUS.md`.

---

# Phase 2 — Recompose the rest of the product

This phase removes the need for the old Agents/Teams/Providers/Integrations/Projects/Analytics/Orchestrator pages as standalone destinations.

## 2.1 Equipe V2

Merge Agents + Teams.

Default Agent list:

- name;
- role/purpose;
- useful state;
- minimal context.

Simplified New Agent flow:

- Nome;
- O que esse Agent deve fazer?;
- IA = Auto by default.

Agent detail tabs:

- Geral
- Inteligência
- Equipe
- Acesso
- Atividade
- Avançado

Move Team/Subagent management inside Agent → Equipe.

Keep permanent hierarchy correct:

Agent → Team → Subagents

Never introduce Agent → Agent hierarchy.

Group Tools inside Acesso instead of showing the full matrix by default.

## 2.2 Projects

Projects are accessed from Project Switcher.

Create:

- All Projects manager;
- Project detail.

Project detail tabs:

- Visão geral
- Trabalho
- Arquivos
- Histórico
- Configurações

Re-home:

- Files/Git/Artifacts → Arquivos;
- Runs/Activity/Decisions/Blockers/Workforces → Histórico;
- result + objective + current state → Visão geral;
- connections/root/status → Configurações.

## 2.3 Conexões V2

Merge Providers + Integrations.

Top-level tabs:

- IA
- Integrações

Provider detail:

- Geral
- Modelos
- Resiliência
- Diagnóstico

Models become a compact searchable/filterable list or table.

Integrations keep multiple connections and Project bindings but use simpler cards/details.

Move Browser/Computer local capability to Runtime rather than presenting them as equivalent to external accounts.

## 2.4 System Center + Settings

System Center:

- Atividade
- Uso & Custo
- Saúde
- Orquestração
- Diagnóstico

Move Analytics and Orchestrator operational history here.

Settings:

- Geral
- Runtime
- Orquestração
- Avançado

Move Principal/Fast/Deep and thresholds to Settings → Orquestração.

Move Release Preflight/migrations/raw diagnostics to Advanced/Diagnostics.

## Phase 2 done when

The user no longer needs any of these standalone pages:

- Office
- Chat
- Orchestrator
- Agents
- Teams
- Workforces
- Providers
- Integrations
- Projects
- Analytics

Their capabilities must still exist in the new structure.

### Mandatory Git checkpoints inside Phase 2

- `ux: merge Agents and Teams into Equipe V2`
- `ux: move Projects into project switcher and detail`
- `ux: merge Providers and Integrations into Conexoes V2`
- `ux: build System Center and reorganize Settings`
- `refactor: retire legacy navigation routes after parity`

After each checkpoint: test, commit, push, update status file.

---

# Phase 3 — Product polish + release gate

No new architecture should be introduced here unless a real usability blocker requires it.

## 3.1 UX consistency

Review:

- labels and Portuguese consistency;
- CTA wording;
- empty states;
- loading;
- success;
- errors;
- degraded/offline;
- approvals;
- destructive actions;
- advanced disclosures.

Remove raw backend language from default surfaces.

## 3.2 Visual consistency

Verify against `DESIGN.md`:

- typography;
- spacing;
- color usage;
- surfaces;
- borders;
- radii;
- buttons;
- focus;
- drawers/modals;
- Agent identity;
- Sala identity.

## 3.3 Accessibility/responsive pass

Required manual/automated checks where possible:

- keyboard path;
- visible focus;
- 200% zoom/text;
- long content;
- 1366;
- 1440;
- 1920;
- ultrawide;
- reduced motion;
- loading/error/offline states.

## 3.4 Remove dead UI safely

Only after parity is confirmed:

- remove obsolete legacy navigation code;
- remove unused legacy components/styles;
- keep backend/APIs intact unless clearly unused and separately proven safe.

## 3.5 Gate

Run:

- tests;
- typecheck;
- client/server build;
- deterministic benchmark;
- release preflight;
- Tauri build;
- installed runtime smoke;
- MSI verification.

Produce a new MSI only after the UX V2 gate is green.

## Phase 3 done when

A vibe coder can use the product without knowing the internal architecture and an advanced user can still reach every meaningful technical control/diagnostic.

---

# Continuity protocol — Kimi Code / ChatGPT / Claude Code

This section is mandatory.

## Source of truth

- Repository: `paulodirectresponse-jpg/Agente-Oficce`
- Stable branch: `main`
- Implementation branch: `ux-v2-redesign`
- Never use backups or stale local folders as source of truth.

## Before any work session

1. fetch the repository;
2. confirm the current implementation branch;
3. pull/rebase from the latest remote state as appropriate;
4. read:
   - `AGENTS.md`
   - `DESIGN.md`
   - `docs/plans/AGENT_OFFICE_UX_V2.md`
   - this file
   - `docs/plans/UX_V2_IMPLEMENTATION_STATUS.md`;
5. inspect recent commits before changing code.

## Persistence rule

**No meaningful UX V2 work may exist only on the local machine.**

After every coherent checkpoint:

1. run relevant tests/typecheck/build;
2. commit;
3. push to `origin/ux-v2-redesign`;
4. update `UX_V2_IMPLEMENTATION_STATUS.md`;
5. commit and push that status update.

Do not wait until an entire macro phase is finished before pushing.

## If credits/time are running low

Stop starting new work.

Immediately:

1. finish or revert the smallest in-progress change so the tree is understandable;
2. run the fastest relevant verification available;
3. update the status file with:
   - exact completed work;
   - incomplete work;
   - known bugs;
   - tests run;
   - files being worked on;
   - exact next step;
4. commit;
5. push;
6. report the remote commit SHA.

This is more important than squeezing in one extra feature.

## Branch discipline

Kimi Code must work on `ux-v2-redesign`.

Do not merge to `main` automatically.

ChatGPT/user review decides when a macro phase is ready to merge.

Avoid force-push unless explicitly authorized.

## Backend safety

UX V2 must not rewrite backend architecture merely to simplify the UI.

Preserve Blocks 1–11 invariants, especially:

- Agent != Subagent;
- no Agent → Agent hierarchy;
- Team belongs to one Agent and contains that Agent's Subagents;
- Workforce is temporary;
- Project persistence;
- approval/idempotency/tool audit;
- Provider vs Integration distinction;
- canonical Analytics accounting;
- release/migration safety.

If a frontend requirement appears to require backend change, document the dependency first and keep it as small/additive as possible.

## Definition of a good handoff

Another agent must be able to continue by reading the repository only, without needing the previous chat session.
