import { useEffect, useState } from 'react';
import type { AgentId, Project, Task, UsageEntry } from './types.js';
import { api } from './api.js';

type DeskState = 'idle' | 'working' | 'blocked';

const AGENTS: AgentId[] = ['kimi', 'claude', 'codex'];

const STATE_LABELS: Record<DeskState, string> = {
  idle: 'ocioso',
  working: 'trabalhando',
  blocked: 'aguardando',
};

function deriveDeskState(agent: AgentId, tasks: Task[]): DeskState {
  const mine = tasks.filter((task) => task.assigned_agent === agent);
  if (mine.some((task) => task.status === 'blocked' || task.status === 'waiting_approval')) return 'blocked';
  if (mine.some((task) => task.status === 'running')) return 'working';
  return 'idle';
}

interface OfficeViewProps {
  project: Project | null;
  manualAgent: AgentId | null;
  onSelectAgent: (agent: AgentId | null) => void;
}

export function OfficeView({ project, manualAgent, onSelectAgent }: OfficeViewProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    api.listTasks(project.id)
      .then(setTasks)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar tarefas.'));
  }, [project]);

  useEffect(() => {
    api.getUsage()
      .then(setUsage)
      .catch(() => undefined);
  }, []);

  if (!project) {
    return (
      <div>
        <h2 className="app-view-title">Office</h2>
        <p className="app-view-subtitle">Selecione um projeto ativo para ver o escritório.</p>
        <div className="empty-state">Nenhum projeto ativo. Selecione um na visão Workspace.</div>
      </div>
    );
  }

  const usageFor = (agent: AgentId) =>
    usage.find((entry) => entry.agent_id === agent && entry.has_data);

  return (
    <div>
      <h2 className="app-view-title">Office</h2>
      <p className="app-view-subtitle">
        Estado dos agentes em {project.name}. Clique em uma mesa para definir o override de execução.
        {manualAgent ? (
          <> Agente selecionado: <strong className="mono">{manualAgent}</strong>{' '}
            <button type="button" className="btn btn-small" onClick={() => onSelectAgent(null)}>limpar</button>
          </>
        ) : (
          <> Roteamento automático ativo.</>
        )}
      </p>

      {error && <p className="error-text">{error}</p>}

      <div className="office-floor">
        {AGENTS.map((agent) => {
          const state = deriveDeskState(agent, tasks);
          const usageEntry = usageFor(agent);
          return (
            <button
              key={agent}
              type="button"
              className={`desk ${state}${manualAgent === agent ? ' selected' : ''}`}
              onClick={() => onSelectAgent(manualAgent === agent ? null : agent)}
            >
              <div className="desk-name">{agent}</div>
              <div className="desk-monitor">
                {usageEntry ? (
                  <span className="mono" style={{ color: '#9aa8bb', fontSize: 11 }}>
                    {usageEntry.runs} runs · {(usageEntry.input_tokens + usageEntry.output_tokens).toLocaleString('pt-BR')} tok
                  </span>
                ) : (
                  <span className="mono" style={{ color: '#4b5a6e', fontSize: 11 }}>sem dados</span>
                )}
              </div>
              <div className="desk-status">{STATE_LABELS[state]}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
