# Agent Office V2 — Experience Layer + Universal API Core

## Objetivo
Transformar o Agent Office de um painel técnico em um escritório 2D vivo, com chat central, agentes visíveis e estado em tempo real. Nesta etapa, agentes usam APIs apenas para responder e colaborar em texto. Ferramentas locais, edição de código, browser, deploy e automação do computador ficam desativadas por padrão e serão adicionadas numa etapa posterior sobre a mesma arquitetura.

## Princípios
1. Office-first: a tela principal é o escritório, não o formulário de projetos.
2. Chat-first: o usuário fala naturalmente; categorias, risco e roteamento ficam internos.
3. Estado verdadeiro: a UI só mostra estados derivados de eventos reais.
4. API-first: nesta fase, nenhum provider recebe ferramentas locais.
5. Provider-agnostic: agentes não são hardcoded a Kimi/Claude/Codex.
6. Multi-modelo: um provider pode expor vários modelos e cada agente escolhe um.
7. Extensível: novos protocolos, autenticações e providers entram por drivers, sem alterar o core.
8. Local-first: credenciais e memória ficam locais.
9. Compatibilidade: preservar projetos, conversas, memória e tasks existentes.
10. Ferramentas como capability futura: o core de chat não depende de filesystem/shell/git.

---

## 1. Experiência do produto

### 1.1 Tela principal — Office
A aplicação deve abrir diretamente no Office.

Layout:
- sidebar compacta;
- header com projeto ativo, provider/modelo atual e status global;
- escritório 2D ocupando a área principal;
- chat persistente na parte inferior/central;
- activity rail lateral com timeline de eventos;
- drawer de detalhes opcional.

### 1.2 Escritório 2D
Cada agente possui:
- personagem/avatar 2D;
- mesa;
- cadeira;
- monitor;
- nome;
- função;
- provider/modelo;
- indicador de estado;
- tarefa ou mensagem atual resumida.

Estados visuais suportados:
- offline
- idle
- resting
- thinking
- planning
- responding
- coding
- testing
- reviewing
- waiting
- blocked
- error

Na fase API-only, os estados normais serão:
offline, idle, resting, thinking, planning, responding, reviewing, waiting, blocked, error.

coding/testing existem no state machine para a futura fase de tools.

### 1.3 Regras visuais
- idle: sentado, monitor neutro;
- resting: animação leve após período de inatividade;
- thinking/planning: pensamento/progresso;
- responding: monitor ativo e indicador de streaming;
- reviewing: documento/ícone de revisão;
- waiting: aguardando outro agente/usuário;
- blocked: alerta visível;
- error: estado de falha;
- handoff: animação/linha entre agentes e evento na timeline.

Não usar 3D. Personagens devem ser SVG/CSS leves e escaláveis.

### 1.4 Chat único
O chat é o centro operacional.

Deve permitir:
- mensagem normal -> Auto;
- @nome-do-agente;
- @team;
- seleção rápida de agente;
- seleção de projeto;
- seleção opcional de modelo;
- streaming;
- respostas de vários agentes na mesma conversa;
- mostrar quem está respondendo;
- mostrar handoffs;
- mostrar resumo do que cada agente está fazendo;
- histórico persistente.

A UI não deve exigir título, categoria ou risco para uma mensagem comum.

### 1.5 Activity Rail
Eventos legíveis, não logs crus:
- "Kimi está pensando"
- "Claude recebeu o contexto"
- "Claude está revisando"
- "Resposta concluída"
- "Provider indisponível"
- "Handoff Kimi -> Claude"

Logs técnicos completos ficam em drawer avançado.

---

## 2. Modelo de domínio V2

### 2.1 Provider
Provider é uma conexão de API.

Campos principais:
- id
- name
- protocol_driver
- base_url
- auth_driver
- secret_ref
- headers_json
- query_json
- enabled
- health_status
- created_at
- updated_at

Providers não possuem apenas um modelo.

### 2.2 ProviderModel
Tabela separada de modelos.

Campos:
- id
- provider_id
- model_id
- display_name
- capabilities_json
- context_window
- max_output_tokens
- pricing_json
- metadata_json
- enabled
- is_default
- created_at
- updated_at

Modelos podem ser:
- descobertos automaticamente;
- adicionados manualmente;
- importados de preset.

### 2.3 Agent
Agentes deixam de ser union hardcoded.

Campos:
- id
- name
- slug
- role
- description
- avatar_key
- provider_id
- model_id
- system_prompt
- enabled
- sort_order
- idle_after_seconds
- metadata_json

