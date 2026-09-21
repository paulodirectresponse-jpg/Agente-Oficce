# Agentes, Roteamento, Uso e Fallback

## 1. Categorias
- ui_visual
- frontend_logic
- backend
- database
- auth_security
- billing_credits
- integration
- testing
- code_review
- architecture
- debugging
- documentation
- exploration
- devops
- unknown

## 2. Risco
### low
- CSS;
- copy;
- layout;
- componentes simples;
- documentação.

### medium
- feature comum;
- frontend state;
- integração não crítica;
- CRUD;
- refactor multi-arquivo.

### high
- auth;
- migrations;
- billing;
- créditos;
- segurança;
- exclusão;
- provider routing;
- jobs críticos;
- deploy;
- alterações estruturais.

## 3. Roteamento V1 por regra
### Kimi
Default para:
- ui_visual
- frontend_logic low/medium
- feature comum
- debugging low/medium
- integration low/medium
- implementação de plano
- testes comuns

### Claude/Gateway
Default para:
- exploration
- code_review
- documentation
- testing pesado
- auditoria
- análise de grande volume
- fallback de Kimi
- background

### Codex
Default para:
- architecture
- auth_security
- billing_credits
- database high
- debugging high
- release gate high
- fallback após falhas dos outros

## 4. Regras de fallback
### Kimi
- 1ª falha: retry guiado no próprio Kimi;
- 2ª falha: Claude review/análise;
- 3ª tentativa: Kimi com diagnóstico;
- se persistir: escalar para Codex somente se permitido pelo Protected Mode.

### Claude
- falha transitória: 1 retry;
- baixa velocidade não é falha;
- erro lógico: Kimi ou Codex conforme risco.

### Codex
- nunca usar automaticamente para low-risk se Protected Mode ativo;
- se cota semanal abaixo do threshold, exigir confirmação para novas tarefas não críticas.

## 5. Protected Mode
Config padrão:
- reserve_codex_weekly_percent = 25

Quando estimativa/medida disponível:
- acima de 25% restante: uso normal pelas regras;
- <=25%: somente high-risk ou autorização manual;
- <=10%: manual-only.

Se não for possível ler a cota automaticamente:
- mostrar status "desconhecido";
- permitir input manual;
- não fingir precisão.

## 6. Usage
### API
Registrar:
- input tokens;
- output tokens;
- cache tokens quando houver;
- custo se tabela configurada;
- request count.

### Subscription
Registrar:
- requests locais;
- duração;
- runs;
- métricas oficiais expostas pelo provider;
- percentuais oficiais se disponíveis.

Não converter assinatura em custo por task como se fosse custo real.
Pode mostrar "custo atribuído estimado" apenas se claramente marcado como estimativa.

## 7. Claude Gateway
Pelo painel do usuário:
- há franquia mensal principal;
- ao atingir 100%, o tráfego pode migrar para servidor compartilhado e ficar mais lento;
- portanto "100%" não deve ser tratado automaticamente como indisponível.

Modelar estados:
- primary_available
- shared_slow
- unavailable
- unknown

## 8. Manual override
Comandos:
- `@kimi`
- `@claude`
- `@codex`
- `@team`

Também permitir dropdown.

## 9. Team Mode
### Low risk
Kimi implementa -> Claude review opcional.

### Medium
Kimi implementa -> Claude review -> Kimi corrige.

### High
Codex plan -> Kimi implementa -> Claude review -> Codex release gate.

## 10. Retry budget
Padrão:
- max_auto_attempts_per_task = 3
- max_agent_switches_per_task = 3

Depois:
- blocked;
- pedir ação humana.

## 11. Time budget
Padrão configurável por task:
- soft limit: 45 min
- hard limit: 120 min

Não matar processo em etapa crítica sem registrar checkpoint.

## 12. Routing score futuro
Não implementar no V1.
Preparar dados para futuro:
- success_first_pass;
- total_attempts;
- duration;
- manual_interventions;
- regressions;
- final_approved.
