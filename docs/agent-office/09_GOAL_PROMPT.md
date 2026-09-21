# GOAL PROMPT — cole no Claude Code após colocar os arquivos no projeto

Você está construindo o projeto **Agent Office**.

Antes de alterar qualquer código, leia integralmente e nesta ordem:

1. `docs/agent-office/00_README.md`
2. `docs/agent-office/01_PRODUCT_SPEC.md`
3. `docs/agent-office/02_ARCHITECTURE.md`
4. `docs/agent-office/03_DATA_AND_MEMORY.md`
5. `docs/agent-office/04_AGENTS_AND_ROUTING.md`
6. `docs/agent-office/05_UI_UX.md`
7. `docs/agent-office/06_IMPLEMENTATION_PHASES.md`
8. `docs/agent-office/07_TESTING_AND_RELEASE.md`
9. `docs/agent-office/08_AUTONOMOUS_LOOP_RULES.md`

Sua missão é construir o sistema de cabo a rabo, seguindo estritamente as fases e regras desses documentos.

## Regras operacionais

- Trabalhe de forma autônoma e contínua.
- Não pare apenas para relatar progresso.
- Não peça confirmação para decisões técnicas reversíveis e claramente definidas nos documentos.
- Pare apenas se houver:
  1. decisão de produto realmente não especificada;
  2. operação destrutiva;
  3. necessidade de credencial/autenticação que eu precise fornecer;
  4. custo novo/pago;
  5. bloqueio externo impossível de contornar;
  6. risco real de perda de dados.

- Nunca invente que uma integração funciona.
- Nunca marque fase como concluída sem teste.
- Nunca esconda erro para avançar.
- Nunca remova funcionalidades ou validações para fazer teste passar.
- Nunca use API paga nova sem autorização.
- Não reescreva o projeto sem necessidade.
- Não faça overengineering.

## Estratégia obrigatória

1. Faça reconhecimento do ambiente.
2. Crie `BUILD_STATUS.md` se não existir.
3. Identifique a fase atual.
4. Implemente somente a fase atual.
5. Rode testes.
6. Corrija todos os problemas relevantes.
7. Atualize `BUILD_STATUS.md`.
8. Avance automaticamente para a próxima fase.
9. Repita até concluir a Fase 14 ou atingir uma stop condition legítima.

## Qualidade

Cada alteração deve ser:
- simples;
- tipada;
- testável;
- com erro explícito;
- com persistência correta;
- sem segredo exposto;
- compatível com Windows;
- sem hardcode de caminhos pessoais.

## Autonomia

Use seu loop/goal até concluir o máximo possível. Se a execução for interrompida por limite de contexto, crie/atualize um checkpoint em `BUILD_STATUS.md` com informação suficiente para a próxima sessão continuar sem reanalisar tudo.

## Primeira prioridade

Não construa o Office View antes do núcleo funcionar.

A ordem real de prioridade é:
1. persistência;
2. chat;
3. adapters;
4. Claude/Gateway;
5. tasks;
6. memória/handoff;
7. Kimi;
8. Codex;
9. roteamento;
10. usage;
11. UI;
12. Office View;
13. release;
14. dogfooding.

## Critério final de sucesso

O sistema só está pronto quando for possível:
- abrir um projeto real;
- mandar uma ordem;
- executar com um agente;
- ver streaming;
- persistir a conversa;
- gerar handoff;
- trocar de agente sem perder contexto;
- alterar arquivos;
- rodar testes;
- reiniciar o Agent Office;
- retomar do estado anterior;
- consultar uso/status dos agentes;
- proteger Codex;
- completar um fluxo `@team`.

Comece agora pela leitura dos documentos e execução da Fase 0.
