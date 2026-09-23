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
import { LegacyNav } from './shell/LegacyNav.js';
import { ProjectSwitcher } from './shell/ProjectSwitcher.js';
import { SystemCenterView } from './shell/SystemCenterView.js';
import { SystemStatusFooter } from './shell/SystemStatusFooter.js';
import { PRIMARY_NAV, activePrimaryKey } from './shell/shellModel.js';
import type { RuntimeState, ViewKey } from './shell/shellModel.js';
import { api } from './api.js';
import './App.css';

export function AgentOfficeApp() {
  const [view, setView] = useState<ViewKey>('trabalho');
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

  const switchProject = useCallback((project: Project | null) => {
    setActiveProject(project);
    void api.setActiveProjectSelectionV3(project?.id ?? null).catch(() => undefined);
  }, []);

  const navigate = useCallback((next: ViewKey) => {
    setView(next);
  }, []);

  const primaryActive = activePrimaryKey(view);

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
            aria-label="Alternar barra lateral"
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>

        <ProjectSwitcher
          projects={projects}
          activeProject={activeProject}
          onSwitch={(project) => switchProject(project)}
          onMenuAction={() => setView('projects')}
        />

        <nav className="experience-nav" aria-label="Navegação principal">
          {PRIMARY_NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`experience-nav-button ${primaryActive === item.key ? 'active' : ''}`}
              onClick={() => navigate(item.key)}
              title={sidebarCollapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        {!sidebarCollapsed && <LegacyNav current={view} onNavigate={navigate} />}

        <SystemStatusFooter runtimeState={runtimeState} onOpenSystem={() => navigate('system')} />
      </aside>

      <main className="app-main experience-main">
        {runtimeState === 'offline' && (
          <div className="runtime-banner" role="alert">
            O runtime local não respondeu. A interface permanece disponível e voltará a sincronizar automaticamente.
          </div>
        )}

        {view === 'trabalho' && <DevChatView project={activeProject} />}
        {view === 'equipe' && <AgentManagerView agents={agents} providers={providers} onChanged={loadShellData} />}
        {view === 'conexoes' && <ProviderManagerView providers={providers} onChanged={loadShellData} />}
        {view === 'configuracoes' && <div className="legacy-view-wrap"><SettingsView /></div>}
        {view === 'system' && <SystemCenterView runtimeState={runtimeState} providers={providers} activeProject={activeProject} />}

        {view === 'office' && <OfficeView project={activeProject} focus="office" />}
        {view === 'chat' && <DevChatView project={activeProject} />}
        {view === 'orchestrator' && <OrchestratorView providers={providers} />}
        {view === 'teams' && <TeamsView agents={agents} />}
        {view === 'workforces' && <WorkforcesView />}
        {view === 'integrations' && <div className="legacy-view-wrap"><IntegrationsView project={activeProject} /></div>}
        {view === 'analytics' && <div className="legacy-view-wrap"><AnalyticsView /></div>}

        {view === 'projects' && (
          <div className="legacy-view-wrap">
            <WorkspaceView
              activeProject={activeProject}
              onSelectProject={(project) => {
                switchProject(project);
                void loadShellData();
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
