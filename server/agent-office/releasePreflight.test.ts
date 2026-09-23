import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { setProjectRootSetting } from './appSettings.js';
import { runReleasePreflight } from './releasePreflight.js';

describe('Block 10 release preflight',()=>{
  it('blocks corrupted critical checks and permits optional warnings',async()=>{
    const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ao-preflight-test-'));
    const db=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'db.sqlite'),logLevel:'silent'});
    try{
      setProjectRootSetting(db.connection,path.join(dataDir,'projects'));
      const report=await runReleasePreflight(db.connection,false,{toolHealth:[
        {id:'files',status:'healthy',detail:'ok'},
        {id:'shell',status:'healthy',detail:'ok'},
        {id:'git',status:'healthy',detail:'ok'},
        {id:'github',status:'unavailable',detail:'optional'},
        {id:'browser',status:'unavailable',detail:'optional'},
        {id:'computer',status:'healthy',detail:'ok'},
      ]});
      expect(report.ready).toBe(true);
      expect(report.migration_version).toBe(23);
      expect(report.checks.find(x=>x.id==='runtime.github')).toMatchObject({status:'warn',blocking:false});
      expect(report.checks.filter(x=>x.blocking).every(x=>x.status==='pass')).toBe(true);
    }finally{
      db.connection.close();
      fs.rmSync(dataDir,{recursive:true,force:true});
    }
  });
});
