import type { Database } from 'better-sqlite3';

export type AnalyticsRange = '24h' | '7d' | '30d' | 'all' | 'custom';

export interface AnalyticsFilters {
  range?: AnalyticsRange;
  from?: string | null;
  to?: string | null;
  project_id?: string | null;
  agent_id?: string | null;
  subagent_id?: string | null;
  provider_id?: string | null;
  model_id?: string | null;
}

type UsageRow = {
  worker_kind: 'agent' | 'subagent';
  worker_id: string;
  provider_id: string | null;
  model_id: string | null;
  project_id: string | null;
  run_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  cost_kind: 'reported' | 'estimated' | 'unknown';
  request_count: number;
  duration_ms: number | null;
  created_at: string;
};

const num = (value: unknown) => Number(value ?? 0) || 0;
const pct = (a: number, b: number) => b > 0 ? Math.round((a / b) * 1000) / 10 : null;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function durationMs(start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return null;
  const a = Date.parse(start), b = Date.parse(end);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}

export class AnalyticsService {
  constructor(private readonly db: Database) {}

  private resolveFilters(input: AnalyticsFilters = {}) {
    const range: AnalyticsRange = input.range ?? '7d';
    const to = input.to ? new Date(input.to) : new Date();
    let from: Date | null = null;
    if (range === '24h') from = new Date(to.getTime() - 24 * 3600000);
    else if (range === '7d') from = new Date(to.getTime() - 7 * 86400000);
    else if (range === '30d') from = new Date(to.getTime() - 30 * 86400000);
    else if (range === 'custom') {
      if (!input.from) throw new Error('ANALYTICS_FROM_REQUIRED');
      from = new Date(input.from);
    }
    if (Number.isNaN(to.getTime()) || (from && Number.isNaN(from.getTime()))) throw new Error('ANALYTICS_RANGE_INVALID');
    if (from && from > to) throw new Error('ANALYTICS_RANGE_INVALID');
    if (input.project_id && !this.db.prepare('SELECT 1 FROM projects WHERE id=?').get(input.project_id)) throw new Error('PROJECT_NOT_FOUND');
    return {
      range,
      from: from ? from.toISOString() : null,
      to: to.toISOString(),
      project_id: input.project_id ?? null,
      agent_id: input.agent_id ?? null,
      subagent_id: input.subagent_id ?? null,
      provider_id: input.provider_id ?? null,
      model_id: input.model_id ?? null,
    };
  }

  private inTime(value: string, filters: ReturnType<AnalyticsService['resolveFilters']>) {
    if (filters.from && value < filters.from) return false;
    return value <= filters.to;
  }

  private usage(filters: ReturnType<AnalyticsService['resolveFilters']>): UsageRow[] {
    const agentRows = this.db.prepare(`
      SELECT id,agent_id,provider,normalized_json,created_at,project_id,run_id,model_id,cost_kind
      FROM usage_snapshots
      WHERE source='run'
      ORDER BY created_at
    `).all() as any[];
    const subRows = this.db.prepare(`
      SELECT id,subagent_id,provider_id,input_tokens,output_tokens,cost_usd,request_count,duration_ms,created_at,
             project_id,run_id,model_id,cost_kind
      FROM subagent_usage_snapshots
      ORDER BY created_at
    `).all() as any[];
    const rows: UsageRow[] = [];
    for (const row of agentRows) {
      if (!this.inTime(row.created_at, filters)) continue;
      const usage = parseJson<any>(row.normalized_json, {});
      rows.push({
        worker_kind: 'agent', worker_id: row.agent_id, provider_id: row.provider ?? null, model_id: row.model_id ?? null,
        project_id: row.project_id ?? null, run_id: row.run_id ?? null,
        input_tokens: num(usage.input_tokens), output_tokens: num(usage.output_tokens),
        cost_usd: usage.cost_usd == null ? null : num(usage.cost_usd),
        cost_kind: row.cost_kind ?? (usage.cost_usd == null ? 'unknown' : 'estimated'),
        request_count: num(usage.request_count), duration_ms: usage.duration_ms == null ? null : num(usage.duration_ms),
        created_at: row.created_at,
      });
    }
    for (const row of subRows) {
      if (!this.inTime(row.created_at, filters)) continue;
      rows.push({
        worker_kind: 'subagent', worker_id: row.subagent_id, provider_id: row.provider_id ?? null, model_id: row.model_id ?? null,
        project_id: row.project_id ?? null, run_id: row.run_id ?? null,
        input_tokens: num(row.input_tokens), output_tokens: num(row.output_tokens),
        cost_usd: row.cost_usd == null ? null : num(row.cost_usd),
        cost_kind: row.cost_kind ?? (row.cost_usd == null ? 'unknown' : 'estimated'),
        request_count: num(row.request_count), duration_ms: row.duration_ms == null ? null : num(row.duration_ms),
        created_at: row.created_at,
      });
    }
    return rows.filter(row => {
      if (filters.project_id && row.project_id !== filters.project_id) return false;
      if (filters.agent_id && (row.worker_kind !== 'agent' || row.worker_id !== filters.agent_id)) return false;
      if (filters.subagent_id && (row.worker_kind !== 'subagent' || row.worker_id !== filters.subagent_id)) return false;
      if (filters.provider_id && row.provider_id !== filters.provider_id) return false;
      if (filters.model_id && row.model_id !== filters.model_id) return false;
      return true;
    });
  }

