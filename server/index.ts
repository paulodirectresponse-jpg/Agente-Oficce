import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { agentOfficeRouter } from './routes/agentOfficeRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'agent-office' });
});

// Agent Office API routes
app.use('/api', agentOfficeRouter);

// Serve static files from dist/client in production
app.use(express.static(join(__dirname, '../dist/client')));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../dist/client/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 Agent Office server running at http://localhost:${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}/api`);
});