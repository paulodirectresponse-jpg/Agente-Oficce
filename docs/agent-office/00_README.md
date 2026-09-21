# Agent Office — Blueprint de Construção

## Objetivo
Construir um aplicativo local-first, simples, confiável e bonito para orquestrar **Kimi Code, Claude/Claude Gateway e Codex** em uma única conversa, com memória compartilhada local, roteamento automático, controle de uso, handoffs, tarefas, streaming de execução e proteção de franquias.

O produto deve ser útil desde a primeira versão funcional. Evitar complexidade arquitetural desnecessária.

## Princípios
1. **Uma conversa, vários motores.**
2. **A memória pertence ao Agent Office, não aos provedores.**
3. **Um agente por vez pode escrever no repositório no V1.**
4. **Kimi = executor padrão.**
5. **Claude/Gateway = worker de volume / auditor / fallback barato.**
6. **Codex = recurso premium protegido.**
7. **Contexto enviado deve ser mínimo e relevante.**
8. **Sem loops infinitos.**
9. **Sem API paga nova se a assinatura/CLI já resolver.**
10. **Local-first e seguro por padrão.**
11. **Não criar features “bonitas” antes do núcleo funcionar.**
12. **Toda etapa deve terminar com testes e checkpoint.**

## Ordem obrigatória de leitura pelo agente
1. `01_PRODUCT_SPEC.md`
2. `02_ARCHITECTURE.md`
3. `03_DATA_AND_MEMORY.md`
4. `04_AGENTS_AND_ROUTING.md`
5. `05_UI_UX.md`
6. `06_IMPLEMENTATION_PHASES.md`
7. `07_TESTING_AND_RELEASE.md`
8. `08_AUTONOMOUS_LOOP_RULES.md`

## O que NÃO fazer
- Não criar microserviços.
- Não usar Kubernetes.
- Não usar banco externo no V1.
- Não criar vector DB no V1.
- Não permitir múltiplos agentes alterando os mesmos arquivos em paralelo no V1.
- Não adicionar 3D.
- Não construir marketplace de agentes.
- Não depender de APIs pagas se for possível usar CLI/App Server/servidor local já autenticado.
- Não reconstruir funcionalidades já prontas dos CLIs.
- Não inventar métricas que os provedores não expõem.
- Não mascarar erros.
- Não marcar uma fase como concluída sem validação objetiva.

## Resultado esperado
Um desktop app que permita:
- selecionar/criar um projeto local;
- ter uma conversa única;
- usar `@kimi`, `@claude`, `@codex` ou modo automático;
- acompanhar em tempo real qual agente está executando;
- persistir contexto e histórico;
- transferir uma tarefa de um agente para outro;
- ver tarefas, status, uso e logs;
- proteger Codex quando a franquia estiver baixa;
- continuar uma tarefa de onde o agente anterior parou;
- executar até 3 ciclos automáticos de correção antes de escalar;
- pausar/cancelar/reassinar/revisar;
- ter uma visão Office 2D simples opcional.

## Critério de sucesso
O sistema só é considerado pronto quando for possível realizar, de ponta a ponta:

1. Abrir projeto local.
2. Enviar um pedido no chat.
3. Roteá-lo para um agente.
4. Ver streaming da execução.
5. Persistir o turno.
6. Gerar handoff.
7. Trocar para outro agente sem perder contexto.
8. Alterar arquivos do projeto.
9. Rodar testes.
10. Registrar resultado.
11. Reiniciar o app.
12. Retomar a conversa e a tarefa do estado anterior.
