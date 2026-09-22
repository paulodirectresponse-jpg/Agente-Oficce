import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { agentOfficeRouter } from './routes/agentOfficeRoutes.js';

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

// Browser preview serves the built SPA. The packaged Tauri app serves the
// frontend itself, so its embedded backend only exposes health + API routes.
if (!DESKTOP_RUNTIME) {
  app.use(express.static(join(__dirname, '../dist/client')));
  app.get('*', (_req, res) => {
    res.sendFile(join(__dirname, '../dist/client/index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Agent Office server running at http://${HOST}:${PORT}`);
  console.log(`📱 API available at http://${HOST}:${PORT}/api`);
});
