import { useEffect, useMemo, useState } from 'react';
import type { OrchestrationEvent, OrchestrationRun, OrchestratorModelRef, OrchestratorSettings, OrchestratorStatus, ProviderModel, UniversalProvider } from './types.js';
import { api } from './api.js';

function healthClass(value?: string): string {
  if (value === 'healthy' || value === 'busy' || value === 'queued') return 'online';
  if (value === 'unavailable' || value === 'auth_error' || value === 'misconfigured') return 'offline';
  return 'unknown';
}

export function OrchestratorView({ providers }: { providers: UniversalProvider[] }) {
  const [draft, setDraft] = useState<OrchestratorSettings | null>(null);
  const [status, setStatus] = useState<OrchestratorStatus | null>(null);
  const [runs, setRuns] = useState<OrchestrationRun[]>([]);
  const [events, setEvents] = useState<OrchestrationEvent[]>([]);
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, ProviderModel[]>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabledProviders = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);

  const load = async () => {
    try {
      const [nextSettings, nextStatus, nextRuns, nextEvents] = await Promise.all([
        api.getOrchestratorSettingsV3(),
        api.getOrchestratorStatusV3(),
        api.listOrchestrationRunsV3(80),
        api.listOrchestrationEventsV3(160),
      ]);
      setDraft((current) => current ?? nextSettings);
      setStatus(nextStatus);
      setRuns(nextRuns);
      setEvents(nextEvents);
      setSelectedRunId((current) => current ?? nextRuns[0]?.id ?? null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar o Orquestrador.');
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void Promise.all([
        api.getOrchestratorStatusV3(),
        api.listOrchestrationRunsV3(80),
        api.listOrchestrationEventsV3(160),
      ]).then(([nextStatus, nextRuns, nextEvents]) => {
        setStatus(nextStatus);
        setRuns(nextRuns);
        setEvents(nextEvents);
      }).catch(() => {});
    }, 5000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const ids = new Set<string>();
    for (const ref of [draft?.principal, draft?.fast, draft?.deep]) {
      if (ref?.provider_id) ids.add(ref.provider_id);
    }
    ids.forEach((providerId) => {
      if (modelsByProvider[providerId]) return;
      void api.listProviderModelsV2(providerId).then((models) => {
        setModelsByProvider((current) => ({ ...current, [providerId]: models }));
      }).catch(() => {});
    });
  }, [draft?.principal?.provider_id, draft?.fast?.provider_id, draft?.deep?.provider_id]);

  const ensureModels = async (providerId: string) => {
    if (!providerId || modelsByProvider[providerId]) return;
    try {
      const models = await api.listProviderModelsV2(providerId);
      setModelsByProvider((current) => ({ ...current, [providerId]: models }));
    } catch {}
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const saved = await api.saveOrchestratorSettingsV3(draft);
      setDraft(saved);
      setStatus(await api.getOrchestratorStatusV3());
      setNotice('Configuração do Orquestrador salva.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  const selectedEvents = selectedRun
    ? events.filter((event) => event.orchestration_run_id === selectedRun.id).sort((a, b) => a.created_at.localeCompare(b.created_at))
    : events.slice(0, 20);

  const modelOptions = (providerId: string | null | undefined) =>
    providerId ? (modelsByProvider[providerId] ?? []).filter((model) => model.enabled) : [];

  const updateRef = (kind: 'principal'|'fast'|'deep', providerId: string, modelId: string | null) => {
    if (!draft) return;
    const nextRef = providerId ? { provider_id: providerId, model_id: modelId } : null;
    setDraft({ ...draft, [kind]: kind === 'principal' ? (nextRef ?? { provider_id: null, model_id: null }) : nextRef });
    if (providerId) void ensureModels(providerId);
  };

  return (
    <div className="orchestrator-page">
      <div className="orchestrator-hero">
        <div>
          <span className="office-kicker">Control Plane</span>
          <h2 className="app-view-title">Orquestrador</h2>
          <p className="app-view-subtitle">A IA central que entende, roteia e coordena o Agent Office.</p>
        </div>
        <div className={'orchestrator-health ' + healthClass(status?.principal?.status)}>
          <span className="engine-dot" />
          <div>
            <strong>{status?.principal?.model_name || 'Não configurado'}</strong>
            <span>{status?.principal?.provider_name || 'Selecione o controlador principal'}</span>
          </div>
        </div>
      </div>

      <div className="orchestrator-metrics">
        <div><strong>{status?.stats_24h.total ?? 0}</strong><span>decisões · 24h</span></div>
        <div><strong>{status?.stats_24h.fast ?? 0}</strong><span>Fast</span></div>
        <div><strong>{status?.stats_24h.deep ?? 0}</strong><span>Deep</span></div>
        <div><strong>{status?.stats_24h.fallback ?? 0}</strong><span>fallbacks</span></div>
        <div><strong>{status?.stats_24h.avg_duration_ms ?? 0} ms</strong><span>latência média</span></div>
        <div><strong>{(status?.stats_24h.input_tokens ?? 0) + (status?.stats_24h.output_tokens ?? 0)}</strong><span>tokens · 24h</span></div>
      </div>

      <div className="orchestrator-grid">
        <section className="panel orchestrator-config-panel">
          <div className="orchestrator-section-head">
            <div>
              <span className="office-kicker">Configuração</span>
              <h3>Controle central</h3>
            </div>
            <label className="orchestrator-toggle">
              <input type="checkbox" checked={draft?.enabled ?? true} onChange={(event) => draft && setDraft({ ...draft, enabled: event.target.checked })} />
              <span>{draft?.enabled ? 'Ativo' : 'Desativado'}</span>
            </label>
          </div>

          {draft && (
            <>
              <div className="orchestrator-model-config">
                <div className="orchestrator-model-row">
                  <div><strong>Principal</strong><small>Controlador padrão do Office</small></div>
                  <select value={draft.principal.provider_id ?? ''} onChange={(event) => updateRef('principal', event.target.value, null)}>
                    <option value="">Selecione o provider</option>
                    {enabledProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                  </select>
                  <select value={draft.principal.model_id ?? ''} onChange={(event) => updateRef('principal', draft.principal.provider_id ?? '', event.target.value || null)} disabled={!draft.principal.provider_id}>
                    <option value="">Selecione o modelo</option>
                    {modelOptions(draft.principal.provider_id).map((model) => <option key={model.id} value={model.model_id}>{model.display_name}</option>)}
                  </select>
                </div>

                {(['fast','deep'] as const).map((kind) => {
                  const current = draft[kind];
                  return (
                    <div className="orchestrator-model-row" key={kind}>
                      <div><strong>{kind === 'fast' ? 'Fast' : 'Deep'}</strong><small>{kind === 'fast' ? 'Roteamento rápido/econômico' : 'Solicitações complexas/alto risco'}</small></div>
                      <select value={current?.provider_id ?? ''} onChange={(event) => updateRef(kind, event.target.value, null)}>
                        <option value="">Usar Principal</option>
                        {enabledProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                      </select>
                      <select value={current?.model_id ?? ''} onChange={(event) => updateRef(kind, current?.provider_id ?? '', event.target.value || null)} disabled={!current?.provider_id}>
                        <option value="">Selecione o modelo</option>
                        {modelOptions(current?.provider_id).map((model) => <option key={model.id} value={model.model_id}>{model.display_name}</option>)}
                      </select>
                    </div>
                  );
                })}
              </div>

              <div className="orchestrator-policy-grid">
                <label>Confiança Fast
                  <input type="number" min={0} max={1} step={0.05} value={draft.fast_confidence_threshold} onChange={(event) => setDraft({ ...draft, fast_confidence_threshold: Number(event.target.value) })} />
                </label>
                <label>Confiança mínima Deep
                  <input type="number" min={0} max={1} step={0.05} value={draft.deep_confidence_threshold} onChange={(event) => setDraft({ ...draft, deep_confidence_threshold: Number(event.target.value) })} />
                </label>
                <label className="orchestrator-checkbox"><input type="checkbox" checked={draft.deep_for_high_risk} onChange={(event) => setDraft({ ...draft, deep_for_high_risk: event.target.checked })} />Deep para alto risco</label>
              </div>

              <div className="orchestrator-fallback-note">
                <strong>Fallback do controlador</strong>
                <span>{status?.principal?.fallback_count ?? 0} fallback(s) configurado(s) no provider principal. A cadeia é administrada em Providers e reutilizada aqui automaticamente.</span>
              </div>

              <button type="button" className="btn btn-primary" disabled={busy || !draft.principal.provider_id || !draft.principal.model_id} onClick={save}>
                {busy ? 'Salvando…' : 'Salvar Orquestrador'}
              </button>
              {notice && <p className="success-text">{notice}</p>}
              {error && <p className="error-text">{error}</p>}
            </>
          )}
        </section>

        <section className="panel orchestrator-now-panel">
          <span className="office-kicker">Agora</span>
          <h3>Estado do controlador</h3>
          <div className="orchestrator-state-list">
            {[
              ['Principal', status?.principal],
              ['Fast', status?.fast],
              ['Deep', status?.deep],
            ].map(([label, value]: any) => (
              <div key={label}>
                <span className={'mini-status ' + healthClass(value?.status)} />
                <div><strong>{label}</strong><small>{value?.provider_name || '—'} · {value?.model_name || '—'}</small></div>
                <span className="badge">{value?.status || 'não configurado'}</span>
              </div>
            ))}
          </div>
          <p className="muted">Última decisão: {status?.latest_run_at ? new Date(status.latest_run_at).toLocaleString('pt-BR') : 'nenhuma ainda'}</p>
        </section>
      </div>

      <div className="orchestrator-grid orchestrator-operations">
        <section className="panel">
          <div className="orchestrator-section-head">
            <div><span className="office-kicker">Histórico</span><h3>Decisões recentes</h3></div>
            <span className="overview-count">{runs.length}</span>
          </div>
          <div className="orchestrator-run-list">
            {runs.map((run) => (
              <button key={run.id} className={selectedRunId === run.id ? 'selected' : ''} onClick={() => setSelectedRunId(run.id)}>
                <span className={'orchestrator-level level-' + run.level_used}>{run.level_used}</span>
                <div><strong>{String(run.decision?.normalized_goal || 'Solicitação').slice(0, 90)}</strong><small>{new Date(run.created_at).toLocaleString('pt-BR')} · {run.duration_ms} ms</small></div>
                <span>{Math.round(Number(run.decision?.confidence || 0) * 100)}%</span>
              </button>
            ))}
            {!runs.length && <div className="manager-empty-small">Nenhuma decisão registrada.</div>}
          </div>
        </section>

        <section className="panel">
          <span className="office-kicker">Trilha operacional</span>
          <h3>{selectedRun ? 'Decisão selecionada' : 'Atividade recente'}</h3>
          {selectedRun && (
            <div className="orchestrator-decision-summary">
              <div><span>Destino</span><strong>{String(selectedRun.decision?.target_agent_id || selectedRun.decision?.target_team_id || selectedRun.decision?.target_mode || '—')}</strong></div>
              <div><span>Complexidade</span><strong>{String(selectedRun.decision?.complexity || '—')}</strong></div>
              <div><span>Risco</span><strong>{String(selectedRun.decision?.risk || '—')}</strong></div>
              <div><span>Modelo</span><strong>{(selectedRun as any).model_name || (selectedRun as any).effective_model_id || 'determinístico'}</strong></div>
              <div><span>Tokens</span><strong>{(selectedRun.input_tokens || 0) + (selectedRun.output_tokens || 0)}</strong></div>
              <div><span>Confiança</span><strong>{Math.round(Number(selectedRun.decision?.confidence || 0) * 100)}%</strong></div>
            </div>
          )}
          <div className="orchestrator-timeline">
            {selectedEvents.map((event) => (
              <div key={event.id} className={'event-' + event.severity}>
                <span className="orchestrator-event-dot" />
                <div><strong>{event.title}</strong><p>{event.detail}</p><small>{new Date(event.created_at).toLocaleTimeString('pt-BR')}</small></div>
              </div>
            ))}
            {!selectedEvents.length && <div className="manager-empty-small">Ainda não há eventos para mostrar.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
