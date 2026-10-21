/* Headless simulation. Coordinates are [row, column]; actions match Python.
 * No p5, DOM, wall clock, or network dependencies. */
(function (root) {
  'use strict';
  const DEFENSE = 0, OFFENSE = 1;
  const ACTION_NAMES = ['up', 'right', 'down', 'left'];
  const DELTAS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  const ACTIVE = ['defense', 'offense'];
  const copy = x => JSON.parse(JSON.stringify(x));
  class Random {
    constructor(seed) { this.state = seed >>> 0; }
    next() {
      this.state = (this.state + 0x6D2B79F5) >>> 0;
      let t = this.state;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    choice(xs) { return xs[Math.floor(this.next() * xs.length)]; }
    shuffle(xs) {
      for (let i = xs.length - 1; i > 0; --i) {
        const j = Math.floor(this.next() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
      }
      return xs;
    }
  }
  class GhostGridEnv {
    constructor(config, seed = 1) {
      this.config = copy(config);
      this.validate();
      this.rng = new Random(seed);
      this.seed = seed >>> 0;
      this.cells = []; this.nodes = [];
      const n = config.size, mid = (n - 1) / 2;
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
        if ([0, mid, n - 1].includes(r) || [0, mid, n - 1].includes(c)) this.cells.push([r, c]);
        if ([0, mid, n - 1].includes(r) && [0, mid, n - 1].includes(c)) this.nodes.push([r, c]);
      }
      this.startPairs = []; this.startIndex = 0; this.scheduleCycle = 0;
      this.gameId = 0; this.tick = 0; this.time = 0; this.state = 'menu';
      this.context = DEFENSE; this.score = 0; this.lives = 0;
      this.pacman = null; this.ghost = null; this.pellet = null;
      this.events = []; this.transitionElapsed = 0; this.activeTime = 0;
    }
    validate() {
      const c = this.config;
      if (!Number.isInteger(c.size) || c.size < 5 || c.size % 4 !== 1) throw Error('size must be 5, 9, 13, ...');
      for (const k of ['simulation_hz','pacman_speed','ghost_speed','ghost_decision_bin_s','context_bin_s','defense_mean_duration_s','offense_mean_duration_s','power_pellet_mean_delay_s','reward_bin_s','transition_duration_s','collision_distance','pellet_eat_distance']) {
        if (!Number.isFinite(c[k]) || c[k] <= 0) throw Error(`Invalid ${k}`);
      }
      for (const k of ['defense_survival_reward','defense_contact_reward','offense_step_reward','offense_contact_reward','power_pellet_points']) if (!Number.isFinite(c[k])) throw Error(`Invalid ${k}`);
      if (!Number.isInteger(c.lives) || c.lives < 1) throw Error('Invalid lives');
      if (c.ghost_stay_probability < 0 || c.ghost_stay_probability > 1 || !Number.isFinite(c.ghost_stay_probability)) throw Error('Invalid stay probability');
      if (!Number.isFinite(c.respawn_min_distance) || c.respawn_min_distance < 1 || c.respawn_min_distance > c.size-1) throw Error('Invalid respawn_min_distance');
      for (const k of ['defense_mean_duration_s','offense_mean_duration_s','power_pellet_mean_delay_s']) if(c[k] < c.context_bin_s) throw Error(`${k} must be >= context_bin_s`);
      if (Math.max(c.pacman_speed,c.ghost_speed)/c.simulation_hz > 0.25) throw Error('Increase simulation_hz for these speeds');
    }
    emit(type, payload = {}) { this.events.push({type, tick:this.tick, game_time_s:this.time, ...copy(payload)}); }
    drainEvents() { const out = this.events; this.events = []; return out; }
    get active() { return ACTIVE.includes(this.state); }
    entity(pos) { return {position:pos.slice(), target:null, direction:1}; }
    reset() {
      if (this.state !== 'menu') return false;
      if (this.startIndex >= this.startPairs.length) {
        this.startPairs = this.rng.shuffle(this.nodes.flatMap((p, i) => this.nodes.filter((g,j) => i !== j).map(g => [p.slice(), g.slice()])));
        this.startIndex = 0; this.scheduleCycle++;
        this.emit('start_schedule', {cycle:this.scheduleCycle, pairs:this.startPairs});
      }
      const pairIndex = this.startIndex++, [p,g] = this.startPairs[pairIndex];
      this.gameId++; this.tick = 0; this.time = 0; this.activeTime = 0;
      this.context = DEFENSE; this.score = 0; this.lives = this.config.lives;
      this.pacman = this.entity(p); this.ghost = this.entity(g); this.pellet = null;
      this.contextClock = 0; this.ghostClock = 0; this.rewardClock = 0;
      this.emit('game_start', {game_id:this.gameId, episode_id:this.gameId, pair_index:pairIndex, schedule_cycle:this.scheduleCycle, start_positions:[p,g]});
      this.transition('game_start');
      return true;
    }
    transition(state) {
      const previous = this.state; this.state = state; this.transitionElapsed = 0;
      this.emit('state_transition', {previous, state, context:this.context});
    }
    setContext(context) {
      if (context === this.context) return;
      const previous = this.context; this.context = context; this.contextClock = 0;
      this.pellet = null;
      this.emit('context_switch', {previous, context});
      this.transition(ACTIVE[context]);
    }
    atNode(pos) { return this.nodes.some(n => Math.hypot(n[0]-pos[0], n[1]-pos[1]) < 1e-7); }
    target(pos, action) {
      const [dr,dc] = DELTAS[action], n = this.config.size, mid = (n-1)/2;
      if (dr && ![0,mid,n-1].some(x=>Math.abs(pos[1]-x)<1e-7)) return null;
      if (dc && ![0,mid,n-1].some(x=>Math.abs(pos[0]-x)<1e-7)) return null;
      const candidates = this.nodes.filter(p => dr ? Math.abs(p[1]-pos[1])<1e-7 && (p[0]-pos[0])*dr>1e-7 : Math.abs(p[0]-pos[0])<1e-7 && (p[1]-pos[1])*dc>1e-7);
      candidates.sort((a,b)=>this.distance(a,pos)-this.distance(b,pos));
      return candidates.length ? candidates[0].slice() : null;
    }
    distance(a,b) { return Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1]); }
    action(action) {
      let accepted = false, reason = 'transition';
      if (!Number.isInteger(action) || action < 0 || action > 3) throw Error('Invalid action');
      if (this.active) {
        const p = this.pacman;
        if (p.target && action !== (p.direction+2)%4) reason = 'moving_no_buffer';
        else {
          const target = this.target(p.position, action);
          if (target) { p.target = target; p.direction = action; accepted = true; reason = 'accepted'; }
          else reason = 'wall';
        }
      }
      this.emit('action', {action, action_name:ACTION_NAMES[action], accepted, reason});
      return accepted;
    }
    advance(entity, speed, dt) {
      if (!entity.target) return;
      const d = this.distance(entity.position,entity.target), amount = speed*dt;
      if (d <= amount+1e-9) { entity.position = entity.target; entity.target = null; }
      else { const [dr,dc]=DELTAS[entity.direction]; entity.position[0]+=dr*amount; entity.position[1]+=dc*amount; }
    }
    sweptDistance(a0,a1,b0,b1) {
      const x=a0[0]-b0[0], y=a0[1]-b0[1];
      const dx=(a1[0]-a0[0])-(b1[0]-b0[0]), dy=(a1[1]-a0[1])-(b1[1]-b0[1]);
      const denom=dx*dx+dy*dy, t=denom ? Math.max(0,Math.min(1,-(x*dx+y*dy)/denom)) : 0;
      return Math.hypot(x+t*dx,y+t*dy);
    }
    ghostActions() {
      const origin = this.ghost.position, pacman = this.pacman.position;
      return [0,1,2,3].filter(action => {
        const target = this.target(origin, action);
        if (!target) return false;
        if (this.context !== OFFENSE) return true;
        const [dr,dc] = DELTAS[action];
        const along = (pacman[0]-origin[0])*dr + (pacman[1]-origin[1])*dc;
        const across = (pacman[0]-origin[0])*dc - (pacman[1]-origin[1])*dr;
        // Censor only the edge containing Pacman, including its far node.
        return !(Math.abs(across)<1e-7 && along>1e-7 && along<=this.distance(origin,target)+1e-7);
      });
    }
    ghostDecision() {
      if (this.ghost.target) return;
      const choices = this.ghostActions();
      const action = !choices.length || this.rng.next()<this.config.ghost_stay_probability ? null : this.rng.choice(choices);
      if(action !== null) { this.ghost.direction=action; this.ghost.target=this.target(this.ghost.position,action); }
      this.emit('ghost_decision', {action, available_actions:choices});
    }
    addReward(amount, reason) { if(amount) { this.score += amount; this.emit('reward', {amount, reason, score:this.score}); } }
    contact() {
      const defense=this.context===DEFENSE;
      this.addReward(defense?this.config.defense_contact_reward:this.config.offense_contact_reward, 'contact');
      if(defense) {
        this.lives--;
        if(this.pellet) {
          const position=this.pellet.slice(); this.pellet=null;
          this.emit('pellet_disappeared',{position,reason:'life_lost'});
        }
      }
      this.emit('contact', {context:this.context,lives:this.lives});
      this.pacman.target=null; this.ghost.target=null;
      this.transition(defense?'dying':'eat_ghost');
    }
    mazeDistance(a,b) {
      // Shortest continuous path through the nine-node corridor graph.
      const attach = p => this.nodes.filter(n=> (Math.abs(n[0]-p[0])<1e-7 || Math.abs(n[1]-p[1])<1e-7));
      let best=Infinity;
      for(const x of attach(a)) for(const y of attach(b)) best=Math.min(best,this.distance(a,x)+this.distance(x,y)+this.distance(y,b));
      if(Math.abs(a[0]-b[0])<1e-7 || Math.abs(a[1]-b[1])<1e-7) best=Math.min(best,this.distance(a,b));
      return best;
    }
    finishTransition() {
      if(this.state==='dying' && this.lives===0) {
        this.emit('game_end', {score:this.score,lives:this.lives}); this.transition('menu'); return;
      }
      const wasDying=this.state==='dying';
      if(['dying','eat_ghost'].includes(this.state)) {
        if(!this.atNode(this.pacman.position)) {
          const previous=this.pacman.position.slice();
          // Stable node order resolves exact midpoint ties without another RNG draw.
          const nearest=this.nodes.reduce((best,node)=>this.distance(previous,node)<this.distance(previous,best)-1e-7?node:best);
          this.pacman.position=nearest.slice(); this.pacman.target=null;
          this.emit('pacman_snapped',{previous,position:this.pacman.position});
        }
        const candidates=this.nodes.filter(n=>this.mazeDistance(this.pacman.position,n)>=this.config.respawn_min_distance);
        this.ghost=this.entity(this.rng.choice(candidates)); this.ghostClock=0;
        this.emit('ghost_respawn',{position:this.ghost.position});
      }
      this.transition(wasDying?'respawn_ready':ACTIVE[this.context]);
    }
    step() {
      if(this.state==='menu') return this.snapshot();
      const dt=1/this.config.simulation_hz, c=this.config;
      this.tick++; this.time=this.tick*dt;
      if(!this.active) {
        this.transitionElapsed+=dt;
        if(this.transitionElapsed+1e-9>=c.transition_duration_s) this.finishTransition();
        return this.snapshot();
      }
      this.activeTime+=dt;
      this.ghostClock+=dt;
      while(this.ghostClock+1e-9>=c.ghost_decision_bin_s) { this.ghostClock-=c.ghost_decision_bin_s; this.ghostDecision(); }
      const p0=this.pacman.position.slice(), g0=this.ghost.position.slice();
      this.advance(this.pacman,c.pacman_speed,dt); this.advance(this.ghost,c.ghost_speed,dt);
      if(this.pellet && this.sweptDistance(p0,this.pacman.position,this.pellet,this.pellet)<=c.pellet_eat_distance) {
        this.pellet=null; this.addReward(c.power_pellet_points,'power_pellet');
        this.context=OFFENSE; this.contextClock=0;
        this.emit('context_switch',{previous:DEFENSE,context:OFFENSE}); this.transition('eat_power_pellet'); return this.snapshot();
      }
      if(this.sweptDistance(p0,this.pacman.position,g0,this.ghost.position)<=c.collision_distance) { this.contact(); return this.snapshot(); }
      this.rewardClock+=dt;
      while(this.rewardClock+1e-9>=c.reward_bin_s) { this.rewardClock-=c.reward_bin_s; this.addReward(this.context===DEFENSE?c.defense_survival_reward:c.offense_step_reward,'time'); }
      this.contextClock+=dt;
      while(this.contextClock+1e-9>=c.context_bin_s && this.active) {
        this.contextClock-=c.context_bin_s;
        if(this.context===DEFENSE && c.use_power_pellet) {
          if(!this.pellet && this.rng.next()<c.context_bin_s/c.power_pellet_mean_delay_s) {
            const available=this.cells.filter(p=>Math.hypot(p[0]-this.pacman.position[0],p[1]-this.pacman.position[1])>c.pellet_eat_distance && Math.hypot(p[0]-this.ghost.position[0],p[1]-this.ghost.position[1])>c.collision_distance);
            this.pellet=this.rng.choice(available).slice(); this.emit('pellet_appeared',{position:this.pellet});
          }
        } else {
          const mean=this.context===DEFENSE?c.defense_mean_duration_s:c.offense_mean_duration_s;
          if(this.rng.next()<c.context_bin_s/mean) this.setContext(1-this.context);
        }
      }
      return this.snapshot();
    }
    snapshot() {
      return copy({game_id:this.gameId,episode_id:this.gameId,tick:this.tick,game_time_s:this.time,active_time_s:this.activeTime,state:this.state,context:this.context,score:this.score,lives:this.lives,pacman:this.pacman,ghost:this.ghost,power_pellet:this.pellet,transition_elapsed_s:this.transitionElapsed,ghost_clock_s:this.ghostClock??0,context_clock_s:this.contextClock??0,reward_clock_s:this.rewardClock??0,rng_state:this.rng.state});
    }
  }
  const api={GhostGridEnv,Random,DEFENSE,OFFENSE,ACTION_NAMES,DELTAS};
  if(typeof module!=='undefined') module.exports=api;
  Object.assign(root,api);
})(globalThis);
