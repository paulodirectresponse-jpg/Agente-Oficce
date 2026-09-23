# DESIGN.md — Agent Office V2

Status: approved design contract  
Direction: **Calm Control Room**  
Product principle: **Complex inside. Calm outside.**

This document is the visual and interaction contract for the Agent Office UX V2. It evolves the existing interface rather than replacing the product identity.

## Product identity

Agent Office is a local-first AI work environment for vibe coders.

The interface must feel:

- calm before work starts;
- alive while work is happening;
- explicit when approval or recovery is needed;
- technical only when the user asks for technical detail.

The product must remain recognizably Agent Office through:

- Agent identity and presence;
- the Sala/Office visualization;
- live handoffs and execution progress;
- Project context;
- local runtime status;
- dark navy visual language with Agent Office blue.

Do not copy another builder's layout, font system, gradients, component language or visual identity.

## Information hierarchy

Every screen must have one dominant user task.

Default order:

1. current context;
2. primary action;
3. current outcome/status;
4. contextual details;
5. advanced/diagnostic information.

Do not create permanent cards, counters, badges, tabs or panels merely because backend data exists.

Use progressive disclosure:

- always visible: information required to act now;
- contextual: information required by current state;
- on demand: inspection and operational detail;
- advanced: diagnostics, tuning and implementation internals.

## Global shell

Primary navigation:

- Trabalho
- Equipe
- Conexões
- Configurações

Projects are accessed from the Project Switcher.

Monitoring is accessed from the System Center / Activity surfaces.

The sidebar must remain visually quiet and must not become an index of backend concepts.

## Color

The current app already establishes a dark navy/blue identity in `src/agent-office/App.css`. UX V2 keeps that family while reducing visual noise.

Implementation should converge on semantic tokens for:

- app background;
- primary workspace surface;
- elevated surface;
- separator/border;
- primary text;
- secondary text;
- Agent Office blue;
- live/cyan;
- success/green;
- warning/amber;
- destructive/error/red.

Rules:

- blue = primary action, focus, selection;
- green = healthy/success only;
- amber = warning, degraded state, approval attention;
- red = destructive action or error;
- cyan = live execution accent where useful;
- neutral blue-gray = secondary chrome/content.

Status colors must never be decorative.

## Surfaces and borders

Use at most four surface levels:

1. app background;
2. workspace surface;
3. elevated selected/drawer/dialog surface;
4. temporary menu/popover.

Prefer spacing and subtle separators over wrapping every subsection in a card.

Cards are appropriate for:

- distinct selectable objects;
- contained interactive modules;
- dialogs/drawers;
- comparison where grouping matters.

Avoid dashboard-card mosaics when the task is not comparison.

## Shape

Target radii:

- standard controls/cards: 10px;
- larger workspace/dialog surfaces: 12–14px;
- pills only for actual statuses, tags or compact toggles.

Button heights and spacing must be consistent across surfaces.

## Typography

Default product typography uses a Windows-friendly sans-serif stack.

Monospace is reserved for:

- code;
- commands;
- technical IDs;
- model IDs;
- logs;
- diagnostic values.

Avoid using uppercase as the main hierarchy mechanism. Small eyebrow/kicker text may use uppercase sparingly.

Normal prose must wrap naturally and must never break letter-by-letter.

## Motion

Functional transitions: approximately 120–180ms.

Use motion for:

- drawer/pane opening;
- selection changes;
- focus/context changes;
- live execution status.

No continuous decorative animation in normal work surfaces.

The Sala may use restrained live motion because it is explicitly a visualization mode.

Honor reduced-motion preferences.

## Content and language

Primary UI uses familiar, outcome-oriented Portuguese.

Prefer:

- "Execução" over "Run";
- "Aprovação necessária" over "Tool approval";
- "Recursos trabalhando juntos" over "Workforce" in normal UI;
- "O que este Agent sabe fazer" over "Capabilities";
- "IA com disponibilidade limitada" over "Provider degraded";
- "Alternativa automática" over "Fallback";
- "Conexão temporariamente indisponível" over "Circuit open".

