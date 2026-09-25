import { z } from 'zod';
import type { AssetCalibration } from './assetCalibration.js';

export const CharacterScaleProfileSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  canonicalTileSize:z.number().positive().default(32),
  standingHeightTiles:z.number().positive().default(1.5),
  seatedHeightTiles:z.number().positive().default(1.08),
  workingHeightTiles:z.number().positive().default(1.08),
  minimumScale:z.number().positive().default(.2),
  maximumScale:z.number().positive().default(2),
});
export type CharacterScaleProfile=z.infer<typeof CharacterScaleProfileSchema>;

export const AGENT_OFFICE_CHARACTER_SCALE=CharacterScaleProfileSchema.parse({
  schemaVersion:1,
  id:'agent-office-character-scale-v1',
  canonicalTileSize:32,
  standingHeightTiles:1.75,
  seatedHeightTiles:1.5,
  workingHeightTiles:1.5,
  minimumScale:.2,
  maximumScale:2,
});

export type CharacterPoseClass='standing'|'seated'|'working';

export function targetCharacterHeight(profile:CharacterScaleProfile,pose:CharacterPoseClass){
  const tiles=pose==='standing'
    ? profile.standingHeightTiles
    : pose==='working'
      ? profile.workingHeightTiles
      : profile.seatedHeightTiles;
  return profile.canonicalTileSize*tiles;
}

export function characterRenderScale(
  calibration:AssetCalibration,
  pose:CharacterPoseClass,
  profile:CharacterScaleProfile=AGENT_OFFICE_CHARACTER_SCALE,
){
  const target=targetCharacterHeight(profile,pose);
  const scale=target/calibration.visibleHeight;
  return Math.max(profile.minimumScale,Math.min(profile.maximumScale,scale));
}

export function characterDestinationRect(
  calibration:AssetCalibration,
  x:number,
  y:number,
  pose:CharacterPoseClass,
  profile:CharacterScaleProfile=AGENT_OFFICE_CHARACTER_SCALE,
){
  const scale=characterRenderScale(calibration,pose,profile);
  return{
    x:x-calibration.visualAnchorPx.x*scale,
    y:y-calibration.visualAnchorPx.y*scale,
    width:calibration.visibleWidth*scale,
    height:calibration.visibleHeight*scale,
    scale,
  };
}
