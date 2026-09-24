import { z } from 'zod';
import type { AssetCategory, AssetRecord, AssetRegistry } from './assetRegistry.js';

export const AssetRecipeSlotSchema=z.object({
  id:z.string().min(1),
  categories:z.array(z.string()).min(1),
  count:z.number().int().positive().default(1),
  requiredTags:z.array(z.string()).default([]),
  preferredTags:z.array(z.string()).default([]),
  optional:z.boolean().default(false),
});
export type AssetRecipeSlot=z.infer<typeof AssetRecipeSlotSchema>;

export const AssetRecipeSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  name:z.string().min(1),
  roomTags:z.array(z.string()).default([]),
  teamTags:z.array(z.string()).default([]),
  slots:z.array(AssetRecipeSlotSchema),
});
export type AssetRecipe=z.infer<typeof AssetRecipeSchema>;

export type ResolvedAssetRecipe={
  recipeId:string;
  assets:Record<string,AssetRecord[]>;
  unresolved:string[];
};

const CATEGORIES=new Set<AssetCategory>([
  'architecture','door','window','glass','floor','rug','desk','table','chair','seating','monitor','computer','electronics','server',
  'storage','whiteboard','lighting','plant','decor','kitchen','coffee','signage','tool','supply','appliance','access_control','character','vehicle','misc',
]);

export function resolveAssetRecipe(registry:AssetRegistry,input:unknown):ResolvedAssetRecipe{
  const recipe=AssetRecipeSchema.parse(input);
  const assets:Record<string,AssetRecord[]>={};
  const unresolved:string[]=[];
  for(const slot of recipe.slots){
    const categories=slot.categories.filter((c):c is AssetCategory=>CATEGORIES.has(c as AssetCategory));
    const candidates=registry.query({
      categories,
      rooms:recipe.roomTags,
      teams:recipe.teamTags,
      tags:slot.requiredTags.length?slot.requiredTags:slot.preferredTags,
      requireAllTags:slot.requiredTags.length>0,
      limit:100,
    });
    const selected=candidates.slice(0,slot.count);
    assets[slot.id]=selected;
    if(selected.length<slot.count&&!slot.optional)unresolved.push(`${slot.id}:${slot.count-selected.length}`);
  }
  return{recipeId:recipe.id,assets,unresolved};
}

export const CORE_ASSET_RECIPES:Record<string,AssetRecipe>={
  workstation:AssetRecipeSchema.parse({
    schemaVersion:1,id:'workstation.modern',name:'Modern workstation',roomTags:['development'],teamTags:['development'],
    slots:[
      {id:'desk',categories:['desk'],count:1,preferredTags:['work','modern']},
      {id:'monitor',categories:['monitor'],count:1,preferredTags:['tech']},
      {id:'chair',categories:['chair'],count:1,preferredTags:['work']},
      {id:'computer',categories:['computer'],count:1,preferredTags:['tech'],optional:true},
      {id:'deskPlant',categories:['plant'],count:1,preferredTags:['small'],optional:true},
    ],
  }),
  meeting:AssetRecipeSchema.parse({
    schemaVersion:1,id:'meeting.modern',name:'Modern collaboration zone',roomTags:['strategy'],
    slots:[
      {id:'table',categories:['table'],count:1,preferredTags:['meeting']},
      {id:'chairs',categories:['chair'],count:4,preferredTags:['meeting']},
      {id:'whiteboard',categories:['whiteboard'],count:1},
      {id:'display',categories:['monitor'],count:1,preferredTags:['tech'],optional:true},
      {id:'plant',categories:['plant'],count:1,optional:true},
    ],
  }),
  lounge:AssetRecipeSchema.parse({
    schemaVersion:1,id:'lounge.modern',name:'Modern lounge',roomTags:['lounge'],
    slots:[
      {id:'seating',categories:['seating'],count:2,preferredTags:['lounge']},
      {id:'table',categories:['table'],count:1},
      {id:'plants',categories:['plant'],count:2},
      {id:'coffee',categories:['coffee'],count:1,optional:true},
      {id:'lighting',categories:['lighting'],count:1,optional:true},
    ],
  }),
  serverBay:AssetRecipeSchema.parse({
    schemaVersion:1,id:'server.bay',name:'Server bay',roomTags:['infra'],teamTags:['infra'],
    slots:[
      {id:'servers',categories:['server'],count:3,preferredTags:['tech']},
      {id:'equipment',categories:['electronics'],count:2,preferredTags:['tech']},
      {id:'storage',categories:['storage'],count:1,optional:true},
      {id:'tools',categories:['tool'],count:1,optional:true},
    ],
  }),
  reception:AssetRecipeSchema.parse({
    schemaVersion:1,id:'reception.premium',name:'Premium reception',roomTags:['lobby'],teamTags:['reception'],
    slots:[
      {id:'desk',categories:['desk'],count:1},
      {id:'seating',categories:['seating','chair'],count:3},
      {id:'access',categories:['access_control'],count:1,optional:true},
      {id:'plants',categories:['plant'],count:2},
      {id:'signage',categories:['signage','monitor'],count:1,optional:true},
    ],
  }),
  mediaStation:AssetRecipeSchema.parse({
    schemaVersion:1,id:'media.station',name:'Media workstation',roomTags:['design'],teamTags:['design'],
    slots:[
      {id:'desk',categories:['desk'],count:1},
      {id:'monitors',categories:['monitor'],count:2,preferredTags:['tech']},
      {id:'electronics',categories:['electronics'],count:2,preferredTags:['studio']},
      {id:'lighting',categories:['lighting'],count:1,optional:true},
      {id:'storage',categories:['storage'],count:1,optional:true},
    ],
  }),
  operationsCommand:AssetRecipeSchema.parse({
    schemaVersion:1,id:'operations.command',name:'Operations command pod',roomTags:['operations'],teamTags:['operations'],
    slots:[
      {id:'desk',categories:['desk'],count:1},
      {id:'monitors',categories:['monitor'],count:3,preferredTags:['tech']},
      {id:'electronics',categories:['electronics'],count:1,optional:true},
      {id:'storage',categories:['storage'],count:1,optional:true},
      {id:'whiteboard',categories:['whiteboard'],count:1,optional:true},
    ],
  }),
};
