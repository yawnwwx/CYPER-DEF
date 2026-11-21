import { audio } from '../audio';
import { PYTHON_WORDS } from '../data/stages';
import { StageRuntime } from './types';

export function runRapidMashEngine(rt: StageRuntime): void {
  const { stageId, domLayer } = rt;

  if (stageId === 4) {
    // STAGE 4: 화면에 쏟아지는 악성 팝업창 15개의 X 버튼을 빠르게 클릭해 제거
    interface FallingPopup {
      el: HTMLElement;
      x: number;
      y: number;
      vx: number;
      vy: number;
      rot: number;
      vRot: number;
    }
    const fallingPopups: FallingPopup[] = [];
    let closed = 0;
    const goal = 15;
    let spawnTimer = 0;
    domLayer.style.perspective = '950px';
    rt.addCleanup(() => {
      domLayer.style.perspective = '';
    });

    const pickWord = () => PYTHON_WORDS[Math.floor(Math.random() * PYTHON_WORDS.length)];

    const spawnPopup = () => {
      if (rt.isFinished() || domLayer.querySelectorAll('.ddos-popup-3d:not(.dropping)').length >= 6) return;
      const { w, h } = rt.getSize();
      const pop = document.createElement('div');
      const px = 32 + Math.random() * Math.max(120, w - 310);
      const py = 28 + Math.random() * Math.max(100, h - 190);
      const scale = 0.88 + Math.random() * 0.24;
      const rx = (Math.random() - 0.5) * 16;
      const ry = (Math.random() - 0.5) * 20;

      pop.className = 'ddos-popup-3d absolute w-64 border border-[#ff007f] bg-[#14101a] rounded overflow-hidden shadow-[0_12px_28px_rgba(255,0,127,0.28)]';
      pop.style.left = `${px}px`;
      pop.style.top = `${py}px`;
      pop.style.transform = `scale3d(${scale}, ${scale}, 1) rotateX(${rx}deg) rotateY(${ry}deg)`;
      pop.innerHTML = `
        <div class="flex items-center justify-between px-3 py-1.5 bg-[#ff007f] text-white text-xs font-bold">
          <span class="font-code">DDoS // ${pickWord()}</span>
          <button class="pop-close px-2.5 py-0.5 bg-black/45 hover:bg-black text-white rounded cursor-pointer font-black">X</button>
        </div>
        <div class="p-3 text-xs text-pink-200 font-code">FLOODING PORT 443...</div>
      `;
      pop.querySelector('.pop-close')!.addEventListener('click', () => {
        if (pop.classList.contains('dropping') || rt.isFinished()) return;
        pop.classList.add('dropping');
        pop.style.pointerEvents = 'none';
        fallingPopups.push({
          el: pop,
          x: 0,
          y: 0,
          vx: (Math.random() - 0.5) * 190,
          vy: -120,
          rot: 0,
          vRot: (Math.random() - 0.5) * 240,
        });
        audio.explosion();
        closed++;
        rt.setProgress((closed / goal) * 100, `${closed} / ${goal}`);
        if (closed >= goal) {
          rt.addTimeout(() => rt.winStage(), 420);
        } else {
          spawnPopup();
        }
      });
      domLayer.appendChild(pop);
    };

    spawnPopup();
    spawnPopup();
    spawnPopup();

    let last = 0;
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      if (last === 0) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      spawnTimer += dt;
      if (spawnTimer >= 0.72) {
        spawnTimer = 0;
        spawnPopup();
      }

      const { h } = rt.getSize();
      const gravity = 1320;
      for (let i = fallingPopups.length - 1; i >= 0; i--) {
        const f = fallingPopups[i];
        f.vy += gravity * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.rot += f.vRot * dt;
        f.el.style.transform = `translate3d(${f.x}px, ${f.y}px, 0) rotate(${f.rot}deg) scale3d(0.9, 0.9, 1)`;
        if (f.y > h + 220) {
          f.el.remove();
          fallingPopups.splice(i, 1);
        }
      }
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, `0 / ${goal}`);
    return;
  }

  if (stageId === 14) {
    // STAGE 14: 좌/우 화살표 키를 번갈아 연타해 해킹 진행도 100% 채우기
    let progress = 0;
    let nextSide: 'left' | 'right' = 'left';
    let timeLeft = 18.0;

    domLayer.innerHTML = `
      <div id="s14-wrap" class="w-full h-full flex flex-col items-center justify-center gap-6 px-6 select-none">
        <div class="text-xs font-code tracking-widest text-[#00e5ff]">BRUTE-FORCE ALTERNATION PROTOCOL</div>
        <div class="text-4xl font-black font-code text-[#00ff41] tabular-nums" id="s14-pct">0%</div>

        <div class="w-full max-w-xl h-7 rounded bg-[#111827] border-2 border-[#00ff41]/50 overflow-hidden p-1">
          <div id="s14-bar" class="h-full w-full origin-left bg-gradient-to-r from-[#00ff41] via-[#00e5ff] to-[#38bdf8] rounded-sm will-change-transform" style="transform:scaleX(0)"></div>
        </div>

        <div class="flex items-center gap-8 mt-2">
          <button id="s14-left" class="w-28 h-24 rounded-xl border-2 border-[#00ff41] bg-[#0a2315] text-[#00ff41] text-4xl font-black flex flex-col items-center justify-center shadow-[0_0_25px_rgba(0,255,65,0.4)] cursor-pointer transition-transform">
            <span>←</span>
            <span class="text-[10px] font-code mt-1">LEFT</span>
          </button>
          <div class="text-xs font-code text-slate-400 text-center">
            번갈아 연타!<br/>
            남은 시간: <span id="s14-timer" class="text-amber-300 font-bold tabular-nums">18.0s</span>
          </div>
          <button id="s14-right" class="w-28 h-24 rounded-xl border-2 border-white/20 bg-[#12161f] text-slate-400 text-4xl font-black flex flex-col items-center justify-center cursor-pointer transition-transform">
            <span>→</span>
            <span class="text-[10px] font-code mt-1">RIGHT</span>
          </button>
        </div>
      </div>
    `;

    const wrap = domLayer.querySelector('#s14-wrap') as HTMLElement;
    const pctEl = domLayer.querySelector('#s14-pct') as HTMLElement;
    const barEl = domLayer.querySelector('#s14-bar') as HTMLElement;
    const timerEl = domLayer.querySelector('#s14-timer') as HTMLElement;
    const leftBtn = domLayer.querySelector('#s14-left') as HTMLButtonElement;
    const rightBtn = domLayer.querySelector('#s14-right') as HTMLButtonElement;

    const highlightNext = () => {
      if (nextSide === 'left') {
        leftBtn.className = 'w-28 h-24 rounded-xl border-2 border-[#00ff41] bg-[#0a2315] text-[#00ff41] text-4xl font-black flex flex-col items-center justify-center shadow-[0_0_25px_rgba(0,255,65,0.45)] scale-105 cursor-pointer transition-transform';
        rightBtn.className = 'w-28 h-24 rounded-xl border-2 border-white/15 bg-[#12161f] text-slate-500 text-4xl font-black flex flex-col items-center justify-center cursor-pointer transition-transform';
      } else {
        rightBtn.className = 'w-28 h-24 rounded-xl border-2 border-[#00e5ff] bg-[#071f2b] text-[#00e5ff] text-4xl font-black flex flex-col items-center justify-center shadow-[0_0_25px_rgba(0,229,255,0.45)] scale-105 cursor-pointer transition-transform';
        leftBtn.className = 'w-28 h-24 rounded-xl border-2 border-white/15 bg-[#12161f] text-slate-500 text-4xl font-black flex flex-col items-center justify-center cursor-pointer transition-transform';
      }
    };

    const hitSide = (side: 'left' | 'right') => {
      if (rt.isFinished()) return;
      if (side === nextSide) {
        progress = Math.min(100, progress + 4.4);
        nextSide = side === 'left' ? 'right' : 'left';
        audio.hitSuccess();
        const sx = (Math.random() - 0.5) * 10;
        const sy = (Math.random() - 0.5) * 8;
        wrap.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
        rt.addTimeout(() => {
          wrap.style.transform = '';
        }, 55);
        highlightNext();
        if (progress >= 100) {
          pctEl.textContent = '100%';
          barEl.style.transform = 'scaleX(1)';
          rt.setProgress(100, '100%');
          rt.winStage();
        }
      } else {
        progress = Math.max(0, progress - 2.5);
        audio.errorBuzz();
      }
    };

    leftBtn.addEventListener('click', () => hitSide('left'));
    rightBtn.addEventListener('click', () => hitSide('right'));

    rt.onKey((e) => {
      if (e.repeat) return;
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
        e.preventDefault();
        hitSide('left');
      } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
        e.preventDefault();
        hitSide('right');
      }
    });

    const totalDuration = 18.0;
    let startTime = 0;
    let last = 0;
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      if (startTime === 0) {
        startTime = now;
        last = now;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      // Gentle decay to enforce continuous rapid alternation; timer runs on exact wall-clock elapsed time
      progress = Math.max(0, progress - 5.2 * dt);
      timeLeft = Math.max(0, totalDuration - (now - startTime) / 1000);

      const rounded = Math.round(progress);
      pctEl.textContent = `${rounded}%`;
      barEl.style.transform = `scaleX(${(progress / 100).toFixed(4)})`;
      timerEl.textContent = `${timeLeft.toFixed(1)}s`;
      rt.setProgress(rounded, `${rounded}%`);

      if (timeLeft <= 0) {
        rt.damage(100);
        return;
      }

      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, '0%');
    return;
  }

  // STAGE 22: 양쪽에서 좁혀오는 벽을 스페이스바 연타로 밀어내며 10초 버티기
  let wallPos = 14; // percentage width of each side wall (crushes core at >= 42%)
  let surviveLeft = 10.0;

  domLayer.innerHTML = `
    <div class="relative w-full h-full overflow-hidden flex items-center justify-center bg-[#090c12] select-none">
      <div id="s22-wall-l" class="absolute top-0 bottom-0 left-0 w-1/2 bg-gradient-to-r from-[#5a071f] via-[#b80d48] to-[#ff0055] border-r-4 border-pink-300 shadow-[0_0_35px_rgba(255,0,85,0.65)] flex items-center justify-end pr-4 will-change-transform" style="transform:translate3d(-72%,0,0)">
        <span class="text-xs font-black font-code text-white tracking-widest [writing-mode:vertical-rl]">PRESS WALL</span>
      </div>
      <div id="s22-wall-r" class="absolute top-0 bottom-0 right-0 w-1/2 bg-gradient-to-l from-[#5a071f] via-[#b80d48] to-[#ff0055] border-l-4 border-pink-300 shadow-[0_0_35px_rgba(255,0,85,0.65)] flex items-center justify-start pl-4 will-change-transform" style="transform:translate3d(72%,0,0)">
        <span class="text-xs font-black font-code text-white tracking-widest [writing-mode:vertical-rl]">PRESS WALL</span>
      </div>

      <div class="relative z-10 flex flex-col items-center gap-4 text-center px-6">
        <div class="text-xs font-code tracking-widest text-[#00e5ff]">MEMORY CRUSH DEFENSE</div>
        <div id="s22-timer" class="text-5xl font-black font-code text-[#00ff41] tabular-nums drop-shadow-[0_0_16px_rgba(0,255,65,0.5)]">10.0s</div>
        <div class="w-28 h-28 rounded-full border-4 border-[#00ff41] bg-[#091c12] flex flex-col items-center justify-center shadow-[0_0_30px_rgba(0,255,65,0.3)]">
          <span class="text-xs font-code text-emerald-300">CORE</span>
          <span id="s22-gap" class="text-lg font-black font-code text-white">SAFE</span>
        </div>
        <button id="s22-push-btn" class="cyber-btn px-7 py-3 text-sm font-black tracking-wider cursor-pointer">
          [ SPACE ] 연타로 벽 밀어내기!
        </button>
      </div>
    </div>
  `;

  const wallL = domLayer.querySelector('#s22-wall-l') as HTMLElement;
  const wallR = domLayer.querySelector('#s22-wall-r') as HTMLElement;
  const timerEl = domLayer.querySelector('#s22-timer') as HTMLElement;
  const gapEl = domLayer.querySelector('#s22-gap') as HTMLElement;
  const pushBtn = domLayer.querySelector('#s22-push-btn') as HTMLButtonElement;

  const pushWalls = () => {
    if (rt.isFinished()) return;
    wallPos = Math.max(6, wallPos - 5.6);
    audio.keyClick();
    const { w, h } = rt.getSize();
    rt.spawnBurst(w * (wallPos / 100), h * 0.5, 6, '#00ff41', '#00e5ff');
    rt.spawnBurst(w * (1 - wallPos / 100), h * 0.5, 6, '#00ff41', '#00e5ff');
  };

  pushBtn.addEventListener('click', pushWalls);
  rt.onKey((e) => {
    if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      pushWalls();
    }
  });

  const totalDuration = 10.0;
  let startTime = 0;
  let last = 0;
  const loop = (now: number) => {
    if (rt.isDestroyed() || rt.isFinished()) return;
    if (startTime === 0) {
      startTime = now;
      last = now;
    }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    // Exact wall-clock survival countdown independent of FPS drops (pause-compensated via now)
    const elapsedSec = Math.max(0, (now - startTime) / 1000);
    surviveLeft = Math.max(0, totalDuration - elapsedSec);

    // Walls steadily close inward, accelerating slightly near the end
    const closeSpeed = 14.2 + (totalDuration - surviveLeft) * 0.45;
    wallPos += closeSpeed * dt;

    // GPU-composited wall slide (50%-wide panels translated cleanly without layout reflow)
    const offsetPct = Math.max(0, 100 - wallPos * 2);
    wallL.style.transform = `translate3d(-${offsetPct.toFixed(2)}%, 0, 0)`;
    wallR.style.transform = `translate3d(${offsetPct.toFixed(2)}%, 0, 0)`;
    timerEl.textContent = `${surviveLeft.toFixed(1)}s`;

    if (wallPos >= 34) {
      gapEl.textContent = 'DANGER!';
      gapEl.className = 'text-lg font-black font-code text-[#ff007f]';
    } else {
      gapEl.textContent = 'SAFE';
      gapEl.className = 'text-lg font-black font-code text-[#00ff41]';
    }

    const pct = ((10 - surviveLeft) / 10) * 100;
    rt.setProgress(pct, `${(10 - surviveLeft).toFixed(1)}s / 10.0s`);

    if (wallPos >= 42.5) {
      rt.damage(25);
      wallPos = 22;
    }

    if (surviveLeft <= 0) {
      rt.winStage();
      return;
    }

    const { w, h } = rt.getSize();
    rt.ctx.clearRect(0, 0, w, h);
    rt.updateAndDrawParticles(dt);
    rt.setRaf(loop);
  };

  rt.setRaf(loop);
  rt.setProgress(0, '0.0s / 10.0s');
}
