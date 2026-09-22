# Agent Office — Build Status

## Checkpoint atual
- Atualizado: 2026-09-22
- Branch estável: `main`
- HEAD após a Fase A: `4f075470`
- Blueprint V2: `docs/EXPERIENCE_V2_UNIVERSAL_API.md`

## V2 — Experience Layer + Universal API

| Fase | Escopo | Status | Evidência |
|---|---|---|---|
| A | Stabilize Desktop | DONE | Windows gate verde: 84/84 testes, typecheck, build client+server, Tauri release, backend runtime direto, instalação MSI, startup do app instalado, SQLite, encerramento do backend e upload do MSI. |
| B | Data Model V2 | NEXT | Providers, provider_models, agents dinâmicos, chat_runs e activity_events. |
| C | Universal Provider Engine | PENDING | ProtocolDriver/AuthDriver/HttpTransport, presets, model discovery e APIs customizadas. |
| D | Chat Runner API-only | PENDING | Chat único, SSE/streaming, single/auto/team, sem ferramentas. |
| E | Experience V2 | PENDING | Office-first, personagens 2D, estados ao vivo, chat central, activity rail e handoffs visuais. |
| F | Provider/Agent Manager | PENDING | UI universal para APIs, vários modelos e agentes configuráveis. |
| G | Hardening | PENDING | Secrets, retries, timeout, cancelamento, rate limits, usage, recovery e release gate final. |
| H | Tools | BLOCKED_BY_SCOPE | Só inicia após aprovação explícita da versão API-only. |

## Fase A — concluída

Entregue:
- Vite ignora `src-tauri/target/**`, eliminando o crash `EBUSY` do watcher no Windows.
- `tauri dev` inicia o stack de desenvolvimento automaticamente via `beforeDevCommand`.
- O servidor local usa loopback, não exposição de rede por padrão.
- O build de servidor agora emite JavaScript de produção em `dist/server`.
- O MSI inclui:
  - frontend Tauri;
  - backend compilado;
  - dependências Node de produção;
  - runtime Node compatível com `better-sqlite3`.
- No app instalado, o Tauri encontra o runtime relativo ao próprio executável, escolhe uma porta loopback livre e inicia o backend automaticamente.
- O frontend resolve dinamicamente a URL do backend pelo runtime Tauri.
- Banco e logs ficam no diretório de dados do aplicativo do usuário, não em `Program Files`.
- `backend.log` registra diagnóstico local de startup.
- Ao fechar o Agent Office, o processo do backend também é encerrado.
- Indicador de runtime local foi adicionado à interface.
- MSI foi instalado e executado em um runner Windows real como parte do gate.

## Gate verificado no GitHub Actions

Workflow: `Phase A Desktop Gate`
Run: `35726810443`

Passou:
- `npm ci`
- `npm test` — 18 arquivos / 84 testes
- `npm run lint`
- `npm run build`
- Rust/Tauri build
- smoke do backend empacotado
- instalação silenciosa do MSI
- abertura do Agent Office instalado
- backend bundled ativo
- inicialização SQLite
- encerramento do desktop + backend sem órfão
- verificação do MSI
- upload do artefato

Artefato:
- nome: `agent-office-phase-a-msi`
- artifact id: `10694365881`
- tamanho do ZIP: 48.418.773 bytes
- SHA-256 do artefato: `2f970606b68550042e017f9f733416a5c44e4f86fdb1c44e2a7934fb198d8f2b`

## V1 legado preservado

A infraestrutura existente continua disponível durante a migração V2:
- SQLite/WAL e projetos;
- conversa persistente;
- memória/FTS/handoffs;
- task orchestration/retry/cancel;
- adapters Kimi, Claude/Gateway e Codex;
- router e Protected Mode;
- usage tracking;
- local tools e testes existentes.

A V2 não considera a UI antiga de Office como experiência final. Ela será substituída progressivamente nas fases B–F.

## Próximo passo
Fase B — Data Model V2.

Objetivo imediato: remover o acoplamento estrutural a `kimi | claude | codex` e criar providers, múltiplos modelos por provider, agentes dinâmicos, chat runs e activity events com migração não destrutiva.
