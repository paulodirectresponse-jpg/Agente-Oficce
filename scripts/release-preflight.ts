import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from '../server/agent-office/database.js';
import { setProjectRootSetting } from '../server/agent-office/appSettings.js';
import { runReleasePreflight } from '../server/agent-office/releasePreflight.js';

const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-office-preflight-'));
const root=path.join(dataDir,'projects');
const db=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'preflight.sqlite'),logLevel:'silent'});
try{
  setProjectRootSetting(db.connection,root);
  const report=await runReleasePreflight(db.connection,false);
  fs.mkdirSync('artifacts/release',{recursive:true});
  fs.writeFileSync('artifacts/release/preflight.json',JSON.stringify(report,null,2)+'\n');
  for(const check of report.checks) console.log(`[${check.status.toUpperCase()}] ${check.label}: ${check.detail}${check.blocking?' [blocking]':''}`);
  if(!report.ready){console.error('Release preflight blocked.');process.exitCode=1}
  else console.log('Release preflight passed.');
}finally{
  db.connection.close();
  fs.rmSync(dataDir,{recursive:true,force:true});
}
