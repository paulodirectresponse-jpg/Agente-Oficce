# Agent Office Design Language V2 — Proposal

Status: proposed, not yet the canonical `DESIGN.md`.

This proposal intentionally evolves the current Agent Office identity instead of replacing it.

## Recommended direction — Calm Control Room

Agent Office should feel like a quiet, capable local workspace: dark, precise and alive when work is happening, but never visually busy by default.

### Identity anchors

1. **Local workspace** — the interface feels resident on the user's computer, not like a marketing SaaS dashboard.
2. **Living team** — Agents have identity, presence and status; the Sala makes this tangible.
3. **Controlled intelligence** — blue is action/focus, green is healthy/live, amber means attention, red is exceptional.
4. **Depth on demand** — complex machinery exists one layer below the primary task.
5. **Technical confidence without technical intimidation** — code/IDs/metrics use mono only when the information is genuinely technical.

### Visual hierarchy

- One primary workspace per screen.
- One primary action per state.
- Cards only when an object or interaction truly needs containment.
- Subtle separators instead of boxed panels everywhere.
- Large empty areas are allowed when they protect focus.
- Status appears as short text + small indicator, not a wall of badges.

### Surface levels

- Level 0: app background.
- Level 1: workspace/sheet surface.
- Level 2: selected/elevated panel, drawer or dialog.
- Level 3: transient menu/popover only.

Avoid creating a unique background/border treatment for every subsection.

### Color budget

Retain the current dark navy foundation and Agent Office blue.

- Primary blue: interaction/focus/selected.
- Cyan: live/active execution accents where distinction is useful.
- Green: success/healthy only.
- Amber: warning/degraded/approval attention.
- Red: destructive/error.
- Neutral gray-blue: all secondary text/chrome.

Do not use status colors decoratively.

### Typography

- Product UI: Windows-friendly sans stack, with strong hierarchy from size/weight instead of uppercase.
- Technical content: mono stack for code, IDs, commands, model IDs and diagnostic values.
- Avoid all-caps labels except very small optional eyebrow/kicker text.
- Normal body text must remain readable at zoom and never break by character.

### Shape

- Standard radius: 10 px.
- Larger workspace/dialog surfaces: 12–14 px when useful.
- Pills only for true statuses/tags/toggles.
- Buttons use consistent heights and hierarchy.

### Motion

- 120–180 ms transitions for drawer, selection, hover/focus and pane changes.
- No decorative continuous animation in normal work surfaces.
- Sala may use restrained live animation because it is explicitly a visualization mode.
- Honor reduced motion.

### Distinctive Agent Office elements

- Agent avatars/monograms and role colors.
- Sala/Office visualization.
- live team handoff/progress visualization.
- local runtime/system status.
- Project context always visible but quiet.

These are the identity. Do not imitate another builder's component styling, fonts, gradients, icon system or layout proportions.

## Rejected directions

### Generic SaaS dashboard
Rejected because it would preserve the current card-heavy information overload.

### Lovable/Bolt clone
Rejected because the product must borrow simplicity principles, not appearance or interaction identity.

### IDE-first
Rejected because the primary user is a vibe coder; code/terminal are inspection tools, not the home screen.

## Approval gate

After approval, this proposal should be converted into root `DESIGN.md` using the repository's `$design-md` skill and real code/tokens as evidence. Implementation should not begin with visual polish before Shell/IA contracts are established.
