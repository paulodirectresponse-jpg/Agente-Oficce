import { AgentAvatar } from './AgentAvatar.js';
import type { RoomAgentView } from './roomTypes.js';
export function AgentStation({agent,onSelect}:{agent:RoomAgentView;onSelect:()=>void}){
  return <button type="button" className={'room-station station-'+agent.station+' state-'+agent.state+(agent.selected?' selected':'')} onClick={onSelect} disabled={agent.disabled} title={agent.disabled?'Configure provider e modelo para usar este Agent':'Enviar a próxima mensagem diretamente para '+agent.name}>
    <div className="room-status-card"><span className="room-status-dot"/><div><strong>{agent.name}</strong><small>{agent.activity}</small></div>{agent.progress!=null&&<span className="room-progress"><i style={{width:Math.max(8,Math.min(100,agent.progress*100))+'%'}}/></span>}</div>
    <div className="room-desk"><span className="room-desk-top"/><span className="room-monitor main"><i/></span>{(agent.station==='development'||agent.station==='lead')&&<span className="room-monitor aux"><i/></span>}{agent.station==='research'&&<><span className="room-books"/><span className="room-paper"/></>}{agent.station==='lead'&&<span className="room-dashboard"/>}{agent.station==='operations'&&<span className="room-radio"/>}<span className="room-keyboard"/><span className="room-chair"/><AgentAvatar id={agent.id} name={agent.name} state={agent.state}/></div>
    <div className="room-nameplate"><strong>{agent.name}</strong><span>{agent.role||'AI Agent'}</span></div>
  </button>;
}