Os agentes iniciais podem continuar Kimi, Claude e Codex, mas serão registros editáveis.

### 2.4 AgentState
Estado efêmero + eventos persistidos:
- agent_id
- project_id
- run_id
- state
- activity
- progress
- updated_at

A fonte de verdade em runtime é um AgentStateService.
Mudanças relevantes também viram activity_events.

### 2.5 ChatRun
Execução textual não deve depender de Task.

Campos:
- id
- conversation_id
- project_id
- agent_id
- provider_id
- model_id
- status
- mode: single | team | review
- parent_run_id
- started_at
- ended_at
- input_tokens
- output_tokens
- error_json
- metadata_json

### 2.6 ActivityEvent
Barramento unificado da UI:
- id
- project_id
- conversation_id
- run_id
- agent_id
- type
- severity
- title
- detail
- payload_json
- created_at

---

## 3. Universal API Core

### 3.1 Camadas
Agent -> ModelBinding -> Provider -> ProtocolDriver -> HttpTransport

Nenhuma camada de UI conhece endpoint específico de fornecedor.

### 3.2 Protocol Drivers
Core deve suportar:

1. openai_chat
   /v1/chat/completions e compatíveis.

2. openai_responses
   Responses-style APIs.

3. anthropic_messages
   /v1/messages.

4. google_gemini
   generateContent / streamGenerateContent.

5. generic_json
   driver configurável para APIs REST não cobertas.

6. generic_sse
   variante configurável com streaming SSE.

7. generic_ndjson
   streaming linha-a-linha.

Drivers adicionais podem ser plugins futuros.

### 3.3 Providers que podem usar OpenAI-compatible
Presets podem cobrir sem adapter novo:
- OpenAI compatível
- OpenRouter
- Groq
- xAI
- DeepSeek
- Moonshot/Kimi API
- Together
- Fireworks
- Mistral quando usando endpoint compatível
- Cerebras
- Perplexity
- serviços self-hosted compatíveis
- proxies/gateways compatíveis

### 3.4 Providers nativos
Presets/drivers próprios:
- Anthropic
- Google Gemini
- Azure OpenAI
- Ollama/local
- custom

### 3.5 Auth Drivers
- bearer
- x-api-key
- custom_header
- query_param
- basic
- none

Arquitetura deve permitir depois:
- OAuth2
- service account
- AWS SigV4
- auth específica de plugin

### 3.6 Generic API
Para cobrir APIs desconhecidas sem mudar o core:
- endpoint path;
- HTTP method;
- headers;
- query;
- request template;
- caminho JSON da resposta;
- caminho de usage;
- streaming mode;
- parser mapping;
- health endpoint;
- models endpoint opcional.

Segredos nunca entram nos templates persistidos.

### 3.7 Model Discovery
ProviderDriver pode implementar listModels().

Fluxo:
1. tentar discovery;
2. normalizar modelos;
3. permitir ativar/desativar;
4. permitir adicionar modelo manual;
5. armazenar capabilities;
6. escolher default;
7. testar modelo individualmente.

### 3.8 Capabilities por modelo
Estrutura:
- text
- vision
- audio_input
- audio_output
- files
- streaming
- json_mode
- tool_calling
- reasoning
- system_prompt
- temperature
- max_output_tokens
- context_window

Nesta fase somente text/streaming/reasoning/system_prompt serão usados de forma funcional.

---

## 4. Chat API-only

### 4.1 Endpoint
POST /api/agent-office/chat/runs

Entrada:
- project_id
- conversation_id opcional
- message
- target: auto | agent_id | team
- model_override opcional

Saída imediata:
- run_id
- conversation_id
- selected_agent(s)

### 4.2 Streaming
GET /api/agent-office/chat/runs/:runId/stream

SSE:
- run.created
- agent.state
- response.delta
- response.completed
- handoff.created
- usage.updated
- run.failed
- run.completed

### 4.3 Sem ferramentas
Feature flag global:
tools_enabled = false

O universal chat runner nunca chama localTools nesta fase.

Adapters legados com tools continuam disponíveis para compatibilidade, mas não são usados pela experiência V2.

### 4.4 Contexto
ContextBuilder recebe:
- system prompt do agente;
- project memory;
- mensagens recentes;
- retrieved memory;
- handoff, se houver;
- mensagem atual.

Não despejar histórico inteiro.

### 4.5 Team Mode
Primeira versão:
- planner opcional;
- responder principal;
- reviewer opcional;
- resultado final consolidado.

Tudo em texto; sem ferramentas.

---

## 5. Provider Manager UI

