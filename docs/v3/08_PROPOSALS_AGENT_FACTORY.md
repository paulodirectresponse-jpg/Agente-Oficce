# V3.7 — Proposal Engine + Agent Factory

**Status:** PLANNED  
**Depende de:** V3.3 + V3.6.  
**Bloqueia:** crescimento supervisionado e sugestões inteligentes.

## Objetivo

Permitir que o Orchestrator proponha novos agentes ou equipes quando detectar necessidade real, mantendo aprovação humana antes de qualquer estrutura permanente.

## Tipos de proposta

- new_agent;
- new_team;
- activate_existing_agent;
- add_agent_to_team;
- workflow_to_team;
- capability/tool missing integration (não confundir com agent proposal).

## Agent Proposal

Campos:
- id;
- project/global scope;
- status: pending | edited | approved | rejected | snoozed | muted | applied | failed;
- fingerprint;
- trigger;
- missing_capabilities;
- evidence;
- suggested_name;
- role;
- description;
- system_prompt_draft;
- provider/model suggestion;
- capabilities;
- tool policy;
- team suggestion;
- expected benefit;
- expected cost;
- confidence;
- cooldown_until;
- created_at/resolved_at.

## Team Proposal

Campos equivalentes:
- name/purpose;
- suggested lead;
- existing members;
- optional new-agent proposal refs;
- team policies;
- evidence;
- repeated workflow metrics.

Aprovar team proposal não aprova automaticamente nested agent proposals.

## Proposal fingerprint

Gerar fingerprint estável usando:
- proposal type;
- normalized capability gap/workflow;
- scope.

Regras:
- pending equivalente => não criar outra;
- snoozed => respeitar cooldown;
- muted => não sugerir até unmute;
- rejected => guardar reason e evitar repetição idêntica.

## Quando sugerir novo agente

Pré-requisitos:
1. Gap Analysis confirma capability realmente ausente ou generalistas consistentemente ruins.
2. Não existe active/inactive agent adequado.
3. Não é apenas missing tool/integration.
4. Especialização tem valor suficiente.

Sinais:
- recorrência;
- retrabalho;
- contexto excessivo;
- specialized tools;
- custo/latência;
- performance gap;
- volume.

Uma tarefa pontual pode gerar proposta somente se bloqueante/alta relevância; default é evitar microagentes.

## Quando sugerir team

Sinais:
- mesma combinação recorrente;
- 3+ capabilities diferentes;
- paralelismo consistente;
- um generalista acumulando papéis;
- repeated handoffs;
- workflow pattern forte.

## UI de proposta

Card/modal:
- por que;
- evidências;
- configuração proposta;
- integrantes;
- tools;
- modelo/provider;
- impacto;
- custo aproximado quando possível.

Ações:
- Aprovar;
- Editar;
- Criar inativo;
- Agora não;
- Não sugerir novamente;
- Rejeitar com motivo.

## Agent Factory

Após approval:
1. validar proposal version;
2. criar agent version draft;
3. validar slug/name;
4. validar provider/model;
5. validar capabilities;
6. validar tool policy;
7. rodar dry-run/smoke sem side effects externos;
8. se passa: persistir agent + version;
9. ativar somente se approval pediu ativo;
10. se falha: manter proposta failed/draft; não criar parcialmente.

Operação transacional quando possível.

## Agent Versioning

Adicionar `agent_versions`:
- agent_id;
- version;
- role/description/system prompt snapshot;
- provider/model;
- capability snapshot;
- tool policy snapshot;
- status;
- created_by;
- created_at.

Runs futuras registram version usada.

## Team Factory

Mesmo conceito:
- team version;
- membership snapshot;
- policy snapshot;
- validate no cycles;
- no implicit approval of new agent.

## Endpoints

Sugestão:
- GET/POST `/api/agent-office/v3/proposals`
- GET `/proposals/:id`
- POST `/proposals/:id/approve`
- POST `/proposals/:id/reject`
- POST `/proposals/:id/snooze`
- POST `/proposals/:id/mute`
- PUT `/proposals/:id/draft`

Mutations exigem optimistic version para evitar double approval.

## Eventos

- proposal.agent.created;
- proposal.team.created;
- proposal.edited;
- proposal.approved;
- proposal.rejected;
- proposal.snoozed;
- proposal.applied;
- proposal.failed;
- agent.version.created;
- team.version.created.

## Testes

- proposal dedup;
- snooze cooldown;
- mute;
- approve twice;
- stale version approval;
- nested agent/team approvals;
- factory failure rollback;
- create inactive;
- edit before approve;
- provider removed between proposal and approval;
- tool unavailable;
- cycle introduced in edited team.

Invariante principal:
zero permanent agent/team sem explicit manual action ou approved proposal.

## Critério de aceite

Orchestrator pode detectar “preciso de especialista” ou “isso deveria virar equipe”, explicar e preparar tudo. O usuário mantém decisão final e pode editar antes da criação.

## Não fazer

- Não permitir proposal auto-approve por Learning.
- Não deixar Agent Factory alterar secrets.
- Não criar agentes para gaps que são apenas integrations.
