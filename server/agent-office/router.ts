import type { AgentAdapter, AgentId } from './adapterFramework.js';

export type TaskCategory =
  | 'ui_visual' | 'frontend_logic' | 'backend' | 'database' | 'auth_security'
  | 'billing_credits' | 'integration' | 'testing' | 'code_review' | 'architecture'
  | 'debugging' | 'documentation' | 'exploration' | 'devops' | 'unknown';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Classification {
  category: TaskCategory;
  risk: RiskLevel;
  confidence: 'rule' | 'default';
}

const CATEGORY_RULES: Array<{ category: TaskCategory; pattern: RegExp }> = [
  { category: 'code_review', pattern: /\b(review|revis[ãa]o|auditoria|audit|code review)\b/i },
  { category: 'auth_security', pattern: /\b(auth|login|senha|password|token|sess[aã]o|session|oauth|jwt|seguran[çc]a|security|permisso|permission)\b/i },
  { category: 'billing_credits', pattern: /\b(billing|pagamento|payment|assinatura|subscription|cobran[çc]a|cr[ée]dito|credits|pre[çc]o|checkout|stripe)\b/i },
  { category: 'database', pattern: /\b(migration|schema|sqlite|sql|tabela|table|banco de dados|database|index)\b/i },
  { category: 'architecture', pattern: /\b(arquitetura|architecture|refatora[çc][ãa]o estrutural|redesign|orquestrador|router|pipeline)\b/i },
  { category: 'exploration', pattern: /\b(explorar|explore|an[áa]lise|analisar|investigar|investigate|mapear|survey|entender|understand)\b/i },
  { category: 'documentation', pattern: /\b(documenta[çc][ãa]o|docs?|readme|coment[áa]rios?)\b/i },
  { category: 'testing', pattern: /\b(teste|test|spec|vitest|jest|cobertura|coverage|e2e)\b/i },
  { category: 'debugging', pattern: /\b(debug|bug|erro|fix|corrigir|crash|falha|troubleshoot)\b/i },
  { category: 'devops', pattern: /\b(deploy|ci|cd|pipeline|docker|tauri|release|build|instalador|installer)\b/i },
  { category: 'integration', pattern: /\b(api|integra[çc][ãa]o|webhook|adapter|provider|gateway)\b/i },
  { category: 'frontend_logic', pattern: /\b(react|componente|component|state|hook|frontend|tela|screen|p[áa]gina|page|formul[áa]rio)\b/i },
  { category: 'ui_visual', pattern: /\b(css|layout|estilo|style|visual|design|tema|theme|anima[çc][ãa]o|ícone|icon|cor|ux)\b/i },
];

const HIGH_RISK_CATEGORIES: ReadonlySet<TaskCategory> = new Set(['auth_security', 'billing_credits']);
const HIGH_RISK_PATTERN = /\b(delete|apagar|excluir|drop|reset|migra[çc][ãa]o|migration|deploy|billing|auth|senha|password|cr[íi]tico|destrutivo|force)\b/i;
const LOW_RISK_PATTERN = /\b(css|layout|copy|texto|text|readme|docs?|coment[áa]rio|estilo|cor|tema|icon)\b/i;

export function classifyTask(title: string, description: string): Classification {
  const text = `${title}\n${description}`;
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(text)) {
      return { category: rule.category, risk: inferRisk(rule.category, text), confidence: 'rule' };
    }
  }
  return { category: 'unknown', risk: 'medium', confidence: 'default' };
}

function inferRisk(category: TaskCategory, text: string): RiskLevel {
  if (HIGH_RISK_CATEGORIES.has(category)) return 'high';
  if (HIGH_RISK_PATTERN.test(text)) return 'high';
  if (category === 'database') return 'medium';
  if (LOW_RISK_PATTERN.test(text) || category === 'documentation') return 'low';
  return 'medium';
}

export interface ProtectedModeState {
  reserveWeeklyPercent: number;
  weeklyUsedPercent: number | null;
}

export interface RouterInput {
  title: string;
  description: string;
  category?: string;
  risk?: RiskLevel;
  failures?: number;
  previousAgent?: AgentId | null;
}

export interface RoutingDecision {
  agent: AgentId;
  reason: string;
  protectedMode?: 'unknown' | 'restricted' | 'manual_only';
}

export const DEFAULT_PROTECTED_MODE: ProtectedModeState = { reserveWeeklyPercent: 25, weeklyUsedPercent: null };

export class TaskRouter {
  constructor(
    private readonly adapters: Map<string, AgentAdapter>,
    private readonly protectedMode: ProtectedModeState = DEFAULT_PROTECTED_MODE,
  ) {}

  private available(id: AgentId): boolean {
    return this.adapters.has(id);
  }

