# Agent Office V3 — Blueprint definitivo de implementação

## 1. Visão

A V3 transforma o Agent Office de um sistema com múltiplos agentes e tools em um sistema operacional de orquestração.

Experiência pretendida:

```
Usuário
  ↓
Orchestrator Gateway
  ↓
Intent + Capability Requirements + Risk + Budget
  ↓
Capability Registry
  ↓
Gap Analysis
  ↓
Execution Planner
  ↓
Execution Graph
  ↓
Agentes / Equipes / Subagentes
  ↓
Tools + Integrations
  ↓
Evaluation
  ↓
Learning
```

O usuário conversa normalmente. A complexidade fica interna.

## 2. Objetivos de produto

- Escalar de poucos agentes para centenas de agentes catalogados.
- Escolher apenas agentes necessários.
- Permitir agentes ativos/inativos.
- Permitir equipes permanentes e equipes dinâmicas.
- Permitir supervisor + subagentes sem ciclos.
- Detectar falta de capacidade e sugerir novos agentes.
- Detectar workflows repetidos e sugerir novas equipes.
- Exigir aprovação para toda criação permanente.
- Aprender preferências, desempenho e workflows sem alterar hard policy.
- Tornar Chat uma workspace estilo Claude Code/Codex.
- Manter Office como visão operacional/organizacional.
- Exibir atividade verdadeira em tempo real.
- Suportar tarefas longas, replan, restart e recovery.
- Separar LLM Providers, Integrations e Tools.

## 3. Estado atual que deve ser preservado

A `main` já possui:
- desktop Tauri;
- backend Express/Node;
- SQLite;
- projects;
- project root persistente;
- providers universais;
- provider models;
- agents dinâmicos;
- agents enabled/disabled;
- conversations/memory;
- Chat Runner V2;
- SSE;
- activity events;
- agent states;
- usage;
- cancellation;
- secret store criptografado;
- retries/backoff;
- provider concurrency gate;
- recovery atual;
- Tool Registry V2;
- local tools;
- tool policies por agente;
- approvals;
- audit;
- OpenAI-compatible tool calling;
- `agent_relations`;
- Office V2;
- Agent/Provider Manager.

Nada disso deve ser reescrito sem necessidade. V3 entra por migrations e novos serviços.

## 4. Princípios de decisão

### 4.1 Minimalidade
O conjunto selecionado é mínimo se remover qualquer agente faz perder uma capability/tool obrigatória ou um controle de qualidade requerido.

### 4.2 Hard blockers antes de score
Eliminar candidato se:
- agente desativado;
- provider indisponível;
- modelo desativado;
- capability obrigatória ausente;
- tool obrigatória ausente;
- policy proíbe execução;
- contexto/model capability incompatível.

Só depois calcular score.

### 4.3 Segurança acima de aprendizado
Learning nunca aumenta permissões nem elimina approval.

### 4.4 Estruturas permanentes supervisionadas
- Dynamic Team: pode nascer automaticamente com agentes existentes.
- Permanent Team: somente manualmente ou após aprovação.
- New Agent: somente manualmente ou após aprovação.
- Agent Factory prepara; usuário autoriza persistência/ativação.

### 4.5 Execução versionada
Plano, agente, equipe, prompt e policy devem ter snapshot/version quando afetarem uma run.

## 5. Novas famílias de domínio

### Capabilities
- `capability_definitions`
- `agent_capabilities`
- `model_capabilities`
- `tool_capabilities`

### Orchestration
- `orchestration_runs`
- `execution_plans`
- `execution_steps`
- `step_dependencies`
- `step_attempts`

### Teams
- `teams`
- `team_members`
- `team_policies`
- `team_versions`

### Coordination
- `work_packets`
- `resource_locks`
- `execution_artifacts`

### Proposals
- `agent_proposals`
- `team_proposals`
- `proposal_events`

### Versioning
- `agent_versions`

### Evaluation / Learning
- `learning_episodes`
- `execution_evaluations`
- `agent_performance`
- `model_performance`
- `workflow_patterns`
- `user_preferences`

### Integrations
- `integration_connections`
- `integration_capabilities`

Nomes podem ser refinados durante implementação, mas a responsabilidade de domínio não deve ser misturada.

## 6. Pipeline definitivo de uma solicitação

