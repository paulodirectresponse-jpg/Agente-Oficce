# Agent Office UX V2 — Product & Information Architecture Plan

Status: proposal for approval  
Base: Agent Office 0.4.0 / Blocks 1–11 complete  
Primary audience: vibe coders and builders who should not need infrastructure expertise to use the product.

## North Star

> **Complex inside. Calm outside.**

The Agent Office backend remains deeply capable. The default frontend exposes only what the user needs to understand the current project, ask for work, see progress, approve consequential actions and inspect results.

The user should be able to open a Project and start working without understanding Orchestrator levels, Gap Analysis, Workforces, capability scores, provider circuits, migrations or Tool Registry internals.

## Experience goals

1. A new user understands the primary action in under 10 seconds.
2. The main path is conversation-first: ask → watch → inspect result → refine.
3. System complexity appears progressively, not permanently.
4. Every technical detail remains reachable for advanced/debug use.
5. Agent Office remains recognizably Agent Office; it does not visually clone Lovable, Codex, Replit, Bolt or v0.
6. The Office/Sala metaphor remains a unique secondary visualization, not a requirement for using the product.
7. No supported desktop width may collapse normal text letter-by-letter.

---

## 1. Global information architecture

### Primary shell

The permanent sidebar is reduced to **three product destinations plus Settings**:

- **Trabalho** — the main conversation and execution workspace.
- **Equipe** — Agents and their permanent Subagent Teams.
- **Conexões** — AI Providers and external Integrations.
- **Configurações** — product and advanced system configuration.

Projects are not a permanent sidebar destination. The active Project lives in the Project Switcher at the top of the shell.

Monitoring is not a permanent sidebar destination. Operational detail lives in the contextual Activity Center and Project history. Deep analytics lives under System/Usage.

### Project switcher

At the top of the sidebar:

```text
App teste2  ▾
```

Dropdown actions:

- switch Project;
- New Project;
- All Projects;
- Project settings.

Selecting **All Projects** opens Project Manager as a full surface.

### Footer

Replace the large Local Engine card with:

```text
● Sistema online
Agent Office 0.4
```

Clicking it opens **System Center**, containing:

- Activity;
- Usage & Cost;
- Runtime health;
- Diagnostics;
- Orchestration diagnostics.

This is where Analytics and technical monitoring move.

---

## 2. Progressive-disclosure model

### Always visible

Only information needed to act now:

- active Project;
- current conversation;
- primary composer;
- current high-level state: Ready / Working / Waiting for approval / Needs attention / Done;
- preview/result when one exists;
- one clear primary action per state.

### Contextual — appears only when relevant

- active Agent(s);
- current step/progress;
- approvals;
- failed task/retry;
- changed files count;
- preview status;
- current Workforce summary;
- connection/auth problem.

### On demand

Opened through Inspector, Details, Activity or the selected object:

- Files;
- Code changes;
- Terminal;
- Logs;
- Artifacts;
- run timeline;
- Agent performance;
- model/provider used;
- Workforce composition;
- tool calls;
- routing decision;
- token/cost detail.

### Advanced only

Never shown in the default work path:

- Principal/Fast/Deep configuration;
- confidence thresholds;
- Gap Analysis;
- circuit breaker;
- fallback chain internals;
- raw capability matrix;
- individual Tool policies;
- idempotency;
- migrations;
- Release Preflight;
- raw audit/event streams;
- provider protocol configuration.

---

## 3. Trabalho — the core product surface

This replaces the old Office + Chat experience.

### Default layout

```text
┌──────────────────────────────────────────────────────────────┐
│ App teste2                Ready       Activity ○      Sala ◇ │
├───────────────────────────────┬──────────────────────────────┤
│                               │                              │
│          CONVERSA             │      PREVIEW / RESULT        │
│                               │                              │
│  user                         │  Shown only when useful.     │
│  agent                        │                              │
│  execution summary           │                              │
│                               │                              │
│                               │                              │
├───────────────────────────────┴──────────────────────────────┤
│  Peça algo ao Agent Office...                    [ Enviar ] │
└──────────────────────────────────────────────────────────────┘
```

Rules:

- When no preview/result exists, Conversation uses the full width.
- When a preview exists, the workspace becomes split view.
- User can resize or close the secondary pane.
- The old permanent left Run/Plan/Workforce/History column disappears.
- The old permanent right multi-tab workbench disappears until requested.

### Execution summary

When work is happening, show one compact inline object:

```text
● Construindo · Builder + 2 especialistas · 3 de 5 etapas
  Ver execução
```

