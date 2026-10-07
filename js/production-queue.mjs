/** Sequential, explicit queue. No retries or resumptions are automatic. */
export class ProductionQueue {
  constructor({run,onChange=()=>{}}) {this.run=run;this.onChange=onChange;this.jobs=[];this.running=false;this.paused=false;this.serial=0;this.currentAbort=null;}
  emit(){this.onChange(this.jobs.map(job=>({...job})),{running:this.running,paused:this.paused});}
  add(items){
    for(const item of items){
      if(this.jobs.some(job=>job.line_id===item.line_id&&job.fingerprint===item.fingerprint&&Boolean(job.recover_only)===Boolean(item.recover_only)&&(!item.recover_only||job.operation_id===item.operation_id)&&['queued','running'].includes(job.status)))continue;
      this.jobs.push({...item,job_id:++this.serial,status:'queued',error:'',uncertain:false});
    }
    this.emit();
  }
  async start(onlyJobId=null){
    if(this.running)return;this.running=true;this.paused=false;this.emit();
    try{
      while(!this.paused){
        const job=this.jobs.find(item=>item.status==='queued'&&(onlyJobId===null||item.job_id===onlyJobId));if(!job)break;
        job.status='running';this.currentAbort=new AbortController();this.emit();
        try{await this.run(job,this.currentAbort.signal);job.status='done';}
        catch(error){job.status=error.code==='STALE'?'stale':error.name==='AbortError'?'uncertain':'failed';job.error=error.message;job.uncertain=Boolean(error.uncertain)||error.name==='AbortError';}
        this.currentAbort=null;this.emit();
        if(onlyJobId!==null){this.paused=this.jobs.some(item=>item.status==='queued');break;}
        // Quota/rate-limit/uncertain/provider failures pause the rest to avoid consuming more.
        if(['failed','uncertain'].includes(job.status)){this.paused=true;break;}
      }
    }finally{this.running=false;this.emit();}
  }
  pause(){this.paused=true;this.emit();}
  cancelPending(){for(const job of this.jobs)if(job.status==='queued')job.status='cancelled';this.paused=true;this.emit();}
  retry(job_id,newOperationId){const old=this.jobs.find(job=>job.job_id===job_id);if(!old||!['failed','uncertain','stale','cancelled'].includes(old.status))throw new Error('该任务不能重试');this.add([{...old,operation_id:newOperationId,job_id:undefined,status:undefined,error:undefined,uncertain:false}]);}
}
