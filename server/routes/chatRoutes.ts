import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { getAgentOfficeConfig } from '../agent-office/config.js';
import { DevelopmentSecretStore } from '../agent-office/secretStore.js';
import { ChatRunnerService } from '../agent-office/chatRunner.js';
import { chatEventHub, type ChatStreamEnvelope } from '../agent-office/chatEventHub.js';
import { ChatRunRepository } from '../agent-office/v2DataModel.js';

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

chatRouter.post('/runs', (request, response) => {
  const database = openAgentOfficeDatabase();
  try {
    const service = new ChatRunnerService(
      database.connection,
      new DevelopmentSecretStore(getAgentOfficeConfig().dataDir),
    );
    const prepared = service.prepare({
      project_id: String(request.body?.project_id || ''),
      conversation_id: typeof request.body?.conversation_id === 'string'
        ? request.body.conversation_id
        : undefined,
      message: String(request.body?.message || ''),
      target: typeof request.body?.target === 'string' ? request.body.target : 'auto',
      model_override: typeof request.body?.model_override === 'string' && request.body.model_override.trim()
        ? request.body.model_override.trim()
        : undefined,
    });

    const receipt = service.receipt(prepared);
    void service.execute(prepared)
      .catch(() => undefined)
      .finally(() => database.connection.close());

    response.status(202).json({ ok: true, data: receipt });
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
