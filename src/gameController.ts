import { audio } from './audio';
import { NOTEBOOK_CHAPTERS, STAGES } from './data/stages';
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

      <!-- ALWAYS EXPOSED FIXED RETURN TO ROOM BUTTON -->
      <button id="fixed-return-room-btn" class="fixed-return-btn" title="방으로 돌아가기">
        <span>방으로 돌아가기</span>
      </button>

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

        <!-- SETTINGS MODAL -->
        <div id="settings-modal" class="hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-md items-center justify-center p-4">
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
          <div class="px-4 py-2 rounded-md bg-slate-900/75 text-white text-xs shadow-lg border border-white/15">
            <span class="text-[#00ff41] font-bold mr-2">EXPLORATION</span>
            <span>WASD 이동 · 화면 클릭/드래그 회전 · 사물 근처에서 [E] 상호작용</span>
          </div>
          <div id="room-objective-hud" class="px-4 py-2 rounded-md bg-slate-900/75 text-[#00ff41] text-xs font-bold border border-[#00ff41]/35 shadow-lg">
            목표: 책상 위 컴퓨터에 다가가 전원을 켜세요
          </div>
        </div>

        <!-- Center Crosshair -->
        <div class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center">
          <div id="crosshair-dot" class="w-3 h-3 rounded-full border-2 border-slate-900/80 bg-white/60 transition-transform duration-150 shadow"></div>
        </div>

        <!-- Bottom Proximity Interact Tooltip -->
        <div id="room-interact-prompt" class="hidden fixed bottom-28 left-1/2 -translate-x-1/2 z-20 px-5 py-2.5 rounded-md bg-slate-950/90 border border-[#00ff41] text-sm font-bold text-[#00ff41] pointer-events-none shadow-lg"></div>

        <!-- Room Bottom Dialogue Box -->
        <div id="room-dialogue" class="hidden fixed bottom-7 left-1/2 -translate-x-1/2 z-30 w-[92vw] max-w-2xl rounded-lg bg-slate-950/92 border-2 border-[#00ff41]/80 px-6 py-4 shadow-2xl pointer-events-none">
          <div class="text-xs font-bold text-[#00ff41] mb-1">주인공</div>
          <div id="room-dialogue-text" class="text-sm sm:text-base font-medium text-white leading-relaxed"></div>
        </div>

        <!-- Python Study Notebook Modal -->
        <div id="notebook-modal" class="hidden fixed inset-0 z-40 bg-black/75 items-center justify-center p-6">
          <div class="w-full max-w-3xl max-h-[85vh] rounded-lg bg-[#111622] border-2 border-[#00ff41]/60 flex flex-col overflow-hidden shadow-2xl">
            <div class="flex items-center justify-between px-6 py-4 bg-[#0a0e17] border-b border-white/10">
              <div>
                <div class="text-xs text-[#00ff41] font-bold">PYTHON STUDY NOTE</div>
                <h3 class="text-lg font-bold text-white">파이썬 기초 지식 수첩</h3>
              </div>
              <button id="btn-close-notebook" class="cyber-btn px-4 py-2 text-xs font-bold cursor-pointer">닫기 [ESC / E]</button>
            </div>
            <div id="notebook-content" class="p-6 overflow-y-auto space-y-5 text-sm"></div>
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
            <span class="text-xs font-medium drop-shadow text-center">웹과제_폴더</span>
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
                대학교 LMS - 웹 프로그래밍 과제 제출
              </span>
            </div>
            <button id="btn-close-browser" type="button" class="text-xs font-bold text-slate-500 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-300/60 cursor-pointer">✕</button>
          </div>
          <!-- Address Bar -->
          <div class="bg-slate-100 px-4 py-2 border-b border-slate-200 flex items-center gap-2 text-xs text-slate-600">
            <span class="px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">🔒 HTTPS</span>
            <div class="flex-1 bg-white border border-slate-300 rounded-full px-3.5 py-1 font-code text-[11px] text-slate-700 truncate">
              https://lms.cyber-university.ac.kr/courses/web-programming/assignment/final
            </div>
          </div>
          <!-- University LMS Content -->
          <div class="p-6 sm:p-8 bg-slate-50 space-y-5 max-h-[70vh] overflow-y-auto">
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <div class="text-xs font-bold text-blue-600 tracking-wide">UNIVERSITY LMS · 온라인 강의실</div>
                <h3 class="text-xl font-black text-slate-900 mt-0.5">웹 프로그래밍 과제 제출 페이지</h3>
              </div>
              <span id="lms-status-badge" class="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">
                미제출 · 마감 임박
              </span>
            </div>

            <div class="rounded-lg border border-slate-200 bg-white p-5 space-y-4 shadow-xs">
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm border-b border-slate-100 pb-3">
                <div class="text-slate-500 font-semibold">과제명</div>
                <div class="sm:col-span-2 font-bold text-slate-900">최종 웹 프로젝트 제출</div>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm border-b border-slate-100 pb-3">
                <div class="text-slate-500 font-semibold">교과목</div>
                <div class="sm:col-span-2 text-slate-700">AI 아트코딩과 윤리 · 웹 프로그래밍 실습</div>
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
              <p class="text-sm font-semibold text-slate-700">과제가 성공적으로 제출되었습니다!</p>
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
            <span id="os-status-msg" class="text-xs text-slate-300">바탕화면 아이콘을 클릭하여 과제를 시작하세요</span>
          </div>
          <div class="flex items-center gap-4">
            <span id="os-live-clock" class="text-xs font-code font-semibold text-white tabular-nums">00:00:00</span>
          </div>
        </div>
      </section>

      <!-- 3. STAGE SELECT (PYTHON ONLY, NO CHEATS) -->
      <section id="scene-stage-select" class="cyber-scene flex-col bg-[#0a0b0e] overflow-y-auto">
        <header class="px-6 py-4 pr-44 border-b border-white/10 bg-[#10131a] flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="text-xs text-[#00ff41] font-bold tracking-widest">PYTHON DEFENSE PROTOCOL</div>
            <h2 class="text-xl font-black text-white">파이썬 보안 스테이지 선택 (1 - 30)</h2>
          </div>
          <div id="stage-summary" class="text-xs text-slate-300 font-medium tabular-nums"></div>
        </header>

        <main class="flex-1 p-6 max-w-6xl w-full mx-auto flex flex-col gap-5">
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>순차적으로 30단계를 모두 돌파하면 해커의 시스템을 셧다운할 수 있습니다.</span>
            <div class="flex items-center gap-4">
              <span class="text-[#00ff41]">■ 현재 도전 단계</span>
              <span class="text-[#00e5ff]">■ 클리어 완료</span>
              <span class="text-slate-500">🔒 잠긴 단계</span>
            </div>
          </div>

          <div id="stage-grid" class="grid grid-cols-2 sm:grid-cols-5 lg:grid-cols-6 gap-3"></div>
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
              AI 아트코딩과 윤리 과제 심사 및 피드백에 참여해 주신 모든 분들<br />
              그리고 30단계의 방화벽을 뚫고 과제를 제출한 PLAYER
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
          <p class="text-sm text-slate-400">과제가 성공적으로 제출되었습니다.</p>
          <button id="btn-ending-restart" type="button" class="cyber-btn px-10 py-3.5 text-sm font-black tracking-[0.22em] cursor-pointer shadow-[0_0_24px_rgba(0,255,65,0.35)]">
            다시 시작
          </button>
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

  const switchScene = (next: SceneId) => {
    (Object.keys(scenes) as SceneId[]).forEach((k) => {
      if (k === next) scenes[k].classList.add('active');
      else scenes[k].classList.remove('active');
    });
    currentScene = next;

    if (next === 'os' || next === 'stage-select' || next === 'game') {
      fixedReturnBtn.classList.add('visible');
    } else {
      fixedReturnBtn.classList.remove('visible');
    }
  };

  // Real-time digital clock on OS taskbar
  const clockEl = root.querySelector('#os-live-clock') as HTMLElement;
  const updateClock = () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${hh}:${mm}:${ss}`;
  };
  updateClock();
  window.setInterval(updateClock, 1000);

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

  root.querySelector('#btn-close-settings')!.addEventListener('click', () => {
    audio.keyClick();
    closeModal(settingsModal);
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
    audio.setBgmVolume(pct / 100);
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
    if (e.code === 'Escape' && currentScene === 'menu') {
      closeAllMenuModals();
    }
  });

  // ---------------------------------------------------------------------------
  // 1. 3D BRIGHT ROOM & OPENING DIALOGUE
  // ---------------------------------------------------------------------------
  const roomDialogue = root.querySelector('#room-dialogue') as HTMLElement;
  const roomDialogueText = root.querySelector('#room-dialogue-text') as HTMLElement;
  const notebookModal = root.querySelector('#notebook-modal') as HTMLElement;
  const notebookContent = root.querySelector('#notebook-content') as HTMLElement;
  const crosshairDot = root.querySelector('#crosshair-dot') as HTMLElement;
  const interactPrompt = root.querySelector('#room-interact-prompt') as HTMLElement;
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

  notebookContent.innerHTML = NOTEBOOK_CHAPTERS.map(
    (ch) => `
      <div class="border border-white/10 bg-[#0b0e17] rounded-md p-4 space-y-2">
        <div class="font-bold text-[#00ff41]">${ch.title}</div>
        <pre class="p-3 bg-black/70 rounded text-xs text-emerald-200 overflow-x-auto leading-relaxed">${ch.code}</pre>
        <p class="text-xs text-slate-300">${ch.note}</p>
      </div>
    `
  ).join('');

  const closeNotebook = () => {
    notebookModal.classList.add('hidden');
    notebookModal.classList.remove('flex');
    if (room3d && currentScene === 'room') {
      room3d.mode = 'explore';
    }
  };

  root.querySelector('#btn-close-notebook')!.addEventListener('click', () => {
    audio.keyClick();
    closeNotebook();
  });

  window.addEventListener('keydown', (e) => {
    if (currentScene === 'room' && !notebookModal.classList.contains('hidden')) {
      if (e.code === 'Escape' || e.code === 'KeyE') {
        e.preventDefault();
        closeNotebook();
      }
    }
  });

  const ensureRoom3D = () => {
    if (room3d) return;
    const mount = root.querySelector('#room-canvas-mount') as HTMLElement;
    room3d = new DeveloperRoom3D(mount, {
      onHoverChange: (target, label) => {
        if (target) {
          crosshairDot.style.borderColor = '#00ff41';
          crosshairDot.style.transform = 'scale(1.5)';
          interactPrompt.textContent = label;
          interactPrompt.classList.remove('hidden');
        } else {
          crosshairDot.style.borderColor = 'rgba(15,23,42,0.8)';
          crosshairDot.style.transform = 'scale(1)';
          interactPrompt.classList.add('hidden');
        }
      },
      onInteract: (target: RoomInteractTarget) => {
        if (!room3d) return;
        audio.unlock();

        if (target === 'door' || target === 'window') {
          audio.errorBuzz();
          showRoomDialogue('지금은 나갈 때가 아니야. 컴퓨터를 켜서 과제를 먼저 끝내야 해.', 3200);
          return;
        }

        if (target === 'notebook' && room3d.mode === 'explore') {
          audio.keyClick();
          room3d.mode = 'paused';
          if (document.pointerLockElement) document.exitPointerLock();
          notebookModal.classList.remove('hidden');
          notebookModal.classList.add('flex');
          return;
        }

        if (target === 'computer') {
          if (room3d.mode === 'explore') {
            audio.hitSuccess();
            interactPrompt.classList.add('hidden');
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
    clearOsTimers();
    ensureRoom3D();
    roomObjectiveHud.textContent = '목표: 책상 위 컴퓨터에 다가가 전원을 켜세요';
    room3d!.resetOpeningAtBed();
    room3d!.mode = 'explore';
    room3d!.start();
    switchScene('room');
    showRoomDialogue('아, 웹 페이지 과제해야 하는데... 얼른 컴퓨터부터 켜자.', 4200);
  };

  fixedReturnBtn.addEventListener('click', () => {
    audio.keyClick();
    clearOsTimers();
    osSequenceStarted = false;
    stageEngine?.stop();
    ensureRoom3D();
    roomObjectiveHud.textContent = isSystemRestored
      ? '목표: 컴퓨터로 돌아가 브라우저에서 웹 과제를 제출하세요'
      : sessionHacked
      ? '목표: 다시 컴퓨터 근처에서 [E]를 눌러 보안 단계를 이어가세요'
      : '목표: 책상 위 컴퓨터에 다가가 [E]를 눌러 작업을 이어가세요';
    room3d!.setComputerPower(true);
    room3d!.setRoomLights(true);
    room3d!.returnFromMonitor();
    switchScene('room');
  });

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
            '당신은 해킹당했다. 이 게임을 모두 클리어하지 않으면 해킹을 풀어주지 않겠다.';
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
  const lmsStatusBadge = root.querySelector('#lms-status-badge') as HTMLElement;
  const lmsSubmitPopup = root.querySelector('#lms-submit-popup') as HTMLElement;
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
    osStatusMsg.textContent = '바탕화면 아이콘을 클릭하여 과제를 시작하세요';
    switchScene('os');
  };

  const enterRestoredOS = (showReliefDialogue = true) => {
    clearOsTimers();
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
    btnSubmitAssignment.disabled = false;
    btnSubmitAssignment.textContent = '과제 제출하기';
    lmsStatusBadge.textContent = '미제출 · 마감 임박';
    lmsStatusBadge.className = 'px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold';
    osFadeCurtain.classList.remove('opacity-100');
    osFadeCurtain.classList.add('opacity-0');
    osStatusMsg.textContent = '시스템 권한 복구 완료 · Chrome 또는 Edge를 열어 과제를 제출하세요';
    switchScene('os');

    if (showReliefDialogue) {
      osDialogue.classList.remove('hidden');
      typeOsText(
        osDialogueText,
        '휴... 드디어 해킹이 풀렸어! 이제 얼른 인터넷에 들어가서 과제부터 제출하자.',
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
    osDialogue.classList.add('hidden');
    osBrowserTitle.textContent = `${browserName} — 대학교 LMS · 웹 프로그래밍 과제 제출`;
    osBrowserWindow.classList.remove('hidden');
    osBrowserWindow.classList.add('flex');
    osStatusMsg.textContent = `${browserName} 실행 중 · 최종 웹 프로젝트 과제 제출 페이지`;
  };

  btnCloseBrowser.addEventListener('click', () => {
    if (assignmentSubmitted) return;
    audio.keyClick();
    osBrowserWindow.classList.add('hidden');
    osBrowserWindow.classList.remove('flex');
  });

  btnSubmitAssignment.addEventListener('click', () => {
    if (assignmentSubmitted) return;
    assignmentSubmitted = true;
    audio.stageClear();
    btnSubmitAssignment.disabled = true;
    btnSubmitAssignment.textContent = '제출 완료됨';
    lmsStatusBadge.textContent = '제출 완료';
    lmsStatusBadge.className = 'px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold';
    lmsSubmitPopup.classList.remove('hidden');
    lmsSubmitPopup.classList.add('flex');
    fixedReturnBtn.classList.remove('visible');

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
          osStatusMsg.textContent = '먼저 Chrome 또는 Microsoft Edge 브라우저를 열어 과제를 제출하세요.';
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
  // 3. STAGE SELECT (PYTHON ONLY, NO CHEAT BUTTONS)
  // ---------------------------------------------------------------------------
  const stageGrid = root.querySelector('#stage-grid') as HTMLElement;
  const stageSummary = root.querySelector('#stage-summary') as HTMLElement;

  const renderStageSelect = () => {
    const clearedSet = new Set(progress.cleared);
    const unlockedStage = progress.unlocked;
    stageSummary.textContent = `언어: Python · 클리어: ${clearedSet.size} / 30 · 현재 도전: ${unlockedStage}단계`;

    stageGrid.innerHTML = '';
    STAGES.forEach((st) => {
      const stageNum = st.id;
      const isCleared = clearedSet.has(stageNum);
      const isCurrent = !isCleared && stageNum === unlockedStage;

      const btn = document.createElement('button');

      if (isCleared) {
        // 1. 실제로 게임 목표를 달성해 클리어 판정을 받은 단계만 CLEAR 및 체크 표시
        btn.className =
          'p-3.5 rounded-md border text-left flex flex-col justify-between min-h-[94px] cursor-pointer transition-transform duration-150 bg-[#0c1a1c] border-[#00e5ff]/60 hover:border-[#00e5ff]';
        btn.innerHTML = `
          <div class="flex items-center justify-between w-full">
            <span class="text-lg font-black tabular-nums font-code text-[#00e5ff]">${String(stageNum).padStart(2, '0')}</span>
            <span class="text-[11px] font-bold text-[#00e5ff]">✓ CLEAR</span>
          </div>
          <div class="text-xs font-bold text-white truncate mt-2">${st.name}</div>
          <div class="text-[10px] ${st.category === 'boss' ? 'text-[#ff4da6] font-bold' : 'text-slate-400'} truncate">${st.categoryLabel}</div>
        `;
        btn.addEventListener('click', () => {
          audio.hitSuccess();
          launchStage(stageNum);
        });
      } else if (isCurrent) {
        // 2. 현재 도전할 단계 (stageNum === unlockedStage): 절대 CLEAR 표시 금지, 형광 녹색 테두리 깜빡임
        btn.className =
          'p-3.5 rounded-md border-2 text-left flex flex-col justify-between min-h-[94px] cursor-pointer transition-transform duration-150 stage-current-glow bg-[#0b1f12] border-[#00ff41]';
        btn.innerHTML = `
          <div class="flex items-center justify-between w-full">
            <span class="text-lg font-black tabular-nums font-code text-[#00ff41]">${String(stageNum).padStart(2, '0')}</span>
            <span class="text-[10px] font-bold font-code text-[#00ff41] tracking-wider">도전 중</span>
          </div>
          <div class="text-xs font-bold text-white truncate mt-2">${st.name}</div>
          <div class="text-[10px] ${st.category === 'boss' ? 'text-[#ff4da6] font-bold' : 'text-emerald-300/80'} truncate">${st.categoryLabel}</div>
        `;
        btn.addEventListener('click', () => {
          audio.hitSuccess();
          launchStage(stageNum);
        });
      } else {
        // 3. 잠긴 단계 (stageNum > unlockedStage): 자물쇠 아이콘만 표시, 클릭 시 경고음 + 흔들림
        btn.className =
          'p-3.5 rounded-md border text-left flex flex-col justify-between min-h-[94px] cursor-pointer transition-transform duration-150 bg-[#0d0f14] border-white/10 opacity-65';
        btn.innerHTML = `
          <div class="flex items-center justify-between w-full">
            <span class="text-lg font-black tabular-nums font-code text-slate-500">${String(stageNum).padStart(2, '0')}</span>
            <span class="text-sm">🔒</span>
          </div>
          <div class="text-xs font-bold text-slate-500 truncate mt-2">${st.name}</div>
          <div class="text-[10px] text-slate-600">LOCKED</div>
        `;
        btn.addEventListener('click', () => {
          audio.errorBuzz();
          btn.classList.remove('shake-error');
          void btn.offsetWidth;
          btn.classList.add('shake-error');
        });
      }
      stageGrid.appendChild(btn);
    });
  };

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
    },
    onStageClear: (stageId: number) => {
      recordStageClear(stageId);

      if (stageId === 30) {
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
    fixedReturnBtn.classList.remove('visible');
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
  const btnSkipCredits = root.querySelector('#btn-skip-credits') as HTMLButtonElement;

  const finishEndingCredits = () => {
    window.clearTimeout(endingTimer);
    creditsTrack.classList.remove('credits-roll-anim');
    creditsTrack.classList.add('hidden');
    btnSkipCredits.classList.add('hidden');
    if (currentScene === 'ending') {
      endingActions.classList.remove('opacity-0', 'pointer-events-none');
      endingActions.classList.add('opacity-100', 'pointer-events-auto');
    }
  };

  const startEndingCredits = () => {
    window.clearTimeout(endingTimer);
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
