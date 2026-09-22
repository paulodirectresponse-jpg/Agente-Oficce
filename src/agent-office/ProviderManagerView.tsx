import { useEffect, useMemo, useState } from 'react';
import type {
  ProviderEngineCapabilities,
  ProviderModel,
  ProviderPreset,
  UniversalProvider,
} from './types.js';
import { api } from './api.js';

interface ProviderManagerViewProps {
  providers: UniversalProvider[];
  onChanged: () => void | Promise<void>;
}

interface ProviderDraft {
  id: string;
  name: string;
  preset_id: string;
  protocol_driver: string;
  auth_driver: string;
  base_url: string;
  timeout_ms: number;
  headers_text: string;
  query_text: string;
  auth_config_text: string;
  protocol_config_text: string;
  retry_attempts: number;
  retry_backoff_ms: number;
  max_concurrent_requests: number;
  min_request_interval_ms: number;
  enabled: boolean;
}

const EMPTY_DRAFT: ProviderDraft = {
  id: '',
  name: '',
  preset_id: 'openai-chat-compatible',
  protocol_driver: 'openai_chat',
  auth_driver: 'bearer',
  base_url: '',
  timeout_ms: 60000,
  headers_text: '{}',
  query_text: '{}',
  auth_config_text: '{}',
  protocol_config_text: '{}',
  retry_attempts: 0,
  retry_backoff_ms: 500,
  max_concurrent_requests: 2,
  min_request_interval_ms: 0,
  enabled: true,
};

