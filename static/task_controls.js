/* Raw keyboard callbacks are event-driven, so short presses between frames
 * aren't lost. Gamepad edges are sampled by the starter's UnifiedControls. */
class TaskControls {
  constructor(unified, onDirection, onPlay, logger, canAct, onPause=()=>{}) {
    this.u=unified; this.onDirection=onDirection; this.onPlay=onPlay;
    this.onPause=onPause; this.logger=logger; this.canAct=canAct; this.held=new Set(); this.stickDirection=null;
    this.keyMap={ArrowUp:0,ArrowRight:1,ArrowDown:2,ArrowLeft:3,w:0,d:1,s:2,a:3,W:0,D:1,S:2,A:3};
  }
  keyPressed(event) {
    const key=event.code || event.key;
    const fresh=!event.repeat && !this.held.has(key);
    this.held.add(key); this.u.keyPressed(event);
    if(fresh) {
      if(this.keyMap[event.key]!==undefined) this.direction(this.keyMap[event.key],'keyboard');
      if(event.key==='Enter') this.onPlay();
      if(event.key===' ' || event.code==='Space') this.onPause('keyboard_space');
      if(event.key.toLowerCase()==='p') this.onPause('keyboard_p');
    }
  }
  keyReleased(event) { this.held.delete(event.code||event.key); this.u.keyReleased(event); }
  direction(action,source) {
    const permitted=this.canAct();
    this.logger.log('direction_input',{action,source,permitted});
    if(permitted) this.onDirection(action);
    else this.logger.log('action_ignored',{action,source,reason:'paused'});
  }
  update() {
    this.u.update();
    const gp=this.u.pad.gp;
    const raw=gp ? {id:gp.id,axes:Array.from(gp.axes),buttons:gp.buttons.map(b=>({pressed:b.pressed,value:b.value}))} : null;
    const signature=JSON.stringify(raw);
    if(signature!==this.lastControllerState) {
      this.logger.log('controller_state',raw || {connected:false});
      this.lastControllerState=signature;
    }
    ['DPAD_UP','DPAD_RIGHT','DPAD_DOWN','DPAD_LEFT'].forEach((name,a)=>{if(this.u.justPressedButton(name)) this.direction(a,'dpad');});
    const stick=this.u.leftStick();
    let direction=null;
    if(Math.max(Math.abs(stick.x),Math.abs(stick.y))>0.5) direction=Math.abs(stick.x)>Math.abs(stick.y)?(stick.x>0?1:3):(stick.y>0?2:0);
    if(direction!==this.stickDirection) {
      this.logger.log('stick_changed',{x:stick.x,y:stick.y,direction});
      if(direction!==null) this.direction(direction,'stick');
    }
    this.stickDirection=direction;
    if(this.u.justPressedButton('START')) this.onPause('controller_start');
    else if(this.u.justPressedButton('SOUTH')) this.onPlay();
  }
  clear() {
    this.held.clear(); this.u.keys={}; this.u.prevKeys={};
    this.logger.log('controls_reset',{reason:'focus_lost'});
  }
}
