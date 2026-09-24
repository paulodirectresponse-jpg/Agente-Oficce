import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { agentOfficeRouter } from './routes/agentOfficeRoutes.js';
import { openAgentOfficeDatabase } from './agent-office/database.js';
import { recoverInterruptedChatRuns } from './agent-office/runtimeRecovery.js';
import { DurableExecutionService } from './agent-office/durableExecution.js';
import { startProviderHealthMonitor } from './agent-office/providerHealthMonitor.js';
import { LongRunService } from './agent-office/longRunService.js';
import { chatRunControls } from './agent-office/runtimeControls.js';

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

const durableResumeQueue:Array<{run_id:string;plan_id:string}>=[];

try {
  const database = openAgentOfficeDatabase();
  try {
    const recovered = recoverInterruptedChatRuns(database.connection);
    const durable = new DurableExecutionService(database.connection).recoverAll();
    if (recovered.recovered_runs || recovered.recovered_agents || durable.recovered_plans) {
      console.log(`♻️ Recovery: ${recovered.recovered_runs} chat run(s), ${durable.recovered_plans} durable plan(s), ${durable.manual_review_steps} manual-review step(s)`);
    }
    const roots=database.connection.prepare("SELECT id,metadata_json FROM chat_runs WHERE parent_run_id IS NULL AND status='running' ORDER BY started_at").all() as Array<{id:string;metadata_json:string}>;
    for(const row of roots){
      try{
        const metadata=JSON.parse(row.metadata_json||'{}') as Record<string,unknown>;
        if(metadata.long_running===true&&typeof metadata.execution_plan_id==='string')durableResumeQueue.push({run_id:row.id,plan_id:metadata.execution_plan_id});
      }catch{}
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

for(const item of durableResumeQueue){
  const database=openAgentOfficeDatabase();
  const signal=chatRunControls.register(item.run_id);
  void new LongRunService(database.connection).run(item.plan_id,item.run_id,signal)
    .catch(()=>undefined)
    .finally(()=>{chatRunControls.finish(item.run_id);database.connection.close()});
}

startProviderHealthMonitor();

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Agent Office server running at http://${HOST}:${PORT}`);
  console.log(`📱 API available at http://${HOST}:${PORT}/api`);
});
