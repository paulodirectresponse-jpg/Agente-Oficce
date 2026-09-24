# Stage 5.2A — Calibration + Prefab System

This stage fixes the root cause of the previous Development V3 visual failures.

The problem was not the asset pack or Canvas. The problem was that room code placed raw PNGs directly with arbitrary x/y/scale values while ignoring transparent padding, visual anchors, physical scale and semantic interaction points.

Stage 5.2A inserts two permanent layers between Asset Registry and RoomLayout:

```text
Raw licensed PNGs
    ↓
Asset Calibration
    ↓
Prefab Library
    ↓
Prefab Room Blueprint
    ↓
Renderer / agents / pathfinding
```

## 1. Asset Calibration

Each asset can now have:

- real alpha bounds;
- visible width / visible height;
- transparent padding;
- source anchor in pixels;
- visual anchor relative to visible pixels;
- canonical scale;
- world-visible dimensions;
- baseline;
- semantic sockets;
- calibration confidence;
- notes.

The important change is that renderer code no longer has to assume that the full PNG canvas equals the visible object.

A 198×287 PNG whose visible pixels occupy only 178×166 is rendered and aligned using the 178×166 visible region.

### Canonical scale

Canonical scale is derived from:

```text
Agent Office canonical tile size / source asset grid size
```

The default Agent Office tile is 32 px.

This prevents arbitrary per-room scales such as `.54`, `.62`, `.46` from becoming the main composition mechanism.

Room prefabs may only use one of three semantic scale tokens:

- `compact` = 0.875
- `standard` = 1.0
- `spacious` = 1.125

Any special physical correction belongs in the asset calibration override, not scattered through room layout code.

## 2. Automatic PNG calibration

Run:

```bash
npm run assets:calibrate -- --root "<private licensed runtime folder>"
```

The scanner:

1. reads the private registry;
2. decodes each PNG without an external imaging dependency;
3. reconstructs PNG filters;
4. finds non-transparent pixel bounds;
5. calculates padding and visual anchor;
6. normalizes source scale;
7. writes `calibration.json`.

Supported non-interlaced PNG types include RGBA, grayscale+alpha, RGB, indexed-color and grayscale files.

The generated calibration file stays with the private licensed runtime assets.

## 3. Curated calibration overrides

Automatic bounds are the baseline.

Assets that need human calibration can override:

- canonical scale;
- visual anchor;
- baseline;
- sockets;
- notes;
- confidence.

That curation is performed **once per asset**, instead of being repeated in every room.

Example:

```json
{
  "assetId": "desk.some-workstation",
  "canonicalScale": 0.94,
  "visualAnchorPx": {"x": 88, "y": 145},
  "confidence": "curated",
  "sockets": [
    {
      "id": "seat",
      "kind": "work",
      "x": 88,
      "y": 140,
      "facing": "north",
      "pose": "seated-working",
      "layer": "same"
    }
  ]
}
```

## 4. Prefabs

A prefab is a visually approved composition whose internal layout is locked.

Room code places the prefab as one unit. It does not independently move its desks, plants, chairs or props.

Stage 5.2A includes the initial Development prefab families:

- `development.workpod.6`
- `development.planning-wall`
- `meeting.glass.6`
- `lounge.standard`
- `storage.wall.standard`
- `entrance.bottom.open`

### Development Work Pod

The six-person work pod owns:

- six calibrated workstation assets;
- divider plants;
- six work sockets;
- collision rectangles;
- keep-clear corridors.

The six workstation offsets are internal to the prefab and are no longer room-level free-floating placements.

### Meeting Pod

The meeting prefab owns:

- rug;
- glass partitions;
- table;
- directional chairs;
- plant;
- meeting sockets;
- presenter socket;
- collision / clear-space rules.

### Lounge

The lounge owns its own rug footprint, seating, coffee table, lamp and interaction sockets.

This makes it impossible for a future workstation placement to legitimately "share" or drift onto the lounge rug without failing composition validation.

## 5. Semantic sockets

Prefabs expose interaction points independent of PNG dimensions.

Examples:

- `work`
- `seat`
- `meeting`
- `present`
- `interact`
- `entry`
- `exit`

A socket contains:

- world-relative x/y;
- facing direction;
- optional Agent pose;
- capacity;
- tags.

This is the basis for Stage 6 pathfinding and correct seated/working character placement.

## 6. Character calibration

Agent scale is now derived from a canonical physical target instead of a hardcoded runtime height.

The default Agent Office profile is:

- standing: 1.50 tiles = 48 px at a 32 px tile;
- seated / working: 1.08 tiles = 34.56 px.

A 93 px-tall source character is therefore scaled from its calibrated visible height, rather than being forced to approximately 70 px as in the failed Stage 5 runtime.

Character placement uses prefab sockets, so the character scale and the chair/workstation position are governed by the same coordinate system.

## 7. Prefab Room Blueprint

Rooms can now be defined as prefab instances rather than hundreds of loose asset placements.

The room compiler validates:

- duplicate instance IDs;
- missing assets;
- missing calibrations;
- prefab bounds;
- keep-clear overlap;
- protected room zones;
- socket indexing.

Example flow:

```text
Development Blueprint
  ├─ Planning Wall
  ├─ Work Pod 6
  ├─ Glass Meeting 6
  ├─ Lounge
  ├─ Storage Wall
  └─ Open Entrance
```

## 8. Protected zones

A room can reserve areas such as:

- main circulation;
- entry;
- emergency path;
- Agent standing area;
- expansion corridor.

Prefab collision geometry is checked against those zones.

This prevents visually "nice" but functionally impossible room compositions.

## 9. Character occlusion inside furniture

Some top-down assets cannot be drawn as one flat image if an Agent must visually sit inside them.

Calibration therefore supports:

```text
occlusion:
  mode: horizontal-split
  splitY: <source-pixel>
```

The prefab renderer turns one calibrated asset into two passes:

```text
asset back segment
      ↓
Agent
      ↓
asset front segment
```

This is especially useful for desks/workstations whose front edge must cover a seated Agent while the chair/monitor remains behind the Agent.

The split coordinate is calibrated once for the asset and is never guessed in individual room layouts.

## 10. Calibrated renderer contract

Compiled prefab nodes carry:

- trimmed source rectangle;
- calibrated destination rectangle;
- layer;
- z-bias;
- canonical scale;
- tags.

The prefab renderer draws only the visible calibrated region of each PNG.

Therefore transparent padding can no longer shift an object away from its intended blueprint coordinate.

## 11. What Stage 5.2A intentionally does not do

It does **not** rebuild the Development runtime yet.

The current runtime remains untouched until the calibration/prefab foundation passes its tests.

Stage 5.2B will:

1. remove the approved static backdrop from the real room renderer;
2. generate the private calibration catalog from the licensed assets;
3. curate the key Development assets;
4. instantiate the six approved prefab modules;
5. render the room entirely from calibrated real assets;
6. calibrate Agent scale against workstation/chair sockets;
7. render a local screenshot before producing another MSI.

## Stage 5.2A completion gate

Stage 5.2A is complete when:

- calibration schemas pass;
- PNG alpha scanner passes typecheck;
- canonical scale is deterministic;
- prefab schemas pass;
- six Development prefab families are available;
- prefabs expose semantic sockets;
- protected-zone validation works;
- calibrated source cropping works;
- tests, typecheck and project build pass.

No new MSI should be generated during Stage 5.2A.