  private rootRuns(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    const rows = this.db.prepare('SELECT * FROM chat_runs WHERE parent_run_id IS NULL ORDER BY started_at').all() as any[];
    return rows.filter(row => {
      if (!this.inTime(row.started_at, filters)) return false;
      if (filters.project_id && row.project_id !== filters.project_id) return false;
      if (filters.agent_id && row.agent_id !== filters.agent_id) return false;
      if (filters.provider_id && row.provider_id !== filters.provider_id) return false;
      if (filters.model_id && row.model_id !== filters.model_id) return false;
      return true;
    });
  }

  private usageTotals(rows: UsageRow[]) {
    let input = 0, output = 0, cost = 0, known = 0, estimated = 0, reported = 0, duration = 0, durationCount = 0, requests = 0;
    for (const row of rows) {
      input += row.input_tokens; output += row.output_tokens; requests += row.request_count;
      if (row.cost_usd != null) {
        cost += row.cost_usd; known++;
        if (row.cost_kind === 'reported') reported++;
        else estimated++;
      }
      if (row.duration_ms != null) { duration += row.duration_ms; durationCount++; }
    }
    return {
      input_tokens: input, output_tokens: output, total_tokens: input + output, requests,
      cost_usd: known ? cost : null,
      cost_coverage_pct: pct(known, rows.length) ?? 0,
      cost_known_events: known, cost_unknown_events: rows.length - known,
      cost_reported_events: reported, cost_estimated_events: estimated,
      average_duration_ms: durationCount ? Math.round(duration / durationCount) : null,
      usage_events: rows.length,
      scoped_events: rows.filter(r => Boolean(r.project_id && r.run_id)).length,
      unscoped_events: rows.filter(r => !r.project_id || !r.run_id).length,
    };
  }

  private overview(filters: ReturnType<AnalyticsService['resolveFilters']>, usage: UsageRow[], runs: any[]) {
    const terminal = runs.filter(r => ['completed','failed','cancelled'].includes(r.status));
    const completed = terminal.filter(r => r.status === 'completed').length;
    const failed = terminal.filter(r => r.status === 'failed').length;
    const cancelled = terminal.filter(r => r.status === 'cancelled').length;
    const usageTotals = this.usageTotals(usage);
    const projects = new Set(runs.map(r => r.project_id));
    const perf = this.performanceEvents(filters);
    const rework = perf.filter((e:any) => e.event_type === 'rework_requested').length;
    const operationalFailures = perf.filter((e:any) => e.event_type === 'operational_failure').length;
    return {
      runs: runs.length, completed_runs: completed, failed_runs: failed, cancelled_runs: cancelled,
      success_rate: pct(completed, terminal.length),
      projects_touched: projects.size,
      rework_events: rework,
      operational_failures: operationalFailures,
      ...usageTotals,
    };
  }

