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
  const [capSearch, setCapSearch] = useState('');
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

  const capabilityList = useMemo(() => {
    const query = capSearch.trim().toLowerCase();
    return definitions.filter((item) => !query
      || item.label.toLowerCase().includes(query)
      || item.key.toLowerCase().includes(query)
      || item.domain.toLowerCase().includes(query)
      || item.description.toLowerCase().includes(query));
  }, [definitions, capSearch]);

  const selectedCapabilities = useMemo(
    () => [...capDraft.values()].filter((cap) => cap.enabled),
    [capDraft],
  );

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
        source: 'manual' as const,
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

  const inferCapabilities = async () => {
    setBusy('infer'); setError(null); setNotice(null);
    try {
      const inferred = await api.inferAgentCapabilitiesV3(agent.id);
      setCapDraft(new Map(inferred.map((cap) => [cap.capability_key, cap])));
      await load();
      setNotice('Capabilities reanalisadas a partir das instruções do agente.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao reanalisar capabilities.');
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

      <div className="agent-quality-learning">
        <div>
          <strong>Qualidade aprendida pelo Chat</strong>
          <span>O Orquestrador interpreta aprovação, correções e rejeições naturalmente na conversa. Falhas de provider continuam separadas da qualidade.</span>
        </div>
        <span className="agent-learning-badge">Automático</span>
      </div>

      <div className="agent-capabilities-card">
        <div className="agent-capabilities-head">
          <div>
            <strong>Capabilities</strong>
            <span>Detectadas automaticamente pelas instruções e ajustáveis por você.</span>
          </div>
          <button type="button" onClick={() => void inferCapabilities()} disabled={busy !== null}>
            {busy === 'infer' ? 'Analisando…' : 'Reanalisar automaticamente'}
          </button>
        </div>

        <div className="agent-capability-selected">
          {selectedCapabilities.map((cap) => {
            const definition = definitions.find((item) => item.key === cap.capability_key);
            return (
              <button key={cap.capability_key} type="button" className="agent-capability-chip" onClick={() => {
                const next = new Map(capDraft);
                next.set(cap.capability_key, { ...cap, enabled: false });
                setCapDraft(next);
              }}>
                {definition?.label ?? cap.capability_key} <span>×</span>
              </button>
            );
          })}
          {!selectedCapabilities.length && <span className="manager-empty-small">Nenhuma selecionada ainda. O sistema tentará inferir ao salvar o agente.</span>}
        </div>

        <div className="agent-capability-picker">
          <input
            value={capSearch}
            onChange={(event) => setCapSearch(event.target.value)}
            placeholder="Pesquisar capability…"
          />
          <div className="agent-capability-options">
            {capabilityList.map((definition) => {
              const current = capDraft.get(definition.key);
              const enabled = Boolean(current?.enabled);
              return (
                <button
                  key={definition.key}
                  type="button"
                  className={enabled ? 'selected' : ''}
                  onClick={() => {
                    const next = new Map(capDraft);
                    if (enabled && current) {
                      next.set(definition.key, { ...current, enabled: false });
                    } else {
                      next.set(definition.key, current
                        ? { ...current, enabled: true, source: current.source }
                        : {
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
                    }
                    setCapDraft(next);
                  }}
                >
                  <span>
                    <strong>{definition.label}</strong>
                    <small>{definition.domain} · {definition.description}</small>
                  </span>
                  <span className="capability-option-state">{enabled ? 'Selecionada' : '+'}</span>
                </button>
              );
            })}
            {!capabilityList.length && <span className="manager-empty-small">Nenhuma capability encontrada.</span>}
          </div>
        </div>

        <div className="agent-capability-footer">
          <span>As evidências verificadas e o aprendizado histórico não são apagados por ajustes manuais.</span>
          <button type="button" className="manager-primary" onClick={() => void saveCapabilities()} disabled={busy !== null}>
            {busy === 'capabilities' ? 'Salvando…' : 'Salvar capabilities'}
          </button>
        </div>
      </div>

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
