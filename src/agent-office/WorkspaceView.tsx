import { useCallback, useEffect, useState } from 'react';
import type { Project } from './types.js';
import { api } from './api.js';

interface WorkspaceViewProps {
  activeProject: Project | null;
  onSelectProject: (project: Project) => void;
}

export function WorkspaceView({ activeProject, onSelectProject }: WorkspaceViewProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [rootPath, setRootPath] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.listProjects()
      .then(setProjects)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar projetos.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !rootPath.trim()) return;
    setCreating(true);
    setCreateError(null);
    api.createProject({ name: name.trim(), root_path: rootPath.trim() })
      .then((project) => {
        setName('');
        setRootPath('');
        load();
        onSelectProject(project);
      })
      .catch((reason: unknown) => setCreateError(reason instanceof Error ? reason.message : 'Falha ao criar projeto.'))
      .finally(() => setCreating(false));
  };

  return (
    <div>
      <h2 className="app-view-title">Workspace</h2>
      <p className="app-view-subtitle">Projetos locais orquestrados pelo Agent Office.</p>

      <div className="panel">
        <h3>Novo projeto</h3>
        <form onSubmit={submit}>
          <div className="form-row">
            <div className="field">
              <label htmlFor="project-name">Nome</label>
              <input
                id="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="ex.: meu-app"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="project-root">Caminho raiz (root_path)</label>
              <input
                id="project-root"
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
                placeholder="C:/Users/paulo/Documents/meu-app"
                required
              />
            </div>
          </div>
          {createError && <p className="error-text">{createError}</p>}
          <button type="submit" className="btn btn-primary" disabled={creating}>
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
