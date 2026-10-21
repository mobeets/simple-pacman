const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {GhostGridEnv}=require('../static/environment.js');
const config=require('../static/configs/default.json');
const script=name=>fs.readFileSync(path.join(__dirname,'../static',name),'utf8');
function harness() {
  let clock=1000;
  const records=[],calls=[];
  const document={hidden:false,hasFocus:()=>true};
  const context=vm.createContext({document,performance:{now:()=>clock},Date:{now:()=>1700000000000+clock},
    records,wsLogger:{socket:{readyState:1}},WebSocket:{OPEN:1},GhostGridEnv,console,Math,
    width:960,height:850,mouseX:0,mouseY:0,DEFENSE:0,DELTAS:[[-1,0],[0,1],[1,0],[0,-1]],
    CENTER:'center',LEFT:'left',RIGHT:'right',NORMAL:'normal',BOLD:'bold',ARROW:'arrow',HAND:'hand',
    HALF_PI:Math.PI/2,PI:Math.PI,TWO_PI:2*Math.PI,PIE:'pie',CLOSE:'close',
    ...Object.fromEntries(['background','cursor','noStroke','fill','noFill','stroke','strokeWeight','textStyle','textAlign','textSize','text','rect','arc','push','pop','translate','rotate','circle','ellipse','beginShape','endShape','vertex','scale'].map(name=>[name,(...args)=>calls.push([name,...args])]))});
  vm.runInContext(script('sketch.js')+'\n'+script('renderer.js')+`\n
    config=${JSON.stringify({...config,ghost_stay_probability:1,defense_mean_duration_s:1e9})};
    env=new GhostGridEnv(config,42);renderer=new GameRenderer();
    taskLog={log:(type,payload)=>records.push({type,payload}),drain(){env.drainEvents();},snapshot(){},save(){},updateConnection(){}};
    user={update(){}};
  `,context);
  return {run:code=>vm.runInContext(code,context),advance:ms=>clock+=ms,records,calls,document};
}

test('Space/Start callback starts from menu; manual pause freezes full state and logs its interval',()=>{
 const h=harness();h.run("togglePause('keyboard_space')");assert.equal(h.run('env.state'),'game_start');
 h.advance(100);h.run('draw()');
 h.run("togglePause('keyboard_p')");const frozen=h.run('JSON.stringify(env.snapshot())');
 h.advance(600);h.run('draw()');assert.equal(h.run('JSON.stringify(env.snapshot())'),frozen);
 h.run('env.action(1)');assert.equal(h.run('env.pacman.target'),null);
 h.run("togglePause('controller_start')");const end=h.records.find(x=>x.type==='task_resumed').payload;
 assert.equal(end.duration_s,.6);assert.equal(end.end_wall_ms-end.start_wall_ms,600);
 h.advance(20);h.run('draw()');assert(h.run('env.tick')>JSON.parse(frozen).tick);
 assert.equal(h.run('env.gameId'),1);
});
test('pause during movement freezes positions, RNG and task clocks; ignored direction never buffers',()=>{
 const h=harness();h.run("startGame();for(let i=0;i<60;i++)env.step();env.pacman=env.entity([0,0]);env.ghost=env.entity([4,4]);env.action(1);env.step();togglePause('keyboard_space');");
 const frozen=h.run('JSON.stringify(env.snapshot())');h.advance(5000);h.run('draw()');assert.equal(h.run('JSON.stringify(env.snapshot())'),frozen);
 h.run("togglePause('keyboard_space')");h.advance(20);h.run('draw()');assert(h.run('env.pacman.position[1]')>JSON.parse(frozen).pacman.position[1]);
});
test('automatic pause does not clear a manual pause',()=>{
 const h=harness();h.run("startGame();togglePause('keyboard_p')");h.document.hidden=true;h.run('syncPause()');
 h.document.hidden=false;h.run('syncPause()');assert.equal(h.run('paused()'),true);
 assert.equal(h.records.filter(x=>x.type==='task_resumed').length,0);
 h.run("togglePause('keyboard_p')");assert.equal(h.records.filter(x=>x.type==='task_resumed').length,1);
});
test('paused render draws only white PAUSED on black, without drawing maze or entities',()=>{
 const h=harness();h.run('startGame();renderer.render(env,[],true)');
 assert.deepEqual(h.calls.filter(c=>['background','fill','text'].includes(c[0])),[['background','black'],['fill','white'],['text','PAUSED',480,425]]);
 assert.equal(h.calls.filter(c=>['rect','arc','circle'].includes(c[0])).length,0);
});
test('chomping changes only when moving, and lives render as Pacman icons',()=>{
 const h=harness();h.run('startGame();for(let i=0;i<60;i++)env.step();env.pacman=env.entity([0,0]);renderer.layout();renderer.pacman(env);env.time+=.1;renderer.pacman(env)');
 let arcs=h.calls.filter(c=>c[0]==='arc');assert.deepEqual(arcs[0],arcs[1]);
 h.calls.length=0;h.run('env.action(1);renderer.pacman(env);env.time+=.1;renderer.pacman(env)');
 arcs=h.calls.filter(c=>c[0]==='arc');assert.notEqual(arcs[0][5],arcs[1][5]);
 h.calls.length=0;h.run('renderer.drawLives(3)');assert.equal(h.calls.filter(c=>c[0]==='arc').length,3);
 assert.equal(h.calls.find(c=>c[0]==='text')[1],'LIVES');
});
test('walls use two unfilled outlines per obstacle and outer boundary; latest score is bold',()=>{
 const h=harness();h.run('startGame();renderer.layout();renderer.maze(env)');
 assert.equal(h.calls.filter(c=>c[0]==='rect').length,10);
 assert.equal(h.calls.findIndex(c=>c[0]==='fill')>h.calls.findLastIndex(c=>c[0]==='rect'),true);
 h.calls.length=0;h.run('renderer.menu([{game_id:1,score:100},{game_id:2,score:50}])');
 const rows=h.calls.filter(c=>c[0]==='text'&&/^\d+\./.test(c[1]));assert.equal(rows.length,2);
 const latestIndex=h.calls.findIndex(c=>c[0]==='text'&&c[1]==='2.   50');
 assert.deepEqual(h.calls.slice(0,latestIndex).filter(c=>c[0]==='textStyle').at(-1),['textStyle','bold']);
 assert.deepEqual(h.calls.at(-1),['textStyle','normal']);
});

