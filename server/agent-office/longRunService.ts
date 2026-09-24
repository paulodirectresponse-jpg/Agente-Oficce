import type { Database } from 'better-sqlite3';
import { ChatRunnerService, type PreparedChatRun } from './chatRunner.js';
import { ExecutionGraphService, ExecutionScheduler, type PlanDraft, type StepExecutor, type WorkPacket } from './executionGraph.js';
import { DurableExecutionService } from './durableExecution.js';
import { DevelopmentSecretStore } from './secretStore.js';
import { getAgentOfficeConfig } from './config.js';
import { WorkspaceService } from './workspaceService.js';
import { MessageRepository } from './conversationRepository.js';
import { ChatRunRepository, ActivityRepository } from './v2DataModel.js';
import { chatEventHub } from './chatEventHub.js';
import type { RoutingDecision } from './orchestratorGateway.js';

const DAY_MS=24*60*60*1000;
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const now=()=>new Date().toISOString();

export interface GoalContract {
  objective:string;
  original_request:string;
  constraints:string[];
  definition_of_done:string[];
  quality_policy:{
    require_evidence:boolean;
    require_review:boolean;
    require_validation:boolean;
    allow_replan:boolean;
  };
}

export function shouldUseLongRun(message:string,decision:RoutingDecision):boolean{
  const text=message.toLowerCase();
  const explicit=/\b(at[eé] terminar|at[eé] concluir|s[oó] pare|n[aã]o pare|until[- ]?done|horas|24\s*h|completo|inteiro|do zero|end[- ]to[- ]end)\b/i.test(text);
  const action=/\b(fa[cç]a|crie|construa|implemente|refa[cç]a|corrija|programe|desenvolva|migre|integre|publique|teste|finalize|arrume|edite)\b/i.test(text);
  const projectWork=/\b(site|app|aplicativo|sistema|projeto|c[oó]digo|backend|frontend|api|banco|database|deploy|build|bug|arquitetura|software)\b/i.test(text);
  return explicit||(decision.requires_plan&&decision.complexity==='high'&&action&&projectWork);
}

function goalContract(message:string):GoalContract{
  const software=/\b(site|app|aplicativo|sistema|c[oó]digo|backend|frontend|api|banco|database|deploy|build|bug|software)\b/i.test(message);
  const done=[
    'O objetivo original foi atendido integralmente, sem trocar o escopo por uma solução parcial.',
    'Nenhum erro crítico conhecido permanece sem tratamento.',
    'As alterações relevantes foram revisadas contra o pedido original.',
  ];
  if(software)done.push(
    'A implementação compila ou gera build com sucesso quando o projeto possuir etapa de build.',
    'Testes automatizados existentes devem passar; falhas novas precisam ser corrigidas ou justificadas com evidência.',
    'Um smoke test coerente com o projeto deve validar o caminho principal alterado.',
  );
  return{
    objective:message.trim(),
    original_request:message.trim(),
    constraints:[
      'Preservar funcionalidades existentes que não fazem parte da mudança.',
      'Preferir correções verificáveis a alegações de conclusão sem evidência.',
      'Não encerrar somente porque uma resposta foi gerada; encerrar quando os critérios de conclusão forem satisfeitos.',
    ],
    definition_of_done:done,
    quality_policy:{require_evidence:true,require_review:true,require_validation:true,allow_replan:true},
  };
}

