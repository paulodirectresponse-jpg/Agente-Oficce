import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openAgentOfficeDatabase } from './database.js';
import { ProjectRepository } from './projectRepository.js';
import { ProjectService } from './projectService.js';

function fixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-projects-v8-'));
  const root = path.join(dataDir, 'project');
  fs.mkdirSync(root, { recursive: true });
  const database = openAgentOfficeDatabase({ dataDir, databasePath: path.join(dataDir, 'office.sqlite'), logLevel: 'silent' });
  const project = new ProjectRepository(database.connection).create({ name: 'Project V8', root_path: root });
  return { dataDir, root, database, project, done() { database.connection.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

describe('ProjectService', () => {
  it('aggregates runs, plans, workforce-independent progress and persistent project records', () => {
    const f = fixture();
    try {
      const service = new ProjectService(f.database.connection);
      const conversation = f.database.connection.prepare('SELECT id FROM conversations WHERE project_id=?').get(f.project.id) as { id: string };
      const t = new Date().toISOString();

      f.database.connection.prepare(`
        INSERT INTO chat_runs(id,conversation_id,project_id,status,mode,started_at,metadata_json)
        VALUES('run-1',?,?, 'completed','single',?,'{}')
      `).run(conversation.id, f.project.id, t);

      f.database.connection.prepare(`
        INSERT INTO execution_plans(id,project_id,version,status,goal,budget_json,created_at,updated_at)
        VALUES('plan-1',?,1,'completed','Build the feature','{}',?,?)
      `).run(f.project.id, t, t);
      f.database.connection.prepare(`
        INSERT INTO execution_steps(id,plan_id,key,title,goal,status,resume_state,created_at,updated_at)
        VALUES('step-1','plan-1','s1','Step','Do it','completed','completed',?,?)
      `).run(t, t);
      f.database.connection.prepare(`
        INSERT INTO execution_artifacts(id,plan_id,step_id,type,uri,payload_json,created_at)
        VALUES('artifact-1','plan-1','step-1','file','dist/result.txt','{}',?)
      `).run(t);

      service.update(f.project.id, { objective: 'Ship Project V8' });
      service.addDecision(f.project.id, { title: 'Architecture', decision: 'Reuse execution plans.' });
      const blocker = service.addBlocker(f.project.id, { title: 'Review needed', detail: 'Check final output.' }) as any;

      let detail = service.detail(f.project.id);
      expect(detail.project.objective).toBe('Ship Project V8');
      expect(detail.counts.runs.root).toBe(1);
      expect(detail.counts.plans.completed).toBe(1);
      expect(detail.counts.steps.completed).toBe(1);
      expect(detail.counts.blockers.open).toBe(1);
      expect(detail.artifacts.map((x: any) => x.id)).toContain('artifact-1');
      expect(detail.decisions).toHaveLength(1);

      service.resolveBlocker(f.project.id, blocker.id, 'Reviewed');
      service.saveResult(f.project.id, { status: 'final', summary: 'Done', result: 'Delivered', artifact_ids: ['artifact-1'] });

      detail = service.detail(f.project.id);
      expect(detail.project.lifecycle_status).toBe('completed');
      expect(detail.counts.blockers.open).toBe(0);
      expect(detail.result?.status).toBe('final');
      expect(detail.result?.artifacts).toHaveLength(1);
      expect(detail.operational_state).toBe('completed');
    } finally { f.done(); }
  });

  it('persists and validates the last active project selection', () => {
    const f = fixture();
    try {
      const service = new ProjectService(f.database.connection);
      expect(service.getActiveSelection()).toEqual({ project_id: null });
      expect(service.setActiveSelection(f.project.id)).toEqual({ project_id: f.project.id });
      expect(service.getActiveSelection()).toEqual({ project_id: f.project.id });
      expect(() => service.setActiveSelection('missing')).toThrow('PROJECT_NOT_FOUND');
    } finally { f.done(); }
  });

  it('reports factual step counts instead of inventing a project percentage', () => {
    const f = fixture();
    try {
      const service = new ProjectService(f.database.connection);
      const t = new Date().toISOString();
      f.database.connection.prepare(`
        INSERT INTO execution_plans(id,project_id,version,status,goal,budget_json,created_at,updated_at)
        VALUES('plan-p',?,1,'running','Mixed work','{}',?,?)
      `).run(f.project.id, t, t);
      const insert = f.database.connection.prepare(`
        INSERT INTO execution_steps(id,plan_id,key,title,goal,status,resume_state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?)
      `);
      insert.run('s-a','plan-p','a','A','A','completed','completed',t,t);
      insert.run('s-b','plan-p','b','B','B','running','running_model',t,t);
      insert.run('s-c','plan-p','c','C','C','blocked','blocked',t,t);
      const summary = service.summary(f.project.id);
      expect(summary.counts.steps).toMatchObject({ total: 3, completed: 1, running: 1, blocked: 1 });
      expect(summary).not.toHaveProperty('progress_percent');
    } finally { f.done(); }
  });
});