function pretty(value: Record<string, unknown> | Record<string, string>): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseObject(text: string, field: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${field} precisa ser um objeto JSON.`);
  }
  return parsed as Record<string, unknown>;
}

function healthClass(provider: UniversalProvider): string {
  if (!provider.enabled) return 'offline';
  if (provider.health_status === 'healthy') return 'online';
  if (provider.health_status === 'unavailable') return 'offline';
  return 'unknown';
}

export function ProviderManagerView({ providers, onChanged }: ProviderManagerViewProps) {
  const [capabilities, setCapabilities] = useState<ProviderEngineCapabilities | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(providers[0]?.id ?? null);
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [secret, setSecret] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = providers.find((provider) => provider.id === selectedId) ?? null;
  const presetById = useMemo(
    () => new Map((capabilities?.presets ?? []).map((preset) => [preset.id, preset])),
    [capabilities],
  );

  useEffect(() => {
    void api.providerEngineCapabilities().then(setCapabilities).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Falha ao carregar presets.');
    });
  }, []);

  useEffect(() => {
    if (!selectedId && providers[0]) setSelectedId(providers[0].id);
    if (selectedId && !providers.some((provider) => provider.id === selectedId)) {
      setSelectedId(providers[0]?.id ?? null);
    }
  }, [providers, selectedId]);

  useEffect(() => {
    if (!selected) {
      setModels([]);
      return;
    }
    setDraft({
      id: selected.id,
      name: selected.name,
      preset_id: '',
      protocol_driver: selected.protocol_driver,
      auth_driver: selected.auth_driver,
      base_url: selected.base_url,
      timeout_ms: selected.timeout_ms,
      headers_text: pretty(selected.headers),
      query_text: pretty(selected.query),
      auth_config_text: pretty(selected.auth_config),
      protocol_config_text: pretty(selected.protocol_config),
      retry_attempts: typeof selected.protocol_config.retry_attempts === 'number' ? selected.protocol_config.retry_attempts : 0,
      retry_backoff_ms: typeof selected.protocol_config.retry_backoff_ms === 'number' ? selected.protocol_config.retry_backoff_ms : 500,
      max_concurrent_requests: typeof selected.protocol_config.max_concurrent_requests === 'number' ? selected.protocol_config.max_concurrent_requests : 2,
      min_request_interval_ms: typeof selected.protocol_config.min_request_interval_ms === 'number' ? selected.protocol_config.min_request_interval_ms : 0,
      enabled: selected.enabled,
    });
    void api.listProviderModelsV2(selected.id).then(setModels).catch(() => setModels([]));
    setSecret('');
    setNotice(null);
    setError(null);
  }, [selected?.id]);

  const applyPreset = (preset: ProviderPreset) => {
    setDraft((current) => ({
      ...current,
      preset_id: preset.id,
      name: current.name || preset.name,
      protocol_driver: preset.protocol_driver,
      auth_driver: preset.auth_driver,
      base_url: preset.base_url,
      headers_text: pretty(preset.headers ?? {}),
      query_text: pretty(preset.query ?? {}),
      auth_config_text: pretty(preset.auth_config ?? {}),
      protocol_config_text: pretty(preset.protocol_config ?? {}),
    }));
  };

  const startCreate = () => {
    const preset = capabilities?.presets?.[0];
    const base = { ...EMPTY_DRAFT };
    if (preset) {
      base.preset_id = preset.id;
      base.name = preset.name;
      base.protocol_driver = preset.protocol_driver;
      base.auth_driver = preset.auth_driver;
      base.base_url = preset.base_url;
      base.headers_text = pretty(preset.headers ?? {});
      base.query_text = pretty(preset.query ?? {});
      base.auth_config_text = pretty(preset.auth_config ?? {});
      base.protocol_config_text = pretty(preset.protocol_config ?? {});
      base.retry_attempts = typeof preset.protocol_config?.retry_attempts === 'number' ? preset.protocol_config.retry_attempts : 0;
      base.retry_backoff_ms = typeof preset.protocol_config?.retry_backoff_ms === 'number' ? preset.protocol_config.retry_backoff_ms : 500;
      base.max_concurrent_requests = typeof preset.protocol_config?.max_concurrent_requests === 'number' ? preset.protocol_config.max_concurrent_requests : 2;
      base.min_request_interval_ms = typeof preset.protocol_config?.min_request_interval_ms === 'number' ? preset.protocol_config.min_request_interval_ms : 0;
    }
    setSelectedId(null);
    setDraft(base);
    setModels([]);
    setSecret('');
    setNotice(null);
    setError(null);
  };

  const saveProvider = async () => {
    if (!draft.name.trim()) {
      setError('Dê um nome ao provider.');
      return;
    }
    setBusy('save');
    setError(null);
    setNotice(null);
    try {
      const headers = parseObject(draft.headers_text, 'Headers');
      const query = parseObject(draft.query_text, 'Query');
      const authConfig = parseObject(draft.auth_config_text, 'Auth config');
      const protocolConfig = {
        ...parseObject(draft.protocol_config_text, 'Protocol config'),
        retry_attempts: Math.max(0, Math.min(5, draft.retry_attempts)),
        retry_backoff_ms: Math.max(100, draft.retry_backoff_ms),
        max_concurrent_requests: Math.max(1, Math.min(20, draft.max_concurrent_requests)),
        min_request_interval_ms: Math.max(0, draft.min_request_interval_ms),
      };
      let saved: UniversalProvider;
      if (selected) {
        saved = await api.updateProviderV2(selected.id, {
          name: draft.name.trim(),
          protocol_driver: draft.protocol_driver,
          auth_driver: draft.auth_driver,
          base_url: draft.base_url.trim(),
          timeout_ms: draft.timeout_ms,
          headers: headers as Record<string, string>,
          query: query as Record<string, string>,
          auth_config: authConfig,
          protocol_config: protocolConfig,
          enabled: draft.enabled,
        });
      } else if (draft.preset_id) {
        saved = await api.createProviderFromPresetV2({
          preset_id: draft.preset_id,
          id: draft.id.trim() || undefined,
          name: draft.name.trim(),
          base_url: draft.base_url.trim(),
          timeout_ms: draft.timeout_ms,
        });
        saved = await api.updateProviderV2(saved.id, {
          protocol_driver: draft.protocol_driver,
          auth_driver: draft.auth_driver,
          headers: headers as Record<string, string>,
          query: query as Record<string, string>,
          auth_config: authConfig,
          protocol_config: protocolConfig,
          enabled: draft.enabled,
        });
      } else {
        saved = await api.createProviderV2({
          id: draft.id.trim() || undefined,
          name: draft.name.trim(),
          protocol_driver: draft.protocol_driver,
          auth_driver: draft.auth_driver,
          base_url: draft.base_url.trim(),
          timeout_ms: draft.timeout_ms,
          headers: headers as Record<string, string>,
          query: query as Record<string, string>,
          auth_config: authConfig,
          protocol_config: protocolConfig,
          enabled: draft.enabled,
        });
      }

      if (secret.trim()) {
        await api.saveProviderSecretV2(saved.id, secret.trim());
        setSecret('');
      }
      setSelectedId(saved.id);
      await onChanged();
      setNotice('Provider salvo.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar provider.');
    } finally {
      setBusy(null);
    }
  };

  const saveSecret = async () => {
    if (!selected || !secret.trim()) return;
    setBusy('secret');
    setError(null);
    try {
      await api.saveProviderSecretV2(selected.id, secret.trim());
      setSecret('');
      await onChanged();
      setNotice('Credencial salva fora do SQLite.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar credencial.');
    } finally {
      setBusy(null);
    }
  };

  const testProvider = async () => {
    if (!selected) return;
    setBusy('test');
    setError(null);
    setNotice(null);
    try {
      const result = await api.testProviderV2(selected.id);
      await onChanged();
      setNotice(`Conexão saudável · ${result.latency_ms} ms`);
    } catch (reason) {
      await onChanged();
      setError(reason instanceof Error ? reason.message : 'Falha no teste de conexão.');
    } finally {
      setBusy(null);
    }
  };

  const discover = async () => {
    if (!selected) return;
    setBusy('discover');
    setError(null);
    setNotice(null);
    try {
      const discovered = await api.discoverProviderModelsV2(selected.id, true);
      setModels(await api.listProviderModelsV2(selected.id));
      setNotice(`${discovered.length} modelo(s) encontrado(s).`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao descobrir modelos.');
    } finally {
      setBusy(null);
    }
  };

  const addModel = async () => {
    if (!selected || !newModel.trim()) return;
    setBusy('model');
    setError(null);
    try {
      await api.createProviderModelV2(selected.id, {
        model_id: newModel.trim(),
        display_name: newModelName.trim() || newModel.trim(),
        enabled: true,
        is_default: models.length === 0,
        capabilities: { text: true, streaming: true },
      });
      setModels(await api.listProviderModelsV2(selected.id));
      setNewModel('');
      setNewModelName('');
      setNotice('Modelo adicionado.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao adicionar modelo.');
    } finally {
      setBusy(null);
    }
  };

  const toggleModel = async (model: ProviderModel) => {
    setBusy(model.id);
    try {
      await api.updateProviderModelV2(model.id, { enabled: !model.enabled });
      setModels(await api.listProviderModelsV2(model.provider_id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao atualizar modelo.');
    } finally {
      setBusy(null);
    }
  };

  const makeDefault = async (model: ProviderModel) => {
    setBusy(model.id);
    try {
      await api.updateProviderModelV2(model.id, { is_default: true, enabled: true });
      setModels(await api.listProviderModelsV2(model.provider_id));
      setNotice(`${model.display_name} agora é o modelo padrão.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao definir modelo padrão.');
    } finally {
      setBusy(null);
    }
  };

  const removeModel = async (model: ProviderModel) => {
    if (!window.confirm(`Excluir o modelo "${model.display_name}"?`)) return;
    setBusy(model.id);
    try {
      await api.deleteProviderModelV2(model.id);
      setModels(await api.listProviderModelsV2(model.provider_id));
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao excluir modelo.');
    } finally {
      setBusy(null);
    }
  };

  const removeProvider = async () => {
    if (!selected || !window.confirm(`Excluir o provider "${selected.name}"? Os agentes vinculados ficarão sem provider/modelo.`)) return;
    setBusy('delete');
    try {
      await api.deleteProviderV2(selected.id);
      setSelectedId(null);
      await onChanged();
      setNotice('Provider excluído.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao excluir provider.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="manager-page">
      <header className="manager-header">
        <div>
          <span className="office-kicker">Universal API</span>
          <h1>Providers</h1>
          <p>Escolha o serviço, informe a URL e a chave. O restante fica automático; opções técnicas ficam escondidas.</p>
        </div>
        <button type="button" className="manager-primary" onClick={startCreate}>+ Novo provider</button>
      </header>

      <div className="manager-layout">
        <aside className="manager-list-panel">
          <div className="manager-list-title">
            <span>Conexões</span>
            <strong>{providers.length}</strong>
          </div>
          <div className="manager-list">
            {providers.map((provider) => (
              <button
                type="button"
                key={provider.id}
                className={`manager-list-item ${selectedId === provider.id ? 'active' : ''}`}
                onClick={() => setSelectedId(provider.id)}
              >
                <span className={`manager-status-dot ${healthClass(provider)}`} />
                <span className="manager-list-copy">
                  <strong>{provider.name}</strong>
                  <small>{provider.protocol_driver}</small>
                </span>
                <span className="manager-chevron">›</span>
              </button>
            ))}
            {!providers.length && <div className="manager-empty-small">Nenhum provider.</div>}
          </div>
        </aside>

        <section className="manager-detail">
          <div className={`manager-card ${showAdvanced ? 'show-advanced' : 'simple-mode'}`}>
            <div className="manager-card-header">
              <div>
                <span className="office-kicker">{selected ? 'Editar conexão' : 'Nova conexão'}</span>
                <h2>{selected?.name ?? 'Adicionar provider'}</h2>
              </div>
              {selected && (
                <span className={`provider-health ${healthClass(selected)}`}>{selected.health_status}</span>
              )}
            </div>

            {!selected && (
              <div className="manager-field">
                <label>Preset</label>
                <select
                  value={draft.preset_id}
                  onChange={(event) => {
                    const preset = presetById.get(event.target.value);
                    if (preset) applyPreset(preset);
                  }}
                >
                  {(capabilities?.presets ?? []).map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="manager-form-grid">
              {!selected && (
                <div className="manager-field provider-advanced-field">
                  <label>ID opcional</label>
                  <input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="minha-api" />
                </div>
              )}
              <div className="manager-field">
                <label>Nome</label>
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
              </div>
              <div className="manager-field span-2">
                <label>Base URL</label>
                <input value={draft.base_url} onChange={(event) => setDraft({ ...draft, base_url: event.target.value })} placeholder="https://api.exemplo.com" />
              </div>
              <div className="manager-field provider-advanced-field">
                <label>Protocolo</label>
                <select value={draft.protocol_driver} onChange={(event) => setDraft({ ...draft, protocol_driver: event.target.value })}>
                  {(capabilities?.protocol_drivers ?? [draft.protocol_driver]).map((driver) => <option key={driver} value={driver}>{driver}</option>)}
                </select>
              </div>
              <div className="manager-field provider-advanced-field">
                <label>Autenticação</label>
                <select value={draft.auth_driver} onChange={(event) => setDraft({ ...draft, auth_driver: event.target.value })}>
                  {(capabilities?.auth_drivers ?? [draft.auth_driver]).map((driver) => <option key={driver} value={driver}>{driver}</option>)}
                </select>
              </div>
              <div className="manager-field provider-advanced-field">
                <label>Timeout (ms)</label>
                <input type="number" min={1000} value={draft.timeout_ms} onChange={(event) => setDraft({ ...draft, timeout_ms: Number(event.target.value) || 60000 })} />
              </div>
              <label className="manager-switch-row provider-advanced-field">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
                <span>Provider ativo</span>
              </label>
            </div>

            <div className="provider-resilience-card provider-advanced-field">
              <div className="binding-title">
                <div>
                  <strong>Resiliência e limites</strong>
                  <span>Protege a API contra rajadas, falhas temporárias e excesso de concorrência.</span>
                </div>
              </div>
              <div className="manager-form-grid">
                <div className="manager-field">
                  <label>Retries de geração</label>
                  <input type="number" min={0} max={5} value={draft.retry_attempts} onChange={(event) => setDraft({ ...draft, retry_attempts: Number(event.target.value) || 0 })} />
                </div>
                <div className="manager-field">
                  <label>Backoff inicial (ms)</label>
                  <input type="number" min={100} value={draft.retry_backoff_ms} onChange={(event) => setDraft({ ...draft, retry_backoff_ms: Number(event.target.value) || 500 })} />
                </div>
                <div className="manager-field">
                  <label>Máx. requisições simultâneas</label>
                  <input type="number" min={1} max={20} value={draft.max_concurrent_requests} onChange={(event) => setDraft({ ...draft, max_concurrent_requests: Number(event.target.value) || 1 })} />
                </div>
                <div className="manager-field">
                  <label>Intervalo mínimo (ms)</label>
                  <input type="number" min={0} value={draft.min_request_interval_ms} onChange={(event) => setDraft({ ...draft, min_request_interval_ms: Number(event.target.value) || 0 })} />
                </div>
              </div>
              <small>GETs de health/discovery têm retry conservador automático. Gerações POST só repetem se você permitir acima.</small>
            </div>

            <div className="manager-secret-box">
              <div>
                <strong>Credencial / API key</strong>
                <span>{selected?.secret_ref ? 'Credencial configurada. Digite outra somente para substituir.' : 'A chave não é exibida novamente.'}</span>
              </div>
              <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={selected?.secret_ref ? '••••••••••••' : 'Cole a chave aqui'} />
              {selected && (
                <div className="secret-actions">
                  <button type="button" onClick={saveSecret} disabled={!secret.trim() || busy === 'secret'}>Salvar chave</button>
                  {selected.secret_ref && (
                    <button
                      type="button"
                      className="danger-link"
                      onClick={async () => {
                        if (!window.confirm('Remover a credencial deste provider?')) return;
                        setBusy('secret-delete');
                        try {
                          await api.deleteProviderSecretV2(selected.id);
                          await onChanged();
                          setNotice('Credencial removida.');
                        } catch (reason) {
                          setError(reason instanceof Error ? reason.message : 'Falha ao remover credencial.');
                        } finally {
                          setBusy(null);
                        }
                      }}
                      disabled={busy === 'secret-delete'}
                    >
                      Remover chave
                    </button>
                  )}
                </div>
              )}
            </div>

            <button type="button" className="manager-advanced-toggle" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? 'Ocultar opções avançadas' : 'Opções avançadas'}
            </button>

            {showAdvanced && (
              <div className="manager-json-grid">
                <div className="manager-field">
                  <label>Headers JSON</label>
                  <textarea value={draft.headers_text} onChange={(event) => setDraft({ ...draft, headers_text: event.target.value })} rows={7} />
                </div>
                <div className="manager-field">
                  <label>Query JSON</label>
                  <textarea value={draft.query_text} onChange={(event) => setDraft({ ...draft, query_text: event.target.value })} rows={7} />
                </div>
                <div className="manager-field">
                  <label>Auth config JSON</label>
                  <textarea value={draft.auth_config_text} onChange={(event) => setDraft({ ...draft, auth_config_text: event.target.value })} rows={7} />
                </div>
                <div className="manager-field">
                  <label>Protocol config JSON</label>
                  <textarea value={draft.protocol_config_text} onChange={(event) => setDraft({ ...draft, protocol_config_text: event.target.value })} rows={7} />
                </div>
              </div>
            )}

            <div className="manager-actions">
              <button type="button" className="manager-primary" onClick={saveProvider} disabled={busy === 'save'}>
                {busy === 'save' ? 'Salvando...' : 'Salvar provider'}
              </button>
              {selected && <button type="button" onClick={testProvider} disabled={busy === 'test'}>{busy === 'test' ? 'Testando...' : 'Testar conexão'}</button>}
              {selected && <button type="button" onClick={discover} disabled={busy === 'discover'}>{busy === 'discover' ? 'Buscando...' : 'Descobrir modelos'}</button>}
              {selected && <button type="button" className="danger-ghost" onClick={removeProvider} disabled={busy === 'delete'}>Excluir</button>}
            </div>

            {notice && <div className="manager-notice success">{notice}</div>}
            {error && <div className="manager-notice error">{error}</div>}
          </div>

          {selected && (
            <div className="manager-card">
              <div className="manager-card-header compact">
                <div>
                  <span className="office-kicker">Catálogo</span>
                  <h2>Modelos</h2>
                </div>
                <span className="overview-count">{models.length}</span>
              </div>

              <div className="model-add-row">
                <input value={newModel} onChange={(event) => setNewModel(event.target.value)} placeholder="model-id" />
                <input value={newModelName} onChange={(event) => setNewModelName(event.target.value)} placeholder="Nome amigável (opcional)" />
                <button type="button" onClick={addModel} disabled={!newModel.trim() || busy === 'model'}>Adicionar</button>
              </div>

              <div className="model-list">
                {models.map((model) => (
                  <div key={model.id} className={`model-row ${!model.enabled ? 'disabled' : ''}`}>
                    <div className="model-row-main">
                      <strong>{model.display_name}</strong>
                      <span>{model.model_id}</span>
                      <small>
                        {model.context_window ? `${model.context_window.toLocaleString('pt-BR')} ctx` : 'ctx desconhecido'}
                        {' · '}
                        {model.capabilities.streaming === false ? 'sem streaming' : 'streaming'}
                      </small>
                    </div>
                    <div className="model-row-actions">
                      {model.is_default ? <span className="default-chip">Padrão</span> : <button type="button" onClick={() => makeDefault(model)}>Definir padrão</button>}
                      <button type="button" onClick={() => toggleModel(model)} disabled={busy === model.id}>{model.enabled ? 'Desativar' : 'Ativar'}</button>
                      <button type="button" className="danger-link" onClick={() => removeModel(model)}>Excluir</button>
                    </div>
                  </div>
                ))}
                {!models.length && <div className="manager-empty-small">Descubra modelos pela API ou adicione um manualmente.</div>}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