function planDraft(input:{
  project_id:string;
  orchestration_run_id:string;
  decision:RoutingDecision;
  contract:GoalContract;
  selected_agents:string[];
  selected_subagents:string[];
}):PlanDraft{
  const team=input.decision.target_team_id??null;
  const direct=input.selected_agents.length===1&&!input.selected_subagents.length&&!team?input.selected_agents[0]:null;
  const assign=(step:any)=>({...step,assigned_agent_id:direct,assigned_team_id:direct?null:team});
  const common={risk:'medium' as const,retry_policy:{max_retries:3},timeout_ms:45*60*1000};
  const steps=[
    assign({key:'01_inspect_plan',title:'Analisar e planejar',goal:[
      'Inspecione rigorosamente o projeto e o pedido original.',
      'Entenda a arquitetura existente antes de alterar arquivos.',
      'Crie um plano operacional detalhado para cumprir o Goal Contract.',
      'Identifique riscos, dependências, testes e critérios verificáveis.',
      'Não encerre com teoria: prepare a execução concreta das próximas etapas.'
    ].join(' '),...common,priority:100,expected_outputs:['Plano operacional','Riscos e dependências'],success_criteria:['Escopo compreendido','Plano cobre o objetivo original']}),
    assign({key:'02_implement',title:'Implementar',goal:[
      'Execute integralmente o plano definido na etapa anterior.',
      'Faça as alterações necessárias no projeto usando as ferramentas disponíveis.',
      'Não entregue somente trechos ou sugestões se o objetivo exigir implementação real.',
      'Preserve compatibilidade e registre decisões importantes.'
    ].join(' '),...common,priority:90,expected_outputs:['Implementação funcional','Arquivos alterados'],success_criteria:['Mudanças concretas realizadas','Objetivo funcional implementado']}),
    assign({key:'03_review_fix',title:'Revisar e corrigir',goal:[
      'Atue como revisor crítico independente da implementação anterior.',
      'Procure bugs, lacunas, regressões, simplificações indevidas, inconsistências e requisitos esquecidos.',
      'Corrija diretamente todos os problemas encontrados quando houver ferramentas para isso.',
      'Revise novamente após corrigir. Não aprove trabalho sem evidência.'
    ].join(' '),...common,priority:80,expected_outputs:['Revisão crítica','Correções adicionais'],success_criteria:['Problemas críticos corrigidos','Implementação coerente com o pedido']}),
    assign({key:'04_validate',title:'Testar e validar',goal:[
      'Valide a solução de forma objetiva.',
      'Execute os testes relevantes, typecheck, build e smoke tests que façam sentido para este projeto.',
      'Se qualquer validação falhar por causa das alterações, investigue e corrija antes de concluir.',
      'Termine a resposta com exatamente QUALITY_GATE: PASS somente se as validações relevantes estiverem satisfatórias; caso contrário use QUALITY_GATE: REVISE.'
    ].join(' '),...common,priority:70,expected_outputs:['Resultados de testes','Build/smoke quando aplicável'],success_criteria:['Validações relevantes aprovadas','QUALITY_GATE: PASS']}),
    assign({key:'05_final_audit',title:'Auditoria final',goal:[
      'Faça uma auditoria final usando o pedido ORIGINAL e o Goal Contract como fonte de verdade.',
      'Compare item por item o que foi pedido com o estado atual real do projeto.',
      'Não confie apenas nos resumos das etapas anteriores: inspecione evidências e estado atual.',
      'Corrija qualquer lacuna residual que ainda possa ser resolvida.',
      'Termine com exatamente QUALITY_GATE: PASS apenas quando o objetivo original e a Definition of Done estiverem cumpridos; caso contrário use QUALITY_GATE: REVISE.'
    ].join(' '),...common,priority:60,expected_outputs:['Auditoria contra objetivo original','Correções finais'],success_criteria:['Definition of Done satisfeita','QUALITY_GATE: PASS']}),
    assign({key:'06_delivery',title:'Preparar entrega',goal:[
      'Prepare a entrega final ao usuário.',
      'Resuma o que foi feito, as validações executadas, as evidências mais importantes e qualquer limitação real remanescente.',
      'Não invente sucesso. Seja conciso, mas deixe claro que o objetivo foi validado.'
    ].join(' '),...common,priority:50,expected_outputs:['Relatório final verificável'],success_criteria:['Entrega clara e baseada em evidência']}),
  ];
  const dependencies=[
    {step_key:'02_implement',depends_on_key:'01_inspect_plan'},{step_key:'03_review_fix',depends_on_key:'02_implement'},
    {step_key:'04_validate',depends_on_key:'03_review_fix'},{step_key:'05_final_audit',depends_on_key:'04_validate'},
    {step_key:'06_delivery',depends_on_key:'05_final_audit'},
  ];
  return{
    project_id:input.project_id,
    orchestration_run_id:input.orchestration_run_id,
    goal:input.contract.objective,
    rationale:'Automatic long-running execution selected by the unified work router.',
    budget:{
      max_agents:8,max_parallel:3,max_cost:1000,max_tokens:2_000_000,max_wall_time:DAY_MS,
      max_step_retries:3,max_tool_calls:500,max_replans:5,max_delegation_depth:4,
    },
    steps,dependencies,
  };
}

function json<T>(value:string|undefined|null,fallback:T):T{try{return value?JSON.parse(value):fallback}catch{return fallback}}

