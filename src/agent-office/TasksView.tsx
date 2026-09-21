import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentId, Project, Task, TaskEvent, TaskStatus } from './types.js';
import { api } from './api.js';

const STATUS_LABELS: Record<TaskStatus, string> = {
  queued: 'na fila',
  running: 'executando',
  blocked: 'bloqueada',
  waiting_approval: 'aguardando aprovação',
  completed: 'concluída',
  failed: 'falhou',
  cancelled: 'cancelada',
};

function summarizePayload(payloadJson: string): string {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    return Object.entries(parsed)
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join(' ')
      .slice(0, 160);
  } catch {
    return payloadJson.slice(0, 160);
  }
}

interface TasksViewProps {
  project: Project;
  manualAgent: AgentId | null;
  onSelectAgent: (agent: AgentId | null) => void;
}

export function TasksView({ project, manualAgent, onSelectAgent }: TasksViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [risk, setRisk] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  const load = useCallback(() => {
    api.listTasks(project.id)
      .then(setTasks)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar tarefas.'))
      .finally(() => setLoading(false));
  }, [project.id]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load();
  }, [load]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (taskId: string) => {
      stopPolling();
      const tick = () => {
        Promise.all([
          api.listTasks(project.id).then(setTasks).catch(() => undefined),
          api.listTaskEvents(project.id, taskId)
            .then(setEvents)
            .catch((reason: unknown) => setEventsError(reason instanceof Error ? reason.message : 'Falha ao carregar eventos.')),
        ]).then(() => {
          setTasks((current) => {
            const task = current.find((item) => item.id === taskId);
            if (!task || task.status !== 'running') {
              stopPolling();
              setRunningId(null);
            }
            return current;
          });
        });
      };
      tick();
      pollTimer.current = window.setInterval(tick, 2000);
    },
    [project.id, stopPolling],
  );

  useEffect(() => stopPolling, [stopPolling]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setCreateError(null);
    api.createTask(project.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      category: category.trim() || undefined,
      risk: risk.trim() || undefined,
    })
      .then(() => {
        setTitle('');
        setDescription('');
        setCategory('');
        setRisk('');
        load();
      })
      .catch((reason: unknown) => setCreateError(reason instanceof Error ? reason.message : 'Falha ao criar tarefa.'))
      .finally(() => setCreating(false));
  };

  const runTask = (task: Task) => {
    setRunError(null);
    api.runTask(project.id, task.id, manualAgent ?? undefined)
      .then(() => {
        setRunningId(task.id);
        setEvents([]);
        startPolling(task.id);
        load();
      })
      .catch((reason: unknown) => setRunError(reason instanceof Error ? reason.message : 'Falha ao executar tarefa.'));
  };

  return (
    <div>
      <h2 className="app-view-title">Tarefas · {project.name}</h2>
      <p className="app-view-subtitle">
        Agente manual selecionado: <strong className="mono">{manualAgent ?? 'auto'}</strong> (defina no botão abaixo ou na visão Office)
      </p>

      <div className="panel">
        <h3>Nova tarefa</h3>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="task-title">Título</label>
            <input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="task-description">Descrição (opcional)</label>
            <textarea
              id="task-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="task-category">Categoria</label>
              <input id="task-category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="ex.: feature, bugfix" />
            </div>
            <div className="field">
              <label htmlFor="task-risk">Risco</label>
              <select id="task-risk" value={risk} onChange={(event) => setRisk(event.target.value)}>
                <option value="">—</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </div>
          </div>
          {createError && <p className="error-text">{createError}</p>}
          <button type="submit" className="btn btn-primary" disabled={creating}>
            {creating ? 'Criando…' : 'Criar tarefa'}
          </button>
        </form>
      </div>

      <div className="panel">
        <h3>Agente para execução</h3>
        <div className="form-row">
          <div className="field">
            <label htmlFor="run-agent">Override de agente</label>
            <select
              id="run-agent"
              value={manualAgent ?? ''}
              onChange={(event) => onSelectAgent((event.target.value || null) as AgentId | null)}
            >
              <option value="">Auto (roteamento automático)</option>
              <option value="kimi">Kimi</option>
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          </div>
        </div>
      </div>

      {loading && <p className="muted">Carregando tarefas…</p>}
      {error && <p className="error-text">{error}</p>}
      {runError && <p className="error-text">{runError}</p>}
      {!loading && !error && tasks.length === 0 && (
        <div className="empty-state">Nenhuma tarefa neste projeto. Crie a primeira acima.</div>
      )}

      {tasks.map((task) => (
        <div key={task.id} className="list-item" style={{ cursor: 'default' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span>{task.title}</span>
              <span className={`badge badge-${task.status}`}>{STATUS_LABELS[task.status] ?? task.status}</span>
            </div>
            <div className="mono muted" style={{ marginTop: 4 }}>
              {task.category ?? 'sem categoria'} · risco: {task.risk ?? '—'} · agente: {task.assigned_agent ?? '—'} · tentativas: {task.attempt_count}
              {task.description ? ` · ${task.description}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => runTask(task)}
              disabled={task.status === 'running' || runningId !== null}
            >
              Executar
            </button>
          </div>
        </div>
      ))}

      {runningId && (
        <div className="events-drawer">
          <div className="mono" style={{ marginBottom: 8, color: '#8fa0b5' }}>
            Eventos da execução (atualizando a cada 2s)…
          </div>
          {eventsError && <p className="error-text">{eventsError}</p>}
          {!eventsError && events.length === 0 && <p className="muted">Aguardando eventos…</p>}
          {events.map((event, index) => (
            <div key={`${event.run_id}-${index}`} className="event-row">
              <span className="event-type">{event.event_type}</span>
              <span className="event-payload">{summarizePayload(event.payload_json)}</span>
              <span className="event-time">{new Date(event.created_at).toLocaleTimeString('pt-BR')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
