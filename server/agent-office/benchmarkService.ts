import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { openAgentOfficeDatabase, type AgentOfficeDatabase } from './database.js';
import { CapabilityMatcher, CapabilityRepository } from './capabilityCore.js';
import { OrchestratorGateway } from './orchestratorGateway.js';
import { ExecutionGraphService, ExecutionScheduler } from './executionGraph.js';
import { recoverInterruptedChatRuns } from './runtimeRecovery.js';
import { redactSecrets } from './securitySanitizer.js';
import { IntegrationRegistryService } from './integrationRegistry.js';

export interface RoutingGoldenScenario {
  id: string;
  message: string;
  expected_mode?: 'direct_agent'|'dynamic_team'|'existing_team'|'needs_gap_analysis';
  expected_agent?: string;
  max_workers?: number;
  required_capabilities?: string[];
}

export interface BenchmarkResult {
  id: string;
  category: 'routing'|'capability'|'execution'|'recovery'|'security'|'integration';
  status: 'pass'|'fail';
  duration_ms: number;
  assertions: Array<{ name:string; pass:boolean; expected?:unknown; actual?:unknown }>;
  metrics: Record<string,number|string|boolean|null>;
  error?: string;
}

export interface BenchmarkReport {
  schema_version: 1;
  generated_at: string;
  benchmark_version: string;
  environment: { node:string; platform:string; arch:string };
  summary: { total:number; passed:number; failed:number; duration_ms:number };
  results: BenchmarkResult[];
}

const now=()=>new Date().toISOString();
const assert=(name:string,pass:boolean,expected?:unknown,actual?:unknown)=>({name,pass,expected,actual});
const result=(id:string,category:BenchmarkResult['category'],started:number,assertions:BenchmarkResult['assertions'],metrics:BenchmarkResult['metrics']={},error?:unknown):BenchmarkResult=>({
  id,category,status:assertions.every(x=>x.pass)&&!error?'pass':'fail',duration_ms:Math.round((performance.now()-started)*100)/100,
  assertions,metrics,...(error?{error:error instanceof Error?error.message:String(error)}:{}),
});

function fixture():{database:AgentOfficeDatabase;dataDir:string;projectRoot:string;cleanup:()=>void}{
  const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-office-benchmark-'));
  const projectRoot=path.join(dataDir,'project');fs.mkdirSync(projectRoot,{recursive:true});
  const database=openAgentOfficeDatabase({dataDir,databasePath:path.join(dataDir,'benchmark.sqlite'),logLevel:'silent'});
  const t=now();
  database.connection.prepare("INSERT INTO projects(id,name,root_path,created_at,updated_at) VALUES('bench-project','Benchmark',?,?,?)").run(projectRoot,t,t);
  database.connection.prepare("INSERT INTO conversations(id,project_id,title,created_at,updated_at) VALUES('bench-conversation','bench-project','Benchmark',?,?)").run(t,t);
  database.connection.prepare("INSERT INTO providers(id,name,protocol_driver,enabled,created_at,updated_at) VALUES('bench-provider','Benchmark Provider','openai_chat',1,?,?)").run(t,t);
  database.connection.prepare("INSERT INTO provider_models(id,provider_id,model_id,display_name,enabled,created_at,updated_at) VALUES('bench-model','bench-provider','bench-model','Benchmark Model',1,?,?)").run(t,t);
  const caps=new CapabilityRepository(database.connection);caps.seed();
  const addAgent=(id:string,role:string,keys:string[])=>{
    database.connection.prepare("INSERT INTO agents(id,name,slug,role,description,provider_id,model_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,'bench-provider','bench-model',1,?,?)")
      .run(id,id,id,role,role,t,t);
    caps.replaceAgent(id,keys.map(capability_key=>({capability_key,declared_score:1,source:'manual'})));
  };
  addAgent('frontend-agent','Frontend React Engineer',['software','software.frontend','software.frontend.react']);
  addAgent('backend-agent','Backend API Engineer',['software','software.backend']);
  addAgent('qa-agent','QA Testing Reviewer',['software','software.testing']);
  addAgent('security-agent','Security Engineer',['security']);
  return{database,dataDir,projectRoot,cleanup(){database.connection.close();fs.rmSync(dataDir,{recursive:true,force:true})}};
}

