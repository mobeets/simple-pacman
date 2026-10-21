/* p5 rendering only: consumes snapshots; never changes simulation state. */
class GameRenderer {
  constructor() {this.titleTextSize=46;}
  layout() {
    this.board=Math.min(width-48,height-150,720);
    this.cell=this.board/5;
    this.left=(width-this.board)/2; this.top=(height-this.board)/2+30;
  }
  point(pos) { return [this.left+(pos[1]+0.5)*this.cell,this.top+(pos[0]+0.5)*this.cell]; }
  render(env,scores,paused) {
    background('black'); this.layout();
    if(paused) {cursor(ARROW);noStroke();fill('white');textStyle(NORMAL);textAlign(CENTER,CENTER);textSize(this.titleTextSize);text('PAUSED',width/2,height/2);return;}
    if(env.state==='menu') { this.menu(scores); return; }
    cursor(ARROW);
    this.cell=this.board/env.config.size;
    textAlign(LEFT,CENTER); textSize(20); fill('#edf2ff'); noStroke();
    text(`POINTS  ${Number(env.score.toFixed(2))}`,this.left,this.top-32);
    this.drawLives(env.lives);
    this.maze(env);
    if(env.pellet) {
      const [x,y]=this.point(env.pellet); noStroke(); fill('#ffefb7'); circle(x,y,this.cell*0.21);
    }
    this.ghost(env); this.pacman(env);
    if(env.state==='eat_ghost') this.capturePoints(env);
    if(['game_start','respawn_ready'].includes(env.state)) this.banner('READY');
  }
  maze(env) {
    const c=this.cell;
    noFill(); stroke('#245cff'); strokeWeight(2);
    // Two outlines at each wall, with black between and inside them.
    rect(this.left-4,this.top-4,this.board+8,this.board+8,16);
    rect(this.left+3,this.top+3,this.board-6,this.board-6,10);
    for(let r=0;r<env.config.size;r++) for(let col=0;col<env.config.size;col++) {
      if(!env.cells.some(p=>p[0]===r && p[1]===col)) {
        const [x,y]=this.point([r,col]);
        rect(x-c*.43,y-c*.43,c*.86,c*.86,10);
        rect(x-c*.43+7,y-c*.43+7,c*.86-14,c*.86-14,5);
      }
    }
    // Small junction markings make the mandatory stopping locations apparent.
    noStroke(); fill('#314363'); for(const pos of env.nodes) {const [x,y]=this.point(pos); circle(x,y,4);}
  }
  drawLives(lives) {
    const diameter=18, gap=7, right=this.left+this.board, y=this.top-32;
    noStroke(); fill('#edf2ff'); textAlign(RIGHT,CENTER); textSize(20);
    text('LIVES',right-lives*(diameter+gap)-8,y);
    fill('#ffd340');
    for(let i=0;i<lives;i++) arc(right-diameter/2-i*(diameter+gap),y,diameter,diameter,.3,TWO_PI-.3,PIE);
  }
  pacman(env) {
    let [x,y]=this.point(env.pacman.position), r=this.cell*.29;
    const fraction=Math.min(1,env.transitionElapsed/env.config.transition_duration_s);
    if(env.state==='dying') r*=1-fraction;
    if(r<.5) return;
    push(); translate(x,y); rotate([-HALF_PI,0,HALF_PI,PI][env.pacman.direction]);
    const mouth=env.state==='dying'?Math.min(PI-.01,.2+fraction*PI):(env.active && env.pacman.target ? .13+.22*(.5+.5*Math.sin(env.time*22)) : .24);
    noStroke(); fill('#ffd340'); arc(0,0,r*2,r*2,mouth,TWO_PI-mouth,PIE); pop();
    if(env.state==='eat_power_pellet') {noFill(); stroke('#ffe5a0'); strokeWeight(3); circle(x,y,r*2+fraction*this.cell*.7);}
  }
  ghost(env) {
    const [x,y]=this.point(env.ghost.position), r=this.cell*.29;
    const fraction=Math.min(1,env.transitionElapsed/env.config.transition_duration_s);
    push(); translate(x,y);
    if(env.state==='eat_ghost') scale(Math.max(0.01,1-fraction));
    // User-defined palette: blue defense, red offense; never blink.
    noStroke(); fill(env.context===DEFENSE?'#3875eb':'#f04d59');
    arc(0,0,2*r,2*r,PI,TWO_PI); rect(-r,-1,2*r,r+1);
    beginShape(); vertex(-r,r*.7); for(let i=0;i<=6;i++) vertex(-r+i*r/3,r*(i%2?1.18:.82)); vertex(r,0); vertex(-r,0); endShape(CLOSE);
    if(env.context===DEFENSE) {
      fill('white'); ellipse(-r*.37,-r*.08,r*.48,r*.66); ellipse(r*.37,-r*.08,r*.48,r*.66);
      const [dr,dc]=DELTAS[env.ghost.direction]; fill('#16234f');
      circle(-r*.37+dc*r*.08,-r*.08+dr*r*.08,r*.23); circle(r*.37+dc*r*.08,-r*.08+dr*r*.08,r*.23);
    } else {
      fill('#ffe9de'); circle(-r*.35,-r*.12,r*.17); circle(r*.35,-r*.12,r*.17);
      noFill(); stroke('#ffe9de'); strokeWeight(2); beginShape();
      for(let i=0;i<7;i++) vertex(-r*.58+i*r*.19,r*(i%2?.35:.48)); endShape();
    }
    pop();
  }
  capturePoints(env) {
    const [x,y]=this.point(env.ghost.position);
    const labelX=Math.max(this.left+30,Math.min(this.left+this.board-30,x+this.cell*.45));
    const labelY=Math.max(this.top+18,y-this.cell*.45);
    push(); noStroke(); fill('#76efff'); textAlign(CENTER,CENTER); textSize(24); textStyle(BOLD);
    text(Number(env.config.offense_contact_reward.toFixed(2)),labelX,labelY); pop();
  }
  banner(label) {
    textAlign(CENTER,CENTER); textSize(this.titleTextSize); noStroke(); fill('#424242'); rect(width/2-120,height/2-38,240,76,10); fill('#ffe3a0'); text(label,width/2,height/2);
  }
  playBounds() {return {x:width/2-100,y:height*.35,w:200,h:68};}
  menu(scores) {
    const b=this.playBounds(), hover=this.hitPlay(mouseX,mouseY), pressed=this.playPressed && hover;
    cursor(hover?HAND:ARROW);
    noStroke(); textAlign(CENTER,CENTER); fill('#ffd340'); textSize(this.titleTextSize); textStyle(BOLD);
    text('PACMAN',width/2,height*.19); textStyle(NORMAL);
    fill(pressed?'#cda21f':hover?'#ffe57b':'#ffd340');
    const inset=pressed?3:0;
    rect(b.x+inset,b.y+inset,b.w-2*inset,b.h-2*inset,14);
    fill('#111727'); textSize(28); text('Play',width/2,b.y+b.h/2+(pressed?2:0));
    if(this.audioMessage) {fill('#edf2ff');textSize(14);text(this.audioMessage,width/2,b.y+94);}
    if(scores.length) {
      fill('#8292b5'); textSize(20); text('SESSION HIGH SCORES',width/2,b.y+115);
      scores.slice().sort((a,b)=>b.score-a.score).slice(0,5).forEach((s,i)=>{
        textStyle(s.game_id===scores[scores.length-1].game_id?BOLD:NORMAL);
        fill('#e3eaff'); textSize(20); text(`${i+1}.   ${Number(s.score.toFixed(2))}`,width/2,b.y+157+i*34);
      });
      textStyle(NORMAL);
    }
  }
  hitPlay(x,y) { const b=this.playBounds(); return x>=b.x && x<=b.x+b.w && y>=b.y && y<=b.y+b.h; }
}
