import { describe, expect, it } from 'vitest';
import { AGENT_OFFICE_PREMIUM_STYLE, packsForRoom } from './catalogStyles.js';

describe('Agent Office catalog style',()=>{
  it('pins a coherent primary pack for every current room family',()=>{
    const rooms=['development','infra','research','operations','leadership','strategy','design','lobby','lounge'];
    for(const room of rooms){
      const packs=packsForRoom(AGENT_OFFICE_PREMIUM_STYLE,room);
      expect(packs.length).toBeGreaterThan(0);
      expect(new Set(packs).size).toBe(packs.length);
    }
  });

  it('uses the approved modern corporate family as Development primary art',()=>{
    expect(packsForRoom(AGENT_OFFICE_PREMIUM_STYLE,'development')[0]).toBe('top-down-modern-corporate-office-v1.2');
  });

  it('falls back safely for future room types',()=>{
    expect(packsForRoom(AGENT_OFFICE_PREMIUM_STYLE,'future-ai-lab')).toEqual(AGENT_OFFICE_PREMIUM_STYLE.fallbackPacks);
  });
});
