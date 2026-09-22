# V3.11 — Integration Registry + Production Gate

**Status:** PLANNED  
**Depende de:** todo core V3 anterior.  
**Objetivo:** abrir integrações externas de forma modular e fechar release V3 com gates de segurança, stress e Windows.

## Separação obrigatória

### LLM Provider
Fornece modelo.
Ex.: UseOneAI/OpenAI/Anthropic/Gemini.

### Integration
Conexão com sistema externo.
Ex.: GitHub, Railway, Supabase, Browser.

### Tool
Ação/capability exposta.
Ex.: github.create_pr, railway.deploy.

Não misturar credentials/model config com integration config.

## Integration Registry

Estruturas:
- `integration_connections`;
- `integration_capabilities`;
- secret_ref externo ao SQLite;
- health;
- enabled;
- scopes;
- metadata;
- created_at/updated_at.

Drivers/adapters:
- connect/auth;
- health;
- list capabilities;
- execute tool;
- normalize error;
- idempotency support.

## Primeiras integrações alvo

Implementar incrementalmente, não todas de uma vez:
1. GitHub;
2. Browser/HTTP controlado;
3. deploy (Railway quando escolhido);
4. Supabase/database;
5. outras conforme necessidade.

Cada integração precisa de proposal/tool policy própria.

## Tool calling multi-protocol

Expandir tool loop V3 para:
- openai_chat;
- openai_responses;
- anthropic_messages;
- google_gemini.

Cada model record declara:
- tool_calling true/false;
- smoke status;
- tool schema constraints.

Não assumir tool calling só por protocol family.

## External action approvals

Classificar:
- read;
- write;
- execute;
- external;
- destructive.

External mutations importantes:
- create repo;
- push;
- deploy;
- DB migration;
- send/publish;
devem respeitar policy/approval.

## Security tests

Obrigatórios:
- path traversal;
- nested symlink/junction;
- command injection;
- node/npm abuse;
- secret in input/stdout/error;
- prompt injection from file/web;
- cross-project file;
- cross-project memory;
- cross-team permission;
- approval replay;
- integration replay;
- duplicate deploy;
- agent delegation cycle;
- tool loop infinite;
- replan infinite;
- provider/tool mismatch.

## Stress suites

Targets:
- 100k routing;
- 50k team composition;
- 50k agent proposals;
- 50k team proposals;
- 50k DAGs;
- 50k hierarchy mutations;
- 100k learning updates;
- 100k permission combinations;
- 50k recovery transitions;
- 50k scheduling/concurrency.

Nightly opcional:
- 1M+ synthetic cases.

Sem gastar provider pago nos property tests.

## Scale tests

- 1/3/10/30 agents ativos;
- 100/500 catalogued;
- 1/10/50 teams;
- large event history;
- long conversation;
- many artifacts;
- provider degradation.

## Chaos

Kill runtime durante:
- planning;
- model generation;
- file read;
- file write;
- tests;
- approval;
- handoff;
- integration request;
- replan;
- evaluation.

Recovery esperado documentado por caso.

## Migration/upgrade gate

Testar:
- fresh DB;
- DB vindo de V2/H atual;
- projects preservados;
- providers/secrets preservados;
- agent settings;
- conversations;
- memory;
- tool policies;
- approvals/audit;
- root folder settings.

Nunca exigir reset do usuário.

## Windows/Tauri gate

Obrigatório:
- npm ci;
- full test suite;
- typecheck;
- frontend/server build;
- Rust/Tauri build;
- bundled backend smoke;
- MSI existence;
- upgrade MSI sobre versão instalada;
- fresh install;
- dynamic loopback health;
- SQLite/migrations;
- run/recovery smoke;
- shutdown sem backend órfão;
- artifact upload.

## Release blockers

Não lançar se houver:
- criação permanente sem approval;
- hierarchy cycle;
- permission escalation;
- project root escape;
- secret leak;
- duplicate side effect conhecido por replay;
- dependency ordering violation;
- unresolved migration data loss;
- composer lock bug;
- crash recovery inconsistente em estado suportado.

## Observabilidade

Release deve registrar:
- build/version;
- migration version;
- orchestration errors;
- recovery events;
- proposal events;
- tool/integration errors;
sem secrets.

## Artefato final

Version bump real, ex. V3 semantic version definida na época.
Gerar MSI de update.
Registrar SHA-256, workflow, artifact id e PR no BUILD_STATUS.

## Critério de aceite

V3 somente marcada DONE quando core, integrations iniciais escolhidas e todos os gates aplicáveis estiverem verdes em Windows real de CI e smoke instalado.
