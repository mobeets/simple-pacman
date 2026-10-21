/* Optional transport using the starter server's unchanged WebSocket protocol.
 * TaskLogger.records remains the authoritative in-tab copy in every mode. */
class TaskTransport {
  constructor() {
    const params=new URLSearchParams(location.search);
    this.mode=params.get('logging')||'auto';
    const explicit=params.get('ws');
    this.enabled=this.mode!=='off' && (location.protocol==='http:' || location.protocol==='https:') &&
      (!!explicit || this.mode==='server' || !location.hostname.endsWith('.github.io'));
    this.socket=null;this.batchQueue=[];this.maxBufferSize=100000;this.log_filename=null;
    this.everConnected=false;this.reconnectTimer=null;
    const url=new URL(explicit||'ws',location.href);
    if(url.protocol==='https:')url.protocol='wss:';
    if(url.protocol==='http:')url.protocol='ws:';
    this.url=url.href;
    if(this.enabled) this.connect();
    this.batchTimer=setInterval(()=>this.flushAll(),500);
  }
  connect() {
    if(!this.enabled)return;
    try {this.socket=new WebSocket(this.url);}
    catch(error) {this.connectionClosed();return;}
    this.socket.onopen=()=>{
      this.everConnected=true;
      const subject=new URLSearchParams(location.search).get('subject_id')||'unknown';
      this.log_filename=`${subject}-${new Date().toISOString().replace(/[:.]/g,'-')}-${Math.random().toString(36).slice(2,6)}.jsonl`;
      this.socket.send(JSON.stringify({type:'set_filename',filename:this.log_filename}));
      this.flushAll();
    };
    this.socket.onclose=()=>this.connectionClosed();
    this.socket.onerror=()=>{try{this.socket.close();}catch(error){this.connectionClosed();}};
  }
  connectionClosed() {
    if(this.enabled && (this.everConnected || this.mode==='server')) {
      if(!this.reconnectTimer)this.reconnectTimer=setTimeout(()=>{this.reconnectTimer=null;this.connect();},2000);
    } else {
      // A static host has no logging service. Do not retry forever or pause play.
      this.enabled=false;this.batchQueue=[];
    }
  }
  get connected() {return this.socket?.readyState===WebSocket.OPEN;}
  _enqueueBatch(event) {
    if(!this.enabled)return;
    this.batchQueue.push(event);
    if(this.batchQueue.length>this.maxBufferSize)this.batchQueue.shift();
  }
  flushAll() {
    if(!this.connected || !this.batchQueue.length)return;
    const message={type:'batch',t_wall:Date.now(),t_sketch:performance.now(),events:this.batchQueue};
    try {this.socket.send(JSON.stringify(message));this.batchQueue=[];}catch(error){/* Retain for retry. */}
  }
  saveJson(object) {
    if(!this.connected)return false;
    try {this.socket.send(JSON.stringify({type:'save_json',contents:JSON.stringify(object)}));return true;}
    catch(error){return false;}
  }
}
window.wsLogger=new TaskTransport();
window.addEventListener('beforeunload',()=>window.wsLogger.flushAll());