class ChatStepExecutor implements StepExecutor{
  private readonly runs:ChatRunRepository;
  constructor(
    private readonly db:Database,
    private readonly rootRunId:string,
    private readonly conversationId:string,
    private readonly projectId:string,
    private readonly contract:GoalContract,
    private readonly selectedAgents:string[],
    private readonly selectedSubagents:string[],
    private readonly modelOverride?:string,
    private readonly signal?:AbortSignal,
  ){this.runs=new ChatRunRepository(db)}

  private evidence(planId:string){
    const rows=this.db.prepare('SELECT type,payload_json FROM execution_artifacts WHERE plan_id=? ORDER BY created_at').all(planId) as any[];
    return rows.slice(-12).map(row=>({type:row.type,payload:json(row.payload_json,{})}));
  }

  private orientations(planId:string){
    const rows=this.db.prepare("SELECT id,payload_json FROM execution_commands WHERE plan_id=? AND status='pending' AND command_type IN ('orient','enqueue_message') ORDER BY created_at").all(planId) as any[];
    if(!rows.length)return[];
    const t=now();
    for(const row of rows)this.db.prepare("UPDATE execution_commands SET status='applied',applied_at=? WHERE id=?").run(t,row.id);
    return rows.map(row=>json<any>(row.payload_json,{}).message).filter((x:any)=>typeof x==='string'&&x.trim());
  }

  async execute(input:{plan_id:string;step_id:string;step_key:string;agent_id:string|null;subagent_id?:string|null;worker_kind?:'agent'|'subagent'|null;team_id?:string|null;goal:string;timeout_ms:number;work_packet?:WorkPacket}){
    if(this.signal?.aborted)throw new Error('CHAT_RUN_CANCELLED');
    const workspace=new WorkspaceService(this.db);
    const before=workspace.gitStatus(this.projectId);
    const stepRow=this.db.prepare('SELECT title,success_criteria_json,expected_outputs_json FROM execution_steps WHERE id=?').get(input.step_id) as any;
    const evidence=this.evidence(input.plan_id);
    const orientations=this.orientations(input.plan_id);
    const prompt=[
      'INTERNAL DURABLE EXECUTION STEP. Do the work; do not merely describe how to do it.',
      'You are operating as part of a long-running Agent Office execution. The user only sees the final consolidated delivery.',
      '',
      'GOAL CONTRACT:',
      JSON.stringify(this.contract,null,2),
      '',
      `CURRENT STEP: ${input.step_key} — ${stepRow?.title??input.step_key}`,
      input.goal,
      '',
      'SUCCESS CRITERIA:',
      JSON.stringify(json(stepRow?.success_criteria_json,[]),null,2),
      '',
      'RECENT EVIDENCE FROM PREVIOUS STEPS:',
      JSON.stringify(evidence,null,2),
      orientations.length?'\nUSER ORIENTATIONS RECEIVED DURING EXECUTION:\n'+orientations.map(x=>'- '+x).join('\n'):'',
      '',
      'Rules: inspect actual state, use tools when needed, persist real changes, verify claims, and continue until this step is genuinely complete.',
    ].filter(Boolean).join('\n');

    const service=new ChatRunnerService(this.db,new DevelopmentSecretStore(getAgentOfficeConfig().dataDir));
    const chosenAgents=input.agent_id?[input.agent_id]:this.selectedAgents;
    const chosenSubs=input.subagent_id?[input.subagent_id]:this.selectedSubagents;
    const prepared=service.prepare({
      project_id:this.projectId,conversation_id:this.conversationId,message:prompt,
      target:(chosenAgents.length+chosenSubs.length)>1?'team':chosenAgents[0]??'auto',
      selected_agent_ids:chosenAgents.length?chosenAgents:undefined,
      selected_subagent_ids:chosenSubs.length?chosenSubs:undefined,
      model_override:(chosenAgents.length+chosenSubs.length)===1?this.modelOverride:undefined,
      internal:true,parent_run_id:this.rootRunId,execution_plan_id:input.plan_id,execution_step_id:input.step_id,
    });
    await service.execute(prepared,this.signal);
    const finished=this.runs.get(prepared.run.id);
    if(!finished||finished.status!=='completed')throw new Error(finished?.error?.message?String(finished.error.message):'EXECUTION_INTERNAL_RUN_FAILED');
    const finalId=typeof finished.metadata?.final_message_id==='string'?finished.metadata.final_message_id:null;
    const msg=finalId?this.db.prepare('SELECT content FROM messages WHERE id=?').get(finalId) as {content:string}|undefined:undefined;
    const text=msg?.content?.trim()||'';
    const after=workspace.gitStatus(this.projectId);
    const diff=workspace.gitDiff(this.projectId);
    const gate=/^(04_validate|05_final_audit)$/.test(input.step_key);
    if(gate&&!/QUALITY_GATE:\s*PASS\b/i.test(text))throw new Error('EXECUTION_QUALITY_GATE_FAILED');
    return{
      summary:text.slice(0,12000),
      artifacts:[{
        type:'evidence',
        payload:{
          step_key:input.step_key,internal_run_id:prepared.run.id,
          git_head_before:before.head,git_head_after:after.head,
          changed_files:after.files.slice(0,100),diff_additions:diff.additions,diff_deletions:diff.deletions,
          quality_gate:gate?(/QUALITY_GATE:\s*PASS\b/i.test(text)?'pass':'revise'):'not_required',
          completed_at:now(),
        }
      }],
      usage:{
        tokens:Number(finished.input_tokens||0)+Number(finished.output_tokens||0),
        tool_calls:Number(finished.metadata?.tool_steps||0),
      },
    };
  }
}

