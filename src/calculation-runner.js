export function createCalculationRunner() {
  let worker=null, rejectCurrent=null, seq=0;
  function cancel(){seq++;worker?.terminate();worker=null;if(rejectCurrent){rejectCurrent(new Error('计算已取消'));rejectCurrent=null;}}
  function run(input){
    cancel();const id=seq;worker=new Worker(new URL('./calculation-worker.js',import.meta.url),{type:'module'});
    return new Promise((resolve,reject)=>{
      rejectCurrent=reject;
      worker.onmessage=({data})=>{if(data.id!==id)return;worker.terminate();worker=null;rejectCurrent=null;data.error?reject(new Error(data.error)):resolve(data.results);};
      worker.onerror=event=>{worker?.terminate();worker=null;rejectCurrent=null;reject(new Error(event.message||'计算 Worker 加载失败'));};
      worker.postMessage({id,...input});
    });
  }
  return {run,cancel};
}
