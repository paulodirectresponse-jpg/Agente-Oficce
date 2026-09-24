import { RoomSpecSchema, type RoomSpec } from './roomSpec.js';

function make(input:Omit<RoomSpec,'schemaVersion'>):RoomSpec{
  return RoomSpecSchema.parse({schemaVersion:1,...input});
}

export const ROOM_TEMPLATES:Record<string,RoomSpec>={
  development:make({
    id:'development.default',name:'Development',teamType:'development',roomType:'development',capacity:6,
    dimensions:{widthTiles:30,heightTiles:20,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'warm-wood',density:'dense'},
    requirements:{workstations:6,meetingSeats:4,whiteboards:1,servers:0,loungeSeats:3,storageUnits:3,plants:8,displays:2},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['tech','glass','premium'],excludedTags:['retro'],
  }),
  infra:make({
    id:'infra.default',name:'Infra',teamType:'infra',roomType:'infra',capacity:4,
    dimensions:{widthTiles:24,heightTiles:18,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'dark-tech',density:'dense'},
    requirements:{workstations:4,meetingSeats:0,whiteboards:1,servers:6,loungeSeats:1,storageUnits:4,plants:3,displays:4},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['tech','server','network'],excludedTags:['residential'],
  }),
  research:make({
    id:'research.default',name:'Research / QA',teamType:'research',roomType:'research',capacity:5,
    dimensions:{widthTiles:28,heightTiles:19,tileSize:32},
    style:{theme:'agent-office-premium',accent:'blue',material:'warm-wood',density:'dense'},
    requirements:{workstations:5,meetingSeats:4,whiteboards:2,servers:0,loungeSeats:2,storageUnits:3,plants:6,displays:3},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['tech','collaboration','testing'],excludedTags:['retro'],
  }),
  operations:make({
    id:'operations.default',name:'Operations',teamType:'operations',roomType:'operations',capacity:6,
    dimensions:{widthTiles:30,heightTiles:20,tileSize:32},
    style:{theme:'agent-office-premium',accent:'blue',material:'dark-tech',density:'dense'},
    requirements:{workstations:6,meetingSeats:2,whiteboards:1,servers:0,loungeSeats:2,storageUnits:4,plants:5,displays:6},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['operations','dashboard','tech'],excludedTags:['residential'],
  }),
  leadership:make({
    id:'leadership.default',name:'Leadership',teamType:'leadership',roomType:'leadership',capacity:4,
    dimensions:{widthTiles:26,heightTiles:18,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'executive-wood',density:'balanced'},
    requirements:{workstations:2,meetingSeats:6,whiteboards:1,servers:0,loungeSeats:4,storageUnits:4,plants:8,displays:2},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['executive','premium','luxury'],excludedTags:['industrial'],
  }),
  strategy:make({
    id:'strategy.default',name:'Strategy',teamType:'strategy',roomType:'strategy',capacity:8,
    dimensions:{widthTiles:28,heightTiles:19,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'warm-wood',density:'balanced'},
    requirements:{workstations:2,meetingSeats:8,whiteboards:3,servers:0,loungeSeats:2,storageUnits:2,plants:6,displays:2},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['meeting','collaboration','premium'],excludedTags:['retro'],
  }),
  design:make({
    id:'design.default',name:'Design / Media',teamType:'design',roomType:'design',capacity:5,
    dimensions:{widthTiles:30,heightTiles:20,tileSize:32},
    style:{theme:'agent-office-premium',accent:'purple',material:'warm-wood',density:'dense'},
    requirements:{workstations:5,meetingSeats:3,whiteboards:2,servers:0,loungeSeats:3,storageUnits:4,plants:7,displays:5},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['studio','media','creative','tech'],excludedTags:['retro'],
  }),
  lobby:make({
    id:'lobby.default',name:'Lobby',teamType:'reception',roomType:'lobby',capacity:8,
    dimensions:{widthTiles:30,heightTiles:18,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'premium-stone',density:'balanced'},
    requirements:{workstations:1,meetingSeats:0,whiteboards:0,servers:0,loungeSeats:8,storageUnits:2,plants:10,displays:2},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['reception','glass','premium'],excludedTags:['industrial'],
  }),
  lounge:make({
    id:'lounge.default',name:'Lounge / Café',teamType:'general',roomType:'lounge',capacity:10,
    dimensions:{widthTiles:28,heightTiles:18,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'warm-wood',density:'balanced'},
    requirements:{workstations:0,meetingSeats:4,whiteboards:0,servers:0,loungeSeats:8,storageUnits:3,plants:12,displays:1},
    zones:[],requiredTags:['modern','corporate'],preferredTags:['lounge','coffee','biophilic'],excludedTags:['industrial'],
  }),
};

export function getRoomTemplate(type:string){
  return ROOM_TEMPLATES[type]??make({
    id:`${type}.generated`,name:type,teamType:type,roomType:type,capacity:4,
    dimensions:{widthTiles:24,heightTiles:18,tileSize:32},
    style:{theme:'agent-office-premium',accent:'cyan',material:'warm-wood',density:'balanced'},
    requirements:{workstations:4,meetingSeats:2,whiteboards:1,servers:0,loungeSeats:2,storageUnits:2,plants:5,displays:1},
    zones:[],requiredTags:['modern','corporate'],preferredTags:[],excludedTags:[],
  });
}
