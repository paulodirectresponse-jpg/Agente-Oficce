# V3.6 — Teams + Subagents

**Status:** PLANNED  
**Depende de:** V3.1 + V3.4 + V3.5.  
**Bloqueia:** Proposal Engine de equipes e Office por departamentos.

## Objetivo

Introduzir equipes como entidade própria e permitir delegação hierárquica supervisionada sem duplicar agentes nem criar grafos cíclicos.

## Distinções

### Agent
Especialista reutilizável.

### Dynamic Team
Composição temporária de agentes existentes para uma execution run. Pode ser montada automaticamente.

### Permanent Team
Entidade persistente. Só manual ou aprovada pelo usuário.

### Team Lead
Opcional. Coordena steps internos quando a complexidade justifica.

### Subagent
Agent executando sob delegação de outro agent/team naquele contexto; não precisa ser uma cópia nem pertencer exclusivamente a uma equipe.

## Schema

Adicionar:
- `teams`;
- `team_members`;
- `team_policies`;
- `team_versions`;
- opcional `team_capabilities_cache`.

Campos de team:
- id;
- name;
- slug;
- purpose;
- type: permanent | system;
- lead_agent_id nullable;
- enabled;
- max_parallelism;
- max_delegation_depth;
- allow_external_borrowing;
- proposal_policy;
- metadata;
- created_at/updated_at.

Team members:
- team_id;
- agent_id;
- role_name;
- priority;
- enabled;
- metadata.

Agente pode existir em múltiplos teams.

## Relação com agent_relations

Não usar `agent_relations` como tabela de membership.
Manter para relações diretas/supervision.
Teams possuem membership própria.

Migrar/compatibilizar UI de subagents sem apagar dados existentes.

## Delegation Policy

Uma delegação válida precisa satisfazer:
- child enabled;
- no ciclo;
- depth <= limite;
- capability adequada;
- tool policy efetiva;
- budget restante;
- provider/model disponível.

Permission effective:
```
user policy
∩ project policy
∩ team policy
∩ delegator delegation scope
∩ agent policy
∩ tool policy
```

Nunca unir permissões por OR.

## Team capability aggregation

Team capability deriva dos membros ativos.
Não inventar score simples por máximo; registrar:
- coverage;
- specialists;
- redundancy;
- tool coverage.

Pode haver cache invalidado quando membership/capabilities mudam.

## Dynamic Team

Criado no execution plan:
- ephemeral id ou orchestration-scoped record;
- não aparece como permanent team;
- não requer approval se só usa agentes existentes e permissões já concedidas;
- não muda cadastro dos agentes.

## Permanent Team manual

UI:
- nome;
- propósito;
- lead opcional;
- membros;
- função por membro;
- policies;
- tools/permission constraints;
- orçamento defaults.

## Team Lead

Usar apenas quando:
- team possui subgraph interno relevante;
- reduz carga do Global Orchestrator.

Lead não ganha permissões extras.
Lead recebe work packet do Global Orchestrator e devolve resultados estruturados.

## Ciclos

Bloquear:
- Agent A supervises B, B supervises A;
- Team lead delega recursivamente de volta ao ancestor;
- team membership/lead chain que gera recursion.

Validator deve operar no grafo efetivo, não só em uma tabela.

## Eventos

- team.activated;
- team.member.assigned;
- agent.delegated;
- agent.returned;
- team.completed;
- delegation.blocked.

## UI nesta etapa

Agent Manager avançado:
- “Participa de equipes” read/manage.

Nova view Teams mínima:
- lista;
- create/edit permanent team;
- membros;
- lead;
- enabled;
- policies.

Office departments fica para V3.10.

## Testes

- agent em vários teams;
- disabled member;
- lead disabled;
- remove member durante idle;
- team in use snapshot permanece válido;
- delegation depth;
- cycles;
- external borrowing on/off;
- permission intersection;
- dynamic team ephemeral;
- permanent team requires explicit create action.

Stress:
- 50 teams;
- 500 catalog agents;
- random membership mutations;
- graph cycle attempts.

## Critério de aceite

Orchestrator consegue selecionar um team existente ou montar Dynamic Team; Team Lead pode delegar dentro de limites; nenhuma estrutura permanente é criada automaticamente.

## Não fazer

- Não criar Agent Factory ainda.
- Não permitir Team Lead criar agente.
- Não transformar todos os workflows em teams permanentes.
