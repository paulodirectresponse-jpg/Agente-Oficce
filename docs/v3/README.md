# Agent Office V3 — Implementation Handbook

Este diretório é a fonte de verdade para a implementação V3 pós-Fase H.

## Estado de partida

- Base estável: `main`.
- Fases A–H: concluídas.
- Fase H: tools locais permissionadas, approvals, audit, tool calling OpenAI-compatible, roteamento adaptativo, estados coding/testing e fundação de subagentes.
- Gate de referência da Fase H: workflow `35762755020`, 26 arquivos / 123 testes, Windows/Tauri/MSI verdes.
- A V3 não substitui a V2 de uma vez. Ela evolui o core preservando compatibilidade e migrations não destrutivas.

## Ordem obrigatória

1. [V3.0 — Foundation Hardening](./01_FOUNDATION_HARDENING.md)
2. [V3.1 — Capability Core](./02_CAPABILITY_CORE.md)
3. [V3.2 — Orchestrator Gateway](./03_ORCHESTRATOR_GATEWAY.md)
4. [V3.3 — Gap Analysis](./04_GAP_ANALYSIS.md)
5. [V3.4 — Execution Graph](./05_EXECUTION_GRAPH.md)
6. [V3.5 — Durable Runs + Replanning](./06_DURABLE_RUNS_REPLANNING.md)
7. [V3.6 — Teams + Subagents](./07_TEAMS_SUBAGENTS.md)
8. [V3.7 — Proposal Engine + Agent Factory](./08_PROPOSALS_AGENT_FACTORY.md)
9. [V3.8 — Evaluation + Learning](./09_EVALUATION_LEARNING.md)
10. [V3.9 — Dev Chat](./10_DEV_CHAT.md)
11. [V3.10 — Office V3](./11_OFFICE_V3.md)
12. [V3.11 — Integrations + Production Gate](./12_INTEGRATIONS_RELEASE.md)

O blueprint global está em [V3_IMPLEMENTATION_MASTER.md](../V3_IMPLEMENTATION_MASTER.md).

## Regra para qualquer IA que continuar o projeto

Antes de alterar código:

1. Ler `BUILD_STATUS.md`.
2. Ler `docs/V3_IMPLEMENTATION_MASTER.md`.
3. Ler este arquivo.
4. Ler o arquivo da etapa atual.
5. Conferir a `main` real; documentação não substitui inspeção do código.
6. Criar branch específica da etapa.
7. Fazer migrations aditivas e reversíveis quando possível.
8. Preservar projetos, providers, agents, conversas, memória, approvals, audit e histórico.
9. Rodar os testes atuais antes de mudar o comportamento.
10. Não avançar para a etapa seguinte com gate vermelho.

## Regras arquiteturais não negociáveis

- O Orchestrator é um serviço/camada do sistema; não é um agente comum sentado no Office.
- `Auto` deve usar o menor conjunto suficiente de agentes.
- Agente desativado nunca é elegível para execução automática.
- Equipe dinâmica pode ser composta automaticamente com agentes existentes.
- Agente novo e equipe permanente nunca são criados sem aprovação explícita do usuário.
- Aprendizado pode alterar ranking e preferências; não pode alterar hard policy, permissões ou approvals.
- Toda execução relevante deve ser auditável e versionada.
- Tools só executam dentro das permissões efetivas.
- A permissão efetiva é a interseção entre user/project/team/agent/tool policy.
- Hierarquias de delegação devem ser acíclicas e limitadas por profundidade.
- Eventos visuais devem refletir eventos reais; nunca inventar estado de atividade.
- Provider, Integration e Tool são conceitos diferentes.
- Secrets nunca devem aparecer em SQLite, logs, audit payloads ou UI.
- Todo trabalho com filesystem deve permanecer no project root efetivo.
- Toda execução longa precisa de cancelamento, checkpoint e recovery definidos.

## Convenção de status por etapa

Cada arquivo contém:
- objetivo;
- dependências;
- alterações de domínio/schema;
- serviços e arquivos previstos;
- endpoints/contratos;
- eventos;
- UI;
- testes;
- falhas esperadas;
- critérios de aceite;
- o que explicitamente não fazer;
- checklist de handoff.

Ao concluir uma etapa:
1. atualizar o arquivo da etapa para `DONE`;
2. registrar migrations/PR/gate;
3. atualizar `BUILD_STATUS.md`;
4. registrar decisões que divergiram do plano;
5. somente então iniciar a etapa seguinte.
