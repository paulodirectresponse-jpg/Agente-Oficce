import { useEffect, useMemo, useState } from 'react';
import type { ProjectRootSetting, RuntimeToolHealth } from './types.js';
import { api } from './api.js';

export function SettingsView() {
  const [setting, setSetting] = useState<ProjectRootSetting | null>(null);
  const [path, setPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingTools, setTestingTools] = useState(false);
  const [toolHealth, setToolHealth] = useState<RuntimeToolHealth[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const healthyCount = useMemo(
    () => toolHealth.filter((tool) => tool.status === 'healthy').length,
    [toolHealth],
  );

  const loadTools = async (force = false) => {
    setTestingTools(true);
    try {
      const result = force
        ? await api.testRuntimeToolHealthV2(path.trim() || setting?.path || undefined)
        : await api.getRuntimeToolHealthV2(path.trim() || setting?.path || undefined);
      setToolHealth(result);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Falha ao testar ferramentas.');
    } finally {
      setTestingTools(false);
    }
  };

  useEffect(() => {
    void api.getProjectRootSetting()
      .then((value) => {
        setSetting(value);
        setPath(value.path);
        return api.getRuntimeToolHealthV2(value.path || undefined);
      })
      .then(setToolHealth)
      .catch((reason) => setMessage(reason instanceof Error ? reason.message : 'Falha ao carregar configurações.'));
  }, []);

  const save = async () => {
    if (!path.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api.saveProjectRootSetting(path.trim());
      setSetting(saved);
      setPath(saved.path);
      setMessage('Pasta raiz salva.');
      await loadTools(true);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="app-view-title">Configurações</h2>
      <p className="app-view-subtitle">Preferências gerais e estado operacional do Agent Office.</p>

      <div className="panel runtime-status-panel">
        <div className="runtime-status-header">
          <div>
            <h3>Runtime · Full Access</h3>
            <p className="muted">
              Os agentes recebem automaticamente todas as ferramentas disponíveis. Recursos ausentes aparecem como indisponíveis, mas não são silenciosamente desativados.
            </p>
          </div>
          <div className="runtime-health-summary">
            <strong>{healthyCount}/{toolHealth.length || 0}</strong>
            <span>operacionais</span>
          </div>
        </div>

        <div className="runtime-tool-grid">
          {toolHealth.map((tool) => (
            <div key={tool.id} className={`runtime-tool-card status-${tool.status}`}>
              <div>
                <span className="runtime-tool-dot" />
                <strong>{tool.label}</strong>
              </div>
              <span className="runtime-tool-status">{tool.status}</span>
              <small>{tool.detail}</small>
            </div>
          ))}
          {!toolHealth.length && <div className="muted">Ainda não foi possível testar o runtime.</div>}
        </div>

        <button type="button" className="btn btn-primary" onClick={() => void loadTools(true)} disabled={testingTools}>
          {testingTools ? 'Testando ferramentas…' : 'Testar todas as ferramentas'}
        </button>
      </div>

      <div className="panel">
        <h3>Pasta raiz dos projetos</h3>
        <p className="muted">
          Esta é a pasta padrão para novos projetos. O Full Access também pode operar fora dela quando uma tarefa exigir.
        </p>
        <div className="project-root-row">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="C:\\Users\\paulo\\Documents\\Agent Office Projects"
          />
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !path.trim()}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
        <p className="muted">
          Status: {setting?.configured ? 'configurada' : 'ainda não configurada'}.
        </p>
        {message && <p className="muted">{message}</p>}
      </div>

      <div className="panel">
        <h3>APIs e agentes</h3>
        <p className="muted">
          Providers são configurados em “Providers” e agentes em “Agentes”. Ferramentas permanecem em Full Access por padrão e cada ação continua auditada.
        </p>
      </div>
    </div>
  );
}