  private performanceEvents(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    const agents = this.db.prepare("SELECT 'agent' worker_kind,agent_id worker_id,project_id,run_id,event_type,score,source,created_at FROM agent_performance_events").all() as any[];
    const subs = this.db.prepare("SELECT 'subagent' worker_kind,subagent_id worker_id,project_id,run_id,event_type,score,source,created_at FROM subagent_performance_events").all() as any[];
    return [...agents, ...subs].filter(row => {
      if (!this.inTime(row.created_at, filters)) return false;
      if (filters.project_id && row.project_id !== filters.project_id) return false;
      if (filters.agent_id && (row.worker_kind !== 'agent' || row.worker_id !== filters.agent_id)) return false;
      if (filters.subagent_id && (row.worker_kind !== 'subagent' || row.worker_id !== filters.subagent_id)) return false;
      return true;
    });
  }

  private workers(filters: ReturnType<AnalyticsService['resolveFilters']>, usage: UsageRow[]) {
    const agents = this.db.prepare('SELECT id,name,role,provider_id,model_id FROM agents ORDER BY name').all() as any[];
    const subagents = this.db.prepare('SELECT id,name,role,owner_agent_id,team_id,provider_id,model_id FROM subagents ORDER BY name').all() as any[];
    const perf = this.performanceEvents(filters);
    const allRuns = this.db.prepare('SELECT * FROM chat_runs ORDER BY started_at').all() as any[];
    const runWorkers: Array<{worker_kind:string;worker_id:string;status:string;started_at:string;ended_at:string|null;project_id:string}> = [];
    for (const run of allRuns) {
      if (!this.inTime(run.started_at, filters)) continue;
      if (filters.project_id && run.project_id !== filters.project_id) continue;
      if (run.agent_id) runWorkers.push({ worker_kind:'agent', worker_id:run.agent_id, status:run.status, started_at:run.started_at, ended_at:run.ended_at, project_id:run.project_id });
      const meta = parseJson<any>(run.metadata_json, {});
      if (meta.worker_kind === 'subagent' && typeof meta.subagent_id === 'string') {
        runWorkers.push({ worker_kind:'subagent', worker_id:meta.subagent_id, status:run.status, started_at:run.started_at, ended_at:run.ended_at, project_id:run.project_id });
      }
    }
    const build = (worker:any, kind:'agent'|'subagent') => {
      const u = usage.filter(x => x.worker_kind === kind && x.worker_id === worker.id);
      const p = perf.filter((x:any) => x.worker_kind === kind && x.worker_id === worker.id);
      const r = runWorkers.filter(x => x.worker_kind === kind && x.worker_id === worker.id);
      const terminal = r.filter(x => ['completed','failed','cancelled'].includes(x.status));
      const completed = terminal.filter(x => x.status === 'completed').length;
      const accepted = p.filter((x:any)=>x.event_type==='accepted').length;
      const validated = p.filter((x:any)=>x.event_type==='validation_passed').length;
      const rework = p.filter((x:any)=>x.event_type==='rework_requested').length;
      const rejected = p.filter((x:any)=>x.event_type==='rejected').length;
      const qualityFailure = p.filter((x:any)=>x.event_type==='quality_failure').length;
      const positive = accepted + validated, negative = rework + rejected + qualityFailure;
      const durations = r.map(x=>durationMs(x.started_at,x.ended_at)).filter((x):x is number=>x!=null);
      return {
        worker_kind: kind, id: worker.id, name: worker.name, role: worker.role,
        owner_agent_id: worker.owner_agent_id ?? null, team_id: worker.team_id ?? null,
        provider_id: worker.provider_id ?? null, model_id: worker.model_id ?? null,
        runs: r.length, completed_runs: completed, failed_runs: terminal.filter(x=>x.status==='failed').length,
        cancelled_runs: terminal.filter(x=>x.status==='cancelled').length,
        success_rate: pct(completed, terminal.length),
        first_pass_rate: pct(accepted, accepted + rework + rejected),
        rework_rate: pct(rework, positive + negative),
        quality_signals: positive + negative,
        average_run_duration_ms: durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : null,
        ...this.usageTotals(u),
      };
    };
    return [...agents.map(a=>build(a,'agent')), ...subagents.map(s=>build(s,'subagent'))]
      .filter(w => !filters.agent_id || (w.worker_kind==='agent' && w.id===filters.agent_id))
      .filter(w => !filters.subagent_id || (w.worker_kind==='subagent' && w.id===filters.subagent_id));
  }

