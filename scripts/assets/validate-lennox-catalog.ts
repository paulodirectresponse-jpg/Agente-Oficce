import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssetRegistry } from '../../src/agent-office/assets/assetRegistry.js';
import { CORE_ASSET_RECIPES, resolveAssetRecipe } from '../../src/agent-office/assets/assetRecipes.js';

const path=resolve(process.argv[2]??'public/office-assets/licensed/registry.json');
if(!existsSync(path))throw new Error(`Registry not found: ${path}`);
const registry=new AssetRegistry(JSON.parse(readFileSync(path,'utf8')));
const stats=registry.stats();
const errors:string[]=[];

if(stats.total<1500)errors.push(`catalog-size: expected >= 1500, found ${stats.total}`);

const minimums:Record<string,number>={
  architecture:80,desk:40,chair:40,monitor:35,storage:60,plant:50,door:25,glass:25,floor:30,
  character:250,electronics:35,table:25,seating:20,server:12,whiteboard:6,
};
for(const [category,min] of Object.entries(minimums)){
  const count=(stats.categories as Record<string,number|undefined>)[category]??0;
  if(count<min)errors.push(`category:${category}: expected >= ${min}, found ${count}`);
}

const roomMinimums:Record<string,number>={
  development:500,infra:150,research:300,operations:500,leadership:400,strategy:400,design:100,lobby:250,lounge:350,
};
for(const [room,min] of Object.entries(roomMinimums)){
  const count=registry.query({rooms:[room]}).length;
  if(count<min)errors.push(`room:${room}: expected >= ${min}, found ${count}`);
}

const packs=new Set(registry.list().map(a=>a.source.pack));
if(packs.size!==18)errors.push(`packs: expected 18, found ${packs.size}`);

for(const asset of registry.list()){
  if(asset.license.sourceRedistributionAllowed)errors.push(`license:redistribution:${asset.id}`);
  if(asset.license.aiTrainingAllowed)errors.push(`license:ai-training:${asset.id}`);
  if(!asset.license.runtimeBundlingAllowed)errors.push(`license:runtime-bundling-disabled:${asset.id}`);
}

for(const recipe of Object.values(CORE_ASSET_RECIPES)){
  const plan=resolveAssetRecipe(registry,recipe);
  if(plan.unresolved.length)errors.push(`recipe:${recipe.id}:${plan.unresolved.join(',')}`);
}

console.log(JSON.stringify({
  ok:errors.length===0,
  registry:path,
  totalAssets:stats.total,
  packCount:packs.size,
  families:stats.families,
  categories:stats.categories,
  recipes:Object.keys(CORE_ASSET_RECIPES),
  errors,
},null,2));
if(errors.length)process.exitCode=1;
