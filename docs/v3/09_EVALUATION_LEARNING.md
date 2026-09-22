# V3.8 — Evaluation + Learning Engine

**Status:** PLANNED  
**Depende de:** V3.4 + V3.5 + V3.7.  
**Bloqueia:** roteamento adaptativo baseado em histórico e sugestões maduras.

## Objetivo

Fazer o Agent Office aprender com uso real sem alterar pesos dos modelos nem permitir que aprendizado ultrapasse políticas de segurança.

## Princípios

- Aprender significa melhorar ranking, preferências, workflow reuse e propostas.
- Não significa fine-tuning automático.
- Objective signals têm prioridade sobre LLM judge.
- Evidence count/confidence importam.
- Hard policy não é aprendida nem relaxada.
- Toda atualização deve ser reversível/auditável.

## Estruturas

Adicionar:
- `learning_episodes`;
- `execution_evaluations`;
- `agent_performance`;
- `model_performance`;
- `workflow_patterns`;
- `user_preferences`.

### Learning Episode
Snapshot por execução:
- request category/capabilities;
- agents/versions;
- teams;
- models;
- plan/version;
- tools;
- token/cost;
- latency;
- retries;
- test/build results;
- user corrections;
- completion status;
- artifacts;
- evaluation id.

### Evaluation
Campos sugeridos:
- objective_success;
- test_success;
- build_success;
- user_rework;
- retries;
- tool_failures;
- cost;
- latency;
- quality_score;
- confidence;
- source breakdown.

## Avaliação

### Sinais objetivos
Para software:
- tests;
- build;
- lint;
- runtime smoke;
- rollback;
- user requested correction.

Para outras áreas:
- task completed;
- artifact accepted;
- revisions;
- delivery completeness;
- user feedback.

### LLM Judge
Pode complementar:
- coerência;
- coverage;
- quality relative to goal.

Nunca ser a única fonte.

## Agent Performance

Chave:
- agent/version;
- capability;
- task context/domain.

Guardar:
- success count;
- failure count;
- weighted score;
- evidence count;
- confidence;
- average cost;
- average latency;
- rework rate.

Não usar média simples sem confidence.

## Model Performance

Separar:
- provider/model;
- capability/domain;
- agent usage.

Objetivo:
- escolher modelo melhor para tarefa;
- detectar modelo barato equivalente em tarefas simples;
- detectar modelo inadequado.

## User Preferences

Exemplos:
- estilo de resposta;
- nível de explicação;
- aprovação/review preference;
- workflow choices;
- UI preferences.

Não guardar:
- secrets;
- permissões inferidas;
- decisões que eliminem approval.

Preferência não é autorização.

## Workflow Patterns

Detectar combinações recorrentes:
- sequence;
- DAG shape;
- team composition;
- tools;
- success.

Estados:
- candidate;
- validated;
- preferred;
- deprecated.

Orchestrator pode usar workflow conhecido como baseline, ainda passando validator.

## Learning Update

Pipeline:
```
run completed
→ collect objective signals
→ evaluation
→ episode
→ update performance with bounded learning rate
→ update confidence
→ detect workflow/preference
→ emit learning.updated
```

## Exploration controlada

Evitar winner lock-in:
- só explorar quando risk baixo;
- candidatos precisam cumprir hard requirements;
- exploration budget pequeno;
- tarefas críticas não exploram por padrão;
- registrar quando escolha foi exploration.

## Segurança

Learning NÃO pode:
- ativar agent;
- ativar provider;
- adicionar tool;
- trocar approval_mode para menos restritivo;
- aumentar delegation depth;
- criar permanent team;
- aprovar proposal;
- alterar secret;
- ignorar project policy.

Criar `PolicyFirewall`/validator que recebe LearningRecommendation e filtra campos permitidos.

## APIs

Internas primeiro.
Debug/admin:
- `GET /v3/learning/agents/:id/performance`
- `GET /v3/learning/models/:id/performance`
- `GET /v3/learning/workflows`
- `GET/PUT /v3/preferences`

## UI

Uso/Analytics futuro:
- desempenho por agente;
- custo;
- tempo;
- quantidade de evidências.

Agent Manager:
- verified capability read-only;
- “baseado em N execuções”.

## Testes

- success updates;
- failure updates;
- sparse evidence;
- confidence;
- contradictory episodes;
- old data decay;
- model ranking;
- preference update;
- workflow candidate;
- policy firewall.

Property/stress:
- 100k learning updates;
- disabled agent nunca vira eligible;
- forbidden tool nunca é added;
- approval policy nunca relaxa via learning;
- score bounded;
- confidence monotonic with evidence (salvo explicit reset/version).

## Critério de aceite

Roteamento pode usar performance e preferência como fatores de ranking, mas todas as regras de elegibilidade continuam vindo do core/policies.

## Não fazer

- Não fine-tunar modelos nesta etapa.
- Não persistir conteúdo sensível só para “aprender”.
- Não usar user preference como permission grant.