export class LongRunService{
  private readonly runs:ChatRunRepository;
  private readonly messages:MessageRepository;
  private readonly activity:ActivityRepository;
  constructor(private readonly db:Database){this.runs=new ChatRunRepository(db);this.messages=new MessageRepository(db);this.activity=new ActivityRepository(db)}

  create(prepared:PreparedChatRun,orchestration:{orchestration_run_id:string;decision:RoutingDecision},message:string){
    const contract=goalContract(message);
    const draft=planDraft({
      project_id:prepared.run.project_id,orchestration_run_id:orchestration.orchestration_run_id,
      decision:orchestration.decision,contract,selected_agents:prepared.selected_agents,selected_subagents:prepared.selected_subagents,
    });
    const plan=new ExecutionGraphService(this.db).createValidated(draft) as any;
    const t=now();
    this.db.prepare("INSERT INTO execution_artifacts(id,plan_id,step_id,type,uri,payload_json,created_at)VALUES(lower(hex(randomblob(16))),?,NULL,'goal_contract',NULL,?,?)").run(plan.id,JSON.stringify(contract),t);
    this.db.prepare("INSERT INTO execution_artifacts(id,plan_id,step_id,type,uri,payload_json,created_at)VALUES(lower(hex(randomblob(16))),?,NULL,'mission_config',NULL,?,?)").run(plan.id,JSON.stringify({
      root_run_id:prepared.run.id,conversation_id:prepared.conversation_id,project_id:prepared.run.project_id,
      selected_agents:prepared.selected_agents,selected_subagents:prepared.selected_subagents,model_override:prepared.model_override??null,
      orchestration_run_id:orchestration.orchestration_run_id,original_request:message,
    }),t);
    this.runs.update(prepared.run.id,{metadata:{...prepared.run.metadata,execution_plan_id:plan.id,long_running:true,goal_contract:contract}});
    this.emit(prepared.run.id,prepared.run.project_id,'worker.state',{state:'planning',activity:'Execução longa preparada',execution_plan_id:plan.id});
    return{plan,contract};
  }

