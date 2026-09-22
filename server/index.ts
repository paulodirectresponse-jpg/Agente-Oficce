import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { agentOfficeRouter } from './routes/agentOfficeRoutes.js';
import { openAgentOfficeDatabase } from './agent-office/database.js';
import { recoverInterruptedChatRuns } from './agent-office/runtimeRecovery.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';
const DESKTOP_RUNTIME = process.env.AGENT_OFFICE_DESKTOP === '1';

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'agent-office' });
});

app.use('/api', agentOfficeRouter);

try {
  const database = openAgentOfficeDatabase();
  try {
    const recovered = recoverInterruptedChatRuns(database.connection);
    if (recovered.recovered_runs || recovered.recovered_agents) {
      console.log(`♻️ Recovered ${recovered.recovered_runs} interrupted chat run(s) and ${recovered.recovered_agents} agent state(s)`);
    }
  } finally {
    database.connection.close();
  }
} catch (error) {
  console.error('Agent Office startup recovery failed:', error);
}

// Browser preview serves dist/client. In the packaged Tauri build the webview
// serves frontend assets itself and this process exposes only health + API.
if (!DESKTOP_RUNTIME) {
  const clientDir = join(__dirname, '../client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(join(clientDir, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Agent Office server running at http://${HOST}:${PORT}`);
  console.log(`📱 API available at http://${HOST}:${PORT}/api`);
});
