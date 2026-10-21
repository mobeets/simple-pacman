/* Start the unmodified Python server first. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--no-zygote','--disable-dev-shm-usage']});
  const page=await browser.newPage({viewport:{width:960,height:850}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:8000/?subject_id=BROWSER_SMOKE');
    await page.waitForFunction(()=>typeof env!=='undefined' && env && typeof taskLog!=='undefined' && wsLogger.socket.readyState===1);
    await page.bringToFront();
    assert.equal(await page.evaluate(()=>env.state),'menu');
    await page.screenshot({path:'/tmp/pacman-menu.png'});
    const button=await page.evaluate(()=>renderer.playBounds());
    await page.mouse.move(button.x+button.w/2,button.y+button.h/2);
    await page.waitForTimeout(100);
    const hoverColor=await page.evaluate(()=>Array.from(drawingContext.getImageData(width/2,renderer.playBounds().y+12,1,1).data));
    await page.mouse.down();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(()=>env.state),'menu','mousedown should show feedback before starting');
    assert.equal(await page.evaluate(()=>renderer.playPressed),true);
    const pressedColor=await page.evaluate(()=>Array.from(drawingContext.getImageData(width/2,renderer.playBounds().y+12,1,1).data));
    assert.notDeepEqual(pressedColor,hoverColor,'pressed button must visibly change');
    await page.screenshot({path:'/tmp/pacman-menu-pressed.png'});
    await page.mouse.up();
    await page.waitForFunction(()=>env.state==='defense');
    await page.keyboard.press('Space');
    const pausedTick=await page.evaluate(()=>env.tick);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>env.tick),pausedTick);
    assert.equal(await page.evaluate(()=>manualPaused),true);
    await page.screenshot({path:'/tmp/pacman-paused.png'});
    await page.keyboard.press('p');
    await page.waitForFunction(tick=>env.tick>tick,pausedTick);
    assert(await page.evaluate(()=>taskLog.records.some(e=>e.type==='task_resumed' && e.payload.duration_s>0)));
    // Isolate controls from stochastic encounters without replacing input handlers.
    await page.evaluate(()=>{env.pacman=env.entity([0,0]);env.ghost=env.entity([4,4]);env.config.ghost_stay_probability=1;env.config.defense_mean_duration_s=1e9;});
    await page.keyboard.down('ArrowRight');
    await page.waitForFunction(()=>env.pacman.position[1]===2);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(()=>env.pacman.position[1]),2,'held key must not restart motion');
    await page.keyboard.up('ArrowRight');
    // A short down/up burst before the next draw must still get through.
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>env.pacman.position[1]===4);
    await page.evaluate(()=>{env.context=1;env.transition('offense');});
    await page.screenshot({path:'/tmp/pacman-offense.png'});
    for(let i=0;i<3;i++) {
      await page.evaluate(()=>{env.context=0;env.contact();taskLog.drain();});
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(()=>env.pacman.target),null);
      if(i<2) {
        await page.waitForFunction(()=>env.state==='respawn_ready');
        await page.waitForFunction(()=>env.active);
      } else await page.waitForFunction(()=>env.state==='menu');
    }
    assert.equal(await page.evaluate(()=>env.state),'menu');
    assert.equal(await page.evaluate(()=>scores.length),1);
    const markers=await page.evaluate(()=>taskLog.records.filter(r=>r.type==='sync_trigger').map(r=>r.payload));
    assert.equal(markers.filter(r=>r.kind==='pacman_eaten').length,3);
    assert(markers.every(r=>r.audio_requested),'all contacts must request sound');

    await page.waitForTimeout(600);
    const facts=await page.evaluate(()=>({errors:startupError,records:taskLog.records.length,states:taskLog.records.filter(x=>x.type==='game_state').length,inputs:taskLog.records.filter(x=>x.type==='direction_input').length,rejected:taskLog.records.filter(x=>x.type==='action'&&!x.payload.accepted).length,session:taskLog.sessionId,filename:wsLogger.log_filename}));
    assert.equal(facts.errors,null);assert(facts.states>100);assert(facts.inputs>=5);assert(facts.rejected>=3);assert.deepEqual(errors,[]);
    // Verify a new game starts in defense, without resetting the schedule.
    await page.keyboard.press('Enter');
    await page.waitForFunction(()=>env.state==='game_start');
    assert.equal(await page.evaluate(()=>env.context),0);
    assert.equal(await page.evaluate(()=>env.startIndex),2);
    await page.evaluate(()=>taskLog.save());
    await page.waitForTimeout(600);
    console.log(JSON.stringify({passed:true,...facts}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
