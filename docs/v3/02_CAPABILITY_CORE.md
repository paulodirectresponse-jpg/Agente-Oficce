# V3.1 — Capability Core

**Status:** PLANNED  
**Depende de:** V3.0.  
**Bloqueia:** Orchestrator, Gap Analysis, Teams e Learning.

## Objetivo

Parar de selecionar agentes com base apenas em nome/role/description e criar um catálogo estruturado, extensível e consultável de capacidades.

## Conceitos

### Capability Definition
Identidade canônica de uma capacidade:
- key: `software.frontend.react`;
- label;
- domain;
- parent_key;
- description;
- version/status;
- metadata.

### Agent Capability
Vínculo entre agente e capability:
- agent_id;
- capability_key;
- declared_score;
- verified_score;
- confidence;
- evidence_count;
- source: manual | seed | learned;
- enabled;
- updated_at.

### Model Capability
Capabilities técnicas do modelo:
- tool_calling;
- vision;
- files;
- reasoning;
- context_window etc.

### Tool Capability
O que uma tool permite realizar:
- `filesystem.read`;
- `filesystem.write`;
- `tests.run`;
- `git.diff`;
- `deploy.railway` futuramente.

## Schema

Migration aditiva prevista:
- `capability_definitions`;
- `agent_capabilities`;
- opcional `tool_capabilities` se não couber de forma limpa no registry atual;
- índices por key, agent e domain.

Não duplicar provider model capabilities já existentes; criar adapter/service que normalize metadata atual.

## Serviços novos sugeridos

- `server/agent-office/capabilities/capabilityRepository.ts`
- `capabilityRegistry.ts`
- `agentCapabilityService.ts`
- `capabilityMatcher.ts`
- `capabilitySeeds.ts`

Nomes podem variar; responsabilidades não.

## Seeds

Criar taxonomy seed mínima e extensível:
- software.*;
- marketing.*;
- video.*;
- research.*;
- operations.*;
- data.*;
- design.*;
- security.*;

Não tentar antecipar todas as profissões do futuro.

Capability desconhecida:
- pode ser cadastrada;
- não deve exigir mudança de código.

## Import dos agentes atuais

Migration/seed idempotente pode inferir capabilities iniciais a partir de role/description apenas uma vez.

Marcar:
- `source='seed'`;
- confidence baixa/moderada.

Não tratar inferência textual como verified performance.

## APIs

Endpoints V3 sugeridos:
- `GET /api/agent-office/v3/capabilities`
- `POST /api/agent-office/v3/capabilities`
- `GET /api/agent-office/v3/agents/:id/capabilities`
- `PUT /api/agent-office/v3/agents/:id/capabilities`
- `POST /api/agent-office/v3/capabilities/match` interno/admin

UI normal não precisa expor tudo.

## Agent Manager

Modo simples:
- domínio/função;
- principais capacidades como chips;
- botão para sugestão automática inicial.

Modo avançado:
- scores;
- source;
- verified score;
- confidence/evidence somente leitura quando learned;
- tools relacionadas.

Não permitir usuário falsificar verified evidence pelo campo normal.

## Matching

Entrada:
- required capabilities com importância e mínimo;
- required tools;
- optional capabilities.

Saída:
- coverage;
- missing;
- weighted score;
- hard blockers.

Matcher deve ser determinístico e testável sem LLM.

## Performance

A busca deve funcionar com pelo menos:
- 500 agentes;
- milhares de capability links;
sem varrer prompts completos.

Índices e queries explícitas.

## Testes

- taxonomy parent/child;
- capability desconhecida;
- agent com capability disabled;
- declared vs verified;
- confidence baixa;
- exact match;
- parent match quando permitido;
- child specialist;
- multiple required capabilities;
- required tool ausente;
- 500-agent fixture;
- migration idempotente.

Property tests:
- hard blocker nunca vira match só por score;
- missing mandatory capability nunca é escondida;
- disabled agent nunca aparece em eligible set.

## Critério de aceite

Dada uma lista de requisitos, o core consegue responder:
- quais agentes são elegíveis;
- cobertura de cada um;
- o que falta;
- por que foram eliminados;
sem pedir a uma LLM para interpretar nomes.

## Não fazer

- Não implementar aprendizado estatístico ainda.
- Não criar equipes.
- Não selecionar plano multi-step.
- Não hardcodar capability list em union TypeScript fechada.
