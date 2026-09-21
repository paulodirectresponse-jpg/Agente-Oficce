# Plano de Implementação

## Regra geral
Cada fase:
1. implementar;
2. rodar testes;
3. corrigir;
4. atualizar `BUILD_STATUS.md`;
5. commit opcional/local;
6. só então avançar.

Nunca pular fase silenciosamente.

---

# FASE 0 — Reconhecimento e bootstrap
Objetivo:
Criar base mínima e confirmar ambiente.

Entregas:
- repo;
- Tauri + React + TS;
- SQLite;
- estrutura de pastas;
- logging;
- env/config;
- health page.

Testes:
- app abre;
- backend local responde;
- banco cria migrations;
- restart funciona.

---

# FASE 1 — Persistência local
Objetivo:
Implementar banco e projetos.

Entregas:
- schema;
- repositories;
- migrations;
- criação/listagem de project;
- seleção de pasta;
- validação path;
- detecção Git.

Testes:
- create/read/update project;
- app restart;
- invalid path;
- path com espaços;
- Windows path.

---

# FASE 2 — Chat único
Objetivo:
Criar conversa canônica.

Entregas:
- conversations;
- messages;
- chat UI;
- streaming mock;
- composer;
- persistência.

Testes:
- enviar;
- restart;
- carregar histórico;
- mensagens longas;
- caracteres UTF-8.

---

# FASE 3 — Agent Adapter Framework
Objetivo:
Criar interface comum sem integrar todos ainda.

Entregas:
- AgentAdapter;
- event normalization;
- run manager;
- cancellation;
- mock adapter;
- status lifecycle.

Testes:
- run;
- cancel;
- error;
- reconnect;
- duplicate events.

---

# FASE 4 — Claude/Gateway
Objetivo:
Primeiro agente real, pois será usado para continuar construindo o próprio sistema.

Entregas:
- config segura;
- API/CLI adapter;
- health check;
- streaming;
- model config;
- usage quando disponível;
- logs.

Testes:
- prompt simples;
- erro de credencial;
- timeout;
- resposta longa;
- cancel;
- restart.

---

# FASE 5 — Tasks + loop básico
Objetivo:
Transformar prompt em execução controlada.

Entregas:
- tasks;
- runs;
- statuses;
- retry count;
- max 3 attempts;
- pause/cancel;
- writer lock.

Testes:
- success;
- test failure -> retry;
- 3 failures -> blocked;
- cancel;
- crash recovery.

---

# FASE 6 — Context Pack + memória
Objetivo:
Garantir continuidade entre agentes.

Entregas:
- project memory;
- task memory;
- raw history;
- FTS5;
- context builder;
- summarization checkpoints;
- handoffs.

Testes:
- contexto selecionado;
- troca de agente simulada;
- histórico grande;
- resumo não apaga raw.

---

# FASE 7 — Kimi
Objetivo:
Adicionar executor principal.

Entregas:
- server API/ACP/CLI adapter;
- health;
- session persistence;
- resume quando disponível;
- streaming;
- usage.

Testes:
- run;
- resume;
- cancel;
- tool events;
- context handoff.

---

# FASE 8 — Codex
Objetivo:
Adicionar agente premium.

Entregas:
- App Server integration;
- ChatGPT auth existing;
- thread/session;
- streaming;
- usage/rate limits quando expostos;
- protected mode.

Testes:
- read account;
- run;
- cancel;
- resume/thread;
- protected threshold;
- no API key required.

---

# FASE 9 — Router
Objetivo:
Roteamento automático simples.

Entregas:
- classifier por regras;
- category/risk;
- manual override;
- fallback;
- team mode;
- protected Codex.

Testes:
- UI -> Kimi;
- review -> Claude;
- auth -> Codex;
- Kimi failure -> fallback;
- codex protected.

---

# FASE 10 — Uso
Objetivo:
Painel realista.

Entregas:
- usage snapshots;
- provider metrics;
- local metrics;
- "unknown" states;
- refresh.

Testes:
- provider unavailable;
- stale data;
- partial data;
- no fabricated values.

---

# FASE 11 — UI final
Objetivo:
Tornar utilizável diariamente.

Entregas:
- Workspace polish;
- Tasks;
- Usage;
- Settings;
- Logs drawer;
- responsive desktop;
- empty/error/loading states.

---

# FASE 12 — Office View
Objetivo:
Visão 2D simples.

Entregas:
- 3 mesas;
- estados;
- click agent;
- CSS animation;
- sem 3D.

---

# FASE 13 — Release Gate
Objetivo:
Confiabilidade.

Entregas:
- full test suite;
- integration tests;
- crash recovery;
- persistence;
- installer/build;
- README usuário;
- setup wizard.

Critério:
Fluxo E2E completo com os três agentes.

---

# FASE 14 — Dogfooding
Usar o Agent Office para corrigir o próprio Agent Office.

Executar 5 tarefas reais:
1. UI;
2. bug;
3. feature medium;
4. audit;
5. high-risk planning.

Registrar:
- sucesso;
- falha;
- custo/uso;
- intervenção;
- bugs.

Somente depois considerar V1 estável.
