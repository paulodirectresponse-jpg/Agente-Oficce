import type { CSSProperties } from 'react';
import type { RoomVisualState, StationKind } from './roomTypes.js';
function hash(value:string){let h=0;for(let i=0;i<value.length;i++)h=(h*31+value.charCodeAt(i))>>>0;return h}
const SPRITES:Record<StationKind,string>={
  development:'/office-assets/characters/software-engineer.png',
  research:'/office-assets/characters/qa-engineer.png',
  lead:'/office-assets/characters/tech-lead.png',
  operations:'/office-assets/characters/product-owner.png',
};
export function AgentAvatar({id,name,state,station}:{id:string;name:string;state:RoomVisualState;station:StationKind}){
  const h=hash(id||name),frame=h%6;
  const style={'--sprite-offset':`${-frame*32}px`} as CSSProperties;
  return <div className={'room-avatar room-pixel-avatar state-'+state} style={style} aria-label={name+' · '+state}>
    <span className="room-avatar-shadow"/>
    <span className="room-pixel-frame"><img src={SPRITES[station]} alt="" draggable={false}/></span>
    {(state==='thinking'||state==='planning')&&<span className="room-thought">···</span>}
    {(state==='blocked'||state==='error')&&<span className="room-alert">!</span>}
  </div>;
}
