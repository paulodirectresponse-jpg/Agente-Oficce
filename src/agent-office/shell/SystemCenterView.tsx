import { useCallback, useEffect, useState } from 'react';
import { AnalyticsView } from '../AnalyticsView.js';
import { OrchestratorView } from '../OrchestratorView.js';
import { api } from '../api.js';
import type { ActivityEventV2, Project, ReleasePreflightReport, UniversalProvider } from '../types.js';
import { runtimeLabel } from './shellModel.js';
import type { RuntimeState } from './shellModel.js';

type SystemTab = 'atividade' | 'uso' | 'saude' | 'orquestracao' | 'diagnostico';

const SYSTEM_TABS: { key: SystemTab; label: string }[] = [
  { key: 'atividade', label: 'Atividade' },
  { key: 'uso', label: 'Uso & Custo' },
  { key: 'saude', label: 'Saúde' },
  { key: 'orquestracao', label: 'Orquestração' },
  { key: 'diagnostico', label: 'Diagnóstico' },
];

function providerHealthLabel(provider: UniversalProvider): { text: string; tone: 'ok' | 'warn' | 'off' } {
  if (!provider.enabled) return { text: 'Desativada', tone: 'off' };
  if (provider.health_status === 'healthy') return { text: 'Tudo certo', tone: 'ok' };
  if (provider.health_status === 'unavailable') return { text: 'Indisponível', tone: 'off' };
  return { text: 'Verificando', tone: 'warn' };
}

interface SystemCenterViewProps {
  runtimeState: RuntimeState;
  providers: UniversalProvider[];
  activeProject: Project | null;
}

export function SystemCenterView({ runtimeState, providers, activeProject }: SystemCenterViewProps) {
  const [tab, setTab] = useState<SystemTab>('atividade');
  const [activity, setActivity] = useState<ActivityEventV2[] | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<ReleasePreflightReport | null>(null);

  const loadActivity = useCallback(async () => {
    if (!activeProject) {
      setActivity(null);
      return;
    }
    try {
      setActivityError(null);
      const events = await api.listActivityV2(activeProject.id);
      setActivity(events.slice(0, 40));
    } catch {
      setActivityError('Não foi possível carregar a atividade agora.');
    }
  }, [activeProject]);

  useEffect(() => {
    if (tab === 'atividade') {
      void loadActivity();
      const timer = window.setInterval(() => void loadActivity(), 8000);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [tab, loadActivity]);

  useEffect(() => {
    if (tab !== 'diagnostico' || preflight) return undefined;
    let cancelled = false;
    void api.getReleasePreflightV3(false)
      .then((report) => {
        if (!cancelled) setPreflight(report);
      })
      .catch(() => {
        if (!cancelled) setPreflight(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, preflight]);

  const healthyCount = providers.filter((provider) => provider.enabled && provider.health_status === 'healthy').length;

  return (
    <section className="ux2-system-center" aria-label="Central do sistema">
      <header className="ux2-system-header">
        <div>
          <h1>Central do sistema</h1>
          <p>Atividade, uso e saúde do Agent Office. Detalhes técnicos ficam aqui, fora do caminho do trabalho.</p>
        </div>
      </header>

      <div className="ux2-tabs" role="tablist" aria-label="Seções do sistema">
        {SYSTEM_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`ux2-tab-button ${tab === item.key ? 'active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="ux2-system-body">
        {tab === 'atividade' && (
          <div role="tabpanel">
            {!activeProject && (
              <div className="ux2-empty">
                <strong>Sem projeto ativo</strong>
                <p>Selecione um projeto no topo da barra lateral para ver a atividade recente.</p>
              </div>
            )}
            {activeProject && activityError && (
              <div className="ux2-empty" role="alert">
                <strong>Atividade indisponível</strong>
                <p>{activityError}</p>
              </div>
            )}
            {activeProject && !activityError && activity !== null && activity.length === 0 && (
              <div className="ux2-empty">
                <strong>Sem atividade recente</strong>
                <p>Quando houver execuções no projeto “{activeProject.name}”, elas aparecem aqui.</p>
              </div>
            )}
            {activeProject && activity !== null && activity.length > 0 && (
              <ul className="ux2-activity-list">
                {activity.map((event) => (
                  <li key={event.id}>
                    <span className={`ux2-activity-dot ${event.severity}`} aria-hidden="true" />
                    <div className="ux2-activity-text">
                      <strong>{event.title}</strong>
                      {event.detail && <p>{event.detail}</p>}
                    </div>
                    <time>{new Date(event.created_at).toLocaleString()}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'uso' && (
          <div role="tabpanel" className="ux2-system-embed">
            <AnalyticsView />
          </div>
        )}

        {tab === 'saude' && (
          <div role="tabpanel" className="ux2-health">
            <div className="ux2-health-row">
              <span className={`ux2-system-dot ${runtimeState}`} aria-hidden="true" />
              <div>
                <strong>{runtimeLabel(runtimeState)}</strong>
                <p>O runtime local executa na sua máquina e mantém seus dados com você.</p>
              </div>
            </div>
            <div className="ux2-health-row">
              <span className="ux2-system-dot online" aria-hidden="true" />
              <div>
                <strong>
                  {healthyCount} de {providers.length} {providers.length === 1 ? 'IA conectada' : 'IAs conectadas'} disponíveis
                </strong>
                <p>Conexões de IA usadas pelos Agents.</p>
              </div>
            </div>
            {providers.length > 0 && (
              <ul className="ux2-health-list">
                {providers.map((provider) => {
                  const health = providerHealthLabel(provider);
                  return (
                    <li key={provider.id}>
                      <span>{provider.name}</span>
                      <span className={`ux2-health-status ${health.tone}`}>{health.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {tab === 'orquestracao' && (
          <div role="tabpanel" className="ux2-system-embed">
            <OrchestratorView providers={providers} />
          </div>
        )}

        {tab === 'diagnostico' && (
          <div role="tabpanel">
            {!preflight && <p className="ux2-muted">Carregando verificação de lançamento…</p>}
            {preflight && (
              <>
                <p className="ux2-muted">
                  Verificação gerada em {new Date(preflight.generated_at).toLocaleString()} · banco na versão{' '}
                  {preflight.migration_version}
                </p>
                <ul className="ux2-preflight-list">
                  {preflight.checks.map((check) => (
                    <li key={check.id} className={check.status}>
                      <strong>{check.label}</strong>
                      <p>{check.detail}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