Clicking **Ver execução** opens the Activity/Execution drawer.

Do not expose `fast`, `deep`, `needs_gap_analysis`, routing confidence or internal run IDs here.

### Inspector

A contextual right drawer/pane. Tabs exist only when data exists:

- Preview
- Files
- Changes
- Terminal
- Logs
- Artifacts

Default behavior:

- Preview opens automatically after a runnable visual result exists.
- Files/Changes become available after file operations occur.
- Terminal and Logs stay closed unless selected or an error needs them.
- Empty tabs are not shown.

### Sala

The old Office remains as a unique Agent Office feature.

It becomes a secondary mode/button inside Trabalho:

```text
[ Conversa ]  [ Sala ]
```

Sala shows Agent desks/status and live handoffs. It is a visualization of execution, not a separate workflow.

### Event Stream

No permanent Event Stream column.

Events go to:

- compact current progress in Trabalho;
- Activity drawer for normal users;
- raw Events inside System Center → Diagnostics.

---

## 4. Equipe — Agents + permanent Teams

The old Agents and Teams pages merge.

### Default view

Simple Agent list/cards:

```text
Equipe                                      + Novo Agent

Builder          Desenvolvedor               Trabalhando
Kimi             Executor                    Precisa configurar
Claude           Reviewer                    Disponível
Codex            Architect                   Disponível
```

Default card shows only:

- Agent name;
- role;
- useful status;
- optional one-line purpose.

Provider/model, metrics and capabilities are secondary.

### New Agent

The default creation flow asks only:

1. **Nome**
2. **O que esse Agent deve fazer?**
3. **IA** — default: Auto

Everything else is inferred or receives a safe default.

After creation, the user can refine advanced settings.

### Agent detail

Tabs:

- **Geral**
- **Inteligência**
- **Equipe**
- **Acesso**
- **Atividade**
- **Avançado**

#### Geral

- name;
- role/purpose;
- enabled state;
- high-level status;
- small performance summary.

#### Inteligência

- AI selection: Auto or explicit Provider/Model;
- system instructions;
- behavior notes.

#### Equipe

Represents the real permanent hierarchy:

```text
Builder
├─ Frontend Subagent
├─ Backend Subagent
└─ QA Subagent
```

Actions:

- Add Subagent;
- edit Team instructions/context/memory;
- remove Subagent.

The user never needs to visit a separate Teams page.

#### Acesso

Default summary:

```text
Full Access
Todos os recursos locais disponíveis.
[ Gerenciar acesso ]
```

Only after opening **Gerenciar acesso** are Tools grouped by category:

- Files
- Git
- Terminal
- Browser
- Computer
- GitHub
- Deploy
- Data/Integrations

No 40-tool wall in the default Agent view.

#### Atividade

- recent runs;
- success/failure;
- rework;
- duration.

#### Avançado

- capability matrix;
- tool-level policy;
- low-level metadata.

---

## 5. Workforces — no standalone page

Workforce is an execution implementation detail.

It appears only:

- in a live execution summary;
- in Run details;
- in Project history;
- in System/Analytics filters.

Normal user language:

```text
3 recursos trabalhando juntos
```

Expanded detail may show:

```text
Workforce
Builder · Agent
QA · Subagent
Backend Team · Team
```

The permanent Team model and temporary Workforce model remain distinct in backend and detailed UI.

---

## 6. Projects

Projects are accessed from the Project Switcher.

### Project Manager

Selecting **All Projects** opens:

- search;
- recent Projects;
- status;
- last activity;
- New Project.

### Project detail

Tabs:

- **Visão geral**
- **Trabalho**
- **Arquivos**
- **Histórico**
- **Configurações**

#### Visão geral

The Project objective is the dominant object.

Below it:

- current status;
- last activity;
- current execution, if any;
- involved Agents;
- result/latest outcome.

Metrics are compact secondary information.

#### Trabalho

Conversations and Runs belonging to the Project. Selecting one opens Trabalho with that context.

#### Arquivos

Unifies:

- Files;
- Git state;
- Artifacts.

#### Histórico

Unifies:

- Runs;
- Activity;
- Decisions;
- Blockers;
- completed Workforces;
- approvals.

A Run expands into technical detail rather than creating more permanent tabs.

#### Configurações

- objective;
- lifecycle/status;
- root/path;
- Project connections;
- advanced project preferences.

---

## 7. Conexões

The old Providers and Integrações pages merge.

Two top-level tabs:

- **IA**
- **Integrações**

### IA

Provider cards show:

- name;
- health;
- number of active models;
- default model.

