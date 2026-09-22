# Agent Office — Guia do Usuário

Agent Office é um orquestrador local de agentes de IA (Kimi, Claude/Gateway e Codex) para os seus projetos. Tudo roda no seu PC: o banco (SQLite), a memória compartilhada entre agentes e o histórico canônico das conversas.

## Requisitos

- Node.js 20+ e npm
- Windows 10/11 (WebView2 Runtime — já vem no Windows 11)
- (Opcional) Rust + toolchain MSVC para gerar o instalador desktop (Tauri): https://rustup.rs
- (Opcional) CLI do Codex instalada e logada (`codex` no PATH, login ChatGPT)

## Começando (modo desenvolvimento)

```bash
npm install
npm test          # suite completa (83 testes)
npm run dev       # frontend (5173) + backend (3001)
```

Abra http://localhost:5173 — você verá o Agent Office.

## Configurando os agentes

Em **Configurações** (ou via API):

1. **Kimi (Moonshot Server API)**: `base_url` = `https://api.moonshot.ai/v1`, `model` = `kimi-k2-0905-preview`, `api_key` da plataforma Moonshot.
2. **Claude/Gateway**: `base_url` e `api_key` do seu gateway compatível com a API Anthropic (`auth_scheme`: bearer, x-api-key ou custom).

As chaves ficam fora do banco (arquivo local com permissão restrita); o SQLite guarda apenas uma referência. Sem chave configurada, o executor de demonstração (mock) responde para que você possa testar o fluxo.

## Usando

1. **Workspace**: cadastre a pasta de um projeto.
2. **Tarefas**: crie uma tarefa e clique **Executar** (ou escolha o agente manualmente: Kimi/Claude/Codex).
3. O roteador escolhe o agente pela categoria/risco (ex.: revisão → Claude, segurança → Codex), com no máximo 3 tentativas automáticas e bloqueio ao final.
4. **Office**: visão 2D das três "mesas" com estado de cada agente.
5. **Uso**: consumo de tokens por agente (30 dias).

## Segurança

- Ferramentas locais só acessam a pasta do projeto (bloqueio de path traversal e symlinks).
- Comandos destrutivos (`git reset --hard`, force push, drop database etc.) são negados e geram aprovação humana.
- Máximo de 20 passos de ferramenta por execução (configurável por provedor).

## Build desktop (instalador Windows)

```bash
npm run tauri:build
```

Gera o `.msi` em `src-tauri/target/release/bundle/msi/`. Antes, gere os ícones: `npm run tauri icon caminho/para/imagem-1024.png`.

## Estrutura

- `server/agent-office/` — orquestrador, adapters, tool layer, memória, router
- `server/routes/` — API REST (`/api/agent-office/*`)
- `src/agent-office/` — interface React
- `docs/agent-office/` — especificação completa (blueprint)
- `BUILD_STATUS.md` — status por fase
