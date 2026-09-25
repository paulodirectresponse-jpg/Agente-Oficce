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


## Approved composition alignment — 24/09/2026

The visual gate was reset around the user-approved Development preview.

The approved composition is now treated as a spatial contract, not a loose moodboard.

Non-negotiable rules:
- six workstations in two aligned rows of three;
- the lounge owns its rug footprint and no workstation may cross it;
- the meeting area owns a separate rug and glass-defined footprint;
- storage sits flush to the left wall and cannot rest on unrelated surfaces;
- the only entrance is centered in a real bottom-wall opening;
- planning assets are attached to the upper architectural/planning wall;
- greenery is used to support zones and dividers, never as random filler;
- Canvas effects may add light/shadow/selection but must not invent duplicate furniture or dashboards.

Automated composition validation now rejects:
- workstations outside the work zone;
- workstations entering lounge or meeting zones;
- lounge objects outside the lounge footprint;
- meeting furniture outside the meeting footprint;
- storage outside its wall zone;
- entrances not placed in the real wall opening.

This alignment is the final Stage-4 visual layout baseline until a new preview is explicitly approved.


### Final approved layout details

The approved reference uses the following concrete arrangement:
- 6 aligned Development workstations in two rows of three;
- upper planning wall with glass, whiteboard and a real analytics display;
- meeting pod on the right, with its own blue rug and glass boundary;
- lounge in the lower-left, with its own rug, teal seating, round coffee table and lamp;
- storage/printer zone flush to the left wall;
- an **open bottom-center entrance passage**, not a decorative free-standing door;
- a deliberately empty lower-center **circulation spine** connecting the room entrance to work, lounge and meeting zones.

The empty circulation area is intentional functional space and is protected by validation so furniture cannot later drift into it.

The lounge now uses a dedicated lounge rug and coffee table; the meeting room uses directional conference chairs and dedicated modular glass partitions. These changes remove the semantic mismatches from earlier V3 drafts.
