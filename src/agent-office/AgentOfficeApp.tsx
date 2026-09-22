import { useEffect, useState } from 'react';
import type { AgentId, Project } from './types.js';
import { WorkspaceView } from './WorkspaceView.js';
import { TasksView } from './TasksView.js';
import { UsageView } from './UsageView.js';
import { SettingsView } from './SettingsView.js';
import { OfficeView } from './OfficeView.js';
import { api } from './api.js';
import './App.css';

type ViewKey = 'workspace' | 'tasks' | 'usage' | 'settings' | 'office';
type RuntimeState = 'checking' | 'online' | 'offline';

const NAV_ITEMS: { key: ViewKey; label: string }[] = [
  { key: 'workspace', label: 'Workspace' },
  { key: 'tasks', label: 'Tarefas' },
  { key: 'usage', label: 'Uso' },
  { key: 'settings', label: 'Configurações' },
  { key: 'office', label: 'Office' },
];

export function AgentOfficeApp() {
  const [view, setView] = useState<ViewKey>('workspace');
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [manualAgent, setManualAgent] = useState<AgentId | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('checking');

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const check = () => {
      api.health()
        .then(() => {
          if (active) setRuntimeState('online');
        })
        .catch(() => {
          if (active) setRuntimeState('offline');
        });
    };

    check();
    timer = window.setInterval(check, 5000);
    return () => {
      active = false;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">Agent Office</div>
        <div className={`runtime-status ${runtimeState}`}>
          <span className="runtime-dot" />
          {runtimeState === 'online' ? 'Runtime local online' : runtimeState === 'offline' ? 'Runtime local offline' : 'Iniciando runtime…'}
        </div>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`app-nav-button${view === item.key ? ' active' : ''}`}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </aside>
      <main className="app-main">
        {runtimeState === 'offline' && (
          <div className="runtime-banner">
            O backend local não respondeu. A interface continua disponível; recursos de dados ficarão ativos assim que o runtime iniciar.
          </div>
        )}
        {view === 'workspace' && (
          <WorkspaceView activeProject={activeProject} onSelectProject={setActiveProject} />
        )}
        {view === 'tasks' &&
          (activeProject ? (
            <TasksView project={activeProject} manualAgent={manualAgent} onSelectAgent={setManualAgent} />
          ) : (
            <div>
              <h2 className="app-view-title">Tarefas</h2>
              <p className="app-view-subtitle">Selecione um projeto ativo para gerenciar tarefas.</p>
              <div className="empty-state">Nenhum projeto ativo. Selecione um na visão Workspace.</div>
            </div>
          ))}
        {view === 'usage' && <UsageView />}
        {view === 'settings' && <SettingsView />}
        {view === 'office' && (
          <OfficeView project={activeProject} manualAgent={manualAgent} onSelectAgent={setManualAgent} />
        )}
      </main>
    </div>
  );
}
