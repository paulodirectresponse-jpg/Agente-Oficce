# Agent Office — Build Status

## Checkpoint atual
- Atualizado: 2026-09-22
- Branch estável: `main`
- HEAD funcional após a Fase B: `a32893b`
- Blueprint V2: `docs/EXPERIENCE_V2_UNIVERSAL_API.md`

## V2 — Experience Layer + Universal API

| Fase | Escopo | Status | Evidência |
|---|---|---|---|
| A | Stabilize Desktop | DONE | Runtime desktop, MSI, backend bundled, SQLite e lifecycle validados no Windows. |
| B | Data Model V2 | DONE | Migration 4 não destrutiva, providers dinâmicos, múltiplos modelos, agentes dinâmicos, chat_runs, activity_events e agent_states; 88/88 testes + gate Windows verde. |
| C | Universal Provider Engine | NEXT | ProtocolDriver/AuthDriver/HttpTransport, presets, discovery de modelos e APIs customizadas. |
| D | Chat Runner API-only | PENDING | Chat único, SSE/streaming, single/auto/team, sem ferramentas. |
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

### Providers
Provider agora é conexão, não agente.
Suporta:
- id/nome independentes;
- `protocol_driver`;
- `auth_driver`;
- `base_url`;
- secret por referência;
- headers/query estruturados;
- enabled;
- health status.

### Vários modelos por provider
`provider_models` suporta:
- model id externo;
- nome amigável;
- capabilities;
- context window;
- max output;
- pricing metadata;
- enabled;
- modelo default;
- múltiplos modelos por provider.

Trocar o default desmarca automaticamente o default anterior.

### Agentes dinâmicos
`agents` não depende mais estruturalmente do union `kimi | claude | codex`.
Cada agente pode ter:
- nome;
- slug;
- função;
- descrição;
- avatar;
- provider;
- modelo;
- system prompt;
- ordem;
- idle timeout;
- metadata;
- enabled.

Binding provider/model é validado para impedir modelo de outro provider.

Os agentes legados Kimi/Claude/Codex são preservados como seeds de compatibilidade, não como limite arquitetural.

### Migração do legado
Configs V1 existentes são migradas automaticamente:
- `provider_configs` -> `providers`;
- modelo legado -> `provider_models`;
- secret continua somente como `secret_ref`;
- projetos/conversas/tasks/memória não são apagados.

Há teste que constrói um banco no schema V3, insere dados legados e abre no schema V4 para provar a migração não destrutiva.

### Runs e atividade
`chat_runs` guarda:
- projeto/conversa;
- agente/provider/modelo;
- single/team/review;
- parent run;
- status;
- tokens;
- erro;
- metadata.

`activity_events` vira a base da futura timeline visual.

`agent_states` guarda o estado atual por agente/projeto:
- run;
- state;
- activity;
- progress;
- updated_at.

### Repositories V2
Criados repositories completos para:
- providers;
- modelos;
- agentes;
- chat runs;
- activity events;
- agent states.

CRUD e regras de integridade cobertos por testes.

### API V2
Namespace:
`/api/agent-office/v2`

Já existem endpoints para:
- providers;
- modelos;
- agentes;
- chat runs;
- activity;
- agent states.

A API V1 continua intacta durante a migração.

O manual agent override legado agora aceita qualquer adapter registrado, em vez de validar apenas três nomes fixos.

### Frontend foundation
Tipos e client methods V2 já existem para:
- providers;
- provider models;
- agents;
- chat runs;
- activity;
- agent states.

Ainda não há a UI final desses dados; isso entra nas fases E/F.

## Gate verificado da Fase B

Workflow: `Phase A Desktop Gate`
Run: `35730087256`

Passou:
- `npm ci`
- `npm test` — 19 arquivos / 88 testes
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
- artifact id: `10694604667`
- tamanho ZIP: 48.431.752 bytes
- SHA-256: `597396637f759feffe96734d7d752e625d89d72fb81dbbb6df87592854e3d318`

## V1 legado preservado
Continuam disponíveis durante a migração:
- SQLite/WAL e projetos;
- conversa persistente;
- memória/FTS/handoffs;
- task orchestration/retry/cancel;
- adapters Kimi, Claude/Gateway e Codex;
- router/Protected Mode;
- usage tracking;
- local tools e testes existentes.

Tools permanecem fora da experiência V2 API-only até a Fase H.

## Próximo passo
Fase C — Universal Provider Engine.

Objetivo: fazer o Agent Office conversar com famílias diferentes de APIs através de drivers, permitir discovery/manual models e suportar providers novos sem acoplar o core a marcas específicas.
