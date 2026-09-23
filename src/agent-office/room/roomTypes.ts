export type RoomVisualState='offline'|'idle'|'resting'|'thinking'|'planning'|'responding'|'coding'|'testing'|'reviewing'|'waiting'|'blocked'|'error'|'paused'|'completed';
export type StationKind='development'|'research'|'lead'|'operations';
export interface RoomAgentView {id:string;name:string;role:string;state:RoomVisualState;activity:string;progress:number|null;station:StationKind;selected:boolean;disabled:boolean;}