test('READY and PAUSED match menu title size; READY banner has requested grey fill',()=>{
 const h=harness();h.run('renderer.menu([])');const titleSize=h.calls.filter(c=>c[0]==='textSize')[0][1];
 h.calls.length=0;h.run("renderer.banner('READY')");
 assert(h.calls.some(c=>c[0]==='fill'&&c[1]==='#424242'));
 assert.equal(h.calls.find(c=>c[0]==='textSize')[1],titleSize);
 h.calls.length=0;h.run('startGame();renderer.render(env,[],true)');
 assert.equal(h.calls.find(c=>c[0]==='textSize')[1],titleSize);
});
test('capture reward text appears during capture and disappears after ghost respawn',()=>{
 const h=harness();h.run("startGame();for(let i=0;i<60;i++)env.step();env.context=1;env.contact();renderer.render(env,[],false)");
 assert(h.calls.some(c=>c[0]==='text'&&c[1]===config.offense_contact_reward));
 h.calls.length=0;h.run('for(let i=0;i<60;i++)env.step();renderer.render(env,[],false)');
 assert(!h.calls.some(c=>c[0]==='text'&&c[1]===config.offense_contact_reward));
});

test('game waits for audio readiness and starts exactly once after preparation',async()=>{
 const h=harness();h.run('this.releaseAudio=null;syncSignals={ready:false,prepare:()=>new Promise(resolve=>{releaseAudio=()=>{syncSignals.ready=true;resolve();};})};startGame();');
 assert.equal(h.run('env.state'),'menu');assert.equal(h.run('startPending'),true);
 assert.match(h.run('renderer.audioMessage'),/enable sound/);
 h.run('releaseAudio()');await Promise.resolve();
 assert.equal(h.run('env.state'),'game_start');assert.equal(h.run('env.gameId'),1);assert.equal(h.run('startPending'),false);
});
test('scoreboard heading, points and lives labels use font size 20',()=>{
 const h=harness();h.run('renderer.menu([{game_id:1,score:100}]);startGame();renderer.render(env,[],false)');
 for(const label of ['SESSION HIGH SCORES','LIVES','POINTS  0']) {
  const index=h.calls.findIndex(c=>c[0]==='text'&&c[1]===label);
  assert(index>=0);assert.equal(h.calls.slice(0,index).filter(c=>c[0]==='textSize').at(-1)[1],20);
 }
});

test('no WebSocket connection does not block starting or advancing gameplay',()=>{
 const h=harness();h.run('wsLogger.socket=null;startGame()');assert.equal(h.run('env.state'),'game_start');
 h.advance(100);h.run('draw()');assert(h.run('env.tick')>0);assert.equal(h.run('paused()'),false);
});
