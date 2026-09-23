import { runtimeLabel } from './shellModel.js';
import type { RuntimeState } from './shellModel.js';

interface SystemStatusFooterProps {
  runtimeState: RuntimeState;
  onOpenSystem: () => void;
}

export function SystemStatusFooter({ runtimeState, onOpenSystem }: SystemStatusFooterProps) {
  return (
    <div className="ux2-system-footer" aria-live="polite">
      <button
        type="button"
        className="ux2-system-button"
        onClick={onOpenSystem}
        aria-label={`${runtimeLabel(runtimeState)}. Abrir central do sistema.`}
      >
        <span className={`ux2-system-dot ${runtimeState}`} aria-hidden="true" />
        <span className="ux2-system-text">
          <strong>{runtimeLabel(runtimeState)}</strong>
          <small>Agent Office 0.4 · Central do sistema</small>
        </span>
      </button>
    </div>
  );
}
