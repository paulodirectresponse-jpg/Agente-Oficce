# Stage 4 — Development V3

Development V3 is the first room built on the real licensed Agent Office asset catalog.

## What changed

The Sala 2D now attempts to load the private licensed registry from:

`/office-assets/licensed/registry.json`

If the complete Development V3 subset is available, the renderer switches automatically from the legacy/procedural room to the licensed V3 room.

If the private catalog is absent, the public-source build falls back safely to the previous room. This is intentional because licensed PNGs must not be committed to the public repository.

## Visual foundation

Development V3 uses registered assets for:

- wood flooring
- architecture / thick walls
- glass partitions
- entrance door
- six complete workstations
- wall display
- whiteboard
- conference / review area
- lounge
- storage
- plants
- lighting
- matching corporate characters

Canvas drawing is now limited mainly to:

- Agent Office identity plaque
- runtime lighting / glow
- selection / activity feedback
- shadows
- interaction overlays
- minimap framing

Furniture is no longer drawn as rectangles or generic procedural primitives in the V3 path.

## RoomLayout

The room is exported as `DEVELOPMENT_V3_ROOM_LAYOUT` and includes semantic interaction points for:

- 6 workstations
- whiteboard
- meeting / review table
- lounge seating
- room entry

This makes the room reusable by pathfinding and future orchestrator logic.

## Agent behavior

When V3 is active:

- working agents use the registered workstation positions;
- planning/thinking agents move toward the planning/review side;
- testing/reviewing agents move toward the review zone;
- waiting/paused agents move toward the lounge side;
- completed/resting agents use the lounge area.

The visual character set is also switched to matching corporate pixel-art characters from the licensed catalog while the V3 room is active.

## Camera

The camera fits the Development room itself instead of zooming out to the full old-office world. The world coordinate system remains compatible with minimap/pan/zoom and future room expansion.

## License boundary

The implementation contains only semantic IDs and layout metadata.

The actual licensed PNG files and private `registry.json` remain excluded from Git.

## Stage-4 acceptance gate

Stage 4 is complete when:

1. the V3 RoomLayout validates;
2. all declared licensed asset IDs exist in the private catalog;
3. V3 activates automatically when the private catalog is present;
4. missing licensed art falls back safely;
5. six live workstation anchors are available;
6. runtime Agent state continues controlling movement/activity;
7. the room uses real registered furniture instead of procedural furniture;
8. matching licensed characters are used in V3;
9. project unit/type/build gates pass.

The next visual gate is an installed/private build screenshot compared directly with the approved Agent Office reference.