Tela Configurações > Providers:
- lista de providers;
- adicionar provider;
- presets;
- Custom API;
- base URL;
- auth;
- secret;
- headers avançados;
- Testar conexão;
- Descobrir modelos;
- lista de modelos;
- habilitar/desabilitar;
- definir nome amigável;
- capabilities;
- modelo default.

Tela Configurações > Agents:
- adicionar/remover/reordenar agente;
- nome/avatar/função;
- provider;
- modelo;
- system prompt;
- comportamento;
- estado online/offline.

---

## 6. Arquitetura de runtime

### 6.1 Desktop
O app instalado precisa iniciar:
1. UI Tauri;
2. backend local;
3. banco;
4. event bus;
5. provider manager.

O MSI atual não deve depender de o usuário abrir npm run dev.

### 6.2 Curto prazo
Corrigir:
- Vite ignorar src-tauri/target/**;
- beforeDevCommand iniciar dev server;
- backend local iniciar automaticamente no modo desktop.

### 6.3 Distribuição
Etapa inicial aceita Node instalado localmente.
Etapa posterior empacota runtime/sidecar para MSI totalmente independente.

---

## 7. Ferramentas — próxima macrofase

Somente após aprovação do API-only.

### 7.1 Tool Registry
- id
- capability
- permissions
- risk
- schema
- executor
- availability

### 7.2 Primeiras tools
- filesystem
- shell
- git
- GitHub
- tests
- browser
- HTTP
- deploy

### 7.3 Segurança
- sandbox por projectRoot;
- approval gates;
- allowlists;
- deny destructive;
- audit;
- budgets;
- timeout;
- cancellation.

### 7.4 GitHub
Primeiro:
- git local autenticado.

Depois:
- GitHub API para PR/issues/actions/release.

---

## 8. Fases de implementação

### Fase A — Stabilize Desktop
- corrigir Vite watcher;
- corrigir Tauri dev startup;
- garantir backend junto do desktop;
- health visível.

Critério: um comando/atalho abre o app e a UI funciona.

### Fase B — Data Model V2
- migrations;
- providers;
- provider_models;
- agents;
- chat_runs;
- activity_events;
- repositories/services.

Critério: CRUD testado e migração não destrutiva.

### Fase C — Universal Provider Engine
- ProtocolDriver;
- AuthDriver;
- HttpTransport;
- presets;
- model discovery;
- test connection;
- chat completion/streaming.

Critério: mock tests de cada protocol family.

### Fase D — Chat Runner API-only
- chat endpoint;
- SSE;
- persistence;
- shared context;
- single/auto/team;
- tools OFF.

Critério: conversa real com pelo menos 3 protocol families.

### Fase E — Experience V2
- Office-first;
- personagens;
- mesas;
- estados;
- chat central;
- activity rail;
- handoffs;
- project header;
- model/agent selectors.

Critério: acompanhar visualmente uma execução do começo ao fim.

### Fase F — Provider/Agent Manager
- UI universal;
- multi-model;
- custom API;
- model discovery;
- agent editor.

Critério: adicionar provider e modelo sem alterar código.

### Fase G — Hardening
- secrets;
- retries;
- circuit breaker;
- rate limit;
- timeout;
- cancellation;
- usage;
- errors amigáveis;
- restart;
- MSI.

Critério: release gate completo.

### Fase H — Tools
Somente após aprovação explícita do API-only.

---

## 9. O que NÃO fazer
- não hardcodar novos providers em AgentId;
- não exigir Task para conversar;
- não expor categoria/risco no fluxo comum;
- não executar tools na fase API-only;
- não armazenar API keys no SQLite;
- não fingir estado visual;
- não marcar provider como online sem health real;
- não depender do Kimi/Claude/Codex como nomes fixos;
- não reescrever a memória existente sem migração.

---

## 10. Critério de V2 API-only pronta
1. App instalado abre sozinho.
2. Office é a home.
3. Há personagens/agentes visíveis.
4. Estado muda em tempo real.
5. Chat central funciona.
6. Um provider pode ter vários modelos.
7. Agente escolhe provider+modelo.
8. OpenAI-compatible funciona.
9. Anthropic funciona.
10. Gemini funciona.
11. Custom API funciona.
12. Streaming funciona quando suportado.
13. Sem streaming, fallback funciona.
14. Team/handoff textual funciona.
15. Memória persiste após restart.
16. API keys não aparecem em logs/SQLite.
17. Tools estão desligadas.
18. UI acompanha toda a execução.
19. Uso/tokens são registrados quando provider fornece.
20. Nenhum provider/modelo precisa ser adicionado ao core para a maioria dos casos.
