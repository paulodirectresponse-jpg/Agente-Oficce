import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentProfile, Project, UniversalProvider } from './types.js';
import { WorkspaceView } from './WorkspaceView.js';
import { UsageView } from './UsageView.js';
import { SettingsView } from './SettingsView.js';
import { OfficeView } from './OfficeView.js';
import { api } from './api.js';
import './App.css';

type ViewKey = 'office' | 'chat' | 'agents' | 'providers' | 'projects' | 'usage' | 'settings';
type RuntimeState = 'checking' | 'online' | 'offline';

const NAV_ITEMS: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'office', label: 'Office', icon: '⌂' },
  { key: 'chat', label: 'Chat', icon: '◌' },
  { key: 'agents', label: 'Agentes', icon: '◉' },
  { key: 'providers', label: 'Providers', icon: '⌁' },
  { key: 'projects', label: 'Projetos', icon: '□' },
  { key: 'usage', label: 'Uso', icon: '↯' },
  { key: 'settings', label: 'Configurações', icon: '⚙' },
];

function providerDotClass(provider: UniversalProvider): string {
  if (!provider.enabled || provider.health_status === 'unavailable') return 'offline';
  if (provider.health_status === 'healthy') return 'online';
  return 'unknown';
}

function AgentsOverview({ agents, providers }: { agents: AgentProfile[]; providers: UniversalProvider[] }) {
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);
  return (
    <div className="overview-page">
      <header className="overview-header">
        <div>
          <span className="office-kicker">Equipe</span>
          <h1>Agentes</h1>
          <p>Visão atual dos agentes dinâmicos. A edição completa entra na Fase F.</p>
        </div>
        <span className="overview-count">{agents.filter((agent) => agent.enabled).length} ativos</span>
      </header>
      <div className="overview-grid">
        {agents.map((agent, index) => {
          const provider = agent.provider_id ? providerById.get(agent.provider_id) : undefined;
          return (
            <article key={agent.id} className="overview-card">
              <div className={`overview-avatar avatar-${index % 3}`}>{agent.name.slice(0, 1).toUpperCase()}</div>
              <div className="overview-card-copy">
                <strong>{agent.name}</strong>
                <span>{agent.role || 'AI Agent'}</span>
                <small>{provider?.name ?? 'Sem provider'} · {agent.model_id ? 'modelo vinculado' : 'sem modelo'}</small>
              </div>
              <span className={`mini-status ${agent.enabled ? 'online' : 'offline'}`} />
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ProvidersOverview({ providers }: { providers: UniversalProvider[] }) {
  return (
    <div className="overview-page">
      <header className="overview-header">
        <div>
          <span className="office-kicker">Conexões</span>
          <h1>Providers</h1>
          <p>Estado das conexões do Universal Provider Engine.</p>
        </div>
        <span className="overview-count">{providers.length} cadastrados</span>
      </header>
      <div className="overview-grid providers">
        {providers.map((provider) => (
          <article key={provider.id} className="overview-card provider-card">
            <span className={`provider-mark ${providerDotClass(provider)}`}>⌁</span>
            <div className="overview-card-copy">
              <strong>{provider.name}</strong>
              <span>{provider.protocol_driver}</span>
              <small>{provider.base_url || 'Base URL não configurada'}</small>
            </div>
            <span className={`provider-health ${providerDotClass(provider)}`}>
              {provider.health_status}
            </span>
          </article>
        ))}
        {!providers.length && (
          <div className="overview-empty">Nenhum provider cadastrado ainda.</div>
        )}
      </div>
    </div>
  );
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
      const [nextProjects, nextProviders, nextAgents] = await Promise.all([
        api.listProjects(),
        api.listProvidersV2(),
        api.listAgentsV2(),
      ]);
      setProjects(nextProjects);
      setProviders(nextProviders);
      setAgents(nextAgents);
      setActiveProject((current) => {
        if (current) return nextProjects.find((project) => project.id === current.id) ?? nextProjects[0] ?? null;
        return nextProjects[0] ?? null;
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
          <span>Agent Office v0.2</span>
          <small>API-first · local runtime</small>
        </div>
      </aside>

      <main className="app-main experience-main">
        {runtimeState === 'offline' && (
          <div className="runtime-banner">
            O runtime local não respondeu. A interface permanece disponível e voltará a sincronizar automaticamente.
          </div>
        )}

        {(view === 'office' || view === 'chat') && (
          <OfficeView project={activeProject} focus={view === 'chat' ? 'chat' : 'office'} />
        )}

        {view === 'agents' && <AgentsOverview agents={agents} providers={providers} />}
        {view === 'providers' && <ProvidersOverview providers={providers} />}

        {view === 'projects' && (
          <WorkspaceView
            activeProject={activeProject}
            onSelectProject={(project) => {
              setActiveProject(project);
              void loadShellData();
            }}
          />
        )}

        {view === 'usage' && <UsageView />}
        {view === 'settings' && <SettingsView />}

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
