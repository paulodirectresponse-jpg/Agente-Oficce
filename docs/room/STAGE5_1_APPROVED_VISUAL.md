# Stage 5.1 — Approved Development Visual Baseline

Stage 5.1 replaces the failed modular visual composition from Stage 5 with the exact user-approved Development artwork as the room's visual baseline.

## Why this exists

Stage 5 proved that reconstructing the approved concept from individual sprites at runtime introduced:
- inconsistent object scale;
- excessive empty floor;
- weak hierarchy;
- asset overlap and spacing drift;
- visible divergence from the approved concept.

Stage 5.1 treats the approved artwork as a strict visual source of truth.

## Runtime behavior

When the private room registry includes `scene.development.approved.v1`:

1. the approved 1448×1086 artwork is rendered without distortion;
2. the camera fits its 4:3 bounds;
3. live Agents are rendered above the artwork;
4. Agent movement destinations remain semantic and aligned to the visible room;
5. minimap, selection, activity bubbles and room telemetry remain live;
6. no extra procedural furniture, duplicate dashboard, generated wall or decorative object is drawn over the approved room.

The old modular asset composition remains in source only as a fallback/reference path. It is no longer the Stage 5 visual gate.

## Approved spatial contract

The runtime coordinates are pinned to:
- six Development workstation positions;
- planning/review wall;
- right-side meeting room;
- lower-left lounge;
- bottom-center open entry;
- protected circulation space.

These semantic anchors are independent from the fact that the visual room is currently rendered as a curated room skin. Stage 6 can therefore add pathfinding and collision without changing the approved visual baseline.

## Asset boundary

The approved room artwork is installed in the user's app-data asset package alongside the licensed character/runtime subset.

Expected private file:

`%APPDATA%\com.agentoffice.app\licensed-assets\files\development-approved-v1.png`

Expected registry ID:

`scene.development.approved.v1`

The image is not required in the public Git repository.

## Acceptance gate

Stage 5.1 is acceptable only if the installed application:
- matches the approved Development composition at first glance and under inspection;
- has no runtime-added furniture that changes the composition;
- preserves the approved aspect ratio;
- keeps Agents at visually coherent semantic destinations;
- loads all required private assets before enabling V3;
- falls back safely when the private package is absent.

No Stage 6 work should start until this gate is visually approved.
