import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import type { VoiceStatus } from '../types.js';

function wavBlob(chunks:Float32Array[],sampleRate:number){
  const length=chunks.reduce((sum,chunk)=>sum+chunk.length,0);
  const buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
  const write=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i))};
  write(0,'RIFF');view.setUint32(4,36+length*2,true);write(8,'WAVE');write(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,length*2,true);
  let offset=44;
  for(const chunk of chunks)for(let i=0;i<chunk.length;i++,offset+=2){const sample=Math.max(-1,Math.min(1,chunk[i]));view.setInt16(offset,sample<0?sample*0x8000:sample*0x7fff,true)}
  return new Blob([buffer],{type:'audio/wav'});
}

export function VoiceInputButton({onTranscript,disabled=false}:{onTranscript:(text:string)=>void;disabled?:boolean}){
  const [status,setStatus]=useState<VoiceStatus|null>(null);
  const [state,setState]=useState<'idle'|'recording'|'transcribing'>('idle');
  const [seconds,setSeconds]=useState(0);
  const [error,setError]=useState<string|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const contextRef=useRef<AudioContext|null>(null);
  const sourceRef=useRef<MediaStreamAudioSourceNode|null>(null);
  const processorRef=useRef<ScriptProcessorNode|null>(null);
  const chunksRef=useRef<Float32Array[]>([]);
  const sampleRateRef=useRef(48000);
  const timerRef=useRef<number|null>(null);

  useEffect(()=>{void api.getVoiceStatus().then(setStatus).catch(()=>setStatus(null));return()=>{void stopCapture(false)}},[]);
  useEffect(()=>{
    if(state!=='recording')return;
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();stopCapture(false)}};
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[state]);

  const cleanup=()=>{
    if(timerRef.current!==null){window.clearInterval(timerRef.current);timerRef.current=null}
    processorRef.current?.disconnect();sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach(track=>track.stop());
    void contextRef.current?.close().catch(()=>undefined);
    processorRef.current=null;sourceRef.current=null;streamRef.current=null;contextRef.current=null;
  };

  async function start(){
    if(disabled||state!=='idle')return;
    setError(null);
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      const context=new AudioContext();await context.resume();
      const source=context.createMediaStreamSource(stream),processor=context.createScriptProcessor(4096,1,1);
      chunksRef.current=[];sampleRateRef.current=context.sampleRate;
      processor.onaudioprocess=event=>chunksRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      source.connect(processor);processor.connect(context.destination);
      streamRef.current=stream;contextRef.current=context;sourceRef.current=source;processorRef.current=processor;
      setSeconds(0);setState('recording');
      timerRef.current=window.setInterval(()=>setSeconds(value=>{if(value>=119){void stopCapture(true);return 120}return value+1}),1000);
    }catch(reason){
      cleanup();setState('idle');
      const name=reason instanceof DOMException?reason.name:'';
      setError(name==='NotAllowedError'?'Permissão do microfone negada.':'Não foi possível abrir o microfone.');
    }
  }

  async function stopCapture(transcribe=true){
    const wasRecording=state==='recording'||Boolean(processorRef.current);
    const chunks=chunksRef.current.slice(),rate=sampleRateRef.current;chunksRef.current=[];
    cleanup();setSeconds(0);
    if(!wasRecording){setState('idle');return}
    if(!transcribe){setState('idle');return}
    setState('transcribing');setError(null);
    try{
      const blob=wavBlob(chunks,rate);
      if(blob.size<1000)throw new Error('VOICE_AUDIO_EMPTY');
      const result=await api.transcribeVoice(blob,'pt');
      if(result.text.trim())onTranscript(result.text.trim());
      setStatus(await api.getVoiceStatus().catch(()=>status));
    }catch(reason){
      const message=reason instanceof Error?reason.message:'VOICE_TRANSCRIPTION_FAILED';
      setError(message==='VOICE_TRANSCRIPTION_UNAVAILABLE'
        ?'Transcrição indisponível. Configure whisper.cpp local ou um provider compatível.'
        :message==='VOICE_AUDIO_EMPTY'?'Não detectei áudio suficiente.':'Falha ao transcrever a gravação.');
    }finally{setState('idle')}
  }

  const mode=status?.mode==='local'?'Whisper local':status?.mode==='cloud'?(status.cloud_provider||'Provider'):'Voz';
  const mm=String(Math.floor(seconds/60)).padStart(2,'0'),ss=String(seconds%60).padStart(2,'0');
  return <div className="voice-input-wrap">
    <button type="button" className={'voice-input-button '+state} disabled={disabled||state==='transcribing'} title={state==='recording'?'Parar e transcrever · Esc cancela':mode+' · clique para falar'} onClick={()=>state==='recording'?void stopCapture(true):void start()} aria-label={state==='recording'?'Parar gravação':'Comando por voz'}>
      {state==='recording'?<><span className="voice-pulse"/>🎙 <small>{mm}:{ss}</small></>:state==='transcribing'?<><span className="voice-spinner"/>…</>:<>🎙</>}
    </button>
    {state==='recording'&&<button type="button" className="voice-cancel-button" onClick={()=>void stopCapture(false)} title="Cancelar gravação">×</button>}
    {error&&<span className="voice-input-error" role="status">{error}</span>}
  </div>;
}
