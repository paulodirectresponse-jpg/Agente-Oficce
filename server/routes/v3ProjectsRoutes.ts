import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { ProjectService } from '../agent-office/projectService.js';

export const v3ProjectsRouter = Router();

function errorCode(error: unknown, fallback = 'PROJECTS_FAILED') {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : fallback;
}
function statusFor(code: string) {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('INVALID') || code.includes('REQUIRED')) return 400;
  return 500;
}

v3ProjectsRouter.get('/projects', (_req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.json({ ok: true, data: new ProjectService(db.connection).listSummaries() }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.get('/projects/active-selection', (_req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.json({ ok: true, data: new ProjectService(db.connection).getActiveSelection() }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.put('/projects/active-selection', (req, res) => {
  const db = openAgentOfficeDatabase();
  try {
    const projectId = req.body?.project_id == null ? null : String(req.body.project_id);
    res.json({ ok: true, data: new ProjectService(db.connection).setActiveSelection(projectId) });
  } catch (error) {
    const code = errorCode(error);
    res.status(statusFor(code)).json({ ok: false, error: { code, message: code } });
  } finally { db.connection.close(); }
});

v3ProjectsRouter.get('/projects/:projectId', (req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.json({ ok: true, data: new ProjectService(db.connection).detail(req.params.projectId) }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.patch('/projects/:projectId', (req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.json({ ok: true, data: new ProjectService(db.connection).update(req.params.projectId, req.body ?? {}) }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.post('/projects/:projectId/decisions', (req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.status(201).json({ ok: true, data: new ProjectService(db.connection).addDecision(req.params.projectId, req.body ?? {}) }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.post('/projects/:projectId/blockers', (req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.status(201).json({ ok: true, data: new ProjectService(db.connection).addBlocker(req.params.projectId, req.body ?? {}) }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.post('/projects/:projectId/blockers/:blockerId/resolve', (req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.json({ ok: true, data: new ProjectService(db.connection).resolveBlocker(req.params.projectId, req.params.blockerId, String(req.body?.resolution ?? '')) }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});

v3ProjectsRouter.put('/projects/:projectId/result', (req, res) => {
  const db = openAgentOfficeDatabase();
  try { res.json({ ok: true, data: new ProjectService(db.connection).saveResult(req.params.projectId, req.body ?? {}) }); }
  catch (error) { const code = errorCode(error); res.status(statusFor(code)).json({ ok: false, error: { code, message: code } }); }
  finally { db.connection.close(); }
});
