import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { PreviewService } from './previewService.js';

describe('PreviewService',()=>{
  it('starts a managed local preview, reports health/logs and stops cleanly',async()=>{
    const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'ao-preview-')),root=path.join(dataDir,'project');fs.mkdirSync(root,{recursive:true});
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({scripts:{dev:'node server.cjs'}}));
    fs.writeFileSync(path.join(root,'server.cjs'),`const http=require('http');const port=Number(process.env.PORT);http.createServer((req,res)=>{res.end('ok')}).listen(port,'127.0.0.1',()=>console.log('ready:'+port));`);
    const db=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'office.sqlite'),logLevel:'silent'}),t=new Date().toISOString();
    db.connection.prepare(`INSERT INTO projects(id,name,root_path,git_enabled,git_branch,created_at,updated_at)VALUES('p','P',?,0,NULL,?,?)`).run(root,t,t);
    try{
      const svc=new PreviewService(db.connection),started=await svc.start('p');expect(started?.status).toBe('healthy');expect(started?.running).toBe(true);expect(started?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const logs=svc.logs('p');expect(logs?.command).toContain('npm run dev');expect(String(logs?.stdout)).toContain('ready:');
      const stopped=await svc.stop('p');expect(stopped?.status).toBe('stopped');expect(stopped?.running).toBe(false);
    }finally{db.connection.close();fs.rmSync(dataDir,{recursive:true,force:true})}
  },20000);
});
