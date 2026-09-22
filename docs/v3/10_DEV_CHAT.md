# V3.9 — Dev Chat

**Status:** PLANNED  
**Depende de:** V3.4–V3.8 para funcionalidade completa.  
**Pode iniciar visualmente após:** contratos/eventos do Execution Graph estabilizarem.

## Objetivo

Separar Chat do Office e criar uma workspace operacional estilo Claude Code/Codex, mantendo a conversa como foco e oferecendo inspeção opcional do trabalho ao vivo.

## Regra central

Não reutilizar `OfficeView` com CSS diferente.
Criar componente próprio, por exemplo:
- `src/agent-office/DevChatView.tsx`
- subcomponentes em `src/agent-office/dev-chat/*`.

Office e Dev Chat compartilham API/event bus, não layout.

## Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Project │ Branch │ Orchestrator │ Agents │ Cost │ Run       │
├──────────┬──────────────────────────────┬────────────────────┤
│ RUNS     │                              │ WORKBENCH          │
│ PLAN     │            CHAT              │ Live               │
│ AGENTS   │                              │ Files              │
│ HISTORY  │                              │ Code               │
│          │                              │ Diff               │
│          │                              │ Tests              │
│          │                              │ Terminal           │
│          │                              │ Preview            │
│          │                              │ Artifacts          │
├──────────┴──────────────────────────────┴────────────────────┤
│ Auto/Target   composer                               Send   │
└──────────────────────────────────────────────────────────────┘
```

Workbench é opcional e colapsável.

## Painel esquerdo

Tabs/sections:
- current run;
- plan;
- steps;
- agents;
- run history.

Não precisa ocupar muito espaço por padrão.

## Chat center

Mostrar:
- user messages;
- Orchestrator summary (“usando X/Y”);
- agent responses;
- tool/activity summaries;
- approvals inline;
- final answer.

Não despejar logs brutos no transcript.

## Composer

Obrigatório permanecer editável durante run.

Quando enviar durante execução:
- “Orientar execução atual”;
- “Adicionar à fila”;
- “Interromper e enviar”.

A UX pode usar default sensato, mas estado deve ser explícito.

Persistir queued/orientation messages.

## Workbench tabs

### Live
- current step;
- agent;
- tool;
- activity;
- progress.

### Plan
- DAG/steps;
- status;
- dependencies;
- replan history.

### Files
- project tree segura;
- apenas dentro root.

### Code
- view de arquivo;
- edição manual opcional futura;
- destacar arquivo atual.

### Diff
- run-scoped diff;
- arquivos alterados;
- additions/deletions.

### Tests
- commands gerenciados;
- pass/fail;
- output resumido.

### Terminal Output
- read-only inicialmente;
- mostrar command capability + stdout/stderr bounded.
- não oferecer PowerShell livre.

### Preview
- preview process gerenciado;
- start/stop/status;
- porta dinâmica;
- iframe local.

### Artifacts
- arquivos/entregáveis gerados;
- type/size/path.

## Preview Service

Não usar `run_command` arbitrário.
Criar capability gerenciada:
- preview.start;
- preview.stop;
- preview.status;
- preview.logs.

Process supervisor:
- PID;
- port;
- project;
- health;
- cleanup on close/restart.

## API/event integration

Consumir Event Bus V3.
SSE reconnect + polling reconciliation onde necessário.

Estados devem vir do backend:
- não inventar “editando X” se não existe file/tool event.

## Correção definitiva do composer

Além do watchdog atual:
- UI input state independente de SSE;
- run terminal persisted é authority;
- reconnect safe;
- composer não deve ficar disabled só porque EventSource ainda existe;
- submit durante run cria action explicitamente.

## Acessibilidade/UX

- teclado;
- foco no composer;
- shortcuts configuráveis;
- scroll sem prender usuário no bottom quando ele subiu;
- “jump to latest”;
- responsive;
- workbench close.

## Arquivos previstos

- `src/agent-office/DevChatView.tsx`
- `src/agent-office/dev-chat/RunSidebar.tsx`
- `PlanPanel.tsx`
- `Workbench.tsx`
- `FilesPanel.tsx`
- `CodePanel.tsx`
- `DiffPanel.tsx`
- `TestsPanel.tsx`
- `TerminalPanel.tsx`
- `PreviewPanel.tsx`
- API/types/hooks correspondentes.
- `AgentOfficeApp.tsx` troca Chat route para DevChatView.

## Testes

Component/integration:
- first response then second message;
- SSE disconnect;
- terminal event lost;
- refresh during run;
- queued message;
- orientation;
- cancel;
- switch project;
- workbench collapsed;
- file tree huge;
- diff empty/large;
- preview failed;
- approvals.

E2E Windows:
- typing always works;
- restart/reconnect;
- local preview lifecycle.

## Critério de aceite

Chat é uma experiência claramente diferente do Office, adequada para trabalho técnico, e nunca exige o Office para acompanhar execução.

## Não fazer

- Não embutir shell irrestrito.
- Não duplicar state machine no frontend.
- Não usar OfficeView como base de layout.