async function routingBench(golden:RoutingGoldenScenario[]):Promise<BenchmarkResult[]>{
  const f=fixture();const out:BenchmarkResult[]=[];
  try{
    for(const scenario of golden){
      const started=performance.now();const assertions:BenchmarkResult['assertions']=[];
      try{
        const routed=await new OrchestratorGateway(f.database.connection).route({project_id:'bench-project',conversation_id:'bench-conversation',message:scenario.message,target:'auto'});
        const d=routed.decision;
        if(scenario.expected_mode)assertions.push(assert('target_mode',d.target_mode===scenario.expected_mode,scenario.expected_mode,d.target_mode));
        if(scenario.expected_agent)assertions.push(assert('target_agent',d.target_agent_id===scenario.expected_agent,scenario.expected_agent,d.target_agent_id));
        if(scenario.max_workers!=null){
          const count=d.workforce_resources.length||(d.target_agent_id?1:0);
          assertions.push(assert('max_workers',count<=scenario.max_workers,scenario.max_workers,count));
        }
        for(const key of scenario.required_capabilities??[]) assertions.push(assert('capability:'+key,d.required_capabilities.some(x=>x.key===key),true,d.required_capabilities.map(x=>x.key)));
        out.push(result(scenario.id,'routing',started,assertions,{level:routed.level,workers:d.workforce_resources.length||(d.target_agent_id?1:0)}));
      }catch(e){out.push(result(scenario.id,'routing',started,assertions,{},e))}
    }
  }finally{f.cleanup()}
  return out;
}

function capabilityBench():BenchmarkResult{
  const f=fixture(),started=performance.now(),assertions:BenchmarkResult['assertions']=[];
  try{
    const caps=new CapabilityRepository(f.database.connection);
    const t=now(),insert=f.database.connection.prepare("INSERT INTO agents(id,name,slug,role,description,provider_id,model_id,enabled,created_at,updated_at) VALUES(?,?,?,?,?,'bench-provider','bench-model',1,?,?)");
    for(let i=0;i<500;i++){
      const id='catalog-'+String(i).padStart(3,'0');insert.run(id,id,id,i===499?'React specialist':'General worker','',t,t);
      caps.replaceAgent(id,[{capability_key:i===499?'software.frontend.react':'operations',declared_score:1,source:'manual'}]);
    }
    const begin=performance.now();
    const matches=new CapabilityMatcher(f.database.connection).match([{key:'software.frontend.react',mandatory:true,minimum:.1}]);
    const elapsed=performance.now()-begin;
    const eligible=matches.filter(x=>x.eligible);
    assertions.push(assert('unique_specialist_selected',eligible[0]?.agent_id==='catalog-499','catalog-499',eligible[0]?.agent_id));
    assertions.push(assert('non_specialists_blocked',eligible.filter(x=>x.agent_id.startsWith('catalog-')&&x.agent_id!=='catalog-499').length===0,0,eligible.length));
    return result('capability-500-catalog','capability',started,assertions,{catalog_size:504,match_duration_ms:Math.round(elapsed*100)/100});
  }catch(e){return result('capability-500-catalog','capability',started,assertions,{},e)}
  finally{f.cleanup()}
}

async function executionBench():Promise<BenchmarkResult>{
  const f=fixture(),started=performance.now(),assertions:BenchmarkResult['assertions']=[];
  try{
    const graph=new ExecutionGraphService(f.database.connection);
    const plan=graph.createValidated({project_id:'bench-project',goal:'benchmark DAG',budget:{max_parallel:2,max_step_retries:1},steps:[
      {key:'plan',goal:'plan'},{key:'frontend',goal:'frontend'},{key:'backend',goal:'backend'},{key:'qa',goal:'qa'}
    ],dependencies:[
      {step_key:'frontend',depends_on_key:'plan'},{step_key:'backend',depends_on_key:'plan'},{step_key:'qa',depends_on_key:'frontend'},{step_key:'qa',depends_on_key:'backend'}
    ]})!;
    let active=0,peak=0;
    const scheduler=new ExecutionScheduler(f.database.connection,{execute:async(input:any)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,4));active--;return{summary:input.step_key,usage:{tokens:1}}}});
    await scheduler.tick(plan.id);await scheduler.tick(plan.id);await scheduler.tick(plan.id);
    const final=graph.getPlan(plan.id)!;
    assertions.push(assert('plan_completed',final.status==='completed','completed',final.status));
    assertions.push(assert('parallelism_observed',peak===2,2,peak));
    assertions.push(assert('all_steps_completed',final.steps.every((x:any)=>x.status==='completed'),true,final.steps.map((x:any)=>x.status)));
    return result('execution-dag-fanout-fanin','execution',started,assertions,{steps:final.steps.length,peak_parallel:peak});
  }catch(e){return result('execution-dag-fanout-fanin','execution',started,assertions,{},e)}
  finally{f.cleanup()}
}

