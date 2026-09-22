# V3.10 — Office V3

**Status:** PLANNED  
**Depende de:** Event Bus V3, Teams, execution state.  
**Objetivo:** transformar Office em visão organizacional escalável sem virar IDE.

## Papel do Office

Office responde:
> “O que minha organização de agentes está fazendo?”

Dev Chat responde:
> “Onde eu trabalho com a execução?”

Não misturar responsabilidades.

## Evolução visual

Com poucos agentes:
- sala única dinâmica continua.

Com crescimento:
- overview de departamentos/equipes;
- rooms por team;
- agentes compartilhados podem aparecer como vínculo, não cópia real.

Orchestrator:
- status global/top bar;
- não tem mesa própria.

## Activity bubble acima do agente

Fonte: eventos reais.

Exemplos:
- “Lendo src/App.tsx”
- “Editando api/routes.ts”
- “Executando testes”
- “Aguardando aprovação”
- “Revisando resposta”

Payload deve ser sanitizado e curto.

Nunca derivar de texto livre da IA se tool/event não confirma ação.

## Team rooms

Permanent Team pode ter room:
- name/purpose;
- lead;
- members;
- current active steps;
- queue;
- status.

Dynamic Teams:
- podem aparecer temporariamente em “Active collaboration” sem criar room permanente.

## Department grouping

Agrupar por team/domain:
- Engineering;
- Marketing;
- Video;
- Research;
- Operations;
- Custom.

Não hardcodar lista; usar metadata/team domain.

## Navigation

Overview:
- global orchestration status;
- active runs;
- active teams;
- pending approvals;
- proposals;
- provider health.

Room:
- agents;
- delegation lines;
- local activity stream;
- team plan subset.

## Delegation visualization

Mostrar apenas eventos atuais/recentes:
- Global Orchestrator → Team;
- Lead → Member;
- Member → Handoff.

Evitar spaghetti permanente de linhas.

## Proposal indicators

Office pode mostrar:
- “1 sugestão de equipe”;
- “2 propostas de agente”;
- pending approvals.

Abrir Proposal Center/modal.

## Scalability

Fixtures obrigatórias:
- 1 agent;
- 2;
- 3;
- 10;
- 30 visible;
- 100+ catalogued;
- 10 teams;
- 50 teams catalogued.

Para muitos:
- virtualization/lazy rendering;
- não renderizar centenas de personagens simultaneamente;
- overview mostra agregados.

## Estados

Continuar suportando:
- offline;
- idle;
- resting;
- thinking;
- planning;
- responding;
- coding;
- testing;
- reviewing;
- waiting;
- blocked;
- error.

Adicionar visual para:
- delegated;
- approval waiting;
sem necessariamente criar novos state values se activity resolve.

## Event integration

Consumir:
- agent.state;
- tool.*;
- file.*;
- test.*;
- team.*;
- step.*;
- approval.*;
- proposal.*;
- orchestrator.*.

Backend continua fonte de verdade.

## Arquivos previstos

Refatorar:
- `src/agent-office/OfficeView.tsx`
- `App.css` ou dividir estilos;
- criar `office/*` para scene, room, agent station, activity bubble, org overview.

Não fazer rewrite visual completo sem preservar direção aprovada.

## Testes

- agent count changes live;
- active/inactive;
- team create/delete;
- shared member;
- activity bubble;
- approval;
- proposal;
- provider offline;
- run recovery;
- responsive;
- large catalog.

## Critério de aceite

Office continua simples com poucos agentes e escala para teams/departments sem ficar inutilizável, sempre mostrando atividade baseada em eventos reais.

## Não fazer

- Não colocar editor de código completo no Office.
- Não duplicar Dev Chat workbench.
- Não mostrar estado inventado.
