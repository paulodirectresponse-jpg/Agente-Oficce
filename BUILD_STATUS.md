# Agent Office — Build Status

## Checkpoint atual
- Atualizado: 2026-09-22
- Branch estável: `main`
- HEAD funcional após a Fase H: `039093a0`
- Blueprint V2: `docs/EXPERIENCE_V2_UNIVERSAL_API.md`
- Blueprint V3 aprovado: `docs/V3_IMPLEMENTATION_MASTER.md`
- Handbook por etapa: `docs/v3/README.md`
- Status V3: `docs/v3/IMPLEMENTATION_STATUS.md`

## V2 — Experience Layer + Universal API

| Fase | Escopo | Status | Evidência |
|---|---|---|---|
| A | Stabilize Desktop | DONE | Runtime desktop, MSI, backend bundled, SQLite e lifecycle validados no Windows. |
| B | Data Model V2 | DONE | Providers dinâmicos, múltiplos modelos, agentes dinâmicos, chat_runs, activity_events e agent_states; migração não destrutiva. |
| C | Universal Provider Engine | DONE | OpenAI Chat/Responses, Anthropic, Gemini, Generic JSON/SSE/NDJSON, auth drivers, presets, discovery e health. |
| D | Chat Runner API-only | DONE | Single/auto/team, contexto/memória, SSE, fallback sem streaming, handoffs, estados/activity, usage e persistência; 104/104 testes + gate Windows verde. |
| E | Experience V2 | DONE | Office-first baseado no visual aprovado, agentes 2D, estados ao vivo, chat compartilhado, Event Stream e handoffs visuais; desktop gate verde. |
| F | Provider/Agent Manager | DONE | UI completa para providers, secrets, health, discovery/catálogo de modelos e agentes dinâmicos configuráveis; desktop gate verde. |
| G | Hardening | DONE | Secrets criptografados, retries/backoff, cancelamento real, rate/concurrency limits, recovery, usage avançado e release gate final verde. |
| H | Tools + Adaptive Orchestration | DONE (core local) | Tools permissionadas por agente, sandbox de projeto, audit/approvals, tool calling OpenAI-compatible, roteamento adaptativo e fundação de subagentes; gate Windows verde. |

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
- todos os agentes ativos podem aparecer no Office; a sala se reorganiza dinamicamente;
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

## Fase G — concluída

### Secrets endurecidos
- secrets de providers continuam fora do SQLite;
- armazenamento em disco agora usa AES-256-GCM;
- chave mestra local separada do arquivo criptografado;
- escrita atômica;
- permissões restritivas quando suportadas pelo sistema;
- migração automática de `development-secrets.json` plaintext para `secrets.enc.json`;
- arquivo plaintext antigo é removido/renomeado após migração;
- credenciais continuam sem ser retornadas pela API;
- UI permite substituir ou remover a credencial sem revelar o valor salvo.

### Cancelamento real
O Chat Runner V2 agora possui cancelamento fim a fim:
- botão Cancelar no Office;
- endpoint `POST /api/agent-office/chat/runs/:runId/cancel`;
- registry de AbortController por execução;
- AbortSignal chega ao Universal Provider Engine;
- request HTTP em andamento é abortado;
- runs e child runs passam para `cancelled`;
- agentes retornam para `idle`;
- SSE emite `run.cancelled`;
- cancelamento após perda do controller ainda é persistido como terminal.

### Retries e backoff
HttpTransport recebeu política limitada:
- retry automático conservador para GETs de health/discovery;
- status transitórios: 408, 429, 500, 502, 503 e 504;
- backoff exponencial limitado;
- suporte a Retry-After;
- timeout continua independente por tentativa;
- geração POST não é repetida por padrão para evitar cobrança/resposta duplicada;
- retries de geração podem ser habilitados explicitamente por provider.

### Limites por provider
Provider Request Gate adiciona:
- máximo de requests simultâneos por provider;
- intervalo mínimo entre requests;
- fila local;
- cancelamento enquanto aguarda a fila;
- configuração pela tela Providers.

Campos de runtime via `protocol_config`:
- `retry_attempts`
- `retry_backoff_ms`
- `max_concurrent_requests`
- `min_request_interval_ms`

