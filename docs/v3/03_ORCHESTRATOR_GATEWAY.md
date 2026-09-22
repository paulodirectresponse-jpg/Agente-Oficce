# V3.2 — Orchestrator Gateway

**Status:** PLANNED  
**Depende de:** V3.0 + V3.1.  
**Bloqueia:** Gap Analysis e Execution Planner.

## Objetivo

Criar a camada central que recebe cada solicitação e decide se o caso é direto, exige IA de orquestração, precisa de plano ou deve respeitar target explícito.

O Orchestrator não é um Agent record comum.

## Fluxo

```
message
→ explicit target parser
→ deterministic fast path
→ complexity/risk estimate
→ Fast Orchestrator se necessário
→ Deep Orchestrator somente se necessário
→ schema validation
→ deterministic policy validator
→ RoutingDecision
```

## RoutingDecision

Contrato estruturado esperado:
- request_id;
- normalized_goal;
- target_mode: direct_agent | dynamic_team | existing_team | needs_gap_analysis;
- required_capabilities[];
- required_tools[];
- optional_capabilities[];
- complexity;
- risk;
- requires_plan;
- candidate_scope;
- quality_controls;
- explanation;
- confidence.

Nunca persistir chain-of-thought. Persistir somente decisão estruturada e rationale resumido.

## Fast path determinístico

Casos que não devem gastar Orchestrator LLM:
- `@agent`;
- `@team`;
- ação inequívoca e capability única de alta confiança;
- continuação de uma execução onde owner já está definido.

Ainda validar:
- agent enabled;
- provider/model healthy;
- permissions.

## Fast Orchestrator

Usar modelo rápido/barato configurável.

Deve produzir JSON/schema estrito.

Não recebe secrets.
Não recebe filesystem.
Não recebe tool executors.
Recebe:
- solicitação;
- project summary mínimo;
- lista resumida de capability domains disponíveis;
- constraints/budgets.

## Deep Orchestrator

Acionado quando:
- baixa confiança;
- multi-domínio;
- tarefa de alto risco;
- dependencies complexas;
- replan sofisticado;
- Fast retorna `needs_deep_analysis`.

Não deve ser padrão.

## Configuração

Criar app settings:
- fast orchestrator provider/model;
- deep orchestrator provider/model;
- fallback;
- thresholds;
- enabled/disabled.

Fallback se não houver modelo separado:
- usar provider/modelo configurado permitido;
- nunca quebrar fluxo simples.

## Validação determinística

Mesmo que a LLM peça:
- disabled agent;
- capability inexistente;
- tool proibida;
o validator rejeita/corrige e registra reason.

A LLM sugere; o core autoriza.

## Persistência

Adicionar `orchestration_runs` ou estrutura equivalente:
- id;
- project_id;
- conversation_id;
- user_message_id;
- level_used;
- decision_json;
- status;
- created_at;
- duration;
- provider/model;
- input/output tokens;
- error.

## Eventos

- orchestrator.received;
- orchestrator.fast_path;
- orchestrator.analyzing;
- orchestrator.routed;
- orchestrator.fallback;
- orchestrator.failed.

## UI

Nesta etapa, apenas sinais discretos:
- Auto: `Analisando…`;
- depois `Usando Builder` ou `Montando equipe dinâmica`.

Não reconstruir Dev Chat ainda.

## Testes

Golden corpus:
- target explícito;
- pergunta simples;
- bug simples;
- arquitetura;
- marketing;
- landing page completa;
- vídeo;
- pesquisa;
- tarefa multi-domínio;
- pedido impossível com agentes atuais.

Falhas:
- Fast malformed JSON;
- Deep malformed JSON;
- provider down;
- timeout;
- unsupported model;
- invalid capability;
- malicious instruction pedindo permission bypass.

Métricas:
- unnecessary agent intent rate;
- missing capability intent rate;
- orchestrator latency;
- orchestrator token cost.

## Critério de aceite

Toda mensagem `Auto` gera uma decisão válida e explicável, com fallback, sem que a disponibilidade do Orchestrator LLM seja single point of failure.

## Não fazer

- Não executar equipe ainda.
- Não criar agente novo ainda.
- Não persistir chain-of-thought.
- Não permitir Orchestrator usar filesystem/shell.