  async run(planId:string,rootRunId:string,signal?:AbortSignal):Promise<void>{
    let currentPlanId=planId;
    let providerWaitStarted=0;
    try{
      while(true){
        if(signal?.aborted){this.cancelPlan(currentPlanId);throw new Error('CHAT_RUN_CANCELLED')}
        this.applyControlCommands(currentPlanId);
        const plan=new ExecutionGraphService(this.db).getPlan(currentPlanId) as any;
        if(!plan)throw new Error('EXECUTION_PLAN_NOT_FOUND');
        if(plan.status==='cancelled')throw new Error('CHAT_RUN_CANCELLED');
        if(plan.status==='completed'){await this.finishSuccess(currentPlanId,rootRunId);return}
        if(plan.status==='failed'){
          const next=this.autoReplan(currentPlanId);
          if(next){currentPlanId=next;continue}
          throw new Error('EXECUTION_LONG_RUN_FAILED');
        }

        const config=this.loadMissionConfig(currentPlanId);
        const contract=this.loadGoalContract(currentPlanId);
        const executor=new ChatStepExecutor(
          this.db,rootRunId,config.conversation_id,config.project_id,contract,
          config.selected_agents??[],config.selected_subagents??[],config.model_override??undefined,signal,
        );
        const scheduler=new ExecutionScheduler(this.db,executor);
        const before=this.stepProgress(currentPlanId);
        this.emit(rootRunId,config.project_id,'worker.state',{state:'working',activity:`Executando etapa ${before.completed+1} de ${before.total}`,execution_plan_id:currentPlanId,progress:before.total?before.completed/before.total:0});
        const result=await scheduler.tick(currentPlanId);
        const afterPlan=new ExecutionGraphService(this.db).getPlan(currentPlanId) as any;
        const after=this.stepProgress(currentPlanId);
        this.emit(rootRunId,config.project_id,'worker.state',{state:'reviewing',activity:`${after.completed} de ${after.total} etapas concluídas`,execution_plan_id:currentPlanId,progress:after.total?after.completed/after.total:0});

        const waiting=(afterPlan?.steps??[]).filter((s:any)=>s.resume_state==='waiting_provider');
        if(waiting.length){
          if(!providerWaitStarted)providerWaitStarted=Date.now();
          if(Date.now()-providerWaitStarted>30_000){
            const durable=new DurableExecutionService(this.db);
            for(const step of waiting)durable.resumeProvider(step.id);
            providerWaitStarted=Date.now();
          }
          await sleep(5_000);
        }else{
          providerWaitStarted=0;
          await sleep(result.started?250:1_000);
        }
      }
    }catch(error){
      const cancelled=signal?.aborted||(error instanceof Error&&error.message==='CHAT_RUN_CANCELLED');
      const run=this.runs.get(rootRunId);
      if(run)this.runs.update(rootRunId,{status:cancelled?'cancelled':'failed',ended_at:now(),error:cancelled?null:{message:error instanceof Error?error.message:'EXECUTION_LONG_RUN_FAILED'},metadata:{...run.metadata,execution_plan_id:currentPlanId}});
      this.emit(rootRunId,run?.project_id??'',cancelled?'run.cancelled':'run.failed',{message:cancelled?'Execução cancelada':error instanceof Error?error.message:'EXECUTION_LONG_RUN_FAILED',execution_plan_id:currentPlanId});
    }
  }

  private autoReplan(planId:string):string|null{
    const graph=new ExecutionGraphService(this.db),plan=graph.getPlan(planId) as any;
    if(!plan)return null;
    const budget=plan.budget??{},count=Number(plan.replan_count||0);
    if(count>=Number(budget.max_replans??5))return null;
    const failed=(plan.steps??[]).filter((s:any)=>s.status==='failed');
    if(!failed.length)return null;
    const durable=new DurableExecutionService(this.db);
    let request;
    try{request=durable.requestReplan(planId,'Automatic remediation after a failed execution or quality gate.','automatic_quality_replan')}catch{return null}
    if(request.status!=='pending')return null;
    const config=this.loadMissionConfig(planId),contract=this.loadGoalContract(planId);
    const decision=json<any>((this.db.prepare('SELECT decision_json FROM orchestration_runs WHERE id=?').get(config.orchestration_run_id) as any)?.decision_json,{});
    const draft=planDraft({
      project_id:config.project_id,orchestration_run_id:config.orchestration_run_id,decision,contract,
      selected_agents:config.selected_agents??[],selected_subagents:config.selected_subagents??[],
    });
    const next=durable.commitReplan(request.request_id,draft) as any;
    if(!next?.id)return null;
    const t=now();
    this.db.prepare("INSERT INTO execution_artifacts(id,plan_id,step_id,type,uri,payload_json,created_at)VALUES(lower(hex(randomblob(16))),?,NULL,'goal_contract',NULL,?,?)").run(next.id,JSON.stringify(contract),t);
    this.db.prepare("INSERT INTO execution_artifacts(id,plan_id,step_id,type,uri,payload_json,created_at)VALUES(lower(hex(randomblob(16))),?,NULL,'mission_config',NULL,?,?)").run(next.id,JSON.stringify({...config,replanned_from:planId}),t);
    return next.id;
  }

