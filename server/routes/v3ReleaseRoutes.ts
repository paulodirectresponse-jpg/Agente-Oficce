import { Router } from 'express';
import { openAgentOfficeDatabase } from '../agent-office/database.js';
import { runReleasePreflight } from '../agent-office/releasePreflight.js';

export const v3ReleaseRouter=Router();

v3ReleaseRouter.get('/release/preflight',async(req,res)=>{
  const db=openAgentOfficeDatabase();
  try{
    const report=await runReleasePreflight(db.connection,String(req.query.active_tools??'')==='1');
    res.json({ok:true,data:report});
  }catch(error){
    res.status(500).json({ok:false,error:{code:'RELEASE_PREFLIGHT_FAILED',message:error instanceof Error?error.message:'RELEASE_PREFLIGHT_FAILED'}});
  }finally{db.connection.close()}
});
