import { z } from 'zod';

export const AssetStyleProfileSchema=z.object({
  schemaVersion:z.literal(1),
  id:z.string().min(1),
  name:z.string().min(1),
  palette:z.object({
    shell:z.array(z.string()).default([]),
    interior:z.array(z.string()).default([]),
    accents:z.array(z.string()).default([]),
    lighting:z.array(z.string()).default([]),
  }),
  preferredTags:z.array(z.string()).default([]),
  excludedTags:z.array(z.string()).default([]),
  fallbackPacks:z.array(z.string()).default([]),
  roomPackPriority:z.record(z.array(z.string())).default({}),
});
export type AssetStyleProfile=z.infer<typeof AssetStyleProfileSchema>;

export const AGENT_OFFICE_PREMIUM_STYLE:AssetStyleProfile=AssetStyleProfileSchema.parse({
  schemaVersion:1,
  id:'agent-office-premium',
  name:'Agent Office Premium',
  palette:{
    shell:['navy','deep-teal','graphite'],
    interior:['warm-wood','sand','cool-gray'],
    accents:['cyan','electric-blue','mint'],
    lighting:['warm-amber','cool-cyan'],
  },
  preferredTags:['modern','corporate','premium','glass','tech','biophilic'],
  excludedTags:['retro','residential'],
  fallbackPacks:[
    'modular-office-builder-essentials-v1.0',
    'corporate-office-v1.1',
    'corporate-office-asset-v1.2',
  ],
  roomPackPriority:{
    development:[
      'top-down-modern-corporate-office-v1.2',
      'animated-corporate-office-v1.1',
      'financial-trading-floor-v1.4',
      'modular-office-builder-essentials-v1.0',
      'corporate-office-v1.1',
    ],
    infra:[
      'it-network-operations-v1.0',
      'police-dispatch-v1.0',
      'modular-office-builder-essentials-v1.0',
    ],
    research:[
      'financial-trading-floor-v1.4',
      'meeting-training-center-v1.0',
      'top-down-modern-corporate-office-v1.2',
      'corporate-office-v1.1',
    ],
    operations:[
      'financial-trading-floor-v1.4',
      'police-dispatch-v1.0',
      'call-center-v1.0',
      'top-down-modern-corporate-office-v1.2',
    ],
    leadership:[
      'corporate-headquarters',
      'luxury-office-v1.0',
      'law-firm-v1.1',
      'top-down-modern-corporate-office-v1.2',
    ],
    strategy:[
      'meeting-training-center-v1.0',
      'corporate-headquarters',
      'law-firm-v1.1',
      'top-down-modern-corporate-office-v1.2',
    ],
    design:[
      'newsroom-editorial-v1.0',
      'top-down-modern-corporate-office-v1.2',
      'corporate-office-v1.1',
    ],
    lobby:[
      'modern-corporate-lobby-v1.1',
      'luxury-office-v1.0',
      'top-down-modern-corporate-office-v1.2',
    ],
    lounge:[
      'luxury-office-v1.0',
      'corporate-headquarters',
      'office-workday-v1.0',
      'top-down-modern-corporate-office-v1.2',
    ],
  },
});

export function packsForRoom(style:AssetStyleProfile,roomType:string){
  return style.roomPackPriority[roomType]??style.fallbackPacks;
}
