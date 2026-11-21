import { audio } from '../audio';
import { PYTHON_WORDS } from '../data/stages';
import { StageRuntime } from './types';

type TypingMode =
  | 'basic'      // Stage 1: slow falling basic Python words + particle explosion
  | 'fade'       // Stage 6: periodic fade in/out opacity
  | 'anagram'    // Stage 9: scrambled letters -> deduce original Python keyword
  | 'dual'       // Stage 12: left & right dual-thread simultaneous fast fall
  | 'filter'     // Stage 16: shoot green Python keywords, avoid red error traps
  | 'warp'       // Stage 21: radial speed lines + 3x fast fall
  | 'reverse'    // Stage 28: reverse gravity (bottom -> top)
  | 'shake';     // Stage 29: continuous screen shake

const BASIC_WORDS = ['if', 'for', 'def', 'len', 'int', 'str', 'print', 'return', 'import', 'while', 'True', 'False', 'range', 'class', 'elif', 'None'];
const ANAGRAM_WORDS = ['def', 'for', 'len', 'int', 'str', 'try', 'list', 'dict', 'pass', 'elif', 'with', 'True', 'None', 'print', 'while', 'class', 'range', 'yield'];
const FAST_WORDS = ['if', 'in', 'is', 'or', 'as', 'def', 'for', 'len', 'int', 'str', 'try', 'not', 'and', 'del', 'abs', 'map', 'zip', 'set', 'sum', 'max'];
const TRAP_WORDS = ['ERR404', 'CRASH!', 'MALWARE', 'TROJAN', 'BUG_99', 'CORRUPT', 'VIRUS', 'NULL_X', 'SYNTAX!', 'HACKED'];

function scrambleWord(word: string): string {
  const chars = word.split('');
  if (chars.length <= 2) return chars.reverse().join('');
  for (let attempt = 0; attempt < 12; attempt++) {
    const arr = [...chars];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const result = arr.join('');
    if (result.toLowerCase() !== word.toLowerCase()) return result;
  }
  // Guaranteed derangement fallback: rotate by 1
  return word.slice(1) + word[0];
}

