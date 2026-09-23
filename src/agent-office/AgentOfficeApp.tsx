import { useCallback, useEffect, useState } from 'react';
import type { AgentProfile, Project, UniversalProvider } from './types.js';
import { WorkspaceView } from './WorkspaceView.js';
import { AnalyticsView } from './AnalyticsView.js';
import { SettingsView } from './SettingsView.js';
import { OfficeView } from './OfficeView.js';
import { AgentManagerView } from './AgentManagerView.js';
import { ProviderManagerView } from './ProviderManagerView.js';
import { IntegrationsView } from './IntegrationsView.js';
import { TeamsView } from './TeamsView.js';
import { OrchestratorView } from './OrchestratorView.js';
import { WorkforcesView } from './WorkforcesView.js';
import { DevChatView } from './DevChatView.js';
import { api } from './api.js';
import './App.css';

type ViewKey = 'office' | 'chat' | 'orchestrator' | 'agents' | 'teams' | 'workforces' | 'providers' | 'integrations' | 'projects' | 'analytics' | 'settings';
type RuntimeState = 'checking' | 'online' | 'offline';

const NAV_ITEMS: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'office', label: 'Office', icon: '⌂' },
  { key: 'chat', label: 'Chat', icon: '◌' },
  { key: 'orchestrator', label: 'Orquestrador', icon: '◆' },
  { key: 'agents', label: 'Agentes', icon: '◉' },
  { key: 'teams', label: 'Teams', icon: '◎' },
  { key: 'workforces', label: 'Workforces', icon: '◇' },
  { key: 'providers', label: 'Providers', icon: '⌁' },
  { key: 'integrations', label: 'Integrações', icon: '⇄' },
  { key: 'projects', label: 'Projetos', icon: '□' },
  { key: 'analytics', label: 'Analytics', icon: '↯' },
  { key: 'settings', label: 'Configurações', icon: '⚙' },
];

function providerDotClass(provider: UniversalProvider): string {
  if (!provider.enabled || provider.health_status === 'unavailable') return 'offline';
  if (provider.health_status === 'healthy') return 'online';
  return 'unknown';
}