  private loadMissionConfig(planId:string):any{
    const row=this.db.prepare("SELECT payload_json FROM execution_artifacts WHERE plan_id=? AND type='mission_config' ORDER BY created_at DESC LIMIT 1").get(planId) as any;
    if(row)return json(row.payload_json,{});
    const parent=this.db.prepare('SELECT parent_plan_id FROM execution_plans WHERE id=?').get(planId) as any;
    if(parent?.parent_plan_id)return this.loadMissionConfig(parent.parent_plan_id);
    throw new Error('EXECUTION_MISSION_CONFIG_MISSING');
  }
  private loadGoalContract(planId:string):GoalContract{
    const row=this.db.prepare("SELECT payload_json FROM execution_artifacts WHERE plan_id=? AND type='goal_contract' ORDER BY created_at DESC LIMIT 1").get(planId) as any;
    if(row)return json(row.payload_json,goalContract(''));
    const config=this.loadMissionConfig(planId);return goalContract(config.original_request??'');
  }
  private stepProgress(planId:string){
    const rows=this.db.prepare('SELECT status FROM execution_steps WHERE plan_id=?').all(planId) as any[];
    return{total:rows.length,completed:rows.filter(x=>x.status==='completed').length,failed:rows.filter(x=>x.status==='failed').length};
  }
  private applyControlCommands(planId:string){
    const cancel=this.db.prepare("SELECT id FROM execution_commands WHERE plan_id=? AND status='pending' AND command_type='cancel' ORDER BY created_at LIMIT 1").get(planId) as any;
    if(cancel){this.db.prepare("UPDATE execution_commands SET status='applied',applied_at=? WHERE id=?").run(now(),cancel.id);this.cancelPlan(planId);return}
    const replan=this.db.prepare("SELECT id,payload_json FROM execution_commands WHERE plan_id=? AND status='pending' AND command_type='request_replan' ORDER BY created_at LIMIT 1").get(planId) as any;
    if(replan){
      this.db.prepare("UPDATE execution_commands SET status='applied',applied_at=? WHERE id=?").run(now(),replan.id);
      const payload=json<any>(replan.payload_json,{});
      try{new DurableExecutionService(this.db).requestReplan(planId,String(payload.reason||'User requested replan'),'user_orientation')}catch{}
    }
  }
  private cancelPlan(planId:string){
    const t=now();this.db.prepare("UPDATE execution_plans SET status='cancelled',updated_at=? WHERE id=? AND status NOT IN ('completed','failed','cancelled')").run(t,planId);
    this.db.prepare("UPDATE execution_steps SET status='cancelled',resume_state='cancelled',updated_at=? WHERE plan_id=? AND status IN ('queued','ready','blocked')").run(t,planId);
  }
  private async finishSuccess(planId:string,rootRunId:string){
    const config=this.loadMissionConfig(planId);
    const last=this.db.prepare(`SELECT a.result_summary FROM step_attempts a JOIN execution_steps s ON s.id=a.step_id WHERE s.plan_id=? AND s.key='06_delivery' AND a.status='completed' ORDER BY a.attempt_number DESC LIMIT 1`).get(planId) as any;
    const fallback=this.db.prepare("SELECT result_summary FROM step_attempts WHERE step_id IN (SELECT id FROM execution_steps WHERE plan_id=?) AND status='completed' ORDER BY ended_at DESC LIMIT 1").get(planId) as any;
    const text=String(last?.result_summary||fallback?.result_summary||'Execução concluída e validada.').replace(/QUALITY_GATE:\s*PASS/gi,'').trim();
    const message=this.messages.create({conversation_id:config.conversation_id,role:'assistant',content:text,metadata:{source:'long_run_v1',root_run_id:rootRunId,execution_plan_id:planId,final:true}});
    const root=this.runs.get(rootRunId);if(root)this.runs.update(rootRunId,{status:'completed',ended_at:now(),error:null,metadata:{...root.metadata,execution_plan_id:planId,final_message_id:message.id,long_running:true}});
    chatEventHub.publish(rootRunId,'response.delta',{text,stage:'final_delivery',long_running:true});
    chatEventHub.publish(rootRunId,'response.completed',{message_id:message.id,final:true,execution_plan_id:planId,long_running:true});
    chatEventHub.publish(rootRunId,'run.completed',{final_message_id:message.id,execution_plan_id:planId,long_running:true});
    this.activity.append({project_id:config.project_id,conversation_id:config.conversation_id,run_id:rootRunId,type:'run.completed',title:'Execução longa concluída',detail:'Objetivo validado pela auditoria final.',payload:{execution_plan_id:planId}});
  }
  private emit(runId:string,projectId:string,event:string,payload:Record<string,unknown>){
    if(projectId)this.activity.append({project_id:projectId,run_id:runId,type:event,title:typeof payload.activity==='string'?payload.activity:event,detail:typeof payload.message==='string'?payload.message:'',payload});
    chatEventHub.publish(runId,event,payload);
  }
}
