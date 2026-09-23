import { useEffect, useMemo, useState } from 'react';
import type { AgentCapabilityV3, AgentOverview, AgentProfile, CapabilityDefinitionV3 } from './types.js';
import { api } from './api.js';

function readinessLabel(value: AgentOverview['readiness']): string {
  const labels: Record<AgentOverview['readiness'], string> = {
    inactive: 'Inativo',
    paused: 'Pausado',
    incomplete: 'Configuração incompleta',
    ready: 'Pronto',
    busy: 'Executando',
    queued: 'Na fila',
    provider_degraded: 'Provider degradado',
    provider_unavailable: 'Provider indisponível',
    model_unavailable: 'Modelo indisponível',
    error: 'Erro',
  };
  return labels[value];
}

function pct(value: number | null): string {
  return value == null ? 'sem dados' : `${value.toFixed(1)}%`;
}

export function AgentOperationsPanel({
  agent,
  onChanged,
}: {
  agent: AgentProfile;
  onChanged: () => void | Promise<void>;
}) {
  const [overview, setOverview] = useState<AgentOverview | null>(null);
  const [definitions, setDefinitions] = useState<CapabilityDefinitionV3[]>([]);
  const [capDraft, setCapDraft] = useState<Map<string, AgentCapabilityV3>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [nextOverview, defs] = await Promise.all([
        api.getAgentOverviewV2(agent.id),
        api.listCapabilitiesV3(),
      ]);
      setOverview(nextOverview);
      setDefinitions(defs);
      setCapDraft(new Map(nextOverview.capabilities.map((cap) => [cap.capability_key, cap])));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar dados operacionais.');
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void api.getAgentOverviewV2(agent.id).then(setOverview).catch(() => {}), 5000);
    return () => window.clearInterval(timer);
  }, [agent.id]);

  const grouped = useMemo(() => {
    const map = new Map<string, CapabilityDefinitionV3[]>();
    for (const item of definitions) {
      const list = map.get(item.domain) ?? [];
      list.push(item);
      map.set(item.domain, list);
    }
    return [...map.entries()];
  }, [definitions]);

  const toggleAdmin = async (patch: Partial<AgentProfile>, key: string) => {
    setBusy(key); setError(null); setNotice(null);
    try {
      await api.updateAgentV2(agent.id, patch);
      await onChanged();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao atualizar agente.');
    } finally {
      setBusy(null);
    }
  };

  const saveCapabilities = async () => {
    setBusy('capabilities'); setError(null); setNotice(null);
    try {
      const payload = [...capDraft.values()].map((cap) => ({
        capability_key: cap.capability_key,
        declared_score: cap.declared_score,
        enabled: cap.enabled,
        source: cap.source === 'learned' ? 'manual' as const : cap.source,
      }));
      await api.saveAgentCapabilitiesV3(agent.id, payload);
      await load();
      setNotice('Capabilities salvas.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar capabilities.');
    } finally {
      setBusy(null);
    }
  };

  const feedback = async (event_type: 'accepted'|'rework_requested'|'rejected') => {
    if (!overview) return;
    setBusy(event_type); setError(null); setNotice(null);
    try {
      const next = await api.recordAgentPerformanceV2(agent.id, {
        event_type,
        run_id: overview.latest_run_id ?? undefined,
        source: 'user' as never,
        detail: event_type === 'accepted' ? 'Resultado aprovado pelo usuário.' : event_type === 'rework_requested' ? 'Usuário solicitou retrabalho.' : 'Resultado rejeitado pelo usuário.',
      } as any);
      setOverview(next);
      setNotice('Feedback registrado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao registrar feedback.');
    } finally {
      setBusy(null);
    }
  };

  if (!overview) {
    return <div className="manager-card"><p className="muted">Carregando estado operacional…</p>{error && <p className="error-text">{error}</p>}</div>;
  }

  return (
    <div className="manager-card agent-ops-card">
      <div className="agent-ops-head">
        <div>
          <span className="office-kicker">Operação</span>
          <h2>{agent.name}</h2>
          <p>{agent.role || 'AI Agent'}</p>
        </div>
        <div className="agent-ops-statuses">
          <span className={`agent-admin-chip state-${overview.administrative_state}`}>{overview.administrative_state}</span>
          <span className={`agent-readiness-chip readiness-${overview.readiness}`}>{readinessLabel(overview.readiness)}</span>
        </div>
      </div>

      <div className="agent-ops-actions">
        <button type="button" onClick={() => void toggleAdmin({ enabled: !agent.enabled }, 'enabled')} disabled={busy !== null}>
          {agent.enabled ? 'Desativar' : 'Ativar'}
        </button>
        <button type="button" onClick={() => void toggleAdmin({ paused: !agent.paused }, 'paused')} disabled={!agent.enabled || busy !== null}>
          {agent.paused ? 'Retomar' : 'Pausar'}
        </button>
        <span>{overview.readiness_reason}</span>
      </div>

      <div className="agent-ops-metrics">
        <div><span>Assertividade</span><strong>{pct(overview.performance.assertiveness)}</strong><small>{overview.performance.quality_signals} sinais de qualidade</small></div>
        <div><span>Sucesso operacional</span><strong>{pct(overview.performance.success_rate)}</strong><small>{overview.performance.completed_runs}/{overview.performance.total_runs} runs</small></div>
        <div><span>Retrabalho</span><strong>{pct(overview.performance.rework_rate)}</strong><small>{overview.performance.operational_failures} falhas operacionais</small></div>
        <div><span>Latência média</span><strong>{overview.performance.average_duration_ms == null ? 'sem dados' : `${(overview.performance.average_duration_ms/1000).toFixed(1)}s`}</strong><small>{(overview.performance.input_tokens+overview.performance.output_tokens).toLocaleString('pt-BR')} tokens</small></div>
      </div>

      <div className="agent-runtime-strip">
        <div><span>Provider</span><strong>{overview.provider_name || 'não configurado'}</strong><small>{overview.provider_status || '—'}</small></div>
        <div><span>Modelo preferencial</span><strong>{overview.model_name || 'não configurado'}</strong><small>{overview.model_status || '—'}</small></div>
        <div><span>Último modelo usado</span><strong>{overview.last_effective_model || 'sem execução'}</strong><small>{overview.current_state}{overview.current_activity ? ` · ${overview.current_activity}` : ''}</small></div>
      </div>

      <div className="agent-quality-feedback">
        <div><strong>Qualidade da última entrega</strong><span>Esse feedback alimenta assertividade real; 502 e outras falhas operacionais ficam separados.</span></div>
        <div>
          <button type="button" onClick={() => void feedback('accepted')} disabled={!overview.latest_run_id || busy !== null}>Aprovar</button>
          <button type="button" onClick={() => void feedback('rework_requested')} disabled={!overview.latest_run_id || busy !== null}>Pedir retrabalho</button>
          <button type="button" onClick={() => void feedback('rejected')} disabled={!overview.latest_run_id || busy !== null}>Rejeitar</button>
        </div>
      </div>

      <details className="agent-ops-details">
        <summary>Capabilities</summary>
        <div className="agent-capability-groups">
          {grouped.map(([domain, items]) => (
            <div key={domain}>
              <strong>{domain}</strong>
              <div className="agent-capability-grid">
                {items.map((definition) => {
                  const current = capDraft.get(definition.key);
                  const enabled = Boolean(current?.enabled);
                  return (
                    <label key={definition.key} className={enabled ? 'selected' : ''}>
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                          const next = new Map(capDraft);
                          if (event.target.checked) {
                            next.set(definition.key, current ?? {
                              agent_id: agent.id,
                              capability_key: definition.key,
                              declared_score: 0.7,
                              verified_score: null,
                              confidence: 0,
                              evidence_count: 0,
                              source: 'manual',
                              enabled: true,
                              updated_at: new Date().toISOString(),
                            });
                          } else if (current) {
                            next.set(definition.key, { ...current, enabled: false });
                          }
                          setCapDraft(next);
                        }}
                      />
                      <span>{definition.label}</span>
                      {current && (
                        <input
                          type="range"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={current.declared_score}
                          disabled={!enabled}
                          onChange={(event) => {
                            const next = new Map(capDraft);
                            next.set(definition.key, { ...current, declared_score: Number(event.target.value), source: 'manual' });
                            setCapDraft(next);
                          }}
                        />
                      )}
                      <small>
                        {current?.verified_score != null ? `verificado ${Math.round(current.verified_score*100)}% · ` : ''}
                        {current?.evidence_count ?? 0} evidências
                      </small>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="manager-primary" onClick={() => void saveCapabilities()} disabled={busy !== null}>Salvar capabilities</button>
      </details>

      <details className="agent-ops-details">
        <summary>Atividade recente</summary>
        <div className="agent-activity-list">
          {overview.recent_activity.map((event, index) => (
            <div key={`${event.created_at}-${index}`}>
              <span className={`activity-severity severity-${event.severity}`} />
              <div><strong>{event.title}</strong><small>{event.detail || event.type} · {new Date(event.created_at).toLocaleString('pt-BR')}</small></div>
            </div>
          ))}
          {!overview.recent_activity.length && <span className="manager-empty-small">Sem atividade recente.</span>}
        </div>
      </details>

      {notice && <div className="manager-notice success">{notice}</div>}
      {error && <div className="manager-notice error">{error}</div>}
    </div>
  );
}
