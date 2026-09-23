import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types.js';

export type ProjectMenuAction = 'all' | 'new' | 'settings';

interface ProjectSwitcherProps {
  projects: Project[];
  activeProject: Project | null;
  onSwitch: (project: Project) => void;
  onMenuAction: (action: ProjectMenuAction) => void;
}

export function ProjectSwitcher({ projects, activeProject, onSwitch, onMenuAction }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (project: Project) => {
    onSwitch(project);
    setOpen(false);
  };

  const action = (menuAction: ProjectMenuAction) => {
    onMenuAction(menuAction);
    setOpen(false);
  };

  return (
    <div className="ux2-switcher" ref={rootRef}>
      <button
        type="button"
        className="ux2-switcher-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="ux2-switcher-glyph" aria-hidden="true">□</span>
        <span className="ux2-switcher-name">
          <span className="ux2-switcher-label">Projeto</span>
          <strong>{activeProject ? activeProject.name : 'Selecionar projeto'}</strong>
        </span>
        <span className="ux2-switcher-caret" aria-hidden="true">⌄</span>
      </button>

      {open && (
        <div className="ux2-switcher-menu" role="menu" aria-label="Projetos">
          {projects.length === 0 && (
            <p className="ux2-menu-empty">Nenhum projeto ainda.</p>
          )}
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              role="menuitem"
              className={`ux2-menu-item ${activeProject?.id === project.id ? 'current' : ''}`}
              onClick={() => choose(project)}
            >
              <span className="ux2-menu-check" aria-hidden="true">{activeProject?.id === project.id ? '✓' : ''}</span>
              <span className="ux2-menu-text">{project.name}</span>
            </button>
          ))}
          <div className="ux2-menu-separator" role="separator" />
          <button type="button" role="menuitem" className="ux2-menu-item" onClick={() => action('new')}>
            <span className="ux2-menu-check" aria-hidden="true">＋</span>
            <span className="ux2-menu-text">Novo projeto</span>
          </button>
          <button type="button" role="menuitem" className="ux2-menu-item" onClick={() => action('all')}>
            <span className="ux2-menu-check" aria-hidden="true">□</span>
            <span className="ux2-menu-text">Todos os projetos</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="ux2-menu-item"
            disabled={!activeProject}
            onClick={() => action('settings')}
          >
            <span className="ux2-menu-check" aria-hidden="true">⚙</span>
            <span className="ux2-menu-text">Configurações do projeto</span>
          </button>
        </div>
      )}
    </div>
  );
}
