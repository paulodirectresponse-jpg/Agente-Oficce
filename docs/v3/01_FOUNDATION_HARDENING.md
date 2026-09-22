# V3.0 — Foundation Hardening

**Status:** PLANNED  
**Depende de:** Fase H na `main`.  
**Bloqueia:** todas as etapas V3 posteriores.

## Objetivo

Endurecer o core da Fase H antes de aumentar autonomia. Esta etapa não deve introduzir uma grande mudança visual. O foco é segurança, consistência, idempotência e recovery.

## Problemas a resolver

1. `agent_relations` precisa impedir ciclos e profundidade excessiva.
2. `run_command` é amplo demais; `node` e scripts npm podem virar execução arbitrária.
3. Filesystem deve validar ancestors/junctions/symlinks também em writes de paths ainda inexistentes.
4. Audit/log precisa de redaction centralizada de secrets.
5. Aprovações e tool calls precisam de idempotency keys.
6. Recovery atual transforma runs interrompidas em failed; V3 precisa preparar checkpoint/resume.
7. Tool result/approval replay não pode executar a mesma ação duas vezes.
8. Eventos terminais precisam continuar liberando UI mesmo após reconnect/restart.

## Arquivos atuais que devem ser inspecionados primeiro

- `server/agent-office/localTools.ts`
- `server/agent-office/toolRegistry.ts`
- `server/agent-office/chatRunner.ts`
- `server/agent-office/runtimeRecovery.ts`
- `server/agent-office/runtimeControls.ts`
- `server/agent-office/chatEventHub.ts`
- `server/agent-office/database.ts`
- `server/routes/v2DataRoutes.ts`
- `server/routes/agentOfficeRoutes.ts`
- `src/agent-office/OfficeView.tsx`
- testes correspondentes.

## Alterações de domínio/schema

Adicionar migration nova; não editar migration 6 existente.

Estruturas esperadas:
- `tool_execution_keys` ou idempotency key equivalente em `tool_audit_events`;
- checkpoint metadata para runs ou nova tabela `run_checkpoints`;
- campos para approval expiry/version se necessário;
- índices para pending approvals e recovery.

A implementação pode escolher schema diferente desde que preserve:
- idempotência;
- retomada;
- auditabilidade.

## Command capabilities

Substituir o caminho normal `run_command` por operações explícitas:

- `git_status`
- `git_diff`
- `git_add` (se aprovado pela policy)
- `git_commit` (se aprovado)
- `npm_test`
- `npm_build`
- `npm_install` (alto risco / approval)
- `node_script` somente com script/entrypoint explicitamente permitido

`run_command`:
- manter apenas por compatibilidade;
- default_enabled=false;
- advanced/manual;
- nunca necessário para fluxo normal;
- inputs fortemente validados.

Não permitir shell string genérica.

## Filesystem hardening

Criar uma função única de canonicalização e validação:
- rejeitar absolute paths;
- resolver root real;
- verificar cada ancestor existente;
- rejeitar symlink/junction que escape;
- no write, validar parent real mais próximo antes de criar subdiretórios;
- validar novamente após mkdir e antes de write;
- impedir path separator tricks;
- limitar tamanho;
- rejeitar binário quando operação espera texto.

Todos os filesystem tools devem usar essa função; nada de validação duplicada ad hoc.

## Hierarchy hardening

No repository/service de relações:
- validar parent existe;
- validar child existe;
- rejeitar self relation;
- detectar ciclo antes do commit;
- limitar profundidade inicial configurável, default 2 abaixo do orchestrator;
- operação transacional;
- rollback completo em erro.

Nunca confiar apenas na UI.

## Secret redaction

Criar sanitizer central para:
- provider secret values;
- authorization headers;
- known API key patterns;
- custom secret refs;
- tool stdout/stderr;
- errors;
- audit input/result;
- activity detail.

Audit deve preferir metadata resumida:
- path;
- bytes;
- exit code;
- command capability;
- duração;
não conteúdo sensível.

## Idempotência

Toda tool invocation executável precisa de:
- `run_id`;
- `step/attempt`;
- `tool_call_id`;
- derived idempotency key.

Antes de executar:
- completed => reutilizar resultado resumido;
- running antigo => reconciliar;
- pending approval => reutilizar approval;
- denied => devolver denied;
- nunca repetir side effect silenciosamente.

## Recovery foundation

Não implementar ainda todo o scheduler da V3.5, mas preparar:
- checkpoint consistente antes de side effects;
- status distinguindo `waiting_approval`, `running_tool`, `waiting_provider`;
- recovery service capaz de classificar runs interrompidas em resumable vs non-resumable;
- V2 behavior pode continuar falhando runs sem checkpoint.

## Eventos

Garantir IDs/sequence consistentes para:
- tool.started;
- tool.completed;
- tool.failed;
- approval.requested;
- approval.resolved;
- run.recovered;
- run.cancelled.

## Testes obrigatórios

Unit/adversarial:
- path traversal;
- absolute path;
- nested symlink;
- Windows junction;
- non-existing child under symlink ancestor;
- binary/oversize;
- duplicate tool call;
- duplicate approval resolve;
- stale approval;
- cancel during approval;
- cancel during tool;
- command capability allow/deny;
- node/npm abuse cases;
- secret in stdout/error/input;
- A→B→C→A cycle;
- depth overflow;
- transaction rollback.

Regression:
- todos os 123 testes atuais ou mais;
- chat pós-primeira resposta;
- provider health;
- Agent Manager;
- Office event stream.

## Critério de aceite

- Nenhum teste existente quebra sem decisão documentada.
- Nenhum side effect é executado duas vezes por replay/reconnect.
- Ciclos de agentes são impossíveis pela API.
- `run_command` não é caminho normal.
- Filesystem mantém confinamento ao root.
- Audit/log não expõe secret conhecido nos casos testados.
- Recovery foundation está pronta para V3.5.

## Não fazer

- Não criar Orchestrator ainda.
- Não criar Teams ainda.
- Não adicionar novas integrações externas.
- Não reescrever Tool Registry inteiro.
- Não mudar visual do Office sem necessidade.

## Handoff

Ao concluir, registrar:
- migration;
- novos command capabilities;
- invariantes implementadas;
- testes adicionados;
- gate/PR;
- eventuais riscos restantes.