```
message received
→ normalize intent
→ resolve explicit target override
→ derive required capabilities/tools
→ estimate complexity/risk
→ retrieve eligible candidates
→ gap analysis
→ decide direct / dynamic team / permanent team / proposal
→ create execution plan when needed
→ validate plan
→ execute DAG
→ checkpoint
→ replan when evidence changes
→ evaluate
→ deliver
→ write learning episode
→ detect agent/team/workflow opportunity
```

## 7. Orchestrator em camadas

### Level 0 — deterministic
Para target explícito, comando simples e rotas inequívocas.

### Level 1 — Fast Orchestrator
Modelo barato/rápido gera decisão estruturada.

### Level 2 — Deep Orchestrator
Somente para solicitação ambígua/complexa, planejamento multi-domínio ou replan sofisticado.

Fallback:
```
Deep/Fast failed
→ repair structured output once
→ alternate model
→ deterministic router
```

O app não deve ficar inutilizável porque o Orchestrator LLM falhou.

## 8. Budgets obrigatórios

Toda orchestration run deve possuir limites:
- max cost;
- max tokens;
- max agents;
- max parallel agents;
- max tool calls;
- max replans;
- max wall time;
- max delegation depth;
- max retries por step.

Presets de UX futuros:
- Economy;
- Normal;
- Quality;
- Custom.

## 9. Event Bus V3

Taxonomia alvo:
- `orchestrator.received`
- `orchestrator.routed`
- `plan.created`
- `plan.updated`
- `step.queued`
- `step.started`
- `step.completed`
- `step.failed`
- `agent.assigned`
- `agent.delegated`
- `agent.state`
- `team.activated`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `file.read`
- `file.created`
- `file.changed`
- `test.started`
- `test.completed`
- `approval.requested`
- `approval.resolved`
- `handoff.created`
- `proposal.agent.created`
- `proposal.team.created`
- `proposal.approved`
- `proposal.rejected`
- `evaluation.completed`
- `learning.updated`
- `run.completed`
- `run.failed`

Office e Dev Chat consomem a mesma fonte de verdade.

## 10. Invariantes globais para testes

- Nenhum permanent agent/team criado sem approval/manual action.
- Nenhum agente disabled em Auto.
- Nenhum provider/model disabled em Auto.
- Nenhuma permission escalation por delegação.
- Nenhum ciclo em hierarchy/dependencies.
- Nenhum step inicia antes de dependências satisfeitas.
- Nenhum write concorrente no mesmo resource sem lock.
- Nenhum path fora do project root.
- Nenhum secret persistido no audit/log.
- Nenhum learning update altera hard policy.
- Nenhum plan replan apaga histórico anterior.
- Nenhuma proposal duplicada enquanto fingerprint equivalente está pendente/cooldown.
- Nenhuma run longa perde estado sem estratégia explícita de recovery.

## 11. Estratégia de testes

### Por commit
- unit;
- typecheck;
- migrations;
- regressão mínima;
- schema validation.

### Por PR
- integration;
- routing golden set;
- scheduler;
- approvals;
- recovery;
- UI state;
- Windows gate quando aplicável.

### Stress/property
Metas pós-implementação:
- 100k routing cases;
- 50k agent proposal cases;
- 50k team proposal cases;
- 50k execution DAGs;
- 50k hierarchy mutations;
- 100k learning updates;
- 100k permission combinations;
- 50k restart/recovery transitions;
- 50k concurrency/scheduling cases.

Esses testes sintéticos não substituem testes reais de providers pagos.

## 12. Sequência oficial

V3.0 Hardening → V3.1 Capabilities → V3.2 Orchestrator → V3.3 Gap Analysis → V3.4 Execution Graph → V3.5 Durable Runs → V3.6 Teams → V3.7 Proposals/Factory → V3.8 Learning → V3.9 Dev Chat → V3.10 Office → V3.11 Integrations/Release.

Não pular:
- Teams antes de DAG;
- Learning antes de Evaluation;
- Factory antes de Proposal approvals;
- UI de atividade antes dos eventos reais.

## 13. Definition of Done global

V3 só é considerada pronta quando:
- migrations de upgrade preservam dados V2;
- fresh install e upgrade passam;
- stress/adversarial suite verde;
- Windows/Tauri/MSI gate verde;
- recovery de long run definido;
- approvals retomáveis;
- zero criação permanente não aprovada;
- zero ciclo conhecido;
- zero permission escalation conhecida;
- zero escape conhecido do project root;
- zero secret conhecido em logs/audit;
- Dev Chat não trava composer;
- Office mostra somente atividades derivadas de eventos reais.
