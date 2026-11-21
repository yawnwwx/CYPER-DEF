import { audio } from '../audio';
import { StageRuntime } from './types';

export function runRhythmControlEngine(rt: StageRuntime): void {
  const { stageId, domLayer } = rt;

  if (stageId === 3) {
    // STAGE 3: 중앙 원형 게이지로 다가오는 노드에 맞춰 방향키 입력
    const dirs = [
      { code: 'ArrowLeft', label: '←' },
      { code: 'ArrowUp', label: '↑' },
      { code: 'ArrowDown', label: '↓' },
      { code: 'ArrowRight', label: '→' },
    ];
    let hits = 0;
    const goal = 8;
    let currentTarget = dirs[Math.floor(Math.random() * 4)];
    let ringScale = 2.15; // shrinks toward 1.0 (target ring)

    domLayer.innerHTML = `
      <div class="relative w-full h-full flex flex-col items-center justify-center gap-6 overflow-hidden select-none">
        <div id="ripple-zone" class="relative w-44 h-44 rounded-full border-2 border-[#00ff41] flex items-center justify-center bg-[#00ff41]/5">
          <div id="s3-approach-ring" class="pointer-events-none absolute inset-0 rounded-full border-2 border-[#00e5ff] opacity-85" style="transform:scale(2.15)"></div>
          <div id="sync-note" class="text-5xl font-black text-[#00ff41]">${currentTarget.label}</div>
        </div>
        <div id="s3-judge" class="text-xs font-code text-slate-300 h-5">파란 링이 초록 원에 다가올 때 표시된 방향키(←↑↓→)를 누르세요!</div>
        <div class="flex items-center gap-3">
          ${dirs.map((d) => `<button data-dir="${d.code}" class="rhythm-btn cyber-btn px-5 py-3 text-lg font-bold cursor-pointer">${d.label}</button>`).join('')}
        </div>
        <div class="absolute bottom-0 left-0 right-0 h-24 flex items-end justify-center gap-1.5 px-8 opacity-80 pointer-events-none">
          ${Array.from({ length: 24 }, () => `<div class="viz-bar w-3 bg-[#00ff41] rounded-t" style="height:20%"></div>`).join('')}
        </div>
      </div>
    `;

    const rippleZone = domLayer.querySelector('#ripple-zone') as HTMLElement;
    const approachRing = domLayer.querySelector('#s3-approach-ring') as HTMLElement;
    const syncNote = domLayer.querySelector('#sync-note') as HTMLElement;
    const judgeEl = domLayer.querySelector('#s3-judge') as HTMLElement;
    const vizBars = Array.from(domLayer.querySelectorAll('.viz-bar')) as HTMLElement[];

    const nextBeat = () => {
      currentTarget = dirs[Math.floor(Math.random() * 4)];
      syncNote.textContent = currentTarget.label;
      ringScale = 2.15;
    };

    const triggerDir = (code: string) => {
      if (rt.isFinished()) return;
      if (code === currentTarget.code && ringScale <= 1.55 && ringScale >= 0.72) {
        audio.hitSuccess();
        hits++;
        const isPerfect = Math.abs(ringScale - 1.0) <= 0.2;
        judgeEl.textContent = isPerfect ? 'PERFECT SYNC!' : 'GOOD SYNC!';
        judgeEl.className = isPerfect
          ? 'text-xs font-code font-bold text-[#00ff41] h-5'
          : 'text-xs font-code font-bold text-[#00e5ff] h-5';
        const rip = document.createElement('div');
        rip.className = 'rhythm-ripple';
        rippleZone.appendChild(rip);
        rt.addTimeout(() => rip.remove(), 700);
        rt.setProgress((hits / goal) * 100, `${hits} / ${goal}`);
        if (hits >= goal) {
          rt.winStage();
        } else {
          nextBeat();
        }
      } else {
        judgeEl.textContent = code !== currentTarget.code ? 'WRONG KEY!' : 'WAIT FOR RING!';
        judgeEl.className = 'text-xs font-code font-bold text-[#ff007f] h-5';
        rt.damage(10);
      }
    };

    domLayer.querySelectorAll('.rhythm-btn').forEach((btn) => {
      btn.addEventListener('click', () => triggerDir((btn as HTMLElement).dataset.dir || ''));
    });
    rt.onKey((e) => {
      if (['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
        triggerDir(e.code);
      }
    });

    let last = performance.now();
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      ringScale -= 0.72 * dt;
      if (ringScale < 0.7) {
        // Missed the beat window, reset cleanly
        rt.damage(8);
        judgeEl.textContent = 'MISSED BEAT!';
        judgeEl.className = 'text-xs font-code font-bold text-[#ff007f] h-5';
        nextBeat();
      }
      approachRing.style.transform = `scale(${ringScale.toFixed(3)})`;
      approachRing.style.borderColor = ringScale <= 1.32 ? '#00ff41' : '#00e5ff';

      const t = now * 0.007;
      for (let i = 0; i < vizBars.length; i++) {
        const h = 14 + Math.abs(Math.sin(t + i * 0.45)) * 78;
        vizBars[i].style.height = `${h.toFixed(1)}%`;
      }
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, `0 / ${goal}`);
    return;
  }

  if (stageId === 13 || stageId === 23) {
    // STAGE 13: F / J 2레인 리듬 노트  |  STAGE 23: D / F / J / K 4레인 건반형 리듬 노트
    const lanes =
      stageId === 13
        ? [
            { code: 'KeyF', label: 'F', color: '#00ff41' },
            { code: 'KeyJ', label: 'J', color: '#00e5ff' },
          ]
        : [
            { code: 'KeyD', label: 'D', color: '#00ff41' },
            { code: 'KeyF', label: 'F', color: '#00e5ff' },
            { code: 'KeyJ', label: 'J', color: '#fbbf24' },
            { code: 'KeyK', label: 'K', color: '#ff4da6' },
          ];

    const goal = stageId === 13 ? 14 : 18;
    const noteSpeed = stageId === 13 ? 295 : 315;
    const spawnInterval = stageId === 13 ? 0.62 : 0.52;
    let hits = 0;
    let combo = 0;
    let spawnTimer = 0.2;

    interface RhythmNote {
      lane: number;
      y: number;
      hit: boolean;
    }
    const notes: RhythmNote[] = [];

    domLayer.innerHTML = `
      <div class="pointer-events-none w-full h-full flex flex-col items-center justify-between py-4 px-4 select-none">
        <div class="flex items-center gap-6 px-5 py-1.5 rounded-lg bg-black/70 border border-white/10 font-code text-xs">
          <span class="text-slate-300">COMBO <strong id="rhy-combo" class="text-[#00ff41] text-base ml-1">0</strong></span>
          <span id="rhy-judge" class="text-[#00e5ff] font-bold tracking-wider min-w-[96px] text-center">READY</span>
        </div>

        <div class="pointer-events-auto flex items-center gap-3 mb-2">
          ${lanes
            .map(
              (ln, i) => `
            <button data-lane="${i}" class="rhy-pad w-20 sm:w-24 py-3 rounded-lg border-2 font-code text-xl font-black bg-[#0d1420]/90 cursor-pointer transition-transform active:scale-95"
              style="border-color:${ln.color}; color:${ln.color}; box-shadow:0 0 18px ${ln.color}33">
              ${ln.label}
            </button>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    const comboEl = domLayer.querySelector('#rhy-combo') as HTMLElement;
    const judgeEl = domLayer.querySelector('#rhy-judge') as HTMLElement;
    const padEls = Array.from(domLayer.querySelectorAll('.rhy-pad')) as HTMLButtonElement[];
    const laneFlash = lanes.map(() => 0);

    const getHighwayGeom = () => {
      const { w, h } = rt.getSize();
      const laneW = Math.min(110, Math.floor((w - 80) / lanes.length));
      const totalW = laneW * lanes.length;
      const startX = (w - totalW) / 2;
      const hitY = h - 98;
      return { w, h, laneW, totalW, startX, hitY };
    };

    const triggerLane = (laneIdx: number) => {
      if (rt.isFinished()) return;
      laneFlash[laneIdx] = 1;
      const { startX, laneW, hitY } = getHighwayGeom();

      // Find closest unhit note in this lane
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        if (n.lane === laneIdx && !n.hit) {
          const d = Math.abs(n.y - hitY);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
      }

      if (bestIdx !== -1 && bestDist <= 68) {
        notes.splice(bestIdx, 1);
        hits++;
        combo++;
        comboEl.textContent = String(combo);
        const isPerfect = bestDist <= 30;
        judgeEl.textContent = isPerfect ? 'PERFECT!' : 'GOOD';
        judgeEl.style.color = isPerfect ? '#00ff41' : '#00e5ff';
        audio.hitSuccess();
        rt.spawnBurst(startX + laneIdx * laneW + laneW / 2, hitY, 18, lanes[laneIdx].color, '#ffffff');
        rt.setProgress((hits / goal) * 100, `${hits} / ${goal}`);
        if (hits >= goal) {
          rt.winStage();
        }
      } else {
        combo = 0;
        comboEl.textContent = '0';
        judgeEl.textContent = 'MISS';
        judgeEl.style.color = '#ff007f';
        rt.damage(7);
      }
    };

    padEls.forEach((pad) => {
      pad.addEventListener('mousedown', () => triggerLane(Number(pad.dataset.lane)));
    });

    rt.onKey((e) => {
      if (e.repeat) return;
      const idx = lanes.findIndex((l) => l.code === e.code);
      if (idx !== -1) {
        e.preventDefault();
        triggerLane(idx);
      }
    });

    let last = performance.now();
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      spawnTimer += dt;
      if (spawnTimer >= spawnInterval) {
        spawnTimer = 0;
        notes.push({
          lane: Math.floor(Math.random() * lanes.length),
          y: -18,
          hit: false,
        });
      }

      const { w, h, laneW, totalW, startX, hitY } = getHighwayGeom();
      const ctx = rt.ctx;
      ctx.fillStyle = '#060911';
      ctx.fillRect(0, 0, w, h);

      // Draw Highway background & lanes
      for (let i = 0; i < lanes.length; i++) {
        const lx = startX + i * laneW;
        laneFlash[i] = Math.max(0, laneFlash[i] - dt * 5);
        ctx.fillStyle = `rgba(255,255,255,${(0.03 + laneFlash[i] * 0.16).toFixed(3)})`;
        ctx.fillRect(lx, 0, laneW, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.strokeRect(lx, 0, laneW, h);

        // Key receptor circle
        ctx.strokeStyle = lanes[i].color;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(lx + 10, hitY - 14, laneW - 20, 28);
      }

      // Hit line glow
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX - 10, hitY);
      ctx.lineTo(startX + totalW + 10, hitY);
      ctx.stroke();

      // Update & draw notes
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        n.y += noteSpeed * dt;
        const lx = startX + n.lane * laneW;
        const col = lanes[n.lane].color;

        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = 12;
        ctx.fillRect(lx + 12, n.y - 11, laneW - 24, 22);
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#05080f';
        ctx.font = 'bold 13px "Fira Code", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(lanes[n.lane].label, lx + laneW / 2, n.y);

        if (n.y > hitY + 76) {
          notes.splice(i, 1);
          combo = 0;
          comboEl.textContent = '0';
          judgeEl.textContent = 'MISS';
          judgeEl.style.color = '#ff007f';
          rt.damage(8);
        }
      }

      rt.updateAndDrawParticles(dt);
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, `0 / ${goal}`);
    return;
  }

  if (stageId === 17) {
    // STAGE 17: 방향키로 초록색 커서를 움직여 붉은색 백신 장애물을 피해 탈출구로 이동
    const { w: initW, h: initH } = rt.getSize();
    const player = { x: 54, y: initH / 2, r: 13 };
    const trail: Array<{ x: number; y: number }> = [];
    const keys = new Set<string>();
    let invuln = 0;

    interface AntivirusObstacle {
      x: number;
      y: number;
      w: number;
      h: number;
      vx: number;
      vy: number;
    }

    const buildObstacles = (w: number, h: number): AntivirusObstacle[] => {
      const cols = 5;
      const list: AntivirusObstacle[] = [];
      for (let i = 0; i < cols; i++) {
        const ox = 140 + ((w - 280) / (cols - 1)) * i;
        const bh = 68 + (i % 2) * 26;
        const oy = 40 + ((i * 97) % Math.max(80, h - bh - 80));
        list.push({
          x: ox - 16,
          y: oy,
          w: 32,
          h: bh,
          vx: i % 3 === 1 ? 65 : 0,
          vy: (i % 2 === 0 ? 1 : -1) * (135 + i * 24),
        });
      }
      return list;
    };

    const obstacles = buildObstacles(initW, initH);

    domLayer.innerHTML = `
      <div class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded bg-black/70 border border-[#00ff41]/35 text-xs font-code text-[#00ff41]">
        방향키(←↑↓→) 또는 WASD로 초록 커서를 움직여 우측 [EXIT] 탈출구에 도달하세요!
      </div>
    `;

    rt.onKey((e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        e.preventDefault();
        keys.add(e.code);
      }
    }, 'keydown');
    rt.onKey((e) => {
      keys.delete(e.code);
    }, 'keyup');

    let last = performance.now();
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const { w, h } = rt.getSize();
      const ctx = rt.ctx;
      const speed = 265;

      let dx = 0;
      let dy = 0;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) dx -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) dx += 1;
      if (keys.has('ArrowUp') || keys.has('KeyW')) dy -= 1;
      if (keys.has('ArrowDown') || keys.has('KeyS')) dy += 1;
      if (dx !== 0 && dy !== 0) {
        dx *= 0.7071;
        dy *= 0.7071;
      }

      player.x = Math.max(player.r + 8, Math.min(w - player.r - 8, player.x + dx * speed * dt));
      player.y = Math.max(player.r + 36, Math.min(h - player.r - 8, player.y + dy * speed * dt));
      invuln = Math.max(0, invuln - dt);

      trail.push({ x: player.x, y: player.y });
      if (trail.length > 18) trail.shift();

      const exitZone = { x: w - 76, y: h / 2 - 58, w: 58, h: 116 };

      // Background
      ctx.fillStyle = '#060910';
      ctx.fillRect(0, 0, w, h);

      // Subtle grid
      ctx.strokeStyle = 'rgba(0, 255, 65, 0.06)';
      ctx.lineWidth = 1;
      for (let gx = 0; gx < w; gx += 48) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = 0; gy < h; gy += 48) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Start & Exit Pads
      ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.fillRect(16, h / 2 - 54, 62, 108);
      ctx.strokeRect(16, h / 2 - 54, 62, 108);
      ctx.fillStyle = '#00e5ff';
      ctx.font = 'bold 11px "Fira Code", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('START', 47, h / 2 + 4);

      ctx.fillStyle = 'rgba(0, 255, 65, 0.18)';
      ctx.strokeStyle = '#00ff41';
      ctx.lineWidth = 2.5;
      ctx.fillRect(exitZone.x, exitZone.y, exitZone.w, exitZone.h);
      ctx.strokeRect(exitZone.x, exitZone.y, exitZone.w, exitZone.h);
      ctx.fillStyle = '#00ff41';
      ctx.font = 'bold 13px "Fira Code", monospace';
      ctx.fillText('EXIT', exitZone.x + exitZone.w / 2, exitZone.y + exitZone.h / 2 + 4);

      // Update & draw red antivirus obstacles
      for (const ob of obstacles) {
        ob.x += ob.vx * dt;
        ob.y += ob.vy * dt;
        if (ob.y < 36) {
          ob.y = 36;
          ob.vy = Math.abs(ob.vy);
        } else if (ob.y + ob.h > h - 12) {
          ob.y = h - 12 - ob.h;
          ob.vy = -Math.abs(ob.vy);
        }
        if (ob.x < 105) {
          ob.x = 105;
          ob.vx = Math.abs(ob.vx);
        } else if (ob.x + ob.w > w - 105) {
          ob.x = w - 105 - ob.w;
          ob.vx = -Math.abs(ob.vx);
        }

        ctx.fillStyle = 'rgba(255, 16, 72, 0.85)';
        ctx.strokeStyle = '#ff6b8b';
        ctx.lineWidth = 2;
        ctx.fillRect(ob.x, ob.y, ob.w, ob.h);
        ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px "Fira Code", monospace';
        ctx.fillText('AV', ob.x + ob.w / 2, ob.y + ob.h / 2 + 3);

        // Circle vs Rect collision
        if (invuln <= 0) {
          const cx = Math.max(ob.x, Math.min(player.x, ob.x + ob.w));
          const cy = Math.max(ob.y, Math.min(player.y, ob.y + ob.h));
          if (Math.hypot(player.x - cx, player.y - cy) < player.r) {
            rt.spawnBurst(player.x, player.y, 26, '#ff0044', '#ffaa00');
            rt.damage(20);
            player.x = 54;
            player.y = h / 2;
            trail.length = 0;
            invuln = 0.7;
          }
        }
      }

      // Draw green player trail
      for (let i = 0; i < trail.length; i++) {
        const pt = trail[i];
        const a = (i / trail.length) * 0.45;
        ctx.fillStyle = `rgba(0, 255, 65, ${a.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, player.r * (0.35 + (i / trail.length) * 0.55), 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw player cursor
      ctx.fillStyle = invuln > 0 ? '#fbbf24' : '#00ff41';
      ctx.shadowColor = '#00ff41';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Progress by X traversal
      const pct = Math.max(0, Math.min(99, Math.round(((player.x - 54) / Math.max(1, exitZone.x - 54)) * 100)));
      rt.setProgress(pct, `${pct}%`);

      // Check EXIT reached
      if (
        player.x + player.r >= exitZone.x &&
        player.y >= exitZone.y &&
        player.y <= exitZone.y + exitZone.h
      ) {
        rt.spawnBurst(player.x, player.y, 38, '#00ff41', '#00e5ff');
        rt.winStage();
        return;
      }

      rt.updateAndDrawParticles(dt);
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, '0%');
    return;
  }

  // STAGE 27: 스페이스바를 꾹 눌러 게이지가 초록색 안전 구역에 도달한 순간 정확히 떼기 (홀드 액션)
  const goal = 4;
  let cleared = 0;
  let holding = false;
  let charge = 0;
  let safeStart = 60;
  let safeEnd = 82;
  let fillSpeed = 58;

  domLayer.innerHTML = `
    <div class="w-full h-full flex flex-col items-center justify-center gap-6 px-6 bg-[#070b12] select-none">
      <div class="text-xs font-code tracking-widest text-[#00e5ff]">CORE SYNC HOLD ACTION</div>
      <div id="s27-orb" class="w-32 h-32 rounded-full border-4 border-[#00e5ff] bg-[#0b1929] flex flex-col items-center justify-center transition-all duration-100">
        <span id="s27-pct" class="text-3xl font-black font-code text-white tabular-nums">0%</span>
        <span class="text-[10px] font-code text-slate-400">CHARGE</span>
      </div>

      <div class="w-full max-w-xl space-y-2">
        <div class="relative w-full h-11 rounded-lg bg-[#111827] border-2 border-white/20 overflow-hidden">
          <div id="s27-safe" class="absolute top-0 bottom-0 bg-[#00ff41]/30 border-x-2 border-[#00ff41]" style="left:60%;width:22%"></div>
          <div id="s27-fill" class="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-[#00e5ff] to-[#38bdf8] opacity-85" style="width:0%"></div>
          <div id="s27-needle" class="absolute top-0 bottom-0 w-1.5 bg-white shadow-[0_0_12px_#ffffff]" style="left:0%"></div>
        </div>
        <div id="s27-msg" class="text-center text-xs font-code text-slate-300">
          [ SPACE ] 키를 꾹 눌러 충전한 뒤 초록색 안전 구역에서 정확히 떼세요!
        </div>
      </div>

      <button id="s27-hold-btn" type="button" class="cyber-btn px-8 py-3.5 text-sm font-black tracking-wider cursor-pointer">
        [ SPACE ] 꾹 누르기 (HOLD &amp; RELEASE)
      </button>
    </div>
  `;

  const orbEl = domLayer.querySelector('#s27-orb') as HTMLElement;
  const pctEl = domLayer.querySelector('#s27-pct') as HTMLElement;
  const safeEl = domLayer.querySelector('#s27-safe') as HTMLElement;
  const fillEl = domLayer.querySelector('#s27-fill') as HTMLElement;
  const needleEl = domLayer.querySelector('#s27-needle') as HTMLElement;
  const msgEl = domLayer.querySelector('#s27-msg') as HTMLElement;
  const holdBtn = domLayer.querySelector('#s27-hold-btn') as HTMLButtonElement;

  const setupRound = () => {
    charge = 0;
    holding = false;
    const width = Math.max(15, 22 - cleared * 2);
    safeStart = 42 + Math.floor(Math.random() * (84 - width - 42));
    safeEnd = safeStart + width;
    fillSpeed = 54 + cleared * 12;
    safeEl.style.left = `${safeStart}%`;
    safeEl.style.width = `${width}%`;
    fillEl.style.width = '0%';
    needleEl.style.left = '0%';
    pctEl.textContent = '0%';
    orbEl.style.boxShadow = '0 0 18px rgba(0,229,255,0.25)';
    orbEl.style.borderColor = '#00e5ff';
  };
  setupRound();

  const startHold = () => {
    if (rt.isFinished() || holding) return;
    holding = true;
    msgEl.textContent = '충전 중... 초록 구역에 들어가면 즉시 떼세요!';
    msgEl.className = 'text-center text-xs font-code text-[#00e5ff]';
  };

  const releaseHold = () => {
    if (rt.isFinished() || !holding) return;
    holding = false;
    if (charge >= safeStart && charge <= safeEnd) {
      audio.hitSuccess();
      cleared++;
      orbEl.style.borderColor = '#00ff41';
      orbEl.style.boxShadow = '0 0 42px rgba(0,255,65,0.85)';
      msgEl.textContent = `SYNC LOCKED! (${cleared} / ${goal})`;
      msgEl.className = 'text-center text-xs font-code font-bold text-[#00ff41]';
      rt.setProgress((cleared / goal) * 100, `${cleared} / ${goal}`);
      if (cleared >= goal) {
        rt.addTimeout(() => rt.winStage(), 420);
      } else {
        rt.addTimeout(() => setupRound(), 520);
      }
    } else {
      rt.damage(15);
      msgEl.textContent = charge < safeStart ? '너무 빨리 뗐습니다! 다시 시도하세요.' : '초록 구역을 초과했습니다! 다시 시도하세요.';
      msgEl.className = 'text-center text-xs font-code font-bold text-[#ff007f]';
      setupRound();
    }
  };

  holdBtn.addEventListener('mousedown', startHold);
  holdBtn.addEventListener('mouseup', releaseHold);
  holdBtn.addEventListener('mouseleave', () => {
    if (holding) releaseHold();
  });

  rt.onKey((e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) startHold();
    }
  }, 'keydown');
  rt.onKey((e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      releaseHold();
    }
  }, 'keyup');

  let last = performance.now();
  const loop = (now: number) => {
    if (rt.isDestroyed() || rt.isFinished()) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (holding) {
      charge += fillSpeed * dt;
      if (charge >= 100) {
        charge = 100;
        releaseHold();
      } else {
        const inZone = charge >= safeStart && charge <= safeEnd;
        fillEl.style.width = `${charge.toFixed(1)}%`;
        needleEl.style.left = `${charge.toFixed(1)}%`;
        pctEl.textContent = `${Math.round(charge)}%`;
        orbEl.style.borderColor = inZone ? '#00ff41' : '#00e5ff';
        orbEl.style.boxShadow = inZone
          ? '0 0 46px rgba(0,255,65,0.85)'
          : `0 0 ${14 + charge * 0.35}px rgba(0,229,255,0.55)`;
      }
    }
    rt.setRaf(loop);
  };
  rt.setRaf(loop);
  rt.setProgress(0, `0 / ${goal}`);
}
