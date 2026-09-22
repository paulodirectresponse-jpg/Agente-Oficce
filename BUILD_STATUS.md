# Agent Office — Build Status

## Checkpoint atual
- Atualizado: 2026-09-22
- Branch estável: `main`
- HEAD funcional após a Fase F: `21a4377f`
- Blueprint V2: `docs/EXPERIENCE_V2_UNIVERSAL_API.md`

## V2 — Experience Layer + Universal API

| Fase | Escopo | Status | Evidência |
|---|---|---|---|
| A | Stabilize Desktop | DONE | Runtime desktop, MSI, backend bundled, SQLite e lifecycle validados no Windows. |
| B | Data Model V2 | DONE | Providers dinâmicos, múltiplos modelos, agentes dinâmicos, chat_runs, activity_events e agent_states; migração não destrutiva. |
| C | Universal Provider Engine | DONE | OpenAI Chat/Responses, Anthropic, Gemini, Generic JSON/SSE/NDJSON, auth drivers, presets, discovery e health. |
| D | Chat Runner API-only | DONE | Single/auto/team, contexto/memória, SSE, fallback sem streaming, handoffs, estados/activity, usage e persistência; 104/104 testes + gate Windows verde. |
| E | Experience V2 | DONE | Office-first baseado no visual aprovado, agentes 2D, estados ao vivo, chat compartilhado, Event Stream e handoffs visuais; desktop gate verde. |
| F | Provider/Agent Manager | DONE | UI completa para providers, secrets, health, discovery/catálogo de modelos e agentes dinâmicos configuráveis; desktop gate verde. |
| G | Hardening | NEXT | Secrets, retries, timeout, cancelamento, rate limits, usage, recovery e release gate final. |
| H | Tools | BLOCKED_BY_SCOPE | Só inicia após aprovação explícita da versão API-only. |

## Fase A — concluída
- Vite ignora `src-tauri/target/**` e não quebra com `EBUSY`.
- `tauri dev` sobe frontend + backend automaticamente.
- MSI inclui runtime Node, backend e dependências.
- App instalado inicia o backend em loopback/porta dinâmica.
- Dados e logs ficam no app data do usuário.
- Fechar o app encerra o backend.
- MSI foi instalado e executado em Windows real no CI.

Gate de referência:
- workflow run `35726810443`
- 84/84 testes

## Fase B — concluída
- Migration 4 não destrutiva.
- `providers`, `provider_models`, `agents`, `chat_runs`, `activity_events`, `agent_states`.
- Providers independentes dos agentes.
- Vários modelos por provider.
- Agentes dinâmicos com provider/model/system prompt/avatar/ordem.
- Kimi/Claude/Codex preservados apenas como seeds de compatibilidade.
- Configs legadas são migradas sem apagar projetos, conversas, tasks ou memória.
- API V2 e frontend contracts para o novo modelo.

Gate de referência:
- workflow run `35730087256`
- 88/88 testes

## Fase C — concluída

### Universal Provider Engine
Protocol drivers:
- `openai_chat`
- `openai_responses`
- `anthropic_messages`
- `google_gemini`
- `generic_json`
- `generic_sse`
- `generic_ndjson`

Auth drivers:
- bearer
- x-api-key
- custom header
- query parameter
- basic
- none

Inclui:
- HttpTransport único;
- timeout/cancel por AbortController;
- erros normalizados;
- streaming normalizado;
- model discovery;
- health check + latência;
- upsert de modelos sem duplicação;
- custom request/response templates;
- presets para providers conhecidos e APIs customizadas;
- secrets apenas por referência.

Migration 5 adiciona:
- `auth_config_json`
- `protocol_config_json`
- `timeout_ms`
- `last_health_at`
- `last_health_error`

Gate de referência:
- workflow run `35737431451`
- 98/98 testes

## Fase D — concluída

### Chat Runner API-only
Novo fluxo principal de execução textual:

```
mensagem do usuário
       ↓
target: auto | agente | team
       ↓
agente(s) dinâmicos
       ↓
contexto + memória compartilhada
       ↓
Universal Provider Engine
       ↓
streaming/fallback
       ↓
mensagens + estados + activity + usage
```

### Endpoints
- `POST /api/agent-office/chat/runs`
- `GET /api/agent-office/chat/runs/:runId`
- `GET /api/agent-office/chat/runs/:runId/stream`

