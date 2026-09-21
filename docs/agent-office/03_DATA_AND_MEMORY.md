# Dados, Conversa Única e Memória

## 1. Banco SQLite
Tabelas mínimas:

### projects
- id
- name
- root_path
- git_enabled
- created_at
- updated_at

### conversations
- id
- project_id
- title
- created_at
- updated_at

### messages
- id
- conversation_id
- role
- agent_id nullable
- content
- created_at
- metadata_json

### tasks
- id
- project_id
- conversation_id
- title
- description
- category
- risk
- status
- assigned_agent
- attempt_count
- writer_lock
- created_at
- updated_at
- completed_at nullable

### runs
- id
- task_id
- agent_id
- provider_session_id nullable
- status
- started_at
- ended_at nullable
- input_summary
- output_summary
- usage_json nullable
- error_json nullable

### handoffs
- id
- task_id
- from_agent
- to_agent nullable
- summary
- files_json
- tests_json
- decisions_json
- open_issues_json
- created_at

### project_memory
- project_id
- summary
- architecture
- rules
- known_issues
- updated_at

### memory_chunks
- id
- project_id
- conversation_id nullable
- task_id nullable
- kind
- text
- searchable_text
- created_at

### usage_snapshots
- id
- agent_id
- provider
- source
- raw_json
- normalized_json
- created_at

### app_settings
- key
- value_json

## 2. Camadas de memória
### Full History
Tudo fica salvo localmente.

### Project Memory
Resumo estável:
- stack;
- arquitetura;
- regras;
- decisões;
- problemas conhecidos.

### Working Memory
- últimas N mensagens relevantes;
- objetivo atual;
- status da tarefa.

### Task Memory
- plano;
- alterações;
- testes;
- falhas;
- decisões;
- handoffs.

### Retrieved Memory
Busca FTS por termos da tarefa, arquivos, entidades e mensagens.

## 3. Context Pack
Cada execução recebe um pacote compacto.

Estrutura:

```md
# SYSTEM RULES
...

# PROJECT SUMMARY
...

# CURRENT TASK
...

# CURRENT STATE
...

# RELEVANT DECISIONS
...

# RELEVANT HISTORY
...

# LAST HANDOFF
...

# ACCEPTANCE CRITERIA
...
```

## 4. Budget de contexto
Padrão inicial:
- system/global: <= 2k tokens aproximados;
- project summary: <= 5k;
- task state: <= 4k;
- relevant history: <= 8k;
- handoff/decisions: <= 4k.

Meta inicial: ~15k–25k tokens adicionais de memória, não contando arquivos que o próprio agente decide ler.

O sistema pode exceder em tarefas especiais, mas deve registrar o motivo.

## 5. Summarization checkpoints
Criar resumo:
- ao concluir uma task;
- após 20 mensagens de conversa;
- antes de trocar de agente em task longa;
- antes de compactar histórico.

Nunca apagar raw history.

## 6. Handoff obrigatório
Antes de trocar de agente, gerar:

- objetivo;
- o que foi feito;
- arquivos tocados;
- comandos/testes;
- resultados;
- decisões;
- erros;
- pendências;
- sugestão do próximo passo.

O handoff deve ser salvo e injetado no próximo agente.

## 7. Continuidade
A conversa que o usuário vê é única.

Não importa se:
- Kimi usou sessão própria;
- Claude usou API;
- Codex usou thread própria.

O Agent Office sempre persiste a versão canônica.

## 8. Busca
V1:
- FTS5 por texto;
- ranking por:
  1. task atual;
  2. arquivo mencionado;
  3. recência;
  4. termos exatos.

Sem embeddings no V1.

## 9. Atualização da Project Memory
Após uma task concluída, só adicionar mudanças permanentes:
- nova decisão arquitetural;
- alteração relevante de stack;
- regra nova;
- bug conhecido importante.

Não encher a memória com cada detalhe operacional.
