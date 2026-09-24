# Agent Office — Asset System v1

This document defines the permanent asset architecture for the 2D office.

## Goals

The asset system must support:
- the current Agent Office visual direction;
- multiple specialized team rooms;
- future offices and new room types;
- orchestration-driven room creation;
- strict separation between licensed source art and the public Git repository;
- deterministic runtime IDs independent of source filenames.

## Pipeline

1. Put purchased ZIPs or extracted packs in a private local directory.
2. Run `npm run assets:import -- --source "<private-folder>"`.
3. The importer scans PNGs, extracts metadata, classifies them, removes byte-identical duplicates and copies normalized runtime files to `public/office-assets/licensed/`.
4. The importer writes:
   - `registry.json`
   - `import-report.json`
   - normalized PNG files under `files/`
5. Run `npm run assets:validate`.
6. Build Agent Office locally or in a private CI environment that has the licensed assets available.

The entire output directory is gitignored.

## Semantic registry

Renderer and room-generation code must never depend on a vendor filename. Each imported asset receives a stable semantic record with:

- semantic ID;
- category and family;
- variant;
- source pack and original path;
- source SHA-256;
- runtime URI and dimensions;
- anchor;
- tile footprint;
- render layer and z-bias;
- collision mode;
- interaction type;
- general, room, team and style tags;
- rotation and animation metadata;
- license capabilities and restrictions;
- enabled/priority state.

## Render layers

Canonical order:

1. `floor`
2. `wall_back`
3. `furniture_back`
4. `surface`
5. `character`
6. `furniture_front`
7. `wall_front`
8. `fx`
9. `overlay`

A room renderer may add local z-bias but should not bypass this layer model.

## Interactions

Assets can expose semantic interactions:

- workstation
- seat
- meeting
- whiteboard
- server
- coffee
- storage
- display
- door
- reception

This is the bridge between art and agent behavior. A workstation is not merely a PNG; it is a usable destination for an agent.

## RoomSpec

`RoomSpec` describes what a room needs without knowing which exact PNGs will be used.

Examples:
- capacity;
- dimensions;
- theme/accent/material/density;
- number of workstations;
- meeting seats;
- whiteboards;
- servers;
- lounge seats;
- storage;
- plants;
- displays;
- zones;
- required/preferred/excluded tags.

The repository includes templates for:
- Development
- Infra
- Research / QA
- Operations
- Leadership
- Strategy
- Design / Media
- Lobby
- Lounge / Café

Unknown future room types receive a safe generic template and can then be enriched by the orchestrator.

## OfficeSpec

`OfficeSpec` is the higher-level contract for future offices. It defines:
- global style;
- office bounds;
- rooms and their dimensions;
- team-room assignment;
- room connections;
- expansion strategy.

The current expansion strategies are:
- grid
- corridor
- wing
- adaptive

This allows future Agent Office versions to build an entirely new office without replacing the asset system.

## RoomLayout

`RoomLayout` is the resolved output used by the renderer. It stores exact asset placements, walkable/blocked cells and interaction points.

The expected flow is:

`OfficeSpec → RoomSpec → AssetRegistry query → RoomLayout → renderer/pathfinding`

## Licensed art rules

The purchased Lennox source ZIPs and extracted PNGs are private licensed material.

Do not:
- commit source ZIPs or generated licensed PNGs to the public repository;
- expose the registry as a downloadable asset pack;
- use licensed PNGs as an AI training/fine-tuning dataset;
- build a public dataset from the source art.

Allowed architecture:
- privately import licensed art;
- classify it into semantic metadata;
- bundle required artwork into the finished Agent Office application according to the applicable license;
- let the Agent Office orchestrator select, place and combine registered assets at runtime.

## Commands

Import:
```bash
npm run assets:import -- --source "D:\AgentOfficeAssets\Lennox"
```

Optional custom output:
```bash
npm run assets:import -- --source "D:\AgentOfficeAssets\Lennox" --output "public/office-assets/licensed"
```

Include full scene/preview images during import:
```bash
npm run assets:import -- --source "D:\AgentOfficeAssets\Lennox" --include-scenes
```

Override auto-classification when an asset needs a curated category, layer, interaction, footprint or room/team tag:
```bash
npm run assets:import -- --source "D:\\AgentOfficeAssets\\Lennox" --overrides "scripts/assets/asset-overrides.local.json"
```

A safe public example lives at `scripts/assets/asset-overrides.example.json`. Real curation files may be kept private when they include licensed filenames or internal notes.

Dry-run classification without copying runtime PNGs:
```bash
npm run assets:import -- --source "D:\AgentOfficeAssets\Lennox" --dry-run
```

Validate imported registry:
```bash
npm run assets:validate
```

## Next stage

The next stage is Development V3:
- import the purchased bundle through this pipeline;
- select the final Development subset from the registry;
- build a real RoomLayout;
- render the room entirely from registered assets plus Agent Office lighting/FX;
- connect workstations and interaction points to live agents.
