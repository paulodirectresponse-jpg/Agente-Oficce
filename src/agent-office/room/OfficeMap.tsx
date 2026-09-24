import type { AgentProfile, AgentState, UniversalProvider } from '../types.js';
import { AgentStation } from './AgentStation.js';
import { OfficeTileCanvas } from './OfficeTileCanvas.js';
import type { RoomAgentView, RoomVisualState, StationKind } from './roomTypes.js';

const STATE_LABELS:Record<RoomVisualState,string>={offline:'Offline',idle:'Disponível',resting:'Em espera',thinking:'Pensando',planning:'Planejando',responding:'Respondendo',coding:'Programando',testing:'Testando',reviewing:'Revisando',waiting:'Aguardando',blocked:'Bloqueado',error:'Erro',paused:'Pausado',completed:'Concluído recentemente'};
function normalized(value:string):RoomVisualState{if(['offline','idle','resting','thinking','planning','responding','coding','testing','reviewing','waiting','blocked','error','paused','completed'].includes(value))return value as RoomVisualState;if(value==='running'||value==='working')return'responding';return'idle'}
function stationFor(agent:AgentProfile):StationKind{const text=(agent.role+' '+agent.description+' '+agent.name).toLowerCase();if(/review|research|pesquis|qa|test|auditor/.test(text))return'research';if(/lead|manager|gestor|orchestr|chief|coord/.test(text))return'lead';if(/develop|builder|code|codex|engineer|program/.test(text))return'development';return'operations'}
function viewState(agent:AgentProfile,persisted:AgentState|undefined,live:{state:string;activity:string;updated_at:string}|undefined,providers:UniversalProvider[]):RoomVisualState{if(agent.paused)return'paused';const provider=agent.provider_id?providers.find(p=>p.id===agent.provider_id):undefined;if(!provider||!provider.enabled||provider.health_status==='unavailable'||!agent.model_id)return'offline';const state=normalized(live?.state??persisted?.state??'idle');if(state!=='idle')return state;const at=live?.updated_at??persisted?.updated_at;if(at&&Date.now()-new Date(at).getTime()>agent.idle_after_seconds*1000)return'resting';return'idle'}

export function OfficeMap({agents,providers,states,liveStates,target,onTarget,lastHandoff}:{agents:AgentProfile[];providers:UniversalProvider[];states:AgentState[];liveStates:Record<string,{state:string;activity:string;updated_at:string}>;target:string;onTarget:(value:string)=>void;lastHandoff:{from:string;to:string}|null}){
  const stateById=new Map(states.map(x=>[x.agent_id,x]));
  const views:RoomAgentView[]=agents.map(agent=>{const state=viewState(agent,stateById.get(agent.id),liveStates[agent.id],providers);return{id:agent.id,name:agent.name,role:agent.role,state,activity:liveStates[agent.id]?.activity||stateById.get(agent.id)?.activity||STATE_LABELS[state],progress:stateById.get(agent.id)?.progress??null,station:stationFor(agent),selected:target===agent.id||target===agent.slug,disabled:state==='offline'}});
  return <div className="room-map" aria-label="Escritório operacional dos Agents">
    <div className="room-wall">
      <div className="room-window"><span/><span/><span/></div>
      <div className="room-brand"><strong>AGENT OFFICE</strong><span>operational workspace</span></div>
      <div className="room-clock">AO</div>
    </div>
    <div className="room-floor room-canvas-floor">
      <OfficeTileCanvas/>
      <div className={'room-stations canvas-stations count-'+Math.min(views.length,12)}>
        {views.map(agent=><AgentStation key={agent.id} agent={agent} onSelect={()=>onTarget(agent.selected?'auto':agent.id)}/>)}
        {!views.length&&<div className="room-empty"><strong>Nenhum Agent disponível</strong><span>Crie ou habilite um Agent para ocupar o escritório.</span></div>}
      </div>
      <div className="room-handoff">{lastHandoff?<><span>{lastHandoff.from}</span><i>→</i><span>{lastHandoff.to}</span></>:<><b/><span>Contexto compartilhado e handoffs ao vivo</span></>}</div>
    </div>
  </div>;
}