export function AgentOfficeApp() {
  const [view, setView] = useState<ViewKey>('office');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [providers, setProviders] = useState<UniversalProvider[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>('checking');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const loadShellData = useCallback(async () => {
    try {
      const [nextProjects, nextProviders, nextAgents, selection] = await Promise.all([
        api.listProjects(),
        api.listProvidersV2(),
        api.listAgentsV2(),
        api.getActiveProjectSelectionV3().catch(() => ({ project_id: null })),
      ]);
      setProjects(nextProjects);
      setProviders(nextProviders);
      setAgents(nextAgents);
      setActiveProject((current) => {
        if (current) return nextProjects.find((project) => project.id === current.id) ?? nextProjects.find((project) => project.id === selection.project_id) ?? nextProjects[0] ?? null;
        return nextProjects.find((project) => project.id === selection.project_id) ?? nextProjects[0] ?? null;
      });
    } catch {
      // Runtime banner handles connectivity; individual pages keep their own errors.
    }
  }, []);

  useEffect(() => {
    let active = true;
    let healthTimer: number | undefined;
    let shellTimer: number | undefined;

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
    void loadShellData();
    healthTimer = window.setInterval(check, 5000);
    shellTimer = window.setInterval(() => {
      void loadShellData();
    }, 12000);

    return () => {
      active = false;
      if (healthTimer !== undefined) window.clearInterval(healthTimer);
      if (shellTimer !== undefined) window.clearInterval(shellTimer);
    };
  }, [loadShellData]);

  const healthyProviders = providers.filter((provider) => provider.enabled && provider.health_status === 'healthy').length;
  const enabledAgents = agents.filter((agent) => agent.enabled);

  return (
    <div className={`app-shell experience-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="app-sidebar experience-sidebar">
        <div className="brand-row">
          <div className="brand-mark">A</div>
          <div className="brand-copy">
            <strong>Agent Office</strong>
            <span>Local First. More Possibilities.</span>
          </div>
          <button
            type="button"
            className="sidebar-collapse-button"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label="Alternar sidebar"
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        <div className="project-switcher">
          <span>Projeto</span>
          <select
            value={activeProject?.id ?? ''}
            onChange={(event) => {
              const selected = projects.find((project) => project.id === event.target.value) ?? null;
              setActiveProject(selected);
              void api.setActiveProjectSelectionV3(selected?.id ?? null).catch(() => undefined);
              setView('office');
            }}
          >
            <option value="">Selecione um projeto</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <small>
            {activeProject
              ? `${enabledAgents.length} agentes · 1 conversa`
              : 'Nenhum projeto ativo'}
          </small>
        </div>

        <nav className="experience-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`experience-nav-button ${view === item.key ? 'active' : ''}`}
              onClick={() => setView(item.key)}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        <div className="engine-card">
          <div className="engine-title">
            <span className={`engine-dot ${runtimeState}`} />
            <div>
              <strong>Local Engine</strong>
              <span>{runtimeState === 'online' ? 'Running' : runtimeState === 'offline' ? 'Offline' : 'Starting'}</span>
            </div>
          </div>
          <div className="provider-mini-list">
            {providers.slice(0, 4).map((provider) => (
              <div key={provider.id}>
                <span className="provider-mini-icon">{provider.name.slice(0, 1).toUpperCase()}</span>
                <span>{provider.name}</span>
                <span className={`mini-status ${providerDotClass(provider)}`} />
              </div>
            ))}
            {!providers.length && <small>Nenhum provider configurado.</small>}
          </div>
          <button type="button" onClick={() => setView('providers')} className="add-provider-link">
            + Ver providers
          </button>
        </div>

        <div className="sidebar-footer">
          <span>Agent Office v0.4</span>
          <small>API-first · local runtime</small>
        </div>
      </aside>

      <main className="app-main experience-main">
        {runtimeState === 'offline' && (
          <div className="runtime-banner">
            O runtime local não respondeu. A interface permanece disponível e voltará a sincronizar automaticamente.
          </div>
        )}

        {view === 'office' && <OfficeView project={activeProject} focus="office" />}
        {view === 'chat' && <DevChatView project={activeProject} />}

        {view === 'orchestrator' && <OrchestratorView providers={providers} />}
        {view === 'agents' && <AgentManagerView agents={agents} providers={providers} onChanged={loadShellData} />}
        {view === 'teams' && <TeamsView agents={agents} />}
        {view === 'workforces' && <WorkforcesView />}
        {view === 'providers' && <ProviderManagerView providers={providers} onChanged={loadShellData} />}
        {view === 'integrations' && <div className="legacy-view-wrap"><IntegrationsView project={activeProject} /></div>}

        {view === 'projects' && (
          <div className="legacy-view-wrap">
            <WorkspaceView
              activeProject={activeProject}
              onSelectProject={(project) => {
                setActiveProject(project);
                void api.setActiveProjectSelectionV3(project.id).catch(() => undefined);
                void loadShellData();
              }}
            />
          </div>
        )}

        {view === 'analytics' && <div className="legacy-view-wrap"><AnalyticsView /></div>}
        {view === 'settings' && <div className="legacy-view-wrap"><SettingsView /></div>}

        {view !== 'office' && view !== 'chat' && (
          <div className="shell-top-status">
            <span className={`shell-runtime ${runtimeState}`}>
              <span />
              {runtimeState === 'online' ? 'Local runtime online' : runtimeState === 'offline' ? 'Local runtime offline' : 'Iniciando runtime'}
            </span>
            <span>{healthyProviders}/{providers.length} providers saudáveis</span>
          </div>
        )}
      </main>
    </div>
  );
}
