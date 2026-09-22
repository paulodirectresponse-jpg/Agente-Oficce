# V3.5 — Durable Runs + Replanning

**Status:** PLANNED  
**Depende de:** V3.0 + V3.4.  
**Bloqueia:** operações longas confiáveis, Teams avançados e release V3.

## Objetivo

Permitir tarefas de minutos/horas sobreviverem a restart, perda de SSE, app fechado, provider indisponível, approval pendente e replanejamento sem perder consistência.

## Princípio

Estado durável fica no banco. Memória de processo é cache/controle, nunca única fonte de verdade.

## Checkpoints

Persistir checkpoint após transições críticas:
- plan validated;
- step started;
- antes de side effect;
- tool completed;
- approval requested;
- approval resolved;
- step completed;
- artifact persisted;
- replan committed.

Checkpoint deve conter referências, não dumps secretos:
- plan version;
- ready/running/waiting steps;
- attempts;
- pending approvals;
- locks;
- consumed budgets;
- artifact refs;
- last event sequence.

## Estados resumíveis

Definir explicitamente:
- queued → resumível;
- ready → resumível;
- waiting_approval → resumível;
- waiting_provider → resumível;
- blocked → resumível quando condição muda;
- running_model → normalmente retry/reconcile;
- running_tool read-only → retry seguro se idempotente;
- running_tool side-effect → reconciliar por idempotency key;
- completed/cancelled → terminal.

## Recovery Service V3

No startup:
1. localizar orchestration runs não terminais;
2. carregar checkpoint;
3. reconciliar attempts;
4. reconciliar approvals;
5. reconciliar locks;
6. reconciliar idempotent tool calls;
7. marcar unknown side effects como blocked_manual_review se não puder provar estado;
8. retomar scheduler;
9. emitir `run.recovered`.

Nunca executar novamente side effect incerto automaticamente.

## Provider failure

Policy:
- transient provider error → backoff/retry do step;
- provider unhealthy prolongado → fallback model se policy permitir;
- sem fallback → waiting_provider;
- manter budget accounting.

Fallback model precisa satisfazer capabilities técnicas obrigatórias.

## Replanning

Triggers:
- capability gap detectado em runtime;
- step falhou após retries;
- artifact inválido;
- user orientation;
- budget pressure;
- provider unavailable;
- new constraint.

Fluxo:
```
Plan v1 running
→ trigger
→ snapshot current progress
→ planner proposes Plan v2
→ validator
→ preserve completed steps/artifacts when compatible
→ mark v1 superseded
→ continue v2
```

Não apagar histórico.

## Replan limits

- max_replans default conservador;
- evitar infinite loop;
- fingerprint do motivo;
- se mesmo motivo reaparece N vezes, bloquear e pedir usuário.

## User interruption

Durante run:
- orientar execução atual;
- enfileirar nova mensagem;
- cancelar;
- solicitar replan.

Definir persistence desses comandos para Dev Chat futuro.

## Approvals duráveis

Approval não pode depender de loop polling em memória.
Persistir:
- status;
- requested_at;
- resolved_at;
- expiry;
- actor;
- tool invocation id.

Após restart, UI continua mostrando pending.

## Eventos

- checkpoint.created;
- run.recovering;
- run.recovered;
- step.retried;
- provider.waiting;
- replan.requested;
- plan.updated;
- run.blocked_manual_review.

## Chaos tests

Matar runtime durante:
- model request;
- tool read;
- tool write após side effect;
- approval wait;
- test command;
- lock held;
- step completion;
- replan commit.

Ao reiniciar:
- nenhuma duplicação;
- lock reconciliado;
- approval preservado;
- run chega em estado previsível.

## Critério de aceite

Tarefa V3 pode ser interrompida e retomada sem perder plano/steps e sem repetir side effects já confirmados. Estados incertos viram revisão manual, nunca repetição silenciosa.

## Não fazer

- Não prometer exactly-once em integrações externas sem suporte delas; usar idempotency/reconciliation.
- Não guardar checkpoint apenas em metadata gigante de chat_runs.
