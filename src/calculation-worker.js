import { loadRuleset } from './rulesets.js';
import { createCalculator } from './engine.js';
self.onmessage=async({data:request})=>{
  try{
    const pack=await loadRuleset({versionId:request.versionId});
    const engine=await createCalculator(pack),results=[];
    for(const config of request.configs)results.push(request.mode==='team'?engine.simulateTeam(config,request.target,request.scene):engine.simulate(config,request.target));
    self.postMessage({id:request.id,results});
  }catch(error){self.postMessage({id:request.id,error:error.message||String(error)});}
};
