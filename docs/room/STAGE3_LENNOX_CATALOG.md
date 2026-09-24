# Stage 3 — Curated Lennox Catalog

The complete 18-pack Office Pixel Art Mega Bundle was imported and audited against the Agent Office asset schema on 24/09/2026.

## Real import result

- 18 recognized source ZIPs
- 1,926 runtime-ready assets
- 169 reference/master-scene/sheet PNGs excluded from runtime
- 233.14 MiB of normalized runtime art
- 0 duplicate runtime asset IDs
- 0 missing runtime files in the private validation
- 0 hash mismatches in the private validation
- 0 source assets marked as redistributable
- 0 source assets marked as AI-training-allowed

The sanitized category/room counts live in `LENNOX_CATALOG_STAGE3_SUMMARY.json`.

## Catalog policy

The real registry and normalized PNGs are private licensed build inputs and remain outside Git.

Source:
`18 purchased Lennox ZIPs`

Private generated outputs:
- `registry.json`
- `import-report.json`
- `recipes.json`
- `files/*.png`

The catalog can be rebuilt deterministically with:

```bash
npm run assets:import:lennox -- --source "<folder-containing-the-18-zips>"
npm run assets:validate
```

## Curated taxonomy

The stage-3 catalog recognizes:

- architecture
- glass
- door
- window
- floor
- rug
- desk
- table
- chair
- seating
- monitor
- computer
- electronics
- server
- storage
- whiteboard
- lighting
- plant
- decor
- kitchen
- coffee
- signage
- tool
- supply
- appliance
- access_control
- character
- vehicle
- misc

The taxonomy is intentionally semantic. Renderer/orchestrator code does not depend on vendor folder names.

## Pack profiles

`scripts/assets/lennox-pack-profiles.json` defines the role of every purchased pack.

Examples:
- Top-Down Modern Corporate Office: primary Development visual base
- Modular Office Builder Essentials: universal architecture
- IT Network Operations: Infra
- Financial Trading Floor: dashboards / Operations / Research
- Newsroom Editorial: Design / Media
- Headquarters / Luxury / Law Firm: Leadership
- Meeting & Training: Strategy
- Modern Corporate Lobby: Lobby / Reception

Pack profiles define:
- semantic pack ID
- base priority
- room coverage
- team coverage
- style tags
- license policy

## Vendor manifest support

When a pack includes `ASSET_MANIFEST.csv`, the importer consumes available metadata such as:

- grid size
- pivot / anchor
- collision hints

If the pack has no manifest, deterministic heuristics provide defaults which can later be overridden.

## Stable identity

Asset IDs are based on:

`pack semantic ID + logical source path`

They are **not** based on PNG bytes.

This means artwork can be replaced or updated without invalidating saved RoomLayouts that reference the same semantic source asset.

SHA-256 is still stored separately for integrity verification.

## Room coverage

The real imported catalog has strong coverage for:

- Development
- Infra
- Research / QA
- Operations
- Leadership
- Strategy
- Design / Media
- Lobby
- Lounge / Café

The catalog also retains general-purpose assets for future room types.

## Semantic recipes

Stage 3 adds reusable recipes for commonly generated zones:

- `workstation.modern`
- `meeting.modern`
- `lounge.modern`
- `server.bay`
- `reception.premium`
- `media.station`
- `operations.command`

A recipe defines semantic slots rather than exact PNGs. Example:

```text
workstation.modern
  desk      -> category desk
  monitor   -> category monitor + tech
  chair     -> category chair
  computer  -> category computer + tech (optional)
  deskPlant -> category plant + small (optional)
```

The registry selects the best compatible assets at runtime or during room generation.

## Future offices

The catalog does not assume there will only ever be one Agent Office.

Future flow:

```text
User request
  ↓
Orchestrator
  ↓
OfficeSpec
  ↓
RoomSpec(s)
  ↓
Asset recipes + Asset Registry
  ↓
RoomLayout(s)
  ↓
collision/pathfinding validation
  ↓
renderer
```

An unknown future team can use a generic RoomSpec first and receive its own curated style/requirements later without changing the registry architecture.

## License boundary

Raw purchased PNGs and generated runtime PNGs must remain outside the public Git repository.

They may be used inside the finished application under the purchased licenses, but the application must not become a downloadable asset library.

The conservative Agent Office policy is also:

**Licensed source art is never used for model training, fine-tuning, benchmarking, or dataset creation.**

The orchestrator may select and arrange registered assets. That is separate from training a model on the artwork.

## Stage 3 gate

Stage 3 is considered complete only when:

1. all 18 ZIPs are recognized;
2. the private registry validates;
3. category coverage passes;
4. current room coverage passes;
5. semantic recipes are resolvable;
6. licensed art remains outside Git;
7. the TypeScript catalog/importer passes the normal project typecheck/test gate.

The next implementation stage is **Development V3**, using the private stage-3 registry and registered assets rather than hardcoded asset filenames.
