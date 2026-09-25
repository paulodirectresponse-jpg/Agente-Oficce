import { useEffect, useMemo, useState } from 'react';
import type { AgentOverview, AgentProfile, AgentToolPolicy, KnowledgeItem, ProviderModel, SkillDefinition, Subagent, Team, ToolDefinitionV2, UniversalProvider } from './types.js';
import { api } from './api.js';
import { AgentOperationsPanel } from './AgentOperationsPanel.js';
import { V2EmptyState, V2PageHeader, V2Status, V2Tabs } from './shell/V2Primitives.js';

type Tab='geral'|'inteligencia'|'conhecimento'|'skills'|'equipe'|'acesso'|'atividade'|'avancado';
type Draft={name:string;role:string;description:string;provider_id:string;model_id:string;system_prompt:string;enabled:boolean;slug:string;avatar_key:string;sort_order:number;idle_after_seconds:number};
const blank:Draft={name:'',role:'',description:'',provider_id:'',model_id:'',system_prompt:'',enabled:true,slug:'',avatar_key:'default',sort_order:10,idle_after_seconds:300};
const slugify=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const tabs:Array<{key:Tab;label:string}>=[
  {key:'geral',label:'Geral'},{key:'inteligencia',label:'Inteligência'},{key:'conhecimento',label:'Conhecimento'},{key:'skills',label:'Skills'},{key:'equipe',label:'Equipe'},
  {key:'acesso',label:'Acesso'},{key:'atividade',label:'Atividade'},{key:'avancado',label:'Avançado'},
];
function readinessLabel(value?:string){
  const map:Record<string,string>={ready:'Disponível',inactive:'Desativado',incomplete:'Precisa configurar',provider_unavailable:'IA indisponível',model_unavailable:'Modelo indisponível',error:'Precisa de atenção'};
  return map[value??'']??'Disponível';
}
function readinessTone(value?:string):'neutral'|'success'|'warning'|'danger'{
  if(value==='ready')return'success';
  if(value==='inactive')return'neutral';
  if(value==='provider_unavailable'||value==='model_unavailable'||value==='error')return'danger';
  return'warning';
}
function toolGroup(name:string){
  const n=name.toLowerCase();
  if(/file|fs_|read|write|copy|move|delete|directory/.test(n))return'Arquivos';
  if(/git/.test(n)&&!/github/.test(n))return'Git';
  if(/shell|command|npm|node|process|powershell/.test(n))return'Terminal';
  if(/browser/.test(n))return'Browser';
  if(/computer/.test(n))return'Computer';
  if(/github/.test(n))return'GitHub';
  if(/deploy|railway|vercel|netlify|fly/.test(n))return'Deploy';
  return'Outros';
}
export function EquipeView({agents,providers,onChanged}:{agents:AgentProfile[];providers:UniversalProvider[];onChanged:()=>void|Promise<void>}){
  const [selectedId,setSelectedId]=useState<string|null>(agents[0]?.id??null);
  const [creating,setCreating]=useState(false);
  const [tab,setTab]=useState<Tab>('geral');
  const [draft,setDraft]=useState<Draft>(blank);
  const [models,setModels]=useState<ProviderModel[]>([]);
  const [overview,setOverview]=useState<AgentOverview|null>(null);
  const [team,setTeam]=useState<Team|null>(null);
  const [subagents,setSubagents]=useState<Subagent[]>([]);
  const [tools,setTools]=useState<ToolDefinitionV2[]>([]);
  const [policy,setPolicy]=useState<Omit<AgentToolPolicy,'agent_id'|'updated_at'>>({enabled:true,allowed_tools:[],approval_mode:'auto',max_tool_steps:200});
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [subName,setSubName]=useState('');
  const [subRole,setSubRole]=useState('');
  const [knowledge,setKnowledge]=useState<KnowledgeItem[]>([]);
  const [skills,setSkills]=useState<SkillDefinition[]>([]);
  const [assignedSkills,setAssignedSkills]=useState<SkillDefinition[]>([]);
  const [skillName,setSkillName]=useState('');
  const [skillInstructions,setSkillInstructions]=useState('');
  const [selectedSubId,setSelectedSubId]=useState<string|null>(null);
  const [subKnowledge,setSubKnowledge]=useState<KnowledgeItem[]>([]);
  const [subSkills,setSubSkills]=useState<SkillDefinition[]>([]);
  const selected=creating?null:agents.find(x=>x.id===selectedId)??null;
  const selectedSub=subagents.find(x=>x.id===selectedSubId)??null;

  useEffect(()=>{if(!selectedId&&agents[0])setSelectedId(agents[0].id);if(selectedId&&!agents.some(x=>x.id===selectedId))setSelectedId(agents[0]?.id??null)},[agents,selectedId]);
  useEffect(()=>{void api.listToolDefinitionsV2().then(setTools).catch(()=>setTools([]))},[]);
  useEffect(()=>{
    setNotice(null);setError(null);setTab('geral');setSelectedSubId(null);setSubKnowledge([]);setSubSkills([]);
    if(!selected){if(!creating)return;setDraft(cur=>cur);setOverview(null);setTeam(null);setSubagents([]);setKnowledge([]);setSkills([]);setAssignedSkills([]);return}
    setDraft({name:selected.name,role:selected.role,description:selected.description,provider_id:selected.provider_id??'',model_id:selected.model_id??'',system_prompt:selected.system_prompt,enabled:selected.enabled,slug:selected.slug,avatar_key:selected.avatar_key||'default',sort_order:selected.sort_order,idle_after_seconds:selected.idle_after_seconds});
    void Promise.all([api.getAgentOverviewV2(selected.id),api.getOwnedTeamV3(selected.id),api.getAgentToolPolicyV2(selected.id),api.listKnowledge('agent',selected.id),api.listSkills(),api.listAssignedSkills('agent',selected.id)])
      .then(([o,t,p,k,s,a])=>{setOverview(o);setTeam(t);setSubagents(t?.subagents??[]);setKnowledge(k);setSkills(s);setAssignedSkills(a);setPolicy({enabled:p.enabled,allowed_tools:p.allowed_tools,approval_mode:p.approval_mode,max_tool_steps:p.max_tool_steps})})
      .catch(()=>{setOverview(null);setTeam(null);setSubagents([]);setKnowledge([]);setSkills([]);setAssignedSkills([])});
  },[selected?.id,creating]);
  useEffect(()=>{
    if(!selectedSub){setSubKnowledge([]);setSubSkills([]);return}
    void Promise.all([api.listKnowledge('subagent',selectedSub.id),api.listAssignedSkills('subagent',selectedSub.id)])
      .then(([knowledge,assigned])=>{setSubKnowledge(knowledge);setSubSkills(assigned)})
      .catch(()=>{setSubKnowledge([]);setSubSkills([])});
  },[selectedSub?.id]);

  useEffect(()=>{
    if(!draft.provider_id){setModels([]);return}
    void api.listProviderModelsV2(draft.provider_id).then(items=>{setModels(items);if(!draft.model_id){const m=items.find(x=>x.enabled&&x.is_default)??items.find(x=>x.enabled);if(m)setDraft(cur=>({...cur,model_id:m.id}))}}).catch(()=>setModels([]));
  },[draft.provider_id]);

  const startCreate=()=>{
    const p=providers.find(x=>x.enabled);
    setCreating(true);setSelectedId(null);setTab('geral');setDraft({...blank,provider_id:p?.id??'',sort_order:(Math.max(0,...agents.map(a=>a.sort_order))+10)});setPolicy({enabled:true,allowed_tools:tools.map(x=>x.name),approval_mode:'auto',max_tool_steps:200});
  };
  const save=async()=>{
    if(!draft.name.trim()){setError('Dê um nome ao Agent.');return}
    setBusy(true);setError(null);
    try{
      const payload={name:draft.name.trim(),slug:draft.slug||slugify(draft.name),role:draft.role.trim(),description:draft.description.trim(),provider_id:draft.provider_id||null,model_id:draft.model_id||null,system_prompt:draft.system_prompt,enabled:draft.enabled,avatar_key:draft.avatar_key,sort_order:draft.sort_order,idle_after_seconds:draft.idle_after_seconds};
      const saved=selected?await api.updateAgentV2(selected.id,payload):await api.createAgentV2(payload);
      await api.saveAgentToolPolicyV2(saved.id,policy);setCreating(false);setSelectedId(saved.id);await onChanged();setNotice('Agent salvo.');
    }catch(e){setError(e instanceof Error?e.message:'Falha ao salvar Agent.')}finally{setBusy(false)}
  };
  const remove=async()=>{if(!selected||!window.confirm('Excluir '+selected.name+'?'))return;setBusy(true);try{await api.deleteAgentV2(selected.id);setSelectedId(null);await onChanged()}catch(e){setError(e instanceof Error?e.message:'Falha ao excluir Agent.')}finally{setBusy(false)}};
  const ensureTeam=async()=>{if(!selected)return null;if(team)return team;const t=await api.createOwnedTeamV3(selected.id,{name:selected.name+' Team',slug:slugify(selected.slug+'-team'),purpose:'Equipe permanente de '+selected.name,max_parallelism:3,max_delegation_depth:2,allow_external_borrowing:true});setTeam(t);setSubagents(t.subagents??[]);return t};
  const addSubagent=async()=>{if(!selected||!subName.trim())return;setBusy(true);setError(null);try{const t=await ensureTeam();if(!t)return;await api.createOwnedSubagentV3(selected.id,{name:subName.trim(),slug:slugify(subName),role:subRole.trim(),description:'',system_prompt:'',provider_id:selected.provider_id,model_id:selected.model_id,enabled:true,paused:false});const list=await api.listOwnedSubagentsV3(selected.id);setSubagents(list);setTeam({...t,subagents:list});setSubName('');setSubRole('');setNotice('Subagent adicionado.')}catch(e){setError(e instanceof Error?e.message:'Falha ao adicionar Subagent.')}finally{setBusy(false)}};
  const deleteSub=async(sub:Subagent)=>{if(!team||!window.confirm('Remover '+sub.name+'?'))return;setBusy(true);try{await api.deleteTeamSubagentV3(team.id,sub.id);const list=await api.listOwnedSubagentsV3(selected!.id);setSubagents(list);setTeam({...team,subagents:list})}finally{setBusy(false)}};

  const groups=useMemo(()=>{const map=new Map<string,ToolDefinitionV2[]>();for(const tool of tools){const key=toolGroup(tool.name);map.set(key,[...(map.get(key)??[]),tool])}return [...map.entries()]},[tools]);
  const provider=providers.find(x=>x.id===draft.provider_id);
  const readiness=overview?.readiness??(selected?.enabled?'incomplete':'inactive');

  return <div className="team-v2-page">
    <V2PageHeader title="Equipe" subtitle="Seus Agents e os especialistas permanentes de cada um." actions={<button className="v2-primary-button" onClick={startCreate}>+ Novo Agent</button>}/>
    <div className="team-v2-layout">
      <aside className="team-v2-list">
        {agents.slice().sort((a,b)=>a.sort_order-b.sort_order).map(agent=><button type="button" key={agent.id} className={selected?.id===agent.id&&!creating?'active':''} onClick={()=>{setCreating(false);setSelectedId(agent.id)}}>
          <span className="team-v2-avatar">{agent.name.slice(0,1).toUpperCase()}</span><span><strong>{agent.name}</strong><small>{agent.role||'Agent'}</small></span><span className={'team-v2-dot '+(agent.enabled?'on':'off')}/>
        </button>)}
        {!agents.length&&<V2EmptyState title="Sua equipe está vazia" description="Crie um Agent para começar."/>}
      </aside>

      <section className="team-v2-detail">
        {!selected&&!creating&&<V2EmptyState title="Escolha um Agent" description="Abra um Agent para ver inteligência, equipe, acesso e atividade."/>}
        {(selected||creating)&&<>
          <div className="team-v2-hero">
            <div><span className="team-v2-avatar large">{(draft.name||'?').slice(0,1).toUpperCase()}</span><div><h2>{creating?'Novo Agent':draft.name}</h2><p>{draft.role||'Defina o papel deste Agent.'}</p></div></div>
            {!creating&&<V2Status tone={readinessTone(readiness)}>{readinessLabel(readiness)}</V2Status>}
          </div>
          <V2Tabs<Tab> items={tabs} value={tab} onChange={setTab} label="Detalhes do Agent"/>

          <div className="team-v2-panel">
            {tab==='geral'&&<>
              <div className="v2-form-grid"><label>Nome<input value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value,slug:selected?draft.slug:slugify(e.target.value)})}/></label><label>Função<input value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value})} placeholder="Ex.: Desenvolvedor"/></label></div>
              <label className="v2-field">O que este Agent deve fazer?<textarea rows={4} value={draft.description} onChange={e=>setDraft({...draft,description:e.target.value})} placeholder="Descreva em linguagem simples a responsabilidade principal."/></label>
              <label className="v2-check-row"><input type="checkbox" checked={draft.enabled} onChange={e=>setDraft({...draft,enabled:e.target.checked})}/><span><strong>Agent ativo</strong><small>Quando desativado, ele não é escolhido automaticamente.</small></span></label>
              {!creating&&overview&&<div className="team-v2-summary"><div><span>Disponibilidade</span><strong>{readinessLabel(overview.readiness)}</strong></div><div><span>Sucesso operacional</span><strong>{overview.performance.success_rate==null?'—':overview.performance.success_rate.toFixed(1)+'%'}</strong></div><div><span>Retrabalho</span><strong>{overview.performance.rework_rate==null?'—':overview.performance.rework_rate.toFixed(1)+'%'}</strong></div></div>}
            </>}

            {tab==='inteligencia'&&<>
              <div className="team-v2-callout"><strong>IA</strong><p>Deixe automático no uso normal ou escolha explicitamente quando precisar.</p></div>
              <div className="v2-form-grid"><label>Provider<select value={draft.provider_id} onChange={e=>setDraft({...draft,provider_id:e.target.value,model_id:''})}><option value="">Automático / não definido</option>{providers.map(p=><option key={p.id} value={p.id} disabled={!p.enabled}>{p.name}</option>)}</select></label><label>Modelo<select value={draft.model_id} onChange={e=>setDraft({...draft,model_id:e.target.value})} disabled={!draft.provider_id}><option value="">Padrão do provider</option>{models.filter(m=>m.enabled).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.is_default?' · padrão':''}</option>)}</select></label></div>
              <label className="v2-field">Instruções do Agent<textarea rows={10} value={draft.system_prompt} onChange={e=>setDraft({...draft,system_prompt:e.target.value})} placeholder="Como este Agent deve pensar e trabalhar?"/></label>
              {provider&&<small className="v2-help">Conexão: {provider.name} · {provider.health_status}</small>}
            </>}

            {tab==='conhecimento'&&<>
              {creating?<V2EmptyState title="Salve o Agent primeiro" description="Depois você poderá adicionar documentos e referências persistentes."/>:<>
                <div className="team-v2-callout"><strong>Conhecimento persistente</strong><p>Arquivos adicionados aqui continuam disponíveis para este Agent em novas conversas. É memória consultável, não fine-tuning.</p></div>
                <label className="knowledge-upload">+ Adicionar arquivo<input type="file" multiple onChange={async e=>{const files=Array.from(e.target.files??[]);e.currentTarget.value='';if(!selected||!files.length)return;setBusy(true);setError(null);try{for(const file of files){const resource=await api.uploadResource('',file,'agent',selected.id);await api.addKnowledge({scope_type:'agent',scope_id:selected.id,resource_id:resource.id,title:file.name})}setKnowledge(await api.listKnowledge('agent',selected.id));setNotice('Conhecimento adicionado.')}catch(err){setError(err instanceof Error?err.message:'Falha ao adicionar conhecimento.')}finally{setBusy(false)}}}/></label>
                <div className="knowledge-list">{knowledge.map(item=><div key={item.id}><div><strong>{item.title}</strong><small>{item.resource?.mime_type||'arquivo'} · {item.resource?.metadata?.text_extracted?'texto extraído':'arquivo preservado'}</small></div><button type="button" onClick={()=>void api.deleteKnowledge(item.id).then(()=>setKnowledge(cur=>cur.filter(x=>x.id!==item.id)))}>Remover</button></div>)}{!knowledge.length&&<V2EmptyState title="Sem conhecimento extra" description="Adicione manuais, exemplos, documentos, código ou referências."/>}</div>
              </>}
            </>}

            {tab==='skills'&&<>
              {creating?<V2EmptyState title="Salve o Agent primeiro" description="Depois você poderá ligar Skills reutilizáveis a ele."/>:<>
                <div className="team-v2-callout"><strong>Skills reutilizáveis</strong><p>Uma Skill é um procedimento reutilizável. Ela não vira um Agent e não muda a hierarquia da equipe.</p><button type="button" className="v2-quiet-button" onClick={async()=>{setBusy(true);setError(null);try{await api.syncSkills();setSkills(await api.listSkills());setNotice('Skills de .agents/skills sincronizadas.')}catch(err){setError(err instanceof Error?err.message:'Falha ao sincronizar Skills.')}finally{setBusy(false)}}}>Sincronizar .agents/skills</button></div>
                <div className="skill-create"><input value={skillName} onChange={e=>setSkillName(e.target.value)} placeholder="Nome da Skill"/><textarea rows={4} value={skillInstructions} onChange={e=>setSkillInstructions(e.target.value)} placeholder="Quando usar e como executar esta Skill"/><button type="button" className="v2-primary-button" disabled={busy||!skillName.trim()||!skillInstructions.trim()} onClick={async()=>{if(!selected)return;setBusy(true);setError(null);try{const skill=await api.createSkill({name:skillName.trim(),instructions:skillInstructions.trim()});await api.assignSkill(skill.id,'agent',selected.id);setSkills(await api.listSkills());setAssignedSkills(await api.listAssignedSkills('agent',selected.id));setSkillName('');setSkillInstructions('');setNotice('Skill criada e adicionada ao Agent.')}catch(err){setError(err instanceof Error?err.message:'Falha ao criar Skill.')}finally{setBusy(false)}}}>Criar Skill</button></div>
                <div className="skill-list">{skills.map(skill=>{const on=assignedSkills.some(x=>x.id===skill.id);return <label key={skill.id}><input type="checkbox" checked={on} onChange={async e=>{if(!selected)return;try{if(e.target.checked)await api.assignSkill(skill.id,'agent',selected.id);else await api.unassignSkill(skill.id,'agent',selected.id);setAssignedSkills(await api.listAssignedSkills('agent',selected.id))}catch(err){setError(err instanceof Error?err.message:'Falha ao atualizar Skill.')}}}/><span><strong>{skill.name}</strong><small>{skill.description||skill.instructions.slice(0,110)}</small></span></label>})}{!skills.length&&<V2EmptyState title="Nenhuma Skill criada" description="Crie a primeira Skill para padronizar uma forma de trabalhar."/>}</div>
              </>}
            </>}

            {tab==='equipe'&&<>
              {creating?<V2EmptyState title="Salve o Agent primeiro" description="Depois você poderá adicionar especialistas permanentes a ele."/>:<>
                <div className="team-v2-tree"><div className="team-v2-owner"><span className="team-v2-avatar">{selected!.name.slice(0,1)}</span><div><strong>{selected!.name}</strong><small>Agent principal · owner</small></div></div>
                <div className="team-v2-subs">{subagents.map(sub=><div key={sub.id} className={selectedSub?.id===sub.id?'active':''}><span className="team-v2-tree-line"/><span className="team-v2-avatar sub">{sub.name.slice(0,1)}</span><div><strong>{sub.name}</strong><small>{sub.role||'Subagent'} · {sub.paused?'pausado':sub.enabled?'ativo':'desativado'}</small></div><button type="button" onClick={()=>setSelectedSubId(cur=>cur===sub.id?null:sub.id)}>{selectedSub?.id===sub.id?'Fechar':'Configurar'}</button><button type="button" onClick={()=>void deleteSub(sub)}>Remover</button></div>)}{!subagents.length&&<p>Este Agent trabalha sozinho. Adicione um Subagent quando quiser especializar parte do trabalho.</p>}</div></div>
                {selectedSub&&<section className="subagent-resource-panel">
                  <div className="team-v2-callout"><strong>{selectedSub.name}</strong><p>Conhecimento e Skills abaixo pertencem somente a este Subagent. Ele continua subordinado a {selected!.name}.</p></div>
                  <div className="subagent-resource-grid">
                    <div><h4>Conhecimento</h4><label className="knowledge-upload">+ Adicionar arquivo<input type="file" multiple onChange={async e=>{const files=Array.from(e.target.files??[]);e.currentTarget.value='';if(!files.length)return;setBusy(true);try{for(const file of files){const resource=await api.uploadResource('',file,'subagent',selectedSub.id);await api.addKnowledge({scope_type:'subagent',scope_id:selectedSub.id,resource_id:resource.id,title:file.name})}setSubKnowledge(await api.listKnowledge('subagent',selectedSub.id))}catch(err){setError(err instanceof Error?err.message:'Falha ao adicionar conhecimento.')}finally{setBusy(false)}}}/></label><div className="knowledge-list">{subKnowledge.map(item=><div key={item.id}><div><strong>{item.title}</strong><small>{item.resource?.mime_type||'arquivo'}</small></div><button type="button" onClick={()=>void api.deleteKnowledge(item.id).then(()=>api.listKnowledge('subagent',selectedSub.id).then(setSubKnowledge))}>Remover</button></div>)}{!subKnowledge.length&&<small className="v2-help">Nenhum conhecimento exclusivo.</small>}</div></div>
                    <div><h4>Skills</h4><div className="skill-list">{skills.map(skill=>{const on=subSkills.some(x=>x.id===skill.id);return <label key={skill.id}><input type="checkbox" checked={on} onChange={async e=>{try{if(e.target.checked)await api.assignSkill(skill.id,'subagent',selectedSub.id);else await api.unassignSkill(skill.id,'subagent',selectedSub.id);setSubSkills(await api.listAssignedSkills('subagent',selectedSub.id))}catch(err){setError(err instanceof Error?err.message:'Falha ao atualizar Skill.')}}}/><span><strong>{skill.name}</strong><small>{skill.description||skill.instructions.slice(0,90)}</small></span></label>})}{!skills.length&&<small className="v2-help">Nenhuma Skill disponível.</small>}</div></div>
                  </div>
                </section>}
                <div className="team-v2-add-sub"><input value={subName} onChange={e=>setSubName(e.target.value)} placeholder="Nome do especialista"/><input value={subRole} onChange={e=>setSubRole(e.target.value)} placeholder="Função (opcional)"/><button className="v2-primary-button" disabled={busy||!subName.trim()} onClick={()=>void addSubagent()}>Adicionar Subagent</button></div>
                {team&&<details className="v2-disclosure"><summary>Configurações da equipe</summary><div><p><strong>{team.name}</strong> · v{team.current_version}</p><p>{team.purpose}</p><small>Esta Team pertence somente a {selected!.name}. Outros Agents nunca viram subordinados.</small></div></details>}
              </>}
            </>}

            {tab==='acesso'&&<>
              <div className="team-v2-access-head"><div><strong>Full Access</strong><p>Os recursos locais disponíveis ficam acessíveis conforme as políticas e aprovações do runtime.</p></div><V2Status tone="success">Ativo</V2Status></div>
              <div className="team-v2-tool-groups">{groups.map(([name,list])=><details key={name}><summary><span>{name}</span><small>{list.length} recursos</small></summary><div>{list.map(tool=><span key={tool.name}>{tool.name}<small>{tool.risk}</small></span>)}</div></details>)}</div>
              <details className="v2-disclosure"><summary>Política avançada de acesso</summary><div className="v2-form-grid"><label>Aprovações<select value={policy.approval_mode} onChange={e=>setPolicy({...policy,approval_mode:e.target.value as any})}><option value="auto">Automático</option><option value="safe">Seguro</option><option value="manual">Manual</option></select></label><label>Máximo de ações<input type="number" value={policy.max_tool_steps} onChange={e=>setPolicy({...policy,max_tool_steps:Math.max(1,Number(e.target.value)||1)})}/></label></div></details>
            </>}

            {tab==='atividade'&&(selected?<AgentOperationsPanel agent={selected} onChanged={onChanged}/>:<V2EmptyState title="Sem atividade ainda" description="Salve o Agent para começar a registrar execuções."/> )}

            {tab==='avancado'&&<>
              <div className="v2-form-grid"><label>Slug<input value={draft.slug} onChange={e=>setDraft({...draft,slug:slugify(e.target.value)})}/></label><label>Ordem<input type="number" value={draft.sort_order} onChange={e=>setDraft({...draft,sort_order:Number(e.target.value)||0})}/></label><label>Avatar<input value={draft.avatar_key} onChange={e=>setDraft({...draft,avatar_key:e.target.value})}/></label><label>Descansar após (s)<input type="number" min={30} value={draft.idle_after_seconds} onChange={e=>setDraft({...draft,idle_after_seconds:Math.max(30,Number(e.target.value)||300)})}/></label></div>
              <p className="v2-help">Capabilities aprendidas e evidências continuam preservadas pelo backend; controles de baixo nível permanecem disponíveis nas áreas de diagnóstico enquanto a migração visual termina.</p>
            </>}

            <div className="team-v2-actions"><button className="v2-primary-button" disabled={busy} onClick={()=>void save()}>{busy?'Salvando…':'Salvar Agent'}</button>{selected&&<button className="v2-danger-button" disabled={busy} onClick={()=>void remove()}>Excluir Agent</button>}</div>
            {notice&&<div className="v2-notice success">{notice}</div>}{error&&<div className="v2-notice error" role="alert">{error}</div>}
          </div>
        </>}
      </section>
    </div>
  </div>;
}
