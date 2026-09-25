import { Router, raw } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { VoiceService } from '../agent-office/voiceService.js';

export const voiceRouter=Router();
const audio=raw({type:['audio/wav','audio/x-wav','application/octet-stream'],limit:'25mb'});

voiceRouter.get('/voice/status',(req,res)=>{
  const d=openAgentOfficeDatabase();
  try{res.json({ok:true,data:new VoiceService(d.connection).status()})}
  finally{d.connection.close()}
});

voiceRouter.post('/voice/transcribe',audio,async(req,res)=>{
  const d=openAgentOfficeDatabase();
  try{
    const buffer=Buffer.isBuffer(req.body)?req.body:Buffer.from(req.body||[]);
    const language=typeof req.query.language==='string'&&req.query.language.trim()?req.query.language.trim():'pt';
    const result=await new VoiceService(d.connection).transcribe(buffer,language);
    res.json({ok:true,data:result});
  }catch(error){
    const code=error instanceof Error?error.message:'VOICE_TRANSCRIPTION_FAILED';
    const status=code==='VOICE_AUDIO_EMPTY'||code==='VOICE_AUDIO_TOO_LARGE'?400:code==='VOICE_TRANSCRIPTION_UNAVAILABLE'?503:500;
    res.status(status).json({ok:false,error:{code,message:code}});
  }finally{d.connection.close()}
});