function recoveryBench():BenchmarkResult{
  const f=fixture(),started=performance.now(),assertions:BenchmarkResult['assertions']=[];
  try{
    const t=now();
    f.database.connection.prepare("INSERT INTO chat_runs(id,conversation_id,project_id,agent_id,provider_id,model_id,status,mode,started_at,metadata_json) VALUES('orphan','bench-conversation','bench-project','backend-agent','bench-provider','bench-model','running','single',?,'{}')").run(t);
    f.database.connection.prepare("INSERT INTO agent_states(id,agent_id,project_id,state,activity,run_id,updated_at) VALUES('bench-state','backend-agent','bench-project','coding','benchmark','orphan',?)").run(t);
    recoverInterruptedChatRuns(f.database.connection);
    const run=f.database.connection.prepare("SELECT status,error_json FROM chat_runs WHERE id='orphan'").get() as any;
    const error=run?.error_json?JSON.parse(run.error_json):null;
    const state=f.database.connection.prepare("SELECT state,run_id FROM agent_states WHERE agent_id='backend-agent' AND project_id='bench-project'").get() as any;
    assertions.push(assert('orphan_failed_safely',run.status==='failed','failed',run.status));
    assertions.push(assert('recovery_error_recorded',error?.code==='RUN_INTERRUPTED_BY_RESTART','RUN_INTERRUPTED_BY_RESTART',error?.code));
    assertions.push(assert('worker_released',state?.state==='idle'&&state?.run_id==null,true,state));
    return result('recovery-interrupted-run','recovery',started,assertions,{});
  }catch(e){return result('recovery-interrupted-run','recovery',started,assertions,{},e)}
  finally{f.cleanup()}
}

async function integrationBench():Promise<BenchmarkResult>{
  const f=fixture(),started=performance.now(),assertions:BenchmarkResult['assertions']=[];
  try{
    const registry=new IntegrationRegistryService(f.database.connection);
    const catalog=registry.catalog();
    const browser=registry.list().find(x=>x.driver==='browser');
    const before=registry.availabilityForTool('railway_deploy','bench-project');
    await registry.create({driver:'railway',name:'Benchmark Railway',auth_mode:'cli'});
    const after=registry.availabilityForTool('railway_deploy','bench-project');
    assertions.push(assert('catalog_has_initial_drivers',['github','railway','supabase','browser'].every(driver=>catalog.some(x=>x.driver===driver)),true,catalog.map(x=>x.driver)));
    assertions.push(assert('browser_auto_registered',Boolean(browser),true,Boolean(browser)));
    assertions.push(assert('missing_external_connection_detected',before.managed&&!before.available,true,before.available));
    assertions.push(assert('configured_connection_becomes_eligible',after.available,true,after.available));
    return result('integration-registry-synthetic','integration',started,assertions,{catalog_size:catalog.length,connections:registry.list().length});
  }catch(e){return result('integration-registry-synthetic','integration',started,assertions,{},e)}
  finally{f.cleanup()}
}

function securityBench():BenchmarkResult{
  const started=performance.now();
  const raw={authorization:'Bearer abcdefghijklmnop',nested:{api_key:'sk-abcdefghijklmnop',safe:'ok'},args:['Bearer qwertyuiopasdfgh']};
  const redacted=redactSecrets(raw) as any;const json=JSON.stringify(redacted);
  const assertions=[
    assert('bearer_redacted',!json.includes('abcdefghijklmnop'),true,!json.includes('abcdefghijklmnop')),
    assert('nested_key_redacted',redacted.nested.api_key==='[REDACTED]','[REDACTED]',redacted.nested.api_key),
    assert('safe_value_preserved',redacted.nested.safe==='ok','ok',redacted.nested.safe),
    assert('array_secret_redacted',!json.includes('qwertyuiopasdfgh'),true,!json.includes('qwertyuiopasdfgh')),
  ];
  return result('security-secret-redaction','security',started,assertions,{});
}

export async function runBenchmarkSuite(golden:RoutingGoldenScenario[]):Promise<BenchmarkReport>{
  const started=performance.now();
  const results=[...(await routingBench(golden)),capabilityBench(),await executionBench(),recoveryBench(),securityBench(),await integrationBench()];
  const duration=Math.round((performance.now()-started)*100)/100;
  return{schema_version:1,generated_at:now(),benchmark_version:'1.1.0',environment:{node:process.version,platform:process.platform,arch:process.arch},summary:{total:results.length,passed:results.filter(x=>x.status==='pass').length,failed:results.filter(x=>x.status==='fail').length,duration_ms:duration},results};
}
