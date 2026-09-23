import { useState } from 'react';
import { LEGACY_NAV } from './shellModel.js';
import type { ViewKey } from './shellModel.js';

interface LegacyNavProps {
  current: ViewKey;
  onNavigate: (view: ViewKey) => void;
}

export function LegacyNav({ current, onNavigate }: LegacyNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ux2-legacy-nav">
      <button
        type="button"
        className="ux2-legacy-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>Áreas antigas</span>
        <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
      </button>
      {open && (
        <nav className="ux2-legacy-list" aria-label="Áreas antigas">
          {LEGACY_NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`experience-nav-button ${current === item.key ? 'active' : ''}`}
              onClick={() => onNavigate(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
