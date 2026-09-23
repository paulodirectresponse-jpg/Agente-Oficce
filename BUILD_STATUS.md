# Agent Office — Build Status

## Estado atual
- Atualizado: 2026-09-23
- Branch estável: `main`
- Último bloco estrutural concluído: Bloco 11
- Versão atual: `0.4.0`
- Migration atual: `23`
- Desktop: Windows/Tauri/MSI
- Banco: SQLite/WAL
- Regra de continuidade: sempre partir da `main` mais recente; não usar backups antigos como fonte de verdade.

## Release train atual

| Bloco | Escopo | Status |
|---|---|---|
| 1 | Runtime + Full Access Tools | DONE |
| 2 | Providers + Models + Resilience | DONE |
| 3 | Central Orchestrator | DONE |
| 4 | Agents | DONE |
| 5 | Teams + Subagents | DONE |
| 6 | Workforces | DONE |
| 7 | Chat Workspace | DONE |
| 8 | Projects persistent workspace | DONE |
| 9 | Analytics | DONE |
| 10 | Benchmark + Release Gate | DONE — PR #41 |
| 11 | Integration Registry + External Actions | DONE — PR #42 |

## Bloco 9 — referência estável
- PR: #40
- merge SHA: `78b34413c6a1ab39dc76cf0b3d0d221668de3c30`
- workflow validado: `35884855896`
- Windows/Tauri/MSI gate: PASS
- artifact: `agent-office-desktop-msi`
- artifact id: `10761999132`
- artifact digest: `sha256:847e56ed226406d5e1e04a1e941da7a677c6453ccbdee68b814376781e5e9a24`

## Bloco 10 — concluído
- PR: #41
- merge SHA: `4072ca9d9c95f9a2885d362a96f4feaf9e346305`
- desktop gate: `35892430595` — PASS
- 242/242 testes — PASS
- deterministic benchmark — PASS
- release preflight — PASS
- typecheck/build/Tauri/MSI/lifecycle — PASS
- Production Release Gate manual/tag-driven implementado para stress + MSI upgrade preservation.

## Bloco 11 — concluído
- PR: #42
- merge SHA: `eb4e53ed6388e2a7ed50bd934caeff7707f317f8`
- desktop gate: `35897268465` — PASS
- Migration 23 — PASS
- deterministic benchmark com Integration Registry — PASS
- release preflight — PASS
- typecheck/build/Tauri/MSI/lifecycle — PASS
- versão: `0.4.0`
- MSI artifact id: `10767736801`
- artifact ZIP digest: `sha256:b6fd7835ed740cf54fb80b6fdd40dc6bfb3c0939a1c6594a825a7c99409adba6`
- MSI SHA-256: `e45270b65d5b001026bdacfa7ffb8916b9f1c377518662b6e40d338e00838ddc`
- release diagnostics artifact id: `10767413968`

Entregas principais:
- Integration Registry persistente;
- múltiplas conexões por driver;
- secrets fora do SQLite;
- capabilities por integração;
- Project bindings com uma conexão ativa por driver;
- GitHub, Railway, Supabase e Browser;
- Tool Registry bridge;
- approvals e idempotência automática para mutações externas;
- Gap Analysis distingue missing Tool / missing Integration / missing Worker;
- Orchestrator infere integrações externas;
- modelo com tool calling explicitamente desativado é inelegível;
- Integration Manager no desktop;
- eventos/health/preflight/benchmark integrados.

## Bloco 10 — objetivo
Transformar testes, CI, recovery e desktop gates já existentes em um critério formal e repetível de release.

Entregas do bloco:
- benchmark engine determinístico;
- golden set versionado;
- routing benchmark;
- capability benchmark com catálogo grande;
- execution/DAG benchmark;
- recovery benchmark;
- security/redaction benchmark;
- benchmark stress separado do PR gate;
- Release Preflight no backend e nas Configurações;
- version consistency entre npm/lock/Tauri;
- release manifest JSON;
- SHA-256 do MSI;
- PR gate com benchmark + preflight;
- Production Release Gate manual;
- fresh install;
- MSI upgrade sobre versão anterior com preservação de dados;
- hardening de teste flaky;
- documentação e README reconciliados.

## Comandos de release
```bash
npm run release:version
npm run benchmark
npm run benchmark:stress
npm run release:preflight
npm run release:gate
npm run release:manifest
```

## Critérios de bloqueio
Uma release não pode ser considerada pronta se ocorrer:
- migration/data loss;
- foreign-key corruption;
- secret leak conhecido;
- hierarchy/dependency cycle conhecido;
- permission escalation conhecida;
- duplicate destructive side effect conhecido;
- project/runtime inconsistente após restart;
- benchmark estrutural crítico falhando;
- versão npm/Tauri divergente;
- MSI não instalável;
- upgrade que perde Project/conversation/settings;
- backend órfão após fechar o desktop.

## Roadmap V3 histórico
Os documentos em `docs/v3/` continuam úteis como blueprint de arquitetura, mas a numeração V3.7–V3.11 não representa o release train atual de Blocos 1–11. Funcionalidades desses documentos só devem ser marcadas DONE quando existirem no código e tiverem gate próprio.

## Próximo passo exato
1. realizar o pente fino completo de produto/UX e testes manuais dos Blocos 1–11;
2. corrigir bugs/inconsistências encontrados sem reabrir arquitetura já validada sem necessidade;
3. executar o Production Release Gate manual antes de uma distribuição formal/tag;
4. manter `main` como única fonte de verdade.
