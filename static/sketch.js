let env, controls, user, renderer, taskLog, config, syncSignals;
let startPending=false;
let scores=[], accumulator=0, lastFrameTime=0, wasPaused=false, startupError=null, manualPaused=false, pauseStart=null;
function preload() {
  const name=new URLSearchParams(location.search).get('config') || 'default';
  const safe=/^[a-zA-Z0-9_-]+$/.test(name)?name:'default';
  config=loadJSON(`/static/configs/${safe}.json`,()=>{},()=>{startupError='Could not load task configuration';});
}
function setup() {
  createCanvas(windowWidth,windowHeight); pixelDensity(Math.min(devicePixelRatio||1,2));
  textFont('Helvetica'); frameRate(60);
  try {
    if(startupError) throw Error(startupError);
    const seed=config.seed===null ? Math.floor(Math.random()*4294967296) : config.seed;
    env=new GhostGridEnv(config,seed); renderer=new GameRenderer(); taskLog=new TaskLogger(wsLogger,env,config);
    syncSignals=new ContactSync(config.sync_signals||{},taskLog);
    taskLog.onEvent=(event,record)=>syncSignals.queue(event,record);
    controls=new UnifiedControls({log:(type,payload)=>taskLog.log(type,payload)});
    user=new TaskControls(controls,a=>{env.action(a); taskLog.drain();},startGame,taskLog,()=>!paused(),togglePause);
    document.addEventListener('visibilitychange',()=>{
      taskLog.log('visibility_changed',{hidden:document.hidden});
      syncPause('visibility');
      if(document.hidden) {user.clear(); taskLog.save();}
      accumulator=0;
    });
    window.addEventListener('blur',()=>{user.clear();renderer.playPressed=false;taskLog.log('focus_changed',{focused:false});syncPause('focus');taskLog.save();accumulator=0;});
    window.addEventListener('focus',()=>{taskLog.log('focus_changed',{focused:true});syncPause('focus');accumulator=0;});
    window.addEventListener('pagehide',()=>taskLog.save());
    lastFrameTime=performance.now();
  } catch(e) {startupError=e.message; console.error(e);}
}
function paused() {return (syncSignals && env.state!=='menu' && !syncSignals.ready) || manualPaused || document.hidden || !document.hasFocus() || wsLogger.socket?.readyState!==WebSocket.OPEN;}
function syncPause(source='automatic') {
  const isPaused=paused() && env.state!=='menu';
  if(isPaused===wasPaused) return;
  const wall=Date.now(), mono=performance.now();
  if(isPaused) {
    pauseStart={wall,mono};
    taskLog.log('task_paused',{source,start_wall_ms:wall,manual:manualPaused,hidden:document.hidden,focused:document.hasFocus(),connected:wsLogger.socket?.readyState===WebSocket.OPEN});
  } else {
    taskLog.log('task_resumed',{source,start_wall_ms:pauseStart?.wall,end_wall_ms:wall,duration_s:pauseStart?(mono-pauseStart.mono)/1000:0});
    pauseStart=null;
  }
  wasPaused=isPaused; accumulator=0; lastFrameTime=mono;
  taskLog.save();
}
function togglePause(source) {
  if(env.state==='menu') {startGame();return;}
  manualPaused=!manualPaused;
  taskLog.log('pause_toggle',{source,manual_paused:manualPaused});
  syncPause(source);
}
function startGame() {
  if(env.state!=='menu' || paused()) return;
  if(syncSignals && !syncSignals.ready) {
    // Retry resume on every gesture, even when an earlier resume is pending.
    const prepared=syncSignals.prepare();
    if(startPending) {prepared.catch(error=>taskLog.log('sync_audio_error',{message:error.message}));return;}
    startPending=true; renderer.audioMessage='Click Play or press Space to enable sound';
    prepared.then(()=>{
      startPending=false;renderer.audioMessage=null;
      if(env.state==='menu' && !paused()) beginGame();
    }).catch(error=>{
      startPending=false;taskLog.log('sync_audio_error',{message:error.message});
      renderer.audioMessage='Click Play or press Space to enable sound';
    });
    return;
  }
  beginGame();
}
function beginGame() {
  env.reset(); taskLog.drain(); taskLog.snapshot(); accumulator=0;lastFrameTime=performance.now();
}
function unlockSyncAudio() {
  if(syncSignals && env.state!=='menu' && !syncSignals.ready) syncSignals.prepare().catch(error=>taskLog.log('sync_audio_error',{message:error.message}));
}
function draw() {
  if(startupError) {background('#080c18');fill('white');textAlign(CENTER,CENTER);text(startupError,width/2,height/2);return;}
  const now=performance.now(); let elapsed=(now-lastFrameTime)/1000; lastFrameTime=now;
  taskLog.updateConnection(); user.update();
  if(lastFrameTime!==now) elapsed=0;
  const isPaused=paused();
  const pauseChanged=(isPaused && env.state!=='menu')!==wasPaused;
  syncPause();
  if(!isPaused && env.state!=='menu') {
    // Long stalls pause simulation instead of advancing unseen gameplay.
    if(pauseChanged) accumulator=0;
    else if(elapsed>.25) {taskLog.log('timing_gap',{duration_s:elapsed}); accumulator=0;}
    else {
      accumulator+=elapsed;
      const dt=1/config.simulation_hz;
      while(accumulator+1e-9>=dt && env.state!=='menu') {
        env.step(); taskLog.drain(); taskLog.snapshot(); accumulator-=dt;
        if(env.state==='menu') {scores.push({game_id:env.gameId,score:env.score});taskLog.log('session_scores',{scores});taskLog.save();}
      }
    }
  }
  renderer.render(env,scores,isPaused && env.state!=='menu');
  if(syncSignals) syncSignals.render(isPaused);
}
function keyPressed(event) {
  if(!user) return;
  unlockSyncAudio();
  user.keyPressed(event);
  if(['ArrowUp','ArrowRight','ArrowDown','ArrowLeft',' '].includes(event.key)) return false;
}
function keyReleased(event) {if(user) user.keyReleased(event);}
function mousePressed(event) {
  if(!controls) return;
  unlockSyncAudio();
  controls.mousePressed(event);
  renderer.playPressed=env.state==='menu' && renderer.hitPlay(mouseX,mouseY);
}
function mouseReleased(event) {
  if(!controls) return;
  controls.mouseReleased(event);
  const play=renderer.playPressed && env.state==='menu' && renderer.hitPlay(mouseX,mouseY);
  renderer.playPressed=false;
  if(play) startGame();
}
function windowResized() {resizeCanvas(windowWidth,windowHeight);if(taskLog)taskLog.log('window_resized',{width,height});}
