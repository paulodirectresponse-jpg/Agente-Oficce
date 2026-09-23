import crypto from 'node:crypto';
import fs from 'node:fs';
import childProcess from 'node:child_process';

const readJson=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const pkg=readJson('package.json');
const db=fs.readFileSync('server/agent-office/database.ts','utf8');
const versions=[...db.matchAll(/version:\s*(\d+)/g)].map(x=>Number(x[1]));
const migration=Math.max(...versions);
const sha=process.env.GITHUB_SHA||childProcess.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const msi=process.argv[2]||process.env.AGENT_OFFICE_MSI||'';
let artifact=null;
if(msi&&fs.existsSync(msi)){
  const bytes=fs.readFileSync(msi);
  artifact={path:msi,size_bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
}
let benchmark=null,preflight=null;
if(fs.existsSync('artifacts/release/benchmark-results.json'))benchmark=readJson('artifacts/release/benchmark-results.json');
if(fs.existsSync('artifacts/release/preflight.json'))preflight=readJson('artifacts/release/preflight.json');
const manifest={
  schema_version:1,
  product:'Agent Office',
  version:pkg.version,
  git_sha:sha,
  migration_version:migration,
  generated_at:new Date().toISOString(),
  workflow_run_id:process.env.GITHUB_RUN_ID||null,
  workflow_run_attempt:process.env.GITHUB_RUN_ATTEMPT||null,
  benchmark:benchmark?{mode:benchmark.mode,rounds:benchmark.rounds,failed:benchmark.failed,reports:benchmark.reports?.map(r=>r.summary)}:null,
  preflight:preflight?{ready:preflight.ready,migration_version:preflight.migration_version}:null,
  artifact,
};
fs.mkdirSync('artifacts/release',{recursive:true});
fs.writeFileSync('artifacts/release/release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
