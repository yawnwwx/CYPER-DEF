import { audio } from './audio';
import { NotebookCategory, PYTHON_NOTEBOOK_ENTRIES, STAGES } from './data/stages';
import { formatPlayTime, RankRecord, submitClearRecord, subscribeGlobalRankings } from './rankingService';
import { DeveloperRoom3D, RoomInteractTarget } from './room3d';
import { StageGameEngine } from './stageEngine';

type SceneId = 'boot' | 'menu' | 'room' | 'os' | 'stage-select' | 'game' | 'ending' | 'standby';

interface PythonProgress {
  unlocked: number;
  cleared: number[];
  hasBeenHacked: boolean;
}

const STORAGE_KEY = 'cyberdef_clear_data_v2';

function loadProgress(): PythonProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PythonProgress;
      if (parsed && typeof parsed.unlocked === 'number' && Array.isArray(parsed.cleared)) {
        const uniqueCleared = Array.from(
          new Set(
            parsed.cleared.filter(
              (id): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 1 && id <= 30
            )
          )
        ).sort((a, b) => a - b);
        const highestCleared = uniqueCleared.length > 0 ? uniqueCleared[uniqueCleared.length - 1] : 0;
        const derivedUnlocked = Math.min(30, Math.max(1, highestCleared + 1));
        return {
          unlocked: derivedUnlocked,
          cleared: uniqueCleared,
          hasBeenHacked: Boolean(parsed.hasBeenHacked),
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return {
    unlocked: 1,
    cleared: [],
    hasBeenHacked: false,
  };
}

function saveProgress(state: PythonProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage quota errors
  }
}

const SVG_EDGE = `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow-md">
  <defs>
    <linearGradient id="edgeA" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0078d4"/><stop offset="100%" stop-color="#003a70"/></linearGradient>
    <linearGradient id="edgeB" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#43e97b"/><stop offset="100%" stop-color="#00b4d8"/></linearGradient>
  </defs>
  <circle cx="32" cy="32" r="26" fill="url(#edgeA)"/>
  <path d="M12 34c2-14 16-23 30-20 10 2 16 10 15 18-1 6-6 9-14 9H25c1 7 7 12 15 12 6 0 11-2 14-5-4 8-13 13-23 13-13 0-22-11-19-27z" fill="url(#edgeB)"/>
  <circle cx="35" cy="32" r="8" fill="#0f172a"/>
</svg>`;

const SVG_CHROME = `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow-md">
  <circle cx="32" cy="32" r="26" fill="#fff"/>
  <path d="M32 6a26 26 0 0 1 22.5 13H32a13 13 0 0 0-11.2 6.5L10.5 14A26 26 0 0 1 32 6z" fill="#ea4335"/>
  <path d="M54.5 19A26 26 0 0 1 32 58l11.2-19.5A13 13 0 0 0 32 19h22.5z" fill="#fbbc05"/>
  <path d="M32 58A26 26 0 0 1 10.5 14l10.3 11.5A13 13 0 0 0 43.2 38.5L32 58z" fill="#34a853"/>
  <circle cx="32" cy="32" r="10.5" fill="#1a73e8" stroke="#fff" stroke-width="3"/>
</svg>`;

const SVG_TRASH = `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow-md">
  <defs><linearGradient id="binG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#cbd5e1"/><stop offset="100%" stop-color="#64748b"/></linearGradient></defs>
  <rect x="16" y="16" width="32" height="40" rx="5" fill="url(#binG)" stroke="#e2e8f0" stroke-width="2"/>
  <rect x="12" y="11" width="40" height="6" rx="3" fill="#e2e8f0"/>
  <rect x="25" y="7" width="14" height="4" rx="2" fill="#94a3b8"/>
  <line x1="25" y1="24" x2="25" y2="48" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
  <line x1="32" y1="24" x2="32" y2="48" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
  <line x1="39" y1="24" x2="39" y2="48" stroke="#334155" stroke-width="3" stroke-linecap="round"/>
</svg>`;

const SVG_FOLDER = `<svg viewBox="0 0 64 64" class="w-12 h-12 drop-shadow-md">
  <defs><linearGradient id="fldG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fde047"/><stop offset="100%" stop-color="#eab308"/></linearGradient></defs>
  <path d="M8 14a4 4 0 0 1 4-4h14l5 6h21a4 4 0 0 1 4 4v30a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4V14z" fill="#ca8a04"/>
  <rect x="8" y="20" width="48" height="34" rx="4" fill="url(#fldG)"/>
</svg>`;