O POST retorna imediatamente:
- run id;
- conversation id;
- agentes selecionados;
- modo;
- `tools_enabled: false`.

### Modos
`single`
- agente explícito por id/slug ou `@agente`.

`auto`
- roteamento dinâmico baseado na solicitação e na função/descrição dos agentes disponíveis.
- não depende de nomes fixos Kimi/Claude/Codex.

`team`
- até três agentes;
- sequência textual planner → responder → reviewer quando essas funções existem;
- fallback para equipe de dois agentes quando necessário;
- handoffs explícitos entre os estágios;
- cada estágio persiste sua própria resposta;
- a última resposta é marcada como final.

### Contexto compartilhado
Cada chamada recebe:
- system prompt do agente;
- regras explícitas da fase API-only;
- project summary;
- architecture;
- project rules;
- known issues;
- memória recuperada via FTS;
- histórico recente da conversa;
- handoff/resultado do agente anterior em team mode.

O contexto possui orçamento próprio e histórico antigo não é despejado inteiro.

### Garantia API-only
O system prompt do runtime informa explicitamente:
- sem filesystem;
- sem shell;
- sem browser;
- sem Git;
- sem deploy;
- sem ferramentas externas;
- não pode afirmar que editou arquivos ou executou ações.

O `UniversalProviderEngine` recebe somente mensagens/modelo; nenhuma definição de tool é enviada.

### Streaming
SSE local do Agent Office emite:
- `run.created`
- `agent.state`
- `response.delta`
- `response.streaming_fallback`
- `response.completed`
- `handoff.created`
- `usage.updated`
- `run.completed`
- `run.failed`

O event hub:
- mantém buffer por run;
- possui sequence id;
- permite reconnect com `Last-Event-ID` ou `?after=`;
- retém runs terminais temporariamente;
- envia heartbeat;
- encerra SSE após evento terminal.

### Fallback sem streaming
- se o modelo declara `streaming: false`, usa completion normal;
- se o stream falha antes de emitir texto, tenta completion sem streaming;
- se já houve texto parcial, não dispara uma segunda geração automaticamente, evitando resposta duplicada.

### Persistência
Persistidos:
- mensagem do usuário;
- todas as respostas de agentes;
- root chat run;
- child runs de team mode;
- tokens;
- duração;
- provider/model;
- stage;
- final message id;
- activity events;
- agent states;
- usage snapshots.

Falha de child run em team mode também é persistida como failed.

### Estados para a futura UI
Durante a execução:
- thinking
- planning
- responding
- reviewing
- error
- idle

Cada estado é gravado em `agent_states` e emitido ao vivo no SSE.

### Frontend foundation
Client/types já expõem:
- `startChatRun`
- `getChatRun`
- `getChatStreamUrl`
- `ChatRunReceipt`
- `ChatStartInput`
- `ChatStreamEnvelope`

A tela visual final entra na Fase E.

## Gate verificado da Fase D

Workflow: `Phase A Desktop Gate`
Run: `35739360160`

Passou:
- `npm ci`
- `npm test` — 22 arquivos / 104 testes
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
- artifact id: `10698558043`
- tamanho ZIP: 48.457.936 bytes
- SHA-256: `bd6022080ffe18cf88168518f0c971c79d7692157c4704f03c920bdcdf949aa5`

## Fase E — concluída

### Experience V2
A home do Agent Office agora é o escritório, seguindo a direção visual aprovada:
- sidebar escura com projeto, Office, Chat, Agentes, Providers, Projetos, Uso e Configurações;
- cena central de escritório 2D com três estações em destaque;
- cards flutuantes de agente com estado, atividade e progresso;
- chat compartilhado integrado ao Chat Runner da Fase D;
- seletor Auto / Team / agente específico;
- Event Stream lateral em tempo real;
- handoffs visuais;
- providers e agentes carregados dinamicamente;
- estados offline/idle/resting/thinking/planning/responding/reviewing/waiting/blocked/error;
- layout responsivo;
- experiência API-only mantida, sem habilitar tools.

### Comportamento ao vivo
A interface consome os eventos SSE da Fase D e reflete:
- run criado/concluído/falhou;
- mudança de estado do agente;
- texto em streaming;
- fallback sem streaming;
- handoff;
- usage.

O chat persiste a conversa, sincroniza o histórico e mostra a resposta parcial enquanto o modelo responde.

