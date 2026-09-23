import fs from 'node:fs';
import path from 'node:path';
import { runBenchmarkSuite, type RoutingGoldenScenario } from '../server/agent-office/benchmarkService.js';

const stress=process.argv.includes('--stress');
const goldenPath=path.resolve('benchmarks/golden/routing.json');
const golden=JSON.parse(fs.readFileSync(goldenPath,'utf8')) as RoutingGoldenScenario[];
const rounds=stress?10:1;
const reports=[];
let failed=0;
for(let i=0;i<rounds;i++){
  const report=await runBenchmarkSuite(golden);
  reports.push(report);
  failed+=report.summary.failed;
  console.log(`Benchmark round ${i+1}/${rounds}: ${report.summary.passed}/${report.summary.total} passed in ${report.summary.duration_ms}ms`);
  for(const item of report.results) console.log(`  [${item.status.toUpperCase()}] ${item.category}/${item.id} ${item.duration_ms}ms`);
}
fs.mkdirSync('artifacts/release',{recursive:true});
const payload={schema_version:1,mode:stress?'stress':'standard',rounds,generated_at:new Date().toISOString(),failed,reports};
fs.writeFileSync('artifacts/release/benchmark-results.json',JSON.stringify(payload,null,2)+'\n');
if(failed){
  console.error(`Benchmark gate failed: ${failed} scenario failures.`);
  process.exit(1);
}
console.log('Benchmark gate passed.');
