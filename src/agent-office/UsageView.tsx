import { useEffect, useState } from 'react';
import type { UsageEntry } from './types.js';
import { api } from './api.js';

export function UsageView() {
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getUsage()
      .then(setUsage)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Falha ao carregar uso.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="app-view-title">Uso</h2>
      <p className="app-view-subtitle">Consumo de tokens por agente na janela configurada.</p>

      {loading && <p className="muted">Carregando…</p>}
      {error && <p className="error-text">{error}</p>}
      {!loading && !error && usage.length === 0 && (
        <div className="empty-state">Sem dados de uso.</div>
      )}
      {!loading && usage.length > 0 && (
        <div className="panel">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agente</th>
                <th>Janela (dias)</th>
                <th>Input tokens</th>
                <th>Output tokens</th>
                <th>Execuções</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((entry) => (
                <tr key={`${entry.agent_id}-${entry.window_days}`}>
                  <td className="mono">{entry.agent_id}</td>
                  <td>{entry.window_days}</td>
                  <td>{entry.has_data ? entry.input_tokens.toLocaleString('pt-BR') : 'sem dados'}</td>
                  <td>{entry.has_data ? entry.output_tokens.toLocaleString('pt-BR') : 'sem dados'}</td>
                  <td>{entry.has_data ? entry.runs : 'sem dados'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
