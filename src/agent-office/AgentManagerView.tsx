import { useEffect, useMemo, useState } from 'react';
import type { AgentProfile, AgentToolPolicy, ProviderModel, ToolDefinitionV2, UniversalProvider } from './types.js';
import { api } from './api.js';

interface AgentManagerViewProps {
  agents: AgentProfile[];
  providers: UniversalProvider[];
  onChanged: () => void | Promise<void>;
}

interface AgentDraft {
  name: string;
  slug: string;
  role: string;
  description: string;
  avatar_key: string;
  provider_id: string;
  model_id: string;
  system_prompt: string;
  enabled: boolean;
  sort_order: number;
  idle_after_seconds: number;
}

const AVATARS = ['default', 'researcher', 'builder', 'reviewer', 'architect', 'analyst'];

const EMPTY_DRAFT: AgentDraft = {
  name: '',
  slug: '',
  role: '',
  description: '',
  avatar_key: 'default',
  provider_id: '',
  model_id: '',
  system_prompt: '',
  enabled: true,
  sort_order: 10,
  idle_after_seconds: 300,
};

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function avatarLabel(key: string): string {
  const labels: Record<string, string> = {
    default: 'AI',
    researcher: 'R',
    builder: 'B',
    reviewer: 'V',
    architect: 'A',
    analyst: 'N',
  };
  return labels[key] ?? key.slice(0, 1).toUpperCase();
}

