/* Uses the starter's WebSocket transport and unchanged server JSONL format. */
class TaskLogger {
  constructor(transport, env, config) {
    this.transport=transport; this.env=env; this.records=[]; this.sequence=0;
    this.sessionId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,12)}-${Math.random().toString(36).slice(2,12)}`; this.lastFilename=null;
    transport.maxBufferSize=100000;
    this.log('session_start',{schema_version:1,session_id:this.sessionId,config,seed:env.seed,task_version:'pacman-browser-4',coordinates:'[row,column], zero based',url:location.href});
    window.downloadSession=()=>this.download();
  }
  log(type,payload={}) {
    const evt={type,t_wall:Date.now(),t_sketch:performance.now(),session_id:this.sessionId,sequence:this.sequence++,game_id:this.env.gameId,episode_id:this.env.gameId,tick:this.env.tick,payload};
    this.records.push(evt);
    // Avoid the starter logger's per-frame console output; retain its batching.
    this.transport._enqueueBatch(evt);
    return evt;
  }
  updateConnection() {
    if(this.transport.log_filename!==this.lastFilename && this.transport.socket?.readyState===WebSocket.OPEN) {
      this.lastFilename=this.transport.log_filename;
      this.log('log_connection',{filename:this.lastFilename});
    }
  }
  drain() { for(const event of this.env.drainEvents()) this.log(event.type,event); }
  snapshot() { this.log('game_state',this.env.snapshot()); }
  save() {
    this.transport.flushAll();
    this.transport.saveJson({schema_version:1,session_id:this.sessionId,records:this.records});
  }
  download() {
    const a=document.createElement('a');
    const url=URL.createObjectURL(new Blob([JSON.stringify({schema_version:1,session_id:this.sessionId,records:this.records})],{type:'application/json'}));
    a.href=url; a.download=`pacman-${this.sessionId}.json`; a.click(); URL.revokeObjectURL(url);
  }
}
