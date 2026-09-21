# Product Spec — Agent Office

## 1. Visão
Agent Office é um "sistema operacional local de agentes de programação". Ele não cria um novo modelo de IA. Ele organiza e coordena múltiplos agentes existentes como se compartilhassem a mesma mente operacional.

## 2. Usuário principal
Usuário técnico/semitecnico que trabalha em projetos de software usando:
- Kimi Code;
- Claude Code ou Claude Gateway/API compatível;
- Codex autenticado por assinatura ChatGPT.

## 3. Problema
Hoje o usuário:
- alterna entre múltiplas ferramentas;
- perde contexto ao trocar de agente;
- gasta modelos premium em tarefas triviais;
- não sabe exatamente qual agente está trabalhando;
- não possui uma memória única;
- precisa repetir instruções;
- não possui roteamento e fallback;
- não possui controle de uso unificado;
- não possui um loop confiável que tente, teste, corrija e escale.

## 4. Proposta
Uma única interface contendo:
- conversa central;
- agentes;
- tarefas;
- uso;
- logs;
- memória;
- projeto Git;
- status da execução.

## 5. Papéis iniciais
### Kimi
Executor padrão:
- UI;
- CRUD;
- features comuns;
- bugs médios;
- refactors;
- implementação a partir de plano;
- testes.

### Claude / Gateway
Worker de volume:
- exploração;
- auditoria;
- revisão;
- geração de testes;
- documentação;
- análise de muitos arquivos;
- fallback quando Kimi estiver indisponível ou limitado;
- background work mesmo após queda de velocidade.

### Codex
Recurso premium/protegido:
- arquitetura;
- bugs difíceis;
- auth;
- billing;
- banco/migrations;
- segurança;
- release gate;
- tarefas escaladas após falhas.

## 6. Uma única mente
O Agent Office possui uma memória própria.

Cada turno gera:
- mensagem original;
- agente acionado;
- contexto enviado;
- ferramentas/eventos;
- resultado;
- arquivos alterados;
- testes;
- decisões;
- resumo;
- handoff.

Os agentes não precisam literalmente compartilhar suas sessões internas. A continuidade é criada pelo contexto central e pelos checkpoints do Agent Office.

## 7. Modos de envio
### Automático
O roteador escolhe o agente.

### Manual
- `@kimi`
- `@claude`
- `@codex`

### Team
- `@team`
Executa pipeline de implementação/revisão, obedecendo regras de risco e orçamento.

## 8. Estados da tarefa
- queued
- planning
- running
- testing
- reviewing
- blocked
- waiting_approval
- completed
- failed
- cancelled

## 9. Ações do usuário
- enviar;
- pausar;
- continuar;
- cancelar;
- reassinar;
- solicitar revisão;
- aprovar;
- rejeitar;
- rollback para checkpoint/commit quando possível.

## 10. Requisitos funcionais V1
### Projetos
- criar projeto apontando para pasta local;
- validar se a pasta existe;
- detectar Git;
- mostrar branch atual;
- persistir lista de projetos.

### Chat
- uma conversa por workspace;
- streaming;
- identificação visual do agente;
- suporte a menções;
- persistência;
- retomada após restart.

### Agents
- conectar/testar Kimi;
- conectar/testar Claude/Gateway;
- conectar/testar Codex;
- mostrar status;
- mostrar última ação;
- mostrar se está protegido/limitado.

### Tasks
- criar automaticamente a partir de comandos de execução;
- mostrar status;
- mostrar agente atual;
- mostrar tentativas;
- mostrar arquivos alterados;
- mostrar testes;
- mostrar handoff.

### Usage
- expor somente métricas reais;
- armazenar métricas locais;
- permitir atualização manual quando integração do provedor não expuser endpoint;
- não inventar saldo.

### Context
- memória central;
- resumo do projeto;
- resumo da tarefa;
- mensagens recentes;
- recuperação seletiva de histórico.

### Execution
- um agente writer por vez;
- read-only reviewers podem analisar;
- máximo 3 ciclos automáticos por tarefa antes de escalar;
- confirmar operações destrutivas.

## 11. Requisitos não funcionais
- Windows primeiro;
- local-first;
- inicialização simples;
- interface responsiva;
- logs legíveis;
- erros acionáveis;
- sem travamento silencioso;
- reconexão após restart;
- sem depender de cloud backend próprio.

## 12. Fora do escopo V1
- multiusuário;
- SaaS público;
- cobrança;
- mobile nativo;
- agentes remotos;
- worktrees simultâneos automáticos;
- marketplace;
- 3D;
- analytics avançado;
- vector DB dedicado;
- aprendizado automático de roteamento.
