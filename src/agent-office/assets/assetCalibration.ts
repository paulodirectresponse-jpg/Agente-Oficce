import { z } from 'zod';
import type { AssetLayer, AssetRecord, AssetRegistry } from './assetRegistry.js';

export const AlphaBoundsSchema=z.object({
  x:z.number().int().nonnegative(),
  y:z.number().int().nonnegative(),
  width:z.number().int().positive(),
  height:z.number().int().positive(),
});
export type AlphaBounds=z.infer<typeof AlphaBoundsSchema>;

export const CalibrationSocketSchema=z.object({
  id:z.string().min(1),
  kind:z.enum(['seat','stand','work','interact','present','entry','exit','meeting']),
  x:z.number(),
  y:z.number(),
  facing:z.enum(['north','south','east','west','none']).default('none'),
  pose:z.string().optional(),
  layer:z.enum(['behind','same','front']).default('same'),
});
export type CalibrationSocket=z.infer<typeof CalibrationSocketSchema>;

export const AssetCalibrationSchema=z.object({
  assetId:z.string().min(1),
  sourceWidth:z.number().int().positive(),
  sourceHeight:z.number().int().positive(),
  alphaBounds:AlphaBoundsSchema,
  visibleWidth:z.number().int().positive(),
  visibleHeight:z.number().int().positive(),
  sourceAnchorPx:z.object({x:z.number(),y:z.number()}),
  visualAnchorPx:z.object({x:z.number(),y:z.number()}),
  baselinePx:z.number(),
  canonicalScale:z.number().positive(),
  worldVisibleWidth:z.number().positive(),
  worldVisibleHeight:z.number().positive(),
  transparentPadding:z.object({
    left:z.number().int().nonnegative(),
    top:z.number().int().nonnegative(),
    right:z.number().int().nonnegative(),
    bottom:z.number().int().nonnegative(),
  }),
  sockets:z.array(CalibrationSocketSchema).default([]),
  occlusion:z.object({
    mode:z.enum(['none','horizontal-split','front-rects']).default('none'),
    splitY:z.number().optional(),
    frontRects:z.array(AlphaBoundsSchema).default([]),
  }).default({mode:'none',frontRects:[]}),
  renderLayer: z.custom<AssetLayer>(),
  confidence:z.enum(['auto','manifest','curated']).default('auto'),
  notes:z.array(z.string()).default([]),
});
export type AssetCalibration=z.infer<typeof AssetCalibrationSchema>;

export const AssetCalibrationCatalogSchema=z.object({
  schemaVersion:z.literal(1),
  generatedAt:z.string(),
  canonicalTileSize:z.number().int().positive().default(32),
  assets:z.array(AssetCalibrationSchema),
});
export type AssetCalibrationCatalogData=z.infer<typeof AssetCalibrationCatalogSchema>;

export type CalibrationOverride={
  assetId:string;
  canonicalScale?:number;
  baselinePx?:number;
  visualAnchorPx?:{x:number;y:number};
  sockets?:CalibrationSocket[];
  occlusion?:{mode:'none'|'horizontal-split'|'front-rects';splitY?:number;frontRects?:AlphaBounds[]};
  confidence?:'manifest'|'curated';
  notes?:string[];
};

export const SCALE_TOKENS={
  compact:.875,
  standard:1,
  spacious:1.125,
} as const;
export type ScaleToken=keyof typeof SCALE_TOKENS;

export class AssetCalibrationCatalog{
  readonly data:AssetCalibrationCatalogData;
  private readonly byId=new Map<string,AssetCalibration>();

  constructor(input:unknown){
    this.data=AssetCalibrationCatalogSchema.parse(input);
    for(const calibration of this.data.assets){
      if(this.byId.has(calibration.assetId))throw new Error(`Duplicate calibration: ${calibration.assetId}`);
      this.byId.set(calibration.assetId,calibration);
    }
  }

  get(assetId:string){return this.byId.get(assetId)}
  has(assetId:string){return this.byId.has(assetId)}
  list(){return [...this.byId.values()]}

  require(assetId:string){
    const calibration=this.get(assetId);
    if(!calibration)throw new Error(`Missing asset calibration: ${assetId}`);
    return calibration;
  }

  stats(){
    const values=this.list();
    return{
      total:values.length,
      auto:values.filter(v=>v.confidence==='auto').length,
      manifest:values.filter(v=>v.confidence==='manifest').length,
      curated:values.filter(v=>v.confidence==='curated').length,
      withSockets:values.filter(v=>v.sockets.length>0).length,
    };
  }
}

export function deriveCalibration(
  asset:AssetRecord,
  alphaBounds:AlphaBounds,
  canonicalTileSize=32,
  override?:CalibrationOverride,
):AssetCalibration{
  const sourceAnchorPx={
    x:asset.runtime.anchor.x*asset.runtime.widthPx,
    y:asset.runtime.anchor.y*asset.runtime.heightPx,
  };
  const visualAnchorPx=override?.visualAnchorPx??{
    x:sourceAnchorPx.x-alphaBounds.x,
    y:sourceAnchorPx.y-alphaBounds.y,
  };
  const baseScale=canonicalTileSize/asset.runtime.tileSize;
  const canonicalScale=override?.canonicalScale??baseScale;
  const baselinePx=override?.baselinePx??alphaBounds.height;

  return AssetCalibrationSchema.parse({
    assetId:asset.id,
    sourceWidth:asset.runtime.widthPx,
    sourceHeight:asset.runtime.heightPx,
    alphaBounds,
    visibleWidth:alphaBounds.width,
    visibleHeight:alphaBounds.height,
    sourceAnchorPx,
    visualAnchorPx,
    baselinePx,
    canonicalScale,
    worldVisibleWidth:alphaBounds.width*canonicalScale,
    worldVisibleHeight:alphaBounds.height*canonicalScale,
    transparentPadding:{
      left:alphaBounds.x,
      top:alphaBounds.y,
      right:Math.max(0,asset.runtime.widthPx-alphaBounds.x-alphaBounds.width),
      bottom:Math.max(0,asset.runtime.heightPx-alphaBounds.y-alphaBounds.height),
    },
    sockets:override?.sockets??[],
    occlusion:override?.occlusion??{mode:'none',frontRects:[]},
    renderLayer:asset.runtime.layer,
    confidence:override?.confidence??(asset.runtime.tileSize!==32?'manifest':'auto'),
    notes:override?.notes??[],
  });
}

export type CalibratedDrawRect={
  source:{x:number;y:number;width:number;height:number};
  destination:{x:number;y:number;width:number;height:number};
  scale:number;
};

export function calibratedDrawRect(
  calibration:AssetCalibration,
  worldX:number,
  worldY:number,
  scaleToken:ScaleToken='standard',
):CalibratedDrawRect{
  const scale=calibration.canonicalScale*SCALE_TOKENS[scaleToken];
  return{
    source:{...calibration.alphaBounds},
    destination:{
      x:worldX-calibration.visualAnchorPx.x*scale,
      y:worldY-calibration.visualAnchorPx.y*scale,
      width:calibration.visibleWidth*scale,
      height:calibration.visibleHeight*scale,
    },
    scale,
  };
}

export function calibrateRegistryCoverage(registry:AssetRegistry,catalog:AssetCalibrationCatalog){
  const missing=registry.list().filter(asset=>!catalog.has(asset.id)).map(asset=>asset.id);
  const orphan=catalog.list().filter(item=>!registry.has(item.assetId)).map(item=>item.assetId);
  return{ok:missing.length===0&&orphan.length===0,missing,orphan};
}
