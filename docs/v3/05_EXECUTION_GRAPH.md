# V3.4 — Execution Graph

**Status:** PLANNED  
**Depende de:** V3.2 + V3.3.  
**Bloqueia:** Durable Runs, Teams e Dev Chat completo.

## Objetivo

Substituir fluxos fixos como planner → responder → reviewer por um plano de execução versionado em grafo acíclico direcionado (DAG), capaz de serializar dependências, paralelizar trabalho independente e impor budgets.

## Domínio

### ExecutionPlan
- id;
- orchestration_run_id;
- project_id;
- version;
- status: draft | validated | running | superseded | completed | failed | cancelled;
- goal;
- rationale resumido;
- budget snapshot;
- created_at.

### ExecutionStep
- id;
- plan_id;
- key;
- title;
- goal;
- required_capabilities_json;
- required_tools_json;
- assigned_agent_id nullable;
- assigned_team_id nullable;
- status;
- risk;
- expected_outputs_json;
- success_criteria_json;
- timeout_ms;
- retry_policy_json;
- priority;
- created_at/updated_at.

### StepDependency
- step_id;
- depends_on_step_id;
- dependency_type: hard | artifact | approval.

### StepAttempt
- step_id;
- attempt_number;
- run/child_run reference;
- status;
- started_at/ended_at;
- error/result summary;
- provider/model snapshot.

## Migration

Adicionar tabelas:
- `execution_plans`;
- `execution_steps`;
- `step_dependencies`;
- `step_attempts`;
- `execution_artifacts`;
- `resource_locks`.

Indices:
- plan/status;
- step/plan/status;
- dependency reverse lookup;
- lock/resource/status;
- attempt/step.

## Planner

Entrada:
- normalized goal;
- requirements;
- gap analysis;
- eligible candidates;
- budgets;
- project context resumido.

Saída estruturada:
- steps;
- dependencies;
- assignment hints;
- expected artifacts;
- quality gates.

O LLM Planner pode sugerir DAG. Um validator determinístico deve:
- rejeitar ciclos;
- rejeitar step sem goal;
- rejeitar dependency inexistente;
- rejeitar assignment inválido;
- validar budgets;
- validar capabilities obrigatórias;
- normalizar IDs/keys.

## Scheduler

Criar serviço dedicado, não embutir tudo no Chat Runner:
- encontrar steps `ready`;
- respeitar hard dependencies;
- respeitar max_parallel_agents;
- respeitar provider concurrency existente;
- adquirir locks antes de write;
- criar attempt;
- delegar execução;
- persistir resultado;
- liberar locks;
- promover dependentes.

## Resource Lock Manager

Tipos iniciais:
- file:path;
- directory:path;
- project:git-index;
- preview:process;
- integration:resource.

Modes:
- read;
- write;
- exclusive.

Regra mínima:
- múltiplos read podem coexistir;
- write/exclusive conflitam;
- lock tem owner step/attempt;
- TTL + heartbeat/checkpoint;
- stale lock reconciliado no recovery.

## Work Packet

Cada handoff entre steps deve usar estrutura:
- objective;
- completed_work;
- changed_files;
- decisions;
- tests;
- artifacts;
- open_issues;
- next_action;
- constraints.

Persistir em `work_packets` ou execution artifact typed.

Não usar somente texto solto como handoff.

## Parallelismo

Exemplo:
```
Strategy
 ├─ Copy
 └─ Design
      ↓
    Build
      ↓
     QA
```

Copy e Design podem rodar juntos. Build só inicia quando ambos concluírem.

## Budgets

Scheduler deve receber snapshot:
- max_agents;
- max_parallel;
- max_cost;
- max_tokens;
- max_wall_time;
- max_step_retries;
- max_tool_calls.

Ao atingir limite:
- step/run passa a blocked/budget_exceeded;
- emitir evento;
- pedir decisão quando apropriado.

## Eventos

- plan.created;
- plan.validated;
- step.queued;
- step.ready;
- step.started;
- step.blocked;
- step.completed;
- step.failed;
- artifact.created;
- lock.acquired;
- lock.waiting;
- lock.released.

## Integração com Chat Runner atual

Não apagar Chat Runner V2.
Criar adapter para step que reutiliza:
- provider engine;
- agent context;
- tool loop;
- usage;
- event hub.

V2 single runs podem continuar sem ExecutionPlan durante transição.
V3 complex runs usam scheduler.

## Testes

Unit:
- DAG cycle;
- missing dependency;
- topological order;
- parallel ready set;
- retry;
- timeout;
- budget exceeded;
- lock read/read;
- lock read/write;
- lock write/write;
- stale lock;
- work packet schema.

Property/stress:
- 50k random DAGs;
- nenhum step executa antes da dependency;
- nenhum ciclo validado;
- nenhum write conflict não detectado;
- completion de todos steps alcançáveis quando executors retornam sucesso.

## Critério de aceite

Uma tarefa complexa pode ser persistida como DAG, executar steps independentes em paralelo, produzir artifacts/handoffs estruturados e concluir sem depender de ordem hardcoded por nome de agente.

## Não fazer

- Não implementar recovery completo ainda.
- Não criar Teams permanentes ainda.
- Não colocar scheduler state somente em memória.
