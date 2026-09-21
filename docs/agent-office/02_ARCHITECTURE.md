# Arquitetura Técnica

## 1. Stack
### Desktop
- Tauri 2

### Frontend
- React
- TypeScript
- Vite
- TanStack Query somente se necessário
- Zustand ou store simples equivalente

### Backend local
Preferência:
- Node.js/TypeScript sidecar/orchestrator

Alternativa:
- lógica Tauri/Rust apenas para operações de sistema quando necessário

### Banco
- SQLite
- migrations versionadas
- WAL mode

### Busca
- SQLite FTS5 no V1

### Streaming
- SSE ou WebSocket local
- preferir SSE quando comunicação for unidirecional de eventos
- WebSocket apenas se realmente necessário

## 2. Componentes
### UI
- ProjectShell
- ChatView
- AgentSidebar
- TaskPanel
- UsageView
- LogsDrawer
- OfficeView
- SettingsView

### Orchestrator
Responsável por:
- classificação da intenção;
- roteamento;
- criação de task;
- montagem de Context Pack;
- execução do adapter;
- streaming;
- retry;
- handoff;
- escalation;
- locking;
- checkpoint;
- persistência.

### Adapters
Interface comum:

```ts
interface AgentAdapter {
  id: "kimi" | "claude" | "codex";
  healthCheck(): Promise<AgentHealth>;
  getCapabilities(): AgentCapabilities;
  getUsage?(): Promise<UsageSnapshot | null>;
  startRun(input: AgentRunInput): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
  resume?(sessionId: string, input: AgentRunInput): AsyncIterable<AgentEvent>;
}
```

Nenhuma lógica de negócio específica do provedor deve escapar do adapter.

## 3. Integração Kimi
Prioridade:
1. Server API/ACP/local interface oficial quando disponível.
2. CLI estruturada como fallback.

Deve:
- detectar instalação;
- detectar autenticação;
- testar conexão;
- criar/retomar sessão quando possível;
- capturar eventos;
- capturar uso quando exposto;
- nunca ler credenciais sensíveis para o frontend.

## 4. Integração Codex
Prioridade:
1. Codex App Server oficial.
2. `codex exec` somente como fallback.

Deve:
- usar login ChatGPT existente;
- ler rate limits/usage se expostos;
- preservar thread/session IDs quando possível;
- capturar approvals;
- suportar cancelamento;
- nunca exigir OpenAI API no V1.

## 5. Integração Claude/Gateway
Como a configuração pode variar:
- implementar primeiro um adapter configurável OpenAI/Anthropic-compatible HTTP **OU** CLI.
- permitir escolher "Gateway API" ou "Claude CLI".

### Gateway API
Configuração local:
- base URL;
- api key armazenada de forma segura;
- auth scheme;
- model id;
- headers opcionais.

Nunca salvar a chave em texto claro em SQLite.
Usar keychain/credential store do sistema via Tauri plugin seguro.

### Claude CLI
- executar processo filho;
- capturar stdout/stderr;
- suportar saída estruturada se disponível;
- não depender de parsing frágil de texto se existir JSON.

## 6. Single Writer Lock
Tabela/estado:
- apenas uma execução com permissão de escrita por projeto;
- reviewers podem operar read-only;
- o lock é liberado em success/failure/cancel/crash recovery.

Se o app crashar:
- no próximo boot verificar lock órfão;
- marcar execução como interrupted;
- pedir/permitir retomada.

## 7. Git
V1:
- usar repositório atual;
- criar checkpoint antes de tarefa de risco médio/alto;
- opcionalmente criar commit local automático somente com opt-in.

Não usar worktrees no V1.

## 8. Segurança
- segredo nunca vai para UI logs;
- mascarar API keys;
- bloquear comandos destrutivos sem aprovação:
  - rm -rf / equivalente;
  - reset --hard;
  - drop database;
  - apagar pasta do projeto;
  - publicar/deploy externo;
  - git push force;
- allowlist/denylist configurável.

## 9. Event Bus
Eventos normalizados:
- run.started
- run.output.delta
- tool.started
- tool.finished
- file.changed
- test.started
- test.finished
- run.warning
- run.error
- run.completed
- run.cancelled
- task.status_changed
- usage.updated
- handoff.created

Salvar eventos essenciais; não salvar ruído infinito.

## 10. Resiliência
- timeout configurável;
- heartbeat;
- cancelamento;
- retry apenas de falhas transitórias;
- idempotency key por task/run;
- deduplicação de eventos;
- crash recovery.
