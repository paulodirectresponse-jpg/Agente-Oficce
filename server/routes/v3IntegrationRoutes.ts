import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { IntegrationRegistryService } from '../agent-office/integrationRegistry.js';

export const v3IntegrationRouter=Router();

v3IntegrationRouter.get('/integrations/catalog',(_req,res)=>{
  const db=openAgentOfficeDatabase();
  try{res.json({ok:true,data:new IntegrationRegistryService(db.connection).catalog()})}
  finally{db.connection.close()}
});

v3IntegrationRouter.get('/integrations',(_req,res)=>{
  const db=openAgentOfficeDatabase();
  try{res.json({ok:true,data:new IntegrationRegistryService(db.connection).list()})}
  finally{db.connection.close()}
});

v3IntegrationRouter.post('/integrations',async(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const data=await new IntegrationRegistryService(db.connection).create({
      driver:String(req.body?.driver||''),
      name:typeof req.body?.name==='string'?req.body.name:undefined,
      auth_mode:typeof req.body?.auth_mode==='string'?req.body.auth_mode:undefined,
      secret:typeof req.body?.secret==='string'&&req.body.secret?req.body.secret:undefined,
      config:req.body?.config&&typeof req.body.config==='object'?req.body.config:undefined,
      metadata:req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:undefined,
      enabled:req.body?.enabled===undefined?undefined:Boolean(req.body.enabled),
    });
    res.status(201).json({ok:true,data});
  }catch(error){
    const code=error instanceof Error?error.message:'INTEGRATION_CREATE_FAILED';
    res.status(code.includes('UNSUPPORTED')?400:500).json({ok:false,error:{code,message:code}});
  }finally{db.connection.close()}
});

v3IntegrationRouter.get('/integrations/:integrationId',(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const data=new IntegrationRegistryService(db.connection).get(req.params.integrationId);
    if(!data){res.status(404).json({ok:false,error:{code:'INTEGRATION_NOT_FOUND',message:'INTEGRATION_NOT_FOUND'}});return}
    res.json({ok:true,data});
  }finally{db.connection.close()}
});

v3IntegrationRouter.patch('/integrations/:integrationId',async(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const data=await new IntegrationRegistryService(db.connection).update(req.params.integrationId,{
      name:typeof req.body?.name==='string'?req.body.name:undefined,
      enabled:req.body?.enabled===undefined?undefined:Boolean(req.body.enabled),
      auth_mode:typeof req.body?.auth_mode==='string'?req.body.auth_mode:undefined,
      secret:req.body?.secret===null?null:typeof req.body?.secret==='string'?req.body.secret:undefined,
      config:req.body?.config&&typeof req.body.config==='object'?req.body.config:undefined,
      metadata:req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:undefined,
    });
    res.json({ok:true,data});
  }catch(error){
    const code=error instanceof Error?error.message:'INTEGRATION_UPDATE_FAILED';
    res.status(code==='INTEGRATION_NOT_FOUND'?404:400).json({ok:false,error:{code,message:code}});
  }finally{db.connection.close()}
});

v3IntegrationRouter.delete('/integrations/:integrationId',async(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{res.json({ok:true,data:{deleted:await new IntegrationRegistryService(db.connection).remove(req.params.integrationId)}})}
  finally{db.connection.close()}
});

v3IntegrationRouter.post('/integrations/:integrationId/test',async(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const data=await new IntegrationRegistryService(db.connection).test(req.params.integrationId);
    res.json({ok:true,data});
  }catch(error){
    const code=error instanceof Error?error.message:'INTEGRATION_TEST_FAILED';
    res.status(code==='INTEGRATION_NOT_FOUND'?404:400).json({ok:false,error:{code,message:code}});
  }finally{db.connection.close()}
});

v3IntegrationRouter.get('/integrations-events',(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{res.json({ok:true,data:new IntegrationRegistryService(db.connection).listEvents(Number(req.query.limit)||100)})}
  finally{db.connection.close()}
});

v3IntegrationRouter.get('/projects/:projectId/integrations',(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const service=new IntegrationRegistryService(db.connection);
    const bindings=service.listProjectBindings(req.params.projectId);
    const connections=new Map(service.list().map(x=>[x.id,x]));
    res.json({ok:true,data:bindings.map(binding=>({...binding,integration:connections.get(binding.integration_id)??null}))});
  }finally{db.connection.close()}
});

v3IntegrationRouter.put('/projects/:projectId/integrations/:integrationId',(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const data=new IntegrationRegistryService(db.connection).bindProject(
      req.params.projectId,req.params.integrationId,
      req.body?.scope&&typeof req.body.scope==='object'?req.body.scope:{},
      req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{},
    );
    res.json({ok:true,data});
  }catch(error){
    const code=error instanceof Error?error.message:'INTEGRATION_BIND_FAILED';
    res.status(code.endsWith('_NOT_FOUND')?404:400).json({ok:false,error:{code,message:code}});
  }finally{db.connection.close()}
});

v3IntegrationRouter.delete('/projects/:projectId/integrations/:integrationId',(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{res.json({ok:true,data:{deleted:new IntegrationRegistryService(db.connection).unbindProject(req.params.projectId,req.params.integrationId)}})}
  finally{db.connection.close()}
});