export function AgentManagerView({ agents, providers, onChanged }: AgentManagerViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(agents[0]?.id ?? null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_DRAFT);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [toolDefinitions, setToolDefinitions] = useState<ToolDefinitionV2[]>([]);
  const [toolPolicy, setToolPolicy] = useState<Omit<AgentToolPolicy, 'agent_id' | 'updated_at'>>({
    enabled: false,
    allowed_tools: [],
    approval_mode: 'safe',
    max_tool_steps: 12,
  });
  const [subagentIds, setSubagentIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = isCreating ? null : (agents.find((agent) => agent.id === selectedId) ?? null);
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);

  useEffect(() => {
    void api.listToolDefinitionsV2()
      .then((definitions) => {
        setToolDefinitions(definitions);
        setToolPolicy((current) => ({
          ...current,
          allowed_tools: current.allowed_tools.length
            ? current.allowed_tools
            : definitions.filter((tool) => tool.default_enabled).map((tool) => tool.name),
        }));
      })
      .catch(() => setToolDefinitions([]));
  }, []);

  useEffect(() => {
    if (isCreating) return;
    if (!selectedId && agents[0]) setSelectedId(agents[0].id);
    if (selectedId && !agents.some((agent) => agent.id === selectedId)) {
      setSelectedId(agents[0]?.id ?? null);
    }
  }, [agents, selectedId, isCreating]);

  useEffect(() => {
    if (!selected) {
      setModels([]);
      return;
    }
    setDraft({
      name: selected.name,
      slug: selected.slug,
      role: selected.role,
      description: selected.description,
      avatar_key: selected.avatar_key || 'default',
      provider_id: selected.provider_id ?? '',
      model_id: selected.model_id ?? '',
      system_prompt: selected.system_prompt,
      enabled: selected.enabled,
      sort_order: selected.sort_order,
      idle_after_seconds: selected.idle_after_seconds,
    });
    void Promise.all([
      api.getAgentToolPolicyV2(selected.id),
      api.listSubagentsV2(selected.id),
    ])
      .then(([policy, relations]) => {
        setToolPolicy({
          enabled: policy.enabled,
          allowed_tools: policy.allowed_tools,
          approval_mode: policy.approval_mode,
          max_tool_steps: policy.max_tool_steps,
        });
        setSubagentIds(relations.map((relation) => relation.child_agent_id));
      })
      .catch(() => {
        setToolPolicy((current) => ({ ...current, enabled: false }));
        setSubagentIds([]);
      });
    setNotice(null);
    setError(null);
  }, [selected?.id]);

  useEffect(() => {
    if (!draft.provider_id) {
      setModels([]);
      if (draft.model_id) setDraft((current) => ({ ...current, model_id: '' }));
      return;
    }
    void api.listProviderModelsV2(draft.provider_id)
      .then((items) => {
        setModels(items);
        const currentValid = draft.model_id && items.some((model) => model.id === draft.model_id && model.enabled);
        if (!currentValid) {
          const preferred = items.find((model) => model.enabled && model.is_default) ?? items.find((model) => model.enabled);
          setDraft((current) => ({ ...current, model_id: preferred?.id ?? '' }));
        }
      })
      .catch((reason) => {
        setModels([]);
        setError(reason instanceof Error ? reason.message : 'Falha ao carregar modelos.');
      });
  }, [draft.provider_id]);

  const startCreate = () => {
    const firstProvider = providers.find((provider) => provider.enabled);
    setIsCreating(true);
    setSelectedId(null);
    setDraft({
      ...EMPTY_DRAFT,
      provider_id: firstProvider?.id ?? '',
      sort_order: (agents.reduce((max, agent) => Math.max(max, agent.sort_order), 0) || 0) + 10,
    });
    setShowAdvanced(false);
    setToolPolicy({
      enabled: false,
      allowed_tools: toolDefinitions.filter((tool) => tool.default_enabled).map((tool) => tool.name),
      approval_mode: 'safe',
      max_tool_steps: 12,
    });
    setSubagentIds([]);
    setNotice(null);
    setError(null);
  };

  const chooseProvider = async (providerId: string) => {
    setDraft((current) => ({ ...current, provider_id: providerId, model_id: '' }));
    if (!providerId) return;
    try {
      const items = await api.listProviderModelsV2(providerId);
      const defaultModel = items.find((model) => model.enabled && model.is_default) ?? items.find((model) => model.enabled);
      setModels(items);
      if (defaultModel) {
        setDraft((current) => ({ ...current, provider_id: providerId, model_id: defaultModel.id }));
      }
    } catch {
      setModels([]);
    }
  };

  const save = async () => {
    if (!draft.name.trim()) {
      setError('Dê um nome ao agente.');
      return;
    }
    if (!draft.slug.trim()) {
      setError('Defina um slug para o agente.');
      return;
    }
    if (draft.model_id && !draft.provider_id) {
      setError('Escolha o provider antes do modelo.');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        name: draft.name.trim(),
        slug: draft.slug.trim(),
        role: draft.role.trim(),
        description: draft.description.trim(),
        avatar_key: draft.avatar_key,
        provider_id: draft.provider_id || null,
        model_id: draft.model_id || null,
        system_prompt: draft.system_prompt,
        enabled: draft.enabled,
        sort_order: draft.sort_order,
        idle_after_seconds: draft.idle_after_seconds,
      };

      const saved = selected
        ? await api.updateAgentV2(selected.id, payload)
        : await api.createAgentV2(payload);

      await api.saveAgentToolPolicyV2(saved.id, toolPolicy);
      await api.saveSubagentsV2(saved.id, subagentIds.filter((id) => id !== saved.id));

      setIsCreating(false);
      setSelectedId(saved.id);
      await onChanged();
      setNotice('Agente salvo e disponível no escritório.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar agente.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Excluir o agente "${selected.name}"?`)) return;
    setBusy(true);
    try {
      await api.deleteAgentV2(selected.id);
      setIsCreating(false);
      setSelectedId(null);
      await onChanged();
      setNotice('Agente excluído.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao excluir agente.');
    } finally {
      setBusy(false);
    }
  };

  const move = async (agent: AgentProfile, direction: -1 | 1) => {
    const ordered = agents.slice().sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((item) => item.id === agent.id);
    const other = ordered[index + direction];
    if (!other) return;
    setBusy(true);
    try {
      await Promise.all([
        api.updateAgentV2(agent.id, { sort_order: other.sort_order }),
        api.updateAgentV2(other.id, { sort_order: agent.sort_order }),
      ]);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao reordenar agentes.');
    } finally {
      setBusy(false);
    }
  };

  const selectedProvider = draft.provider_id ? providerById.get(draft.provider_id) : undefined;
  const selectedModel = models.find((model) => model.id === draft.model_id);

  return (
    <div className="manager-page">
      <header className="manager-header">
        <div>
          <span className="office-kicker">Equipe dinâmica</span>
          <h1>Agentes</h1>
          <p>Dê um nome, escolha a função, provider e modelo. O restante pode ficar automático.</p>
        </div>
        <button type="button" className="manager-primary" onClick={startCreate}>+ Novo agente</button>
      </header>

      <div className="manager-layout">
        <aside className="manager-list-panel">
          <div className="manager-list-title">
            <span>Equipe</span>
            <strong>{agents.length}</strong>
          </div>
          <div className="manager-list">
            {agents.slice().sort((a, b) => a.sort_order - b.sort_order).map((agent, index) => {
              const provider = agent.provider_id ? providerById.get(agent.provider_id) : undefined;
              return (
                <div key={agent.id} className={`agent-manager-list-item ${selectedId === agent.id ? 'active' : ''}`}>
                  <button
                    type="button"
                    className="agent-manager-select"
                    onClick={() => {
                      setIsCreating(false);
                      setSelectedId(agent.id);
                    }}
                  >
                    <span className={`agent-manager-avatar avatar-${index % 3}`}>{avatarLabel(agent.avatar_key)}</span>
                    <span className="manager-list-copy">
                      <strong>{agent.name}</strong>
                      <small>{agent.role || 'AI Agent'} · {provider?.name ?? 'sem provider'}</small>
                    </span>
                    <span className={`mini-status ${agent.enabled ? 'online' : 'offline'}`} />
                  </button>
                  <div className="agent-order-actions">
                    <button type="button" title="Mover para cima" disabled={index === 0 || busy} onClick={() => move(agent, -1)}>↑</button>
                    <button type="button" title="Mover para baixo" disabled={index === agents.length - 1 || busy} onClick={() => move(agent, 1)}>↓</button>
                  </div>
                </div>
              );
            })}
            {!agents.length && <div className="manager-empty-small">Nenhum agente.</div>}
          </div>
        </aside>

        <section className="manager-detail">
          <div className={`manager-card agent-editor-card ${showAdvanced ? 'show-advanced' : 'simple-mode'}`}>
            <div className="manager-card-header">
              <div>
                <span className="office-kicker">{selected ? 'Editar agente' : 'Novo agente'}</span>
                <h2>{selected?.name ?? 'Criar membro da equipe'}</h2>
              </div>
              <div className="agent-preview-chip">
                <span className="agent-manager-avatar">{avatarLabel(draft.avatar_key)}</span>
                <div>
                  <strong>{draft.name || 'Novo agente'}</strong>
                  <small>{draft.role || 'Função ainda não definida'}</small>
                </div>
              </div>
            </div>

            <div className="manager-form-grid">
              <div className="manager-field">
                <label>Nome</label>
                <input
                  value={draft.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      name,
                      slug: selected ? current.slug : slugify(name),
                    }));
                  }}
                  placeholder="Ex.: Builder"
                />
              </div>
              <div className="manager-field agent-advanced-field">
                <label>Slug</label>
                <input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: slugify(event.target.value) })} placeholder="builder" />
              </div>
              <div className="manager-field">
                <label>Função</label>
                <input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} placeholder="Backend Engineer, Reviewer..." />
              </div>
              <div className="manager-field agent-advanced-field">
                <label>Avatar</label>
                <select value={draft.avatar_key} onChange={(event) => setDraft({ ...draft, avatar_key: event.target.value })}>
                  {AVATARS.map((avatar) => <option key={avatar} value={avatar}>{avatar}</option>)}
                </select>
              </div>
              <div className="manager-field span-2 agent-advanced-field">
                <label>Descrição / especialidade</label>
                <input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="O que este agente faz melhor?" />
              </div>
            </div>

            <div className="agent-binding-card">
              <div className="binding-title">
                <div>
                  <strong>Cérebro do agente</strong>
                  <span>Provider → modelo usado pelo Chat Runner.</span>
                </div>
                <span className={`binding-health ${selectedProvider?.health_status === 'healthy' ? 'online' : selectedProvider?.enabled ? 'unknown' : 'offline'}`}>
                  {selectedProvider?.name ?? 'não configurado'}
                </span>
              </div>
              <div className="manager-form-grid">
                <div className="manager-field">
                  <label>Provider</label>
                  <select value={draft.provider_id} onChange={(event) => void chooseProvider(event.target.value)}>
                    <option value="">Sem provider</option>
                    {providers.map((provider) => (
                      <option key={provider.id} value={provider.id} disabled={!provider.enabled}>
                        {provider.name}{provider.enabled ? '' : ' (desativado)'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="manager-field">
                  <label>Modelo</label>
                  <select value={draft.model_id} onChange={(event) => setDraft({ ...draft, model_id: event.target.value })} disabled={!draft.provider_id}>
                    <option value="">Sem modelo</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id} disabled={!model.enabled}>
                        {model.display_name}{model.is_default ? ' · padrão' : ''}{model.enabled ? '' : ' · desativado'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {draft.provider_id && !models.length && (
                <div className="binding-warning">Esse provider ainda não possui modelos. Cadastre ou descubra modelos na tela Providers.</div>
              )}
              {selectedModel && (
                <div className="binding-summary">
                  <span>{selectedModel.model_id}</span>
                  <span>{selectedModel.context_window ? `${selectedModel.context_window.toLocaleString('pt-BR')} contexto` : 'contexto não informado'}</span>
                  <span>{selectedModel.capabilities.streaming === false ? 'sem streaming' : 'streaming'}</span>
                </div>
              )}
            </div>

            <div className="manager-field">
              <label>System prompt</label>
              <textarea
                value={draft.system_prompt}
                onChange={(event) => setDraft({ ...draft, system_prompt: event.target.value })}
                rows={9}
                placeholder="Defina comportamento, especialidade, critérios e limites deste agente."
              />
              <small>As regras API-only continuam sendo aplicadas pelo runtime independentemente deste prompt.</small>
            </div>

            <div className="manager-form-grid agent-advanced-field">
              <div className="manager-field">
                <label>Ordem no escritório</label>
                <input type="number" value={draft.sort_order} onChange={(event) => setDraft({ ...draft, sort_order: Number(event.target.value) || 0 })} />
              </div>
              <div className="manager-field">
                <label>Descansar após (segundos)</label>
                <input type="number" min={30} value={draft.idle_after_seconds} onChange={(event) => setDraft({ ...draft, idle_after_seconds: Math.max(30, Number(event.target.value) || 300) })} />
              </div>
            </div>

            <label className="manager-switch-row agent-enabled-row">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
              <span>
                <strong>Agente ativo</strong>
                <small>Agentes desativados não são selecionados pelo Auto/Team.</small>
              </span>
            </label>

            <div className="agent-tool-card">
              <div className="binding-title">
                <div>
                  <strong>Ferramentas do agente</strong>
                  <span>Quando ativadas, o agente pode agir dentro da pasta do projeto.</span>
                </div>
                <label className="compact-switch">
                  <input
                    type="checkbox"
                    checked={toolPolicy.enabled}
                    onChange={(event) => setToolPolicy((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  <span>{toolPolicy.enabled ? 'Ativas' : 'Desligadas'}</span>
                </label>
              </div>

              {toolPolicy.enabled && (
                <>
                  <div className="tool-chip-grid">
                    {toolDefinitions.map((tool) => {
                      const checked = toolPolicy.allowed_tools.includes(tool.name);
                      return (
                        <label key={tool.name} className={`tool-chip risk-${tool.risk} ${checked ? 'selected' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => {
                              setToolPolicy((current) => ({
                                ...current,
                                allowed_tools: event.target.checked
                                  ? [...new Set([...current.allowed_tools, tool.name])]
                                  : current.allowed_tools.filter((name) => name !== tool.name),
                              }));
                            }}
                          />
                          <span>
                            <strong>{tool.name}</strong>
                            <small>{tool.risk}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="tool-safety-note">
                    O modo seguro mantém operações destrutivas bloqueadas e exige aprovação para comandos mais sensíveis.
                  </p>
                </>
              )}
            </div>

            <div className="agent-advanced-field agent-tool-advanced">
              <div className="manager-form-grid">
                <div className="manager-field">
                  <label>Política de aprovação</label>
                  <select
                    value={toolPolicy.approval_mode}
                    onChange={(event) => setToolPolicy((current) => ({
                      ...current,
                      approval_mode: event.target.value as 'safe' | 'manual' | 'auto',
                    }))}
                  >
                    <option value="safe">Seguro · comandos sensíveis pedem aprovação</option>
                    <option value="manual">Manual · escrita/execução pedem aprovação</option>
                    <option value="auto">Automático · tudo permitido pela lista executa</option>
                  </select>
                </div>
                <div className="manager-field">
                  <label>Máximo de passos com ferramentas</label>
                  <input
                    type="number"
                    min={1}
                    max={40}
                    value={toolPolicy.max_tool_steps}
                    onChange={(event) => setToolPolicy((current) => ({
                      ...current,
                      max_tool_steps: Math.max(1, Math.min(40, Number(event.target.value) || 12)),
                    }))}
                  />
                </div>
              </div>
            </div>

            <div className="agent-advanced-field agent-hierarchy-card">
              <div className="binding-title">
                <div>
                  <strong>Equipe / subagentes</strong>
                  <span>Fundação hierárquica: este agente pode supervisionar outros agentes no futuro.</span>
                </div>
              </div>
              <div className="subagent-grid">
                {agents
                  .filter((agent) => agent.id !== selected?.id)
                  .map((agent) => (
                    <label key={agent.id} className={`subagent-chip ${subagentIds.includes(agent.id) ? 'selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={subagentIds.includes(agent.id)}
                        onChange={(event) => {
                          setSubagentIds((current) => event.target.checked
                            ? [...new Set([...current, agent.id])]
                            : current.filter((id) => id !== agent.id));
                        }}
                      />
                      <span>{agent.name}</span>
                    </label>
                  ))}
              </div>
            </div>

            <button type="button" className="manager-advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? 'Ocultar opções avançadas' : 'Opções avançadas'}
            </button>

            <div className="manager-actions">
              <button type="button" className="manager-primary" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar agente'}</button>
              {selected && <button type="button" className="danger-ghost" onClick={remove} disabled={busy}>Excluir agente</button>}
            </div>

            {notice && <div className="manager-notice success">{notice}</div>}
            {error && <div className="manager-notice error">{error}</div>}
          </div>

          <div className="manager-card office-placement-card">
            <div className="manager-card-header compact">
              <div>
                <span className="office-kicker">Office placement</span>
                <h2>Quem aparece na sala</h2>
              </div>
            </div>
            <p>O Office cria uma mesa para cada agente ativo. A sala se reorganiza automaticamente conforme a equipe cresce ou diminui.</p>
            <div className="placement-preview">
              {agents.slice().filter((agent) => agent.enabled).sort((a, b) => a.sort_order - b.sort_order).map((agent, index) => (
                <div key={agent.id}>
                  <span className={`placement-avatar avatar-${index}`}>{avatarLabel(agent.avatar_key)}</span>
                  <strong>{agent.name}</strong>
                  <small>Mesa {index + 1}</small>
                </div>
              ))}
              {agents.length === 0 && <span className="manager-empty-small">Crie agentes para preencher o escritório.</span>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
