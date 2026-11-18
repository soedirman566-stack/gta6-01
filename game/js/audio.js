// audio.js — all sound is synthesized with WebAudio. No audio files.
// Engine hum, police siren, gunshots, punches, crashes, jingles and a
// small bassline music loop, all generated from oscillators and noise.

export class SoundFX {
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
  }

  // Must be called from a user gesture at least once.
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ------------------------------------------------------------ engine
  engineStart() {
    if (!this.ctx || this.engineOsc) return;
    const c = this.ctx;
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 320;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineOsc.connect(lp); lp.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
  }
  engineUpdate(speedRatio, running) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.now();
    const target = running ? 0.05 + Math.abs(speedRatio) * 0.05 : 0.0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.1);
    this.engineOsc.frequency.setTargetAtTime(50 + Math.abs(speedRatio) * 130, t, 0.08);
  }
  engineStop() {
    if (!this.ctx || !this.engineOsc) return;
    try { this.engineOsc.stop(); } catch (e) { /* already stopped */ }
    this.engineOsc = null; this.engineGain = null;
  }

  // ------------------------------------------------------------ siren
  sirenStart() {
    if (!this.ctx || this.sirenOsc) return;
    const c = this.ctx;
    this.sirenOsc = c.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 800;
    this.sirenLfo = c.createOscillator();
    this.sirenLfo.type = 'square';
    this.sirenLfo.frequency.value = 0.9;
    const lfoGain = c.createGain(); lfoGain.gain.value = 160;
    this.sirenLfo.connect(lfoGain); lfoGain.connect(this.sirenOsc.frequency);
    this.sirenGain = c.createGain();
    this.sirenGain.gain.value = 0.0;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start(); this.sirenLfo.start();
  }
  sirenUpdate(distance) {
    if (!this.ctx || !this.sirenOsc) return;
    const v = Math.max(0, 0.16 * (1 - distance / 90));
    this.sirenGain.gain.setTargetAtTime(v, this.now(), 0.2);
  }
  sirenStop() {
    if (!this.ctx || !this.sirenOsc) return;
    try { this.sirenOsc.stop(); this.sirenLfo.stop(); } catch (e) { /* noop */ }
    this.sirenOsc = null; this.sirenGain = null; this.sirenLfo = null;
  }

  // ------------------------------------------------------------ one-shots
  noiseBurst(dur, freq, gainVal, type = 'lowpass') {
    if (!this.ctx) return;
    const c = this.ctx;
    const len = Math.max(1, (dur * c.sampleRate) | 0);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = gainVal;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
  }

  tone(freq, dur, gainVal, type = 'sine', slideTo = null, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const t0 = this.now() + delay;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gainVal, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  shot() {
    this.noiseBurst(0.16, 2600, 0.5, 'highpass');
    this.noiseBurst(0.1, 500, 0.4);
    this.tone(140, 0.09, 0.3, 'square', 45);
  }
  punch() {
    this.noiseBurst(0.07, 300, 0.35);
    this.tone(95, 0.08, 0.3, 'sine', 50);
  }
  crash(intensity = 1) {
    this.noiseBurst(0.28, 700, 0.35 * intensity);
    this.tone(70, 0.25, 0.3 * intensity, 'sine', 38);
  }
  pickup() {
    this.tone(660, 0.09, 0.2, 'square');
    this.tone(880, 0.12, 0.2, 'square', null, 0.08);
  }
  cashJingle() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => this.tone(n, 0.14, 0.18, 'triangle', null, i * 0.07));
  }
  failBuzz() {
    this.tone(160, 0.3, 0.22, 'sawtooth', 90);
  }
  click() { this.tone(1200, 0.04, 0.12, 'square'); }

  // ------------------------------------------------------------ music
  // A lazy sunset-funk loop: bassline + soft chords, scheduled stepwise.
  musicStart() {
    if (!this.ctx || this.musicTimer) return;
    const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 73.4, 0, 82.4, 0];
    const chords = [
      [220, 261.6, 329.6], [174.6, 220, 261.6],
      [196, 246.9, 293.7], [164.8, 196, 246.9],
    ];
    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.muted) { this.musicStep++; return; }
      const step = this.musicStep % 16;
      const bar = ((this.musicStep / 16) | 0) % 4;
      const b = bass[step];
      if (b) this.tone(b, 0.22, 0.16, 'triangle');
      if (step === 0) {
        chords[bar].forEach((n) => this.tone(n, 1.4, 0.045, 'sine'));
      }
      if (step % 4 === 2) this.noiseBurst(0.03, 6000, 0.05, 'highpass');
      this.musicStep++;
    }, 150);
  }
  musicStop() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
  }
}
