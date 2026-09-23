import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { AgentRepositoryV2, ProviderRepositoryV2 } from './v2DataModel.js';
import { CapabilityRepository } from './capabilityCore.js';
import { OrchestratorGateway, type OrchestratorLLM } from './orchestratorGateway.js';
import { getOrchestratorSettings, getOrchestratorStatus, saveOrchestratorSettings } from './orchestratorRuntime.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-orchestrator-runtime-'));
  const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
  const now = new Date().toISOString();
  database.connection.prepare("INSERT INTO projects(id,name,root_path,created_at,updated_at)VALUES('p','Project',?,?,?)").run(dataDir, now, now);
  const providers = new ProviderRepositoryV2(database.connection);
  const provider = providers.create({ id: 'control-provider', name: 'Control Provider', protocol_driver: 'openai_chat', base_url: 'https://control.example', auth_driver: 'none' });
  const model = providers.createModel(provider.id, { id: 'control-model-pk', model_id: 'control-model', display_name: 'Control Model', enabled: true, is_default: true });
  return { database, dataDir, providers, provider, model, cleanup() { database.connection.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

describe('Block 3 Central Orchestrator', () => {
  it('persists principal/Fast/Deep configuration and exposes controller status', () => {
    const f = fixture();
    try {
      const saved = saveOrchestratorSettings(f.database.connection, {
        enabled: true,
        principal: { provider_id: f.provider.id, model_id: f.model.model_id },
        fast: null,
        deep: { provider_id: f.provider.id, model_id: f.model.model_id },
        fast_confidence_threshold: 0.72,
        deep_confidence_threshold: 0.58,
        deep_for_high_risk: true,
      });
      expect(saved.principal).toEqual({ provider_id: 'control-provider', model_id: 'control-model' });
      expect(getOrchestratorSettings(f.database.connection).deep_confidence_threshold).toBe(0.58);
      const status = getOrchestratorStatus(f.database.connection) as any;
      expect(status.principal).toMatchObject({ provider_name: 'Control Provider', model_name: 'Control Model', enabled: true });
      expect(status.fast).toMatchObject({ model_name: 'Control Model' });
    } finally { f.cleanup(); }
  });

  it('rejects an invalid controlling model instead of silently accepting it', () => {
    const f = fixture();
    try {
      expect(() => saveOrchestratorSettings(f.database.connection, {
        principal: { provider_id: f.provider.id, model_id: 'missing-model' },
      })).toThrow('ORCHESTRATOR_MODEL_NOT_FOUND');
    } finally { f.cleanup(); }
  });

  it('persists effective provider/model telemetry and a structured decision timeline', async () => {
    const f = fixture();
    try {
      saveOrchestratorSettings(f.database.connection, {
        principal: { provider_id: f.provider.id, model_id: f.model.model_id },
        fast_confidence_threshold: 0.7,
      });
      new CapabilityRepository(f.database.connection).seed();

      const llm: OrchestratorLLM = {
        decide: async () => ({
          decision: {
            target_mode: 'needs_gap_analysis',
            normalized_goal: 'Analyze request',
            required_capabilities: [],
            required_tools: [],
            complexity: 'medium',
            risk: 'low',
            requires_plan: false,
            candidate_scope: [],
            quality_controls: ['review'],
            explanation: 'Structured routing rationale.',
            confidence: 0.92,
          },
          telemetry: {
            provider_id: f.provider.id,
            model_id: f.model.model_id,
            requested_provider_id: f.provider.id,
            requested_model_id: f.model.model_id,
            input_tokens: 111,
            output_tokens: 33,
            duration_ms: 42,
            fallback_used: false,
          },
        }),
      };

      const result = await new OrchestratorGateway(f.database.connection, llm).route({
        project_id: 'p',
        message: 'Analise uma solicitação ambígua que precisa de coordenação geral.',
        target: 'auto',
      });
      expect(result.level).toBe('fast');

      const run = f.database.connection.prepare('SELECT provider_id,model_id,input_tokens,output_tokens FROM orchestration_runs WHERE id=?').get(result.orchestration_run_id) as any;
      expect(run).toEqual({ provider_id: f.provider.id, model_id: f.model.id, input_tokens: 111, output_tokens: 33 });

      const events = f.database.connection.prepare('SELECT event_type FROM orchestration_events WHERE orchestration_run_id=? ORDER BY created_at').all(result.orchestration_run_id) as any[];
      expect(events.map((item) => item.event_type)).toEqual(expect.arrayContaining(['orchestrator.received','orchestrator.analyzing','orchestrator.routed']));
    } finally { f.cleanup(); }
  });

  it('records model fallback in the operational trail without storing chain-of-thought', async () => {
    const f = fixture();
    try {
      saveOrchestratorSettings(f.database.connection, { principal: { provider_id: f.provider.id, model_id: f.model.model_id } });
      const llm: OrchestratorLLM = {
        decide: async () => ({
          decision: { target_mode:'needs_gap_analysis', normalized_goal:'x', required_capabilities:[], required_tools:[], complexity:'medium', risk:'low', requires_plan:false, candidate_scope:[], quality_controls:[], explanation:'Short rationale.', confidence:.95 },
          telemetry: { provider_id:'fallback-provider', model_id:'fallback-model', requested_provider_id:f.provider.id, requested_model_id:f.model.model_id, input_tokens:10, output_tokens:5, duration_ms:20, fallback_used:true },
        }),
      };
      // Persist fallback target so orchestration_runs can reference a valid model.
      const fallback = f.providers.create({ id:'fallback-provider', name:'Fallback', protocol_driver:'openai_chat', base_url:'https://fallback.example', auth_driver:'none' });
      f.providers.createModel(fallback.id,{ id:'fallback-model-pk', model_id:'fallback-model', display_name:'Fallback Model', enabled:true, is_default:true });

      const routed = await new OrchestratorGateway(f.database.connection,llm).route({project_id:'p',message:'coordene esta solicitação ambígua',target:'auto'});
      const timeline = f.database.connection.prepare('SELECT event_type,detail FROM orchestration_events WHERE orchestration_run_id=?').all(routed.orchestration_run_id) as any[];
      expect(timeline.some((event) => event.event_type === 'orchestrator.fallback')).toBe(true);
      expect(JSON.stringify(timeline)).not.toMatch(/chain.of.thought/i);
    } finally { f.cleanup(); }
  });
  it('learns approval and rework from natural chat feedback without manual buttons', async () => {
    const f = fixture();
    try {
      const agents = new AgentRepositoryV2(f.database.connection);
      const worker = agents.create({
        id: 'feedback-agent',
        name: 'Feedback Agent',
        slug: 'feedback-agent',
        provider_id: f.provider.id,
        model_id: f.model.id,
        enabled: true,
      });
      const now = new Date().toISOString();
      f.database.connection.prepare("INSERT INTO conversations(id,project_id,title,created_at,updated_at) VALUES('feedback-conv','p','Feedback',?,?)").run(now,now);
      f.database.connection.prepare("INSERT INTO chat_runs(id,conversation_id,project_id,agent_id,provider_id,model_id,status,mode,started_at,ended_at,metadata_json) VALUES('feedback-run','feedback-conv','p',?,?,?,'completed','single',?,?, '{}')").run(worker.id,f.provider.id,f.model.id,now,now);
      f.database.connection.prepare("INSERT INTO messages(id,conversation_id,role,agent_id,content,created_at,metadata_json) VALUES('feedback-msg','feedback-conv','assistant',?,'Entrega pronta',?,?)").run(worker.id,now,JSON.stringify({child_run_id:'feedback-run',final:true}));

      const llm: OrchestratorLLM = {
        decide: async () => ({
          decision: {
            target_mode: 'needs_gap_analysis',
            normalized_goal: 'Continue',
            required_capabilities: [],
            required_tools: [],
            complexity: 'low',
            risk: 'low',
            requires_plan: false,
            candidate_scope: [],
            quality_controls: [],
            explanation: 'Continue normally.',
            confidence: 0.95,
          },
        }),
      };

      await new OrchestratorGateway(f.database.connection,llm).route({
        project_id:'p',
        conversation_id:'feedback-conv',
        message:'Perfeito, funcionou',
        target:'auto',
      });

      let events=f.database.connection.prepare("SELECT event_type,source FROM agent_performance_events WHERE agent_id=? AND run_id='feedback-run'").all(worker.id) as any[];
      expect(events).toEqual([expect.objectContaining({event_type:'accepted',source:'orchestrator'})]);

      await new OrchestratorGateway(f.database.connection,llm).route({
        project_id:'p',
        conversation_id:'feedback-conv',
        message:'Isso ficou errado, precisa corrigir',
        target:'auto',
      });

      events=f.database.connection.prepare("SELECT event_type,source FROM agent_performance_events WHERE agent_id=? AND run_id='feedback-run'").all(worker.id) as any[];
      expect(events).toEqual([expect.objectContaining({event_type:'rework_requested',source:'orchestrator'})]);
    } finally { f.cleanup(); }
  });

});