### Recovery depois de reinício
No startup do backend:
- runs V2 deixados em `running/created` são detectados;
- viram `failed` com `RUN_INTERRUPTED_BY_RESTART`;
- metadata registra recovery;
- activity recebe `run.recovered`;
- agentes presos em estados ativos retornam para `idle`;
- recovery é idempotente.

### Usage endurecido
Além de tokens e número de runs:
- custo estimado é calculado quando o model pricing possui input/output por milhão;
- duração média das chamadas é agregada;
- a tela Uso mostra custo estimado e latência média;
- ausência de pricing permanece explícita, sem inventar custo.

### Segurança de transporte
- base URLs são validadas antes de enviar credenciais;
- apenas HTTP/HTTPS são aceitos;
- username/password embutidos na URL são rejeitados;
- secrets são removidos de mensagens de erro de transporte;
- corpo de erro continua truncado;
- auth permanece centralizada no transport.

### Testes novos da Fase G
Cobertura adicionada para:
- secrets criptografados;
- migração de plaintext;
- cancellation registry;
- provider request gate;
- cancelamento em fila;
- cancellation de request HTTP;
- cancelamento completo de chat;
- retry/backoff;
- recovery após restart;
- URL insegura;
- atualização das expectativas legadas de provider secrets.

### Release gate final da versão API-only
Workflow: `Agent Office Desktop Gate`
Run: `35751867387`

Passou:
- `npm ci`;
- `npm test` — 25 arquivos / 114 testes;
- `npm run lint`;
- `npm run build`;
- Rust/Tauri build;
- smoke direto do backend empacotado;
- instalação real do MSI;
- espera robusta pelo backend instalado;
- health real na porta loopback dinâmica;
- SQLite;
- fechamento do desktop;
- backend sem processo órfão;
- verificação do MSI;
- upload do artefato.

Artefato final da Fase G:
- nome: `agent-office-desktop-msi`
- artifact id: `10707535553`
- tamanho ZIP: 48.476.787 bytes
- SHA-256: `0f9491d1efc03b5bd95f2dc6e6650ba0a2466853a45779f47ebdd52e055069e1`

PR da Fase G:
- `#7`
- merge commit: `1ff5a14445d2c629e43b3a0916f16058d4b3ba14`

### Estado da versão API-only
As Fases A–G agora formam uma versão utilizável sem tools:
- desktop instalável;
- Office 2D;
- providers universais;
- vários modelos;
- agentes dinâmicos;
- chat single/auto/team;
- memória compartilhada;
- streaming;
- handoffs;
- gerenciamento visual;
- segurança/resiliência/recovery de runtime.

Tools continuam explicitamente fora do Chat Runner V2 até a Fase H.

## Fase H — concluída (core local)

### Orquestração adaptativa
O modo `Auto` não chama mais uma equipe fixa. Ele avalia a solicitação e usa somente o necessário:
- tarefa simples: normalmente 1 agente especialista;
- tarefa complexa/arquitetural: pode adicionar planner;
- tarefa com validação/revisão/testes: pode adicionar reviewer;
- máximo inicial de 3 agentes por execução automática;
- `Team` explícito continua disponível quando o usuário quer colaboração forçada;
- agentes desativados continuam fora de Auto/Team.

### Agentes ativos e inativos
- o toggle `Agente ativo` ficou visível no fluxo normal de edição;
- agente inativo permanece cadastrado, mas não entra no Office nem é escolhido pelo roteador;
- isso permite manter especialistas raros sem custo/ruído no trabalho cotidiano.

### Tool Registry V2
Tools locais iniciais:
- `list_files`
- `read_file`
- `search_files`
- `write_file`
- `apply_patch`
- `git_status`
- `git_diff`
- `run_tests`
- `run_command` allowlisted

Cada agente possui política independente:
- tools ligadas/desligadas;
- lista de tools permitidas;
- modo de aprovação `safe | manual | auto`;
- orçamento máximo de passos.

Tools ficam desligadas por padrão em novos agentes.

### Segurança
- filesystem restrito à pasta raiz do projeto ativo;
- paths absolutos/escape do root são bloqueados;
- symlink escape é bloqueado;
- arquivos binários e leituras excessivas são bloqueados;
- escrita limitada ao projeto;
- comandos sem shell genérico;
- executáveis permitidos inicialmente: Git, npm e Node;
- comandos Git destrutivos conhecidos são negados;
- timeout, output bounded e AbortSignal;
- cancelamento do chat chega à tool em execução.

