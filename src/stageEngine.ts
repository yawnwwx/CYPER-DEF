import { audio } from './audio';
import { STAGES } from './data/stages';
import { runClickAimEngine } from './engines/clickAimEngine';
import { runCodeBossEngine } from './engines/codeBossEngine';
import { runRapidMashEngine } from './engines/rapidMashEngine';
import { runRhythmControlEngine } from './engines/rhythmControlEngine';
import { runTypingEngine } from './engines/typingEngine';
import { StageRuntime } from './engines/types';

export interface StageEngineCallbacks {
  onStageClear: (stageId: number) => void;
  onRecordClear?: (stageId: number) => void;
  onExitToSelect: () => void;
}

interface PooledParticle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

class ParticlePool {
  private pool: PooledParticle[];

  constructor(capacity = 260) {
    this.pool = Array.from({ length: capacity }, () => ({
      active: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      size: 3,
      color: '#00ff41',
    }));
  }

  public spawnBurst(cx: number, cy: number, count: number, colorA = '#00ff41', colorB = '#00e5ff'): void {
    let spawned = 0;
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i];
      if (!p.active) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 90 + Math.random() * 230;
        p.active = true;
        p.x = cx;
        p.y = cy;
        p.vx = Math.cos(angle) * speed;
        p.vy = Math.sin(angle) * speed;
        p.life = 1;
        p.size = 3 + Math.random() * 3;
        p.color = spawned % 2 === 0 ? colorA : colorB;
        spawned++;
      }
    }
  }

  public updateAndDraw(ctx: CanvasRenderingContext2D, dt: number): void {
    for (let i = 0; i < this.pool.length; i++) {
      const p = this.pool[i];
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 1.75;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  public clear(): void {
    for (let i = 0; i < this.pool.length; i++) {
      this.pool[i].active = false;
    }
  }
}

function makeCrackPngDataUrl(): string {
  const c = document.createElement('canvas');
  c.width = 420;
  c.height = 420;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = 'rgba(235, 248, 255, 0.92)';
  ctx.lineWidth = 2.6;
  const cx = 210;
  const cy = 210;
  for (let i = 0; i < 14; i++) {
    let angle = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
    let x = cx;
    let y = cy;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) {
      const step = 28 + Math.random() * 26;
      angle += (Math.random() - 0.5) * 0.45;
      x += Math.cos(angle) * step;
      y += Math.sin(angle) * step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.stroke();
  return c.toDataURL('image/png');
}

const TYPING_STAGES = new Set([1, 6, 9, 12, 16, 21, 28, 29]);
const CLICK_AIM_STAGES = new Set([2, 7, 8, 11, 18, 19, 24, 26]);
const RHYTHM_CONTROL_STAGES = new Set([3, 13, 17, 23, 27]);
const RAPID_MASH_STAGES = new Set([4, 14, 22]);
const CODE_BOSS_STAGES = new Set([5, 10, 15, 20, 25, 30]);

interface ManagedTimeout {
  id: number;
  fn: () => void;
  remaining: number;
  startedAt: number;
  active: boolean;
}

export class StageGameEngine {
  private root: HTMLElement;
  private callbacks: StageEngineCallbacks;
  private rafId = 0;
  private pendingRafFn: ((now: number) => void) | null = null;
  private timeouts: ManagedTimeout[] = [];
  private cleanupFns: Array<() => void> = [];
  private destroyed = false;
  private paused = false;
  private pausedAt = 0;
  private pauseOffsetMs = 0;
  private stageFinished = false;
  private activeInputDock: HTMLElement | null = null;
  private activeCmdInput: HTMLInputElement | null = null;
  private particlePool = new ParticlePool(260);
  private crackPng: string;

  constructor(root: HTMLElement, callbacks: StageEngineCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.crackPng = makeCrackPngDataUrl();
  }

  public isStageActive(): boolean {
    return !this.destroyed && !this.stageFinished;
  }

  public setPaused(nextPaused: boolean): void {
    if (this.destroyed || this.paused === nextPaused) return;
    if (nextPaused) {
      this.paused = true;
      this.pausedAt = performance.now();
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = 0;
      }
      // Pause all active timeouts preserving remaining duration
      const now = performance.now();
      for (const t of this.timeouts) {
        if (!t.active) continue;
        clearTimeout(t.id);
        t.remaining = Math.max(0, t.remaining - (now - t.startedAt));
      }
      if (this.activeCmdInput) {
        this.activeCmdInput.blur();
        this.activeCmdInput.disabled = true;
      }
    } else {
      const pauseDelta = performance.now() - this.pausedAt;
      this.pauseOffsetMs += pauseDelta;
      this.paused = false;
      // Resume all paused timeouts with exact remaining duration
      const now = performance.now();
      for (const t of this.timeouts) {
        if (!t.active) continue;
        t.startedAt = now;
        t.id = window.setTimeout(() => {
          t.active = false;
          if (!this.destroyed && !this.paused) t.fn();
        }, t.remaining);
      }
      if (this.activeCmdInput) {
        this.activeCmdInput.disabled = false;
        if (this.activeInputDock && !this.activeInputDock.classList.contains('hidden')) {
          this.activeCmdInput.focus();
        }
      }
      if (this.pendingRafFn) {
        const resumeFn = this.pendingRafFn;
        this.pendingRafFn = null;
        this.scheduleRaf(resumeFn);
      }
    }
  }

  public stop(): void {
    this.destroyed = true;
    this.paused = false;
    this.stageFinished = false;
    this.pendingRafFn = null;
    this.activeInputDock = null;
    this.activeCmdInput = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.timeouts.forEach((t) => {
      t.active = false;
      clearTimeout(t.id);
    });
    this.timeouts = [];
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.particlePool.clear();
  }

  private scheduleRaf(fn: (now: number) => void): void {
    if (this.destroyed) return;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.paused) {
      this.pendingRafFn = fn;
      return;
    }
    this.pendingRafFn = fn;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      if (this.destroyed) return;
      if (this.paused) {
        this.pendingRafFn = fn;
        return;
      }
      this.pendingRafFn = null;
      fn(performance.now() - this.pauseOffsetMs);
    });
  }

  private addTimeout(fn: () => void, ms: number): void {
    const entry: ManagedTimeout = {
      id: 0,
      fn,
      remaining: ms,
      startedAt: performance.now(),
      active: true,
    };
    this.timeouts.push(entry);
    if (!this.paused) {
      entry.id = window.setTimeout(() => {
        entry.active = false;
        if (!this.destroyed && !this.paused) fn();
      }, ms);
    }
  }

  private onKey(handler: (e: KeyboardEvent) => void, type: 'keydown' | 'keyup' = 'keydown'): void {
    const wrapped = (e: KeyboardEvent) => {
      if (!this.destroyed && !this.paused) handler(e);
    };
    window.addEventListener(type, wrapped);
    this.cleanupFns.push(() => window.removeEventListener(type, wrapped));
  }

  public startStage(stageId: number): void {
    this.stop();
    this.destroyed = false;
    this.paused = false;
    this.pauseOffsetMs = 0;
    this.stageFinished = false;

    const stage = STAGES[stageId - 1];

    this.root.innerHTML = `
      <div id="game-shell" class="w-full h-full flex flex-col bg-[#0a0b0e] text-[#e6edf3]">
        <header class="flex items-center justify-between gap-4 px-5 py-3 pr-44 border-b border-white/10 bg-[#10131a]">
          <div class="flex items-center gap-4 min-w-0">
            <button id="game-exit-btn" class="cyber-btn px-3 py-1.5 text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer">
              ← 스테이지 목록
            </button>
            <div class="truncate">
              <div class="text-xs text-[#00ff41] font-bold tracking-wider whitespace-nowrap">
                STAGE ${String(stage.id).padStart(2, '0')} / 30 · Python (.py) · ${stage.zone}
              </div>
              <div class="text-sm font-bold text-white truncate">
                ${stage.name} <span class="text-xs font-normal text-slate-400">· ${stage.gimmick}</span>
              </div>
            </div>
          </div>

          <div class="flex items-center gap-5 shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-400">진행도</span>
              <span id="hud-progress" class="text-sm font-bold tabular-nums text-[#00ff41]">0%</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-400">시스템 안정도</span>
              <div class="w-24 h-2.5 bg-slate-800 border border-white/10 overflow-hidden rounded-sm">
                <div id="hud-hp-bar" class="h-full bg-[#00ff41] transition-all duration-150" style="width:100%"></div>
              </div>
              <span id="hud-hp-text" class="text-xs font-bold tabular-nums text-white w-8 text-right">100</span>
            </div>
          </div>
        </header>

        <div class="px-5 py-2.5 bg-[#141821] border-b border-white/10 flex items-center justify-between gap-4">
          <div class="text-xs sm:text-sm text-[#e6edf3]">
            <span class="text-[#ff007f] font-bold mr-2">[MISSION]</span>${stage.instruction}
          </div>
        </div>

        <div id="game-arena-wrap" class="relative flex-1 w-full overflow-hidden bg-[#07090d]">
          <canvas id="game-canvas" class="absolute inset-0 w-full h-full block"></canvas>
          <div id="game-dom" class="absolute inset-0 w-full h-full overflow-hidden"></div>
        </div>

        <div id="game-input-dock" class="hidden pl-20 pr-5 py-3 bg-[#10131a] border-t border-white/10 flex items-center gap-3">
          <span class="text-xs font-bold text-[#00ff41] whitespace-nowrap font-code">PYTHON &gt;&gt;&gt;</span>
          <input id="game-cmd-input" type="text" autocomplete="off" spellcheck="false"
            placeholder="코드를 입력하거나 키보드로 직접 타이핑하세요..."
            class="flex-1 bg-[#07090d] border border-[#00ff41]/40 px-3 py-2 text-sm text-[#00ff41] rounded focus:outline-none focus:border-[#00ff41]" />
          <button id="game-cmd-submit" class="cyber-btn px-4 py-2 text-xs font-bold whitespace-nowrap cursor-pointer">ENTER</button>
        </div>
      </div>
    `;

    const exitBtn = this.root.querySelector('#game-exit-btn') as HTMLButtonElement;
    exitBtn.addEventListener('click', () => {
      audio.keyClick();
      this.stop();
      this.callbacks.onExitToSelect();
    });

    const arenaWrap = this.root.querySelector('#game-arena-wrap') as HTMLElement;
    const canvas = this.root.querySelector('#game-canvas') as HTMLCanvasElement;
    const domLayer = this.root.querySelector('#game-dom') as HTMLElement;
    const hpBar = this.root.querySelector('#hud-hp-bar') as HTMLElement;
    const hpText = this.root.querySelector('#hud-hp-text') as HTMLElement;
    const progText = this.root.querySelector('#hud-progress') as HTMLElement;
    const inputDock = this.root.querySelector('#game-input-dock') as HTMLElement;
    const cmdInput = this.root.querySelector('#game-cmd-input') as HTMLInputElement;
    const cmdSubmit = this.root.querySelector('#game-cmd-submit') as HTMLButtonElement;

    const ctx = canvas.getContext('2d')!;
    let viewW = arenaWrap.clientWidth || window.innerWidth;
    let viewH = arenaWrap.clientHeight || window.innerHeight - 140;

    // High-DPI Retina Canvas Scaling (capped at 1.5 for 60fps fill-rate stability)
    const resizeCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      viewW = arenaWrap.clientWidth || window.innerWidth;
      viewH = arenaWrap.clientHeight || window.innerHeight - 140;
      canvas.width = Math.floor(viewW * dpr);
      canvas.height = Math.floor(viewH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    this.cleanupFns.push(() => window.removeEventListener('resize', resizeCanvas));

    let hp = 100;
    let finished = false;
    let winDispatched = false;

    const setProgress = (pct: number, label?: string) => {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      progText.textContent = label || `${clamped}%`;
    };

    const damage = (amount: number) => {
      if (finished) return;
      hp = Math.max(0, hp - amount);
      hpBar.style.width = `${hp}%`;
      hpText.textContent = String(hp);
      if (hp <= 30) hpBar.style.backgroundColor = '#ff007f';
      audio.errorBuzz();
      if (hp <= 0) {
        finished = true;
        this.stageFinished = true;
        this.showFailOverlay(domLayer, () => this.startStage(stageId));
      }
    };

    const winStage = (skipBanner = false, force = false) => {
      if (winDispatched) return;
      if (finished && !force) return;
      winDispatched = true;
      finished = true;
      this.stageFinished = true;
      setProgress(100, '100%');
      audio.stageClear();
      this.callbacks.onRecordClear?.(stageId);
      if (skipBanner) {
        this.stop();
        this.callbacks.onStageClear(stageId);
        return;
      }
      this.showClearOverlay(domLayer, stage.id, () => {
        this.stop();
        this.callbacks.onStageClear(stageId);
      });
    };

    this.activeInputDock = inputDock;
    this.activeCmdInput = cmdInput;

    const enableTypingDock = (
      onBufferChange: (val: string) => void,
      onEnter?: (val: string) => void,
      placeholder?: string
    ) => {
      inputDock.classList.remove('hidden');
      if (placeholder) cmdInput.placeholder = placeholder;
      cmdInput.value = '';
      if (!this.paused) cmdInput.focus();

      const handleInput = () => {
        if (this.paused) return;
        audio.keyClick();
        onBufferChange(cmdInput.value);
      };
      const handleEnter = () => {
        if (this.paused) return;
        if (onEnter) onEnter(cmdInput.value);
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (this.paused) {
          e.preventDefault();
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          handleEnter();
        }
      };

      cmdInput.addEventListener('input', handleInput);
      cmdInput.addEventListener('keydown', handleKeyDown);
      cmdSubmit.addEventListener('click', handleEnter);
      this.cleanupFns.push(() => {
        cmdInput.removeEventListener('input', handleInput);
        cmdInput.removeEventListener('keydown', handleKeyDown);
        cmdSubmit.removeEventListener('click', handleEnter);
      });

      this.onKey((e) => {
        if (document.activeElement !== cmdInput && (e.key.length === 1 || e.key === 'Backspace')) {
          cmdInput.focus();
        }
      });
    };

    const runtime: StageRuntime = {
      stageId,
      arenaWrap,
      canvas,
      ctx,
      domLayer,
      inputDock,
      cmdInput,
      cmdSubmit,
      crackPng: this.crackPng,
      getSize: () => ({ w: viewW, h: viewH }),
      isDestroyed: () => this.destroyed,
      isFinished: () => finished,
      setFinished: (val: boolean) => {
        finished = val;
        if (val) this.stageFinished = true;
      },
      setProgress,
      damage,
      winStage,
      enableTypingDock,
      onKey: (handler, type) => this.onKey(handler, type),
      addTimeout: (fn, ms) => this.addTimeout(fn, ms),
      addCleanup: (fn) => this.cleanupFns.push(fn),
      setRaf: (fn) => {
        this.scheduleRaf(fn);
      },
      spawnBurst: (cx, cy, count, colorA, colorB) =>
        this.particlePool.spawnBurst(cx, cy, count, colorA, colorB),
      updateAndDrawParticles: (dt) => this.particlePool.updateAndDraw(ctx, dt),
    };

    // Route ALL 30 stages exclusively to real playable engines (zero bypass/temp clear)
    if (TYPING_STAGES.has(stageId)) {
      runTypingEngine(runtime);
    } else if (CLICK_AIM_STAGES.has(stageId)) {
      runClickAimEngine(runtime);
    } else if (RHYTHM_CONTROL_STAGES.has(stageId)) {
      runRhythmControlEngine(runtime);
    } else if (RAPID_MASH_STAGES.has(stageId)) {
      runRapidMashEngine(runtime);
    } else if (CODE_BOSS_STAGES.has(stageId)) {
      runCodeBossEngine(runtime);
    } else {
      runTypingEngine(runtime);
    }
  }

  private showClearOverlay(container: HTMLElement, stageId: number, onNext: () => void): void {
    const ov = document.createElement('div');
    ov.className = 'absolute inset-0 z-50 bg-black/80 flex items-center justify-center';
    ov.innerHTML = `
      <div class="border-2 border-[#00ff41] bg-[#0d1218] rounded-lg px-10 py-8 text-center max-w-md shadow-[0_0_40px_rgba(0,255,65,0.3)]">
        <div class="text-xs text-[#00ff41] tracking-widest mb-2">SECURITY LAYER BREACHED</div>
        <div class="text-3xl font-black text-white mb-6">STAGE ${stageId} CLEAR</div>
        <button id="ov-next-btn" class="cyber-btn px-8 py-3 text-sm font-bold cursor-pointer">
          ${stageId === 30 ? '방으로 복귀하기' : '다음 단계로'}
        </button>
      </div>
    `;
    container.appendChild(ov);
    ov.querySelector('#ov-next-btn')!.addEventListener('click', onNext);
  }

  private showFailOverlay(container: HTMLElement, onRetry: () => void): void {
    const ov = document.createElement('div');
    ov.className = 'absolute inset-0 z-50 bg-black/85 flex items-center justify-center';
    ov.innerHTML = `
      <div class="border-2 border-[#ff007f] bg-[#160b12] rounded-lg px-10 py-8 text-center max-w-md shadow-[0_0_40px_rgba(255,0,127,0.35)]">
        <div class="text-xs text-[#ff007f] tracking-widest mb-2">SYSTEM INTEGRITY CRITICAL</div>
        <div class="text-3xl font-black text-white mb-6">방어 실패</div>
        <button id="ov-retry-btn" class="cyber-btn cyber-btn-pink px-8 py-3 text-sm font-bold cursor-pointer">
          다시 도전하기
        </button>
      </div>
    `;
    container.appendChild(ov);
    ov.querySelector('#ov-retry-btn')!.addEventListener('click', onRetry);
  }
}