  codexRestriction(): 'unknown' | 'normal' | 'restricted' | 'manual_only' {
    const used = this.protectedMode.weeklyUsedPercent;
    if (used === null) return 'unknown';
    const remaining = 100 - used;
    if (remaining <= 10) return 'manual_only';
    if (remaining <= this.protectedMode.reserveWeeklyPercent) return 'restricted';
    return 'normal';
  }

  private codexAllowed(risk: RiskLevel, manualOverride: boolean): { allowed: boolean; state?: RoutingDecision['protectedMode'] } {
    const restriction = this.codexRestriction();
    if (restriction === 'unknown') return { allowed: true, state: 'unknown' };
    if (restriction === 'normal') return { allowed: true };
    if (restriction === 'manual_only') return { allowed: manualOverride, state: 'manual_only' };
    return { allowed: manualOverride || risk === 'high', state: 'restricted' };
  }

  private primaryFor(category: TaskCategory, risk: RiskLevel): AgentId[] {
    switch (category) {
      case 'ui_visual':
        return risk === 'high' ? ['kimi', 'claude'] : ['kimi'];
      case 'frontend_logic':
      case 'backend':
      case 'integration':
      case 'unknown':
        return risk === 'high' ? ['kimi', 'claude', 'codex'] : ['kimi', 'claude'];
      case 'testing':
      case 'documentation':
      case 'code_review':
      case 'exploration':
        return ['claude', 'kimi'];
      case 'architecture':
      case 'auth_security':
      case 'billing_credits':
      case 'database':
        return risk === 'high' ? ['codex', 'claude'] : ['kimi', 'claude'];
      case 'debugging':
        return risk === 'high' ? ['codex', 'claude'] : ['kimi', 'claude'];
      case 'devops':
        return ['claude', 'codex'];
    }
  }

  decide(input: RouterInput, manualOverride?: AgentId | null): RoutingDecision {
    const classification = input.category && input.risk
      ? { category: input.category as TaskCategory, risk: input.risk }
      : classifyTask(input.title, input.description);
    const { category, risk } = classification;

    if (manualOverride && this.available(manualOverride)) {
      if (manualOverride === 'codex') {
        const gate = this.codexAllowed(risk, true);
        if (!gate.allowed) return { agent: 'claude', reason: 'codex protected mode: manual-only, falling back to claude', protectedMode: gate.state };
        return { agent: 'codex', reason: 'manual override @codex', protectedMode: gate.state };
      }
      return { agent: manualOverride, reason: `manual override @${manualOverride}` };
    }

    const failures = input.failures ?? 0;
    const previous = input.previousAgent ?? null;

    if (failures > 0 && previous) {
      const escalation = this.escalate(previous, risk, category);
      if (escalation) return escalation;
    }

    const candidates = this.primaryFor(category, risk);
    for (const candidate of candidates) {
      if (!this.available(candidate)) continue;
      if (candidate === 'codex') {
        const gate = this.codexAllowed(risk, false);
        if (!gate.allowed) {
          if (gate.state === 'manual_only') return { agent: 'claude', reason: 'codex manual-only under protected mode', protectedMode: gate.state };
          continue;
        }
        return { agent: 'codex', reason: `${category}/${risk} routed to codex`, protectedMode: gate.state };
      }
      return { agent: candidate, reason: `${category}/${risk} routed to ${candidate}` };
    }
    const fallbackOrder: AgentId[] = ['kimi', 'claude', 'codex'];
    for (const candidate of fallbackOrder) {
      if (this.available(candidate) && candidate !== 'codex') return { agent: candidate, reason: 'fallback to first available executor' };
    }
    return { agent: 'kimi', reason: 'fallback to default executor' };
  }

  private escalate(previous: AgentId, risk: RiskLevel, category: TaskCategory): RoutingDecision | null {
    if (previous === 'kimi') {
      if (this.available('claude')) return { agent: 'claude', reason: 'escalation: kimi failed, claude analyzes' };
      const gate = this.codexAllowed(risk, false);
      if (gate.allowed && this.available('codex')) return { agent: 'codex', reason: 'escalation: kimi failed, codex', protectedMode: gate.state };
      return null;
    }
    if (previous === 'claude') {
      if (risk === 'high') {
        const gate = this.codexAllowed(risk, false);
        if (gate.allowed && this.available('codex')) return { agent: 'codex', reason: 'escalation: claude failed on high-risk, codex', protectedMode: gate.state };
      }
      if (this.available('kimi')) return { agent: 'kimi', reason: 'escalation: claude failed, kimi retries with diagnosis' };
      return null;
    }
    return null;
  }

  teamPlan(risk: RiskLevel): AgentId[] {
    if (risk === 'high') return ['codex', 'kimi', 'claude', 'codex'];
    if (risk === 'medium') return ['kimi', 'claude'];
    return ['kimi'];
  }
}