export function runTypingEngine(rt: StageRuntime): void {
  const modeMap: Record<number, TypingMode> = {
    1: 'basic',
    6: 'fade',
    9: 'anagram',
    12: 'dual',
    16: 'filter',
    21: 'warp',
    28: 'reverse',
    29: 'shake',
  };
  const mode = modeMap[rt.stageId] || 'basic';

  interface TypingPacket {
    word: string;       // exact word to type
    display: string;    // what is drawn (same as word except anagram)
    x: number;
    y: number;
    vx: number;
    speed: number;
    isTrap: boolean;
    lane: 0 | 1;
    phase: number;
    trail: Array<{ x: number; y: number }>;
  }

  interface WarpLine {
    angle: number;
    dist: number;
    speed: number;
    len: number;
  }

  const goalByMode: Record<TypingMode, number> = {
    basic: 8,
    fade: 8,
    anagram: 6,
    dual: 10,
    filter: 8,
    warp: 8,
    reverse: 8,
    shake: 8,
  };
  const goal = goalByMode[mode];
  const packets: TypingPacket[] = [];
  let cleared = 0;
  let spawnCooldown = 0;
  let elapsed = 0;
  let trapStreak = 0;

  // Radial speed lines for Stage 21 (warp)
  const warpLines: WarpLine[] =
    mode === 'warp'
      ? Array.from({ length: 48 }, () => ({
          angle: Math.random() * Math.PI * 2,
          dist: 30 + Math.random() * 480,
          speed: 380 + Math.random() * 420,
          len: 28 + Math.random() * 64,
        }))
      : [];

  // Cleanup screen shake transform if Stage 29
  if (mode === 'shake') {
    rt.addCleanup(() => {
      rt.arenaWrap.style.transform = '';
    });
  }

  const pickUniqueWord = (pool: string[]): string => {
    const activeWords = new Set(packets.map((p) => p.word.toLowerCase()));
    const candidates = pool.filter((w) => !activeWords.has(w.toLowerCase()));
    const list = candidates.length > 0 ? candidates : pool;
    return list[Math.floor(Math.random() * list.length)];
  };

  const spawnOne = (forcedLane?: 0 | 1) => {
    const { w, h } = rt.getSize();
    const maxPackets = mode === 'dual' ? 4 : mode === 'warp' ? 2 : mode === 'filter' ? 4 : 3;
    if (packets.length >= maxPackets) return;

    const lane: 0 | 1 =
      forcedLane !== undefined
        ? forcedLane
        : Math.random() < 0.5
        ? 0
        : 1;

    let isTrap = false;
    if (mode === 'filter') {
      const greenCount = packets.filter((p) => !p.isTrap).length;
      if (greenCount > 0 && trapStreak < 2 && Math.random() < 0.36) {
        isTrap = true;
        trapStreak++;
      } else {
        trapStreak = 0;
      }
    }

    let word = '';
    if (isTrap) {
      word = pickUniqueWord(TRAP_WORDS);
    } else if (mode === 'basic') {
      word = pickUniqueWord(BASIC_WORDS);
    } else if (mode === 'anagram') {
      word = pickUniqueWord(ANAGRAM_WORDS);
    } else if (mode === 'warp') {
      word = pickUniqueWord(FAST_WORDS);
    } else {
      word = pickUniqueWord(PYTHON_WORDS);
    }

    const display = mode === 'anagram' ? scrambleWord(word) : word;

    let x = 95 + Math.random() * Math.max(160, w - 190);
    if (mode === 'dual') {
      const half = w / 2;
      x =
        lane === 0
          ? 75 + Math.random() * Math.max(80, half - 140)
          : half + 75 + Math.random() * Math.max(80, half - 140);
    }

    const baseSpeedMap: Record<TypingMode, [number, number]> = {
      basic: [48, 22],
      fade: [54, 20],
      anagram: [36, 14],
      dual: [86, 26],
      filter: [64, 22],
      warp: [148, 34], // ~3x basic speed
      reverse: [68, 22],
      shake: [62, 22],
    };
    const [baseSpd, randSpd] = baseSpeedMap[mode];
    const speed = baseSpd + Math.random() * randSpd;
    const startY = mode === 'reverse' ? h - 32 : 34;

    packets.push({
      word,
      display,
      x,
      y: startY,
      vx: mode === 'shake' ? (Math.random() - 0.5) * 34 : 0,
      speed,
      isTrap,
      lane,
      phase: Math.random() * Math.PI * 2,
      trail: [],
    });
  };

  // Initial spawn
  if (mode === 'dual') {
    spawnOne(0);
    spawnOne(1);
  } else {
    spawnOne();
    if (mode === 'filter') spawnOne();
  }

  // Optional mode badge overlay in DOM layer (non-blocking)
  const modeHintText: Record<TypingMode, string> = {
    basic: '하단 초록 방어선 도달 전 파이썬 단어를 타이핑해 격추하세요',
    fade: '주기적으로 투명해지는(FADE) 단어를 기억해 타이핑하세요',
    anagram: '뒤섞인 철자를 보고 원래 파이썬 키워드를 유추해 입력하세요',
    dual: 'LEFT / RIGHT 다중 스레드에서 동시에 낙하하는 단어를 요격하세요',
    filter: '초록색 정상 키워드만 입력! 붉은색 [TRAP] 단어는 치지 말고 피하세요',
    warp: 'WARP 3X 초고속 낙하! 짧은 파이썬 키워드를 즉시 타이핑하세요',
    reverse: '역중력 반전! 아래에서 상단 방어선으로 치솟는 패킷을 격추하세요',
    shake: '연속 지진(SCREEN SHAKE) 발생 중! 흔들리는 단어를 끝까지 격추하세요',
  };

  rt.domLayer.innerHTML = `
    <div class="pointer-events-none absolute top-2.5 left-1/2 -translate-x-1/2 px-4 py-1 rounded bg-black/65 border border-white/10 text-[11px] font-code text-slate-300 tracking-wide whitespace-nowrap">
      ${modeHintText[mode]}
    </div>
  `;

  const evaluateInput = (raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return;

    // Check trap hit first in filter mode
    if (mode === 'filter') {
      const trapIdx = packets.findIndex((p) => p.isTrap && p.word.toLowerCase() === q);
      if (trapIdx !== -1) {
        const tp = packets[trapIdx];
        rt.spawnBurst(tp.x, tp.y, 26, '#ff007f', '#ff3333');
        packets.splice(trapIdx, 1);
        rt.cmdInput.value = '';
        rt.damage(18);
        return;
      }
    }

    const idx = packets.findIndex((p) => !p.isTrap && p.word.toLowerCase() === q);
    if (idx !== -1) {
      const p = packets[idx];
      rt.spawnBurst(p.x, p.y, 34, '#00ff41', '#00e5ff');
      packets.splice(idx, 1);
      rt.cmdInput.value = '';
      cleared++;
      audio.explosion();
      rt.setProgress((cleared / goal) * 100, `${cleared} / ${goal}`);
      if (cleared >= goal) {
        rt.winStage();
      } else if (mode === 'dual') {
        spawnOne(p.lane);
      } else {
        spawnOne();
      }
    }
  };

  rt.enableTypingDock(
    (val) => evaluateInput(val),
    (val) => {
      evaluateInput(val);
      if (rt.cmdInput.value.trim().length > 0) {
        rt.cmdInput.value = '';
      }
    },
    mode === 'anagram'
      ? '원래 파이썬 키워드를 유추해 입력하세요...'
      : '낙하하는 파이썬 키워드를 타이핑하세요...'
  );

  const spawnIntervalMap: Record<TypingMode, number> = {
    basic: 1.5,
    fade: 1.45,
    anagram: 2.2,
    dual: 1.15,
    filter: 1.2,
    warp: 1.0,
    reverse: 1.35,
    shake: 1.35,
  };
  const spawnInterval = spawnIntervalMap[mode];

  let last = performance.now();
  const loop = (now: number) => {
    if (rt.isDestroyed() || rt.isFinished()) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    elapsed += dt;

    const { w, h } = rt.getSize();
    const ctx = rt.ctx;

    // Continuous Screen Shake for Stage 29
    if (mode === 'shake') {
      const sx = Math.sin(elapsed * 37) * 5 + (Math.random() - 0.5) * 6;
      const sy = Math.cos(elapsed * 43) * 4 + (Math.random() - 0.5) * 5;
      rt.arenaWrap.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
    }

    spawnCooldown += dt;
    if (spawnCooldown >= spawnInterval) {
      spawnCooldown = 0;
      if (mode === 'dual') {
        spawnOne(0);
        spawnOne(1);
      } else {
        spawnOne();
      }
    }

    // Background clear
    ctx.fillStyle = mode === 'warp' ? '#040712' : '#07090d';
    ctx.fillRect(0, 0, w, h);

    // Stage 21 radial warp speed lines
    if (mode === 'warp') {
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy) + 80;
      ctx.lineWidth = 1.6;
      for (const wl of warpLines) {
        wl.dist += wl.speed * dt;
        if (wl.dist > maxR) {
          wl.dist = 18 + Math.random() * 40;
          wl.angle = Math.random() * Math.PI * 2;
        }
        const x1 = cx + Math.cos(wl.angle) * wl.dist;
        const y1 = cy + Math.sin(wl.angle) * wl.dist;
        const x2 = cx + Math.cos(wl.angle) * (wl.dist + wl.len);
        const y2 = cy + Math.sin(wl.angle) * (wl.dist + wl.len);
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.28)';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    // Stage 12 dual thread divider
    if (mode === 'dual') {
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.setLineDash([8, 8]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 11px "Fira Code", monospace';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.55)';
      ctx.textAlign = 'center';
      ctx.fillText('THREAD_A // LEFT', w * 0.25, 52);
      ctx.fillText('THREAD_B // RIGHT', w * 0.75, 52);
      ctx.restore();
    }

    // Defense Line (Top for reverse gravity Stage 28, Bottom for others)
    const lineY = mode === 'reverse' ? 48 : h - 34;
    ctx.strokeStyle = mode === 'reverse' ? '#00e5ff' : '#00ff41';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(w, lineY);
    ctx.stroke();

    ctx.font = 'bold 16px "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = packets.length - 1; i >= 0; i--) {
      const p = packets[i];
      if (mode === 'reverse') {
        p.y -= p.speed * dt;
        p.trail.push({ x: p.x, y: p.y + 14 });
        if (p.trail.length > 12) p.trail.shift();
      } else {
        p.y += p.speed * dt;
      }

      if (mode === 'shake') {
        p.x += p.vx * dt;
        if (p.x < 80 || p.x > w - 80) p.vx *= -1;
      }

      // Draw reverse gravity comet trail (Stage 28)
      if (mode === 'reverse' && p.trail.length > 1) {
        for (let t = 0; t < p.trail.length; t++) {
          const pt = p.trail[t];
          const alpha = (t / p.trail.length) * 0.45;
          ctx.fillStyle = `rgba(0, 229, 255, ${alpha.toFixed(2)})`;
          ctx.fillRect(pt.x - 4, pt.y + (p.trail.length - t) * 2.5, 8, 5);
        }
      }

      // Compute opacity for Stage 6 (Fade)
      let packetAlpha = 1;
      if (mode === 'fade') {
        packetAlpha = 0.08 + 0.92 * Math.pow(0.5 + 0.5 * Math.sin(elapsed * 3.1 + p.phase), 1.6);
      }

      const distToLine = mode === 'reverse' ? p.y - lineY : lineY - p.y;
      const nearZone = !p.isTrap && distToLine <= 80;

      ctx.save();
      ctx.globalAlpha = packetAlpha;

      const boxW = Math.max(118, p.display.length * 13 + 34);
      const boxH = mode === 'anagram' ? 42 : 34;

      if (p.isTrap) {
        ctx.fillStyle = 'rgba(56, 8, 22, 0.92)';
        ctx.strokeStyle = '#ff1744';
      } else if (nearZone) {
        ctx.fillStyle = 'rgba(42, 10, 26, 0.92)';
        ctx.strokeStyle = '#ff007f';
      } else {
        ctx.fillStyle = 'rgba(13, 22, 32, 0.92)';
        ctx.strokeStyle = mode === 'reverse' ? '#00e5ff' : '#00ff41';
      }
      ctx.lineWidth = 1.8;
      ctx.fillRect(p.x - boxW / 2, p.y - boxH / 2, boxW, boxH);
      ctx.strokeRect(p.x - boxW / 2, p.y - boxH / 2, boxW, boxH);

      if (p.isTrap) {
        ctx.fillStyle = '#ff5277';
        ctx.font = 'bold 15px "Fira Code", monospace';
        ctx.fillText(p.display, p.x, p.y - 3);
        ctx.font = 'bold 9px "Fira Code", monospace';
        ctx.fillStyle = '#ff8fa3';
        ctx.fillText('TRAP · AVOID', p.x, p.y + 11);
      } else if (mode === 'anagram') {
        ctx.fillStyle = nearZone ? '#ff80bf' : '#ffd166';
        ctx.font = 'bold 17px "Fira Code", monospace';
        ctx.fillText(p.display.split('').join(' '), p.x, p.y - 5);
        ctx.font = '10px "Fira Code", monospace';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${p.word.length}글자 · 시작: ${p.word[0]}`, p.x, p.y + 13);
      } else {
        ctx.fillStyle = nearZone ? '#ff80bf' : mode === 'reverse' ? '#7df9ff' : '#00ff41';
        ctx.font = 'bold 16px "Fira Code", monospace';
        ctx.fillText(p.display, p.x, p.y);
      }
      ctx.restore();

      const crossed = mode === 'reverse' ? p.y <= lineY : p.y >= lineY;
      if (crossed) {
        packets.splice(i, 1);
        if (p.isTrap) {
          // Safe pass for trap words!
          rt.spawnBurst(p.x, lineY, 10, '#64748b', '#94a3b8');
        } else {
          rt.spawnBurst(p.x, lineY, 18, '#ff007f', '#ff5555');
          rt.damage(18);
          if (mode === 'dual') spawnOne(p.lane);
          else spawnOne();
        }
      }
    }

    rt.updateAndDrawParticles(dt);
    rt.setRaf(loop);
  };

  rt.setRaf(loop);
  rt.setProgress(0, `0 / ${goal}`);
}
