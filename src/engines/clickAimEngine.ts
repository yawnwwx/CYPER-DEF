import { audio } from '../audio';
import { PYTHON_WORDS } from '../data/stages';
import { StageRuntime } from './types';

function pickWord(): string {
  return PYTHON_WORDS[Math.floor(Math.random() * PYTHON_WORDS.length)];
}

export function runClickAimEngine(rt: StageRuntime): void {
  const { stageId, domLayer } = rt;

  if (stageId === 2) {
    // STAGE 2: 터미널 더미 텍스트 사이에 숨은 붉은색 ERROR 글자 5개 찾아 클릭
    const totalErrors = 5;
    let fixed = 0;
    const grid = document.createElement('div');
    grid.className =
      'w-full h-full p-8 grid grid-cols-5 sm:grid-cols-6 gap-4 items-center justify-items-center bg-gradient-to-br from-[#0f172a] via-[#1b1428] to-[#0b131e]';
    const errSet = new Set<number>();
    while (errSet.size < totalErrors) {
      errSet.add(Math.floor(Math.random() * 30));
    }

    for (let i = 0; i < 30; i++) {
      const cell = document.createElement('div');
      if (errSet.has(i)) {
        cell.textContent = 'ERROR';
        cell.className =
          'stage2-error-word font-code text-lg tracking-widest px-4 py-2 border border-red-500/45 bg-red-950/35 rounded';
        cell.addEventListener('click', () => {
          if (cell.classList.contains('melting') || rt.isFinished()) return;
          cell.classList.add('melting');
          audio.hitSuccess();
          fixed++;
          rt.setProgress((fixed / totalErrors) * 100, `${fixed} / ${totalErrors}`);
          if (fixed >= totalErrors) {
            rt.addTimeout(() => rt.winStage(), 520);
          }
        });
      } else {
        cell.textContent = pickWord();
        cell.className =
          'font-code text-sm text-slate-300/75 px-3 py-2 border border-white/5 hover:border-white/20 rounded cursor-pointer';
        cell.addEventListener('click', () => rt.damage(10));
      }
      grid.appendChild(cell);
    }
    domLayer.appendChild(grid);
    rt.setProgress(0, `0 / ${totalErrors}`);
    return;
  }

  if (stageId === 7) {
    // STAGE 7: 화면 곳곳에 빠르게 나타났다 사라지는 보안 노드 표적 12개 클릭 (에임 트레이너)
    interface AimTarget {
      id: number;
      x: number;
      y: number;
      r: number;
      ttl: number;
      maxTtl: number;
      el: HTMLButtonElement;
      ringEl: HTMLElement;
    }
    const goal = 12;
    let hits = 0;
    let nextId = 1;
    let spawnCooldown = 0;
    const targets: AimTarget[] = [];

    domLayer.innerHTML = `
      <div id="s7-arena" class="relative w-full h-full overflow-hidden bg-[radial-gradient(circle_at_center,#10192b_0%,#060910_100%)] select-none cursor-crosshair">
        <div class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded bg-black/65 border border-[#00e5ff]/30 text-xs font-code text-[#00e5ff]">
          보안 노드 표적이 사라지기 전에 신속히 클릭하세요 (목표 12개)
        </div>
      </div>
    `;
    const arena = domLayer.querySelector('#s7-arena') as HTMLElement;

    const spawnTarget = () => {
      if (rt.isFinished() || targets.length >= 3) return;
      const { w, h } = rt.getSize();
      const padX = 72;
      const padY = 78;
      const x = padX + Math.random() * Math.max(120, w - padX * 2);
      const y = padY + Math.random() * Math.max(100, h - padY * 2);
      const maxTtl = Math.max(1.25, 2.05 - hits * 0.045);

      const el = document.createElement('button');
      el.type = 'button';
      el.className =
        'absolute -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-[#00ff41] bg-[#072617]/90 shadow-[0_0_24px_rgba(0,255,65,0.55)] flex items-center justify-center cursor-crosshair transition-transform hover:scale-110';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.innerHTML = `
        <span class="s7-ring absolute inset-0 rounded-full border-2 border-[#00e5ff] pointer-events-none"></span>
        <span class="text-[11px] font-black font-code text-[#00ff41]">NODE</span>
      `;
      const ringEl = el.querySelector('.s7-ring') as HTMLElement;
      const tid = nextId++;
      const tObj: AimTarget = { id: tid, x, y, r: 32, ttl: maxTtl, maxTtl, el, ringEl };

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (rt.isFinished()) return;
        const idx = targets.findIndex((t) => t.id === tid);
        if (idx === -1) return;
        targets.splice(idx, 1);
        el.remove();
        rt.spawnBurst(x, y, 22, '#00ff41', '#00e5ff');
        audio.hitSuccess();
        hits++;
        rt.setProgress((hits / goal) * 100, `${hits} / ${goal}`);
        if (hits >= goal) {
          rt.winStage();
        } else {
          spawnTarget();
        }
      });

      targets.push(tObj);
      arena.appendChild(el);
    };

    spawnTarget();
    spawnTarget();

    let last = 0;
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      if (last === 0) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      spawnCooldown += dt;
      if (spawnCooldown >= 0.75) {
        spawnCooldown = 0;
        spawnTarget();
      }

      for (let i = targets.length - 1; i >= 0; i--) {
        const t = targets[i];
        t.ttl -= dt;
        const ratio = Math.max(0, t.ttl / t.maxTtl);
        const sc = (0.55 + ratio * 0.95).toFixed(2);
        t.ringEl.style.transform = `scale3d(${sc}, ${sc}, 1)`;
        t.el.style.opacity = `${Math.max(0.25, ratio + 0.15).toFixed(2)}`;
        if (t.ttl <= 0) {
          t.el.remove();
          targets.splice(i, 1);
          rt.damage(8);
          spawnTarget();
        }
      }

      const { w, h } = rt.getSize();
      rt.ctx.clearRect(0, 0, w, h);
      rt.updateAndDrawParticles(dt);
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, `0 / ${goal}`);
    return;
  }

  if (stageId === 8) {
    // STAGE 8: 좌측 변수명과 우측 파이썬 자료형(int, str 등) 짝을 순서대로 클릭해 연결
    const pairs = [
      { id: 'int', varExpr: 'port_num = 8080', typeName: 'int', desc: '정수형' },
      { id: 'str', varExpr: 'host = "CYBER-DEF"', typeName: 'str', desc: '문자열' },
      { id: 'float', varExpr: 'latency = 3.14', typeName: 'float', desc: '실수형' },
      { id: 'bool', varExpr: 'is_locked = True', typeName: 'bool', desc: '불리언' },
      { id: 'list', varExpr: 'ports = [22, 80, 443]', typeName: 'list', desc: '리스트' },
      { id: 'dict', varExpr: 'user = {"id": 1}', typeName: 'dict', desc: '딕셔너리' },
    ];
    const shuffledRight = [...pairs].sort(() => Math.random() - 0.5);
    let selectedLeft: string | null = null;
    const matched = new Set<string>();

    domLayer.innerHTML = `
      <div id="s8-root" class="relative w-full h-full flex items-center justify-center p-6 bg-[#080c14] select-none">
        <svg id="s8-svg" class="absolute inset-0 w-full h-full pointer-events-none"></svg>
        <div class="relative z-10 w-full max-w-3xl grid grid-cols-2 gap-16 sm:gap-28 items-center">
          <div id="s8-left-col" class="space-y-3">
            <div class="text-xs font-code font-bold text-[#00e5ff] tracking-widest mb-2">VARIABLES (좌측 선택)</div>
            ${pairs
              .map(
                (p) => `
              <button data-id="${p.id}" class="s8-left-btn w-full px-4 py-3 rounded-lg border border-white/15 bg-[#101622] hover:border-[#00ff41]/70 text-left font-code text-sm text-white transition cursor-pointer flex items-center justify-between">
                <span>${p.varExpr}</span>
                <span class="w-2.5 h-2.5 rounded-full bg-[#00e5ff]/60"></span>
              </button>
            `
              )
              .join('')}
          </div>
          <div id="s8-right-col" class="space-y-3">
            <div class="text-xs font-code font-bold text-[#00ff41] tracking-widest mb-2">PYTHON TYPES (우측 짝 클릭)</div>
            ${shuffledRight
              .map(
                (p) => `
              <button data-id="${p.id}" class="s8-right-btn w-full px-4 py-3 rounded-lg border border-white/15 bg-[#101622] hover:border-[#00e5ff]/70 text-left font-code text-sm text-emerald-300 transition cursor-pointer flex items-center justify-between">
                <span class="w-2.5 h-2.5 rounded-full bg-[#00ff41]/60"></span>
                <span class="font-bold text-base">${p.typeName}</span>
                <span class="text-xs text-slate-400">${p.desc}</span>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;

    const rootEl = domLayer.querySelector('#s8-root') as HTMLElement;
    const svgEl = domLayer.querySelector('#s8-svg') as unknown as SVGSVGElement;
    const leftBtns = Array.from(domLayer.querySelectorAll('.s8-left-btn')) as HTMLButtonElement[];
    const rightBtns = Array.from(domLayer.querySelectorAll('.s8-right-btn')) as HTMLButtonElement[];

    const redrawLines = () => {
      const box = rootEl.getBoundingClientRect();
      svgEl.innerHTML = '';
      matched.forEach((id) => {
        const lBtn = leftBtns.find((b) => b.dataset.id === id);
        const rBtn = rightBtns.find((b) => b.dataset.id === id);
        if (!lBtn || !rBtn) return;
        const lr = lBtn.getBoundingClientRect();
        const rr = rBtn.getBoundingClientRect();
        const x1 = lr.right - box.left;
        const y1 = lr.top + lr.height / 2 - box.top;
        const x2 = rr.left - box.left;
        const y2 = rr.top + rr.height / 2 - box.top;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const mx = (x1 + x2) / 2;
        line.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
        line.setAttribute('stroke', '#00ff41');
        line.setAttribute('stroke-width', '2.6');
        line.setAttribute('fill', 'none');
        line.setAttribute('filter', 'drop-shadow(0 0 6px rgba(0,255,65,0.75))');
        svgEl.appendChild(line);
      });
    };

    const onResize = () => redrawLines();
    window.addEventListener('resize', onResize);
    rt.addCleanup(() => window.removeEventListener('resize', onResize));

    leftBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id || '';
        if (matched.has(id) || rt.isFinished()) return;
        audio.keyClick();
        selectedLeft = id;
        leftBtns.forEach((b) => {
          if (!matched.has(b.dataset.id || '')) {
            b.classList.remove('border-[#00ff41]', 'bg-[#0c2416]', 'shadow-[0_0_18px_rgba(0,255,65,0.3)]');
          }
        });
        btn.classList.add('border-[#00ff41]', 'bg-[#0c2416]', 'shadow-[0_0_18px_rgba(0,255,65,0.3)]');
      });
    });

    rightBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id || '';
        if (!selectedLeft || matched.has(id) || rt.isFinished()) return;
        if (id === selectedLeft) {
          matched.add(id);
          const lBtn = leftBtns.find((b) => b.dataset.id === id)!;
          lBtn.className =
            's8-left-btn w-full px-4 py-3 rounded-lg border-2 border-[#00ff41] bg-[#0a2616] text-left font-code text-sm text-[#00ff41] flex items-center justify-between opacity-90';
          btn.className =
            's8-right-btn w-full px-4 py-3 rounded-lg border-2 border-[#00ff41] bg-[#0a2616] text-left font-code text-sm text-[#00ff41] flex items-center justify-between opacity-90';
          selectedLeft = null;
          audio.hitSuccess();
          redrawLines();
          rt.setProgress((matched.size / pairs.length) * 100, `${matched.size} / ${pairs.length}`);
          if (matched.size >= pairs.length) {
            rt.addTimeout(() => rt.winStage(), 480);
          }
        } else {
          rt.damage(12);
          btn.classList.add('shake-error', 'border-[#ff007f]');
          rt.addTimeout(() => btn.classList.remove('shake-error', 'border-[#ff007f]'), 380);
        }
      });
    });

    rt.setProgress(0, `0 / ${pairs.length}`);
    return;
  }

  if (stageId === 11) {
    // STAGE 11: 10줄의 파이썬 코드 중 문법 오류(콜론 누락, 오타 등)가 있는 1줄을 찾아 클릭
    const scripts = [
      {
        errorLine: 4,
        reason: 'for 반복문 끝에 콜론(:)이 누락되었습니다!',
        lines: [
          'import sys',
          'def scan_ports(targets):',
          '    open_ports = []',
          '    for port in targets',
          '        if port in (80, 443):',
          '            open_ports.append(port)',
          '    print("Scan complete")',
          '    return open_ports',
          'result = scan_ports([22, 80, 443])',
          'print(result)',
        ],
      },
      {
        errorLine: 6,
        reason: 'print 함수명에 오타(pritn)가 있습니다!',
        lines: [
          'def verify_token(token):',
          '    valid = "CYBER_2025"',
          '    if token == valid:',
          '        status = True',
          '    else:',
          '        pritn("Invalid token!")',
          '        status = False',
          '    return status',
          'ok = verify_token("CYBER_2025")',
          'print("AUTH:", ok)',
        ],
      },
      {
        errorLine: 3,
        reason: 'if 조건문 끝에 콜론(:)이 누락되었습니다!',
        lines: [
          'packets = [12, 48, 99, 104]',
          'def filter_safe(data):',
          '    if len(data) > 0',
          '        first = data[0]',
          '        print("First:", first)',
          '    else:',
          '        print("Empty")',
          '    return True',
          'done = filter_safe(packets)',
          'print("DONE:", done)',
        ],
      },
    ];
    const picked = scripts[Math.floor(Math.random() * scripts.length)];

    domLayer.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center p-6 bg-[#070a10] select-none">
        <div class="w-full max-w-2xl rounded-xl border border-[#00e5ff]/40 bg-[#0d121d] overflow-hidden shadow-[0_0_40px_rgba(0,229,255,0.12)]">
          <div class="px-4 py-2.5 bg-[#121926] border-b border-white/10 flex items-center justify-between text-xs font-code">
            <span class="text-[#00e5ff] font-bold">debugger.py — 10 LINES</span>
            <span id="s11-hint" class="text-amber-300">문법 오류가 있는 1줄을 클릭하세요</span>
          </div>
          <div id="s11-code" class="divide-y divide-white/5 py-1">
            ${picked.lines
              .map(
                (line, idx) => `
              <button data-line="${idx + 1}" class="s11-line w-full px-4 py-2 text-left font-code text-sm hover:bg-[#00ff41]/10 transition flex items-center gap-4 cursor-pointer">
                <span class="w-6 text-right text-slate-500 text-xs select-none">${String(idx + 1).padStart(2, '0')}</span>
                <pre class="text-slate-200 whitespace-pre">${line.replace(/</g, '&lt;')}</pre>
              </button>
            `
              )
              .join('')}
          </div>
        </div>
      </div>
    `;

    const hintEl = domLayer.querySelector('#s11-hint') as HTMLElement;
    domLayer.querySelectorAll('.s11-line').forEach((el) => {
      const btn = el as HTMLButtonElement;
      btn.addEventListener('click', () => {
        if (rt.isFinished()) return;
        const lineNum = Number(btn.dataset.line);
        if (lineNum === picked.errorLine) {
          audio.hitSuccess();
          btn.classList.add('bg-[#00ff41]/25', 'border-l-4', 'border-[#00ff41]');
          hintEl.textContent = `정확합니다! ${picked.reason}`;
          hintEl.className = 'text-[#00ff41] font-bold';
          rt.setProgress(100, 'BUG FOUND!');
          rt.addTimeout(() => rt.winStage(), 680);
        } else {
          rt.damage(15);
          btn.classList.add('bg-red-950/60', 'shake-error');
          rt.addTimeout(() => btn.classList.remove('bg-red-950/60', 'shake-error'), 420);
        }
      });
    });

    rt.setProgress(0, '0 / 1');
    return;
  }

  if (stageId === 18) {
    // STAGE 18: 1~6 숫자가 적힌 노드가 1.5초 뒤 가려지면 순서를 기억해 차례대로 클릭
    const count = 6;
    let nextExpected = 1;
    let phase: 'memorize' | 'recall' = 'memorize';

    domLayer.innerHTML = `
      <div id="s18-arena" class="relative w-full h-full bg-[#080b13] overflow-hidden select-none">
        <svg id="s18-svg" class="absolute inset-0 w-full h-full pointer-events-none"></svg>
        <div id="s18-banner" class="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-5 py-2 rounded-lg bg-[#0d1929]/95 border border-[#00e5ff]/60 text-sm font-bold text-[#00e5ff] font-code">
          1~6 숫자의 위치를 기억하세요! (1.5초 후 숨김)
        </div>
      </div>
    `;

    const arena = domLayer.querySelector('#s18-arena') as HTMLElement;
    const svg = domLayer.querySelector('#s18-svg') as unknown as SVGSVGElement;
    const banner = domLayer.querySelector('#s18-banner') as HTMLElement;
    const { w, h } = rt.getSize();

    // Generate 6 well-separated node coordinates
    const positions: Array<{ num: number; x: number; y: number }> = [];
    const marginX = 95;
    const marginY = 105;
    for (let n = 1; n <= count; n++) {
      let px = w / 2;
      let py = h / 2;
      for (let tries = 0; tries < 60; tries++) {
        const tx = marginX + Math.random() * Math.max(180, w - marginX * 2);
        const ty = marginY + Math.random() * Math.max(140, h - marginY * 2);
        if (positions.every((p) => Math.hypot(p.x - tx, p.y - ty) >= 102)) {
          px = tx;
          py = ty;
          break;
        }
      }
      positions.push({ num: n, x: px, y: py });
    }

    const nodeEls: HTMLButtonElement[] = [];
    const revealedCoords: Array<{ x: number; y: number }> = [];

    const drawPath = () => {
      svg.innerHTML = '';
      for (let i = 1; i < revealedCoords.length; i++) {
        const a = revealedCoords[i - 1];
        const b = revealedCoords[i];
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(a.x));
        line.setAttribute('y1', String(a.y));
        line.setAttribute('x2', String(b.x));
        line.setAttribute('y2', String(b.y));
        line.setAttribute('stroke', '#00ff41');
        line.setAttribute('stroke-width', '3');
        svg.appendChild(line);
      }
    };

    positions.forEach((pos) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.num = String(pos.num);
      btn.style.left = `${pos.x}px`;
      btn.style.top = `${pos.y}px`;
      btn.className =
        'absolute z-10 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-[#00e5ff] bg-[#0e1f33] text-white text-2xl font-black font-code shadow-[0_0_24px_rgba(0,229,255,0.4)] transition-all cursor-pointer';
      btn.textContent = String(pos.num);

      btn.addEventListener('click', () => {
        if (phase !== 'recall' || rt.isFinished()) return;
        const num = Number(btn.dataset.num);
        if (num < nextExpected) return;
        if (num === nextExpected) {
          audio.hitSuccess();
          btn.textContent = String(num);
          btn.className =
            'absolute z-10 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-[#00ff41] bg-[#0a2d18] text-[#00ff41] text-2xl font-black font-code shadow-[0_0_26px_rgba(0,255,65,0.65)] scale-105';
          revealedCoords.push({ x: pos.x, y: pos.y });
          drawPath();
          rt.setProgress((nextExpected / count) * 100, `${nextExpected} / ${count}`);
          nextExpected++;
          if (nextExpected > count) {
            rt.addTimeout(() => rt.winStage(), 460);
          }
        } else {
          rt.damage(15);
          // Briefly flash the clicked number so the player can recover fairly
          btn.textContent = String(num);
          btn.classList.add('border-[#ff007f]', 'text-[#ff007f]', 'shake-error');
          rt.addTimeout(() => {
            if (Number(btn.dataset.num) >= nextExpected) {
              btn.textContent = '?';
              btn.classList.remove('border-[#ff007f]', 'text-[#ff007f]', 'shake-error');
            }
          }, 420);
        }
      });

      nodeEls.push(btn);
      arena.appendChild(btn);
    });

    rt.addTimeout(() => {
      phase = 'recall';
      banner.textContent = '1번부터 6번까지 순서대로 클릭하세요!';
      banner.className =
        'absolute top-4 left-1/2 -translate-x-1/2 z-20 px-5 py-2 rounded-lg bg-[#0d2215]/95 border border-[#00ff41]/60 text-sm font-bold text-[#00ff41] font-code';
      nodeEls.forEach((b) => {
        b.textContent = '?';
        b.className =
          'absolute z-10 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border-2 border-slate-400/70 bg-[#151c29] hover:border-[#00ff41] text-slate-300 text-2xl font-black font-code shadow-[0_0_16px_rgba(148,163,184,0.2)] transition-all cursor-pointer';
      });
    }, 1500);

    rt.setProgress(0, `0 / ${count}`);
    return;
  }

  if (stageId === 19) {
    // STAGE 19: 마우스 주변만 밝게 보이는 손전등(CSS mask-image) 시야로 숨은 ERROR 찾기
    const totalErrors = 5;
    let found = 0;

    domLayer.innerHTML = `
      <div id="s19-wrap" class="relative w-full h-full bg-[#020306] overflow-hidden select-none">
        <div id="s19-masked" class="w-full h-full p-8 grid grid-cols-6 sm:grid-cols-7 gap-3 items-center justify-items-center bg-[#0d1522]"
          style="-webkit-mask-image: radial-gradient(circle 125px at var(--mx, 50%) var(--my, 50%), rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 55%, rgba(0,0,0,0) 100%); mask-image: radial-gradient(circle 125px at var(--mx, 50%) var(--my, 50%), rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 55%, rgba(0,0,0,0) 100%);">
        </div>
        <div id="s19-ring" class="pointer-events-none absolute w-[250px] h-[250px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#00ff41]/35 shadow-[inset_0_0_40px_rgba(0,255,65,0.12)]" style="left:50%;top:50%;"></div>
      </div>
    `;

    const wrap = domLayer.querySelector('#s19-wrap') as HTMLElement;
    const maskedGrid = domLayer.querySelector('#s19-masked') as HTMLElement;
    const ring = domLayer.querySelector('#s19-ring') as HTMLElement;

    const totalCells = 42;
    const errSet = new Set<number>();
    while (errSet.size < totalErrors) {
      errSet.add(Math.floor(Math.random() * totalCells));
    }

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      if (errSet.has(i)) {
        cell.textContent = 'ERROR';
        cell.className =
          'font-code text-base font-black tracking-widest px-3 py-1.5 rounded border border-red-500/70 bg-red-950/60 text-red-400 shadow-[0_0_16px_rgba(255,0,60,0.45)] cursor-pointer hover:scale-110 transition';
        cell.addEventListener('click', () => {
          if (cell.disabled || rt.isFinished()) return;
          cell.disabled = true;
          cell.textContent = 'PURGED';
          cell.className =
            'font-code text-xs font-bold px-3 py-1.5 rounded border border-[#00ff41]/50 bg-[#0a2616] text-[#00ff41] opacity-60';
          audio.hitSuccess();
          found++;
          rt.setProgress((found / totalErrors) * 100, `${found} / ${totalErrors}`);
          if (found >= totalErrors) {
            rt.addTimeout(() => rt.winStage(), 420);
          }
        });
      } else {
        cell.textContent = pickWord();
        cell.className =
          'font-code text-xs text-slate-400/80 px-2.5 py-1.5 rounded border border-white/5 hover:border-white/20 cursor-pointer';
        cell.addEventListener('click', () => rt.damage(8));
      }
      maskedGrid.appendChild(cell);
    }

    const updateBeam = (clientX: number, clientY: number) => {
      const rect = wrap.getBoundingClientRect();
      const mx = clientX - rect.left;
      const my = clientY - rect.top;
      maskedGrid.style.setProperty('--mx', `${mx}px`);
      maskedGrid.style.setProperty('--my', `${my}px`);
      ring.style.left = `${mx}px`;
      ring.style.top = `${my}px`;
    };

    const onMove = (e: MouseEvent) => updateBeam(e.clientX, e.clientY);
    wrap.addEventListener('mousemove', onMove);
    rt.addCleanup(() => wrap.removeEventListener('mousemove', onMove));

    rt.setProgress(0, `0 / ${totalErrors}`);
    return;
  }

  if (stageId === 24) {
    // STAGE 24: 화면 안에서 빠르게 도망 다니는 ERROR 글자를 쫓아가 클릭
    const goal = 5;
    let hits = 0;
    const { w: initW, h: initH } = rt.getSize();
    let tx = initW * 0.5;
    let ty = initH * 0.5;
    let vx = 210;
    let vy = 165;
    let mouseX = -999;
    let mouseY = -999;

    domLayer.innerHTML = `
      <div id="s24-arena" class="relative w-full h-full overflow-hidden bg-[#080a10] cursor-crosshair select-none">
        <div id="s24-holes" class="absolute inset-0 pointer-events-none"></div>
        <button id="s24-target" type="button"
          class="absolute left-0 top-0 px-5 py-2.5 rounded-lg border-2 border-[#ff0044] bg-[#2c0612]/95 text-[#ff3b6b] font-code font-black text-xl tracking-widest shadow-[0_0_26px_rgba(255,0,68,0.65)] cursor-crosshair will-change-transform">
          ERROR
        </button>
      </div>
    `;

    const arena = domLayer.querySelector('#s24-arena') as HTMLElement;
    const holesLayer = domLayer.querySelector('#s24-holes') as HTMLElement;
    const targetBtn = domLayer.querySelector('#s24-target') as HTMLButtonElement;

    const onMouseMove = (e: MouseEvent) => {
      const rect = arena.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
    };
    arena.addEventListener('mousemove', onMouseMove);
    rt.addCleanup(() => arena.removeEventListener('mousemove', onMouseMove));

    arena.addEventListener('click', (e) => {
      if (rt.isFinished() || e.target === targetBtn) return;
      const rect = arena.getBoundingClientRect();
      const bx = e.clientX - rect.left;
      const by = e.clientY - rect.top;
      const hole = document.createElement('div');
      hole.className = 'absolute w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black border border-slate-500/80 shadow-[0_0_6px_rgba(255,255,255,0.3)]';
      hole.style.left = `${bx}px`;
      hole.style.top = `${by}px`;
      holesLayer.appendChild(hole);
      rt.damage(6);
    });

    targetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (rt.isFinished()) return;
      audio.explosion();
      rt.spawnBurst(tx, ty, 28, '#00ff41', '#ff007f');
      hits++;
      rt.setProgress((hits / goal) * 100, `${hits} / ${goal}`);
      if (hits >= goal) {
        targetBtn.classList.add('hidden');
        rt.addTimeout(() => rt.winStage(), 380);
      } else {
        // Teleport to opposite quadrant with higher speed
        const { w, h } = rt.getSize();
        tx = tx < w / 2 ? w * 0.75 : w * 0.25;
        ty = ty < h / 2 ? h * 0.72 : h * 0.28;
        const angle = Math.random() * Math.PI * 2;
        const speed = 225 + hits * 28;
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      }
    });

    let last = 0;
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      if (last === 0) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const { w, h } = rt.getSize();
      const dx = tx - mouseX;
      const dy = ty - mouseY;
      const dist = Math.hypot(dx, dy);
      if (dist < 165 && dist > 1) {
        const fleeBoost = (1 - dist / 165) * (620 + hits * 65);
        vx += (dx / dist) * fleeBoost * dt;
        vy += (dy / dist) * fleeBoost * dt;
      }

      // Clamp max velocity so it's thrilling yet catchable
      const maxSpd = 340 + hits * 32;
      const curSpd = Math.hypot(vx, vy);
      if (curSpd > maxSpd) {
        vx = (vx / curSpd) * maxSpd;
        vy = (vy / curSpd) * maxSpd;
      } else if (curSpd < 160) {
        vx *= 1.05;
        vy *= 1.05;
      }

      tx += vx * dt;
      ty += vy * dt;
      const padX = 64;
      const padY = 34;
      if (tx < padX) {
        tx = padX;
        vx = Math.abs(vx);
      } else if (tx > w - padX) {
        tx = w - padX;
        vx = -Math.abs(vx);
      }
      if (ty < padY) {
        ty = padY;
        vy = Math.abs(vy);
      } else if (ty > h - padY) {
        ty = h - padY;
        vy = -Math.abs(vy);
      }

      targetBtn.style.transform = `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) translate(-50%, -50%)`;

      rt.ctx.clearRect(0, 0, w, h);
      rt.updateAndDrawParticles(dt);
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    rt.setProgress(0, `0 / ${goal}`);
    return;
  }

  // STAGE 26: 분열하는 악성 팝업 중 가장 붉은색을 띠는 본체 팝업만 골라 5회 클릭
  const goal = 5;
  let hits = 0;

  interface SplitPopup {
    el: HTMLElement;
    x: number;
    y: number;
    vx: number;
    vy: number;
    isCore: boolean;
  }
  let popups: SplitPopup[] = [];

  domLayer.innerHTML = `
    <div id="s26-arena" class="relative w-full h-full overflow-hidden bg-[#09080e] select-none">
      <div class="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 px-4 py-1.5 rounded bg-black/75 border border-red-500/45 text-xs font-code text-red-300">
        분열하는 팝업 중 <span class="text-[#ff1e42] font-black">가장 붉은색 본체 팝업</span>만 클릭하세요 (5회)
      </div>
    </div>
  `;
  const arena = domLayer.querySelector('#s26-arena') as HTMLElement;

  const decoyStyles = [
    { border: '#6b3fa0', header: '#4c2c72', bg: '#151022', text: '#c4b5fd', label: 'CLONE_A.tmp' },
    { border: '#8a4b2a', header: '#6b381e', bg: '#1a120d', text: '#fdba74', label: 'CLONE_B.tmp' },
    { border: '#803556', header: '#5c233c', bg: '#190f15', text: '#f9a8d4', label: 'CLONE_C.tmp' },
    { border: '#475569', header: '#334155', bg: '#11161f', text: '#cbd5e1', label: 'DECOY_X.tmp' },
  ];

  const spawnWave = () => {
    popups.forEach((p) => p.el.remove());
    popups = [];
    const { w, h } = rt.getSize();
    const total = 5 + hits; // 5 -> 9 popups
    const coreIdx = Math.floor(Math.random() * total);

    for (let i = 0; i < total; i++) {
      const isCore = i === coreIdx;
      const el = document.createElement('button');
      el.type = 'button';
      const px = 40 + Math.random() * Math.max(140, w - 250);
      const py = 54 + Math.random() * Math.max(120, h - 180);
      const angle = Math.random() * Math.PI * 2;
      const spd = 48 + Math.random() * 55 + hits * 10;

      if (isCore) {
        el.className =
          'absolute left-0 top-0 w-48 rounded-lg border-2 border-[#ff0026] bg-[#36040d] shadow-[0_0_32px_rgba(255,0,38,0.75)] overflow-hidden text-left cursor-pointer z-20 will-change-transform';
        el.innerHTML = `
          <div class="px-3 py-1.5 bg-[#ff0026] text-white text-xs font-black font-code flex items-center justify-between">
            <span>HOST_CORE.exe</span>
            <span class="w-2.5 h-2.5 rounded-full bg-white animate-ping"></span>
          </div>
          <div class="p-3 text-xs font-code text-red-200 font-bold">PRIMARY VIRUS BODY</div>
        `;
      } else {
        const d = decoyStyles[i % decoyStyles.length];
        el.className =
          'absolute left-0 top-0 w-44 rounded-lg border overflow-hidden text-left cursor-pointer z-10 opacity-90 hover:opacity-100 will-change-transform';
        el.style.borderColor = d.border;
        el.style.backgroundColor = d.bg;
        el.innerHTML = `
          <div class="px-3 py-1 text-white text-[11px] font-bold font-code" style="background:${d.header}">
            ${d.label}
          </div>
          <div class="p-2.5 text-[11px] font-code" style="color:${d.text}">SPLITTING PROCESS...</div>
        `;
      }

      el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;

      const popupObj: SplitPopup = {
        el,
        x: px,
        y: py,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        isCore,
      };

      el.addEventListener('click', () => {
        if (rt.isFinished()) return;
        if (isCore) {
          audio.explosion();
          rt.spawnBurst(popupObj.x + 90, popupObj.y + 45, 30, '#ff0026', '#00ff41');
          hits++;
          rt.setProgress((hits / goal) * 100, `${hits} / ${goal}`);
          if (hits >= goal) {
            popups.forEach((p) => p.el.remove());
            popups = [];
            rt.addTimeout(() => rt.winStage(), 380);
          } else {
            spawnWave();
          }
        } else {
          rt.damage(12);
          el.classList.add('shake-error');
          rt.addTimeout(() => el.classList.remove('shake-error'), 380);
        }
      });

      arena.appendChild(el);
      popups.push(popupObj);
    }
  };

  spawnWave();

  let last = 0;
  const loop = (now: number) => {
    if (rt.isDestroyed() || rt.isFinished()) return;
    if (last === 0) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const { w, h } = rt.getSize();

    for (const p of popups) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 12) {
        p.x = 12;
        p.vx = Math.abs(p.vx);
      } else if (p.x > w - 205) {
        p.x = w - 205;
        p.vx = -Math.abs(p.vx);
      }
      if (p.y < 48) {
        p.y = 48;
        p.vy = Math.abs(p.vy);
      } else if (p.y > h - 98) {
        p.y = h - 98;
        p.vy = -Math.abs(p.vy);
      }
      p.el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    }

    rt.ctx.clearRect(0, 0, w, h);
    rt.updateAndDrawParticles(dt);
    rt.setRaf(loop);
  };
  rt.setRaf(loop);
  rt.setProgress(0, `0 / ${goal}`);
}