export function initCyberDef(root: HTMLElement): void {
  let progress = loadProgress();
  let currentScene: SceneId = 'boot';
  let room3d: DeveloperRoom3D | null = null;
  let stageEngine: StageGameEngine | null = null;
  let osSequenceStarted = false;
  let sessionHacked = false;
  let isSystemRestored = false;
  let osTimers: number[] = [];
  let endingTimer = 0;
  let dialogueHideTimer = 0;

  root.innerHTML = `
    <div id="cyberdef-app" class="relative w-full h-full bg-[#0a0b0e] overflow-hidden">

      <!-- MAIN MENU EXCLUSIVE BGM (M4A): 첨부 음원 파일 경로를 연결해 메인 메뉴에서만 반복 재생 -->
      <audio id="main-menu-bgm" loop preload="auto">
        <source src="/assets/aistudio/System_Override_61b3c393.m4a" type="audio/mp4" />
      </audio>

      <!-- IN-GAME EXCLUSIVE BGM (M4A): 해킹 게임 진입 ~ 30단계 클리어 전까지 반복 재생 (파일 경로 교체 가능) -->
      <audio id="ingame-bgm" loop preload="auto">
        <source src="/assets/aistudio/Neon_Cyberdrive_ad9600c7.m4a" type="audio/mp4" />
      </audio>

      <!-- ALWAYS EXPOSED FIXED RETURN TO ROOM BUTTON -->
      <button id="fixed-return-room-btn" class="fixed-return-btn" title="방으로 돌아가기">
        <span>방으로 돌아가기</span>
      </button>

      <!-- BOTTOM-LEFT FLOATING SETTINGS GEAR BUTTON (Visible after START: room, os, stage-select, game) -->
      <button id="floating-settings-btn" type="button" class="floating-settings-btn" title="환경 설정 (SETTINGS)" aria-label="환경 설정 열기">
        <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      <!-- IN-GAME PAUSE & 3-2-1 RESUME COUNTDOWN OVERLAY -->
      <div id="game-pause-overlay" class="hidden fixed inset-0 z-[9995] bg-black/80 flex-col items-center justify-center select-none">
        <div class="absolute top-14 left-1/2 -translate-x-1/2 px-7 py-2 rounded-md border border-[#00ff41]/70 bg-[#05140b]/90 shadow-[0_0_28px_rgba(0,255,65,0.45)]">
          <span class="text-xl sm:text-2xl font-black font-code tracking-[0.35em] text-[#00ff41] drop-shadow-[0_0_10px_rgba(0,255,65,0.85)]">PAUSED</span>
        </div>
        <div id="pause-countdown-wrap" class="hidden flex-col items-center gap-3">
          <div id="pause-countdown-num" class="text-8xl sm:text-9xl font-black font-code text-[#00ff41] drop-shadow-[0_0_32px_rgba(0,255,65,0.85)] tabular-nums">3</div>
          <div class="text-xs sm:text-sm font-code tracking-[0.22em] text-slate-300">잠시 후 게임을 재개합니다...</div>
        </div>
      </div>

      <!-- GLOBAL SETTINGS MODAL (Shared across Main Menu & In-Game via z-10000) -->
      <div id="settings-modal" class="hidden fixed inset-0 z-[10000] bg-black/80 items-center justify-center p-4">
        <div class="w-full max-w-md rounded-lg border border-[#00ff41]/55 bg-[#0b0f17]/95 p-6 flex flex-col gap-5 shadow-[0_0_40px_rgba(0,255,65,0.22)]">
          <div class="flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <div class="text-[11px] font-code text-[#00ff41] tracking-widest">SYSTEM CONFIG</div>
              <h2 class="text-lg font-bold text-white">SETTINGS</h2>
            </div>
            <button id="btn-close-settings" type="button" class="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded border border-white/10 cursor-pointer">닫기 [ESC]</button>
          </div>

          <div class="space-y-4 text-xs">
            <label class="block space-y-2">
              <div class="flex items-center justify-between text-slate-200 font-semibold">
                <span>효과음 볼륨 (SFX)</span>
                <span id="val-sfx" class="font-code text-[#00ff41] tabular-nums">80%</span>
              </div>
              <input id="slider-sfx" type="range" min="0" max="100" value="80" class="cyber-range" />
            </label>

            <label class="block space-y-2">
              <div class="flex items-center justify-between text-slate-200 font-semibold">
                <span>배경음 볼륨 (BGM)</span>
                <span id="val-bgm" class="font-code text-[#00ff41] tabular-nums">35%</span>
              </div>
              <input id="slider-bgm" type="range" min="0" max="100" value="35" class="cyber-range" />
            </label>

            <label class="block space-y-2">
              <div class="flex items-center justify-between text-slate-200 font-semibold">
                <span>마우스 시점 감도 (SENSITIVITY)</span>
                <span id="val-sensitivity" class="font-code text-[#00ff41] tabular-nums">1.0x</span>
              </div>
              <input id="slider-sensitivity" type="range" min="0.4" max="2.0" step="0.1" value="1.0" class="cyber-range" />
            </label>
          </div>

          <div class="border-t border-white/10 pt-4 flex items-center justify-between gap-3">
            <button id="btn-reset-save" type="button" class="cyber-btn cyber-btn-pink px-4 py-2 text-xs font-bold cursor-pointer">
              저장된 진행 데이터 초기화
            </button>
            <span id="settings-reset-msg" class="text-[11px] text-[#00ff41] font-medium"></span>
          </div>
        </div>
      </div>

      <!-- 1. LINUX BOOT LOADING SEQUENCE (1.5s SCROLL + GLITCH -> MENU) -->
      <section id="scene-boot" class="cyber-scene active boot-scanlines flex-col justify-end bg-black text-[#00ff41] font-code px-6 py-8 sm:px-12 overflow-hidden">
        <div id="boot-log-stream" class="relative z-10 w-full max-w-4xl text-xs sm:text-sm leading-relaxed space-y-1"></div>
      </section>

      <!-- 2. MAIN TITLE SCREEN WITH CYBERPUNK HUD MENU -->
      <section id="scene-menu" class="cyber-scene menu-artwork-bg relative overflow-hidden">
        <!-- Title-Only Background Glitch Overlay Layers (Strictly CYBER-DEF Logo Region) -->
        <div class="title-glitch-layer title-glitch-1" aria-hidden="true"></div>
        <div class="title-glitch-layer title-glitch-2" aria-hidden="true"></div>

        <!-- Cyberpunk Chamfered HUD Menu Container -->
        <nav id="main-menu-container" aria-label="Main Menu">
          <div class="hud-glass-bg" aria-hidden="true"></div>

          <!-- Inline SVG Neon Chamfered Frame + Corner Brackets + Bottom-Right Slashes -->
          <svg class="hud-frame-svg" viewBox="0 0 360 264" preserveAspectRatio="none" aria-hidden="true">
            <!-- Outer Chamfered Neon Border -->
            <polygon
              points="18,1.5 342,1.5 358.5,18 358.5,246 342,262.5 18,262.5 1.5,246 1.5,18"
              fill="none"
              stroke="#00FF41"
              stroke-width="1.5"
              stroke-opacity="0.72"
              vector-effect="non-scaling-stroke"
            />
            <!-- Subtle Inner Technical Hairline -->
            <polygon
              points="21,6 339,6 354,21 354,243 339,258 21,258 6,243 6,21"
              fill="none"
              stroke="#00FF41"
              stroke-width="0.75"
              stroke-opacity="0.24"
              vector-effect="non-scaling-stroke"
            />

            <!-- Thick Corner Brackets (ㄱ, ㄴ Chamfered Reinforcements) -->
            <!-- Top-Left Bracket -->
            <polyline
              points="2,46 2,18 18,2 56,2"
              fill="none"
              stroke="#00FF41"
              stroke-width="3.6"
              stroke-linecap="square"
              vector-effect="non-scaling-stroke"
            />
            <line x1="68" y1="2.5" x2="108" y2="2.5" stroke="#00FF41" stroke-width="2.5" stroke-opacity="0.85" vector-effect="non-scaling-stroke" />

            <!-- Top-Right Bracket -->
            <polyline
              points="304,2 342,2 358,18 358,46"
              fill="none"
              stroke="#00FF41"
              stroke-width="3.6"
              stroke-linecap="square"
              vector-effect="non-scaling-stroke"
            />
            <line x1="252" y1="2.5" x2="292" y2="2.5" stroke="#00FF41" stroke-width="2.5" stroke-opacity="0.85" vector-effect="non-scaling-stroke" />

            <!-- Bottom-Left Bracket + Wide Glowing Base Accent -->
            <polyline
              points="2,218 2,246 18,262 74,262"
              fill="none"
              stroke="#00FF41"
              stroke-width="4"
              stroke-linecap="square"
              vector-effect="non-scaling-stroke"
            />
            <polygon points="18,258 66,258 72,263 14,263" fill="#00FF41" fill-opacity="0.92" />

            <!-- Bottom-Right Bracket -->
            <polyline
              points="318,262 342,262 358,246 358,218"
              fill="none"
              stroke="#00FF41"
              stroke-width="3.6"
              stroke-linecap="square"
              vector-effect="non-scaling-stroke"
            />

            <!-- Bottom-Right Cyberpunk Diagonal Slash Decorations -->
            <g fill="#00FF41" fill-opacity="0.88">
              <polygon points="274,260 280,250 285,250 279,260" />
              <polygon points="284,260 290,250 295,250 289,260" />
              <polygon points="294,260 300,250 305,250 299,260" />
              <polygon points="304,260 310,250 315,250 309,260" />
              <polygon points="314,260 320,250 325,250 319,260" />
            </g>
          </svg>

          <!-- 4 Aligned HUD Buttons -->
          <div class="hud-menu-list">
            <button id="btn-start" type="button" class="hud-menu-btn hud-menu-btn-start">
              <svg class="hud-start-border" viewBox="0 0 328 52" preserveAspectRatio="none" aria-hidden="true">
                <polygon
                  points="10,1 318,1 327,10 327,42 318,51 10,51 1,42 1,10"
                  fill="none"
                  stroke="#00FF41"
                  stroke-width="1.2"
                  stroke-opacity="0.65"
                  vector-effect="non-scaling-stroke"
                />
              </svg>
              <span class="hud-btn-icon hud-btn-icon-start" aria-hidden="true">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor">
                  <path d="M6.5 4.2a1 1 0 0 1 1.52-.85l12.2 7.8a1 1 0 0 1 0 1.7l-12.2 7.8A1 1 0 0 1 6.5 19.8V4.2z" />
                </svg>
              </span>
              <span class="hud-btn-label">START</span>
            </button>

            <div class="hud-divider" aria-hidden="true"></div>

            <button id="btn-settings" type="button" class="hud-menu-btn">
              <span class="hud-btn-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </span>
              <span class="hud-btn-label">SETTINGS</span>
            </button>

            <div class="hud-divider" aria-hidden="true"></div>

            <button id="btn-howto" type="button" class="hud-menu-btn">
              <span class="hud-btn-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M2 5.5A2.5 2.5 0 0 1 4.5 3H10a3 3 0 0 1 2 1 3 3 0 0 1 2-1h5.5A2.5 2.5 0 0 1 22 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14a2.5 2.5 0 0 0-2 1 2.5 2.5 0 0 0-2-1H3.5A1.5 1.5 0 0 1 2 18.5v-13z" />
                  <line x1="12" y1="4" x2="12" y2="21" />
                  <line x1="5.5" y1="8" x2="9" y2="8" />
                  <line x1="5.5" y1="11.5" x2="9" y2="11.5" />
                  <line x1="15" y1="8" x2="18.5" y2="8" />
                  <line x1="15" y1="11.5" x2="18.5" y2="11.5" />
                </svg>
              </span>
              <span class="hud-btn-label">HOW TO PLAY</span>
            </button>

            <div class="hud-divider" aria-hidden="true"></div>

            <button id="btn-quit" type="button" class="hud-menu-btn">
              <span class="hud-btn-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" />
                  <path d="M16 16l4-4-4-4" />
                  <line x1="20" y1="12" x2="9" y2="12" />
                </svg>
              </span>
              <span class="hud-btn-label">QUIT</span>
            </button>
          </div>
        </nav>

        <!-- HOW TO PLAY MODAL -->
        <div id="howto-modal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-md items-center justify-center p-4">
          <div class="w-full max-w-lg rounded-lg border border-[#00ff41]/55 bg-[#0b0f17]/95 p-6 flex flex-col gap-5 shadow-[0_0_40px_rgba(0,255,65,0.22)]">
            <div class="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <div class="text-[11px] font-code text-[#00ff41] tracking-widest">MANUAL</div>
                <h2 class="text-lg font-bold text-white">HOW TO PLAY</h2>
              </div>
              <button id="btn-close-howto" type="button" class="text-xs text-slate-400 hover:text-white px-2.5 py-1 rounded border border-white/10 cursor-pointer">닫기 [ESC]</button>
            </div>

            <div class="space-y-3 text-xs text-slate-200 leading-relaxed">
              <div class="p-3 rounded bg-white/5 border border-white/10 flex items-center justify-between gap-4">
                <span class="font-code font-bold text-[#00ff41] shrink-0">W A S D</span>
                <span class="text-slate-300 text-right">방 안에서 앞·뒤·좌·우로 이동합니다.</span>
              </div>
              <div class="p-3 rounded bg-white/5 border border-white/10 flex items-center justify-between gap-4">
                <span class="font-code font-bold text-[#00ff41] shrink-0">마우스 회전</span>
                <span class="text-slate-300 text-right">화면을 클릭하거나 드래그하여 1인칭 시점을 둘러봅니다.</span>
              </div>
              <div class="p-3 rounded bg-white/5 border border-white/10 flex items-center justify-between gap-4">
                <span class="font-code font-bold text-[#00ff41] shrink-0">E (근접 상호작용)</span>
                <span class="text-slate-300 text-right">컴퓨터, 파이썬 수첩, 문, 창문 가까이로 이동한 뒤 눌러 상호작용합니다.</span>
              </div>
              <div class="p-3 rounded bg-white/5 border border-white/10 flex items-center justify-between gap-4">
                <span class="font-code font-bold text-[#00ff41] shrink-0">ESC / 방으로 돌아가기</span>
                <span class="text-slate-300 text-right">OS·스테이지·게임 진행 중 언제든 방으로 돌아오거나 창을 닫습니다.</span>
              </div>
              <p class="pt-1 text-[11px] text-slate-400">
                침대에서 일어나 책상 위 컴퓨터를 켜면 해커의 침입이 시작됩니다. 파이썬 30단계 보안 프로토콜을 순차 돌파하여 시스템을 셧다운하세요.
              </p>
            </div>
          </div>
        </div>

        <!-- QUIT CONFIRMATION MODAL -->
        <div id="quit-modal" class="hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-md items-center justify-center p-4">
          <div class="w-full max-w-sm rounded-lg border border-[#ff007f]/60 bg-[#0b0f17]/95 p-6 flex flex-col gap-5 text-center shadow-[0_0_40px_rgba(255,0,127,0.25)]">
            <div class="text-[11px] font-code text-[#ff007f] tracking-widest">POWER CONTROL</div>
            <p class="text-base font-bold text-white">시스템을 종료하시겠습니까?</p>
            <div class="flex items-center justify-center gap-3 pt-1">
              <button id="btn-confirm-quit" type="button" class="cyber-btn cyber-btn-pink px-6 py-2.5 text-xs font-bold cursor-pointer">
                확인 (종료)
              </button>
              <button id="btn-cancel-quit" type="button" class="cyber-btn px-6 py-2.5 text-xs font-bold cursor-pointer">
                취소
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- 1. BRIGHT 3D DEVELOPER ROOM -->
      <section id="scene-room" class="cyber-scene bg-[#dbeafe]">
        <div id="room-canvas-mount" class="absolute inset-0 w-full h-full"></div>

        <!-- Top Controls Hint -->
        <div class="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
          <div class="px-4 py-2 rounded-md bg-[rgba(15,20,25,0.85)] text-white text-xs shadow-lg border border-white/15">
            <span class="text-[#00ff41] font-bold mr-2">EXPLORATION</span>
            <span>WASD 이동 · 화면 클릭/드래그 회전 · 사물 근처에서 [E] 상호작용</span>
          </div>
          <div id="room-objective-hud" class="px-4 py-2 rounded-md bg-[rgba(15,20,25,0.85)] text-[#00ff41] text-xs font-bold border border-[#00ff41]/35 shadow-lg">
            목표: 책상 위 컴퓨터를 켜서 AI아트코딩과윤리 과제를 진행하세요
          </div>
        </div>

        <!-- Center Crosshair -->
        <div class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center">
          <div id="crosshair-dot" class="w-3 h-3 rounded-full border-2 border-slate-900/80 bg-white/60 transition-transform duration-150 shadow"></div>
        </div>

        <!-- Bottom Proximity Hold-Interact UI (Circular E Key + SVG #00FF41 Progress Ring, Zero backdrop-filter) -->
        <div id="room-interact-prompt" class="hidden fixed bottom-28 left-1/2 -translate-x-1/2 z-20 items-center gap-3.5 px-4 py-2.5 rounded-xl bg-[rgba(15,20,25,0.92)] border border-[#00ff41]/55 pointer-events-none shadow-lg select-none">
          <div class="relative w-12 h-12 flex items-center justify-center shrink-0">
            <svg width="48" height="48" viewBox="0 0 48 48" class="absolute inset-0 -rotate-90 pointer-events-none">
              <circle cx="24" cy="24" r="21" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="3.5" />
              <circle id="room-interact-ring" cx="24" cy="24" r="21" fill="none" stroke="#00ff41" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="131.95" stroke-dashoffset="131.95" />
            </svg>
            <div id="room-interact-keycap" class="w-9 h-9 rounded-full bg-[#091218] border border-white/30 flex items-center justify-center font-code text-base font-black text-white">E</div>
          </div>
          <div class="flex flex-col">
            <span id="room-interact-label" class="text-sm font-bold text-[#e6edf3] whitespace-nowrap">꾹 눌러서 컴퓨터 사용하기</span>
            <span class="text-[10px] font-code text-[#00ff41]/80 tracking-wider">HOLD [E] · 1.0s</span>
          </div>
        </div>

        <!-- Room Bottom Dialogue Box -->
        <div id="room-dialogue" class="hidden fixed bottom-7 left-1/2 -translate-x-1/2 z-30 w-[92vw] max-w-2xl rounded-lg bg-[rgba(15,20,25,0.92)] border-2 border-[#00ff41]/80 px-6 py-4 shadow-2xl pointer-events-none">
          <div class="text-xs font-bold text-[#00ff41] mb-1">주인공</div>
          <div id="room-dialogue-text" class="text-sm sm:text-base font-medium text-white leading-relaxed"></div>
        </div>

        <!-- Python Syntax Handbook Modal (Zero backdrop-filter for locked 60FPS 3D Room) -->
        <div id="python-notebook-modal" class="hidden fixed inset-0 z-50 bg-[rgba(10,15,20,0.85)] items-center justify-center p-4 sm:p-6">
          <div class="w-full max-w-4xl h-[86vh] max-h-[820px] rounded-xl bg-[#0d121a] border-2 border-[#00ff41]/65 flex flex-col overflow-hidden shadow-2xl">
            <!-- Header -->
            <div class="flex items-center justify-between px-5 sm:px-6 py-4 bg-[#080c12] border-b border-white/10 shrink-0">
              <div>
                <div class="text-[11px] font-code text-[#00ff41] font-bold tracking-widest">PYTHON SYNTAX HANDBOOK · STAGE 1~30</div>
                <h3 class="text-lg sm:text-xl font-bold text-white mt-0.5">파이썬 문법 · 함수 수첩</h3>
              </div>
              <button id="btn-close-notebook" type="button" aria-label="수첩 닫기" class="px-3.5 py-1.5 rounded border border-[#00ff41]/60 bg-[#071510] hover:bg-[#00ff41]/20 text-[#00ff41] font-code text-sm font-black cursor-pointer transition">
                [ X ]
              </button>
            </div>

            <!-- Search Bar & Category Filter Tabs -->
            <div class="px-5 sm:px-6 py-3.5 bg-[#0a0f17] border-b border-white/10 space-y-3 shrink-0">
              <div class="relative flex items-center">
                <svg class="w-4 h-4 text-[#00ff41]/80 absolute left-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  id="notebook-search"
                  placeholder="문법, 함수명 또는 설명 검색..."
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full pl-10 pr-24 py-2.5 rounded-lg bg-[#06090e] border border-white/20 focus:border-[#00ff41] focus:outline-none text-sm text-white placeholder-slate-400 font-code transition"
                />
                <span id="notebook-count" class="absolute right-3.5 text-[11px] font-code text-[#00ff41]/85 pointer-events-none"></span>
              </div>

              <div id="notebook-tabs" class="flex flex-wrap gap-2">
                <button type="button" data-cat="all" class="notebook-tab-btn px-3 py-1.5 rounded-md border text-xs font-bold cursor-pointer transition">전체</button>
                <button type="button" data-cat="types" class="notebook-tab-btn px-3 py-1.5 rounded-md border text-xs font-bold cursor-pointer transition">자료형·변수</button>
                <button type="button" data-cat="control" class="notebook-tab-btn px-3 py-1.5 rounded-md border text-xs font-bold cursor-pointer transition">제어문·반복문</button>
                <button type="button" data-cat="functions" class="notebook-tab-btn px-3 py-1.5 rounded-md border text-xs font-bold cursor-pointer transition">함수·내장함수</button>
                <button type="button" data-cat="errors" class="notebook-tab-btn px-3 py-1.5 rounded-md border text-xs font-bold cursor-pointer transition">오류·디버깅</button>
              </div>
            </div>

            <!-- Scrollable Entries List -->
            <div id="notebook-content" class="flex-1 min-h-0 overflow-y-auto p-5 sm:p-6"></div>
          </div>
        </div>
      </section>

      <!-- 2. 2D OS SIMULATION -->
      <section id="scene-os" class="cyber-scene flex-col justify-between os-desktop-bg relative overflow-hidden">
        <div id="os-flash-layer" class="absolute inset-0 pointer-events-none z-30"></div>

        <!-- Desktop Grid -->
        <div class="p-6 grid grid-cols-1 gap-5 w-32 z-10">
          <button data-app="edge" class="os-icon flex flex-col items-center gap-1.5 p-2.5 rounded-lg hover:bg-white/15 active:scale-95 transition cursor-pointer text-white">
            ${SVG_EDGE}
            <span class="text-xs font-medium drop-shadow text-center">Microsoft Edge</span>
          </button>
          <button data-app="chrome" class="os-icon flex flex-col items-center gap-1.5 p-2.5 rounded-lg hover:bg-white/15 active:scale-95 transition cursor-pointer text-white">
            ${SVG_CHROME}
            <span class="text-xs font-medium drop-shadow text-center">Chrome</span>
          </button>
          <button data-app="trash" class="os-icon flex flex-col items-center gap-1.5 p-2.5 rounded-lg hover:bg-white/15 active:scale-95 transition cursor-pointer text-white">
            ${SVG_TRASH}
            <span class="text-xs font-medium drop-shadow text-center">휴지통</span>
          </button>
          <button data-app="folder" class="os-icon flex flex-col items-center gap-1.5 p-2.5 rounded-lg hover:bg-white/15 active:scale-95 transition cursor-pointer text-white">
            ${SVG_FOLDER}
            <span class="text-xs font-medium drop-shadow text-center">AI아트코딩과윤리_과제</span>
          </button>
        </div>

        <!-- Forced Hacker Notepad -->
        <div id="os-notepad" class="hidden fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[92vw] max-w-lg rounded-lg overflow-hidden bg-[#f8fafc] text-slate-900 border-2 border-[#ff007f] shadow-[0_0_50px_rgba(255,0,127,0.55)]">
          <div class="flex items-center justify-between px-4 py-2.5 bg-[#ff007f] text-white text-xs font-bold">
            <span>제목 없음 - 메모장</span>
            <span>REMOTE INTRUSION</span>
          </div>
          <div id="os-notepad-text" class="p-6 min-h-[150px] text-base font-bold leading-relaxed text-red-700 font-code"></div>
        </div>

        <!-- Restored OS Web Browser & University LMS Assignment Submission Window -->
        <div id="os-browser-window" class="hidden fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[94vw] max-w-3xl rounded-xl overflow-hidden bg-white text-slate-900 shadow-[0_24px_70px_rgba(0,0,0,0.6)] border border-slate-300 flex-col">
          <!-- Browser Top Bar -->
          <div class="bg-slate-200 px-4 py-2 flex items-center justify-between border-b border-slate-300">
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full bg-rose-400"></span>
              <span class="w-3 h-3 rounded-full bg-amber-400"></span>
              <span class="w-3 h-3 rounded-full bg-emerald-400"></span>
              <span id="os-browser-title" class="ml-3 px-3 py-1 rounded-t-md bg-white text-xs font-semibold text-slate-700 border border-b-0 border-slate-300">
                대학교 LMS - AI아트코딩과윤리 과제 제출
              </span>
            </div>
            <button id="btn-close-browser" type="button" class="text-xs font-bold text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-300/60 cursor-pointer">✕</button>
          </div>
          <!-- Address Bar -->
          <div class="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-600">
            <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">🔒 HTTPS</span>
            <div class="flex-1 bg-white border border-slate-300 rounded-full px-3.5 py-1 font-code text-[11px] text-slate-700 truncate">
              https://lms.cyber-university.ac.kr/courses/ai-art-coding-ethics/assignment/final
            </div>
          </div>
          <!-- University LMS Content -->
          <div class="p-6 sm:p-8 bg-slate-50 space-y-5 max-h-[70vh] overflow-y-auto">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <div class="text-xs font-bold text-blue-600 tracking-wide">UNIVERSITY LMS · 온라인 강의실</div>
                <h3 class="text-xl font-black text-slate-900 mt-0.5">AI아트코딩과윤리 과제 제출 페이지</h3>
              </div>
              <span id="lms-status-badge" class="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                미제출 · 마감 임박
              </span>
            </div>

            <div class="rounded-lg border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm border-b border-slate-100 pb-3">
                <div class="text-slate-500 font-semibold">과제명</div>
                <div class="sm:col-span-2 font-bold text-slate-900">AI아트코딩과윤리 최종 프로젝트 제출</div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm border-b border-slate-100 pb-3">
                <div class="text-slate-500 font-semibold">교과목</div>
                <div class="sm:col-span-2 text-slate-700">AI아트코딩과윤리</div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm items-center">
                <div class="text-slate-500 font-semibold">첨부파일</div>
                <div class="sm:col-span-2">
                  <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-md bg-blue-50 border border-blue-200">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <span class="inline-flex items-center justify-center w-7 h-7 rounded bg-blue-600 text-white text-xs font-bold shrink-0">HTML</span>
                      <div class="min-w-0">
                        <div class="font-code text-xs sm:text-sm font-bold text-slate-900 truncate">CYBER_DEF_final.html</div>
                        <div class="text-[11px] text-blue-700 font-medium">자동 첨부 완료 · 148 KB</div>
                      </div>
                    </div>
                    <span class="text-xs font-bold text-emerald-600 shrink-0">✓ 준비됨</span>
                  </div>
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm items-start border-t border-slate-100 pt-3">
                <label for="lms-player-name" class="text-slate-500 font-semibold sm:pt-2">제출자 이름</label>
                <div class="sm:col-span-2">
                  <input
                    id="lms-player-name"
                    type="text"
                    maxlength="20"
                    autocomplete="off"
                    placeholder="이름 또는 닉네임을 입력하세요"
                    class="w-full px-3.5 py-2 rounded-md border border-slate-300 bg-white text-slate-900 text-sm font-semibold focus:outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                  />
                  <p id="lms-name-error" class="hidden text-xs font-semibold text-rose-600 mt-1"></p>
                </div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm items-center border-t border-slate-100 pt-3">
                <div class="text-slate-500 font-semibold">클리어 타임</div>
                <div class="sm:col-span-2 flex items-center gap-2.5">
                  <span id="lms-clear-time-display" class="inline-flex items-center px-3 py-1 rounded-md bg-slate-900 text-[#00ff41] font-code text-xs sm:text-sm font-bold tracking-wider tabular-nums">00:00.00</span>
                  <span class="text-[11px] text-slate-500">제출 시 글로벌 실시간 랭킹에 자동 등록됩니다</span>
                </div>
              </div>
            </div>

            <div class="flex justify-end pt-1">
              <button id="btn-submit-assignment" type="button" class="px-7 py-3 rounded-lg bg-blue-600 hover:bg-blue-700 active:scale-[0.99] text-white text-sm font-bold shadow-md shadow-blue-600/25 transition cursor-pointer">
                과제 제출하기
              </button>
            </div>
          </div>

          <!-- Submission Success Confirmation Popup -->
          <div id="lms-submit-popup" class="hidden absolute inset-0 z-50 bg-slate-900/55 backdrop-blur-xs items-center justify-center p-4">
            <div class="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl border border-slate-200 space-y-3">
              <div class="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl font-black">✓</div>
              <h4 class="text-lg font-black text-slate-900">제출 완료</h4>
              <p class="text-sm font-semibold text-slate-700">AI아트코딩과윤리 과제가 성공적으로 제출되었습니다!</p>
              <div id="lms-submit-meta" class="text-xs font-code font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-1.5"></div>
            </div>
          </div>
        </div>

        <!-- OS Protagonist Dialogue -->
        <div id="os-dialogue" class="hidden fixed bottom-16 left-1/2 -translate-x-1/2 z-40 w-[90vw] max-w-2xl rounded-lg bg-slate-950/92 border-2 border-[#00ff41] px-6 py-4 shadow-2xl">
          <div class="text-xs text-[#00ff41] font-bold mb-1">주인공</div>
          <div id="os-dialogue-text" class="text-base text-white font-bold"></div>
        </div>

        <!-- Smooth Fade-to-Black Curtain before Ending Credits -->
        <div id="os-fade-curtain" class="fixed inset-0 z-50 bg-black opacity-0 pointer-events-none transition-opacity duration-1000"></div>

        <!-- Translucent Glass Taskbar + Live Digital Clock -->
        <div class="h-12 os-taskbar-glass px-5 flex items-center justify-between z-20 text-white">
          <div class="flex items-center gap-4">
            <div class="w-8 h-8 rounded bg-sky-500/20 border border-sky-400/40 flex items-center justify-center">
              <svg viewBox="0 0 24 24" class="w-4 h-4 fill-sky-400">
                <rect x="2" y="2" width="9" height="9" rx="1"/>
                <rect x="13" y="2" width="9" height="9" rx="1"/>
                <rect x="2" y="13" width="9" height="9" rx="1"/>
                <rect x="13" y="13" width="9" height="9" rx="1"/>
              </svg>
            </div>
            <span id="os-status-msg" class="text-xs text-slate-300">바탕화면 아이콘을 클릭하여 AI아트코딩과윤리 과제를 시작하세요</span>
          </div>
          <div class="flex items-center gap-4">
            <span id="os-live-clock" class="text-xs font-code font-semibold text-white tabular-nums">00:00:00</span>
          </div>
        </div>
      </section>

      <!-- 3. STAGE SELECT (6-STAGE PAGINATED CYBERPUNK HUD, PYTHON ONLY, NO CHEATS) -->
      <section id="scene-stage-select" class="cyber-scene flex-col stage-select-bg overflow-y-auto relative">
        <!-- Decorative Top & Bottom Cyber Circuit Lines (Lightweight SVG, Zero Blur) -->
        <svg class="pointer-events-none fixed top-0 left-0 w-full h-24 z-0 opacity-85" viewBox="0 0 1440 96" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="0,78 395,78 430,66 575,66 635,28 1015,28 1045,0" fill="none" stroke="#00ff41" stroke-opacity="0.45" stroke-width="1.5" vector-effect="non-scaling-stroke" />
          <polyline points="0,84 360,84 378,78" fill="none" stroke="#00ff41" stroke-opacity="0.22" stroke-width="1" vector-effect="non-scaling-stroke" />
        </svg>
        <svg class="pointer-events-none fixed bottom-0 left-0 w-full h-20 z-0 opacity-80" viewBox="0 0 1440 80" preserveAspectRatio="none" aria-hidden="true">
          <polyline points="0,56 175,56 210,70 430,70 452,76 1045,76 1068,60 1355,60 1392,26 1440,26" fill="none" stroke="#00ff41" stroke-opacity="0.48" stroke-width="1.6" vector-effect="non-scaling-stroke" />
          <polyline points="0,42 190,42 224,62 435,62" fill="none" stroke="#00ff41" stroke-opacity="0.2" stroke-width="1" vector-effect="non-scaling-stroke" />
        </svg>

        <!-- Top HUD Bar -->
        <header class="relative z-10 w-full max-w-[1380px] mx-auto px-6 sm:px-10 pt-5 pb-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div class="flex flex-col">
            <div class="flex items-center gap-3">
              <span class="text-xs font-code font-bold tracking-[0.26em] text-[#00ff41]">CYBER-DEF</span>
              <span class="inline-flex items-center gap-1" aria-hidden="true">
                <span class="w-2 h-1.5 bg-[#00ff41]/85 -skew-x-24 inline-block"></span>
                <span class="w-2 h-1.5 bg-[#00ff41]/70 -skew-x-24 inline-block"></span>
                <span class="w-2 h-1.5 bg-[#00ff41]/55 -skew-x-24 inline-block"></span>
                <span class="w-2 h-1.5 bg-[#00ff41]/40 -skew-x-24 inline-block"></span>
                <span class="w-2 h-1.5 bg-[#00ff41]/25 -skew-x-24 inline-block"></span>
              </span>
            </div>
            <h2 class="text-2xl sm:text-3xl font-black text-white tracking-[0.16em] leading-tight mt-0.5">STAGE SELECT</h2>
          </div>

          <!-- Top-Right Progress Badge & Home (Return to Room) Button -->
          <div class="flex items-center gap-3 shrink-0">
            <div class="stage-chamfer-badge relative px-4 py-2.5 flex items-center gap-3">
              <svg class="stage-card-border-svg" viewBox="0 0 220 44" preserveAspectRatio="none" aria-hidden="true">
                <polygon points="11,1 209,1 219,11 219,33 209,43 11,43 1,33 1,11" fill="none" stroke="#00ff41" stroke-opacity="0.65" stroke-width="1.4" vector-effect="non-scaling-stroke" />
              </svg>
              <!-- Python Emblem SVG -->
              <svg viewBox="0 0 24 24" class="w-5 h-5 shrink-0" aria-hidden="true">
                <path fill="#3776ab" d="M11.9 2C7.4 2 7.7 3.9 7.7 3.9l.01 2h4.3v.6H6s-2.9-.3-2.9 4.2 2.5 4.3 2.5 4.3h1.5v-2.1s-.08-2.5 2.5-2.5h4.2s2.4.04 2.4-2.3V4.3S16.5 2 11.9 2zm-2.3 1.4a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6z"/>
                <path fill="#ffd43b" d="M12.1 22c4.5 0 4.2-1.9 4.2-1.9l-.01-2H12v-.6h6s2.9.3 2.9-4.2-2.5-4.3-2.5-4.3h-1.5v2.1s.08 2.5-2.5 2.5h-4.2s-2.4-.04-2.4 2.3v3.8S7.5 22 12.1 22zm2.3-1.4a.8.8 0 1 1 0-1.6.8.8 0 0 1 0 1.6z"/>
              </svg>
              <span id="stage-summary" class="font-code text-xs sm:text-sm font-bold text-white tracking-wider tabular-nums whitespace-nowrap">
                Python · 0 / 30
              </span>
            </div>

            <button
              id="btn-stage-home"
              type="button"
              title="방으로 돌아가기"
              aria-label="방으로 돌아가기"
              class="stage-home-btn"
            >
              <svg class="stage-card-border-svg" viewBox="0 0 46 46" preserveAspectRatio="none" aria-hidden="true">
                <polygon points="11,1 35,1 45,11 45,35 35,45 11,45 1,35 1,11" fill="none" stroke="#00ff41" stroke-opacity="0.72" stroke-width="1.5" vector-effect="non-scaling-stroke" />
              </svg>
              <svg viewBox="0 0 24 24" class="w-5 h-5 relative z-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 10.5L12 3l9 7.5" />
                <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V21h3.5a1 1 0 0 0 1-1V9.5" />
              </svg>
            </button>
          </div>
        </header>

        <!-- Subtitle & Main 3x2 Paginated Stage Grid -->
        <main class="relative z-10 flex-1 w-full max-w-[1380px] mx-auto px-5 sm:px-10 pb-8 pt-2 flex flex-col justify-between gap-5">
          <!-- Subtitle Line -->
          <div class="flex flex-wrap items-center justify-between gap-3 px-2 sm:px-14">
            <div class="flex items-center gap-3">
              <span class="w-1 h-4 bg-[#00ff41] inline-block shrink-0" aria-hidden="true"></span>
              <p class="text-xs sm:text-sm font-code text-slate-300/90 tracking-wide">
                Select a stage to begin the challenge.
              </p>
            </div>
            <span id="stage-page-range-label" class="text-xs font-code text-[#00ff41]/80 tracking-wider tabular-nums">
              STAGE 01 - 06
            </span>
          </div>

          <!-- Center Row: Left Hex Arrow + 3x2 Stage Cards + Right Hex Arrow -->
          <div class="flex items-center justify-center gap-3 sm:gap-6 my-auto">
            <button
              id="btn-stage-prev"
              type="button"
              aria-label="이전 페이지"
              class="stage-hex-arrow"
            >
              <svg class="stage-card-border-svg" viewBox="0 0 54 62" preserveAspectRatio="none" aria-hidden="true">
                <polygon points="13,1 41,1 53,15 53,47 41,61 13,61 1,47 1,15" fill="none" stroke="currentColor" stroke-opacity="0.72" stroke-width="1.6" vector-effect="non-scaling-stroke" />
              </svg>
              <svg viewBox="0 0 24 24" class="w-7 h-7 relative z-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>

            <div id="stage-grid" class="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-[1120px]"></div>

            <button
              id="btn-stage-next"
              type="button"
              aria-label="다음 페이지"
              class="stage-hex-arrow"
            >
              <svg class="stage-card-border-svg" viewBox="0 0 54 62" preserveAspectRatio="none" aria-hidden="true">
                <polygon points="13,1 41,1 53,15 53,47 41,61 13,61 1,47 1,15" fill="none" stroke="currentColor" stroke-opacity="0.72" stroke-width="1.6" vector-effect="non-scaling-stroke" />
              </svg>
              <svg viewBox="0 0 24 24" class="w-7 h-7 relative z-10" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <!-- Bottom Pagination Bar (5 Indicator Dots + 1 / 5 Counter) -->
          <div class="relative flex flex-col items-center gap-3 pb-2">
            <!-- Locked Page Toast Notification -->
            <div
              id="stage-page-toast"
              role="status"
              aria-live="polite"
              class="stage-page-toast pointer-events-none opacity-0 translate-y-2 px-5 py-2.5 rounded-md bg-[rgba(15,20,25,0.95)] border border-[#ff007f]/75 text-xs sm:text-sm font-bold text-[#ff8ac4] shadow-[0_0_24px_rgba(255,0,127,0.3)]"
            >
              현재 페이지의 6단계를 모두 클리어해야 다음 페이지가 해금됩니다.
            </div>

            <div class="flex items-center justify-center gap-5 w-full max-w-md">
              <div class="h-px flex-1 bg-gradient-to-r from-transparent to-[#00ff41]/45" aria-hidden="true"></div>
              <div id="stage-page-dots" class="flex items-center gap-3"></div>
              <span id="stage-page-counter" class="font-code text-xs sm:text-sm font-bold text-slate-200 tracking-widest tabular-nums ml-1 whitespace-nowrap">
                1 / 5
              </span>
              <div class="h-px flex-1 bg-gradient-to-l from-transparent to-[#00ff41]/45" aria-hidden="true"></div>
            </div>
          </div>
        </main>
      </section>

      <!-- 4. IN-GAME -->
      <section id="scene-game" class="cyber-scene flex-col bg-[#0a0b0e]"></section>

      <!-- MALWARE UNINSTALL OVERLAY (IMMEDIATELY AFTER STAGE 30 CLEAR) -->
      <div id="malware-uninstall-overlay" class="hidden fixed inset-0 z-50 bg-black/90 backdrop-blur-md items-center justify-center p-6 transition-colors duration-700">
        <div id="malware-uninstall-card" class="w-full max-w-lg rounded-xl border border-[#00ff41]/60 bg-[#0c121a]/95 p-7 shadow-[0_0_50px_rgba(0,255,65,0.22)] space-y-5 transition-all duration-700">
          <div class="flex items-center justify-between border-b border-white/10 pb-3">
            <div class="space-y-0.5">
              <div id="uninstall-badge" class="text-[11px] font-code font-bold tracking-[0.22em] text-[#00ff41]">SYSTEM SECURITY PURGE</div>
              <h3 id="uninstall-title" class="text-lg font-black text-white">해킹 프로그램(CYBER-DEF) 삭제 중...</h3>
            </div>
            <span id="uninstall-pct" class="text-xl font-black font-code text-[#00ff41] tabular-nums">0%</span>
          </div>

          <div class="w-full h-3.5 rounded-full bg-slate-800 overflow-hidden border border-white/10">
            <div id="uninstall-bar" class="h-full w-0 bg-gradient-to-r from-[#00ff41] to-[#38bdf8] transition-none"></div>
          </div>

          <div id="uninstall-status" class="text-xs sm:text-sm font-medium text-slate-300 leading-relaxed min-h-[2.5rem]">
            원격 침입 프로세스 및 커널 훅을 종료하는 중입니다...
          </div>
        </div>
      </div>

      <!-- 5. ENDING CREDITS -->
      <section id="scene-ending" class="cyber-scene flex-col items-center justify-center bg-black overflow-hidden">
        <div id="ending-credits-track" class="w-full max-w-2xl px-6 text-center space-y-12 py-12">
          <div class="space-y-3 pb-6">
            <h2 class="text-5xl sm:text-6xl font-black text-white tracking-[0.18em]">CYBER-DEF</h2>
            <div class="text-sm sm:text-base font-code font-bold tracking-[0.35em] text-[#00ff41]">- SYSTEM RESTORED -</div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">DIRECTED &amp; DEVELOPED BY</div>
            <div class="text-xl sm:text-2xl font-bold text-white">김연우 (Yeonwoo Kim)</div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">GAME DESIGN &amp; 30-STAGE ARCHITECTURE</div>
            <div class="text-xl sm:text-2xl font-bold text-white">김연우</div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">3D ENVIRONMENT &amp; INTERACTIVE ROOM</div>
            <div class="text-lg sm:text-xl font-bold text-white">Three.js (WebGL) &amp; Procedural CanvasTexture</div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">2D GAME ENGINE &amp; VISUAL FX</div>
            <div class="text-lg sm:text-xl font-bold text-white">Vanilla JavaScript &amp; HTML5 Canvas API</div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">UI / UX &amp; CYBERPUNK HUD</div>
            <div class="text-lg sm:text-xl font-bold text-white">HTML5 / CSS3 Keyframes &amp; SVG Graphics</div>
          </div>

          <div class="space-y-2">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">SOUND &amp; SYSTEM AUDIO</div>
            <div class="text-lg sm:text-xl font-bold text-white">Web Audio API Synthesizer</div>
          </div>

          <div class="space-y-3 pt-4">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">SPECIAL THANKS</div>
            <div class="text-base sm:text-lg font-bold text-white leading-relaxed">
              AI아트코딩과윤리 과제 심사 및 피드백에 참여해 주신 모든 분들<br />
              그리고 30단계의 방화벽을 뚫고 AI아트코딩과윤리 과제를 제출한 PLAYER
            </div>
          </div>

          <div class="space-y-2 pt-8">
            <div class="text-xs font-code font-bold tracking-[0.25em] text-[#00ff41]">FINAL MESSAGE</div>
            <div class="text-lg sm:text-xl font-code font-bold text-white leading-loose tracking-wider">
              ALL SYSTEMS NORMAL.<br />
              ASSIGNMENT SUBMITTED.<br />
              THANK YOU FOR PLAYING.
            </div>
          </div>
        </div>

        <!-- Fixed Bottom-Right Cyberpunk SKIP Button during Credits -->
        <button
          id="btn-skip-credits"
          type="button"
          class="fixed bottom-6 right-6 z-40 px-5 py-2.5 rounded-md bg-black/55 backdrop-blur-md border border-[#00ff41]/55 text-[#00ff41] font-code text-xs font-bold tracking-[0.2em] hover:bg-[#00ff41]/20 hover:border-[#00ff41] hover:shadow-[0_0_18px_rgba(0,255,65,0.45)] transition cursor-pointer"
        >
          SKIP &gt;&gt;
        </button>

        <div id="ending-actions" class="opacity-0 pointer-events-none transition-opacity duration-1000 fixed inset-0 flex flex-col items-center justify-center gap-6 bg-black/92 px-6 text-center">
          <div class="text-xs font-code tracking-[0.35em] text-[#00ff41]">ALL SYSTEMS NORMAL</div>
          <h3 class="text-3xl sm:text-4xl font-black text-white tracking-wider">CYBER-DEF</h3>
          <p class="text-sm text-slate-400">AI아트코딩과윤리 과제가 성공적으로 제출되었습니다.</p>
          <div id="ending-clear-summary" class="hidden px-4 py-2 rounded-md border border-[#00ff41]/35 bg-[#00ff41]/8 font-code text-xs sm:text-sm font-bold text-[#00ff41] tracking-wider tabular-nums"></div>
          <div class="flex flex-wrap items-center justify-center gap-4 pt-1">
            <button id="btn-ending-rank" type="button" class="cyber-btn px-10 py-3.5 text-sm font-black tracking-[0.22em] cursor-pointer shadow-[0_0_24px_rgba(0,229,255,0.3)] border-[#00e5ff] text-[#00e5ff] hover:bg-[#00e5ff]/20">
              RANK
            </button>
            <button id="btn-ending-restart" type="button" class="cyber-btn px-10 py-3.5 text-sm font-black tracking-[0.22em] cursor-pointer shadow-[0_0_24px_rgba(0,255,65,0.35)]">
              다시 시작
            </button>
          </div>
        </div>
      </section>
      <!-- 6. SYSTEM STANDBY SCREEN (AFTER CRT POWER-OFF) -->
      <section id="scene-standby" class="cyber-scene flex-col items-center justify-center bg-black text-center gap-6 px-6">
        <div class="w-2.5 h-2.5 rounded-full bg-red-600/80 shadow-[0_0_12px_rgba(220,38,38,0.9)]"></div>
        <div class="space-y-2">
          <div class="text-xs font-code tracking-[0.35em] text-slate-500">SYSTEM STANDBY</div>
          <p class="text-sm text-slate-400">전원이 대기 모드로 전환되었습니다.</p>
        </div>
        <button id="btn-standby-wake" type="button" class="cyber-btn px-6 py-2.5 text-xs font-bold tracking-widest cursor-pointer">
          POWER ON
        </button>
      </section>

      <!-- GLOBAL REAL-TIME RANKING MODAL -->
      <div id="rank-modal" class="hidden fixed inset-0 z-[10000] bg-black/85 backdrop-blur-md items-center justify-center p-4 sm:p-6">
        <div class="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-[#00ff41]/55 bg-[#080d14]/96 shadow-[0_0_55px_rgba(0,255,65,0.22)] overflow-hidden">
          <div class="px-6 py-4 border-b border-white/10 bg-[#0c1420] flex items-center justify-between gap-4">
            <div class="space-y-0.5">
              <div class="flex items-center gap-2.5">
                <span class="text-[11px] font-code font-bold tracking-[0.26em] text-[#00ff41]">GLOBAL LEADERBOARD</span>
                <span id="rank-sync-status" class="px-2 py-0.5 rounded bg-[#00ff41]/15 border border-[#00ff41]/40 text-[10px] font-code font-bold text-[#00ff41] tracking-wider">SYNCING...</span>
              </div>
              <h3 class="text-lg sm:text-xl font-black text-white tracking-wide">실시간 클리어 랭킹</h3>
            </div>
            <button id="btn-close-rank" type="button" class="cyber-btn px-3.5 py-1.5 text-xs font-code font-bold cursor-pointer">
              닫기 [ESC]
            </button>
          </div>

          <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="border-b border-white/15 text-[11px] font-code uppercase tracking-[0.18em] text-slate-400">
                  <th class="py-2.5 px-3 w-20">순위</th>
                  <th class="py-2.5 px-3">플레이어 이름</th>
                  <th class="py-2.5 px-3 text-right w-36">클리어 시간</th>
                </tr>
              </thead>
              <tbody id="rank-table-body" class="divide-y divide-white/8 text-sm">
                <tr>
                  <td colspan="3" class="py-12 text-center font-code text-sm text-[#00ff41]">데이터베이스 동기화 중...</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="px-6 py-3 border-t border-white/10 bg-[#0b111b] flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <span id="rank-footer-note" class="font-code text-slate-300">클리어 시간이 빠를수록 상위 순위에 등록됩니다.</span>
            <span class="font-code text-[11px] text-slate-500">REALTIME DB · AUTO SYNC</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const scenes: Record<SceneId, HTMLElement> = {
    boot: root.querySelector('#scene-boot')!,
    menu: root.querySelector('#scene-menu')!,
    room: root.querySelector('#scene-room')!,
    os: root.querySelector('#scene-os')!,
    'stage-select': root.querySelector('#scene-stage-select')!,
    game: root.querySelector('#scene-game')!,
    ending: root.querySelector('#scene-ending')!,
    standby: root.querySelector('#scene-standby')!,
  };

  const fixedReturnBtn = root.querySelector('#fixed-return-room-btn') as HTMLButtonElement;
  const floatingSettingsBtn = root.querySelector('#floating-settings-btn') as HTMLButtonElement;
  const pauseOverlay = root.querySelector('#game-pause-overlay') as HTMLElement;
  const pauseCountdownWrap = root.querySelector('#pause-countdown-wrap') as HTMLElement;
  const pauseCountdownNum = root.querySelector('#pause-countdown-num') as HTMLElement;
  const mainMenuBgm = root.querySelector('#main-menu-bgm') as HTMLAudioElement;
  const ingameBgm = root.querySelector('#ingame-bgm') as HTMLAudioElement;
  const initialBgmSlider = root.querySelector('#slider-bgm') as HTMLInputElement;
  const initialBgmVol = Math.max(0, Math.min(1, Number(initialBgmSlider.value) / 100));
  mainMenuBgm.volume = initialBgmVol;
  ingameBgm.volume = initialBgmVol;
  let stage30ClearedThisSession = false;

  // Playtime measurement & global ranking state
  let runStartTimeMs = 0;
  let runPausedTotalMs = 0;
  let pauseStartedAtMs = 0;
  let clearElapsedMs = 0;
  let submittedPlayerName = '';
  let myRankKey: string | null = null;
  let unsubscribeRankings: (() => void) | null = null;

  const flushPauseElapsed = () => {
    if (pauseStartedAtMs > 0) {
      runPausedTotalMs += Math.max(0, Date.now() - pauseStartedAtMs);
      pauseStartedAtMs = 0;
    }
  };

  const captureStage30ClearTime = () => {
    flushPauseElapsed();
    if (clearElapsedMs === 0) {
      const elapsed = runStartTimeMs > 0 ? Date.now() - runStartTimeMs - runPausedTotalMs : 0;
      clearElapsedMs = Math.max(1000, elapsed);
    }
  };

  // Global in-game pause & 3-2-1 resume countdown state
  let isGamePaused = false;
  let isCountdownActive = false;
  let pauseCountdownTimers: number[] = [];
  let roomModeBeforeSettings: DeveloperRoom3D['mode'] | null = null;

  const clearPauseCountdown = () => {
    pauseCountdownTimers.forEach((id) => window.clearTimeout(id));
    pauseCountdownTimers = [];
    isCountdownActive = false;
    floatingSettingsBtn.disabled = false;
  };

  const resetPauseState = () => {
    flushPauseElapsed();
    clearPauseCountdown();
    isGamePaused = false;
    stageEngine?.setPaused(false);
    pauseOverlay.classList.add('hidden');
    pauseOverlay.classList.remove('flex');
    pauseCountdownWrap.classList.add('hidden');
    pauseCountdownWrap.classList.remove('flex');
  };

  let bgmUnlockCleanup: (() => void) | null = null;

  const removeBgmUnlockListeners = () => {
    if (bgmUnlockCleanup) {
      bgmUnlockCleanup();
      bgmUnlockCleanup = null;
    }
  };

  const stopMainMenuBgm = () => {
    removeBgmUnlockListeners();
    mainMenuBgm.pause();
    try {
      mainMenuBgm.currentTime = 0;
    } catch {
      // ignore if media metadata not yet loaded
    }
  };

  const attachBgmAutoplayFallback = () => {
    removeBgmUnlockListeners();

    const tryResumeOnInteraction = (e: Event) => {
      if (currentScene !== 'menu') {
        removeBgmUnlockListeners();
        return;
      }
      // 첫 클릭이 START 또는 종료 확인 버튼인 경우에는 BGM을 재생하지 않고 즉시 정리
      const target = e.target as HTMLElement | null;
      if (target && target.closest('#btn-start, #btn-confirm-quit')) {
        removeBgmUnlockListeners();
        return;
      }
      removeBgmUnlockListeners();
      mainMenuBgm.volume = Math.max(0, Math.min(1, Number(initialBgmSlider.value) / 100));
      mainMenuBgm.play().catch(() => {
        // still blocked; ignore silently
      });
    };

    window.addEventListener('pointerdown', tryResumeOnInteraction, { capture: true });
    window.addEventListener('keydown', tryResumeOnInteraction, { capture: true });

    bgmUnlockCleanup = () => {
      window.removeEventListener('pointerdown', tryResumeOnInteraction, { capture: true });
      window.removeEventListener('keydown', tryResumeOnInteraction, { capture: true });
    };
  };

  const playMainMenuBgm = () => {
    if (currentScene !== 'menu') return;
    removeBgmUnlockListeners();
    mainMenuBgm.volume = Math.max(0, Math.min(1, Number(initialBgmSlider.value) / 100));
    try {
      mainMenuBgm.currentTime = 0;
    } catch {
      // ignore if media metadata not yet loaded
    }
    const playPromise = mainMenuBgm.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (currentScene === 'menu') {
          attachBgmAutoplayFallback();
        }
      });
    }
  };

  const stopAndResetIngameBgm = () => {
    ingameBgm.pause();
    try {
      ingameBgm.currentTime = 0;
    } catch {
      // ignore if media metadata not yet loaded
    }
  };

  const pauseIngameBgm = () => {
    ingameBgm.pause();
  };

  const playOrResumeIngameBgm = () => {
    if (isSystemRestored || stage30ClearedThisSession) {
      stopAndResetIngameBgm();
      return;
    }
    ingameBgm.volume = Math.max(0, Math.min(1, Number(initialBgmSlider.value) / 100));
    // 이미 재생 중이라면 currentTime을 초기화하지 않고 끊김 없이 이어서 재생
    if (!ingameBgm.paused) return;
    ingameBgm.play().catch(() => {
      // ignore autoplay rejection if any
    });
  };

  const interactPrompt = root.querySelector('#room-interact-prompt') as HTMLElement;
  const interactRing = root.querySelector('#room-interact-ring') as unknown as SVGCircleElement;
  const interactKeycap = root.querySelector('#room-interact-keycap') as HTMLElement;
  const interactLabel = root.querySelector('#room-interact-label') as HTMLElement;
  const INTERACT_RING_CIRCUMFERENCE = 2 * Math.PI * 21; // r = 21

  const updateInteractGauge = (progress: number) => {
    if (!interactRing) return;
    const clamped = Math.max(0, Math.min(1, progress));
    const offset = INTERACT_RING_CIRCUMFERENCE * (1 - clamped);
    interactRing.style.strokeDashoffset = offset.toFixed(2);
    if (interactKeycap) {
      if (clamped > 0) {
        interactKeycap.style.borderColor = '#00ff41';
        interactKeycap.style.color = '#00ff41';
      } else {
        interactKeycap.style.borderColor = 'rgba(255,255,255,0.3)';
        interactKeycap.style.color = '#ffffff';
      }
    }
  };

  const resetInteractGauge = () => {
    updateInteractGauge(0);
  };

  if (interactRing) {
    interactRing.setAttribute('stroke-dasharray', INTERACT_RING_CIRCUMFERENCE.toFixed(2));
    interactRing.setAttribute('stroke-dashoffset', INTERACT_RING_CIRCUMFERENCE.toFixed(2));
  }

  const notebookModal = root.querySelector('#python-notebook-modal') as HTMLElement;

  const switchScene = (next: SceneId) => {
    (Object.keys(scenes) as SceneId[]).forEach((k) => {
      if (k === next) scenes[k].classList.add('active');
      else scenes[k].classList.remove('active');
    });
    currentScene = next;

    if (next === 'menu') {
      playMainMenuBgm();
    } else {
      stopMainMenuBgm();
    }

    if (next === 'stage-select' || next === 'game') {
      playOrResumeIngameBgm();
    } else if (next === 'room' && sessionHacked && !isSystemRestored && !stage30ClearedThisSession) {
      // 30단계 클리어 전 방으로 잠시 나갔다가 돌아올 때 이어서 재생하도록 일시정지
      pauseIngameBgm();
    } else {
      stopAndResetIngameBgm();
    }

    // 씬별 독립 렌더링 루프 분리: 비활성 씬의 3D WebGL 및 2D 게임 루프를 즉시 정지해 GPU/CPU 점유 0% 유지
    if (next !== 'room') {
      room3d?.clearInputs();
      room3d?.stop();
      notebookModal.classList.add('hidden');
      notebookModal.classList.remove('flex');
      interactPrompt?.classList.add('hidden');
      interactPrompt?.classList.remove('flex');
      resetInteractGauge();
    }
    if (next !== 'game') {
      stageEngine?.stop();
      resetPauseState();
    }

    if (next === 'os' || next === 'game') {
      fixedReturnBtn.classList.add('visible');
    } else {
      fixedReturnBtn.classList.remove('visible');
    }

    // 좌측 하단 톱니바퀴 설정 버튼: 부팅/메인 메뉴/엔딩/대기 화면에서는 숨기고 게임 진행 화면에서만 노출
    if (next === 'room' || next === 'os' || next === 'stage-select' || next === 'game') {
      floatingSettingsBtn.classList.add('visible');
    } else {
      floatingSettingsBtn.classList.remove('visible');
    }

    if (next === 'os') {
      updateClock();
    }
  };

  // Real-time digital clock on OS taskbar (only mutates DOM while OS scene is active)
  const clockEl = root.querySelector('#os-live-clock') as HTMLElement;
  const updateClock = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}:${ss}`;
  };
  updateClock();
  window.setInterval(() => {
    if (currentScene === 'os') updateClock();
  }, 1000);

  const typeText = (el: HTMLElement, text: string, speed: number, done?: () => void) => {
    el.textContent = '';
    let idx = 0;
    const step = () => {
      el.textContent = text.slice(0, idx + 1);
      audio.keyClick();
      idx++;
      if (idx < text.length) {
        setTimeout(step, speed);
      } else if (done) {
        done();
      }
    };
    step();
  };

  // ---------------------------------------------------------------------------
  // 0. MAIN MENU, CHAIR BUTTONS & MODALS
  // ---------------------------------------------------------------------------
  let lookSensitivity = 1.0;

  const settingsModal = root.querySelector('#settings-modal') as HTMLElement;
  const howtoModal = root.querySelector('#howto-modal') as HTMLElement;
  const quitModal = root.querySelector('#quit-modal') as HTMLElement;
  const cyberAppEl = root.querySelector('#cyberdef-app') as HTMLElement;

  const sliderSfx = root.querySelector('#slider-sfx') as HTMLInputElement;
  const valSfx = root.querySelector('#val-sfx') as HTMLElement;
  const sliderBgm = root.querySelector('#slider-bgm') as HTMLInputElement;
  const valBgm = root.querySelector('#val-bgm') as HTMLElement;
  const sliderSens = root.querySelector('#slider-sensitivity') as HTMLInputElement;
  const valSens = root.querySelector('#val-sensitivity') as HTMLElement;
  const resetMsg = root.querySelector('#settings-reset-msg') as HTMLElement;

  const openModal = (el: HTMLElement) => {
    el.classList.remove('hidden');
    el.classList.add('flex');
  };

  const closeModal = (el: HTMLElement) => {
    el.classList.add('hidden');
    el.classList.remove('flex');
  };

  const closeAllMenuModals = () => {
    closeModal(settingsModal);
    closeModal(howtoModal);
    closeModal(quitModal);
  };

  root.querySelector('#btn-start')!.addEventListener('click', () => {
    stopMainMenuBgm();
    audio.unlock();
    audio.hitSuccess();
    closeAllMenuModals();
    startOpeningAtBed();
  });

  root.querySelector('#btn-settings')!.addEventListener('click', () => {
    audio.unlock();
    audio.keyClick();
    resetMsg.textContent = '';
    openModal(settingsModal);
  });

  root.querySelector('#btn-howto')!.addEventListener('click', () => {
    audio.unlock();
    audio.keyClick();
    openModal(howtoModal);
  });

  root.querySelector('#btn-quit')!.addEventListener('click', () => {
    audio.unlock();
    audio.keyClick();
    openModal(quitModal);
  });

  const startResumeCountdown = () => {
    clearPauseCountdown();
    isCountdownActive = true;
    floatingSettingsBtn.disabled = true;
    pauseOverlay.classList.remove('hidden');
    pauseOverlay.classList.add('flex');
    pauseCountdownWrap.classList.remove('hidden');
    pauseCountdownWrap.classList.add('flex');

    const showTick = (num: number) => {
      pauseCountdownNum.textContent = String(num);
      pauseCountdownNum.classList.remove('pause-count-pop');
      void pauseCountdownNum.offsetWidth;
      pauseCountdownNum.classList.add('pause-count-pop');
      audio.bootBeep();
    };

    showTick(3);
    pauseCountdownTimers.push(window.setTimeout(() => showTick(2), 1000));
    pauseCountdownTimers.push(window.setTimeout(() => showTick(1), 2000));
    pauseCountdownTimers.push(
      window.setTimeout(() => {
        audio.hitSuccess();
        flushPauseElapsed();
        clearPauseCountdown();
        pauseOverlay.classList.add('hidden');
        pauseOverlay.classList.remove('flex');
        pauseCountdownWrap.classList.add('hidden');
        pauseCountdownWrap.classList.remove('flex');
        isGamePaused = false;
        if (currentScene === 'game') {
          stageEngine?.setPaused(false);
        }
      }, 3000)
    );
  };

  const openSettingsModalFromInGame = () => {
    if (isCountdownActive) return;
    if (!settingsModal.classList.contains('hidden')) return;

    audio.unlock();
    audio.keyClick();
    resetMsg.textContent = '';

    // 3D 방 포인터 락 해제 및 시점 이동/E키 홀드 즉시 일시 정지
    if (currentScene === 'room') {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      if (room3d) {
        room3d.cancelHold();
        if (room3d.mode !== 'paused') {
          roomModeBeforeSettings = room3d.mode;
          room3d.mode = 'paused';
        }
      }
    }

    // 1~30단계 인게임 도중이면 즉시 일시정지 + PAUSED 오버레이 표시
    if (currentScene === 'game' && stageEngine?.isStageActive()) {
      if (pauseStartedAtMs === 0) {
        pauseStartedAtMs = Date.now();
      }
      isGamePaused = true;
      stageEngine.setPaused(true);
      pauseCountdownWrap.classList.add('hidden');
      pauseCountdownWrap.classList.remove('flex');
      pauseOverlay.classList.remove('hidden');
      pauseOverlay.classList.add('flex');
    }

    openModal(settingsModal);
  };

  const closeSettingsModalFlow = () => {
    if (settingsModal.classList.contains('hidden')) return;
    audio.keyClick();
    closeModal(settingsModal);

    if (currentScene === 'room') {
      if (room3d && roomModeBeforeSettings) {
        room3d.mode = roomModeBeforeSettings;
      }
      roomModeBeforeSettings = null;
      return;
    }

    if (currentScene === 'game' && isGamePaused) {
      startResumeCountdown();
    }
  };

  floatingSettingsBtn.addEventListener('click', openSettingsModalFromInGame);

  root.querySelector('#btn-close-settings')!.addEventListener('click', () => {
    closeSettingsModalFlow();
  });

  root.querySelector('#btn-close-howto')!.addEventListener('click', () => {
    audio.keyClick();
    closeModal(howtoModal);
  });

  root.querySelector('#btn-cancel-quit')!.addEventListener('click', () => {
    audio.keyClick();
    closeModal(quitModal);
  });

  root.querySelector('#btn-confirm-quit')!.addEventListener('click', () => {
    stopMainMenuBgm();
    audio.powerDown();
    closeModal(quitModal);
    cyberAppEl.classList.remove('crt-power-off');
    void cyberAppEl.offsetWidth;
    cyberAppEl.classList.add('crt-power-off');
    window.setTimeout(() => {
      switchScene('standby');
      cyberAppEl.classList.remove('crt-power-off');
    }, 620);
  });

  root.querySelector('#btn-standby-wake')!.addEventListener('click', () => {
    audio.unlock();
    audio.hitSuccess();
    switchScene('menu');
  });

  sliderSfx.addEventListener('input', () => {
    const pct = Number(sliderSfx.value);
    valSfx.textContent = `${pct}%`;
    audio.setSfxVolume(pct / 100);
  });

  sliderBgm.addEventListener('input', () => {
    const pct = Number(sliderBgm.value);
    valBgm.textContent = `${pct}%`;
    const vol = Math.max(0, Math.min(1, pct / 100));
    audio.setBgmVolume(vol);
    mainMenuBgm.volume = vol;
    ingameBgm.volume = vol;
  });

  sliderSens.addEventListener('input', () => {
    const mult = Number(sliderSens.value);
    lookSensitivity = mult;
    valSens.textContent = `${mult.toFixed(1)}x`;
    room3d?.setSensitivity(mult);
  });

  root.querySelector('#btn-reset-save')!.addEventListener('click', () => {
    progress = { unlocked: 1, cleared: [], hasBeenHacked: false };
    saveProgress(progress);
    audio.explosion();
    renderStageSelect();
    resetMsg.textContent = '초기화 완료';
  });

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      const rankModalEl = root.querySelector('#rank-modal') as HTMLElement | null;
      if (rankModalEl && !rankModalEl.classList.contains('hidden')) {
        e.preventDefault();
        closeRankModal();
      } else if (!settingsModal.classList.contains('hidden')) {
        e.preventDefault();
        closeSettingsModalFlow();
      } else if (currentScene === 'room' && !notebookModal.classList.contains('hidden')) {
        e.preventDefault();
        closeNotebook();
      } else if (currentScene === 'menu') {
        closeAllMenuModals();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 1. 3D BRIGHT ROOM & OPENING DIALOGUE
  // ---------------------------------------------------------------------------
  const roomDialogue = root.querySelector('#room-dialogue') as HTMLElement;
  const roomDialogueText = root.querySelector('#room-dialogue-text') as HTMLElement;
  const notebookContent = root.querySelector('#notebook-content') as HTMLElement;
  const notebookSearchInput = root.querySelector('#notebook-search') as HTMLInputElement;
  const notebookCountEl = root.querySelector('#notebook-count') as HTMLElement;
  const notebookTabBtns = Array.from(root.querySelectorAll('.notebook-tab-btn')) as HTMLButtonElement[];
  const crosshairDot = root.querySelector('#crosshair-dot') as HTMLElement;
  const roomObjectiveHud = root.querySelector('#room-objective-hud') as HTMLElement;

  const showRoomDialogue = (msg: string, autoHideMs = 3600) => {
    clearTimeout(dialogueHideTimer);
    roomDialogue.classList.remove('hidden');
    typeText(roomDialogueText, msg, 42, () => {
      dialogueHideTimer = window.setTimeout(() => {
        roomDialogue.classList.add('hidden');
      }, autoHideMs);
    });
  };

  let activeNotebookCategory: NotebookCategory = 'all';

  const escapeNotebookHtml = (text: string): string =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const notebookBadgeStyle = (cat: Exclude<NotebookCategory, 'all'>): string => {
    switch (cat) {
      case 'types':
        return 'border-cyan-400/45 bg-cyan-950/50 text-cyan-300';
      case 'control':
        return 'border-amber-400/45 bg-amber-950/50 text-amber-300';
      case 'functions':
        return 'border-[#00ff41]/45 bg-[#072613] text-[#00ff41]';
      case 'errors':
        return 'border-rose-400/45 bg-rose-950/50 text-rose-300';
    }
  };

  const updateNotebookTabStyles = () => {
    notebookTabBtns.forEach((btn) => {
      const cat = (btn.dataset.cat || 'all') as NotebookCategory;
      if (cat === activeNotebookCategory) {
        btn.className =
          'notebook-tab-btn px-3 py-1.5 rounded-md border border-[#00ff41] bg-[#00ff41]/15 text-[#00ff41] text-xs font-bold cursor-pointer transition';
      } else {
        btn.className =
          'notebook-tab-btn px-3 py-1.5 rounded-md border border-white/15 bg-[#080d14] hover:border-white/35 text-slate-300 text-xs font-bold cursor-pointer transition';
      }
    });
  };

  const renderNotebookEntries = () => {
    const query = notebookSearchInput.value.trim().toLowerCase();
    const filtered = PYTHON_NOTEBOOK_ENTRIES.filter((entry) => {
      if (activeNotebookCategory !== 'all' && entry.category !== activeNotebookCategory) {
        return false;
      }
      if (!query) return true;
      const haystack = `${entry.term} ${entry.categoryLabel} ${entry.desc} ${entry.code} ${entry.keywords || ''}`.toLowerCase();
      return haystack.includes(query);
    });

    notebookCountEl.textContent = `${filtered.length}개 항목`;

    if (filtered.length === 0) {
      notebookContent.innerHTML = `
        <div class="h-full min-h-[220px] flex flex-col items-center justify-center text-center py-12 px-4">
          <div class="text-base font-bold text-slate-300">검색 결과가 없습니다.</div>
          <div class="text-xs text-slate-500 mt-1.5 font-code">다른 키워드나 카테고리를 선택해 보세요.</div>
        </div>
      `;
      return;
    }

    notebookContent.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        ${filtered
          .map(
            (entry) => `
          <article class="rounded-lg border border-white/12 bg-[#090e16] hover:border-[#00ff41]/45 transition p-4 flex flex-col justify-between gap-3">
            <div class="space-y-2">
              <div class="flex items-start justify-between gap-2">
                <h4 class="font-code text-base font-black text-[#00ff41] break-words">${escapeNotebookHtml(entry.term)}</h4>
                <span class="shrink-0 px-2 py-0.5 rounded border text-[11px] font-bold ${notebookBadgeStyle(entry.category)}">${escapeNotebookHtml(entry.categoryLabel)}</span>
              </div>
              <p class="text-xs sm:text-[13px] text-slate-200 leading-relaxed">${escapeNotebookHtml(entry.desc)}</p>
            </div>
            <pre class="p-3 rounded-md bg-[#04070c] border border-white/10 font-code text-xs text-emerald-200 overflow-x-auto leading-relaxed"><code>${escapeNotebookHtml(entry.code)}</code></pre>
          </article>
        `
          )
          .join('')}
      </div>
    `;
  };

  notebookTabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      audio.keyClick();
      activeNotebookCategory = (btn.dataset.cat || 'all') as NotebookCategory;
      updateNotebookTabStyles();
      renderNotebookEntries();
      notebookContent.scrollTop = 0;
    });
  });

  notebookSearchInput.addEventListener('input', () => {
    renderNotebookEntries();
    notebookContent.scrollTop = 0;
  });

  const openNotebook = () => {
    if (!room3d) return;
    audio.keyClick();
    room3d.clearInputs();
    room3d.mode = 'paused';
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    activeNotebookCategory = 'all';
    notebookSearchInput.value = '';
    updateNotebookTabStyles();
    renderNotebookEntries();
    notebookContent.scrollTop = 0;
    notebookModal.classList.remove('hidden');
    notebookModal.classList.add('flex');
  };

  const closeNotebook = () => {
    if (notebookModal.classList.contains('hidden')) return;
    notebookSearchInput.blur();
    notebookModal.classList.add('hidden');
    notebookModal.classList.remove('flex');
    if (room3d && currentScene === 'room') {
      room3d.clearInputs();
      room3d.mode = 'explore';
    }
  };

  updateNotebookTabStyles();
  renderNotebookEntries();

  root.querySelector('#btn-close-notebook')!.addEventListener('click', () => {
    audio.keyClick();
    closeNotebook();
  });

  notebookModal.addEventListener('click', (e) => {
    if (e.target === notebookModal) {
      audio.keyClick();
      closeNotebook();
    }
  });

  const ensureRoom3D = () => {
    if (room3d) return;
    const mount = root.querySelector('#room-canvas-mount') as HTMLElement;
    room3d = new DeveloperRoom3D(mount, {
      onHoldProgress: (progress) => {
        if (currentScene !== 'room') {
          resetInteractGauge();
          return;
        }
        updateInteractGauge(progress);
      },
      onHoverChange: (target, label) => {
        if (currentScene !== 'room' || !target) {
          crosshairDot.style.borderColor = 'rgba(15,23,42,0.8)';
          crosshairDot.style.transform = 'scale(1)';
          interactPrompt.classList.add('hidden');
          interactPrompt.classList.remove('flex');
          resetInteractGauge();
          return;
        }
        crosshairDot.style.borderColor = '#00ff41';
        crosshairDot.style.transform = 'scale(1.5)';
        interactLabel.textContent = label;
        interactPrompt.classList.remove('hidden');
        interactPrompt.classList.add('flex');
      },
      onInteract: (target: RoomInteractTarget) => {
        if (!room3d || currentScene !== 'room') return;
        audio.unlock();
        resetInteractGauge();

        if (target === 'door' || target === 'window') {
          audio.errorBuzz();
          showRoomDialogue('지금은 나갈 때가 아니야. 컴퓨터를 켜서 AI아트코딩과윤리 과제를 먼저 끝내야 해.', 3200);
          return;
        }

        if (target === 'notebook' && room3d.mode === 'explore') {
          openNotebook();
          return;
        }

        if (target === 'computer') {
          if (room3d.mode === 'explore') {
            audio.hitSuccess();
            interactPrompt.classList.add('hidden');
            interactPrompt.classList.remove('flex');
            roomDialogue.classList.add('hidden');
            room3d.powerOnAndZoomToOS(() => {
              room3d?.stop();
              if (isSystemRestored) {
                enterRestoredOS(false);
              } else if (sessionHacked) {
                renderStageSelect();
                switchScene('stage-select');
              } else {
                enterFakeOS();
              }
            });
          } else if (room3d.mode === 'ending_poweroff') {
            audio.powerDown();
            interactPrompt.classList.add('hidden');
            interactPrompt.classList.remove('flex');
            room3d.triggerBlackout();
            setTimeout(() => {
              room3d?.stop();
              startEndingCredits();
            }, 900);
          }
        }
      },
    });
    room3d.setSensitivity(lookSensitivity);
  };

  const startOpeningAtBed = () => {
    sessionHacked = false;
    isSystemRestored = false;
    stage30ClearedThisSession = false;
    runStartTimeMs = Date.now();
    runPausedTotalMs = 0;
    pauseStartedAtMs = 0;
    clearElapsedMs = 0;
    submittedPlayerName = '';
    myRankKey = null;
    stopAndResetIngameBgm();
    clearOsTimers();
    switchScene('room');
    ensureRoom3D();
    roomObjectiveHud.textContent = '목표: 책상 위 컴퓨터를 켜서 AI아트코딩과윤리 과제를 진행하세요';
    room3d!.resetOpeningAtBed();
    room3d!.mode = 'explore';
    room3d!.start();
    showRoomDialogue('아, AI아트코딩과윤리 과제해야 하는데... 얼른 컴퓨터부터 켜자.', 4200);
  };

  const returnToRoomFrom2D = () => {
    audio.keyClick();
    clearOsTimers();
    osSequenceStarted = false;
    stageEngine?.stop();
    switchScene('room');
    ensureRoom3D();
    roomObjectiveHud.textContent = isSystemRestored
      ? '목표: 컴퓨터로 돌아가 브라우저에서 AI아트코딩과윤리 과제를 제출하세요'
      : sessionHacked
      ? '목표: 다시 컴퓨터 근처에서 [E]를 눌러 보안 단계를 이어가세요'
      : '목표: 책상 위 컴퓨터에 다가가 [E]를 눌러 AI아트코딩과윤리 과제를 이어가세요';
    room3d!.setComputerPower(true);
    room3d!.setRoomLights(true);
    room3d!.returnFromMonitor();
  };

  fixedReturnBtn.addEventListener('click', returnToRoomFrom2D);

  // ---------------------------------------------------------------------------
  // 2. FAKE OS & HACKING SIMULATION
  // ---------------------------------------------------------------------------
  const osFlashLayer = root.querySelector('#os-flash-layer') as HTMLElement;
  const osDialogue = root.querySelector('#os-dialogue') as HTMLElement;
  const osDialogueText = root.querySelector('#os-dialogue-text') as HTMLElement;
  const osNotepad = root.querySelector('#os-notepad') as HTMLElement;
  const osNotepadText = root.querySelector('#os-notepad-text') as HTMLElement;
  const osStatusMsg = root.querySelector('#os-status-msg') as HTMLElement;

  const clearOsTimers = () => {
    osTimers.forEach((id) => window.clearTimeout(id));
    osTimers = [];
  };

  const typeOsText = (el: HTMLElement, text: string, speed: number, done?: () => void) => {
    el.textContent = '';
    let idx = 0;
    const step = () => {
      if (currentScene !== 'os') return;
      el.textContent = text.slice(0, idx + 1);
      audio.keyClick();
      idx++;
      if (idx < text.length) {
        osTimers.push(window.setTimeout(step, speed));
      } else if (done) {
        done();
      }
    };
    step();
  };

  const triggerHackerIntrusion = () => {
    if (osSequenceStarted) return;
    osSequenceStarted = true;
    clearOsTimers();

    osDialogue.classList.remove('hidden');
    typeOsText(osDialogueText, '어? 왜 안 되는 거지?', 70, () => {
      osTimers.push(
        window.setTimeout(() => {
          if (currentScene !== 'os') return;
          audio.alarm();
          osFlashLayer.classList.remove('os-red-flash');
          void osFlashLayer.offsetWidth;
          osFlashLayer.classList.add('os-red-flash');
          osNotepad.classList.remove('hidden');
          const hackMsg =
            '당신은 해킹당했다. 이 게임을 모두 클리어하지 않으면 AI아트코딩과윤리 과제도, 해킹도 풀어주지 않겠다.';
          typeOsText(osNotepadText, hackMsg, 55, () => {
            sessionHacked = true;
            progress.hasBeenHacked = true;
            saveProgress(progress);
            osTimers.push(
              window.setTimeout(() => {
                if (currentScene !== 'os') return;
                scenes.os.classList.add('glitch-burst');
                audio.explosion();
                osTimers.push(
                  window.setTimeout(() => {
                    scenes.os.classList.remove('glitch-burst');
                    if (currentScene !== 'os') return;
                    renderStageSelect();
                    switchScene('stage-select');
                  }, 620)
                );
              }, 750)
            );
          });
        }, 420)
      );
    });
  };

  const osBrowserWindow = root.querySelector('#os-browser-window') as HTMLElement;
  const osBrowserTitle = root.querySelector('#os-browser-title') as HTMLElement;
  const btnCloseBrowser = root.querySelector('#btn-close-browser') as HTMLButtonElement;
  const btnSubmitAssignment = root.querySelector('#btn-submit-assignment') as HTMLButtonElement;
  const lmsPlayerNameInput = root.querySelector('#lms-player-name') as HTMLInputElement;
  const lmsNameError = root.querySelector('#lms-name-error') as HTMLElement;
  const lmsClearTimeDisplay = root.querySelector('#lms-clear-time-display') as HTMLElement;
  const lmsStatusBadge = root.querySelector('#lms-status-badge') as HTMLElement;
  const lmsSubmitPopup = root.querySelector('#lms-submit-popup') as HTMLElement;
  const lmsSubmitMeta = root.querySelector('#lms-submit-meta') as HTMLElement;
  const osFadeCurtain = root.querySelector('#os-fade-curtain') as HTMLElement;
  let assignmentSubmitted = false;

  const enterFakeOS = () => {
    clearOsTimers();
    osSequenceStarted = false;
    osFlashLayer.classList.remove('os-red-flash');
    scenes.os.classList.remove('glitch-burst');
    osDialogue.classList.add('hidden');
    osNotepad.classList.add('hidden');
    osBrowserWindow.classList.add('hidden');
    osBrowserWindow.classList.remove('flex');
    lmsSubmitPopup.classList.add('hidden');
    lmsSubmitPopup.classList.remove('flex');
    osFadeCurtain.classList.remove('opacity-100');
    osFadeCurtain.classList.add('opacity-0');
    osDialogueText.textContent = '';
    osNotepadText.textContent = '';
    osStatusMsg.textContent = '바탕화면 아이콘을 클릭하여 AI아트코딩과윤리 과제를 시작하세요';
    switchScene('os');
  };

  const enterRestoredOS = (showReliefDialogue = true) => {
    clearOsTimers();
    captureStage30ClearTime();
    isSystemRestored = true;
    osSequenceStarted = false;
    assignmentSubmitted = false;
    osFlashLayer.classList.remove('os-red-flash');
    scenes.os.classList.remove('glitch-burst');
    osNotepad.classList.add('hidden');
    osBrowserWindow.classList.add('hidden');
    osBrowserWindow.classList.remove('flex');
    lmsSubmitPopup.classList.add('hidden');
    lmsSubmitPopup.classList.remove('flex');
    lmsPlayerNameInput.disabled = false;
    lmsPlayerNameInput.value = submittedPlayerName;
    lmsNameError.classList.add('hidden');
    lmsNameError.textContent = '';
    lmsClearTimeDisplay.textContent = formatPlayTime(clearElapsedMs);
    btnSubmitAssignment.disabled = false;
    btnSubmitAssignment.textContent = '과제 제출하기';
    lmsStatusBadge.textContent = '미제출 · 마감 임박';
    lmsStatusBadge.className = 'px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold';
    osFadeCurtain.classList.remove('opacity-100');
    osFadeCurtain.classList.add('opacity-0');
    osStatusMsg.textContent = '시스템 권한 복구 완료 · Chrome 또는 Edge를 열어 AI아트코딩과윤리 과제를 제출하세요';
    switchScene('os');

    if (showReliefDialogue) {
      osDialogue.classList.remove('hidden');
      typeOsText(
        osDialogueText,
        '휴... 드디어 해킹이 풀렸어! 이제 얼른 인터넷에 들어가서 AI아트코딩과윤리 과제부터 제출하자.',
        52,
        () => {
          osTimers.push(
            window.setTimeout(() => {
              if (currentScene === 'os' && isSystemRestored) {
                osDialogue.classList.add('hidden');
              }
            }, 3400)
          );
        }
      );
    } else {
      osDialogue.classList.add('hidden');
    }
  };

  const openRestoredBrowser = (browserName: 'Chrome' | 'Microsoft Edge') => {
    audio.hitSuccess();
    captureStage30ClearTime();
    osDialogue.classList.add('hidden');
    osBrowserTitle.textContent = `${browserName} — 대학교 LMS · AI아트코딩과윤리 과제 제출`;
    lmsClearTimeDisplay.textContent = formatPlayTime(clearElapsedMs);
    osBrowserWindow.classList.remove('hidden');
    osBrowserWindow.classList.add('flex');
    osStatusMsg.textContent = `${browserName} 실행 중 · AI아트코딩과윤리 과제 제출 페이지`;
    if (!assignmentSubmitted) {
      window.setTimeout(() => lmsPlayerNameInput.focus(), 60);
    }
  };

  btnCloseBrowser.addEventListener('click', () => {
    if (assignmentSubmitted) return;
    audio.keyClick();
    osBrowserWindow.classList.add('hidden');
    osBrowserWindow.classList.remove('flex');
  });

  const handleAssignmentSubmit = async () => {
    if (assignmentSubmitted) return;
    const rawName = lmsPlayerNameInput.value.trim();
    if (!rawName) {
      audio.errorBuzz();
      lmsNameError.textContent = '제출자 이름을 입력해 주세요.';
      lmsNameError.classList.remove('hidden');
      lmsPlayerNameInput.focus();
      return;
    }

    lmsNameError.classList.add('hidden');
    lmsNameError.textContent = '';
    assignmentSubmitted = true;
    captureStage30ClearTime();
    lmsPlayerNameInput.disabled = true;
    btnSubmitAssignment.disabled = true;
    btnSubmitAssignment.textContent = '데이터베이스 등록 중...';

    const result = await submitClearRecord(rawName, clearElapsedMs);
    myRankKey = result.key;
    submittedPlayerName = result.record.name;

    audio.stageClear();
    btnSubmitAssignment.textContent = '제출 완료됨';
    lmsStatusBadge.textContent = '제출 완료';
    lmsStatusBadge.className = 'px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold';
    lmsSubmitMeta.textContent = `${result.record.name} · CLEAR TIME ${result.record.timeText}`;
    lmsSubmitPopup.classList.remove('hidden');
    lmsSubmitPopup.classList.add('flex');
    fixedReturnBtn.classList.remove('visible');
    floatingSettingsBtn.classList.remove('visible');

    osTimers.push(
      window.setTimeout(() => {
        osFadeCurtain.classList.remove('opacity-0');
        osFadeCurtain.classList.add('opacity-100');
        osTimers.push(
          window.setTimeout(() => {
            startEndingCredits();
          }, 1050)
        );
      }, 1500)
    );
  };

  btnSubmitAssignment.addEventListener('click', () => {
    void handleAssignmentSubmit();
  });

  lmsPlayerNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleAssignmentSubmit();
    }
  });

  root.querySelectorAll('.os-icon').forEach((icon) => {
    const app = (icon as HTMLElement).dataset.app;
    const handleIconInteract = () => {
      if (currentScene !== 'os') return;
      if (isSystemRestored) {
        if (app === 'chrome') {
          openRestoredBrowser('Chrome');
        } else if (app === 'edge') {
          openRestoredBrowser('Microsoft Edge');
        } else {
          audio.keyClick();
          osStatusMsg.textContent = '먼저 Chrome 또는 Microsoft Edge 브라우저를 열어 AI아트코딩과윤리 과제를 제출하세요.';
        }
        return;
      }
      audio.errorBuzz();
      osStatusMsg.textContent = '오류: 프로그램을 실행할 수 없습니다.';
      triggerHackerIntrusion();
    };
    icon.addEventListener('click', handleIconInteract);
    icon.addEventListener('dblclick', handleIconInteract);
  });

  // ---------------------------------------------------------------------------
  // 3. STAGE SELECT (6-STAGE PAGINATION, CHAMFERED CARDS & SVG ICONS)
  // ---------------------------------------------------------------------------
  const stageGrid = root.querySelector('#stage-grid') as HTMLElement;
  const stageSummary = root.querySelector('#stage-summary') as HTMLElement;
  const stagePageRangeLabel = root.querySelector('#stage-page-range-label') as HTMLElement;
  const stagePageDots = root.querySelector('#stage-page-dots') as HTMLElement;
  const stagePageCounter = root.querySelector('#stage-page-counter') as HTMLElement;
  const stagePageToast = root.querySelector('#stage-page-toast') as HTMLElement;
  const btnStagePrev = root.querySelector('#btn-stage-prev') as HTMLButtonElement;
  const btnStageNext = root.querySelector('#btn-stage-next') as HTMLButtonElement;
  const btnStageHome = root.querySelector('#btn-stage-home') as HTMLButtonElement;

  const STAGES_PER_PAGE = 6;
  const TOTAL_STAGE_PAGES = Math.ceil(STAGES.length / STAGES_PER_PAGE); // 5 pages
  let currentStagePage = 1;
  let stageToastTimer = 0;

  btnStageHome.addEventListener('click', returnToRoomFrom2D);

  const showLockedPageToast = (triggerEl?: HTMLElement | null) => {
    audio.errorBuzz();
    if (triggerEl) {
      triggerEl.classList.remove('shake-error');
      void triggerEl.offsetWidth;
      triggerEl.classList.add('shake-error');
    }
    stagePageToast.classList.remove('opacity-0', 'translate-y-2');
    stagePageToast.classList.add('opacity-100', 'translate-y-0');
    window.clearTimeout(stageToastTimer);
    stageToastTimer = window.setTimeout(() => {
      stagePageToast.classList.add('opacity-0', 'translate-y-2');
      stagePageToast.classList.remove('opacity-100', 'translate-y-0');
    }, 2400);
  };

  const isStagePageUnlocked = (page: number): boolean => {
    if (page <= 1) return true;
    const requiredClearedUpTo = (page - 1) * STAGES_PER_PAGE;
    if (progress.unlocked <= requiredClearedUpTo) return false;
    const clearedSet = new Set(progress.cleared);
    for (let s = 1; s <= requiredClearedUpTo; s++) {
      if (!clearedSet.has(s)) return false;
    }
    return true;
  };

  const getStageIconSvg = (stageId: number, category: string): string => {
    // Stage-specific authentic neon vector icons matched to actual gameplay type
    if (category === 'boss') {
      // Skull / Cyber Boss Hazard Emblem (Stage 10, 20, 30)
      return `
        <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M32 8C19.5 8 11 16.8 11 28.5c0 6.8 3.2 12.2 8.2 15.2V51a3 3 0 0 0 3 3h19.6a3 3 0 0 0 3-3v-7.3c5-3 8.2-8.4 8.2-15.2C53 16.8 44.5 8 32 8z" fill="currentColor" fill-opacity="0.12"/>
          <circle cx="23.5" cy="29.5" r="4.2" fill="currentColor"/>
          <circle cx="40.5" cy="29.5" r="4.2" fill="currentColor"/>
          <path d="M32 36l-2.6 4.5h5.2L32 36z" fill="currentColor"/>
          <line x1="25" y1="47" x2="25" y2="54"/>
          <line x1="32" y1="47" x2="32" y2="54"/>
          <line x1="39" y1="47" x2="39" y2="54"/>
        </svg>
      `;
    }

    if (category === 'code') {
      // </> Code Brackets (Stage 5, 15, 25)
      return `
        <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polyline points="22 18 8 32 22 46"/>
          <polyline points="42 18 56 32 42 46"/>
          <line x1="36" y1="14" x2="28" y2="50"/>
        </svg>
      `;
    }

    if (category === 'mash') {
      if (stageId === 4) {
        // DDoS Traffic Cloud with Up/Down Arrows (Stage 4)
        return `
          <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 46h29a11 11 0 0 0 2-21.8A15 15 0 0 0 20.5 20 12 12 0 0 0 18 46z" fill="currentColor" fill-opacity="0.12"/>
            <path d="M27 42V27m0 0l-4.5 4.5M27 27l4.5 4.5" stroke-width="2.8"/>
            <path d="M39 27v15m0 0l-4.5-4.5M39 42l4.5-4.5" stroke-width="2.8"/>
          </svg>
        `;
      }
      // High-Voltage Lightning Bolt (Stage 14, 22)
      return `
        <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <polygon points="36 6 14 35 30 35 26 58 50 28 34 28 36 6" fill="currentColor" fill-opacity="0.18"/>
        </svg>
      `;
    }

    if (category === 'rhythm') {
      if (stageId === 17 || stageId === 27) {
        // Waveform / Pulse Signal (Stage 17, 27)
        return `
          <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="7" y="14" width="50" height="36" rx="6" fill="currentColor" fill-opacity="0.08" stroke-opacity="0.55"/>
            <polyline points="12 34 20 34 25 21 31 44 37 25 42 34 52 34"/>
          </svg>
        `;
      }
      // Signal Antenna Tower (Stage 3, 13, 23)
      return `
        <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="32" cy="24" r="3.5" fill="currentColor"/>
          <path d="M23.5 16.5a11.5 11.5 0 0 0 0 15"/>
          <path d="M40.5 16.5a11.5 11.5 0 0 1 0 15"/>
          <path d="M17 11a20 20 0 0 0 0 26"/>
          <path d="M47 11a20 20 0 0 1 0 26"/>
          <path d="M32 28L20 55h24L32 28z" fill="currentColor" fill-opacity="0.14"/>
          <line x1="25" y1="43" x2="39" y2="43"/>
        </svg>
      `;
    }

    if (category === 'click') {
      if (stageId === 2 || stageId === 8) {
        // Stacked Database Cylinder (Stage 2, 8)
        return `
          <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <ellipse cx="32" cy="15" rx="19" ry="6.5" fill="currentColor" fill-opacity="0.18"/>
            <path d="M13 15v11c0 3.6 8.5 6.5 19 6.5s19-2.9 19-6.5V15"/>
            <path d="M13 26v11c0 3.6 8.5 6.5 19 6.5s19-2.9 19-6.5V26"/>
            <path d="M13 37v11c0 3.6 8.5 6.5 19 6.5s19-2.9 19-6.5V37"/>
            <circle cx="21" cy="24" r="1.5" fill="currentColor"/>
            <circle cx="21" cy="35" r="1.5" fill="currentColor"/>
            <circle cx="21" cy="46" r="1.5" fill="currentColor"/>
          </svg>
        `;
      }
      if (stageId === 7 || stageId === 24) {
        // Crosshair Aim Target (Stage 7, 24)
        return `
          <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="32" cy="32" r="19" fill="currentColor" fill-opacity="0.08"/>
            <circle cx="32" cy="32" r="10"/>
            <circle cx="32" cy="32" r="2.6" fill="currentColor"/>
            <line x1="32" y1="6" x2="32" y2="16"/>
            <line x1="32" y1="48" x2="32" y2="58"/>
            <line x1="6" y1="32" x2="16" y2="32"/>
            <line x1="48" y1="32" x2="58" y2="32"/>
          </svg>
        `;
      }
      // Cyber Magnifying Glass (Stage 11, 18, 19, 26)
      return `
        <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="28" cy="27" r="15.5" fill="currentColor" fill-opacity="0.12"/>
          <path d="M21 22a9 9 0 0 1 11-2" stroke-opacity="0.7"/>
          <line x1="39.5" y1="38.5" x2="54" y2="53" stroke-width="4"/>
        </svg>
      `;
    }

    // Typing category: Terminal/Keyboard (Stage 9, 12, 21) or Defense Shield (Stage 1, 6, 16, 28, 29)
    if (stageId === 9 || stageId === 12 || stageId === 21) {
      return `
        <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="8" y="13" width="48" height="38" rx="5" fill="currentColor" fill-opacity="0.1"/>
          <line x1="8" y1="22" x2="56" y2="22" stroke-opacity="0.6"/>
          <polyline points="17 31 24 37 17 43" stroke-width="2.8"/>
          <line x1="29" y1="43" x2="45" y2="43" stroke-width="2.8"/>
        </svg>
      `;
    }

    // Cyber Defense Shield (Default Typing: Stage 1, 6, 16, 28, 29)
    return `
      <svg viewBox="0 0 64 64" class="w-14 h-14 sm:w-16 sm:h-16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M32 7L12 15v15c0 13.5 8.5 22.8 20 27 11.5-4.2 20-13.5 20-27V15L32 7z" fill="currentColor" fill-opacity="0.12"/>
        <path d="M32 7v50c11.5-4.2 20-13.5 20-27V15L32 7z" fill="currentColor" fill-opacity="0.22" stroke="none"/>
        <line x1="32" y1="12" x2="32" y2="52" stroke-opacity="0.55"/>
      </svg>
    `;
  };

  const LOCK_ICON_SVG = `
    <svg viewBox="0 0 24 24" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2"/>
      <path d="M8 11V7a4 4 0 0 1 8 0v4"/>
    </svg>
  `;

  const renderStageSelect = (syncPageToUnlocked = true) => {
    const clearedSet = new Set(progress.cleared);
    const unlockedStage = progress.unlocked;

    if (syncPageToUnlocked) {
      currentStagePage = Math.min(TOTAL_STAGE_PAGES, Math.max(1, Math.ceil(unlockedStage / STAGES_PER_PAGE)));
    } else {
      currentStagePage = Math.min(TOTAL_STAGE_PAGES, Math.max(1, currentStagePage));
    }

    // Top-right progress badge reflects actual cleared count (never fake/unlocked count)
    stageSummary.textContent = `Python · ${clearedSet.size} / 30`;

    const startIdx = (currentStagePage - 1) * STAGES_PER_PAGE;
    const endIdx = Math.min(STAGES.length, startIdx + STAGES_PER_PAGE);
    const pageStages = STAGES.slice(startIdx, endIdx);

    stagePageRangeLabel.textContent = `STAGE ${String(startIdx + 1).padStart(2, '0')} - ${String(endIdx).padStart(2, '0')}`;
    stagePageCounter.textContent = `${currentStagePage} / ${TOTAL_STAGE_PAGES}`;

    // Update Prev/Next Hexagonal Arrow States
    if (currentStagePage <= 1) {
      btnStagePrev.classList.add('stage-hex-disabled');
      btnStagePrev.disabled = true;
    } else {
      btnStagePrev.classList.remove('stage-hex-disabled');
      btnStagePrev.disabled = false;
    }

    const nextPage = currentStagePage + 1;
    btnStageNext.classList.remove('stage-hex-disabled', 'stage-hex-locked');
    if (currentStagePage >= TOTAL_STAGE_PAGES) {
      btnStageNext.classList.add('stage-hex-disabled');
      btnStageNext.disabled = true;
    } else {
      btnStageNext.disabled = false;
      if (!isStagePageUnlocked(nextPage)) {
        btnStageNext.classList.add('stage-hex-locked');
      }
    }

    // Render 5 Page Indicator Dots
    stagePageDots.innerHTML = '';
    for (let p = 1; p <= TOTAL_STAGE_PAGES; p++) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `${p}페이지로 이동`);
      const unlocked = isStagePageUnlocked(p);
      dot.className = 'stage-page-dot';
      if (p === currentStagePage) {
        dot.classList.add('stage-page-dot-active');
      } else if (!unlocked) {
        dot.classList.add('stage-page-dot-locked');
      }
      dot.addEventListener('click', () => {
        if (p === currentStagePage) return;
        if (!isStagePageUnlocked(p)) {
          showLockedPageToast(dot);
          return;
        }
        audio.keyClick();
        currentStagePage = p;
        renderStageSelect(false);
      });
      stagePageDots.appendChild(dot);
    }

    // Render 3x2 (6) Chamfered Stage Cards
    stageGrid.innerHTML = '';
    pageStages.forEach((st) => {
      const stageNum = st.id;
      const isCleared = clearedSet.has(stageNum);
      const isCurrent = !isCleared && stageNum === unlockedStage;
      const isLocked = !isCleared && !isCurrent && stageNum > unlockedStage;
      const numLabel = String(stageNum).padStart(2, '0');
      const iconSvg = getStageIconSvg(stageNum, st.category);

      const borderStroke = isCurrent
        ? '#00ff41'
        : isCleared
        ? '#00ff41'
        : 'rgba(148, 163, 184, 0.32)';
      const borderOpacity = isCurrent ? '1' : isCleared ? '0.68' : '0.45';
      const borderWidth = isCurrent ? '2.4' : '1.5';
      const cornerAccentColor = isLocked ? 'rgba(148,163,184,0.22)' : '#00ff41';

      const statusHtml = isCleared
        ? `<span class="inline-flex items-center gap-1.5 font-code text-xs sm:text-sm font-black tracking-wider text-[#00ff41]"><span>✓</span><span>CLEAR</span></span>`
        : isCurrent
        ? `<span class="font-code text-xs font-black tracking-[0.18em] text-[#00ff41]">ACTIVE</span>`
        : `<span class="inline-flex items-center gap-1 text-slate-500 font-code text-xs font-bold">${LOCK_ICON_SVG}<span>LOCKED</span></span>`;

      const iconColorClass = isLocked
        ? 'text-slate-600'
        : st.category === 'boss'
        ? 'text-[#00ff41]'
        : 'text-[#00ff41]/90';

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `stage-card w-full ${
        isCurrent
          ? 'stage-card-active'
          : isCleared
          ? 'stage-card-cleared'
          : 'stage-card-locked'
      }`;

      card.innerHTML = `
        <svg class="stage-card-border-svg" viewBox="0 0 360 200" preserveAspectRatio="none" aria-hidden="true">
          <polygon
            points="14,1 346,1 359,14 359,186 346,199 14,199 1,186 1,14"
            fill="none"
            stroke="${borderStroke}"
            stroke-opacity="${borderOpacity}"
            stroke-width="${borderWidth}"
            vector-effect="non-scaling-stroke"
          />
          <polygon points="342,199 359,182 359,199" fill="${cornerAccentColor}" fill-opacity="${isCurrent ? '0.88' : '0.45'}"/>
          <line x1="18" y1="62" x2="108" y2="62" stroke="${cornerAccentColor}" stroke-opacity="0.28" stroke-width="1" vector-effect="non-scaling-stroke"/>
          <line x1="108" y1="62" x2="122" y2="48" stroke="${cornerAccentColor}" stroke-opacity="0.28" stroke-width="1" vector-effect="non-scaling-stroke"/>
          <line x1="122" y1="48" x2="215" y2="48" stroke="${cornerAccentColor}" stroke-opacity="0.22" stroke-width="1" vector-effect="non-scaling-stroke"/>
        </svg>

        <!-- Top Row: 2-digit Stage Number (Left) & Status (Right) -->
        <div class="relative z-10 flex items-center justify-between w-full">
          <span class="font-code text-2xl sm:text-3xl font-black tracking-wider tabular-nums ${
            isLocked ? 'text-slate-500' : 'text-white'
          }">${numLabel}</span>
          ${statusHtml}
        </div>

        <!-- Bottom Row: Title & 1-Line Description (Left) + Large Game-Type Neon SVG Icon (Right) -->
        <div class="relative z-10 flex items-end justify-between gap-4 mt-5">
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="text-base sm:text-lg font-extrabold tracking-tight truncate ${
              isLocked ? 'text-slate-500' : 'text-white'
            }">${st.name}</div>
            <p class="text-xs leading-snug line-clamp-2 ${
              isLocked ? 'text-slate-600' : 'text-slate-300/85'
            }">${st.gimmick}</p>
          </div>
          <div class="shrink-0 ${iconColorClass}">
            ${iconSvg}
          </div>
        </div>
      `;

      if (isLocked) {
        card.addEventListener('click', () => {
          audio.errorBuzz();
          card.classList.remove('shake-error');
          void card.offsetWidth;
          card.classList.add('shake-error');
        });
      } else {
        card.addEventListener('click', () => {
          audio.hitSuccess();
          launchStage(stageNum);
        });
      }

      if (isCurrent) {
        const wrap = document.createElement('div');
        wrap.className = 'stage-card-active-wrap';
        wrap.appendChild(card);
        stageGrid.appendChild(wrap);
      } else {
        stageGrid.appendChild(card);
      }
    });
  };

  btnStagePrev.addEventListener('click', () => {
    if (currentStagePage <= 1) return;
    audio.keyClick();
    currentStagePage--;
    renderStageSelect(false);
  });

  btnStageNext.addEventListener('click', () => {
    if (currentStagePage >= TOTAL_STAGE_PAGES) return;
    const targetPage = currentStagePage + 1;
    if (!isStagePageUnlocked(targetPage)) {
      showLockedPageToast(btnStageNext);
      return;
    }
    audio.keyClick();
    currentStagePage = targetPage;
    renderStageSelect(false);
  });

  // ---------------------------------------------------------------------------
  // 4. IN-GAME LAUNCH & STAGE CLEAR HANDLER
  // ---------------------------------------------------------------------------
  const recordStageClear = (stageId: number) => {
    if (!progress.cleared.includes(stageId)) {
      progress.cleared.push(stageId);
      progress.cleared.sort((a, b) => a - b);
    }
    if (stageId >= progress.unlocked && stageId < 30) {
      progress.unlocked = stageId + 1;
    }
    saveProgress(progress);
  };

  stageEngine = new StageGameEngine(scenes.game, {
    onExitToSelect: () => {
      renderStageSelect();
      switchScene('stage-select');
    },
    onRecordClear: (stageId: number) => {
      recordStageClear(stageId);
      if (stageId === 30) {
        captureStage30ClearTime();
        stage30ClearedThisSession = true;
        stopAndResetIngameBgm();
      }
    },
    onStageClear: (stageId: number) => {
      recordStageClear(stageId);

      if (stageId === 30) {
        captureStage30ClearTime();
        stage30ClearedThisSession = true;
        stopAndResetIngameBgm();
        stageEngine?.stop();
        runMalwareUninstallSequence();
      } else {
        renderStageSelect();
        switchScene('stage-select');
      }
    },
  });

  const launchStage = (stageId: number) => {
    switchScene('game');
    stageEngine!.startStage(stageId);
  };

  // ---------------------------------------------------------------------------
  // 5. STAGE 30 CLEAR -> MALWARE UNINSTALL -> RESTORED OS -> ENDING CREDITS
  // ---------------------------------------------------------------------------
  const uninstallOverlay = root.querySelector('#malware-uninstall-overlay') as HTMLElement;
  const uninstallCard = root.querySelector('#malware-uninstall-card') as HTMLElement;
  const uninstallBadge = root.querySelector('#uninstall-badge') as HTMLElement;
  const uninstallTitle = root.querySelector('#uninstall-title') as HTMLElement;
  const uninstallPct = root.querySelector('#uninstall-pct') as HTMLElement;
  const uninstallBar = root.querySelector('#uninstall-bar') as HTMLElement;
  const uninstallStatus = root.querySelector('#uninstall-status') as HTMLElement;

  const runMalwareUninstallSequence = () => {
    captureStage30ClearTime();
    stage30ClearedThisSession = true;
    stopAndResetIngameBgm();
    resetPauseState();
    fixedReturnBtn.classList.remove('visible');
    floatingSettingsBtn.classList.remove('visible');
    uninstallOverlay.classList.remove('hidden', 'bg-sky-950/65');
    uninstallOverlay.classList.add('flex', 'bg-black/90');
    uninstallCard.className =
      'w-full max-w-lg rounded-xl border border-[#00ff41]/60 bg-[#0c121a]/95 p-7 shadow-[0_0_50px_rgba(0,255,65,0.22)] space-y-5 transition-all duration-700';
    uninstallBadge.textContent = 'SYSTEM SECURITY PURGE';
    uninstallBadge.className = 'text-[11px] font-code font-bold tracking-[0.22em] text-[#00ff41]';
    uninstallTitle.textContent = '해킹 프로그램(CYBER-DEF) 삭제 중...';
    uninstallTitle.className = 'text-lg font-black text-white';
    uninstallPct.textContent = '0%';
    uninstallPct.className = 'text-xl font-black font-code text-[#00ff41] tabular-nums';
    uninstallBar.style.width = '0%';
    uninstallStatus.textContent = '원격 침입 프로세스 및 커널 훅을 종료하는 중입니다...';
    uninstallStatus.className = 'text-xs sm:text-sm font-medium text-slate-300 leading-relaxed min-h-[2.5rem]';

    const startTime = performance.now();
    const durationMs = 2000;

    const animateUninstall = (now: number) => {
      const t = Math.min(1, (now - startTime) / durationMs);
      const eased = 1 - Math.pow(1 - t, 2.2);
      const pct = Math.round(eased * 100);
      uninstallPct.textContent = `${pct}%`;
      uninstallBar.style.width = `${pct}%`;

      if (pct >= 30 && pct < 70) {
        uninstallStatus.textContent = 'CYBER-DEF 악성 모듈 및 방화벽 잠금 파일 제거 중...';
      } else if (pct >= 70 && pct < 100) {
        uninstallStatus.textContent = 'Windows 셸·브라우저 실행 권한 및 레지스트리 복구 중...';
      }

      if (t < 1) {
        requestAnimationFrame(animateUninstall);
      } else {
        audio.stageClear();
        uninstallOverlay.classList.remove('bg-black/90');
        uninstallOverlay.classList.add('bg-sky-950/65');
        uninstallCard.className =
          'w-full max-w-lg rounded-xl border border-sky-300/80 bg-white/95 p-7 shadow-[0_20px_60px_rgba(56,189,248,0.35)] space-y-5 transition-all duration-700';
        uninstallBadge.textContent = 'SYSTEM RESTORED';
        uninstallBadge.className = 'text-[11px] font-code font-bold tracking-[0.22em] text-blue-600';
        uninstallTitle.textContent = '악성 프로그램 삭제 완료';
        uninstallTitle.className = 'text-lg font-black text-slate-900';
        uninstallPct.className = 'text-xl font-black font-code text-blue-600 tabular-nums';
        uninstallStatus.textContent =
          '악성 프로그램이 완전히 제거되었습니다. 시스템 권한이 복구됩니다.';
        uninstallStatus.className = 'text-sm font-bold text-slate-800 leading-relaxed min-h-[2.5rem]';

        window.setTimeout(() => {
          uninstallOverlay.classList.add('hidden');
          uninstallOverlay.classList.remove('flex');
          enterRestoredOS(true);
        }, 1500);
      }
    };

    requestAnimationFrame(animateUninstall);
  };

  const creditsTrack = root.querySelector('#ending-credits-track') as HTMLElement;
  const endingActions = root.querySelector('#ending-actions') as HTMLElement;
  const endingClearSummary = root.querySelector('#ending-clear-summary') as HTMLElement;
  const btnSkipCredits = root.querySelector('#btn-skip-credits') as HTMLButtonElement;
  const btnEndingRank = root.querySelector('#btn-ending-rank') as HTMLButtonElement;
  const rankModal = root.querySelector('#rank-modal') as HTMLElement;
  const rankTableBody = root.querySelector('#rank-table-body') as HTMLElement;
  const rankSyncStatus = root.querySelector('#rank-sync-status') as HTMLElement;
  const rankFooterNote = root.querySelector('#rank-footer-note') as HTMLElement;
  const btnCloseRank = root.querySelector('#btn-close-rank') as HTMLButtonElement;

  const renderRankLoading = () => {
    rankTableBody.replaceChildren();
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'py-12 text-center font-code text-sm text-[#00ff41]';
    td.textContent = '데이터베이스 동기화 중...';
    tr.appendChild(td);
    rankTableBody.appendChild(tr);
  };

  const renderRankTable = (records: RankRecord[], source: 'firebase' | 'local') => {
    if (source === 'firebase') {
      rankSyncStatus.textContent = 'LIVE · FIREBASE';
      rankSyncStatus.className =
        'px-2 py-0.5 rounded bg-[#00ff41]/15 border border-[#00ff41]/45 text-[10px] font-code font-bold text-[#00ff41] tracking-wider';
    } else {
      rankSyncStatus.textContent = 'OFFLINE · LOCAL';
      rankSyncStatus.className =
        'px-2 py-0.5 rounded bg-amber-500/15 border border-amber-400/45 text-[10px] font-code font-bold text-amber-300 tracking-wider';
    }

    rankTableBody.replaceChildren();

    if (records.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'py-12 text-center text-sm text-slate-400';
      td.textContent = '아직 등록된 클리어 기록이 없습니다.';
      tr.appendChild(td);
      rankTableBody.appendChild(tr);
      rankFooterNote.textContent = '첫 번째 클리어 기록을 등록해 보세요.';
      return;
    }

    let myRankIndex = -1;

    records.forEach((rec, index) => {
      const rankNum = index + 1;
      const isMe = Boolean(myRankKey && rec.key === myRankKey);
      if (isMe) myRankIndex = rankNum;

      const tr = document.createElement('tr');
      if (isMe) {
        tr.className =
          'bg-[#00ff41]/14 text-[#00ff41] shadow-[inset_3px_0_0_#00ff41] font-bold transition-colors';
      } else {
        tr.className = 'text-slate-200 hover:bg-white/5 transition-colors';
      }

      const tdRank = document.createElement('td');
      tdRank.className = 'py-3 px-3 font-code font-black tabular-nums';
      tdRank.textContent = `${rankNum}위`;
      if (!isMe && rankNum === 1) {
        tdRank.classList.add('text-amber-300');
      } else if (!isMe && rankNum === 2) {
        tdRank.classList.add('text-slate-200');
      } else if (!isMe && rankNum === 3) {
        tdRank.classList.add('text-amber-600');
      }

      const tdName = document.createElement('td');
      tdName.className = 'py-3 px-3 font-semibold';
      const nameWrap = document.createElement('div');
      nameWrap.className = 'flex items-center gap-2 min-w-0';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'truncate';
      nameSpan.textContent = rec.name;
      nameWrap.appendChild(nameSpan);

      if (isMe) {
        const badge = document.createElement('span');
        badge.className =
          'shrink-0 px-1.5 py-0.5 rounded bg-[#00ff41] text-black font-code text-[10px] font-black tracking-wider';
        badge.textContent = 'MY RECORD';
        nameWrap.appendChild(badge);
      }
      tdName.appendChild(nameWrap);

      const tdTime = document.createElement('td');
      tdTime.className = 'py-3 px-3 text-right font-code font-bold tabular-nums';
      tdTime.textContent = rec.timeText || formatPlayTime(rec.timeMs);

      tr.appendChild(tdRank);
      tr.appendChild(tdName);
      tr.appendChild(tdTime);
      rankTableBody.appendChild(tr);
    });

    if (myRankIndex > 0) {
      rankFooterNote.textContent = `총 ${records.length}명 등록 · 내 순위: ${myRankIndex}위 (${formatPlayTime(clearElapsedMs)})`;
    } else {
      rankFooterNote.textContent = `총 ${records.length}명의 실시간 클리어 기록이 동기화되었습니다.`;
    }
  };

  function closeRankModal() {
    if (unsubscribeRankings) {
      unsubscribeRankings();
      unsubscribeRankings = null;
    }
    closeModal(rankModal);
  }

  const openRankModal = () => {
    audio.keyClick();
    if (unsubscribeRankings) {
      unsubscribeRankings();
      unsubscribeRankings = null;
    }
    rankSyncStatus.textContent = 'SYNCING...';
    rankSyncStatus.className =
      'px-2 py-0.5 rounded bg-[#00ff41]/15 border border-[#00ff41]/40 text-[10px] font-code font-bold text-[#00ff41] tracking-wider';
    renderRankLoading();
    openModal(rankModal);
    unsubscribeRankings = subscribeGlobalRankings((records, source) => {
      renderRankTable(records, source);
    });
  };

  btnEndingRank.addEventListener('click', openRankModal);

  btnCloseRank.addEventListener('click', () => {
    audio.keyClick();
    closeRankModal();
  });

  rankModal.addEventListener('click', (e) => {
    if (e.target === rankModal) {
      audio.keyClick();
      closeRankModal();
    }
  });

  const finishEndingCredits = () => {
    window.clearTimeout(endingTimer);
    creditsTrack.classList.remove('credits-roll-anim');
    creditsTrack.classList.add('hidden');
    btnSkipCredits.classList.add('hidden');
    if (submittedPlayerName && clearElapsedMs > 0) {
      endingClearSummary.textContent = `${submittedPlayerName} · CLEAR TIME ${formatPlayTime(clearElapsedMs)}`;
      endingClearSummary.classList.remove('hidden');
    } else {
      endingClearSummary.classList.add('hidden');
    }
    if (currentScene === 'ending') {
      endingActions.classList.remove('opacity-0', 'pointer-events-none');
      endingActions.classList.add('opacity-100', 'pointer-events-auto');
    }
  };

  const startEndingCredits = () => {
    window.clearTimeout(endingTimer);
    closeRankModal();
    endingActions.classList.add('opacity-0', 'pointer-events-none');
    endingActions.classList.remove('opacity-100', 'pointer-events-auto');
    creditsTrack.classList.remove('hidden', 'credits-roll-anim');
    btnSkipCredits.classList.remove('hidden');
    void creditsTrack.offsetWidth;
    creditsTrack.classList.add('credits-roll-anim');
    switchScene('ending');

    endingTimer = window.setTimeout(() => {
      finishEndingCredits();
    }, 17800);
  };

  btnSkipCredits.addEventListener('click', () => {
    audio.keyClick();
    finishEndingCredits();
  });

  root.querySelector('#btn-ending-restart')!.addEventListener('click', () => {
    closeRankModal();
    audio.hitSuccess();
    window.location.reload();
  });

  // ---------------------------------------------------------------------------
  // 1. LINUX BOOT SEQUENCE (1.5s FAST SCROLL -> STRONG GLITCH -> MAIN MENU)
  // ---------------------------------------------------------------------------
  const bootLogStream = root.querySelector('#boot-log-stream') as HTMLElement;
  const LINUX_BOOT_LOGS: string[] = [
    '[    0.000000] Linux version 6.8.0-cyberdef (gcc 13.2.0) #42-SMP PREEMPT_DYNAMIC',
    '[    0.014210] BIOS-provided physical RAM map: [mem 0x0000000000000000-0x00000003ffffffff]',
    '[    0.039812] ACPI: Core revision 20240322 initialized',
    '[    0.081405] smpboot: CPU0: CyberCore x86_64 Neural Processor (16 cores)',
    '[    0.126901] PCI: Using configuration type 1 for base access',
    '[    0.194533] systemd[1]: systemd 255.4 running in system mode (+PAM +SELINUX +CRYPTO)',
    '[  OK  ] Created slice system-modprobe.slice.',
    '[  OK  ] Started Dispatch Password Requests to Console Directory Watch.',
    '[  OK  ] Reached target Local Encrypted Volumes.',
    '[  OK  ] Mounted POSIX Message Queue File System.',
    '[  OK  ] Mounted Kernel Debug File System.',
    '[  OK  ] Started Journal Service.',
    '[  OK  ] Remounted Root and Kernel File Systems.',
    '[  OK  ] Started udev Kernel Device Manager.',
    '[  OK  ] Found device /dev/nvme0n1p2 (CYBER-DEF_ROOT).',
    '[  OK  ] Mounted /var/lib/cyberdef/python3-runtime.',
    '[  OK  ] Started Network Manager & Encrypted Loopback Interface.',
    '[  OK  ] Reached target Network is Online.',
    '[  OK  ] Initializing WebGL 3D Narrative Environment (Three.js)...',
    '[  OK  ] Loaded Composite Mesh Room Assets & Proximity Sensors.',
    '[  OK  ] Starting Python 3.12 Defense Engine (30 Security Protocols)...',
    '[ WARN ] Unrecognized remote socket detected on port 443 -> monitoring...',
    '[  OK  ] Mounting Fake-OS Sandbox Layer & Intrusion Watchdog.',
    '[  OK  ] Calibrating High-DPI Canvas & Particle Object Pool (260 slots).',
    '[  OK  ] Loading HUD Interface: CYBER-DEF v2.6',
    'cyberdef-os login: root (automatic login)',
    '>>> BOOT SEQUENCE COMPLETE. LAUNCHING CYBER-DEF HUD...',
  ];

  const runBootSequence = () => {
    switchScene('boot');
    scenes.boot.classList.remove('glitch-burst');
    bootLogStream.classList.remove('boot-log-scroll');
    bootLogStream.innerHTML = LINUX_BOOT_LOGS.map((line) => {
      if (line.startsWith('[  OK  ]')) {
        return `<div><span class="text-emerald-300 font-bold">[  OK  ]</span> ${line.slice(8)}</div>`;
      }
      if (line.startsWith('[ WARN ]')) {
        return `<div class="text-[#ff4da6]"><span class="font-bold">[ WARN ]</span> ${line.slice(8)}</div>`;
      }
      if (line.startsWith('>>>')) {
        return `<div class="text-white font-bold pt-1">${line}</div>`;
      }
      return `<div class="text-[#00ff41]/85">${line}</div>`;
    }).join('');

    void bootLogStream.offsetWidth;
    bootLogStream.classList.add('boot-log-scroll');

    window.setTimeout(() => {
      scenes.boot.classList.add('glitch-burst');
      audio.explosion();
      window.setTimeout(() => {
        scenes.boot.classList.remove('glitch-burst');
        switchScene('menu');
      }, 420);
    }, 1500);
  };

  // Start immediately with Linux Boot Sequence -> Glitch -> Main Menu
  runBootSequence();
}
