import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentProfile, AgentState, UniversalProvider } from '../types.js';
import { AgentStation } from './AgentStation.js';
import { OfficeTileCanvas } from './OfficeTileCanvas.js';
import type { RoomAgentView, RoomVisualState, StationKind } from './roomTypes.js';

const WORLD_W=1680,WORLD_H=980,MIN_ZOOM=.42,MAX_ZOOM=1.9;
const STATION_POSITIONS:Record<StationKind,Array<[number,number]>>={
  development:[[690,300],[930,300],[690,465],[930,465],[810,382]],
  operations:[[1160,350],[1160,500],[1040,420],[1270,430]],
  research:[[410,700],[540,700],[470,815]],
  lead:[[900,690],[1040,690],[970,815]],
};
function stationPosition(agent:RoomAgentView,index:number){
  const positions=STATION_POSITIONS[agent.station]??STATION_POSITIONS.operations;
  const base=positions[index%positions.length];
  const cycle=Math.floor(index/positions.length);
  return{x:base[0]+cycle*34,y:base[1]+cycle*28};
}
const STATE_LABELS:Record<RoomVisualState,string>={offline:'Offline',idle:'Disponível',resting:'Em espera',thinking:'Pensando',planning:'Planejando',responding:'Respondendo',coding:'Programando',testing:'Testando',reviewing:'Revisando',waiting:'Aguardando',blocked:'Bloqueado',error:'Erro',paused:'Pausado',completed:'Concluído recentemente'};
function normalized(value:string):RoomVisualState{if(['offline','idle','resting','thinking','planning','responding','coding','testing','reviewing','waiting','blocked','error','paused','completed'].includes(value))return value as RoomVisualState;if(value==='running'||value==='working')return'responding';return'idle'}
function stationFor(agent:AgentProfile):StationKind{const text=(agent.role+' '+agent.description+' '+agent.name).toLowerCase();if(/review|research|pesquis|qa|test|auditor/.test(text))return'research';if(/lead|manager|gestor|orchestr|chief|coord/.test(text))return'lead';if(/develop|builder|code|codex|engineer|program/.test(text))return'development';return'operations'}
function viewState(agent:AgentProfile,persisted:AgentState|undefined,live:{state:string;activity:string;updated_at:string}|undefined,providers:UniversalProvider[]):RoomVisualState{if(agent.paused)return'paused';const provider=agent.provider_id?providers.find(p=>p.id===agent.provider_id):undefined;if(!provider||!provider.enabled||provider.health_status==='unavailable'||!agent.model_id)return'offline';const state=normalized(live?.state??persisted?.state??'idle');if(state!=='idle')return state;const at=live?.updated_at??persisted?.updated_at;if(at&&Date.now()-new Date(at).getTime()>agent.idle_after_seconds*1000)return'resting';return'idle'}
function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value))}

