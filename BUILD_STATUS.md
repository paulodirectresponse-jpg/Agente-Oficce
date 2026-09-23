# Agent Office — Build Status

## Estado atual
- Atualizado: 2026-09-23
- Branch estável: `main`
- Base do Bloco 10: `78b34413c6a1ab39dc76cf0b3d0d221668de3c30`
- Versão de release em preparação: `0.3.0`
- Migration atual: `22`
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
| 10 | Benchmark + Release Gate | IN PROGRESS — PR #41 |

## Bloco 9 — referência estável
- PR: #40
- merge SHA: `78b34413c6a1ab39dc76cf0b3d0d221668de3c30`
- workflow validado: `35884855896`
- Windows/Tauri/MSI gate: PASS
- artifact: `agent-office-desktop-msi`
- artifact id: `10761999132`
- artifact digest: `sha256:847e56ed226406d5e1e04a1e941da7a677c6453ccbdee68b814376781e5e9a24`

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
Os documentos em `docs/v3/` continuam úteis como blueprint de arquitetura, mas a numeração V3.7–V3.11 não representa o release train atual de Blocos 1–10. Funcionalidades desses documentos só devem ser marcadas DONE quando existirem no código e tiverem gate próprio.

## Próximo passo exato
1. concluir PR #41;
2. exigir Desktop Gate verde;
3. executar o novo Production Release Gate;
4. registrar workflow/artifacts/digest finais;
5. somente então marcar Bloco 10 DONE.