### Tool calling
Providers `openai_chat` / OpenAI-compatible podem receber function tools nativas.
O ciclo é:
```
modelo → tool_call → Tool Registry → resultado → modelo → resposta final
```

O responder é o estágio que recebe tools. Planner e reviewer continuam focados em raciocínio, reduzindo ações desnecessárias.

### Aprovações reais
Quando uma tool exige confirmação:
- o run entra em espera;
- o Office mostra um card Aprovar / Negar;
- a execução permanece pausada;
- após aprovação, a mesma tool é executada e o agente continua;
- após negação, o modelo recebe o resultado negado e pode adaptar a resposta;
- aprovação respeita cancelamento e timeout.

### Auditoria
Migration 6 adiciona:
- `agent_tool_policies`
- `tool_audit_events`
- `tool_approvals`
- `agent_relations`

Audit registra ferramenta, risco, status, agente, run e metadados.
Conteúdo bruto de arquivos escritos/lidos não é persistido no audit; são gravados caminhos/tamanhos e resultados resumidos.

### Estados visuais
O Office agora também entende:
- `coding` / Programando
- `testing` / Testando
- `waiting` durante aprovação

Event Stream inclui:
- `tool.started`
- `tool.approval_required`
- `tool.approved`
- `tool.denied`
- `tool.completed`

### Correção do chat travado
Foi corrigido o caso observado no app em que, após a primeira resposta, o composer podia permanecer desabilitado se o evento terminal SSE fosse perdido.
Agora:
- SSE continua como canal principal;
- o frontend reconcilia o status do run por polling durante execução;
- se o run já terminou, o composer é liberado;
- `EventSource.onerror` também consulta o status persistido;
- histórico é sincronizado novamente após término.

### Fundação de subagentes
`agent_relations` permite registrar relações supervisor → subagentes.
A UI já permite configurar essa estrutura nas opções avançadas do agente.

Importante:
- esta fase cria a fundação hierárquica;
- criação autônoma de novos agentes e roteamento recursivo de equipes de subagentes ficam para uma evolução posterior;
- integrações externas específicas como browser/GitHub/deploy entram como novos adapters/tools sobre o mesmo registry, sem precisar refazer o core.

### Gate da Fase H
Workflow: `Agent Office Desktop Gate`
Run: `35762755020`

Passou:
- 26 arquivos / 123 testes;
- typecheck;
- build client/server;
- Rust/Tauri;
- smoke do backend empacotado;
- MSI;
- instalação real no Windows;
- backend instalado + health;
- SQLite;
- shutdown sem processo órfão;
- upload do MSI.

Artefato do gate:
- nome: `agent-office-desktop-msi`
- artifact id: `10710932280`
- tamanho ZIP: 48.494.137 bytes
- SHA-256: `0d56aaf43cfb270f386eeb7e5ef7544b9535556f9af51dfbd8997d26507b0168`

PR da Fase H:
- `#11`
- merge commit: `039093a0df2af385512270a88628900c2d97cec9`

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
Agent Office V3 — Orchestration OS.

O plano V3 foi aprovado e documentado no próprio repositório para permitir continuidade independente da IA/desenvolvedor.

Ordem oficial:
1. V3.0 Foundation Hardening;
2. V3.1 Capability Core;
3. V3.2 Orchestrator Gateway;
4. V3.3 Gap Analysis;
5. V3.4 Execution Graph;
6. V3.5 Durable Runs + Replanning;
7. V3.6 Teams + Subagents;
8. V3.7 Proposal Engine + Agent Factory;
9. V3.8 Evaluation + Learning;
10. V3.9 Dev Chat;
11. V3.10 Office V3;
12. V3.11 Integrations + Production Gate.

Fonte de verdade:
- `docs/V3_IMPLEMENTATION_MASTER.md`
- `docs/v3/README.md`
- `docs/v3/IMPLEMENTATION_STATUS.md`

Próxima etapa a implementar: `docs/v3/01_FOUNDATION_HARDENING.md`.
