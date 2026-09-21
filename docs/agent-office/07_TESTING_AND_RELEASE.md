# Testes e Release Gate

## 1. Estratégia
- unit;
- integration;
- E2E crítico;
- manual smoke.

## 2. Unit
Cobrir:
- router;
- risk classifier;
- context builder;
- handoff builder;
- usage normalization;
- lock manager;
- retry policy;
- secret masking.

## 3. Integration
Cobrir:
- SQLite;
- process runner;
- adapter mocks;
- real adapter health check opcional;
- crash recovery.

## 4. E2E obrigatório
### E2E 1
Criar projeto -> mandar mensagem -> criar task -> executar mock -> salvar.

### E2E 2
Kimi -> handoff -> Claude -> mesmo task state.

### E2E 3
Restart app -> retomar conversation/task.

### E2E 4
Agent falha 3 vezes -> blocked/escalation.

### E2E 5
Codex Protected Mode impede uso automático.

### E2E 6
Cancelamento libera writer lock.

## 5. Regressões obrigatórias
- UTF-8/pt-BR;
- caminhos Windows;
- projeto com espaços;
- projeto sem Git;
- provider offline;
- app reiniciado durante run;
- API key inválida;
- sessão expirada;
- output muito longo;
- stderr;
- event duplication.

## 6. Definition of Done por task
Uma task só está done se:
- critérios atendidos;
- testes relevantes rodados;
- nenhum erro crítico aberto;
- handoff/result salvo;
- writer lock liberado;
- UI atualizada;
- logs disponíveis.

## 7. Release Gate
Antes de marcar V1:
- build Windows;
- app inicia em máquina limpa/teste;
- migrations funcionam;
- secrets persistem com segurança;
- não há keys em logs;
- E2E principal passa;
- usuário consegue configurar cada agente;
- um provider offline não derruba app;
- chat e tasks sobrevivem restart.

## 8. Não permitir
- esconder testes quebrados;
- comentar teste para passar;
- remover validação para "resolver";
- hardcode de path pessoal;
- hardcode de API key;
- catch vazio;
- Promise rejeitada sem handler;
- TODO crítico em fluxo principal.
