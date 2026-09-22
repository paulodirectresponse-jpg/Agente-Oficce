# V3.3 — Gap Analysis

**Status:** PLANNED  
**Depende de:** V3.1 + V3.2.  
**Bloqueia:** Proposal Engine e Planner completo.

## Objetivo

Determinar de forma determinística se o Agent Office já possui recursos suficientes para executar uma solicitação e evitar criar agentes/equipes desnecessários.

## Ordem obrigatória de resolução

Para cada requirement:
1. agente ativo adequado;
2. agente inativo adequado (pode gerar sugestão de ativação, não selecionar automaticamente);
3. agente generalista com cobertura suficiente;
4. combinação mínima de agentes ativos;
5. equipe permanente existente;
6. capacidade existe, mas falta tool/integration;
7. capability realmente ausente;
8. gerar `CapabilityGap`.

Não pular diretamente para proposta de agente.

## CapabilityGap

Campos:
- key/domain;
- required_level;
- reason;
- blocking: boolean;
- frequency/history hints;
- candidate alternatives;
- missing_tool/integration quando aplicável;
- confidence;
- discovered_at: preflight | runtime.

## Selection Set Minimization

Problema:
selecionar o menor conjunto de agentes que cubra requirements obrigatórios.

Heurística inicial determinística aceitável:
- eliminar hard blockers;
- ordenar candidatos por coverage/quality/cost;
- greedy set cover;
- pruning final: remover qualquer agente redundante;
- limite de busca/exact search para conjuntos pequenos.

Invariante:
se remover um agente e requirements continuam cobertos, o set não é mínimo e deve ser podado.

## Não confundir gap de capability com gap de tool

Exemplo:
- Agent sabe deploy;
- não há integração Railway;
resultado: `missing_integration`, não criar `Railway Agent`.

Exemplo:
- há browser tool;
- nenhum agente possui `research.web`;
resultado pode ser capability gap.

## Agentes inativos

Nunca selecionar automaticamente.

Pode retornar:
```
resolution = "inactive_agent_available"
suggestion = "ativar X para esta execução?"
```

Ativação persistente requer ação do usuário. Uma futura ativação temporária pode ser adicionada com policy explícita.

## Histórico

Nesta etapa apenas consultar sinais existentes quando disponíveis.
Learning Engine futuro adicionará frequência/performance.

Gap Analysis deve funcionar mesmo sem histórico.

## API/serviço

Preferir serviço interno:
- `GapAnalysisService.analyze(requirements, candidates, policies)`.

Endpoint de debug/admin opcional:
- `POST /api/agent-office/v3/orchestration/gap-analysis`.

## Eventos

- gap.detected;
- gap.resolved_existing_agent;
- gap.resolved_dynamic_team;
- gap.missing_tool;
- gap.missing_capability.

## Testes

Gerar grandes combinações:
- capability coberta por um;
- coberta por dois;
- generalista versus dois especialistas;
- redundant candidate;
- disabled best candidate;
- provider down;
- missing tool;
- inactive specialist;
- permanent team existente;
- zero candidates.

Property:
- disabled nunca selected;
- mandatory uncovered => gap;
- selected set minimal após pruning;
- tool gap não vira agent gap sem evidência.

## Critério de aceite

O sistema consegue explicar:
- “já tenho quem faça”;
- “preciso de 2 agentes existentes”;
- “há especialista inativo”;
- “falta integração/tool”;
- “falta realmente uma capacidade”.

Proposal Engine futuro usa essa saída; não reinventa o diagnóstico.
