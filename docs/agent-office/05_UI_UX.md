# UI/UX — Simples, Organizada e Bonita

## 1. Direção
Visual:
- desktop premium;
- escuro por padrão;
- limpo;
- poucos elementos;
- tipografia legível;
- status por ícone + texto;
- evitar excesso de cards.

## 2. Navegação
Sidebar:
- Projects
- Workspace
- Tasks
- Usage
- Settings

## 3. Workspace
Layout:
- esquerda: agentes;
- centro: chat;
- direita: task atual opcional;
- bottom composer.

### Agent cards
Mostrar:
- nome;
- papel;
- status;
- tarefa atual;
- elapsed time;
- health;
- usage status resumido.

### Status
- Idle
- Planning
- Reading
- Coding
- Testing
- Reviewing
- Waiting
- Blocked
- Slow
- Error

## 4. Chat
Mensagem deve mostrar:
- autor;
- agente quando aplicável;
- timestamp;
- status.

Eventos técnicos detalhados não devem poluir o chat.
Mostrar "activity rows" compactas:
- "Kimi alterou 4 arquivos"
- "Testes 42/42"
- "Claude iniciou revisão"

Logs completos ficam no drawer.

## 5. Composer
- textarea;
- send;
- selector: Auto / Kimi / Claude / Codex / Team;
- toggle "executar" vs "apenas conversar" se necessário;
- atalhos por @mention.

## 6. Tasks
Tabela/lista:
- ID;
- título;
- status;
- risco;
- agente;
- tentativas;
- tempo;
- última atualização.

Abrir task:
- objetivo;
- critérios;
- timeline;
- arquivos;
- testes;
- handoffs;
- runs;
- decisões.

## 7. Usage
Três blocos:

### Kimi
- estado;
- dados oficiais disponíveis;
- métricas locais;
- last refresh.

### Claude
- estado primary/shared;
- percent mensal se integrado;
- tokens/requests se disponíveis;
- métricas locais.

### Codex
- status do plano;
- cota 5h/semanal se exposta;
- Protected Mode;
- threshold.

Nunca usar números fake.

## 8. Office View
V1 simples:
- 3 mesas 2D;
- agente em cada mesa;
- animações CSS leves;
- estado real vinculado ao backend.

Não construir jogo.
Não usar canvas 3D.
Não usar engine de jogo.

Clique no agente abre painel detalhado.

## 9. Settings
### General
- theme;
- language;
- startup.

### Agent connections
- Kimi
- Claude/Gateway
- Codex

### Routing
- protected mode;
- thresholds;
- retries;
- time limits.

### Safety
- destructive command approvals;
- Git behavior.

## 10. Erros
Todo erro precisa:
- texto humano;
- causa técnica expansível;
- ação sugerida;
- retry;
- copiar detalhes.

Nada de "Request failed" sozinho.
