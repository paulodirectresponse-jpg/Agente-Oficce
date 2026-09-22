import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, ProjectRootSetting } from './types.js';
import { api } from './api.js';

interface WorkspaceViewProps {
  activeProject: Project | null;
  onSelectProject: (project: Project) => void;
}

function previewProjectPath(root: string, name: string): string {
  const cleanRoot = root.replace(/[\\/]+$/, '');
  const cleanName = name.trim().replace(/[<>:"/\\|?*]/g, '-');
  return cleanRoot && cleanName ? `${cleanRoot}\\${cleanName}` : cleanRoot;
}

export function WorkspaceView({ activeProject, onSelectProject }: WorkspaceViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [rootSetting, setRootSetting] = useState<ProjectRootSetting | null>(null);
  const [rootDraft, setRootDraft] = useState('');
  const [savingRoot, setSavingRoot] = useState(false);
  const [rootMessage, setRootMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void Promise.all([
      api.listProjects().then(setProjects),
      api.getProjectRootSetting().then((setting) => {
        setRootSetting(setting);
        setRootDraft(setting.path);
      }),
    ])
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar projetos.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const saveRoot = async () => {
    if (!rootDraft.trim()) return;
    setSavingRoot(true);
    setRootMessage(null);
    try {
      const setting = await api.saveProjectRootSetting(rootDraft.trim());
      setRootSetting(setting);
      setRootDraft(setting.path);
      setRootMessage('Pasta raiz salva. Os próximos projetos serão criados automaticamente dentro dela.');
    } catch (reason) {
      setRootMessage(reason instanceof Error ? reason.message : 'Falha ao salvar a pasta raiz.');
    } finally {
      setSavingRoot(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !rootSetting?.configured) return;
    setCreating(true);
    setCreateError(null);
    api.createProject({ name: name.trim() })
      .then((project) => {
        setName('');
        load();
        onSelectProject(project);
      })
      .catch((reason: unknown) => setCreateError(reason instanceof Error ? reason.message : 'Falha ao criar projeto.'))
      .finally(() => setCreating(false));
  };

  const pathPreview = useMemo(
    () => previewProjectPath(rootSetting?.path ?? rootDraft, name),
    [rootSetting?.path, rootDraft, name],
  );

  return (
    <div>
      <h2 className="app-view-title">Projetos</h2>
      <p className="app-view-subtitle">Defina uma pasta raiz uma vez; depois informe apenas o nome de cada projeto.</p>

      <div className="panel project-root-panel">
        <div className="project-root-heading">
          <div>
            <h3>Pasta raiz padrão</h3>
            <p className="muted">Todo novo projeto ganha uma pasta própria dentro deste diretório.</p>
          </div>
          <span className={`root-status ${rootSetting?.configured ? 'configured' : 'pending'}`}>
            {rootSetting?.configured ? 'Configurada' : 'Configure uma vez'}
          </span>
        </div>
        <div className="project-root-row">
          <input
            value={rootDraft}
            onChange={(event) => setRootDraft(event.target.value)}
            placeholder="C:\Users\paulo\Documents\Agent Office Projects"
          />
          <button type="button" className="btn" onClick={saveRoot} disabled={savingRoot || !rootDraft.trim()}>
            {savingRoot ? 'Salvando…' : 'Salvar pasta raiz'}
          </button>
        </div>
        {rootMessage && <p className="muted">{rootMessage}</p>}
      </div>

      <div className="panel">
        <h3>Novo projeto</h3>
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="project-name">Nome do projeto</label>
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ex.: meu-app"
                required
              />
            </div>
          </div>
          <div className="project-path-preview">
            <span>Será criado em</span>
            <strong className="mono">{pathPreview || 'Defina a pasta raiz acima'}</strong>
          </div>
          {createError && <p className="error-text">{createError}</p>}
          {!rootSetting?.configured && <p className="muted">Salve a pasta raiz antes de criar o primeiro projeto.</p>}
          <button type="submit" className="btn btn-primary" disabled={creating || !rootSetting?.configured || !name.trim()}>
            {creating ? 'Criando…' : 'Criar projeto'}
          </button>
        </form>
      </div>

      {loading && <p className="muted">Carregando projetos…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && projects.length === 0 && (
        <div className="empty-state">Nenhum projeto cadastrado. Crie o primeiro acima.</div>
      )}
      {!loading && projects.map((project) => (
        <div
          key={project.id}
          className={`list-item${activeProject?.id === project.id ? ' selected' : ''}`}
          onClick={() => onSelectProject(project)}
        >
          <div>
            <div>{project.name}</div>
            <div className="mono muted">{project.root_path}</div>
          </div>
          <div className="mono muted">
            {project.git_enabled ? `git: ${project.git_branch ?? '—'}` : 'sem git'}
          </div>
        </div>
      ))}
    </div>
  );
}
