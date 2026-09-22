# Agent Office — Build Status

## Checkpoint atual
- Atualizado: 2026-09-22
- Branch estável: `main`
- HEAD funcional após a Fase C: `1827d514`
- Blueprint V2: `docs/EXPERIENCE_V2_UNIVERSAL_API.md`

## V2 — Experience Layer + Universal API

| Fase | Escopo | Status | Evidência |
|---|---|---|---|
| A | Stabilize Desktop | DONE | Runtime desktop, MSI, backend bundled, SQLite e lifecycle validados no Windows. |
| B | Data Model V2 | DONE | Providers dinâmicos, múltiplos modelos, agentes dinâmicos, chat_runs, activity_events e agent_states; migração não destrutiva. |
| C | Universal Provider Engine | DONE | OpenAI Chat/Responses, Anthropic, Gemini, Generic JSON/SSE/NDJSON, auth drivers, presets, discovery e health; 98/98 testes + gate Windows verde. |
| D | Chat Runner API-only | NEXT | Chat único, SSE/streaming, single/auto/team, sem ferramentas. |
| E | Experience V2 | PENDING | Office-first, personagens 2D, estados ao vivo, chat central, activity rail e handoffs visuais. |
| F | Provider/Agent Manager | PENDING | UI universal para APIs, vários modelos e agentes configuráveis. |
| G | Hardening | PENDING | Secrets, retries, timeout, cancelamento, rate limits, usage, recovery e release gate final. |
| H | Tools | BLOCKED_BY_SCOPE | Só inicia após aprovação explícita da versão API-only. |

## Fase A — concluída
- Vite ignora `src-tauri/target/**` e não quebra com `EBUSY`.
- `tauri dev` sobe frontend + backend automaticamente.
- MSI inclui runtime Node, backend e dependências.
- App instalado inicia o backend em loopback/porta dinâmica.
- Dados e logs ficam no app data do usuário.
- Fechar o app encerra o backend.
- MSI foi instalado e executado em Windows real no CI.

Gate de referência da Fase A:
- workflow run `35726810443`
- 84/84 testes
- artifact `10694365881`

## Fase B — concluída

### Schema V2
Migration `4` adiciona sem destruir o legado:
- `providers`
- `provider_models`
- `agents`
- `chat_runs`
- `activity_events`
- `agent_states`

### Providers/modelos/agentes
- Provider é conexão independente do agente.
- Um provider pode ter vários modelos.
- Modelos carregam capabilities, contexto, max output, pricing metadata, enabled/default.
- Agentes têm nome, slug, função, avatar, provider, modelo, system prompt, ordem e metadata.
- Binding provider/model é validado.
- Kimi/Claude/Codex seguem como seeds de compatibilidade, não como limite arquitetural.

### Migração do legado
- `provider_configs` -> `providers`.
- modelo legado -> `provider_models`.
- secrets continuam apenas como `secret_ref`.
- projetos, conversas, tasks e memória são preservados.
- teste específico valida migração de schema V3 para V4 sem perda.

### Runtime V2
- `chat_runs` guarda execuções textuais.
- `activity_events` alimentará a timeline visual.
- `agent_states` guarda estado/atividade/progresso atual.
- CRUD e endpoints V2 já existem.

Gate da Fase B:
- workflow run `35730087256`
- 19 arquivos / 88 testes
- MSI e lifecycle Windows verdes.

## Fase C — concluída

### Migration 5
Providers passam a persistir configuração de runtime universal:
- `auth_config_json`
- `protocol_config_json`
- `timeout_ms`
- `last_health_at`
- `last_health_error`

A migration é aditiva e preserva o schema/dados anteriores.

### Protocol drivers
O novo `UniversalProviderEngine` suporta:

1. `openai_chat`
   - Chat Completions e APIs OpenAI-compatible.
   - streaming SSE.
   - usage normalizado.
   - model discovery estilo `/v1/models`.

2. `openai_responses`
   - Responses API.
   - instructions + input.
   - streaming por eventos.
   - usage normalizado.
   - model discovery.

3. `anthropic_messages`
   - Messages API.
   - system separado da conversa.
   - streaming SSE.
   - usage.
   - model discovery.

4. `google_gemini`
   - `generateContent`.
   - `streamGenerateContent`.
   - systemInstruction.
   - usageMetadata.
   - model discovery e token limits.

