import { useCallback, useEffect, useState } from 'react';
import type { AgentProfile, Project, UniversalProvider } from './types.js';
import { ProjectsView } from './ProjectsView.js';
import { ConfiguracoesView } from './ConfiguracoesView.js';
import { EquipeView } from './EquipeView.js';
import { ConexoesView } from './ConexoesView.js';
import { TrabalhoView } from './TrabalhoView.js';
import { ProjectSwitcher } from './shell/ProjectSwitcher.js';
import type { ProjectMenuAction } from './shell/ProjectSwitcher.js';
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
  const [projectIntent, setProjectIntent] = useState<ProjectMenuAction>('all');
  const [shellReady, setShellReady] = useState(false);

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
      setShellReady(true);
    } catch {
      // Runtime banner handles connectivity; individual pages keep their own errors.
      setShellReady(true);
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
      <a className="ux2-skip-link" href="#main-content">Ir para o conteúdo</a>
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
          onMenuAction={(action) => { setProjectIntent(action); setView('projects'); }}
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

        <SystemStatusFooter runtimeState={runtimeState} onOpenSystem={() => navigate('system')} />
      </aside>

      <main className="app-main experience-main" id="main-content">
        {runtimeState === 'offline' && (
          <div className="runtime-banner" role="alert">
            O runtime local não respondeu. A interface permanece disponível e voltará a sincronizar automaticamente.
          </div>
        )}

        {!shellReady && <div className="ux2-shell-loading" role="status" aria-live="polite"><span className="ux2-loading-dot" aria-hidden="true"/><strong>Preparando Agent Office…</strong><small>Carregando Projects, equipe e conexões.</small></div>}
        {shellReady && view === 'trabalho' && <TrabalhoView project={activeProject} />}
        {shellReady && view === 'equipe' && <EquipeView agents={agents} providers={providers} onChanged={loadShellData} />}
        {shellReady && view === 'conexoes' && <ConexoesView providers={providers} project={activeProject} onChanged={loadShellData} />}
        {shellReady && view === 'configuracoes' && <ConfiguracoesView providers={providers} />}
        {shellReady && view === 'system' && <SystemCenterView runtimeState={runtimeState} providers={providers} activeProject={activeProject} />}

        {shellReady && view === 'projects' && (
          <ProjectsView
            activeProject={activeProject}
            intent={projectIntent}
            onOpenWork={() => setView('trabalho')}
            onSelectProject={(project) => {
              switchProject(project);
              void loadShellData();
            }}
          />
        )}
      </main>
    </div>
  );
}
