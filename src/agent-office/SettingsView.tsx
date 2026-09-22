import { useEffect, useState } from 'react';
import type { ProjectRootSetting } from './types.js';
import { api } from './api.js';

export function SettingsView() {
  const [setting, setSetting] = useState<ProjectRootSetting | null>(null);
  const [path, setPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void api.getProjectRootSetting()
      .then((value) => {
        setSetting(value);
        setPath(value.path);
      })
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
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Falha ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <h2 className="app-view-title">Configurações</h2>
      <p className="app-view-subtitle">Preferências gerais do Agent Office.</p>

      <div className="panel">
        <h3>Pasta raiz dos projetos</h3>
        <p className="muted">
          Configure uma vez. Depois, ao criar um projeto, o Agent Office cria automaticamente uma pasta com o nome dele aqui dentro.
        </p>
        <div className="project-root-row">
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="C:\Users\paulo\Documents\Agent Office Projects"
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
          Providers são configurados em “Providers” e agentes em “Agentes”. As opções técnicas ficam escondidas por padrão para não complicar o uso normal.
        </p>
      </div>
    </div>
  );
}
