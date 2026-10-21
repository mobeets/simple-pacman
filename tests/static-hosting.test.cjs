const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const http=require('node:http');
const root=path.join(__dirname,'..');
function transport(url) {
 const sockets=[],timers=[];
 class Socket {static OPEN=1;constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}send(data){this.sent.push(JSON.parse(data));}close(){this.readyState=3;this.onclose?.();}}
 const c=vm.createContext({location:new URL(url),URL,URLSearchParams,WebSocket:Socket,Date,Math,performance:{now:()=>100},setInterval:()=>1,setTimeout:fn=>{timers.push(fn);return timers.length;},window:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync(path.join(root,'static/task_transport.js'),'utf8'),c);
 return{logger:c.window.wsLogger,sockets,timers};
}
test('GitHub Pages and file URLs never attempt a WebSocket; offline logging does not queue duplicate records',()=>{
 for(const url of ['https://mobeets.github.io/pacman/','file:///tmp/pacman/index.html','http://localhost:8000/?logging=off']) {
  const h=transport(url);assert.equal(h.sockets.length,0);assert.equal(h.logger.enabled,false);
  h.logger._enqueueBatch({type:'test'});assert.equal(h.logger.batchQueue.length,0);assert.equal(h.logger.saveJson({}),false);
 }
});
test('static HTTP without a backend falls back after one attempt, without reconnect loops',()=>{
 const h=transport('http://localhost:8080/pacman/');assert.equal(h.sockets.length,1);h.sockets[0].close();
 assert.equal(h.logger.enabled,false);assert.equal(h.timers.length,0);
});
test('server transport keeps filename, batch and JSON protocol, and reconnects after established connection',()=>{
 const h=transport('http://localhost:8000/?subject_id=TEST');h.logger._enqueueBatch({type:'game_state'});
 const s=h.sockets[0];s.readyState=1;s.onopen();
 assert.equal(s.url,'ws://localhost:8000/ws');assert.equal(s.sent[0].type,'set_filename');assert.equal(s.sent[1].type,'batch');
 assert.equal(s.sent[1].events[0].type,'game_state');assert(h.logger.saveJson({records:[]}));assert.equal(s.sent[2].type,'save_json');
 s.close();assert.equal(h.timers.length,1);h.logger._enqueueBatch({type:'offline_action'});h.timers[0]();assert.equal(h.sockets.length,2);assert.equal(h.logger.batchQueue.length,1);
});
test('explicit remote backend on Pages and logging=server opt-in work',()=>{
 const h=transport('https://user.github.io/game/?ws=wss%3A%2F%2Ftask.example%2Fws');assert.equal(h.sockets[0].url,'wss://task.example/ws');
 const forced=transport('http://localhost:8000/?logging=server');forced.sockets[0].close();assert.equal(forced.timers.length,1);
});
test('file-mode default config matches JSON; preload avoids blocked file:// fetches',()=>{
 const c=vm.createContext({location:new URL('file:///tmp/game/index.html'),URLSearchParams,JSON});
 vm.runInContext(fs.readFileSync(path.join(root,'static/configs/file_default.js'),'utf8'),c);
 assert.equal(JSON.stringify(c.PACMAN_FILE_CONFIG),JSON.stringify(require('../static/configs/default.json')));
 vm.runInContext(fs.readFileSync(path.join(root,'static/sketch.js'),'utf8'),c);
 vm.runInContext('preload()',c);assert.equal(vm.runInContext('config.size',c),5);assert.equal(vm.runInContext('startupError',c),null);
});
test('all linked assets and the config resolve and load under a GitHub Pages-style repository subpath',async()=>{
 const server=http.createServer((req,res)=>{
  const prefix='/test-repository/';
  if(!req.url.startsWith(prefix)){res.writeHead(404);res.end();return;}
  const relative=req.url.slice(prefix.length)||'index.html';
  const p=path.join(root,relative);
  if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
  res.end(fs.readFileSync(p));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const base=`http://127.0.0.1:${server.address().port}/test-repository/index.html`;
  const html=await (await fetch(base)).text();
  const paths=[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]);
  paths.push('./static/configs/default.json');
  for(const p of paths){const url=new URL(p,base);assert(url.pathname.startsWith('/test-repository/'));assert.equal((await fetch(url)).status,200,p);}
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
