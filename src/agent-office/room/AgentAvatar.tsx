import type { CSSProperties } from 'react';
import type { RoomVisualState } from './roomTypes.js';
function hash(value:string){let h=0;for(let i=0;i<value.length;i++)h=(h*31+value.charCodeAt(i))>>>0;return h}
export function AgentAvatar({id,name,state}:{id:string;name:string;state:RoomVisualState}){
  const h=hash(id||name);
  const skin=['#f0c39b','#dca77e','#c9855f','#8f5c45'][h%4];
  const hair=['#1f2532','#5a382b','#2c4258','#6b5432','#382f4f'][(h>>2)%5];
  const shirt=['#2f7bd4','#5360d4','#267c7d','#8b5a9d','#566a7d'][(h>>5)%5];
  const style={'--avatar-skin':skin,'--avatar-hair':hair,'--avatar-shirt':shirt} as CSSProperties;
  return <div className={'room-avatar state-'+state} style={style} aria-label={name+' · '+state}>
    <span className="room-avatar-shadow"/><span className="room-avatar-body"/>
    <span className="room-avatar-head"><i className="room-avatar-hair"/><i className="room-avatar-face"/></span>
    <span className="room-avatar-arm left"/><span className="room-avatar-arm right"/>
    {(state==='thinking'||state==='planning')&&<span className="room-thought">···</span>}
    {(state==='blocked'||state==='error')&&<span className="room-alert">!</span>}
  </div>;
}
