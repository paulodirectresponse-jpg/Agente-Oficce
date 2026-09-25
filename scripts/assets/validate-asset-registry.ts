import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AssetRegistry } from '../../src/agent-office/assets/assetRegistry.js';

const path=resolve(process.argv[2]??'public/office-assets/licensed/registry.json');
if(!existsSync(path))throw new Error(`Registry not found: ${path}`);
const registry=new AssetRegistry(JSON.parse(readFileSync(path,'utf8')));
const stats=registry.stats();

const minimums:Record<string,number>={
  architecture:12,desk:8,chair:8,monitor:6,storage:6,plant:6,decor:8,
};
const errors:string[]=[];
for(const [category,min] of Object.entries(minimums)){
  const count=(stats.categories as Record<string,number|undefined>)[category]??0;
  if(count<min)errors.push(`${category}: expected >= ${min}, found ${count}`);
}
const roomGates=['development','infra','research','operations','leadership','strategy','design','lobby','lounge'];
for(const room of roomGates){
  const count=registry.query({rooms:[room]}).length;
  if(count<5)errors.push(`room ${room}: expected >= 5 tagged assets, found ${count}`);
}
const duplicateUris=new Map<string,string>();
for(const a of registry.list()){
  const prior=duplicateUris.get(a.runtime.uri);
  if(prior)errors.push(`duplicate runtime URI: ${a.runtime.uri} (${prior}, ${a.id})`);
  duplicateUris.set(a.runtime.uri,a.id);
  if(a.license.sourceRedistributionAllowed)errors.push(`licensed asset incorrectly allows source redistribution: ${a.id}`);
  if(a.license.aiTrainingAllowed)errors.push(`licensed asset incorrectly allows AI training: ${a.id}`);
}

console.log(JSON.stringify({ok:errors.length===0,stats,errors},null,2));
if(errors.length)process.exitCode=1;
