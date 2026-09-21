import { useEffect, useState } from 'react';
import type { ProviderConfig } from './types.js';
import { api } from './api.js';

interface ProviderFormProps {
  providerId: string;
  title: string;
}

function ProviderForm({ providerId, title }: ProviderFormProps) {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [maxToolSteps, setMaxToolSteps] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    api.getProviderConfig(providerId)
      .then((data) => {
        setConfig(data);
        setBaseUrl(String(data.base_url ?? ''));
        setModel(String(data.model ?? ''));
        setTimeoutMs(data.timeout_ms != null ? String(data.timeout_ms) : '');
        setMaxToolSteps(data.max_tool_steps != null ? String(data.max_tool_steps) : '');
      })
      .catch((reason: unknown) => setLoadError(reason instanceof Error ? reason.message : 'Falha ao carregar configuração.'))
      .finally(() => setLoading(false));
  }, [providerId]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaveMessage(null);
    const payload: ProviderConfig = {
      base_url: baseUrl.trim(),
      model: model.trim(),
      timeout_ms: timeoutMs.trim() ? Number(timeoutMs.trim()) : undefined,
      max_tool_steps: maxToolSteps.trim() ? Number(maxToolSteps.trim()) : undefined,
    };
    if (apiKey.trim()) payload.api_key = apiKey.trim();
    api.saveProviderConfig(providerId, payload)
      .then(() => setSaveMessage({ ok: true, text: 'Configuração salva com sucesso.' }))
      .catch((reason: unknown) => setSaveMessage({ ok: false, text: reason instanceof Error ? reason.message : 'Falha ao salvar.' }))
      .finally(() => setSaving(false));
  };

  const apiKeyConfigured = config && typeof config.api_key === 'string' && config.api_key.length > 0;

  return (
    <div className="panel">
      <h3>{title}</h3>
      {loading && <p className="muted">Carregando configuração…</p>}
      {loadError && <p className="error-text">{loadError}</p>}
      {!loading && !loadError && (
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="field">
              <label htmlFor={`${providerId}-base-url`}>Base URL</label>
              <input
                id={`${providerId}-base-url`}
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${providerId}-model`}>Modelo</label>
              <input
                id={`${providerId}-model`}
                value={model}
                onChange={(event) => setModel(event.target.value)}
              />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor={`${providerId}-api-key`}>API key</label>
              <input
                id={`${providerId}-api-key`}
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={apiKeyConfigured ? 'configurada (deixe em branco para manter)' : 'não configurada'}
              />
            </div>
            <div className="field">
              <label htmlFor={`${providerId}-timeout`}>Timeout (ms)</label>
              <input
                id={`${providerId}-timeout`}
                type="number"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor={`${providerId}-max-steps`}>Máx. passos de tool</label>
              <input
                id={`${providerId}-max-steps`}
                type="number"
                value={maxToolSteps}
                onChange={(event) => setMaxToolSteps(event.target.value)}
              />
            </div>
          </div>
          {saveMessage && (
            <p className={saveMessage.ok ? 'success-text' : 'error-text'}>{saveMessage.text}</p>
          )}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </form>
      )}
    </div>
  );
}

export function SettingsView() {
  return (
    <div>
      <h2 className="app-view-title">Configurações</h2>
      <p className="app-view-subtitle">Configuração dos providers de agente.</p>
      <ProviderForm providerId="claude" title="Claude" />
      <ProviderForm providerId="kimi" title="Kimi" />
    </div>
  );
}
