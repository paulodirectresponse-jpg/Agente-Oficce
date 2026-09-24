import type { AgentProfile, AgentState, UniversalProvider } from '../types.js';
import { OfficeGameCanvas } from './OfficeGameCanvas.js';
import type { RoomAgentView, RoomVisualState, StationKind } from './roomTypes.js';

const STATE_LABELS:Record<RoomVisualState,string>={
  offline:'Offline',
  idle:'Disponível',
  resting:'Em espera',
  thinking:'Pensando',
  planning:'Planejando',
  responding:'Respondendo',
  coding:'Programando',
  testing:'Testando',
  reviewing:'Revisando',
  waiting:'Aguardando',
  blocked:'Bloqueado',
  error:'Erro',
  paused:'Pausado',
  completed:'Concluído recentemente',
};

function normalized(value:string):RoomVisualState{
  if(['offline','idle','resting','thinking','planning','responding','coding','testing','reviewing','waiting','blocked','error','paused','completed'].includes(value))return value as RoomVisualState;
  if(value==='running'||value==='working')return'responding';
  return'idle';
}

function stationFor(agent:AgentProfile):StationKind{
  const text=(agent.role+' '+agent.description+' '+agent.name).toLowerCase();
  if(/review|research|pesquis|qa|test|auditor/.test(text))return'research';
  if(/lead|manager|gestor|orchestr|chief|coord/.test(text))return'lead';
  if(/develop|builder|code|codex|engineer|program/.test(text))return'development';
  return'operations';
}

function viewState(
  agent:AgentProfile,
  persisted:AgentState|undefined,
  live:{state:string;activity:string;updated_at:string}|undefined,
  providers:UniversalProvider[],
):RoomVisualState{
  if(agent.paused)return'paused';
  const provider=agent.provider_id?providers.find(item=>item.id===agent.provider_id):undefined;
  if(!provider||!provider.enabled||provider.health_status==='unavailable'||!agent.model_id)return'offline';
  const state=normalized(live?.state??persisted?.state??'idle');
  if(state!=='idle')return state;
  const at=live?.updated_at??persisted?.updated_at;
  if(at&&Date.now()-new Date(at).getTime()>agent.idle_after_seconds*1000)return'resting';
  return'idle';
}

export function OfficeMap({
  agents,
  providers,
  states,
  liveStates,
  target,
  onTarget,
  lastHandoff,
}:{
  agents:AgentProfile[];
  providers:UniversalProvider[];
  states:AgentState[];
  liveStates:Record<string,{state:string;activity:string;updated_at:string}>;
  target:string;
  onTarget:(value:string)=>void;
  lastHandoff:{from:string;to:string}|null;
}){
  const stateById=new Map(states.map(item=>[item.agent_id,item]));
  const views:RoomAgentView[]=agents.map(agent=>{
    const persisted=stateById.get(agent.id);
    const state=viewState(agent,persisted,liveStates[agent.id],providers);
    return{
      id:agent.id,
      name:agent.name,
      role:agent.role,
      state,
      activity:liveStates[agent.id]?.activity||persisted?.activity||STATE_LABELS[state],
      progress:persisted?.progress??null,
      station:stationFor(agent),
      selected:target===agent.id||target===agent.slug,
      disabled:state==='offline',
    };
  });

  return <div className="room-map room-map-game" aria-label="Escritório operacional dos Agents">
    <div className="room-wall">
      <div className="room-window"><span/><span/><span/></div>
      <div className="room-brand"><strong>AGENT OFFICE</strong><span>operational workspace</span></div>
      <div className="room-clock">AO</div>
    </div>
    <OfficeGameCanvas
      agents={views}
      lastHandoff={lastHandoff}
      onSelect={agent=>{if(!agent.disabled)onTarget(agent.selected?'auto':agent.id)}}
    />
  </div>;
}
