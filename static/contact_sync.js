/* Contact-only audio/photodiode markers. No simulation rules or network calls.
 * Audio and flash are requested in one render callback. Software timestamps
 * describe submission/estimated audio output, not measured physical onsets. */
class ContactSync {
  constructor(options, logger) {
    this.config={flash_duration_ms:100,flash_size_px:80,flash_x:0,flash_y:0,
      capture_frequency_hz:1500,death_frequency_hz:400,sound_duration_ms:60,
      sound_gain:0.18,...options};
    for(const key of ['flash_duration_ms','flash_size_px','capture_frequency_hz','death_frequency_hz','sound_duration_ms']) {
      if(!Number.isFinite(this.config[key]) || this.config[key]<=0) throw Error(`Invalid sync_signals.${key}`);
    }
    if(!Number.isFinite(this.config.sound_gain) || this.config.sound_gain<=0 || this.config.sound_gain>1) throw Error('Invalid sync_signals.sound_gain');
    for(const key of ['flash_x','flash_y']) if(!Number.isFinite(this.config[key]) || this.config[key]<0) throw Error(`Invalid sync_signals.${key}`);
    if(this.config.capture_frequency_hz===this.config.death_frequency_hz) throw Error('Contact sync sounds must have distinct frequencies');
    this.logger=logger; this.pending=[]; this.context=null; this.buffers={}; this.activeFlash=null;
    this.photodiode=new Photodiode({x:this.config.flash_x,y:this.config.flash_y,
      size:this.config.flash_size_px,color:'white',default_duration:this.config.flash_duration_ms},width,height);
  }
  get ready() {return this.context?.state==='running';}
  prepare() {
    // Call directly from a keyboard/mouse gesture; buffers are prepared once.
    try {
      if(!this.context) {
        const Audio=globalThis.AudioContext || globalThis.webkitAudioContext;
        if(!Audio) throw Error('This browser does not support Web Audio');
        this.context=new Audio({latencyHint:'interactive'});
        this.context.onstatechange=()=>this.logger.log('sync_audio_state',{state:this.context.state});
        this.buffers.ghost_eaten=this.makeBuffer(this.config.capture_frequency_hz);
        this.buffers.pacman_eaten=this.makeBuffer(this.config.death_frequency_hz);
        this.logger.log('sync_audio_initialized',{sample_rate_hz:this.context.sampleRate,...this.audioTiming()});
      }
      if(this.ready) return Promise.resolve();
      return this.context.resume().then(()=>{
        if(!this.ready) throw Error('Audio needs a click or keyboard press to start');
      });
    } catch(error) {return Promise.reject(error);}
  }
  makeBuffer(frequency) {
    const rate=this.context.sampleRate;
    if(frequency>=rate/2) throw Error('Sync tone frequency must be below half the audio sample rate');
    const samples=Math.max(2,Math.round(rate*this.config.sound_duration_ms/1000));
    const buffer=this.context.createBuffer(1,samples,rate), data=buffer.getChannelData(0);
    const tail=Math.max(1,Math.min(samples-1,Math.round(rate*.005)));
    // Cosine starts at full gain on sample zero: no silence, attack ramp, or
    // compressed-file padding. Only the final 5 ms fades to prevent a second click.
    for(let i=0;i<samples;i++) {
      const envelope=Math.min(1,(samples-1-i)/tail);
      data[i]=this.config.sound_gain*Math.cos(2*Math.PI*frequency*i/rate)*envelope;
    }
    return buffer;
  }
  audioTiming() {
    return {audio_context_state:this.context?.state??'uninitialized',
      audio_base_latency_s:this.context?.baseLatency??null,audio_output_latency_s:this.context?.outputLatency??null};
  }
  queue(event, record) {
    if(event.type!=='contact') return;
    this.pending.push({kind:event.context===OFFENSE?'ghost_eaten':'pacman_eaten',
      contact_sequence:record.sequence,contact_tick:event.tick,contact_game_id:record.game_id,
      queued_performance_ms:performance.now()});
  }
  endFlash(reason) {
    if(!this.activeFlash) return;
    this.logger.log('sync_flash_end',{...this.activeFlash,reason,visual_end_draw_performance_ms:performance.now()});
    this.activeFlash=null; this.photodiode.start_time=undefined;
  }
  render(paused=false) {
    if(paused) {this.endFlash('paused');return;}
    for(const marker of this.pending.splice(0)) {
      this.endFlash('retriggered');
      const payload={...marker,trigger_performance_ms:performance.now(),
        audio_frequency_hz:marker.kind==='ghost_eaten'?this.config.capture_frequency_hz:this.config.death_frequency_hz,
        sound_duration_ms:this.config.sound_duration_ms,sound_gain:this.config.sound_gain,
        flash_duration_ms:this.config.flash_duration_ms,flash_x:this.photodiode.x,flash_y:this.photodiode.y,flash_size_px:this.photodiode.size,
        ...this.audioTiming(),audio_requested:false,audio_scheduled_context_time_s:null,
        estimated_audio_output_performance_ms:null};
      if(this.ready) {
        try {
          const source=this.context.createBufferSource(); source.buffer=this.buffers[marker.kind];
          source.connect(this.context.destination); source.onended=()=>source.disconnect();
          const when=this.context.currentTime;
          source.start(when); payload.audio_requested=true; payload.audio_scheduled_context_time_s=when;
          const timestamp=this.context.getOutputTimestamp?.();
          if(timestamp && timestamp.performanceTime>0) payload.estimated_audio_output_performance_ms=timestamp.performanceTime+(when-timestamp.contextTime)*1000;
        } catch(error) {payload.audio_error=error.message;}
      } else payload.audio_error='Audio context is not running';
      this.photodiode.trigger();
      push();this.photodiode.render();pop();
      payload.visual_draw_performance_ms=performance.now();
      const record=this.logger.log('sync_trigger',payload);
      this.activeFlash={kind:marker.kind,trigger_sequence:record.sequence,contact_sequence:marker.contact_sequence};
    }
    if(this.activeFlash) {
      this.photodiode.update();
      if(this.photodiode.start_time===undefined) this.endFlash('duration_elapsed');
      else {push();this.photodiode.render();pop();}
    }
  }
}
