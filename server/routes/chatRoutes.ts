import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { getAgentOfficeConfig } from '../agent-office/config.js';
import { DevelopmentSecretStore } from '../agent-office/secretStore.js';
import { ChatRunnerService } from '../agent-office/chatRunner.js';
import { chatEventHub, type ChatStreamEnvelope } from '../agent-office/chatEventHub.js';
import { chatRunControls } from '../agent-office/runtimeControls.js';
import { ChatRunRepository } from '../agent-office/v2DataModel.js';
import { OrchestratorGateway } from '../agent-office/orchestratorGateway.js';
import { UniversalOrchestratorLLM } from '../agent-office/orchestratorRuntime.js';

export const chatRouter = Router();

function codeOf(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  return /^[A-Z0-9_]+$/.test(message) ? message : fallback;
}

function statusFor(code: string): number {
  if (code.includes('NOT_FOUND')) return 404;
  if (
    code.includes('REQUIRED') ||
    code.includes('INVALID') ||
    code.includes('NOT_AVAILABLE') ||
    code.includes('NOT_CONFIGURED') ||
    code.includes('NO_AVAILABLE')
  ) return 400;
  if (code.includes('UNAVAILABLE') || code.includes('SECRET_MISSING')) return 503;
  return 500;
}

chatRouter.post('/runs', async (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const projectId = String(request.body?.project_id || '');
    const message = String(request.body?.message || '');
    const requestedTarget = typeof request.body?.target === 'string' ? request.body.target : 'auto';
    if (!database.connection.prepare('SELECT 1 FROM projects WHERE id=?').get(projectId)) {
      throw new Error('CHAT_PROJECT_NOT_FOUND');
    }

    const orchestration = await new OrchestratorGateway(
      database.connection,
      new UniversalOrchestratorLLM(database.connection),
    ).route({
      project_id: projectId,
      conversation_id: typeof request.body?.conversation_id === 'string' ? request.body.conversation_id : null,
      message,
      target: requestedTarget,
    });

    const decision = orchestration.decision;
    let selectedAgentIds: string[] = [];
    if (decision.target_agent_id) {
      selectedAgentIds = [decision.target_agent_id];
    } else if (decision.target_mode === 'existing_team' && decision.target_team_id) {
      selectedAgentIds = (database.connection.prepare(
        'SELECT agent_id FROM team_members WHERE team_id=? AND enabled=1 ORDER BY priority,created_at'
      ).all(decision.target_team_id) as Array<{agent_id:string}>).map((row) => row.agent_id);
    } else if (decision.target_mode === 'dynamic_team' && decision.target_team_id) {
      selectedAgentIds = (database.connection.prepare(
        'SELECT agent_id FROM dynamic_team_members WHERE dynamic_team_id=? AND enabled=1 ORDER BY priority,created_at'
      ).all(decision.target_team_id) as Array<{agent_id:string}>).map((row) => row.agent_id);
    } else if (decision.candidate_scope.length) {
      selectedAgentIds = decision.candidate_scope;
    }

    const service = new ChatRunnerService(
      database.connection,
      new DevelopmentSecretStore(getAgentOfficeConfig().dataDir),
    );
    const prepared = service.prepare({
      project_id: projectId,
      conversation_id: typeof request.body?.conversation_id === 'string'
        ? request.body.conversation_id
        : undefined,
      message,
      target: requestedTarget,
      model_override: typeof request.body?.model_override === 'string' && request.body.model_override.trim()
        ? request.body.model_override.trim()
        : undefined,
      selected_agent_ids: selectedAgentIds.length ? selectedAgentIds : undefined,
      orchestration_run_id: orchestration.orchestration_run_id,
      routing_level: orchestration.level,
      routing_decision: decision as unknown as Record<string, unknown>,
    });

    const receipt = service.receipt(prepared);
    const signal = chatRunControls.register(prepared.run.id);
    void service.execute(prepared, signal)
      .catch(() => undefined)
      .finally(() => {
        chatRunControls.finish(prepared.run.id);
        database.connection.close();
      });

    response.status(202).json({ ok: true, data: { ...receipt, orchestration_run_id: orchestration.orchestration_run_id } });
  } catch (error) {
    database.connection.close();
    const code = codeOf(error, 'CHAT_RUN_START_FAILED');
    response.status(statusFor(code)).json({
      ok: false,
      error: {
        code,
        message: error instanceof Error ? error.message : 'Unable to start chat run.',
      },
    });
  }
});

chatRouter.post('/runs/:runId/cancel', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const runs = new ChatRunRepository(database.connection);
    const run = runs.get(request.params.runId);
    if (!run) {
      response.status(404).json({ ok: false, error: { code: 'CHAT_RUN_NOT_FOUND', message: 'Chat run not found.' } });
      return;
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      response.status(409).json({ ok: false, error: { code: 'CHAT_RUN_TERMINAL', message: 'Chat run is already terminal.' } });
      return;
    }

    const active = chatRunControls.cancel(run.id);
    if (!active) {
      runs.update(run.id, {
        status: 'cancelled',
        ended_at: new Date().toISOString(),
        error: null,
        metadata: { ...run.metadata, cancelled_without_active_controller: true },
      });
      chatEventHub.publish(run.id, 'run.cancelled', { persisted: true, reason: 'cancel_requested_after_runtime_loss' });
    }

    response.json({ ok: true, data: { run_id: run.id, cancel_requested: true, active } });
  } finally {
    database.connection.close();
  }
});

chatRouter.get('/runs/:runId', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const run = new ChatRunRepository(database.connection).get(request.params.runId);
    if (!run) {
      response.status(404).json({ ok: false, error: { code: 'CHAT_RUN_NOT_FOUND', message: 'Chat run not found.' } });
      return;
    }
    response.json({ ok: true, data: run });
  } finally {
    database.connection.close();
  }
});

chatRouter.get('/runs/:runId/stream', (request, response) => {
  const database = openAgentOfficeDatabase();
  let run;
  try {
    run = new ChatRunRepository(database.connection).get(request.params.runId);
  } finally {
    database.connection.close();
  }

  if (!run) {
    response.status(404).json({ ok: false, error: { code: 'CHAT_RUN_NOT_FOUND', message: 'Chat run not found.' } });
    return;
  }

  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();

  const headerId = request.header('Last-Event-ID');
  const queryId = typeof request.query.after === 'string' ? request.query.after : undefined;
  let cursor = Math.max(0, Number(headerId ?? queryId ?? 0) || 0);
  let closed = false;

  const write = (event: ChatStreamEnvelope): void => {
    if (closed || event.sequence <= cursor) return;
    cursor = event.sequence;
    response.write(`id: ${event.sequence}\n`);
    response.write(`event: ${event.event}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const unsubscribe = chatEventHub.subscribe(run.id, write);
  for (const event of chatEventHub.snapshot(run.id, cursor)) write(event);

  if (chatEventHub.isTerminal(run.id)) {
    unsubscribe();
    response.end();
    return;
  }

  if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
    const synthetic: ChatStreamEnvelope = {
      sequence: cursor + 1,
      run_id: run.id,
      event: run.status === 'completed' ? 'run.completed' : run.status === 'cancelled' ? 'run.cancelled' : 'run.failed',
      data: {
        persisted: true,
        status: run.status,
        error: run.error,
        metadata: run.metadata,
      },
      timestamp: run.ended_at ?? new Date().toISOString(),
    };
    write(synthetic);
    unsubscribe();
    response.end();
    return;
  }

  const heartbeat = setInterval(() => {
    if (!closed) response.write(': heartbeat\n\n');
  }, 15_000);
  heartbeat.unref?.();

  request.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});
