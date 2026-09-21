import { describe, expect, it } from 'vitest';
import { classifyTask, TaskRouter, DEFAULT_PROTECTED_MODE } from './router.js';
import type { AgentAdapter } from './adapterFramework.js';

function fakeAdapter(id: string): AgentAdapter {
  return {
    id: id as AgentAdapter['id'],
    async healthCheck() { return { status: 'healthy' }; },
    getCapabilities() { return { streaming: true, resume: false, tools: [] }; },
    async *startRun() { yield { type: 'complete', timestamp: '', payload: {} }; },
    async cancel() {},
  };
}

function registryWith(...ids: string[]): Map<string, AgentAdapter> {
  return new Map(ids.map(id => [id, fakeAdapter(id)]));
}

describe('task classification', () => {
  it('classifies UI tasks as low risk', () => {
    expect(classifyTask('Ajustar layout do botão', 'mudar cor e espaçamento no css')).toEqual({ category: 'ui_visual', risk: 'low', confidence: 'rule' });
  });

  it('classifies auth tasks as high risk', () => {
    const result = classifyTask('Fix login redirect', 'the login drops the session token');
    expect(result.category).toBe('auth_security');
    expect(result.risk).toBe('high');
  });

  it('classifies unknown tasks as medium risk', () => {
    expect(classifyTask('melhorar algo', '')).toEqual({ category: 'unknown', risk: 'medium', confidence: 'default' });
  });

  it('flags destructive words as high risk', () => {
    const result = classifyTask('Atualizar schema', 'rodar migration e apagar dados antigos');
    expect(result.risk).toBe('high');
  });
});

describe('task router', () => {
  it('routes UI work to Kimi', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    expect(router.decide({ title: 'Ajustar cor do header', description: 'css layout' }).agent).toBe('kimi');
  });

  it('routes code review to Claude', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    expect(router.decide({ title: 'Revisão do módulo de auth', description: 'fazer review e audit' }).agent).toBe('claude');
  });

  it('routes high-risk auth work to Codex', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    const decision = router.decide({ title: 'Corrigir falha de segurança no login', description: 'auth token session' });
    expect(decision.agent).toBe('codex');
  });

  it('falls back to Claude after a Kimi failure', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    const decision = router.decide({ title: 'Feature comum', description: 'backend integration', previousAgent: 'kimi', failures: 1 });
    expect(decision.agent).toBe('claude');
    expect(decision.reason).toContain('escalation');
  });

  it('escalates high-risk Claude failures to Codex', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    const decision = router.decide({ title: 'Corrigir billing', description: 'auth security billing credits', previousAgent: 'claude', failures: 1, risk: 'high', category: 'billing_credits' });
    expect(decision.agent).toBe('codex');
  });

  it('manual override wins over classification', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    expect(router.decide({ title: 'css tweak', description: 'css layout' }, 'codex').agent).toBe('codex');
  });

  it('respects codex protected mode at 25% remaining', () => {
    const registry = registryWith('kimi', 'claude', 'codex');
    const router = new TaskRouter(registry, { reserveWeeklyPercent: 25, weeklyUsedPercent: 78 });
    const low = router.decide({ title: 'Feature comum', description: 'crud backend' });
    expect(low.agent).not.toBe('codex');
    const high = router.decide({ title: 'Corrigir falha de segurança no login', description: 'auth token session' });
    expect(high.agent).toBe('codex');
    expect(high.protectedMode).toBe('restricted');
  });

  it('codex is manual-only at 10% remaining', () => {
    const registry = registryWith('kimi', 'claude', 'codex');
    const router = new TaskRouter(registry, { reserveWeeklyPercent: 25, weeklyUsedPercent: 92 });
    const auto = router.decide({ title: 'Corrigir falha de segurança no login', description: 'auth token session' });
    expect(auto.agent).toBe('claude');
    const manual = router.decide({ title: 'Corrigir falha de segurança no login', description: 'auth token session' }, 'codex');
    expect(manual.agent).toBe('codex');
    expect(manual.protectedMode).toBe('manual_only');
  });

  it('reports unknown quota without blocking codex', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'), DEFAULT_PROTECTED_MODE);
    const decision = router.decide({ title: 'Corrigir falha de segurança no login', description: 'auth token session' });
    expect(decision.agent).toBe('codex');
    expect(decision.protectedMode).toBe('unknown');
  });

  it('skips unavailable adapters', () => {
    const router = new TaskRouter(registryWith('claude'));
    expect(router.decide({ title: 'Feature comum', description: 'crud' }).agent).toBe('claude');
    expect(router.decide({ title: 'css', description: 'layout' }).agent).toBe('claude');
  });

  it('defines team plans by risk', () => {
    const router = new TaskRouter(registryWith('kimi', 'claude', 'codex'));
    expect(router.teamPlan('low')).toEqual(['kimi']);
    expect(router.teamPlan('medium')).toEqual(['kimi', 'claude']);
    expect(router.teamPlan('high')).toEqual(['codex', 'kimi', 'claude', 'codex']);
  });
});
