// Procedural Web Audio API sound engine for CYBER-DEF (Zero external MP3 dependencies)

class CyberAudio {
  private ctx: AudioContext | null = null;
  public muted = false;
  public sfxVolume = 0.8;
  public bgmVolume = 0.35;
  private bgmGain: GainNode | null = null;
  private bgmStarted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public unlock(): void {
    const ctx = this.ensureCtx();
    if (ctx && !this.bgmStarted) {
      this.startAmbientBgm(ctx);
    }
  }

  private startAmbientBgm(ctx: AudioContext): void {
    this.bgmStarted = true;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.muted ? 0 : this.bgmVolume * 0.06, ctx.currentTime);
    masterGain.connect(ctx.destination);
    this.bgmGain = masterGain;

    const osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(65.41, ctx.currentTime); // Deep C2 pad

    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(98.0, ctx.currentTime); // G2 fifth

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(220, ctx.currentTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(masterGain);

    osc1.start();
    osc2.start();
  }

  public setSfxVolume(val: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, val));
  }

  public setBgmVolume(val: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, val));
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setTargetAtTime(
        this.muted ? 0 : this.bgmVolume * 0.06,
        this.ctx.currentTime,
        0.05
      );
    }
  }

  public playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'square',
    gainVal = 0.08,
    slideTo?: number
  ): void {
    const ctx = this.ensureCtx();
    if (!ctx || this.sfxVolume <= 0) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + duration);
    }
    const scaledGain = Math.max(0.001, gainVal * this.sfxVolume);
    gain.gain.setValueAtTime(scaledGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  public bootBeep(): void {
    this.playTone(880, 0.06, 'square', 0.04);
  }

  public keyClick(): void {
    this.playTone(540 + Math.random() * 180, 0.035, 'triangle', 0.05);
  }

  public errorBuzz(): void {
    this.playTone(150, 0.18, 'sawtooth', 0.1, 95);
  }

  public hitSuccess(): void {
    this.playTone(520, 0.08, 'sine', 0.08, 1040);
  }

  public explosion(): void {
    const ctx = this.ensureCtx();
    if (!ctx || this.sfxVolume <= 0) return;
    const dur = 0.22;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12 * this.sfxVolume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start();
  }

  public stageClear(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, idx) => {
      setTimeout(() => this.playTone(n, 0.16, 'triangle', 0.08), idx * 75);
    });
  }

  public alarm(): void {
    this.playTone(720, 0.12, 'sawtooth', 0.07, 420);
  }

  public powerDown(): void {
    this.playTone(440, 0.9, 'sine', 0.1, 32);
  }
}

export const audio = new CyberAudio();
