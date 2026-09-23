# AGENTS.md — Agent Office

## Product rule

Agent Office is built for a **vibe coder**, not for an infrastructure specialist.

The backend may be highly sophisticated. The default UI must not expose that sophistication unless the user needs it to understand, decide, recover, or deliberately configure advanced behavior.

> Complex inside. Calm outside.

The product should feel easy to start, easy to understand, and safe to operate while preserving Agent Office's unique architecture: Agents, Subagents, permanent Teams, temporary Workforces, Orchestrator, Providers, Integrations, durable execution, approvals, Projects, Analytics and local tools.

Do not copy another product's visual identity or interaction model. External products may be studied for usability principles only.

## Required UX skills

For substantial UI/UX work, use these repository skills before implementation:

1. `$product-design-and-ux` — user outcomes, task flows, states, recovery, AI interaction.
2. `$information-architecture-navigation` — navigation, grouping, hierarchy, labels, findability.
3. `$ux-writing-content-design` — plain-language labels, CTAs, errors, empty/loading/success states.
4. `$frontend-design` — visual hierarchy, accessibility, responsive behavior, complete states and rendered verification.
5. `$design-md` — when creating or changing the living design-language contract (`DESIGN.md`).

Canonical skill files are in `.agents/skills/`. Claude Code bridges are in `.claude/skills/`.

## Progressive-disclosure rule

For every piece of information or control, ask in this order:

1. Does the user need this **now** to complete the primary task?
   - Yes → show it.
2. Does the user need it only when something is running, failing, selected, or being edited?
   - Yes → reveal it contextually.
3. Is it diagnostic, expert, configuration, audit, or implementation detail?
   - Yes → place it behind Details, Advanced, Inspector, Monitor, or Settings.
4. Is it derivable automatically and rarely changed?
   - Yes → do not require the user to configure it by default.

Do not use permanent cards, badges, counters, panels, or tabs just because the backend has a field for them.

## User-facing language

Prefer familiar, outcome-oriented language.

Do not put backend vocabulary in primary navigation unless the user must reason about that concept. Examples of terms that usually belong in secondary/advanced UI:

- routing level
- confidence threshold
- gap analysis
- circuit breaker
- fallback chain
- idempotency
- migration
- provider protocol
- capability score
- tool audit
- execution graph
- orchestration event

Preserve precise terminology in diagnostics, monitoring, logs and advanced configuration.

## Main product objects

Keep these distinctions correct even when the UI hides implementation detail:

- **Agent**: independent primary AI worker.
- **Subagent**: subordinate unit owned by one Agent.
- **Team**: permanent organization under one Agent, made of that Agent's Subagents.
- **Workforce**: temporary execution composition; never changes permanent ownership.
- **Project**: persistent work context.
- **Provider**: AI/model connection.
- **Integration**: external system connection.
- **Tool**: an action a worker can execute through policy/approval/audit.

Never create Agent → Agent hierarchy.

## UI quality gates

A redesign is not complete until:

- Primary task is obvious without reading documentation.
- No essential text breaks letter-by-letter at supported widths.
- Empty states tell the user what to do next.
- Technical details are progressively disclosed.
- Keyboard/focus behavior is usable.
- Loading, empty, error, success, disabled, approval and offline/degraded states are covered where relevant.
- Layout is checked at representative desktop widths and zoom/text expansion.
- Existing functionality is preserved or intentionally re-homed; do not silently delete capabilities.
- Visual identity remains recognizably Agent Office.

## Source of truth

Always work from the latest `main`. Do not base redesign work on backups or obsolete branches.

See:
- `BUILD_STATUS.md` for current implementation state.
- `docs/plans/AGENT_OFFICE_UX_V2.md` for the approved UX architecture once present.
- `DESIGN.md` for visual language once approved and created.
