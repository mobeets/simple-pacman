const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function harness(state='running') {
  let clock=1000;
  const records=[],draws=[],sources=[];
  class FakeAudio {
    constructor(options){this.options=options;this.state=state;this.sampleRate=48000;this.currentTime=2;this.baseLatency=.01;this.outputLatency=.02;this.destination={};}
    createBuffer(channels,length,rate){const samples=new Float32Array(length);return{samples,getChannelData(){return samples;},sampleRate:rate};}
    createBufferSource(){const s={connect(){},disconnect(){},start(when){s.when=when;}};sources.push(s);return s;}
    getOutputTimestamp(){return{contextTime:1.98,performanceTime:980};}
    async resume(){this.state='running';}
  }
  const context=vm.createContext({width:960,height:850,OFFENSE:1,AudioContext:FakeAudio,
    performance:{now:()=>clock},millis:()=>clock,CORNER:'corner',records,
    ...Object.fromEntries(['push','pop','rectMode','noStroke','fill','square'].map(name=>[name,(...args)=>draws.push([name,...args])]))});
  for(const name of ['photodiode.js','contact_sync.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../static',name),'utf8'),context);
  vm.runInContext("this.markers=new ContactSync({}, {log:(type,payload)=>{const r={type,payload,sequence:records.length};records.push(r);return r;}})",context);
  return{markers:context.markers,records,draws,sources,advance:ms=>clock+=ms,context};
}
test('capture and death use distinct prebuilt buffers with immediate nonzero onset and zero tail',async()=>{
 const h=harness();await h.markers.prepare();
 const a=h.markers.buffers.ghost_eaten.samples,b=h.markers.buffers.pacman_eaten.samples;
 assert.equal(a.length,2880);assert.equal(b.length,2880);
 assert(Math.abs(a[0]-.18)<1e-7);assert(Math.abs(b[0]-.18)<1e-7);
 assert.equal(a.at(-1),0);assert.equal(b.at(-1),0);
 assert.notDeepEqual(a,b);
 const crossings=x=>Array.from(x.slice(0,2400)).filter((v,i)=>i>0&&v*x[i-1]<0).length;
 assert(Math.abs(crossings(a)-150)<3);assert(Math.abs(crossings(b)-40)<3);
});
test('each contact fires audio and flash once in same render and logs linked timing/type',async()=>{
 const h=harness();await h.markers.prepare();
 h.markers.queue({type:'pellet_appeared'},{});h.markers.render();assert.equal(h.sources.length,0);
 for(const [context,kind,frequency] of [[1,'ghost_eaten',1500],[0,'pacman_eaten',400]]) {
  h.markers.queue({type:'contact',context,tick:99},{sequence:123,game_id:1});
  const before=h.sources.length;h.markers.render();h.markers.render();
  assert.equal(h.sources.length,before+1);assert.equal(h.sources.at(-1).when,2);
  assert(h.draws.some(d=>d[0]==='square'&&d[1]===0&&d[2]===0&&d[3]===80));
  const r=h.records.filter(r=>r.type==='sync_trigger').at(-1).payload;
  assert.equal(r.kind,kind);assert.equal(r.audio_frequency_hz,frequency);assert.equal(r.contact_sequence,123);assert.equal(r.contact_tick,99);
  assert.equal(r.audio_requested,true);assert.equal(r.visual_draw_performance_ms,r.trigger_performance_ms);
  assert.equal(r.estimated_audio_output_performance_ms,1000);
 }
});
test('flash ends after its configured duration, and pause hides it immediately',async()=>{
 const h=harness();await h.markers.prepare();
 const contact=()=>h.markers.queue({type:'contact',context:1,tick:1},{sequence:5,game_id:1});
 contact();h.markers.render();h.advance(101);h.draws.length=0;h.markers.render();
 assert(!h.draws.some(d=>d[0]==='square'));assert.equal(h.records.at(-1).payload.reason,'duration_elapsed');
 contact();h.markers.render();h.draws.length=0;h.markers.render(true);
 assert(!h.draws.some(d=>d[0]==='square'));assert.equal(h.records.at(-1).payload.reason,'paused');
});
test('suspended audio is explicitly reported, never logged as a successful sound',()=>{
 const h=harness();h.markers.queue({type:'contact',context:0,tick:2},{sequence:8,game_id:1});h.markers.render();
 const p=h.records.find(r=>r.type==='sync_trigger').payload;
 assert.equal(p.audio_requested,false);assert.match(p.audio_error,/not running/);assert.equal(p.audio_scheduled_context_time_s,null);
});
test('prepare resumes audio; output timestamp API is optional',async()=>{
 const h=harness('suspended');assert.equal(h.markers.ready,false);await h.markers.prepare();assert.equal(h.markers.ready,true);
 h.markers.context.getOutputTimestamp=undefined;
 h.markers.queue({type:'contact',context:1,tick:2},{sequence:8,game_id:1});h.markers.render();
 assert.equal(h.records.at(-1).payload.audio_requested,true);assert.equal(h.records.at(-1).payload.estimated_audio_output_performance_ms,null);
});
test('logger hook connects real simulation contacts to markers, without duplicating drained events',async()=>{
 const h=harness();await h.markers.prepare();
 const {GhostGridEnv}=require('../static/environment.js');const config=require('../static/configs/default.json');
 const env=new GhostGridEnv(config,42);env.reset();for(let i=0;i<60;i++)env.step();
 h.context.window={};h.context.location={href:'http://task/'};h.context.env=env;
 h.context.transport={_enqueueBatch(){}};
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/task_logger.js'),'utf8'),h.context);
 vm.runInContext('this.logger=new TaskLogger(transport,env,env.config);logger.onEvent=(event,record)=>markers.queue(event,record);logger.drain();',h.context);
 env.context=1;env.contact();vm.runInContext('logger.drain();logger.drain();',h.context);
 assert.equal(h.markers.pending.length,1);h.markers.render();assert.equal(h.sources.length,1);
 const p=h.records.find(r=>r.type==='sync_trigger').payload;
 const contact=h.context.logger.records.find(r=>r.type==='contact');assert.equal(p.contact_sequence,contact.sequence);
});
