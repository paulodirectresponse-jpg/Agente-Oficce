import { z } from 'zod';

export const AssetCategorySchema=z.enum([
  'architecture','door','window','glass','floor','rug','desk','table','chair','seating',
  'monitor','computer','electronics','server','storage','whiteboard','lighting','plant',
  'decor','kitchen','coffee','signage','character','vehicle','misc',
]);
export type AssetCategory=z.infer<typeof AssetCategorySchema>;

export const AssetLayerSchema=z.enum([
  'floor','wall_back','furniture_back','surface','character','furniture_front','wall_front','fx','overlay',
]);
export type AssetLayer=z.infer<typeof AssetLayerSchema>;

export const AssetInteractionSchema=z.enum([
  'none','workstation','seat','meeting','whiteboard','server','coffee','storage','display','door','reception',
]);
export type AssetInteraction=z.infer<typeof AssetInteractionSchema>;

const PointSchema=z.object({x:z.number(),y:z.number()});
const FootprintSchema=z.object({
  width:z.number().positive(),
  height:z.number().positive(),
  unit:z.enum(['tile','px']).default('tile'),
});

export const AssetLicenseSchema=z.object({
  licenseId:z.string().min(1),
  sourcePack:z.string().min(1),
  commercialUse:z.boolean(),
  modificationAllowed:z.boolean(),
  sourceRedistributionAllowed:z.boolean(),
  runtimeBundlingAllowed:z.boolean(),
  aiTrainingAllowed:z.boolean().default(false),
  notes:z.array(z.string()).default([]),
});
export type AssetLicense=z.infer<typeof AssetLicenseSchema>;

export const AssetRecordSchema=z.object({
  id:z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  name:z.string().min(1),
  category:AssetCategorySchema,
  family:z.string().min(1),
  variant:z.string().default('default'),
  source:z.object({
    pack:z.string().min(1),
    originalPath:z.string().min(1),
    sha256:z.string().regex(/^[a-f0-9]{64}$/),
  }),
  runtime:z.object({
    uri:z.string().min(1),
    widthPx:z.number().int().positive(),
    heightPx:z.number().int().positive(),
    tileSize:z.number().int().positive().default(32),
    anchor:PointSchema.default({x:.5,y:1}),
    footprint:FootprintSchema,
    layer:AssetLayerSchema,
    zBias:z.number().default(0),
    collision:z.enum(['none','solid','partial']).default('solid'),
  }),
  interaction:AssetInteractionSchema.default('none'),
  tags:z.array(z.string()).default([]),
  roomTags:z.array(z.string()).default([]),
  teamTags:z.array(z.string()).default([]),
  styleTags:z.array(z.string()).default([]),
  rotation:z.enum(['none','2-way','4-way','free']).default('none'),
  animation:z.object({
    kind:z.enum(['none','frames','spritesheet']).default('none'),
    frames:z.number().int().nonnegative().default(0),
    fps:z.number().positive().optional(),
  }).default({kind:'none',frames:0}),
  license:AssetLicenseSchema,
  enabled:z.boolean().default(true),
  priority:z.number().int().default(0),
});
export type AssetRecord=z.infer<typeof AssetRecordSchema>;

export const AssetRegistrySchema=z.object({
  schemaVersion:z.literal(1),
  generatedAt:z.string(),
  tileSize:z.number().int().positive().default(32),
  source:z.object({
    provider:z.string().default('local-import'),
    bundle:z.string().default('Office Pixel Art Mega Bundle'),
  }),
  assets:z.array(AssetRecordSchema),
});
export type AssetRegistryData=z.infer<typeof AssetRegistrySchema>;

export type AssetQuery={
  categories?:AssetCategory[];
  rooms?:string[];
  teams?:string[];
  tags?:string[];
  interactions?:AssetInteraction[];
  requireAllTags?:boolean;
  limit?:number;
};

function overlap(required:string[]|undefined,actual:string[]){
  return !required?.length||required.some(v=>actual.includes(v));
}
function all(required:string[]|undefined,actual:string[]){
  return !required?.length||required.every(v=>actual.includes(v));
}

export class AssetRegistry{
  readonly data:AssetRegistryData;
  private readonly byId=new Map<string,AssetRecord>();
  private readonly byCategory=new Map<AssetCategory,AssetRecord[]>();

  constructor(input:unknown){
    this.data=AssetRegistrySchema.parse(input);
    for(const asset of this.data.assets){
      if(this.byId.has(asset.id))throw new Error(`Duplicate asset id: ${asset.id}`);
      this.byId.set(asset.id,asset);
      const bucket=this.byCategory.get(asset.category)??[];
      bucket.push(asset);this.byCategory.set(asset.category,bucket);
    }
  }

  get(id:string){return this.byId.get(id)}
  has(id:string){return this.byId.has(id)}
  list(){return [...this.byId.values()]}

  query(q:AssetQuery={}){
    const pool=q.categories?.length
      ? q.categories.flatMap(c=>this.byCategory.get(c)??[])
      : this.list();
    const results=pool.filter(a=>{
      if(!a.enabled)return false;
      if(q.rooms&&!overlap(q.rooms,a.roomTags))return false;
      if(q.teams&&!overlap(q.teams,a.teamTags))return false;
      if(q.interactions?.length&&!q.interactions.includes(a.interaction))return false;
      if(q.tags){
        const ok=q.requireAllTags?all(q.tags,a.tags):overlap(q.tags,a.tags);
        if(!ok)return false;
      }
      return true;
    });
    results.sort((a,b)=>b.priority-a.priority||a.id.localeCompare(b.id));
    return q.limit?results.slice(0,q.limit):results;
  }

  families(){
    const out=new Map<string,AssetRecord[]>();
    for(const asset of this.list()){
      const list=out.get(asset.family)??[];list.push(asset);out.set(asset.family,list);
    }
    return out;
  }

  stats(){
    const categories:Partial<Record<AssetCategory,number>>={};
    for(const a of this.list())categories[a.category]=(categories[a.category]??0)+1;
    return {total:this.byId.size,categories,families:this.families().size};
  }
}

export async function loadAssetRegistry(url='/office-assets/licensed/registry.json'){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`Asset registry unavailable (${response.status})`);
  return new AssetRegistry(await response.json());
}
