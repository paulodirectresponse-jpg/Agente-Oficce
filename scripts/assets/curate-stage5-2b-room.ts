/**
 * Curates private, licensed room props without committing source art.
 * Usage: npx tsx scripts/assets/curate-stage5-2b-room.ts <runtime-dir> <corporate-pack-dir> <luxury-pack-dir> [clean-chair.png]
 */
import {copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {AssetRegistrySchema} from '../../src/agent-office/assets/assetRegistry.js';
import {AssetCalibrationCatalogSchema,deriveCalibration} from '../../src/agent-office/assets/assetCalibration.js';
import {pngAlphaBounds} from './png-alpha-bounds.js';

const [runtimeArg,packArg,luxuryArg,cleanChairArg]=process.argv.slice(2);
if(!runtimeArg||!packArg||!luxuryArg)throw new Error('Pass the private runtime directory, extracted Corporate pack directory, and extracted Luxury pack directory.');
const runtime=resolve(runtimeArg),pack=resolve(packArg),luxury=resolve(luxuryArg);
const registryPath=join(runtime,'registry.json'),calibrationPath=join(runtime,'calibration.json');
const registry=AssetRegistrySchema.parse(JSON.parse(readFileSync(registryPath,'utf8')));
const catalog=AssetCalibrationCatalogSchema.parse(JSON.parse(readFileSync(calibrationPath,'utf8')));
const entries=[
  {id:'plant.corporate.016.small.desk.pot',file:'016_small_desk_plant_pot.png',category:'plant' as const,scale:.30,tags:['desk','small','development']},
  {id:'decor.corporate.069.small.blue.book',file:'069_small_blue_desktop_book.png',category:'decor' as const,scale:.28,tags:['desk','book','development']},
];

for(const entry of entries){
  const originalPath=`02_Decorations/Individual_PNG/${entry.file}`;
  const source=join(pack,'02_Decorations','Individual_PNG',entry.file);
  const buffer=readFileSync(source);
  const bounds=pngAlphaBounds(buffer);
  const out=join(runtime,'files',`${entry.id}.png`);
  copyFileSync(source,out);
  const existing=registry.assets.find(a=>a.id===entry.id);
  const template=registry.assets.find(a=>a.id==='plant.prop.037.medium.square.planter.plant.212fc9ff2f');
  if(!template)throw new Error('Private runtime is missing the calibrated plant template.');
  const asset={...template,
    id:entry.id,name:entry.file.replace(/\.png$/,'').replaceAll('_',' '),
    category:entry.category,family:entry.id.replace(/\.\d+\..*/,''),variant:'development-desk',
    source:{pack:'LennoxStudio_Corporate_Office_Asset_Pack_v1.2',originalPath,sha256:createHash('sha256').update(buffer).digest('hex')},
    runtime:{...template.runtime,uri:`/office-assets/licensed/files/${entry.id}.png`,widthPx:buffer.readUInt32BE(16),heightPx:buffer.readUInt32BE(20),anchor:{x:.5,y:1},footprint:{width:1,height:1,unit:'tile' as const},layer:'surface' as const,collision:'none' as const},
    interaction:'none' as const,tags:entry.tags,roomTags:['development'],teamTags:['development'],styleTags:['pixel-art','office'],rotation:'none' as const,
    license:{...template.license,sourcePack:'LennoxStudio_Corporate_Office_Asset_Pack_v1.2'},
  };
  if(existing)Object.assign(existing,asset);else registry.assets.push(asset);
  const calibration=deriveCalibration(asset,{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},32,{canonicalScale:entry.scale,confidence:'curated',notes:['Private licensed desk accent, calibrated for the Development prefab.']});
  const previous=catalog.assets.findIndex(a=>a.assetId===entry.id);
  if(previous>=0)catalog.assets[previous]=calibration;else catalog.assets.push(calibration);
}

{
  const id='architecture.luxury.05.straight.interior.wall';
  const originalPath='02_Individual_Transparent_PNG/05_architecture_modules/05_straight_interior_wall.png';
  const source=join(luxury,...originalPath.split('/'));
  const buffer=readFileSync(source),bounds=pngAlphaBounds(buffer);
  copyFileSync(source,join(runtime,'files',`${id}.png`));
  const template=registry.assets.find(a=>a.id==='architecture.architecture.005.outer.wall.horizontal.482ac5b7cd');
  if(!template)throw new Error('Private runtime is missing the shell wall template.');
  const asset={...template,id,name:'straight interior wall',category:'architecture' as const,family:'architecture.luxury.straight.interior.wall',variant:'cream',
    source:{pack:'LennoxStudio_Luxury_Office_Pixel_Art_Asset_Pack_v1.0',originalPath,sha256:createHash('sha256').update(buffer).digest('hex')},
    runtime:{...template.runtime,uri:`/office-assets/licensed/files/${id}.png`,widthPx:buffer.readUInt32BE(16),heightPx:buffer.readUInt32BE(20),anchor:{x:.5,y:1},footprint:{width:8,height:4,unit:'tile' as const},collision:'none' as const},
    tags:['architecture','modular','development'],roomTags:['development'],teamTags:['general'],styleTags:['pixel-art','office'],
    license:{...template.license,sourcePack:'LennoxStudio_Luxury_Office_Pixel_Art_Asset_Pack_v1.0'},
  };
  const previous=registry.assets.findIndex(a=>a.id===id);
  if(previous>=0)registry.assets[previous]=asset;else registry.assets.push(asset);
  const calibration=deriveCalibration(asset,{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},32,{canonicalScale:.8,confidence:'curated',notes:['Modular cream interior wall for the Development upper perimeter.']});
  const old=catalog.assets.findIndex(a=>a.assetId===id);
  if(old>=0)catalog.assets[old]=calibration;else catalog.assets.push(calibration);
}

{
  const id='floor.luxury.01.warm.oak.patch';
  const originalPath='02_Individual_Transparent_PNG/05_architecture_modules/01_warm_oak_floor_patch.png';
  const source=join(luxury,...originalPath.split('/'));
  const buffer=readFileSync(source);
  copyFileSync(source,join(runtime,'files',`${id}.png`));
  const template=registry.assets.find(a=>a.id==='floor.architecture.001.floor.wood.plank.tile.3957bd6a02');
  if(!template)throw new Error('Private runtime is missing the floor template.');
  const asset={...template,id,name:'warm oak floor patch',category:'floor' as const,family:'floor.luxury.warm.oak.patch',variant:'borderless-tile',
    source:{pack:'LennoxStudio_Luxury_Office_Pixel_Art_Asset_Pack_v1.0',originalPath,sha256:createHash('sha256').update(buffer).digest('hex')},
    runtime:{...template.runtime,uri:`/office-assets/licensed/files/${id}.png`,widthPx:buffer.readUInt32BE(16),heightPx:buffer.readUInt32BE(20),footprint:{width:5,height:5,unit:'tile' as const}},
    tags:['floor','oak','development'],roomTags:['development'],teamTags:['general'],styleTags:['pixel-art','office'],
    license:{...template.license,sourcePack:'LennoxStudio_Luxury_Office_Pixel_Art_Asset_Pack_v1.0'},
  };
  const previous=registry.assets.findIndex(a=>a.id===id);
  if(previous>=0)registry.assets[previous]=asset;else registry.assets.push(asset);
  // The outer four pixels are an illustrated patch border, not floor texture.
  const sourceRect={x:20,y:20,width:271,height:263};
  const calibration=deriveCalibration(asset,sourceRect,32,{canonicalScale:.6,confidence:'curated',notes:['Use the interior plank field; omit the opaque illustrated patch border when repeating.']});
  const old=catalog.assets.findIndex(a=>a.assetId===id);
  if(old>=0)catalog.assets[old]=calibration;else catalog.assets.push(calibration);
}

if(cleanChairArg){
  const id='seating.012.p01.12.teal.lounge.armchair.9440121898';
  const asset=registry.assets.find(a=>a.id===id);
  const previous=catalog.assets.findIndex(a=>a.assetId===id);
  if(!asset||previous<0)throw new Error('Private runtime is missing the lounge armchair.');
  const buffer=readFileSync(resolve(cleanChairArg));
  const bounds=pngAlphaBounds(buffer);
  copyFileSync(resolve(cleanChairArg),join(runtime,'files',`${id}.png`));
  asset.runtime.widthPx=buffer.readUInt32BE(16);asset.runtime.heightPx=buffer.readUInt32BE(20);
  asset.tags=[...new Set([...asset.tags,'curated-alpha-clean'])];
  catalog.assets[previous]=deriveCalibration(asset,{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},32,{canonicalScale:.1,confidence:'curated',notes:['Licensed armchair derivative with opaque floor patch removed.']});
}

writeFileSync(registryPath,JSON.stringify(registry,null,2)+'\n');
writeFileSync(calibrationPath,JSON.stringify(catalog,null,2)+'\n');
console.log(`Curated ${entries.length} desk accents, modular wall${cleanChairArg?' and alpha-clean armchair':''} in ${runtime}`);
