// Coral City Heat — all-synth sound engine (WebAudio, no audio files).
// Engine hum, sirens, gunshots, punches, crashes, jingles and a bassline
// music loop are generated from oscillators and filtered noise buffers.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.noiseBuf = null;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // one shared white-noise buffer for shots / crashes / punches
    const len = this.ctx.sampleRate * 1.2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  blip(freq, dur, type = 'square', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur, vol, filterFreq, type = 'lowpass', delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  gunshot() { this.noise(0.16, 0.5, 2600, 'lowpass'); this.blip(160, 0.1, 'square', 0.25, 40); }
  punch() { this.noise(0.08, 0.3, 700); this.blip(110, 0.09, 'sine', 0.35, 55); }
  crash(big = false) { this.noise(big ? 0.4 : 0.2, big ? 0.55 : 0.32, 480); this.blip(70, 0.22, 'sine', 0.3, 34); }
  pickup() { [660, 880, 1320].forEach((f, i) => this.blip(f, 0.14, 'triangle', 0.22, null, i * 0.07)); }
  cashReward() { [523, 659, 784, 1046, 1318].forEach((f, i) => this.blip(f, 0.16, 'triangle', 0.2, null, i * 0.06)); }
  fail() { this.blip(300, 0.35, 'sawtooth', 0.18, 110); }
  click() { this.blip(900, 0.05, 'square', 0.12); }
  door() { this.blip(220, 0.09, 'square', 0.15, 160); this.noise(0.06, 0.1, 900); }

  // ---- continuous engine hum, frequency follows speed ----
  engine(on, speedRatio = 0) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420;
      this.engineOsc.connect(f); f.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    if (this.engineOsc) {
      const t = this.ctx.currentTime;
      this.engineOsc.frequency.setTargetAtTime(55 + speedRatio * 165, t, 0.08);
      this.engineGain.gain.setTargetAtTime(on && !this.muted ? 0.055 + speedRatio * 0.05 : 0, t, 0.1);
      if (!on) {
        const osc = this.engineOsc, g = this.engineGain;
        setTimeout(() => { try { osc.stop(); } catch (e) {} }, 350);
        this.engineOsc = null; this.engineGain = null;
      }
    }
  }

  // ---- two-tone police siren while any cop is close ----
  siren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 800;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.9;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 160;
      this.sirenLfo.connect(lfoGain); lfoGain.connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0.0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start(); this.sirenLfo.start();
    }
    if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(on && !this.muted ? 0.035 : 0, this.ctx.currentTime, 0.2);
      if (!on) {
        const o = this.sirenOsc, l = this.sirenLfo;
        setTimeout(() => { try { o.stop(); l.stop(); } catch (e) {} }, 600);
        this.sirenOsc = null; this.sirenGain = null; this.sirenLfo = null;
      }
    }
  }

  // ---- lazy sunset bassline: A-minor groove, one bar loop ----
  startMusic() {
    if (!this.ctx || this.musicTimer) return;
    const bass = [55, 0, 55, 55, 0, 65.4, 0, 49, 55, 0, 55, 55, 0, 82.4, 73.4, 49];
    const pad = [220, 261.6, 329.6];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted || this.ctx.state !== 'running') return;
      const step = this.musicStep++;
      const f = bass[step % bass.length];
      if (f) this.blip(f, 0.22, 'triangle', 0.16);
      if (step % 32 === 0) pad.forEach(p => this.blip(p, 1.6, 'sine', 0.028));
      if (step % 4 === 2) this.noise(0.03, 0.03, 6000, 'highpass');
    }, 150);
  }
}