export function OfficeMap({agents,providers,states,liveStates,target,onTarget,lastHandoff}:{agents:AgentProfile[];providers:UniversalProvider[];states:AgentState[];liveStates:Record<string,{state:string;activity:string;updated_at:string}>;target:string;onTarget:(value:string)=>void;lastHandoff:{from:string;to:string}|null}){
  const stateById=new Map(states.map(x=>[x.agent_id,x]));
  const views:RoomAgentView[]=agents.map(agent=>{const state=viewState(agent,stateById.get(agent.id),liveStates[agent.id],providers);return{id:agent.id,name:agent.name,role:agent.role,state,activity:liveStates[agent.id]?.activity||stateById.get(agent.id)?.activity||STATE_LABELS[state],progress:stateById.get(agent.id)?.progress??null,station:stationFor(agent),selected:target===agent.id||target===agent.slug,disabled:state==='offline'}});
  const stationCounters:Record<StationKind,number>={development:0,operations:0,research:0,lead:0};
  const positionedViews=views.map(agent=>({agent,pos:stationPosition(agent,stationCounters[agent.station]++)}));
  const viewportRef=useRef<HTMLDivElement|null>(null);
  const dragRef=useRef<{pointerId:number;x:number;y:number;panX:number;panY:number}|null>(null);
  const [camera,setCamera]=useState({x:0,y:0,zoom:.7});
  const [viewportSize,setViewportSize]=useState({width:1,height:1});
  const [dragging,setDragging]=useState(false);
  const constrain=useCallback((next:{x:number;y:number;zoom:number})=>{
    const margin=90,scaledW=WORLD_W*next.zoom,scaledH=WORLD_H*next.zoom;
    const x=scaledW<=viewportSize.width?(viewportSize.width-scaledW)/2:clamp(next.x,viewportSize.width-scaledW-margin,margin);
    const y=scaledH<=viewportSize.height?(viewportSize.height-scaledH)/2:clamp(next.y,viewportSize.height-scaledH-margin,margin);
    return{...next,x,y};
  },[viewportSize]);

  const fit=useCallback(()=>{
    const el=viewportRef.current;if(!el)return;
    const rect=el.getBoundingClientRect();
    setViewportSize({width:rect.width,height:rect.height});
    const zoom=clamp(Math.min((rect.width-20)/WORLD_W,(rect.height-20)/WORLD_H),MIN_ZOOM,1);
    setCamera({zoom,x:(rect.width-WORLD_W*zoom)/2,y:(rect.height-WORLD_H*zoom)/2});
  },[constrain]);
  useEffect(()=>{const el=viewportRef.current;if(!el)return;const ro=new ResizeObserver(fit);ro.observe(el);fit();return()=>ro.disconnect()},[fit]);

  const zoomAt=useCallback((nextZoom:number,clientX?:number,clientY?:number)=>{
    const el=viewportRef.current;if(!el)return;
    const rect=el.getBoundingClientRect();
    setCamera(current=>{
      const z=clamp(nextZoom,MIN_ZOOM,MAX_ZOOM);
      const px=(clientX??(rect.left+rect.width/2))-rect.left,py=(clientY??(rect.top+rect.height/2))-rect.top;
      const wx=(px-current.x)/current.zoom,wy=(py-current.y)/current.zoom;
      return constrain({zoom:z,x:px-wx*z,y:py-wy*z});
    });
  },[]);
  const onWheel=(event:React.WheelEvent<HTMLDivElement>)=>{event.preventDefault();zoomAt(camera.zoom*(event.deltaY>0?.9:1.1),event.clientX,event.clientY)};
  const onPointerDown=(event:React.PointerEvent<HTMLDivElement>)=>{
    if((event.target as HTMLElement).closest('button,.room-map-controls'))return;
    dragRef.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,panX:camera.x,panY:camera.y};setDragging(true);event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove=(event:React.PointerEvent<HTMLDivElement>)=>{
    const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    setCamera(current=>constrain({...current,x:drag.panX+(event.clientX-drag.x),y:drag.panY+(event.clientY-drag.y)}));
  };
  const endDrag=(event:React.PointerEvent<HTMLDivElement>)=>{if(dragRef.current?.pointerId===event.pointerId)dragRef.current=null;setDragging(false)};
  const onKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    const step=event.shiftKey?90:45;
    if(event.key==='+'||event.key==='='){event.preventDefault();zoomAt(camera.zoom*1.14)}
    else if(event.key==='-'){event.preventDefault();zoomAt(camera.zoom/1.14)}
    else if(event.key==='0'){event.preventDefault();fit()}
    else if(event.key==='ArrowLeft'||event.key.toLowerCase()==='a'){event.preventDefault();setCamera(current=>constrain({...current,x:current.x+step}))}
    else if(event.key==='ArrowRight'||event.key.toLowerCase()==='d'){event.preventDefault();setCamera(current=>constrain({...current,x:current.x-step}))}
    else if(event.key==='ArrowUp'||event.key.toLowerCase()==='w'){event.preventDefault();setCamera(current=>constrain({...current,y:current.y+step}))}
    else if(event.key==='ArrowDown'||event.key.toLowerCase()==='s'){event.preventDefault();setCamera(current=>constrain({...current,y:current.y-step}))}
  };
  const miniLeft=clamp((-camera.x/camera.zoom)/WORLD_W*100,0,100);
  const miniTop=clamp((-camera.y/camera.zoom)/WORLD_H*100,0,100);
  const miniWidth=clamp((viewportSize.width/camera.zoom)/WORLD_W*100,3,100);
  const miniHeight=clamp((viewportSize.height/camera.zoom)/WORLD_H*100,3,100);
  const centerFromMinimap=(event:React.MouseEvent<HTMLDivElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect(),wx=((event.clientX-rect.left)/rect.width)*WORLD_W,wy=((event.clientY-rect.top)/rect.height)*WORLD_H;
    setCamera(current=>constrain({...current,x:viewportSize.width/2-wx*current.zoom,y:viewportSize.height/2-wy*current.zoom}));
  };

  const focusAgents=()=>{
    const el=viewportRef.current;if(!el)return;const rect=el.getBoundingClientRect(),z=clamp(Math.max(camera.zoom,.82),MIN_ZOOM,MAX_ZOOM);
    const worldX=WORLD_W*.51,worldY=WORLD_H*.52;setCamera(constrain({zoom:z,x:rect.width/2-worldX*z,y:rect.height/2-worldY*z}));
  };

  return <div className="room-map" aria-label="Escritório operacional dos Agents">
    <div className="room-wall">
      <div className="room-window"><span/><span/><span/></div>
      <div className="room-brand"><strong>AGENT OFFICE</strong><span>operational workspace</span></div>
      <div className="room-clock">AO</div>
    </div>
    <div ref={viewportRef} className={'room-floor room-canvas-floor room-viewport-shell'+(dragging?' dragging':'')} tabIndex={0} onKeyDown={onKeyDown} onDoubleClick={fit} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="room-camera-layer" style={{width:WORLD_W,height:WORLD_H,transform:`translate3d(${camera.x}px,${camera.y}px,0) scale(${camera.zoom})`}}>
        <OfficeTileCanvas/>
        <div className={'room-stations canvas-stations positioned-stations count-'+Math.min(views.length,12)}>
          {positionedViews.map(({agent,pos})=><div key={agent.id} className={'room-agent-anchor anchor-'+agent.station} style={{left:pos.x,top:pos.y}}><AgentStation agent={agent} onSelect={()=>onTarget(agent.selected?'auto':agent.id)}/></div>)}
          {!views.length&&<div className="room-empty"><strong>Nenhum Agent disponível</strong><span>Crie ou habilite um Agent para ocupar o escritório.</span></div>}
        </div>
        <div className="room-handoff">{lastHandoff?<><span>{lastHandoff.from}</span><i>→</i><span>{lastHandoff.to}</span></>:<><b/><span>Contexto compartilhado e handoffs ao vivo</span></>}</div>
      </div>
      <div className="room-map-controls" onPointerDown={event=>event.stopPropagation()}>
        <button type="button" onClick={()=>zoomAt(camera.zoom/1.16)} title="Afastar">−</button>
        <span>{Math.round(camera.zoom*100)}%</span>
        <button type="button" onClick={()=>zoomAt(camera.zoom*1.16)} title="Aproximar">+</button>
        <i/>
        <button type="button" className="wide" onClick={focusAgents}>Agents</button>
        <button type="button" className="wide" onClick={fit}>Visão geral</button>
      </div>
      <div className="room-minimap" onClick={centerFromMinimap} onPointerDown={event=>event.stopPropagation()} title="Clique para navegar">
        <OfficeTileCanvas/>
        <span className="room-minimap-viewport" style={{left:miniLeft+'%',top:miniTop+'%',width:Math.min(miniWidth,100-miniLeft)+'%',height:Math.min(miniHeight,100-miniTop)+'%'}}/>
      </div>
      <div className="room-navigation-hint">Arraste ou use WASD/setas para passear · Scroll para zoom · Duplo clique para visão geral</div>
    </div>
  </div>;
}
