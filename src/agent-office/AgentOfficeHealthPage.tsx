import { useEffect, useState } from 'react';

interface AgentOfficeHealth {
  ok: boolean;
  service: string;
  storage: string;
  data_dir_configured: boolean;
  error?: { code: string; message: string };
}

export function AgentOfficeHealthPage() {
  const [health, setHealth] = useState<AgentOfficeHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/agent-office/health')
      .then(async (response) => {
        const payload = await response.json() as AgentOfficeHealth;
        if (!response.ok) throw new Error(payload.error?.message || 'Local Agent Office storage is unavailable.');
        return payload;
      })
      .then((payload) => { if (active) setHealth(payload); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Health check failed.'); });
    return () => { active = false; };
  }, []);

  return (
    <main style={{ minHeight: '100vh', background: '#070b12', color: '#e6edf7', fontFamily: 'system-ui, sans-serif', padding: '48px' }}>
      <section style={{ maxWidth: 720, margin: '0 auto' }}>
        <p style={{ color: '#7dd3fc', letterSpacing: '.16em', textTransform: 'uppercase', fontSize: 12 }}>Agent Office · Bootstrap</p>
        <h1 style={{ fontSize: 36, margin: '12px 0' }}>Local orchestration foundation</h1>
        <p style={{ color: '#9aa8bb', lineHeight: 1.6 }}>The local service is being initialized. Provider connections will only be shown after a real health check.</p>
        <div style={{ marginTop: 32, padding: 24, border: '1px solid #1f3348', borderRadius: 16, background: '#0d1520' }}>
          <strong>{error ? 'Storage unavailable' : health ? 'Service online' : 'Checking local service…'}</strong>
          <p style={{ color: error ? '#fda4af' : '#9aa8bb', marginBottom: 0 }}>{error || (health ? `Storage status: ${health.storage}` : 'Waiting for /api/agent-office/health')}</p>
        </div>
      </section>
    </main>
  );
}