  private projects(filters: ReturnType<AnalyticsService['resolveFilters']>, usage: UsageRow[], runs: any[]) {
    const projects = this.db.prepare('SELECT id,name,lifecycle_status,created_at FROM projects ORDER BY updated_at DESC').all() as any[];
    return projects.filter(p => !filters.project_id || p.id === filters.project_id).map(project => {
      const r = runs.filter(x => x.project_id === project.id);
      const terminal = r.filter(x => ['completed','failed','cancelled'].includes(x.status));
      const u = usage.filter(x => x.project_id === project.id);
      const plans = (this.db.prepare('SELECT status FROM execution_plans WHERE project_id=?').all(project.id) as any[]);
      const wf = (this.db.prepare(`
        SELECT DISTINCT d.id,d.lifecycle_status
        FROM dynamic_team_instances d
        LEFT JOIN chat_runs cr ON cr.id=d.chat_run_id
        LEFT JOIN execution_plans ep ON ep.id=d.execution_plan_id
        LEFT JOIN orchestration_runs oo ON oo.id=d.orchestration_run_id
        WHERE cr.project_id=? OR ep.project_id=? OR oo.project_id=?
      `).all(project.id,project.id,project.id) as any[]);
      const blockers = this.db.prepare("SELECT COUNT(*) n FROM project_blockers WHERE project_id=? AND status='open'").get(project.id) as any;
      return {
        id: project.id, name: project.name, lifecycle_status: project.lifecycle_status,
        runs: r.length, completed_runs: terminal.filter(x=>x.status==='completed').length,
        failed_runs: terminal.filter(x=>x.status==='failed').length,
        success_rate: pct(terminal.filter(x=>x.status==='completed').length, terminal.length),
        plans: plans.length, completed_plans: plans.filter(x=>x.status==='completed').length,
        failed_plans: plans.filter(x=>x.status==='failed').length,
        workforces: wf.length, failed_workforces: wf.filter(x=>x.lifecycle_status==='failed').length,
        open_blockers: num(blockers?.n),
        ...this.usageTotals(u),
      };
    });
  }

  private execution(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    const plans = (this.db.prepare('SELECT * FROM execution_plans').all() as any[]).filter(p => this.inTime(p.created_at,filters) && (!filters.project_id || p.project_id===filters.project_id));
    const planIds = new Set(plans.map(p=>p.id));
    const steps = (this.db.prepare('SELECT * FROM execution_steps').all() as any[]).filter(s=>planIds.has(s.plan_id));
    const stepIds = new Set(steps.map(s=>s.id));
    const attempts = (this.db.prepare('SELECT * FROM step_attempts').all() as any[]).filter(a=>stepIds.has(a.step_id) && this.inTime(a.started_at,filters));
    const toolAudits = this.toolRows(filters);
    const approvals = this.approvalRows(filters);
    const terminalPlans=plans.filter(p=>['completed','failed','cancelled'].includes(p.status));
    const terminalSteps=steps.filter(s=>['completed','failed','cancelled'].includes(s.status));
    const durations=attempts.map(a=>durationMs(a.started_at,a.ended_at)).filter((x):x is number=>x!=null);
    const replans = plans.filter(p=>num(p.replan_count)>0).reduce((sum,p)=>sum+num(p.replan_count),0);
    return {
      plans: plans.length, completed_plans: terminalPlans.filter(p=>p.status==='completed').length,
      failed_plans: terminalPlans.filter(p=>p.status==='failed').length,
      plan_success_rate: pct(terminalPlans.filter(p=>p.status==='completed').length,terminalPlans.length),
      steps: steps.length, completed_steps: terminalSteps.filter(s=>s.status==='completed').length,
      failed_steps: terminalSteps.filter(s=>s.status==='failed').length, blocked_steps: steps.filter(s=>s.status==='blocked').length,
      step_success_rate: pct(terminalSteps.filter(s=>s.status==='completed').length,terminalSteps.length),
      attempts: attempts.length,
      retry_attempts: Math.max(0, attempts.length - new Set(attempts.map(a=>a.step_id)).size),
      retry_rate: pct(Math.max(0, attempts.length-new Set(attempts.map(a=>a.step_id)).size), attempts.length),
      timed_out: attempts.filter(a=>a.status==='timed_out').length,
      budget_exceeded: attempts.filter(a=>a.status==='budget_exceeded').length,
      replans,
      average_attempt_duration_ms: durations.length ? Math.round(durations.reduce((a,b)=>a+b,0)/durations.length) : null,
      tool_calls: toolAudits.length,
      tool_failures: toolAudits.filter(t=>['failed','error'].includes(String(t.status).toLowerCase())).length,
      approvals: approvals.length,
      approvals_pending: approvals.filter(a=>a.status==='pending').length,
      approvals_denied: approvals.filter(a=>a.status==='denied').length,
    };
  }

