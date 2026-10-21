const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../static/task_controls.js'),'utf8')+'\nthis.Controls=TaskControls;',context);
function setup() {
 const actions=[],logs=[],u={keys:{},prevKeys:{},keyPressed(){},keyReleased(){},update(){},pad:{gp:null},leftStick(){return{x:0,y:0};},justPressedButton(){return false;}};
 let allowed=true;
 const c=new context.Controls(u,a=>actions.push(a),()=>{}, {log:(...x)=>logs.push(x)},()=>allowed);
 return{c,u,actions,logs,pause:()=>allowed=false};
}
test('rapid press/release between frames is captured; OS repeat is ignored',()=>{
 const {c,actions}=setup();
 c.keyPressed({key:'ArrowRight',code:'ArrowRight',repeat:false});
 c.keyReleased({key:'ArrowRight',code:'ArrowRight'});
 assert.deepEqual(actions,[1]);
 c.keyPressed({key:'ArrowRight',code:'ArrowRight',repeat:false});
 c.keyPressed({key:'ArrowRight',code:'ArrowRight',repeat:true});
 c.keyPressed({key:'ArrowRight',code:'ArrowRight',repeat:false});
 assert.deepEqual(actions,[1,1]);
});
test('paused requests are logged without advancing controls',()=>{const {c,actions,logs,pause}=setup();pause();c.keyPressed({key:'ArrowUp',code:'ArrowUp'});assert.equal(actions.length,0);assert(logs.some(x=>x[0]==='action_ignored'));});
test('stick only requests directions on edges; raw analog changes are logged',()=>{
 const {c,u,actions,logs}=setup();u.pad.gp={id:'test',axes:[.8,0],buttons:[]};u.leftStick=()=>({x:u.pad.gp.axes[0],y:0});
 c.update();c.update();assert.deepEqual(actions,[1]);u.pad.gp.axes[0]=.9;c.update();assert.deepEqual(actions,[1]);
 u.pad.gp.axes[0]=0;c.update();u.pad.gp.axes[0]=.8;c.update();assert.deepEqual(actions,[1,1]);
 assert.equal(logs.filter(x=>x[0]==='controller_state').length,4);
});

test('pause keys use fresh edges and gamepad Start uses the same pause callback',()=>{
 const {c,u}=setup(), toggles=[];let plays=0;
 c.onPause=source=>toggles.push(source);c.onPlay=()=>plays++;
 c.keyPressed({key:' ',code:'Space'});c.keyPressed({key:' ',code:'Space',repeat:true});
 c.keyReleased({key:' ',code:'Space'});c.keyPressed({key:'p',code:'KeyP'});
 c.keyReleased({key:'p',code:'KeyP'});c.keyPressed({key:'P',code:'KeyP'});
 u.justPressedButton=name=>name==='START';c.update();
 assert.deepEqual(toggles,['keyboard_space','keyboard_p','keyboard_p','controller_start']);
 assert.equal(plays,0);
});