Opening a Provider:

- **Geral**
- **Modelos**
- **Resiliência**
- **Diagnóstico**

#### Geral

- name;
- Base URL;
- credential state;
- Test connection.

#### Modelos

Compact searchable table/list.

Filters:

- Active
- Healthy
- Degraded
- Unknown

Per-row overflow menu:

- Set default
- Disable/Enable
- Delete
- Details

Do not render twenty large model cards.

#### Resiliência

Fallback chain and recovery behavior.

#### Diagnóstico

RPM, TPM, queue, circuit state, consecutive failures and raw provider health.

### Integrações

Sections:

**Conectadas**
- GitHub Agency
- Railway Production
- Supabase App
- etc.

**Disponíveis**
- catalog cards.

Local Browser/Computer capabilities are not presented as equivalent to third-party accounts. They move to Settings → Runtime.

Project-specific linkage is shown in Project settings and in a connection detail, not as a primary global action on every card.

---

## 8. Orchestrator

No standalone navigation.

### Normal user

The user sees:

```text
Modo: Automático
```

only where useful, and usually not at all.

### Settings → Orquestração

Advanced configuration:

- primary;
- fast;
- deep;
- confidence thresholds;
- risk policy;
- fallback behavior.

Use human descriptions before internal labels.

### System Center → Orquestração

Diagnostics/history:

- routing outcomes;
- fallback events;
- latency;
- selected model;
- confidence;
- decision trace.

Internal states such as `needs_gap_analysis` are diagnostic labels, not primary UI copy.

---

## 9. System Center — monitoring without permanent navigation

Opened from the system status indicator or Activity button.

Sections:

- **Atividade**
- **Uso & Custo**
- **Saúde**
- **Orquestração**
- **Diagnóstico**

### Atividade

Live and recent Runs across Projects.

### Uso & Custo

Keeps the canonical Analytics calculations but shows human metrics first:

- runs;
- success;
- tokens;
- known cost;
- rework;
- failures.

Data-quality details such as anti-double-counting, legacy unscoped usage and coverage move to a **Qualidade dos dados** disclosure.

### Saúde

- runtime;
- Providers;
- Integrations;
- local capabilities.

### Orquestração

Orchestrator analytics and decisions.

### Diagnóstico

- raw events;
- Tool audit;
- Release Preflight;
- migration/database information.

---

## 10. Configurações

Tabs:

- **Geral**
- **Runtime**
- **Orquestração**
- **Avançado**

### Geral

- Project default folder;
- UI preferences;
- default behaviors.

### Runtime

Only local capabilities:

- Files
- PowerShell
- Git
- Browser
- Computer Use

Third-party Railway/GitHub/Supabase status belongs to Conexões.

### Orquestração

Advanced AI routing configuration.

### Avançado

- Release Preflight;
- database/migration;
- diagnostics;
- version/build information.

---

## 11. UX language

Default UI uses human language.

Examples:

| Internal/current | Default user-facing |
|---|---|
| Run | Execução |
| Workforce | Recursos trabalhando juntos |
| needs_gap_analysis | Precisa de mais contexto/configuração |
| Provider degraded | IA com disponibilidade limitada |
| fallback | Alternativa automática |
| Tool approval | Aprovação necessária |
| capability | O que este Agent sabe fazer |
| Full Access tools | Acesso |
| circuit open | Conexão temporariamente indisponível |

Exact technical terms remain visible in advanced/diagnostic views.

---

## 12. Visual direction

The redesign keeps the current Agent Office identity but removes visual noise.

### Preserve

- dark local-first atmosphere;
- navy/blue base;
- electric blue primary accent;
- cyan/green live-status cues;
- Agent color identity/avatars;
- Office/Sala illustration language;
- technical mono typography only where technical information benefits from it.

### Change

- fewer permanent cards;
- fewer borders;
- more whitespace;
- one dominant region per screen;
- stronger page/section hierarchy;
- less uppercase microcopy;
- fewer always-visible badges;
- no dashboard mosaic unless comparison is the task.

### Visual system proposal

- App background: near-black navy.
- Primary surface: one step lighter.
- Floating/elevated surface: only for drawer/modal/selected object.
- Primary accent: Agent Office blue.
- Green: success/online only.
- Amber: warning/degraded only.
- Red: destructive/error only.
- Corners: restrained 10–12 px.
- Motion: 120–180 ms functional transitions; no decorative continuous motion outside Sala/live execution.
- Typography: Windows-friendly sans for product UI; mono reserved for IDs, code, commands and diagnostics.

---

## 13. Responsive contract