  private orchestrator(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    const rows=(this.db.prepare('SELECT * FROM orchestration_runs').all() as any[]).filter(r=>this.inTime(r.created_at,filters)&&(!filters.project_id||r.project_id===filters.project_id)&&(!filters.provider_id||r.provider_id===filters.provider_id)&&(!filters.model_id||r.model_id===filters.model_id));
    const fallbackEvents=(this.db.prepare("SELECT * FROM orchestration_events WHERE event_type='orchestrator.fallback'").all() as any[]).filter(r=>this.inTime(r.created_at,filters)&&(!filters.project_id||r.project_id===filters.project_id));
    const durations=rows.map(r=>num(r.duration_ms));
    const byLevel:any={deterministic:0,fast:0,deep:0,fallback:0};
    for(const row of rows) byLevel[row.level_used]=(byLevel[row.level_used]??0)+1;
    return {
      total:rows.length, routed:rows.filter(r=>r.status==='routed').length, failed:rows.filter(r=>r.status==='failed').length,
      success_rate:pct(rows.filter(r=>r.status==='routed').length,rows.length),
      levels:byLevel, fallback_events:fallbackEvents.length, fallback_rate:pct(fallbackEvents.length,rows.length),
      input_tokens:rows.reduce((s,r)=>s+num(r.input_tokens),0),
      output_tokens:rows.reduce((s,r)=>s+num(r.output_tokens),0),
      average_duration_ms:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,
    };
  }

  private providers(filters: ReturnType<AnalyticsService['resolveFilters']>, usage: UsageRow[]) {
    const providers=this.db.prepare('SELECT id,name,enabled,health_status FROM providers ORDER BY name').all() as any[];
    const models=this.db.prepare('SELECT id,provider_id,model_id,display_name,enabled FROM provider_models ORDER BY display_name').all() as any[];
    return providers.filter(p=>!filters.provider_id||p.id===filters.provider_id).map(provider=>{
      const u=usage.filter(x=>x.provider_id===provider.id);
      const runtime=this.db.prepare('SELECT * FROM provider_runtime_state WHERE provider_id=?').get(provider.id) as any;
      const modelStats=models.filter(m=>m.provider_id===provider.id).filter(m=>!filters.model_id||m.id===filters.model_id).map(model=>{
        const mu=u.filter(x=>x.model_id===model.id);
        return {id:model.id,model_id:model.model_id,name:model.display_name,enabled:Boolean(model.enabled),...this.usageTotals(mu)};
      });
      return {id:provider.id,name:provider.name,enabled:Boolean(provider.enabled),health_status:provider.health_status,
        operational_status:runtime?.operational_status??provider.health_status,circuit_state:runtime?.circuit_state??null,
        active_requests:num(runtime?.active_requests),queued_requests:num(runtime?.queued_requests),consecutive_failures:num(runtime?.consecutive_failures),
        last_success_at:runtime?.last_success_at??null,last_failure_at:runtime?.last_failure_at??null,
        ...this.usageTotals(u),models:modelStats};
    });
  }

