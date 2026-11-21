export interface StageRuntime {
  stageId: number;
  arenaWrap: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  domLayer: HTMLElement;
  inputDock: HTMLElement;
  cmdInput: HTMLInputElement;
  cmdSubmit: HTMLButtonElement;
  crackPng: string;
  getSize: () => { w: number; h: number };
  isDestroyed: () => boolean;
  isFinished: () => boolean;
  setFinished: (val: boolean) => void;
  setProgress: (pct: number, label?: string) => void;
  damage: (amount: number) => void;
  winStage: (skipBanner?: boolean, force?: boolean) => void;
  enableTypingDock: (
    onBufferChange: (val: string) => void,
    onEnter?: (val: string) => void,
    placeholder?: string
  ) => void;
  onKey: (handler: (e: KeyboardEvent) => void, type?: 'keydown' | 'keyup') => void;
  addTimeout: (fn: () => void, ms: number) => void;
  addCleanup: (fn: () => void) => void;
  setRaf: (fn: (now: number) => void) => void;
  spawnBurst: (cx: number, cy: number, count: number, colorA?: string, colorB?: string) => void;
  updateAndDrawParticles: (dt: number) => void;
}
