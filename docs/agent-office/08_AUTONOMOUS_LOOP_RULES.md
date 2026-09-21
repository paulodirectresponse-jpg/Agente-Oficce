# Regras do Loop Autônomo

## Missão
Permitir execução longa sem supervisão constante, mas sem gastar cota de forma descontrolada e sem entrar em loop infinito.

## Loop padrão
1. Understand
2. Plan
3. Execute
4. Test
5. Inspect
6. Fix se necessário
7. Re-test
8. Summarize
9. Handoff ou Complete

## Limites
- max 3 tentativas automáticas por task;
- max 3 trocas de agente;
- max 120 min por task por padrão;
- Codex respeita Protected Mode;
- nenhuma operação destrutiva sem aprovação;
- nenhuma compra/upgrade/uso de API paga nova sem aprovação.

## Stop conditions
Parar quando:
- acceptance criteria atendidos;
- testes relevantes passando;
- task bloqueada por decisão humana;
- limite de tentativas;
- hard time limit;
- provider indisponível sem fallback;
- risco de dano;
- requisito ambíguo crítico.

## Continue conditions
Continuar automaticamente quando:
- teste falhou e há diagnóstico claro;
- erro de lint/type;
- regressão causada pela mudança atual;
- ajuste necessário é local e reversível.

## Escalation
### Kimi falha
-> Claude analisa
-> Kimi tenta correção
-> Codex somente se necessário e permitido

### Claude falha
-> Kimi ou Codex conforme risco

### Codex falha
-> bloquear e pedir usuário

## Loop do construtor (Claude Code construindo este projeto)
Enquanto estiver implementando o Agent Office:
- seguir fases na ordem;
- ao fim de cada fase rodar testes;
- corrigir antes de seguir;
- atualizar `BUILD_STATUS.md`;
- se contexto estiver ficando grande, criar checkpoint;
- não reescrever projeto do zero;
- não pular erro;
- não encerrar com "feito" sem evidência.

## BUILD_STATUS.md
Deve conter:
- fase atual;
- concluído;
- em andamento;
- pendências;
- testes;
- erros;
- próximos passos;
- último commit/hash se houver.

## SELF_CHECK.md
Antes de parar uma sessão longa:
- O app compila?
- Os testes passam?
- A fase foi realmente concluída?
- Há regressão visível?
- Persistência foi verificada?
- Secrets estão protegidos?
- O status foi atualizado?
- Existe um próximo passo inequívoco?