  private toolRows(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    return (this.db.prepare('SELECT * FROM tool_audit_events').all() as any[]).filter(r=>this.inTime(r.started_at,filters)&&(!filters.project_id||r.project_id===filters.project_id)&&(!filters.agent_id||r.agent_id===filters.agent_id));
  }
  private approvalRows(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    return (this.db.prepare('SELECT * FROM tool_approvals').all() as any[]).filter(r=>this.inTime(r.created_at,filters)&&(!filters.project_id||r.project_id===filters.project_id)&&(!filters.agent_id||r.agent_id===filters.agent_id));
  }

  private tools(filters: ReturnType<AnalyticsService['resolveFilters']>) {
    const rows=this.toolRows(filters), approvals=this.approvalRows(filters);
    const names=[...new Set(rows.map(r=>String(r.tool_name)))];
    return names.map(name=>{
      const r=rows.filter(x=>x.tool_name===name), a=approvals.filter(x=>x.tool_name===name);
      const durations=r.map(x=>durationMs(x.started_at,x.ended_at)).filter((x):x is number=>x!=null);
      return {name,calls:r.length,completed:r.filter(x=>['completed','success'].includes(String(x.status).toLowerCase())).length,
        failed:r.filter(x=>['failed','error'].includes(String(x.status).toLowerCase())).length,
        average_duration_ms:durations.length?Math.round(durations.reduce((x,y)=>x+y,0)/durations.length):null,
        approvals:a.length,approved:a.filter(x=>x.status==='approved').length,denied:a.filter(x=>x.status==='denied').length,pending:a.filter(x=>x.status==='pending').length};
    }).sort((a,b)=>b.calls-a.calls);
  }

  private timeseries(filters: ReturnType<AnalyticsService['resolveFilters']>, usage: UsageRow[], runs: any[]) {
    const hourly=filters.range==='24h';
    const bucket=(iso:string)=>hourly?iso.slice(0,13)+':00:00Z':iso.slice(0,10);
    const map=new Map<string,any>();
    const ensure=(key:string)=>{let v=map.get(key);if(!v){v={bucket:key,runs:0,completed:0,failed:0,input_tokens:0,output_tokens:0,cost_usd:0,cost_known_events:0,cost_events:0};map.set(key,v)}return v};
    for(const run of runs){const v=ensure(bucket(run.started_at));v.runs++;if(run.status==='completed')v.completed++;if(run.status==='failed')v.failed++;}
    for(const row of usage){const v=ensure(bucket(row.created_at));v.input_tokens+=row.input_tokens;v.output_tokens+=row.output_tokens;v.cost_events++;if(row.cost_usd!=null){v.cost_usd+=row.cost_usd;v.cost_known_events++;}}
    return [...map.values()].sort((a,b)=>String(a.bucket).localeCompare(String(b.bucket))).map(v=>({...v,total_tokens:v.input_tokens+v.output_tokens,cost_usd:v.cost_known_events?v.cost_usd:null,cost_coverage_pct:pct(v.cost_known_events,v.cost_events)??0}));
  }

  snapshot(input: AnalyticsFilters = {}) {
    const filters=this.resolveFilters(input);
    const usage=this.usage(filters);
    const runs=this.rootRuns(filters);
    const totals=this.usageTotals(usage);
    return {
      generated_at:new Date().toISOString(),
      filters,
      data_quality:{
        usage_source:'worker_run_snapshots',
        run_source:'root_chat_runs',
        anti_double_counting:true,
        scoped_usage_events:totals.scoped_events,
        unscoped_usage_events:totals.unscoped_events,
        cost_coverage_pct:totals.cost_coverage_pct,
        notes:[
          'Tokens and cost use worker run snapshots; root Chat Runs are not added to usage totals.',
          'Historical usage created before migration 22 may be unscoped and is excluded from project-specific totals.',
          'Unknown cost is never converted to zero.',
        ],
      },
      overview:this.overview(filters,usage,runs),
      timeseries:this.timeseries(filters,usage,runs),
      workers:this.workers(filters,usage),
      projects:this.projects(filters,usage,runs),
      execution:this.execution(filters),
      orchestrator:this.orchestrator(filters),
      providers:this.providers(filters,usage),
      tools:this.tools(filters),
    };
  }
}
