import { audio } from '../audio';
import { PYTHON_DESTROY_CODES } from '../data/stages';
import { StageRuntime } from './types';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderCharDiff(target: string, typed: string): string {
  let html = '';
  for (let i = 0; i < target.length; i++) {
    const ch = escapeHtml(target[i]);
    if (i < typed.length) {
      if (typed[i] === target[i]) {
        html += `<span class="text-[#00ff41] bg-[#00ff41]/15">${ch}</span>`;
      } else {
        html += `<span class="text-[#ff007f] bg-[#ff007f]/25 underline">${ch}</span>`;
      }
    } else if (i === typed.length) {
      html += `<span class="text-white bg-white/20">${ch}</span>`;
    } else {
      html += `<span class="text-slate-400">${ch}</span>`;
    }
  }
  return html;
}

export function runCodeBossEngine(rt: StageRuntime): void {
  const { stageId, domLayer, inputDock, cmdInput } = rt;

  // =========================================================================
  // STAGE 5: 3줄짜리 기초 파이썬 코드 오타 없이 입력 후 엔터
  // STAGE 15: 5줄짜리 중급 파이썬 코드(조건문/반복문) 오타 없이 입력
  // =========================================================================
  if (stageId === 5 || stageId === 15) {
    const lines =
      stageId === 5
        ? ['port = 443', 'status = "SAFE"', 'print(port, status)']
        : [
            'def check_firewall(ports):',
            'for p in ports:',
            'if p == 443:',
            'print("BREACH_OK")',
            'return True',
          ];

    let curIdx = 0;

    domLayer.innerHTML = `
      <div class="w-full h-full flex items-center justify-center p-6 bg-[#070a10] select-none">
        <div class="w-full max-w-2xl rounded-xl border border-[#00ff41]/45 bg-[#0d131f] p-6 space-y-4 shadow-[0_0_40px_rgba(0,255,65,0.12)]">
          <div class="flex items-center justify-between border-b border-white/10 pb-3">
            <span class="text-xs font-code font-bold text-[#00ff41]">
              ${stageId === 5 ? 'FIREWALL_L1.py · 기초 파이썬 3줄 입력' : 'FIREWALL_L2.py · 중급 파이썬 5줄 입력'}
            </span>
            <span id="code-line-badge" class="text-xs font-code text-[#00e5ff]">LINE 1 / ${lines.length}</span>
          </div>

          <div id="code-lines-box" class="space-y-2.5 font-code text-base"></div>
          <div id="code-feedback" class="text-xs font-code text-slate-400 h-5">
            현재 강조된 줄을 오타 없이 입력한 뒤 Enter를 누르세요.
          </div>
        </div>
      </div>
    `;

    const linesBox = domLayer.querySelector('#code-lines-box') as HTMLElement;
    const badgeEl = domLayer.querySelector('#code-line-badge') as HTMLElement;
    const feedbackEl = domLayer.querySelector('#code-feedback') as HTMLElement;

    const renderLines = (typed: string) => {
      linesBox.innerHTML = lines
        .map((line, i) => {
          if (i < curIdx) {
            return `
              <div class="px-4 py-2.5 rounded-lg border border-[#00ff41]/40 bg-[#082113] flex items-center gap-3">
                <span class="text-xs text-[#00ff41] font-bold">✓</span>
                <span class="text-[#00ff41]/80 line-through">${escapeHtml(line)}</span>
              </div>
            `;
          }
          if (i === curIdx) {
            return `
              <div class="px-4 py-3 rounded-lg border-2 border-[#00e5ff] bg-[#0a1829] shadow-[0_0_20px_rgba(0,229,255,0.2)] flex items-center gap-3">
                <span class="text-xs text-[#00e5ff] font-black">&gt;</span>
                <span class="tracking-wide">${renderCharDiff(line, typed)}</span>
              </div>
            `;
          }
          return `
            <div class="px-4 py-2.5 rounded-lg border border-white/10 bg-[#0a0f18] flex items-center gap-3 opacity-55">
              <span class="text-xs text-slate-500">${i + 1}</span>
              <span class="text-slate-400">${escapeHtml(line)}</span>
            </div>
          `;
        })
        .join('');
    };

    renderLines('');
    rt.setProgress(0, `0 / ${lines.length}`);

    rt.enableTypingDock(
      (val) => {
        renderLines(val);
      },
      (val) => {
        if (rt.isFinished()) return;
        const target = lines[curIdx];
        if (val.trim() === target) {
          audio.hitSuccess();
          curIdx++;
          cmdInput.value = '';
          rt.setProgress((curIdx / lines.length) * 100, `${curIdx} / ${lines.length}`);
          if (curIdx >= lines.length) {
            renderLines('');
            feedbackEl.textContent = '모든 파이썬 코드가 성공적으로 컴파일되었습니다!';
            feedbackEl.className = 'text-xs font-code font-bold text-[#00ff41] h-5';
            rt.addTimeout(() => rt.winStage(), 420);
          } else {
            badgeEl.textContent = `LINE ${curIdx + 1} / ${lines.length}`;
            feedbackEl.textContent = '정확합니다! 다음 줄을 입력하세요.';
            feedbackEl.className = 'text-xs font-code text-[#00ff41] h-5';
            renderLines('');
          }
        } else {
          rt.damage(12);
          feedbackEl.textContent = '오타가 있습니다! 대소문자와 기호, 공백을 정확히 확인하세요.';
          feedbackEl.className = 'text-xs font-code font-bold text-[#ff007f] h-5';
        }
      },
      '강조된 파이썬 코드를 그대로 입력 후 Enter...'
    );
    return;
  }

  // =========================================================================
  // STAGE 10 (보스전): 4줄 코드 입력 --> 좌우로 움직이는 컴파일 게이지 안전 구역 엔터
  // =========================================================================
  if (stageId === 10) {
    const bossLines = [
      'import core_api',
      'key = core_api.unlock()',
      'core_api.overload(key)',
      'core_api.compile_strike()',
    ];
    let phase: 1 | 2 = 1;
    let lineIdx = 0;
    let gaugePos = 0;
    let gaugeDir = 1;

    domLayer.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center gap-5 p-6 bg-[#0a0710] select-none">
        <div id="s10-badge" class="text-xs font-code font-black tracking-widest text-[#ff007f]">
          BOSS PHASE 1/2 · 4줄 파이썬 공격 코드 입력
        </div>

        <div id="s10-p1" class="w-full max-w-2xl rounded-xl border-2 border-[#ff007f]/55 bg-[#120b18] p-5 space-y-2.5 font-code text-base shadow-[0_0_35px_rgba(255,0,127,0.2)]"></div>

        <div id="s10-p2" class="hidden w-full max-w-xl flex flex-col items-center gap-5">
          <div class="w-32 h-32 rounded-full border-4 border-[#ff007f] bg-[#240914] flex items-center justify-center shadow-[0_0_40px_rgba(255,0,127,0.55)] animate-pulse">
            <span class="text-sm font-black font-code text-white">CORE_01</span>
          </div>
          <div class="text-sm font-bold text-[#00e5ff] font-code">컴파일 게이지가 초록색 안전 구역에 들어올 때 ENTER!</div>
          <div id="s10-track" class="relative w-full h-11 rounded-lg bg-[#121622] border-2 border-white/25 overflow-hidden">
            <div class="absolute top-0 bottom-0 left-[38%] w-[24%] bg-[#00ff41]/30 border-x-2 border-[#00ff41]"></div>
            <div id="s10-cursor" class="absolute top-0 bottom-0 left-0 w-3 bg-[#ff007f] shadow-[0_0_16px_#ff007f] will-change-transform" style="transform:translate3d(0,0,0)"></div>
          </div>
          <button id="s10-strike-btn" class="cyber-btn px-8 py-3 text-sm font-black cursor-pointer">
            [ ENTER ] 컴파일 타격 실행!
          </button>
        </div>

        <div id="s10-msg" class="text-xs font-code text-slate-300 h-5"></div>
      </div>
    `;

    const badgeEl = domLayer.querySelector('#s10-badge') as HTMLElement;
    const p1El = domLayer.querySelector('#s10-p1') as HTMLElement;
    const p2El = domLayer.querySelector('#s10-p2') as HTMLElement;
    const trackEl = domLayer.querySelector('#s10-track') as HTMLElement;
    const cursorEl = domLayer.querySelector('#s10-cursor') as HTMLElement;
    const strikeBtn = domLayer.querySelector('#s10-strike-btn') as HTMLButtonElement;
    const msgEl = domLayer.querySelector('#s10-msg') as HTMLElement;

    const renderBossLines = (typed: string) => {
      p1El.innerHTML = bossLines
        .map((line, i) => {
          if (i < lineIdx) {
            return `<div class="px-4 py-2 rounded border border-[#00ff41]/40 bg-[#082113] text-[#00ff41]/80 line-through">✓ ${escapeHtml(line)}</div>`;
          }
          if (i === lineIdx) {
            return `<div class="px-4 py-2.5 rounded border-2 border-[#00e5ff] bg-[#0a1829]">&gt; ${renderCharDiff(line, typed)}</div>`;
          }
          return `<div class="px-4 py-2 rounded border border-white/10 bg-black/40 text-slate-500">${i + 1}. ${escapeHtml(line)}</div>`;
        })
        .join('');
    };

    const enterPhase2 = () => {
      phase = 2;
      inputDock.classList.add('hidden');
      p1El.classList.add('hidden');
      p2El.classList.remove('hidden');
      badgeEl.textContent = 'BOSS PHASE 2/2 · 컴파일 게이지 안전 구역 ENTER 타격!';
      badgeEl.className = 'text-xs font-code font-black tracking-widest text-[#00ff41]';
      msgEl.textContent = '';
    };

    const tryStrike = () => {
      if (phase !== 2 || rt.isFinished()) return;
      if (gaugePos >= 37 && gaugePos <= 63) {
        audio.explosion();
        const { w, h } = rt.getSize();
        rt.spawnBurst(w / 2, h / 2, 48, '#00ff41', '#00e5ff');
        rt.setProgress(100, 'CORE DESTROYED!');
        rt.winStage();
      } else {
        rt.damage(15);
        msgEl.textContent = '빗나갔습니다! 초록 구역(중앙)에서 정확히 Enter를 누르세요!';
        msgEl.className = 'text-xs font-code font-bold text-[#ff007f] h-5';
      }
    };

    strikeBtn.addEventListener('click', tryStrike);
    rt.onKey((e) => {
      if (phase === 2 && e.key === 'Enter') {
        e.preventDefault();
        tryStrike();
      }
    });

    renderBossLines('');
    rt.setProgress(0, 'PHASE 1 (0/4)');
    rt.enableTypingDock(
      (val) => {
        if (phase === 1) renderBossLines(val);
      },
      (val) => {
        if (phase !== 1 || rt.isFinished()) return;
        if (val.trim() === bossLines[lineIdx]) {
          audio.hitSuccess();
          lineIdx++;
          cmdInput.value = '';
          rt.setProgress((lineIdx / bossLines.length) * 75, `PHASE 1 (${lineIdx}/${bossLines.length})`);
          if (lineIdx >= bossLines.length) {
            enterPhase2();
          } else {
            renderBossLines('');
          }
        } else {
          rt.damage(12);
          msgEl.textContent = '코드 오타! 정확히 입력 후 Enter를 누르세요.';
          msgEl.className = 'text-xs font-code font-bold text-[#ff007f] h-5';
        }
      },
      '보스 공격용 파이썬 코드 입력 후 Enter...'
    );

    let last = 0;
    const loop = (now: number) => {
      if (rt.isDestroyed() || rt.isFinished()) return;
      if (last === 0) last = now;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (phase === 2) {
        gaugePos += gaugeDir * 128 * dt;
        if (gaugePos >= 97) {
          gaugePos = 97;
          gaugeDir = -1;
        } else if (gaugePos <= 0) {
          gaugePos = 0;
          gaugeDir = 1;
        }
        const trackW = trackEl.clientWidth || 540;
        cursorEl.style.transform = `translate3d(${((gaugePos / 100) * trackW).toFixed(1)}px, 0, 0)`;
      }
      const { w, h } = rt.getSize();
      rt.ctx.clearRect(0, 0, w, h);
      rt.updateAndDrawParticles(dt);
      rt.setRaf(loop);
    };
    rt.setRaf(loop);
    return;
  }

  // =========================================================================
  // STAGE 20 (보스전): 마우스 광클로 보스 쉴드 파괴 --> 파이썬 코드 입력으로 마무리
  // =========================================================================
  if (stageId === 20) {
    const shieldMax = 20;
    let shieldClicks = 0;
    let phase: 1 | 2 = 1;
    const finishCodes = ['watcher.disable()', 'del watcher.shield', 'sys.kill("WATCHER")'];
    let codeIdx = 0;

    domLayer.innerHTML = `
      <div class="w-full h-full flex flex-col items-center justify-center gap-5 p-6 bg-[#0a0812] select-none">
        <div id="s20-phase" class="text-sm font-code font-black tracking-widest text-[#ff007f]">
          BOSS PHASE 1/2 · 보안 감시자 쉴드 광클 파괴 (0 / ${shieldMax})
        </div>

        <div id="s20-p1" class="flex flex-col items-center gap-4">
          <button id="s20-shield" type="button"
            class="relative w-52 h-52 rounded-full border-4 border-[#00e5ff] bg-[#0b1b2d] flex flex-col items-center justify-center overflow-hidden shadow-[0_0_45px_rgba(0,229,255,0.45)] cursor-pointer active:scale-95 transition-transform">
            <div id="s20-cracks" class="absolute inset-0 pointer-events-none"></div>
            <span class="relative z-10 text-xl font-black font-code text-white">WATCHER</span>
            <span id="s20-hp-label" class="relative z-10 text-xs font-code text-[#00e5ff] mt-1">SHIELD 100%</span>
          </button>
          <div class="text-xs font-code text-slate-400">보스 쉴드를 빠르게 20회 클릭해 파괴하세요!</div>
        </div>

        <div id="s20-p2" class="hidden w-full max-w-xl rounded-xl border-2 border-[#00ff41]/55 bg-[#0b1714] p-5 space-y-3 font-code">
          <div class="text-xs text-[#00ff41] font-bold">쉴드 붕괴 완료! 마무리 파이썬 코드를 입력해 보스를 완전히 제거하세요.</div>
          <div id="s20-code-box" class="space-y-2 text-base"></div>
        </div>
      </div>
    `;

    const phaseEl = domLayer.querySelector('#s20-phase') as HTMLElement;
    const p1El = domLayer.querySelector('#s20-p1') as HTMLElement;
    const p2El = domLayer.querySelector('#s20-p2') as HTMLElement;
    const shieldBtn = domLayer.querySelector('#s20-shield') as HTMLButtonElement;
    const cracksEl = domLayer.querySelector('#s20-cracks') as HTMLElement;
    const hpLabel = domLayer.querySelector('#s20-hp-label') as HTMLElement;
    const codeBox = domLayer.querySelector('#s20-code-box') as HTMLElement;

    const renderP2 = (typed: string) => {
      codeBox.innerHTML = finishCodes
        .map((line, i) => {
          if (i < codeIdx) {
            return `<div class="px-3.5 py-2 rounded border border-[#00ff41]/40 bg-[#082414] text-[#00ff41]/75 line-through">✓ ${escapeHtml(line)}</div>`;
          }
          if (i === codeIdx) {
            return `<div class="px-3.5 py-2.5 rounded border-2 border-[#00ff41] bg-[#0a2117]">&gt; ${renderCharDiff(line, typed)}</div>`;
          }
          return `<div class="px-3.5 py-2 rounded border border-white/10 bg-black/40 text-slate-500">${i + 1}. ${escapeHtml(line)}</div>`;
        })
        .join('');
    };

    const enterPhase2 = () => {
      phase = 2;
      p1El.classList.add('hidden');
      p2El.classList.remove('hidden');
      phaseEl.textContent = 'BOSS PHASE 2/2 · 마무리 파이썬 코드 입력!';
      phaseEl.className = 'text-sm font-code font-black tracking-widest text-[#00ff41]';
      renderP2('');
      rt.enableTypingDock(
        (val) => renderP2(val),
        (val) => {
          if (phase !== 2 || rt.isFinished()) return;
          if (val.trim() === finishCodes[codeIdx]) {
            audio.hitSuccess();
            codeIdx++;
            cmdInput.value = '';
            rt.setProgress(50 + (codeIdx / finishCodes.length) * 50, `PHASE 2 (${codeIdx}/${finishCodes.length})`);
            if (codeIdx >= finishCodes.length) {
              audio.explosion();
              rt.winStage();
            } else {
              renderP2('');
            }
          } else {
            rt.damage(12);
          }
        },
        '마무리 파이썬 코드를 입력하고 Enter...'
      );
    };

    shieldBtn.addEventListener('click', () => {
      if (phase !== 1 || rt.isFinished()) return;
      shieldClicks++;
      audio.hitSuccess();
      const remainPct = Math.max(0, Math.round(((shieldMax - shieldClicks) / shieldMax) * 100));
      hpLabel.textContent = `SHIELD ${remainPct}%`;
      phaseEl.textContent = `BOSS PHASE 1/2 · 보안 감시자 쉴드 광클 파괴 (${shieldClicks} / ${shieldMax})`;
      rt.setProgress((shieldClicks / shieldMax) * 50, `PHASE 1 (${shieldClicks}/${shieldMax})`);

      const img = document.createElement('img');
      img.src = rt.crackPng;
      img.alt = 'Crack';
      img.className = 'absolute inset-0 w-full h-full object-cover opacity-55 pointer-events-none';
      img.style.transform = `rotate(${shieldClicks * 29}deg)`;
      cracksEl.appendChild(img);

      // Escalating glitch vibration proportional to clicks
      const mag = 3 + shieldClicks * 0.45;
      shieldBtn.style.transform = `translate(${((Math.random() - 0.5) * mag * 2).toFixed(1)}px, ${((Math.random() - 0.5) * mag * 2).toFixed(1)}px)`;
      rt.addTimeout(() => {
        shieldBtn.style.transform = '';
      }, 70);

      if (shieldClicks >= shieldMax) {
        audio.explosion();
        enterPhase2();
      }
    });

    rt.setProgress(0, `PHASE 1 (0/${shieldMax})`);
    return;
  }

  // =========================================================================
  // STAGE 25: 일부가 별표(*)로 가려진 파이썬 코드의 원래 문법을 유추해 전체 입력
  // =========================================================================
  if (stageId === 25) {
    const puzzles = [
      {
        masked: 'd** unlock(key):',
        answer: 'def unlock(key):',
        clue: '힌트: 파이썬 함수 선언 예약어 (3글자)',
      },
      {
        masked: 'f** i i* r****(5):',
        answer: 'for i in range(5):',
        clue: '힌트: 0~4까지 5회 반복하는 파이썬 for문',
      },
      {
        masked: 'r***** True',
        answer: 'return True',
        clue: '힌트: 함수에서 참(True) 값을 반환하는 문장',
      },
    ];
    let idx = 0;

    domLayer.innerHTML = `
      <div class="w-full h-full flex items-center justify-center p-6 bg-[#070b12] select-none">
        <div class="w-full max-w-2xl rounded-xl border border-[#00e5ff]/50 bg-[#0d1421] p-7 space-y-5 shadow-[0_0_40px_rgba(0,229,255,0.14)]">
          <div class="flex items-center justify-between border-b border-white/10 pb-3">
            <span class="text-xs font-code font-bold text-[#00e5ff]">MASKED SYNTAX RECOVERY</span>
            <span id="s25-step" class="text-xs font-code text-[#00ff41]">PUZZLE 1 / ${puzzles.length}</span>
          </div>

          <div class="p-5 rounded-lg bg-[#05080f] border border-white/10 text-center space-y-2">
            <div class="text-[11px] font-code text-slate-400">별표(*)로 가려진 파이썬 코드를 완전한 문장으로 복원하세요</div>
            <div id="s25-masked" class="text-2xl sm:text-3xl font-black font-code text-amber-300 tracking-wider"></div>
            <div id="s25-clue" class="text-xs text-[#00e5ff] pt-1"></div>
          </div>

          <div id="s25-msg" class="text-center text-xs font-code text-slate-400 h-5">
            복원한 전체 파이썬 코드를 아래 입력창에 쓰고 Enter를 누르세요.
          </div>
        </div>
      </div>
    `;

    const stepEl = domLayer.querySelector('#s25-step') as HTMLElement;
    const maskedEl = domLayer.querySelector('#s25-masked') as HTMLElement;
    const clueEl = domLayer.querySelector('#s25-clue') as HTMLElement;
    const msgEl = domLayer.querySelector('#s25-msg') as HTMLElement;

    const showPuzzle = () => {
      const p = puzzles[idx];
      stepEl.textContent = `PUZZLE ${idx + 1} / ${puzzles.length}`;
      maskedEl.textContent = p.masked;
      clueEl.textContent = p.clue;
    };
    showPuzzle();
    rt.setProgress(0, `0 / ${puzzles.length}`);

    rt.enableTypingDock(
      () => {},
      (val) => {
        if (rt.isFinished()) return;
        const p = puzzles[idx];
        if (val.trim() === p.answer) {
          audio.hitSuccess();
          idx++;
          cmdInput.value = '';
          rt.setProgress((idx / puzzles.length) * 100, `${idx} / ${puzzles.length}`);
          if (idx >= puzzles.length) {
            msgEl.textContent = '3차 방화벽 문법 복원 완료!';
            msgEl.className = 'text-center text-xs font-code font-bold text-[#00ff41] h-5';
            rt.addTimeout(() => rt.winStage(), 420);
          } else {
            msgEl.textContent = '정답입니다! 다음 마스킹 코드를 복원하세요.';
            msgEl.className = 'text-center text-xs font-code text-[#00ff41] h-5';
            showPuzzle();
          }
        } else {
          rt.damage(12);
          msgEl.textContent = '문법이 일치하지 않습니다! 공백·괄호·콜론(:)까지 정확히 입력해 주세요.';
          msgEl.className = 'text-center text-xs font-code font-bold text-[#ff007f] h-5';
        }
      },
      '복원된 전체 파이썬 코드 입력 후 Enter...'
    );
    return;
  }

  // =========================================================================
  // STAGE 30 (최종 보스전): 4-Phase (광클 쉴드 / 리듬 잠금 / 파이썬 파괴 코드 / 초고속 타이밍 바)
  // 완료 시 기존 해킹 삭제 -> 윈도우 복귀 -> 과제 제출 -> 엔딩 크레딧 즉시 실행!
  // =========================================================================
  let phase = 1;
  let p1Clicks = 0;
  let p2Locks = 0;
  let p3Idx = 0;
  const dirs = [
    { code: 'ArrowLeft', label: '←' },
    { code: 'ArrowUp', label: '↑' },
    { code: 'ArrowDown', label: '↓' },
    { code: 'ArrowRight', label: '→' },
  ];
  let p2Target = dirs[0];
  let timingPos = 0;
  let timingDir = 1;

  domLayer.innerHTML = `
    <div id="s30-bg" class="relative w-full h-full flex flex-col items-center justify-center gap-5 transition-colors duration-500">
      <div id="s30-phase-title" class="text-sm font-black tracking-wider text-[#ff007f]">
        PHASE 1/4 : 방어막 균열 (코어 10회 광클)
      </div>

      <div id="s30-core" class="relative w-48 h-48 rounded-full border-4 border-[#ff007f] bg-[#190812] flex items-center justify-center overflow-hidden cursor-pointer select-none shadow-[0_0_40px_rgba(255,0,127,0.45)]">
        <div id="s30-lava" class="hidden absolute inset-2 lava-wave-core opacity-90"></div>
        <div id="s30-cracks" class="absolute inset-0 pointer-events-none"></div>
        <span class="relative z-10 text-lg font-black text-white">HACK CORE</span>
      </div>

      <div id="s30-p2" class="hidden flex flex-col items-center gap-3">
        <div class="text-sm text-white">리듬 방향키 입력: <span id="s30-dir-prompt" class="text-2xl font-black text-[#00ff41]">${p2Target.label}</span></div>
        <div class="flex gap-3">
          ${[0, 1, 2, 3].map((i) => `<div id="s30-lock-${i}" class="w-12 h-12 rounded border border-white/25 bg-[#22121a] flex items-center justify-center text-lg transition-colors">🔒</div>`).join('')}
        </div>
        <div class="flex gap-2">
          ${dirs.map((d) => `<button data-dir="${d.code}" class="s30-dir-btn cyber-btn px-4 py-2 font-bold cursor-pointer">${d.label}</button>`).join('')}
        </div>
      </div>

      <div id="s30-p3" class="hidden flex flex-col items-center gap-2">
        <div class="text-xs text-amber-300">파이썬 파괴 명령어를 정확히 입력 후 Enter</div>
        <div id="s30-py-code" class="text-2xl font-black font-code text-[#00ff41] px-6 py-2 bg-black/70 border border-[#00ff41]/50 rounded">
          ${PYTHON_DESTROY_CODES[0]}
        </div>
      </div>

      <div id="s30-p4" class="hidden w-full max-w-lg flex flex-col items-center gap-4 px-6">
        <div class="text-sm font-bold text-[#00e5ff]">초고속 타이밍 바 중앙(초록 구간)에서 ENTER!</div>
        <div id="s30-track" class="relative w-full h-10 bg-[#121620] border-2 border-white/30 rounded overflow-hidden">
          <div class="absolute top-0 bottom-0 left-[38%] w-[24%] bg-[#00ff41]/30 border-x-2 border-[#00ff41]"></div>
          <div id="s30-bar-cursor" class="absolute top-0 bottom-0 left-0 w-2.5 bg-[#ff007f] shadow-[0_0_15px_#ff007f] will-change-transform" style="transform:translate3d(0,0,0)"></div>
        </div>
        <button id="s30-enter-btn" class="cyber-btn px-8 py-2.5 text-sm font-bold cursor-pointer">ENTER 셧다운</button>
      </div>

      <div id="s30-shutdown-text" class="hidden text-4xl sm:text-5xl font-black font-code tracking-[0.22em] text-[#00ff41] z-30"></div>
    </div>
  `;

  const bg = domLayer.querySelector('#s30-bg') as HTMLElement;
  const phaseTitle = domLayer.querySelector('#s30-phase-title') as HTMLElement;
  const core = domLayer.querySelector('#s30-core') as HTMLElement;
  const lava = domLayer.querySelector('#s30-lava') as HTMLElement;
  const cracks = domLayer.querySelector('#s30-cracks') as HTMLElement;
  const p2Wrap = domLayer.querySelector('#s30-p2') as HTMLElement;
  const dirPrompt = domLayer.querySelector('#s30-dir-prompt') as HTMLElement;
  const p3Wrap = domLayer.querySelector('#s30-p3') as HTMLElement;
  const pyCodeEl = domLayer.querySelector('#s30-py-code') as HTMLElement;
  const p4Wrap = domLayer.querySelector('#s30-p4') as HTMLElement;
  const barTrack = domLayer.querySelector('#s30-track') as HTMLElement;
  const barCursor = domLayer.querySelector('#s30-bar-cursor') as HTMLElement;
  const shutdownText = domLayer.querySelector('#s30-shutdown-text') as HTMLElement;

  const goPhase2 = () => {
    phase = 2;
    p2Wrap.classList.remove('hidden');
    phaseTitle.textContent = 'PHASE 2/4 : 리듬 자물쇠 해제 (4회)';
    p2Target = dirs[Math.floor(Math.random() * 4)];
    dirPrompt.textContent = p2Target.label;
  };

  const goPhase3 = () => {
    phase = 3;
    p2Wrap.classList.add('hidden');
    p3Wrap.classList.remove('hidden');
    lava.classList.remove('hidden');
    phaseTitle.textContent = 'PHASE 3/4 : 파이썬 파괴 코드 4개 입력';
    pyCodeEl.textContent = PYTHON_DESTROY_CODES[0];
    rt.enableTypingDock((val) => {
      if (phase !== 3) return;
      const target = PYTHON_DESTROY_CODES[p3Idx];
      if (val.trim() === target) {
        audio.explosion();
        cmdInput.value = '';
        p3Idx++;
        rt.setProgress(50 + (p3Idx / PYTHON_DESTROY_CODES.length) * 35, `PHASE 3 (${p3Idx}/4)`);
        if (p3Idx >= PYTHON_DESTROY_CODES.length) {
          goPhase4();
        } else {
          pyCodeEl.textContent = PYTHON_DESTROY_CODES[p3Idx];
        }
      }
    });
  };

  const goPhase4 = () => {
    phase = 4;
    inputDock.classList.add('hidden');
    p3Wrap.classList.add('hidden');
    p4Wrap.classList.remove('hidden');
    phaseTitle.textContent = 'PHASE 4/4 : 초고속 타이밍 바 ENTER 셧다운';
  };

  const executeTimingBar = () => {
    if (phase !== 4 || rt.isFinished()) return;
    if (timingPos >= 38 && timingPos <= 62) {
      rt.setFinished(true);
      rt.setProgress(100);
      audio.powerDown();
      phaseTitle.classList.add('hidden');
      core.classList.add('hidden');
      p4Wrap.classList.add('hidden');
      bg.classList.add('whiteout-flash');
      shutdownText.classList.remove('hidden');

      const msg = 'SYSTEM SHUTDOWN';
      let idx = 0;
      const typeNext = () => {
        if (rt.isDestroyed()) return;
        shutdownText.textContent = msg.slice(0, idx + 1);
        idx++;
        if (idx < msg.length) {
          rt.addTimeout(typeNext, 85);
        } else {
          rt.addTimeout(() => rt.winStage(true, true), 1000);
        }
      };
      rt.addTimeout(typeNext, 450);
    } else {
      rt.damage(12);
    }
  };

  core.addEventListener('click', () => {
    if (phase !== 1 || rt.isFinished()) return;
    p1Clicks++;
    audio.hitSuccess();
    const img = document.createElement('img');
    img.src = rt.crackPng;
    img.alt = 'Crack';
    img.className = 'absolute inset-0 w-full h-full object-cover opacity-75 pointer-events-none';
    img.style.transform = `rotate(${p1Clicks * 37}deg)`;
    cracks.appendChild(img);
    rt.setProgress((p1Clicks / 10) * 25, `PHASE 1 (${p1Clicks}/10)`);
    if (p1Clicks >= 10) goPhase2();
  });

  const handleDir = (code: string) => {
    if (phase !== 2 || rt.isFinished()) return;
    if (code === p2Target.code) {
      const lockEl = domLayer.querySelector(`#s30-lock-${p2Locks}`) as HTMLElement;
      lockEl.style.backgroundColor = '#00ff41';
      lockEl.textContent = '🔓';
      p2Locks++;
      audio.hitSuccess();
      rt.setProgress(25 + (p2Locks / 4) * 25, `PHASE 2 (${p2Locks}/4)`);
      if (p2Locks >= 4) goPhase3();
      else {
        p2Target = dirs[Math.floor(Math.random() * 4)];
        dirPrompt.textContent = p2Target.label;
      }
    } else {
      rt.damage(8);
    }
  };

  domLayer.querySelectorAll('.s30-dir-btn').forEach((b) => {
    b.addEventListener('click', () => handleDir((b as HTMLElement).dataset.dir || ''));
  });
  domLayer.querySelector('#s30-enter-btn')!.addEventListener('click', executeTimingBar);

  rt.onKey((e) => {
    if (phase === 2 && ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      handleDir(e.code);
    } else if (phase === 4 && e.key === 'Enter') {
      e.preventDefault();
      executeTimingBar();
    }
  });

  let last = 0;
  const loop = (now: number) => {
    if (rt.isDestroyed() || rt.isFinished()) return;
    if (last === 0) last = now;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (phase === 4) {
      timingPos += timingDir * 175 * dt;
      if (timingPos >= 97) {
        timingPos = 97;
        timingDir = -1;
      } else if (timingPos <= 0) {
        timingPos = 0;
        timingDir = 1;
      }
      const trackW = barTrack.clientWidth || 460;
      barCursor.style.transform = `translate3d(${((timingPos / 100) * trackW).toFixed(1)}px, 0, 0)`;
    }
    rt.setRaf(loop);
  };
  rt.setRaf(loop);
  rt.setProgress(0, 'PHASE 1 (0/10)');
}
