import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getAgentOfficeConfig, ensureAgentOfficeDataDir } from '../agent-office/config.js';

export const roomAssetRouter=Router();

function assetRoot(){
  const config=getAgentOfficeConfig();
  ensureAgentOfficeDataDir(config);
  return path.join(config.dataDir,'licensed-assets');
}

roomAssetRouter.get('/room-assets/status',(_req,res)=>{
  const root=assetRoot();
  const registry=path.join(root,'registry.json');
  const files=path.join(root,'files');
  const calibration=path.join(root,'calibration.json');
  res.json({
    ok:true,
    data:{
      installed:fs.existsSync(registry)&&fs.existsSync(files)&&fs.existsSync(calibration),
      root,
      registry_exists:fs.existsSync(registry),
      files_exists:fs.existsSync(files),
      calibration_exists:fs.existsSync(calibration),
    },
  });
});

roomAssetRouter.get('/room-assets/registry',(_req,res)=>{
  const file=path.join(assetRoot(),'registry.json');
  if(!fs.existsSync(file)){
    res.status(404).json({ok:false,error:{code:'ROOM_ASSET_REGISTRY_NOT_FOUND',message:'Licensed room assets are not installed.'}});
    return;
  }
  try{
    const payload=JSON.parse(fs.readFileSync(file,'utf8'));
    res.json({ok:true,data:payload});
  }catch(error){
    res.status(500).json({ok:false,error:{code:'ROOM_ASSET_REGISTRY_INVALID',message:error instanceof Error?error.message:'Invalid room asset registry.'}});
  }
});


roomAssetRouter.get('/room-assets/calibration',(_req,res)=>{
  const file=path.join(assetRoot(),'calibration.json');
  if(!fs.existsSync(file)){
    res.status(404).json({ok:false,error:{code:'ROOM_ASSET_CALIBRATION_NOT_FOUND',message:'Licensed room asset calibration is not installed.'}});
    return;
  }
  try{
    const payload=JSON.parse(fs.readFileSync(file,'utf8'));
    res.json({ok:true,data:payload});
  }catch(error){
    res.status(500).json({ok:false,error:{code:'ROOM_ASSET_CALIBRATION_INVALID',message:error instanceof Error?error.message:'Invalid room asset calibration.'}});
  }
});

roomAssetRouter.get('/room-assets/files/:name',(req,res)=>{
  const name=String(req.params.name||'');
  if(!/^[a-z0-9._-]+\.png$/i.test(name)){
    res.status(400).json({ok:false,error:{code:'ROOM_ASSET_FILE_INVALID',message:'Invalid asset filename.'}});
    return;
  }
  const root=path.resolve(assetRoot(),'files');
  const file=path.resolve(root,name);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){
    res.status(404).json({ok:false,error:{code:'ROOM_ASSET_FILE_NOT_FOUND',message:'Licensed room asset file not found.'}});
    return;
  }
  res.setHeader('Cache-Control','private, max-age=3600');
  res.sendFile(file);
});
