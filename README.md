# Agent Office - Local-first Multi-Agent Orchestrator

A standalone desktop application for orchestrating AI agents (Claude, Kimi, Codex) with local SQLite persistence, conversation memory, and autonomous task execution.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Agent Office                          │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React + Vite)     │  Backend (Node + Express)   │
│  - Workspace UI              │  - REST API                 │
│  - Task Management           │  - Agent Adapters           │
│  - Usage Monitoring          │  - Task Runner              │
│  - Settings                  │  - SQLite + WAL + FTS5      │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              SQLite Database      Agent Adapters
              - Projects           - Claude/Gateway
              - Conversations      - Kimi
              - Messages           - Codex
              - Tasks
              - Memory (FTS5)
```

## Quick Start

```bash
# Install dependencies
npm install

# Start development (client + server)
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Type check
npm run lint
```

## Tauri Desktop App

```bash
# Development with Tauri
npm run tauri:dev

# Build desktop app
npm run tauri:build
```

## Project Structure

```
agent-office/
├── server/                    # Backend (Node + Express)
│   ├── index.ts              # Entry point
│   ├── routes/               # API routes
│   │   └── agentOfficeRoutes.ts
│   └── agent-office/         # Core modules
│       ├── config.ts         # Configuration
│       ├── logger.ts         # Logging (no secrets)
│       ├── database.ts       # SQLite + WAL + migrations
│       ├── projectRepository.ts
│       ├── conversationRepository.ts
│       ├── adapterFramework.ts
│       ├── claudeAdapter.ts
│       ├── taskRunManager.ts
│       └── *.test.ts         # Unit/integration tests
├── src/                       # Frontend (React + Vite)
│   └── agent-office/
│       └── AgentOfficeHealthPage.tsx
├── docs/
│   └── agent-office/         # Blueprint docs (12 files)
├── dist/                      # Build output
├── data/                      # SQLite database (gitignored)
├── package.json
├── tsconfig.json
├── tsconfig.server.json
├── vite.config.ts
├── vitest.config.ts
├── .env.example
├── .gitignore
├── BUILD_STATUS.md
└── MIGRATION_REPORT.md
```

## Core Concepts

### Projects
Each project maps to a local folder with optional Git integration. One canonical conversation per project.

### Conversations
Single conversation per project containing all messages (user, assistant, system, events).

### Agents
- **Kimi**: UI/frontend, common features, CRUD, refactor, bugs
- **Claude**: Exploration, audit, review, tests, docs, large context, fallback
- **Codex**: Architecture, auth, billing, security, high-risk, release gate

### Tasks
Autonomous work units with writer lock (per project), retry logic, crash recovery.

### Memory
- Project Memory: summary, architecture, rules
- Working Memory: current task context
- Task Memory: task-specific
- Retrieved Memory: FTS5 search
- Handoff: agent-to-agent transitions

## Configuration

Copy `.env.example` to `.env` and configure:
- `AGENT_OFFICE_DATA_DIR`: Data directory (default: `./data`)
- `AGENT_OFFICE_DATABASE_PATH`: SQLite path (default: `./data/office.sqlite`)
- Provider credentials: Use secure storage, not `.env`

## License

MIT