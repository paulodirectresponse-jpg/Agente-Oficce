import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfficeMap } from './OfficeMap.js';
import type { AgentProfile, UniversalProvider } from '../types.js';

function agent(overrides:Partial<AgentProfile>={}):AgentProfile{
  return {id:'a1',name:'Builder muito longo para validar truncamento',slug:'builder',role:'Developer',description:'Constrói código',avatar_key:'builder',provider_id:'p1',model_id:'m1',system_prompt:'',enabled:true,paused:false,sort_order:0,idle_after_seconds:300,metadata:{},created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',...overrides};
}
const provider:UniversalProvider={id:'p1',name:'Provider',protocol_driver:'openai',base_url:'',auth_driver:'bearer',secret_ref:null,headers:{},query:{},auth_config:{},protocol_config:{},timeout_ms:30000,enabled:true,health_status:'healthy',last_health_at:null,last_health_error:null,created_at:'',updated_at:''};

describe('OfficeMap',()=>{
  it('uses real agent identity and a development station',()=>{
    const html=renderToStaticMarkup(<OfficeMap agents={[agent()]} providers={[provider]} states={[]} liveStates={{}} target="auto" onTarget={()=>undefined} lastHandoff={null}/>);
    expect(html).toContain('Builder muito longo');
    expect(html).toContain('station-development');
    expect(html).toContain('Contexto compartilhado');
  });

  it('represents paused and disconnected agents without mocks',()=>{
    const html=renderToStaticMarkup(<OfficeMap agents={[agent({paused:true}),agent({id:'a2',slug:'offline',name:'Offline',provider_id:null,model_id:null})]} providers={[provider]} states={[]} liveStates={{}} target="auto" onTarget={()=>undefined} lastHandoff={null}/>);
    expect(html).toContain('state-paused');
    expect(html).toContain('state-offline');
  });
});
