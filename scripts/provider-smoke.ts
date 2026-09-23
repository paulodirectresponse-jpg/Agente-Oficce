import { openAgentOfficeDatabase } from '../server/agent-office/database.js';
import { getAgentOfficeConfig } from '../server/agent-office/config.js';
import { DevelopmentSecretStore } from '../server/agent-office/secretStore.js';
import { UniversalProviderEngine } from '../server/agent-office/universalProviderEngine.js';
import { ProviderRepositoryV2 } from '../server/agent-office/v2DataModel.js';

if(process.env.AGENT_OFFICE_ALLOW_PAID_SMOKE!=='1'){
  console.error('Paid provider smoke is disabled. Set AGENT_OFFICE_ALLOW_PAID_SMOKE=1 only after explicit cost authorization.');
  process.exit(2);
}
const providerId=String(process.env.AGENT_OFFICE_SMOKE_PROVIDER_ID||'').trim();
if(!providerId){
  console.error('AGENT_OFFICE_SMOKE_PROVIDER_ID is required.');
  process.exit(2);
}
const db=openAgentOfficeDatabase();
try{
  const providers=new ProviderRepositoryV2(db.connection);
  const provider=providers.get(providerId);
  if(!provider||!provider.enabled)throw new Error('SMOKE_PROVIDER_UNAVAILABLE');
  const requested=String(process.env.AGENT_OFFICE_SMOKE_MODEL||'').trim();
  const model=requested||providers.listModels(providerId,true).find(x=>x.is_default)?.model_id||providers.listModels(providerId,true)[0]?.model_id;
  if(!model)throw new Error('SMOKE_MODEL_UNAVAILABLE');
  const engine=new UniversalProviderEngine(db.connection,new DevelopmentSecretStore(getAgentOfficeConfig().dataDir));
  const started=Date.now();
  const result=await engine.complete(providerId,{
    model,
    messages:[{role:'user',content:'Reply with exactly: OK'}],
    temperature:0,
    max_output_tokens:8,
    metadata:{purpose:'release-provider-smoke'},
  });
  const elapsed=Date.now()-started;
  console.log(JSON.stringify({
    ok:true,
    provider_id:result.provider_id??providerId,
    model_id:result.model_id??model,
    finish_reason:result.finish_reason??null,
    input_tokens:result.usage?.input_tokens??null,
    output_tokens:result.usage?.output_tokens??null,
    duration_ms:elapsed,
    response_nonempty:Boolean(result.text.trim()),
  },null,2));
  if(!result.text.trim())throw new Error('SMOKE_EMPTY_RESPONSE');
}finally{db.connection.close()}
