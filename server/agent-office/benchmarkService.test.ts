import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runBenchmarkSuite, type RoutingGoldenScenario } from './benchmarkService.js';

describe('Block 10 benchmark gate',()=>{
  it('passes the deterministic golden set without paid providers',async()=>{
    const golden=JSON.parse(fs.readFileSync(path.resolve('benchmarks/golden/routing.json'),'utf8')) as RoutingGoldenScenario[];
    const report=await runBenchmarkSuite(golden);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(report.summary.total);
    expect(report.results.some(x=>x.category==='routing')).toBe(true);
    expect(report.results.some(x=>x.id==='capability-500-catalog')).toBe(true);
    expect(report.results.some(x=>x.category==='execution')).toBe(true);
    expect(report.results.some(x=>x.category==='recovery')).toBe(true);
    expect(report.results.some(x=>x.category==='security')).toBe(true);
    expect(report.results.some(x=>x.category==='integration')).toBe(true);
  },30000);
});
