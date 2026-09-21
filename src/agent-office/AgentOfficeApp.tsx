import { useState } from 'react';
import type { AgentId, Project } from './types.js';
import { WorkspaceView } from './WorkspaceView.js';
import { TasksView } from './TasksView.js';
import { UsageView } from './UsageView.js';
import { SettingsView } from './SettingsView.js';
import { OfficeView } from './OfficeView.js';
import './App.css';

type ViewKey = 'workspace' | 'tasks' | 'usage' | 'settings' | 'office';

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

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">Agent Office</div>
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