Technical terms remain available in advanced/diagnostic contexts.

## Trabalho

Conversation is the primary workspace.

When no preview/result exists, conversation gets the full width.

When preview/result is useful, a secondary pane may open.

The user can close or resize the secondary pane.

Inspector tabs only appear when relevant data exists.

Do not reserve permanent space for:

- empty Preview;
- empty Terminal;
- empty Logs;
- empty Files;
- Run/Plan/Workforce history.

The Sala is a secondary mode inside Trabalho, not the app homepage.

## Equipe

The default Agent surface must show only:

- identity;
- role/purpose;
- useful status;
- one-line context when needed.

Provider/model, capabilities, tool policy and detailed metrics belong inside Agent detail.

Agent detail uses:

- Geral
- Inteligência
- Equipe
- Acesso
- Atividade
- Avançado

Permanent hierarchy remains:

Agent → Team → Subagents

Never render Agent → Agent hierarchy.

## Conexões

Conexões has two peer views:

- IA
- Integrações

Provider details may expose:

- Geral
- Modelos
- Resiliência
- Diagnóstico

Integration details may expose account/connection health, Project linkage and supported actions.

Local Browser/Computer capabilities belong to Runtime, not third-party Integrations.

## Projects

Project context remains quiet but always understandable.

The Project Switcher is the main entry point.

Project detail uses:

- Visão geral
- Trabalho
- Arquivos
- Histórico
- Configurações

The Project objective is visually primary in the overview.

## System Center

System Center contains operational and diagnostic information that should not occupy permanent navigation.

Sections:

- Atividade
- Uso & Custo
- Saúde
- Orquestração
- Diagnóstico

Human-readable metrics appear before data-quality internals.

## Responsive and reflow contract

The desktop app must support narrow desktop, standard desktop and wide/ultrawide layouts.

Implementation requirements:

- shrinking flex/grid children use `min-width: 0`;
- normal prose must not use `word-break: break-all`;
- long technical IDs/URLs may use controlled `overflow-wrap: anywhere`;
- fixed heights must not clip translated or enlarged content;
- essential actions remain reachable at 200% zoom/text expansion;
- Sidebar and Inspector must be independently collapsible;
- narrow layouts convert secondary panes into drawers/overlays instead of crushing the primary task.

Representative verification widths:

- 1366px
- 1440px
- 1920px
- ultrawide

Also verify enlarged text/zoom and long content.

## Accessibility baseline

Target WCAG 2.2 AA behavior.

Required:

- semantic controls;
- visible focus;
- keyboard operation;
- accurate accessible names;
- meaningful status/error announcements;
- labels associated with inputs;
- no meaning communicated by color alone;
- relevant loading/empty/error/success/disabled states;
- no essential action hidden behind hover only.

## Empty states

Empty states must orient and provide a useful next action.

Example:

**Pronto para começar**  
Descreva o que você quer criar, corrigir ou investigar.

Do not fill empty states with technical explanation.

## Design review checklist

Before calling a UX V2 surface complete:

- Is the primary action obvious?
- Is backend terminology hidden unless necessary?
- Is only relevant detail expanded?
- Is the page visually dominated by one task?
- Are empty/loading/error/degraded states useful?
- Does long text reflow safely?
- Does the layout work at representative widths?
- Can keyboard users reach all actions?
- Is the result recognizably Agent Office?
- Was existing functionality preserved or intentionally re-homed?

Source references:

- `src/agent-office/App.css` — current Agent Office visual foundation.
- `src/agent-office/AgentOfficeApp.tsx` — current shell to be replaced by Shell V2.
- `docs/plans/AGENT_OFFICE_UX_V2.md` — approved information architecture.
- `docs/plans/design-language-v2.md` — approved visual-direction proposal.