Desktop app must behave correctly at representative widths, not only ultrawide.

### Wide

At sufficient width:
- Conversation + Preview/Inspector split view.
- Sidebar expanded.

### Medium

- Sidebar may collapse.
- Conversation remains primary.
- Inspector becomes narrower or user-resizable.

### Narrow desktop / high zoom

- Inspector becomes overlay/drawer.
- Conversation uses full available width.
- Secondary metadata wraps or truncates safely.
- No normal prose may use letter-by-letter breaking.

Implementation rules:

- CSS Grid/Flex children that can shrink use `min-width: 0`.
- Normal prose uses natural wrapping, not `word-break: break-all`.
- Technical long IDs/URLs may use controlled `overflow-wrap: anywhere`.
- Fixed heights cannot clip translated or enlarged text.
- Essential actions remain reachable at 200% text/zoom.
- Sidebar and Inspector are independently collapsible.

---

## 14. Empty-state strategy

Empty pages should never look broken.

Examples:

### No active execution

```text
Pronto para começar
Descreva o que você quer criar, corrigir ou investigar.
```

### No Agent Team

```text
Este Agent trabalha sozinho
Adicione um Subagent quando quiser especializar parte do trabalho.
[ Adicionar Subagent ]
```

### No Workforces

No page exists; nothing to explain.

### No Provider

```text
Conecte uma IA para começar
[ Conectar IA ]
```

---

## 15. First-use flow

A fresh install should not expose every configuration area.

If no usable Provider exists:

1. Welcome to Agent Office.
2. Choose/connect AI.
3. Test connection.
4. Create first Project.
5. Start in Trabalho.

Agent creation is optional. A sensible default Agent can be created or suggested after Provider setup.

Advanced Runtime/Orchestrator configuration is not part of first-use.

---

## 16. Component migration map

| Current surface | UX V2 destination |
|---|---|
| `OfficeView` | Trabalho → Sala |
| `DevChatView` / Workbench | Trabalho |
| `OrchestratorView` | Settings → Orquestração + System Center → Orquestração |
| `AgentManagerView` | Equipe |
| `TeamsView` | Equipe → Agent → Equipe |
| `WorkforcesView` | removed as route; Run/Activity details |
| `ProviderManagerView` | Conexões → IA |
| `IntegrationsView` | Conexões → Integrações |
| `WorkspaceView` | Project Manager + Project detail |
| `AnalyticsView` | System Center → Usage/Activity/Orchestration |
| `SettingsView` | Configurações tabs |

The backend services, schemas and APIs remain the source of truth; the redesign primarily re-composes existing functionality.

---

## 17. Implementation stages

### Stage 0 — Design contract
- approve this IA;
- approve visual-direction proposal;
- create root `DESIGN.md`;
- add design tokens and shell contracts before page rewrites.

### Stage 1 — Shell V2
- new minimal sidebar;
- compact Project switcher;
- System status button;
- Activity Center shell;
- responsive foundation;
- route compatibility layer.

### Stage 2 — Trabalho V2
- merge Chat + execution workspace;
- contextual Preview/Inspector;
- Sala mode;
- Activity/Run drawer;
- remove permanent Event Stream and secondary columns.

### Stage 3 — Equipe V2
- Agent list;
- simplified create flow;
- Agent detail tabs;
- Teams/Subagents embedded;
- grouped Access;
- Advanced capability/tool controls.

### Stage 4 — Projects + Connections V2
- Project switcher/manager/detail;
- Provider + Integrations unified;
- compact models table;
- Project bindings in Project settings.

### Stage 5 — System Center + Settings V2
- move Analytics;
- move Orchestrator history;
- runtime health;
- diagnostics;
- advanced settings.

### Stage 6 — Product polish gate
- long-text/reflow;
- 1366 / 1440 / 1920 / ultrawide verification;
- 200% text/zoom;
- keyboard/focus;
- empty/loading/error/degraded states;
- labels/Portuguese consistency;
- visual consistency;
- MSI gate.

---

## 18. Acceptance criteria

The redesign is acceptable when a non-expert can:

1. open a Project and immediately know where to type;
2. ask for work without configuring Orchestrator/Workforce/Tools;
3. see what is happening without reading raw events;
4. approve a risky action clearly;
5. inspect Preview/Files/Logs only when needed;
6. create an Agent with a short understandable flow;
7. add Subagents without learning the internal Team model first;
8. connect AI or an external service from one place;
9. find Project history and results without navigating five technical tabs;
10. reach every advanced detail without it dominating the default experience.

No existing backend capability may be silently removed.