### Navegação
- Office é a tela padrão.
- Chat reutiliza a mesma experiência com maior ênfase na conversa.
- Agentes e Providers possuem visão V2 de leitura.
- Projetos, Uso e Configurações legados seguem acessíveis dentro do novo shell.
- A edição completa de providers/agentes fica reservada para a Fase F.

### Desktop gate da Fase E
Workflow: `Agent Office Desktop Gate`
Run: `35744561214`

Passou:
- `npm ci`
- `npm test` — 22 arquivos / 104 testes
- `npm run lint`
- `npm run build`
- Rust/Tauri build
- smoke direto do backend empacotado
- instalação real do MSI
- abertura do aplicativo instalado
- backend instalado ativo em loopback
- health request real contra o backend instalado
- inicialização do SQLite
- encerramento do desktop + backend sem órfão
- validação e upload do MSI

Observação de validação:
- o CI valida build/runtime/lifecycle do desktop instalado; inspeção visual pixel-a-pixel continua sendo uma validação humana no seu Windows.

Artefato final da Fase E:
- nome: `agent-office-desktop-msi`
- artifact id: `10702882653`
- tamanho ZIP: 48.456.066 bytes
- SHA-256: `080a0ce60b6d717c568a4d280f4426f3e9abefe31d0bcedc14c260366263468d`

PR da Fase E:
- `#5`
- merge commit: `fc29db57dd14b0e4476a882b87a62e23a1abfc3c`

## Fase F — concluída

### Provider Manager
A tela Providers agora permite:
- criar provider por preset;
- criar provider customizado;
- editar nome, base URL, protocolo, autenticação e timeout;
- ativar/desativar provider;
- inserir/substituir API key sem exibir o valor salvo;
- testar conexão e medir latência;
- descobrir modelos via API;
- adicionar modelos manualmente;
- ativar/desativar modelos;
- definir modelo padrão;
- excluir modelos;
- editar headers/query/auth/protocol config em JSON avançado.

Presets continuam desacoplados do catálogo de modelos e APIs customizadas continuam suportadas.

### Agent Manager
A tela Agentes agora permite:
- criar, editar e excluir agentes;
- nome e slug;
- função/especialidade;
- descrição;
- avatar visual;
- provider;
- modelo;
- system prompt;
- enabled/disabled;
- ordem no escritório;
- idle timeout;
- reordenação por setas.

A seleção provider/model respeita o vínculo correto e só apresenta modelos do provider escolhido.

### Integração com Office V2
- agentes configurados passam a ser usados pelo Chat Runner;
- os três primeiros por ordem são priorizados no Office;
- agentes desativados ficam fora de Auto/Team;
- providers/modelos configurados alimentam diretamente as telas Office e Chat;
- nenhuma tool local foi habilitada.

### API client
O frontend recebeu operações completas para:
- create/update/delete provider;
- create provider from preset;
- save/delete secret;
- health test;
- model discovery;
- create/update/delete model;
- create/update/delete agent.

### Desktop gate da Fase F
Workflow: `Agent Office Desktop Gate`
Run: `35746590373`

Passou:
- instalação de dependências;
- suite de testes;
- typecheck;
- build client/server;
- Rust/Tauri build;
- smoke do backend empacotado;
- instalação do MSI;
- lifecycle do desktop instalado;
- verificação e upload do MSI.

Artefato:
- nome: `agent-office-desktop-msi`
- artifact id: `10703281646`
- tamanho ZIP: 48.471.432 bytes
- SHA-256: `ad1e5239bfc23230f404d9cabffd16e28e98475f678f6176766f971fff496612`

PR da Fase F:
- `#6`
- merge commit: `21a4377f8f51846e5837bc7c3f20cab17abdf61b`

## Compatibilidade V1
Continuam preservados durante a migração:
- projetos;
- conversa persistente;
- memória/FTS/handoffs;
- task orchestration legado;
- adapters legados;
- router/Protected Mode;
- usage;
- local tools.

As tools legadas não são expostas pelo Chat Runner V2 e permanecem fora do escopo até a Fase H.

## Próximo passo
Fase G — Hardening.

Objetivo: preparar a versão API-only para uso contínuo e release: armazenamento de secrets mais robusto, retries/backoff, cancelamento, rate limits, recovery de runs, usage mais completo, validações de segurança e release gate final antes de liberar a Fase H de tools.