5. `generic_json`
   - request template configurável.
   - response path configurável.
   - usage paths configuráveis.

6. `generic_sse`
   - streaming SSE configurável por paths JSON.

7. `generic_ndjson`
   - streaming NDJSON configurável por paths JSON.

Isso cobre APIs conhecidas diretamente e permite cadastrar APIs REST novas sem alterar o core na maioria dos casos.

### Auth drivers
Implementados:
- `bearer`
- `x-api-key`
- `custom_header`
- `query_param`
- `basic`
- `none`

Secrets nunca entram no provider JSON persistido; o provider guarda apenas `secret_ref`.

### HttpTransport
Camada única de transporte:
- merge de headers/query;
- autenticação centralizada;
- JSON request/response;
- streaming;
- timeout via AbortController;
- HTTP/network/JSON errors normalizados;
- corpo de erro limitado;
- sem incluir secret nas mensagens de erro.

### Generic API templates
Custom providers podem mapear:
- base URL;
- endpoint;
- método;
- request template;
- modelo;
- mensagens;
- system prompt;
- último prompt;
- response text path;
- usage paths;
- error path;
- health path;
- models path;
- model id/display name paths;
- SSE ou NDJSON.

### Presets
Presets iniciais:
- OpenAI
- OpenAI-compatible
- Anthropic
- Google Gemini
- OpenRouter
- Groq
- xAI
- DeepSeek
- Moonshot/Kimi
- Together AI
- Fireworks AI
- Mistral
- Cerebras
- Ollama local
- Custom JSON
- Custom SSE
- Custom NDJSON

Presets não hardcodam catálogo/preços de modelos.

### Model discovery
`discoverModels()`:
- consulta o endpoint do provider;
- normaliza ids/nomes/capabilities/limites;
- faz upsert;
- não duplica modelos em discoveries repetidos;
- preserva metadata manual;
- marca origem de discovery;
- mantém apenas um default.

### Health
`testConnection()`:
- executa health/model-list real;
- mede latência;
- persiste `healthy/unavailable`;
- persiste timestamp e erro sanitizado;
- informa se model discovery está disponível.

### API V2 da Fase C
Além do CRUD da Fase B:
- `GET /api/agent-office/v2/provider-engine/capabilities`
- `POST /api/agent-office/v2/providers/from-preset`
- `POST /api/agent-office/v2/providers/:providerId/secret`
- `DELETE /api/agent-office/v2/providers/:providerId/secret`
- `POST /api/agent-office/v2/providers/:providerId/test`
- `POST /api/agent-office/v2/providers/:providerId/discover-models`

O frontend client já possui métodos/tipos para capabilities, health e discovery.

### Escopo mantido
A Fase C implementa o motor de chamada/streaming, mas ainda não conecta isso ao chat principal. Essa orquestração entra na Fase D.

Nenhuma tool local é disponibilizada ao Universal Provider Engine nesta fase.

## Gate verificado da Fase C

Workflow: `Phase A Desktop Gate`
Run: `35737431451`

Passou:
- `npm ci`
- `npm test` — 20 arquivos / 98 testes
- `npm run lint`
- `npm run build`
- Rust/Tauri build
- smoke do backend empacotado
- instalação MSI
- startup do app instalado
- SQLite
- encerramento sem backend órfão
- MSI validado
- upload do artefato

Artefato:
- nome: `agent-office-phase-a-msi`
- artifact id: `10698375748`
- tamanho ZIP: 48.436.728 bytes
- SHA-256: `b46b3a079f5cbeae9ae1e645806a40e7ad930ead8994e68aa0d144e0becb2770`

## Compatibilidade V1
Continuam disponíveis durante a migração:
- projetos;
- conversa persistente;
- memória/FTS/handoffs;
- task orchestration/retry/cancel;
- adapters legados Kimi/Claude/Codex;
- router/Protected Mode;
- usage tracking;
- local tools.

Tools permanecem fora da experiência V2 API-only até a Fase H.

## Próximo passo
Fase D — Chat Runner API-only.

Objetivo: ligar conversa + agentes dinâmicos + Universal Provider Engine + streaming + activity/state em um fluxo de chat único, com modos single/auto/team e sem qualquer ferramenta local.
