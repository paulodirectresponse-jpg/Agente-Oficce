# Testes, Benchmark e Release Gate

## Princípio
A release não é aprovada apenas porque a UI abre ou os testes unitários passam. O Agent Office usa gates cumulativos: invariantes, benchmark determinístico, preflight, build desktop e lifecycle instalado.

## Gate de PR
Todo PR para `main` deve executar:
- `npm ci`;
- `npm run release:version`;
- `npm test`;
- `npm run benchmark`;
- `npm run release:preflight`;
- `npm run lint`;
- `npm run build`;
- Rust/Tauri build;
- bundled backend smoke;
- instalação real do MSI;
- health do backend instalado;
- SQLite;
- shutdown sem backend órfão;
- release manifest;
- upload do MSI e diagnostics.

## Benchmark determinístico
O benchmark padrão não usa provider pago.

Golden set atual:
- routing;
- capability matching;
- Execution DAG;
- recovery;
- security/redaction.

Resultados são gravados em `artifacts/release/benchmark-results.json`.

O benchmark deve validar decisões estruturais e invariantes; não comparar “qualidade estética” de texto gerado.

## Stress benchmark
`npm run benchmark:stress` é separado do PR gate. Ele repete a suíte determinística e é executado no Production Release Gate.

Stress maior pode evoluir para dezenas de milhares de casos, mas não deve tornar cada PR inutilmente lento.

## Release Preflight
`npm run release:preflight` valida:
- SQLite integrity;
- foreign keys;
- migration atual;
- project root;
- providers/models/agents disponíveis como warnings quando ausentes;
- Files/Shell/Git como runtime crítico;
- GitHub/Browser/Computer como recursos opcionais quando indisponíveis.

Falha em check crítico bloqueia release. Recurso opcional ausente gera warning.

## Versionamento
`npm run release:version` exige igualdade entre:
- `package.json`;
- `package-lock.json`;
- root package do lockfile;
- `src-tauri/tauri.conf.json`.

## Release manifest
`npm run release:manifest -- <path-do-msi>` gera:
- versão;
- Git SHA;
- migration;
- workflow;
- benchmark;
- preflight;
- tamanho do MSI;
- SHA-256 do MSI.

Arquivo: `artifacts/release/release-manifest.json`.

## Production Release Gate
Workflow: `Agent Office Release Gate`.

Além do gate normal:
- stress benchmark;
- build da versão anterior;
- instalação da versão anterior;
- criação de Project, conversation e settings sentinela;
- instalação da versão atual por cima;
- verificação de preservação desses dados;
- preflight após upgrade;
- fresh-install gate;
- release manifest + artifact digest.

O workflow é manual/tag-driven para não dobrar o custo de build em todo PR.

## Regressões obrigatórias
- UTF-8/pt-BR;
- caminhos Windows;
- projeto com espaços;
- provider offline;
- restart durante run;
- cancelamento;
- approvals;
- recovery;
- event duplication;
- migration upgrade;
- usage sem dupla contagem;
- custo unknown não convertido para zero;
- Team/Subagent invariants;
- filesystem/secret protections.

## Release blockers
Não liberar se houver:
- data loss em migration/upgrade;
- foreign-key corruption;
- secret leak conhecido;
- hierarchy/dependency cycle conhecido;
- permission escalation conhecida;
- duplicate destructive side effect conhecido;
- recovery inconsistente;
- benchmark estrutural crítico falhando;
- versões divergentes;
- MSI não instalável;
- upgrade MSI perdendo Project/conversation/settings;
- backend órfão após fechamento.

## Providers reais
Smoke de provider pago é opcional e deve exigir autorização explícita de custo. O gate determinístico nunca depende disso.
