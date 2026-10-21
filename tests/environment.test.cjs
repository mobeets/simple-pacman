const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {GhostGridEnv}=require('../static/environment.js');
const defaults=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../static/configs/default.json')));
function make(overrides={}) {return new GhostGridEnv({...defaults,use_power_pellet:false,defense_mean_duration_s:1e9,offense_mean_duration_s:1e9,ghost_stay_probability:1,...overrides},42);}
function ready(e) {e.reset();for(let i=0;i<60;i++)e.step();e.pacman=e.entity([0,0]);e.ghost=e.entity([4,4]);e.drainEvents();}
function ticks(e,n) {for(let i=0;i<n;i++)e.step();}
test('Python maze and action convention; exactly 21 cells and 9 nodes',()=>{const e=make();assert.equal(e.cells.length,21);assert.equal(e.nodes.length,9);assert(!e.cells.some(p=>p[0]===1&&p[1]===1));assert.deepEqual(e.target([0,0],1),[0,2]);});
test('all 72 distinct ordered starts occur before reshuffle, across games',()=>{const e=make(),pairs=new Set();for(let i=0;i<72;i++){e.state='menu';e.reset();pairs.add(JSON.stringify([e.pacman.position,e.ghost.position]));}assert.equal(pairs.size,72);assert.equal(e.scheduleCycle,1);e.state='menu';e.reset();assert.equal(e.scheduleCycle,2);});
test('start freezes positions and ignores actions for exactly one second',()=>{const e=make();e.reset();const p=e.pacman.position.slice();assert.equal(e.action(1),false);ticks(e,59);assert.equal(e.state,'game_start');assert.deepEqual(e.pacman.position,p);e.step();assert.equal(e.state,'defense');});
test('mandatory node stops; no buffered turns; immediate reversals',()=>{const e=make();ready(e);assert(e.action(1));ticks(e,6);assert.equal(e.action(2),false);assert(e.action(3));ticks(e,6);assert.deepEqual(e.pacman.position,[0,0]);assert.equal(e.pacman.target,null);assert(e.action(1));ticks(e,24);assert.deepEqual(e.pacman.position,[0,2]);ticks(e,24);assert.deepEqual(e.pacman.position,[0,2]);});
test('head-on crossing triggers collision between nodes',()=>{const e=make();ready(e);e.pacman=e.entity([0,0]);e.ghost=e.entity([0,2]);e.action(1);e.ghost.target=[0,0];e.ghost.direction=3;ticks(e,12);assert.equal(e.state,'dying');assert.equal(e.lives,2);});
test('three deaths end a game; animation does not start a new episode',()=>{const e=make();ready(e);for(let i=0;i<3;i++){e.contact();assert.equal(e.state,'dying');ticks(e,60);if(i<2){assert.equal(e.state,'respawn_ready');assert.equal(e.action(1),false);ticks(e,59);assert.equal(e.state,'respawn_ready');e.step();assert.equal(e.state,'defense');}assert.equal(e.gameId,1);}assert.equal(e.state,'menu');assert.equal(e.lives,0);});
test('capture respawns only ghost at safe distance, retaining offense',()=>{const e=make();ready(e);e.setContext(1);const p=e.pacman.position.slice();e.contact();assert.equal(e.state,'eat_ghost');ticks(e,60);assert.equal(e.state,'offense');assert.equal(e.lives,3);assert.deepEqual(e.pacman.position,p);assert(e.mazeDistance(p,e.ghost.position)>=defaults.respawn_min_distance);});
test('pellet appears geometrically, excludes entities, and triggers offense animation',()=>{const e=make({use_power_pellet:true,power_pellet_mean_delay_s:.2});ready(e);ticks(e,12);assert(e.pellet);assert(e.distance(e.pellet,e.pacman.position)>0);assert(e.distance(e.pellet,e.ghost.position)>0);e.pellet=e.pacman.position.slice();e.step();assert.equal(e.state,'eat_power_pellet');assert.equal(e.context,1);assert.equal(e.pellet,null);ticks(e,60);assert.equal(e.state,'offense');});
test('geometric mean uses bin / mean; contexts switch only when enabled',()=>{const e=make({defense_mean_duration_s:.2,offense_mean_duration_s:.2});ready(e);ticks(e,12);assert.equal(e.context,1);ticks(e,12);assert.equal(e.context,0);const p=make({use_power_pellet:true,power_pellet_mean_delay_s:1e9,defense_mean_duration_s:.2});ready(p);ticks(p,120);assert.equal(p.context,0);});
test('ghost stays or selects uniformly among legal node departures in either context',()=>{const e=make({ghost_stay_probability:0});ready(e);e.ghost=e.entity([2,2]);e.ghostDecision();assert.notEqual(e.ghost.target,null);assert.equal(e.distance(e.ghost.position,e.ghost.target),2);const stay=make();ready(stay);stay.ghostDecision();assert.equal(stay.ghost.target,null);});
test('seeded simulations exactly reproduce states and events',()=>{const a=make({ghost_stay_probability:.2}),b=make({ghost_stay_probability:.2});a.reset();b.reset();for(let i=0;i<2000;i++){if(i%7===0){a.action(i%4);b.action(i%4);}assert.deepEqual(a.step(),b.step());assert.deepEqual(a.drainEvents(),b.drainEvents());}});
test('long randomized runs preserve traversable positions and finite scores',()=>{const e=make({ghost_stay_probability:.2,defense_mean_duration_s:4,offense_mean_duration_s:4});for(let i=0;i<20000;i++){if(e.state==='menu')e.reset();if(i%11===0)e.action(i%4);e.step();for(const x of [e.pacman,e.ghost]){const [r,c]=x.position;assert(r>=0&&r<=4&&c>=0&&c<=4);assert([0,2,4].some(n=>Math.abs(r-n)<1e-7||Math.abs(c-n)<1e-7));}assert(Number.isFinite(e.score));e.drainEvents();}});
test('capture snaps Pacman after the animation and uses snapped node for safe respawn',()=>{
 const e=make();ready(e);e.setContext(1);e.pacman=e.entity([0,1.3]);e.contact();
 assert.deepEqual(e.pacman.position,[0,1.3]);ticks(e,59);assert.deepEqual(e.pacman.position,[0,1.3]);
 e.step();assert.deepEqual(e.pacman.position,[0,2]);assert.equal(e.pacman.target,null);
 assert(e.mazeDistance(e.pacman.position,e.ghost.position)>=defaults.respawn_min_distance);
 assert(e.drainEvents().some(x=>x.type==='pacman_snapped'));
});
test('capture and death snap to nodes with consistent midpoint ties',()=>{
 const e=make();ready(e);e.setContext(1);e.pacman=e.entity([0,1]);e.contact();ticks(e,60);assert.deepEqual(e.pacman.position,[0,0]);
 e.setContext(0);e.pacman=e.entity([0,1.3]);e.contact();ticks(e,60);assert.deepEqual(e.pacman.position,[0,2]);assert.equal(e.state,'respawn_ready');
});
test('offense censors exactly the edge toward Pacman at an adjacent node or along its edge',()=>{
 const e=make({ghost_stay_probability:0});ready(e);e.context=1;e.ghost=e.entity([2,2]);
 for(const [action,position] of [[0,[0,2]],[1,[2,4]],[2,[4,2]],[3,[2,0]],[0,[1.5,2]],[1,[2,2.1]],[2,[3,2]],[3,[2,.5]]]) {
  e.pacman=e.entity(position);const choices=e.ghostActions();assert.equal(choices.length,3);assert(!choices.includes(action));
  for(let i=0;i<20;i++){e.ghost=e.entity([2,2]);e.ghostDecision();assert.notEqual(e.ghost.direction,action);}
 }
});
test('offense leaves distant and off-edge directions random; defense never censors',()=>{
 const e=make();ready(e);e.context=1;e.ghost=e.entity([0,0]);
 for(const p of [[0,2.01],[0,4],[2,2]]) {e.pacman=e.entity(p);assert.deepEqual(e.ghostActions(),[1,2]);}
 e.context=0;e.pacman=e.entity([0,1]);assert.deepEqual(e.ghostActions(),[1,2]);
});

test('life loss clears visible pellets immediately and logs disappearance',()=>{
 const e=make({use_power_pellet:true});ready(e);e.pellet=[2,2];e.pacman=e.entity([0,1.3]);
 e.contact();assert.equal(e.pellet,null);assert.equal(e.lives,2);
 assert(e.drainEvents().some(x=>x.type==='pellet_disappeared'&&x.reason==='life_lost'));
 ticks(e,60);assert.deepEqual(e.pacman.position,[0,2]);assert(e.atNode(e.ghost.position));
 assert(e.mazeDistance(e.pacman.position,e.ghost.position)>=defaults.respawn_min_distance);
 ticks(e,60);assert.equal(e.pellet,null);assert.equal(e.state,'defense');
});
