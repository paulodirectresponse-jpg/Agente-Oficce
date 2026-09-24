# Development Vertical Slice — zero-cost art validation

This branch intentionally validates the Agent Office visual language before any paid asset purchase.

## Existing free inventory

- Pixel Interior / bitglow interior sheets (CC0): floors/walls, cabinets, decorations, kitchen and living-room sheets.
- MetroCity role characters (CC0): software engineer, QA engineer, tech lead, product owner, tech manager and suits.
- Canvas renderer already supports camera, zoom/pan, minimap, state-driven agents, activity bubbles and handoffs.

See `public/office-assets/ATTRIBUTION.md` for provenance.

## What this slice proves

Development is deliberately rendered as one dense premium team zone instead of the previous full-office schematic. It validates the approved direction with warm wood + navy architecture + cyan tech accents, thicker walls, glass, rugs, plants, dashboards, richer work pods, layered lighting, readable agents and a closer default camera.

No paid asset is required by this slice.

## Deliberate limitations

This is an art/renderer gate, not the final asset library. Some desks, screens, architecture and lighting are composed in Canvas because the current CC0 sheets do not cover every hero object needed by the approved concept. Once the slice is visually approved, those primitives should be replaced by the final reusable AssetRegistry/atlas rather than multiplied across the full office.

## Gate

Do not expand the remaining office until Development is accepted visually. The next engineering step after approval is AssetRegistry + reusable room module + collision/path grid.
