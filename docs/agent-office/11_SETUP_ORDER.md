# Ordem prática para começar

## 1. Crie uma pasta vazia para o projeto
Exemplo:
`C:\Users\paulo\Projects\agent-office`

## 2. Copie esta pasta para:
`docs/agent-office/`

Estrutura:
```text
agent-office/
  docs/
    agent-office/
      00_README.md
      ...
      11_SETUP_ORDER.md
```

## 3. Abra a pasta no Claude Code

## 4. Garanta que seu Claude/Gateway atual está funcional
Não mude credenciais no começo se já estiver funcionando.

## 5. Cole o conteúdo de `09_GOAL_PROMPT.md` no Goal
Não cole todos os documentos no chat. O agente deve lê-los do disco.

## 6. Deixe o Claude executar
Intervenha somente se pedir:
- login;
- credencial;
- autorização destrutiva;
- custo;
- decisão de produto não especificada.

## 7. Se a sessão parar
Abra nova sessão e diga:
"Leia `BUILD_STATUS.md`, depois releia apenas os documentos necessários em `docs/agent-office/` e continue exatamente da próxima etapa pendente, obedecendo `08_AUTONOMOUS_LOOP_RULES.md`."

## 8. Não aceite como concluído apenas porque a UI abriu
A release só vale após Fase 13/14.
