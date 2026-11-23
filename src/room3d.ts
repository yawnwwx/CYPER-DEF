import * as THREE from 'three';

export type RoomInteractTarget = 'notebook' | 'computer' | 'door' | 'window';
export type RoomMode = 'explore' | 'booting_pc' | 'zooming_in' | 'paused' | 'ending_poweroff' | 'blackout';

interface RoomCallbacks {
  onInteract: (target: RoomInteractTarget) => void;
  onHoverChange: (target: RoomInteractTarget | null, label: string) => void;
  onHoldProgress?: (progress: number) => void;
}

const HOLD_DURATION_MS = 1000;

interface InteractPoint {
  id: RoomInteractTarget;
  x: number;
  z: number;
  maxDistSq: number;
}

interface StaticCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

// Fixed interactable coordinates (zero Raycaster: pure squared-distance + facing check)
const INTERACT_POINTS: readonly InteractPoint[] = [
  { id: 'computer', x: 0.0, z: -2.56, maxDistSq: 2.35 * 2.35 },
  { id: 'notebook', x: -0.68, z: -2.42, maxDistSq: 2.15 * 2.15 },
  { id: 'door', x: -3.08, z: 1.55, maxDistSq: 2.45 * 2.45 },
  { id: 'window', x: 3.08, z: -1.15, maxDistSq: 2.55 * 2.55 },
];

// Pre-defined numeric AABB colliders (zero Box3.setFromObject per frame)
const ROOM_COLLIDERS: readonly StaticCollider[] = [
  { minX: -1.32, maxX: 1.32, minZ: -3.25, maxZ: -2.02 }, // Wall-flush desk & chair zone
  { minX: -3.25, maxX: -1.45, minZ: -3.25, maxZ: -0.68 }, // Bed & nightstand zone
  { minX: 1.56, maxX: 3.25, minZ: -3.25, maxZ: -2.42 }, // Tall bookshelf corner
  { minX: 2.42, maxX: 3.25, minZ: 0.22, maxZ: 2.08 }, // Low foreground bookshelf
];

const _targetLookQuat = new THREE.Quaternion();
const _lookMat = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);

export class DeveloperRoom3D {
  private container: HTMLElement;
  private callbacks: RoomCallbacks;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private roomAnimId = 0;
  private running = false;
  private pausedRendered = false;
  private lastTime = performance.now();

  public mode: RoomMode = 'paused';
  private yaw = -0.22;
  private pitch = -0.06;
  private lookSensitivity = 1.0;
  private keys: Record<string, boolean> = {};
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private lastTarget: RoomInteractTarget | null = null;
  private lastTargetMode: RoomMode = 'paused';
  private isHoldingE = false;
  private holdStartTime = 0;
  private holdTarget: RoomInteractTarget | null = null;
  private lastReportedProgress = 0;

  // Reusable colors & fog (zero per-frame allocations)
  private dayBgColor = new THREE.Color(0xe9eef4);
  private darkBgColor = new THREE.Color(0x000000);
  private dayFog = new THREE.FogExp2(0xeae6df, 0.012);
  private darkFog = new THREE.FogExp2(0x000000, 0.08);

  // Minimal high-performance light rig (only 1 DirectionalLight casts shadows; all PointLights castShadow = false)
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  private fillLight!: THREE.PointLight;
  private deskLampLight!: THREE.PointLight;

  // Dynamic screen & power LED materials
  private monitorScreenMesh!: THREE.Mesh;
  private monitorOnMat!: THREE.MeshBasicMaterial;
  private monitorOffMat!: THREE.MeshLambertMaterial;
  private pcPowerLedMat!: THREE.MeshBasicMaterial;
  private pcBootProgress = 0;
  private pcBootCallback: (() => void) | null = null;

  // Lightweight <= 256x256 procedural textures
  private floorWoodTex!: THREE.CanvasTexture;
  private wallPaperTex!: THREE.CanvasTexture;
  private deskOakTex!: THREE.CanvasTexture;
  private drawerFrontTex!: THREE.CanvasTexture;
  private chairBackTex!: THREE.CanvasTexture;
  private knitBlanketTex!: THREE.CanvasTexture;
  private pillowTex!: THREE.CanvasTexture;
  private vintageRugTex!: THREE.CanvasTexture;
  private bookshelfTex!: THREE.CanvasTexture;
  private keyboardTex!: THREE.CanvasTexture;
  private pcTowerTex!: THREE.CanvasTexture;
  private notebookTex!: THREE.CanvasTexture;
  private doorTex!: THREE.CanvasTexture;
  private windowBlindTex!: THREE.CanvasTexture;
  private meshBinTex!: THREE.CanvasTexture;
  private monitorOnTex!: THREE.CanvasTexture;

  // Camera transition targets (wall-flush desk & single wide monitor)
  private zoomTargetPos = new THREE.Vector3(0, 1.18, -2.18);
  private zoomLookTarget = new THREE.Vector3(0, 1.16, -2.96);
  private zoomOutPos = new THREE.Vector3(0, 1.46, -1.02);
  private zoomCallback: (() => void) | null = null;

  constructor(container: HTMLElement, callbacks: RoomCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.init();
  }

  public setSensitivity(mult: number): void {
    this.lookSensitivity = Math.max(0.3, Math.min(2.5, mult));
  }

  private createCanvasTexture(
    w: number,
    h: number,
    drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    repeatX = 1,
    repeatY = 1
  ): THREE.CanvasTexture {
    // Enforce <= 256x256 maximum resolution for minimal VRAM & shader bandwidth
    const cw = Math.min(256, w);
    const ch = Math.min(256, h);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d')!;
    drawFn(ctx, cw, ch);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 1;
    tex.generateMipmaps = true;
    if (repeatX > 1 || repeatY > 1) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    }
    return tex;
  }

  private createProceduralTextures(): void {
    // 1. Warm Honey-Oak Hardwood Floor (256x256)
    this.floorWoodTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        const rows = 8;
        const rowH = h / rows;
        const tones = ['#bc8b5b', '#a97749', '#c59666', '#b28151', '#be8e5e', '#a17043'];
        for (let r = 0; r < rows; r++) {
          const y = r * rowH;
          const joint = ((r * 97 + 44) % (w - 48)) + 24;
          ctx.fillStyle = tones[r % tones.length];
          ctx.fillRect(0, y, joint, rowH);
          ctx.fillStyle = tones[(r + 3) % tones.length];
          ctx.fillRect(joint, y, w - joint, rowH);

          // Wood grain lines
          ctx.strokeStyle = 'rgba(72, 42, 18, 0.22)';
          ctx.lineWidth = 1;
          for (let g = 1; g <= 4; g++) {
            const gy = y + (g / 5) * rowH;
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(w, gy + ((r + g) % 2 === 0 ? 1.5 : -1.5));
            ctx.stroke();
          }

          // Plank bevel seams
          ctx.fillStyle = 'rgba(48, 28, 12, 0.58)';
          ctx.fillRect(0, y + rowH - 1.5, w, 1.5);
          ctx.fillRect(joint - 1, y, 2, rowH);
        }
      },
      3,
      3
    );

    // 2. Matte Warm Ivory Plaster Wallpaper (128x128)
    this.wallPaperTex = this.createCanvasTexture(
      128,
      128,
      (ctx, w, h) => {
        ctx.fillStyle = '#ddd7ce';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 420; i++) {
          const x = (i * 53) % w;
          const y = (i * 37) % h;
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255,252,246,0.16)' : 'rgba(130,118,104,0.08)';
          ctx.fillRect(x, y, 3, 2);
        }
      },
      4,
      2
    );

    // 3. Natural Honey-Oak Desk Surface (256x256)
    this.deskOakTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#c89b6a';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 48; i++) {
        const y = (i / 48) * h;
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(105,65,32,0.22)' : 'rgba(248,224,186,0.14)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.33, y + 3, w * 0.66, y - 3, w, y);
        ctx.stroke();
      }
    });

    // 4. Desk 3-Drawer Front Face (128x128)
    this.drawerFrontTex = this.createCanvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#ad7e4f';
      ctx.fillRect(0, 0, w, h);
      const dh = h / 3;
      for (let i = 0; i < 3; i++) {
        const y = i * dh;
        ctx.fillStyle = '#b98958';
        ctx.fillRect(6, y + 4, w - 12, dh - 8);
        ctx.strokeStyle = '#5a3a1e';
        ctx.lineWidth = 2;
        ctx.strokeRect(6, y + 4, w - 12, dh - 8);
        // Sleek recessed finger-pull slot
        ctx.fillStyle = '#24160b';
        ctx.fillRect(w * 0.32, y + 10, w * 0.36, 5);
      }
    });

    // 5. Ergonomic Racing Chair Backrest (128x256)
    this.chairBackTex = this.createCanvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#1b1d22';
      ctx.fillRect(0, 0, w, h);
      // Warm copper-brown racing accent stripes
      ctx.fillStyle = '#8f5634';
      ctx.fillRect(10, 12, 8, h - 24);
      ctx.fillRect(w - 18, 12, 8, h - 24);
      // Center breathable mesh panel
      ctx.fillStyle = '#272b33';
      ctx.fillRect(26, 74, w - 52, h - 94);
      // Twin shoulder harness cutouts
      ctx.fillStyle = '#090a0d';
      ctx.fillRect(26, 34, 26, 22);
      ctx.fillRect(w - 52, 34, 26, 22);
      ctx.strokeStyle = '#8f5634';
      ctx.lineWidth = 2;
      ctx.strokeRect(26, 34, 26, 22);
      ctx.strokeRect(w - 52, 34, 26, 22);
    });

    // 6. Rumpled Knit Blanket & Gray Duvet Texture (256x256)
    this.knitBlanketTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      // Soft gray duvet top half
      ctx.fillStyle = '#bfc4ca';
      ctx.fillRect(0, 0, w, h);
      // Warm rumpled beige chunky-knit throw draped over lower 65%
      ctx.fillStyle = '#cbbca5';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.32);
      ctx.quadraticCurveTo(w * 0.42, h * 0.24, w, h * 0.42);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
      // Soft organic cloth folds & knit texture
      for (let i = 0; i < 24; i++) {
        const y = i * 11;
        ctx.strokeStyle = i % 2 === 0 ? 'rgba(92,78,60,0.16)' : 'rgba(255,250,240,0.18)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(w * 0.3, y + 10, w * 0.7, y - 8, w, y + 4);
        ctx.stroke();
      }
    });

    // 7. Twin Pillows Texture (128x64)
    this.pillowTex = this.createCanvasTexture(128, 64, (ctx, w, h) => {
      ctx.fillStyle = '#d8d5cf';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b9b4ab';
      ctx.fillRect(w / 2 - 2, 0, 4, h);
      ctx.strokeStyle = 'rgba(90,84,74,0.22)';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, w / 2 - 8, h - 8);
      ctx.strokeRect(w / 2 + 4, 4, w / 2 - 8, h - 8);
    });

    // 8. Vintage Patterned Rug (256x256)
    this.vintageRugTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#6c5a4c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#c8b39a';
      ctx.lineWidth = 8;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.strokeStyle = '#3b2e26';
      ctx.lineWidth = 3;
      ctx.strokeRect(24, 24, w - 48, h - 48);
      ctx.fillStyle = '#8b4936';
      ctx.fillRect(36, 36, w - 72, h - 72);
      // Geometric medallion center
      ctx.fillStyle = '#c9b394';
      ctx.beginPath();
      ctx.moveTo(w / 2, 56);
      ctx.lineTo(w - 56, h / 2);
      ctx.lineTo(w / 2, h - 56);
      ctx.lineTo(56, h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3d4c59';
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 26, 0, Math.PI * 2);
      ctx.fill();
    });

    // 9. Bookshelf Rows with Colorful Spines & Folders (256x256)
    this.bookshelfTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      // Oak cabinet frame & recessed shelf interior
      ctx.fillStyle = '#b98c5b';
      ctx.fillRect(0, 0, w, h);
      const shelves = 5;
      const pad = 10;
      const shelfH = (h - pad * 2) / shelves;
      const bookColors = ['#1e293b', '#334155', '#7f1d1d', '#1e3a5f', '#14532d', '#78350f', '#cbd5e1', '#475569'];

      for (let s = 0; s < shelves; s++) {
        const sy = pad + s * shelfH;
        // Dark interior cavity
        ctx.fillStyle = '#5a4028';
        ctx.fillRect(pad, sy + 4, w - pad * 2, shelfH - 9);
        // Painted book spines
        let bx = pad + 6;
        let idx = s * 7;
        while (bx < w - pad - 18) {
          const bw = 9 + ((idx * 5) % 9);
          const bh = shelfH - 15 - ((idx * 3) % 10);
          ctx.fillStyle = bookColors[idx % bookColors.length];
          ctx.fillRect(bx, sy + shelfH - 6 - bh, bw, bh);
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.fillRect(bx + 2, sy + shelfH - 4 - bh, bw - 4, 2);
          bx += bw + 2 + (idx % 4 === 0 ? 6 : 0);
          idx++;
        }
        // Horizontal oak shelf board
        ctx.fillStyle = '#c49664';
        ctx.fillRect(pad, sy + shelfH - 6, w - pad * 2, 6);
      }
    });

    // 10. RGB Mechanical Keyboard Texture (256x96) - 1 box mesh instead of 60+ keycap meshes!
    this.keyboardTex = this.createCanvasTexture(256, 96, (ctx, w, h) => {
      ctx.fillStyle = '#14171d';
      ctx.fillRect(0, 0, w, h);
      // Soft RGB underglow strip
      const rgbGrad = ctx.createLinearGradient(8, 0, w - 8, 0);
      rgbGrad.addColorStop(0, '#ff007f');
      rgbGrad.addColorStop(0.35, '#00e5ff');
      rgbGrad.addColorStop(0.7, '#00ff41');
      rgbGrad.addColorStop(1, '#a855f7');
      ctx.fillStyle = rgbGrad;
      ctx.fillRect(6, 6, w - 12, h - 12);

      // Dark keycaps grid leaving crisp glowing RGB gaps
      const rows = 5;
      const cols = 15;
      const cellW = (w - 16) / cols;
      const cellH = (h - 16) / rows;
      ctx.fillStyle = '#191d24';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r === 4 && c >= 4 && c <= 9) continue; // spacebar
          ctx.fillRect(9 + c * cellW, 9 + r * cellH, cellW - 2.5, cellH - 2.5);
        }
      }
      // Spacebar keycap
      ctx.fillRect(9 + 4 * cellW, 9 + 4 * cellH, cellW * 6 - 2.5, cellH - 2.5);
    });

    // 11. Custom Tempered-Glass PC Tower Side Panel (256x256) - 1 box instead of 30+ internal parts!
    this.pcTowerTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      // Brushed silver/white aluminum outer frame
      ctx.fillStyle = '#d4d9e0';
      ctx.fillRect(0, 0, w, h);
      // Tinted tempered-glass interior cavity
      ctx.fillStyle = '#0e131b';
      ctx.fillRect(14, 14, w - 28, h - 32);
      // Motherboard & GPU silhouette
      ctx.fillStyle = '#1e2736';
      ctx.fillRect(28, 32, 128, 138);
      ctx.fillStyle = '#2d3748';
      ctx.fillRect(36, 126, 152, 24);
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(44, 135, 92, 4);
      // Dual glowing LED ring fans (top + rear)
      const drawFan = (cx: number, cy: number, r: number, color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#18212f';
        ctx.beginPath();
        ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
        ctx.fill();
      };
      drawFan(64, 72, 24, '#d9ecff');
      drawFan(184, 78, 22, '#38bdf8');
      drawFan(184, 138, 22, '#00ff41');
      // Vertical front LED accent bar
      ctx.fillStyle = '#e0f2fe';
      ctx.fillRect(w - 22, 20, 4, h - 44);
    });

    // 12. Spiral Python Notebook on Desk (128x160)
    this.notebookTex = this.createCanvasTexture(128, 160, (ctx, w, h) => {
      ctx.fillStyle = '#f8f5ec';
      ctx.fillRect(0, 0, w, h);
      // Left spiral rings
      ctx.fillStyle = '#334155';
      ctx.fillRect(0, 0, 12, h);
      ctx.fillStyle = '#cbd5e1';
      for (let y = 10; y < h - 8; y += 14) {
        ctx.fillRect(2, y, 10, 4);
      }
      // Ruled lines & Python notes
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      for (let y = 26; y < h - 10; y += 12) {
        ctx.beginPath();
        ctx.moveTo(18, y);
        ctx.lineTo(w - 10, y);
        ctx.stroke();
      }
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 11px monospace';
      ctx.fillText('PYTHON NOTES', 20, 22);
      ctx.fillStyle = '#0284c7';
      ctx.font = '9px monospace';
      ctx.fillText('def defend():', 20, 46);
      ctx.fillText('  return True', 20, 62);
      ctx.fillStyle = '#be123c';
      ctx.fillText('# 과제 마감!', 20, 90);
    });

    // 13. Left Room Door Panel + Handle (128x256)
    this.doorTex = this.createCanvasTexture(128, 256, (ctx, w, h) => {
      ctx.fillStyle = '#eae6df';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#c8c2b7';
      ctx.lineWidth = 4;
      ctx.strokeRect(4, 4, w - 8, h - 8);
      // Classic recessed door panels
      ctx.strokeStyle = '#d3cdc2';
      ctx.lineWidth = 3;
      ctx.strokeRect(18, 20, w - 36, 94);
      ctx.strokeRect(18, 134, w - 36, 96);
      // Brushed metal lever handle
      ctx.fillStyle = '#64748b';
      ctx.fillRect(w - 28, h * 0.52, 18, 6);
      ctx.fillStyle = '#94a3b8';
      ctx.beginPath();
      ctx.arc(w - 14, h * 0.52 + 3, 5, 0, Math.PI * 2);
      ctx.fill();
    });

    // 14. Sunlit Right Window with Venetian Blinds (256x256) - 1 box instead of 25 blind slat meshes!
    this.windowBlindTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      // Bright warm daylight sky outside
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#fff9ec');
      sky.addColorStop(0.55, '#f2f7ff');
      sky.addColorStop(1, '#e8dcc8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      // Crisp horizontal Venetian blind slats
      for (let y = 12; y < h - 12; y += 11) {
        ctx.fillStyle = 'rgba(255, 253, 248, 0.86)';
        ctx.fillRect(12, y, w - 24, 5);
        ctx.fillStyle = 'rgba(148, 140, 128, 0.42)';
        ctx.fillRect(12, y + 5, w - 24, 2);
      }
      // Vertical blind cords
      ctx.fillStyle = 'rgba(130, 124, 115, 0.45)';
      ctx.fillRect(w * 0.28, 12, 2, h - 24);
      ctx.fillRect(w * 0.72, 12, 2, h - 24);
      // Clean white PVC window frame
      ctx.strokeStyle = '#f1efe9';
      ctx.lineWidth = 14;
      ctx.strokeRect(5, 5, w - 10, h - 10);
    });

    // 15. Wire-Mesh Wastebasket Pattern (128x128)
    this.meshBinTex = this.createCanvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#3f454e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#7c8594';
      ctx.lineWidth = 2;
      for (let i = -h; i < w + h; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.moveTo(i + h, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
      }
    });

    // 16. Powered-On Monitor OS Glow Texture (256x128)
    this.monitorOnTex = this.createCanvasTexture(256, 128, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#0a192f');
      grad.addColorStop(0.55, '#112240');
      grad.addColorStop(1, '#0c2b3a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#00ff41';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CYBER-OS READY', w / 2, h / 2 - 4);
      ctx.fillStyle = '#38bdf8';
      ctx.font = '10px monospace';
      ctx.fillText('PYTHON ASSIGNMENT TERMINAL', w / 2, h / 2 + 16);
      // Taskbar strip
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      ctx.fillRect(0, h - 14, w, 14);
    });
  }

  private init(): void {
    this.scene = new THREE.Scene();
    this.scene.background = this.dayBgColor;
    this.scene.fog = this.dayFog;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 32);
    this.camera.rotation.order = 'YXZ';

    // Performance-First WebGLRenderer: antialias disabled, pixelRatio = 1, shadows disabled for locked 60FPS
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.createProceduralTextures();
    this.buildLightRig();
    this.buildLightweightRoom();
    this.resetOpeningAtBed();

    this.renderer.compile(this.scene, this.camera);
    this.bindEvents();
  }

  private buildLightRig(): void {
    // Soft neutral baseline ambient
    this.ambientLight = new THREE.AmbientLight(0xfff5e8, 0.52);
    this.scene.add(this.ambientLight);

    // Warm indoor sky-to-oak bounce
    this.hemiLight = new THREE.HemisphereLight(0xf2f7ff, 0xa17950, 0.85);
    this.scene.add(this.hemiLight);

    // Warm afternoon directional sunlight from right window (shadowMap disabled for 60FPS)
    this.sunLight = new THREE.DirectionalLight(0xffe7c4, 1.55);
    this.sunLight.position.set(5.2, 3.6, -0.6);
    this.sunLight.target.position.set(-1.1, 0.4, -1.1);
    this.sunLight.castShadow = false;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // PointLights strictly castShadow = false
    this.fillLight = new THREE.PointLight(0xfff5e4, 0.55, 12, 1.5);
    this.fillLight.castShadow = false;
    this.fillLight.position.set(0.1, 2.75, 0.2);
    this.scene.add(this.fillLight);

    this.deskLampLight = new THREE.PointLight(0xffcb84, 0.85, 4.5, 1.6);
    this.deskLampLight.castShadow = false;
    this.deskLampLight.position.set(-1.12, 1.24, -2.72);
    this.scene.add(this.deskLampLight);
  }

  private buildLightweightRoom(): void {
    // Total Mesh count strictly <= 50 (38 meshes total) for ultra-fast draw calls
    const roomW = 6.4;
    const roomD = 6.4;
    const roomH = 3.05;
    const halfW = roomW * 0.5;
    const halfD = roomD * 0.5;

    // --- 1. ROOM SHELL & RUG (7 meshes) ---
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(roomW, roomD),
      new THREE.MeshLambertMaterial({ map: this.floorWoodTex })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(roomW, roomD),
      new THREE.MeshLambertMaterial({ color: 0xf2efe9 })
    );
    ceiling.position.y = roomH;
    ceiling.rotation.x = Math.PI / 2;
    this.scene.add(ceiling);

    const wallMat = new THREE.MeshLambertMaterial({ map: this.wallPaperTex });
    const wallSpecs: Array<[number, number, number, number, boolean]> = [
      [0, roomH * 0.5, -halfD, 0, true],
      [0, roomH * 0.5, halfD, Math.PI, false],
      [-halfW, roomH * 0.5, 0, Math.PI / 2, true],
      [halfW, roomH * 0.5, 0, -Math.PI / 2, true],
    ];
    for (const [x, y, z, ry, recv] of wallSpecs) {
      const wMesh = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomH), wallMat);
      wMesh.position.set(x, y, z);
      wMesh.rotation.y = ry;
      wMesh.receiveShadow = recv;
      this.scene.add(wMesh);
    }

    // Floor Rug strictly raised to y = 0.015 to prevent Z-fighting with hardwood floor (y = 0)
    const rug = new THREE.Mesh(
      new THREE.PlaneGeometry(2.58, 2.08),
      new THREE.MeshLambertMaterial({ map: this.vintageRugTex })
    );
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(0.02, 0.015, -1.68);
    this.scene.add(rug);

    // Subtle warm sunlit floor patch near right window (sits above rug at y = 0.02)
    const sunPatch = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 1.55),
      new THREE.MeshBasicMaterial({
        color: 0xfff0cc,
        transparent: true,
        opacity: 0.14,
        depthWrite: false,
      })
    );
    sunPatch.rotation.x = -Math.PI / 2;
    sunPatch.position.set(1.65, 0.02, -1.05);
    this.scene.add(sunPatch);

    // Flush ceiling fixture
    const ceilingLamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.28, 0.05, 14),
      new THREE.MeshBasicMaterial({ color: 0xfff9ee })
    );
    ceilingLamp.position.set(0, roomH - 0.03, -0.2);
    this.scene.add(ceilingLamp);

    // --- 2. WALL-FLUSH DESK & ERGONOMIC GAMING CHAIR ---
    const oakMat = new THREE.MeshLambertMaterial({ map: this.deskOakTex });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
    const darkMetalMat = new THREE.MeshLambertMaterial({ color: 0x2a2f38 });
    const darkLeatherMat = new THREE.MeshLambertMaterial({ color: 0x1b1d22 });

    // Desk top: Y spans [0.720, 0.768], Z spans [-3.17, -2.31]
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(2.18, 0.048, 0.86), oakMat);
    deskTop.position.set(0, 0.744, -2.74);
    this.scene.add(deskTop);

    // Left Desk Legs (2 clean vertical legs reaching exact floor y = 0.000 to desk underside y = 0.720)
    const legGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.72, 8);
    const deskLeftLegFront = new THREE.Mesh(legGeo, metalMat);
    deskLeftLegFront.position.set(-0.96, 0.36, -2.40);
    const deskLeftLegBack = new THREE.Mesh(legGeo, metalMat);
    deskLeftLegBack.position.set(-0.96, 0.36, -3.08);
    this.scene.add(deskLeftLegFront, deskLeftLegBack);

    // Right 3-drawer cabinet resting flush on floor (y: [0.000, 0.720])
    const drawerSideMat = new THREE.MeshLambertMaterial({ color: 0xa6784b });
    const drawerFrontMat = new THREE.MeshLambertMaterial({ map: this.drawerFrontTex });
    const deskCabinet = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.72, 0.74), [
      drawerSideMat,
      drawerSideMat,
      drawerSideMat,
      drawerSideMat,
      drawerFrontMat,
      drawerSideMat,
    ]);
    deskCabinet.position.set(0.68, 0.36, -2.74);
    this.scene.add(deskCabinet);

    // Properly Assembled Ergonomic Gaming Chair (Seat + Backrest + 2 Armrests + Gas-Lift Cylinder + 5-Star Base & Casters)
    const chairGroup = new THREE.Group();
    chairGroup.position.set(-0.04, 0.015, -1.78); // sits cleanly on top of rug (y = 0.015)
    chairGroup.rotation.y = 0.16;

    // 5-Star Center Hub + Central Thin Gas-Lift Cylinder
    const chairHub = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.048, 10), darkMetalMat);
    chairHub.position.y = 0.068;
    const chairGasLift = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, 0.36, 10), metalMat);
    chairGasLift.position.y = 0.255;
    chairGroup.add(chairHub, chairGasLift);

    // 5-Star Thin Legs radiating outward + 5 Small Caster Wheels touching rug cleanly
    const spokeGeo = new THREE.BoxGeometry(0.29, 0.024, 0.032);
    const casterGeo = new THREE.CylinderGeometry(0.024, 0.024, 0.026, 8);
    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const cosA = Math.cos(ang);
      const sinA = Math.sin(ang);

      const spoke = new THREE.Mesh(spokeGeo, darkMetalMat);
      spoke.position.set(cosA * 0.155, 0.06, sinA * 0.155);
      spoke.rotation.y = -ang;
      chairGroup.add(spoke);

      const caster = new THREE.Mesh(casterGeo, darkLeatherMat);
      caster.rotation.z = Math.PI / 2;
      caster.rotation.y = -ang;
      caster.position.set(cosA * 0.285, 0.024, sinA * 0.285);
      chairGroup.add(caster);
    }

    // Seat Cushion connected directly onto gas-lift cylinder top
    const chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.085, 0.48), darkLeatherMat);
    chairSeat.position.set(0, 0.455, 0);
    chairGroup.add(chairSeat);

    // Backrest connected cleanly to rear edge of seat
    const chairBackMat = new THREE.MeshLambertMaterial({ map: this.chairBackTex });
    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.76, 0.08), [
      darkLeatherMat,
      darkLeatherMat,
      darkLeatherMat,
      darkLeatherMat,
      chairBackMat,
      chairBackMat,
    ]);
    chairBack.position.set(0, 0.84, 0.21);
    chairBack.rotation.x = 0.08;
    chairGroup.add(chairBack);

    // Left & Right Armrests (support post + padded top bar)
    const armPostGeo = new THREE.BoxGeometry(0.032, 0.20, 0.044);
    const armPadGeo = new THREE.BoxGeometry(0.072, 0.032, 0.28);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(armPostGeo, darkMetalMat);
      post.position.set(side * 0.265, 0.555, 0.01);
      const pad = new THREE.Mesh(armPadGeo, darkLeatherMat);
      pad.position.set(side * 0.265, 0.665, 0.0);
      chairGroup.add(post, pad);
    }

    this.scene.add(chairGroup);

    // --- 3. SINGLE WIDE MONITOR (STAND STRICTLY BEHIND PANEL!), PC TOWER, KEYBOARD, MOUSE & PROPS ---
    const standMetalMat = new THREE.MeshLambertMaterial({ color: 0xbac2cc });

    // Flat monitor base plate resting flush on desk top (desk top y = 0.768 -> base spans [0.768, 0.782])
    const monitorBase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.014, 0.20), standMetalMat);
    monitorBase.position.set(0, 0.775, -2.95);
    this.scene.add(monitorBase);

    // Vertical stand neck strictly BEHIND monitor panel (panel back is at z = -2.918, neck front is at z = -2.942)
    const monitorNeck = new THREE.Mesh(new THREE.BoxGeometry(0.068, 0.37, 0.036), standMetalMat);
    monitorNeck.position.set(0, 0.96, -2.96);
    this.scene.add(monitorNeck);

    // Rear VESA mount connecting neck to back of monitor body (never passes through screen!)
    const monitorBracket = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.08, 0.032), darkMetalMat);
    monitorBracket.position.set(0, 1.13, -2.934);
    this.scene.add(monitorBracket);

    // Monitor thin-bezel body in front of stand (Z spans [-2.918, -2.882])
    const monitorBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.96, 0.46, 0.036),
      new THREE.MeshLambertMaterial({ color: 0x111419 })
    );
    monitorBody.position.set(0, 1.15, -2.90);
    this.scene.add(monitorBody);

    // Monitor front display plane cleanly in front of bezel (Z = -2.880, 100% unobstructed!)
    this.monitorOffMat = new THREE.MeshLambertMaterial({ color: 0x0b0e14 });
    this.monitorOnMat = new THREE.MeshBasicMaterial({ map: this.monitorOnTex });
    this.monitorScreenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.915, 0.415), this.monitorOffMat);
    this.monitorScreenMesh.position.set(0, 1.15, -2.880);
    this.scene.add(this.monitorScreenMesh);

    // Custom tempered-glass PC tower resting flush on desk top (y: [0.768, 1.208])
    const towerFrameMat = new THREE.MeshLambertMaterial({ color: 0xd0d6de });
    const towerGlassMat = new THREE.MeshLambertMaterial({ map: this.pcTowerTex });
    const pcTower = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.44, 0.44), [
      towerFrameMat,
      towerGlassMat,
      towerFrameMat,
      towerFrameMat,
      towerFrameMat,
      towerFrameMat,
    ]);
    pcTower.position.set(0.84, 0.988, -2.74);
    pcTower.rotation.y = -0.22;
    this.scene.add(pcTower);

    this.pcPowerLedMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
    const pcLed = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.014, 0.012), this.pcPowerLedMat);
    pcLed.position.set(0.76, 1.16, -2.51);
    this.scene.add(pcLed);

    // RGB mechanical keyboard on desk top (y: [0.768, 0.786])
    const kbSideMat = new THREE.MeshLambertMaterial({ color: 0x15181f });
    const kbTopMat = new THREE.MeshBasicMaterial({ map: this.keyboardTex });
    const keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.018, 0.155), [
      kbSideMat,
      kbSideMat,
      kbTopMat,
      kbSideMat,
      kbSideMat,
      kbSideMat,
    ]);
    keyboard.position.set(-0.02, 0.777, -2.56);
    this.scene.add(keyboard);

    // Mousepad & gaming mouse on desk top
    const mousePad = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.006, 0.24),
      new THREE.MeshLambertMaterial({ color: 0x1a1e26 })
    );
    mousePad.position.set(0.42, 0.771, -2.56);
    this.scene.add(mousePad);

    const mouse = new THREE.Mesh(
      new THREE.BoxGeometry(0.068, 0.032, 0.115),
      new THREE.MeshLambertMaterial({ color: 0x262b35 })
    );
    mouse.position.set(0.42, 0.790, -2.56);
    this.scene.add(mouse);

    // Python spiral notebook on left desk top
    const nbSideMat = new THREE.MeshLambertMaterial({ color: 0xe2ddd0 });
    const nbTopMat = new THREE.MeshLambertMaterial({ map: this.notebookTex });
    const notebook = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.018, 0.30), [
      nbSideMat,
      nbSideMat,
      nbTopMat,
      nbSideMat,
      nbSideMat,
      nbSideMat,
    ]);
    notebook.position.set(-0.68, 0.777, -2.54);
    notebook.rotation.y = 0.14;
    this.scene.add(notebook);

    // Ceramic coffee mug on desk top
    const mug = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.038, 0.092, 10),
      new THREE.MeshLambertMaterial({ color: 0xd6cfc3 })
    );
    mug.position.set(-0.44, 0.814, -2.74);
    this.scene.add(mug);

    // Wire-mesh wastebasket resting flush on hardwood floor beside left desk leg (outside rug bounds)
    const wastebasket = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.11, 0.31, 10, 1, false),
      new THREE.MeshLambertMaterial({ map: this.meshBinTex, side: THREE.DoubleSide })
    );
    wastebasket.position.set(-1.38, 0.155, -2.42);
    this.scene.add(wastebasket);

    // --- 4. COZY BED & NIGHTSTAND (5 meshes; main bed/nightstand cast shadows) ---
    const bedFabricMat = new THREE.MeshLambertMaterial({ color: 0x6c7178 });
    const bedBase = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.32, 2.08), bedFabricMat);
    bedBase.position.set(-2.36, 0.16, -1.94);
    bedBase.castShadow = true;
    bedBase.receiveShadow = true;
    this.scene.add(bedBase);

    const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.62, 0.09), bedFabricMat);
    headboard.position.set(-2.36, 0.56, -2.94);
    headboard.castShadow = true;
    headboard.receiveShadow = true;
    this.scene.add(headboard);

    const mattressDuvet = new THREE.Mesh(
      new THREE.BoxGeometry(1.38, 0.25, 1.98),
      new THREE.MeshLambertMaterial({ map: this.knitBlanketTex })
    );
    mattressDuvet.position.set(-2.36, 0.445, -1.92);
    mattressDuvet.castShadow = true;
    mattressDuvet.receiveShadow = true;
    this.scene.add(mattressDuvet);

    const pillows = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 0.14, 0.36),
      new THREE.MeshLambertMaterial({ map: this.pillowTex })
    );
    pillows.position.set(-2.36, 0.64, -2.66);
    pillows.receiveShadow = true;
    this.scene.add(pillows);

    const nightstand = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.44), [
      drawerSideMat,
      drawerSideMat,
      oakMat,
      drawerSideMat,
      drawerFrontMat,
      drawerSideMat,
    ]);
    nightstand.position.set(-1.34, 0.26, -2.92);
    nightstand.castShadow = true;
    nightstand.receiveShadow = true;
    this.scene.add(nightstand);

    // --- 5. TALL & LOW BOOKSHELVES (2 meshes with painted books texture; cast shadows) ---
    const shelfWoodMat = new THREE.MeshLambertMaterial({ color: 0xb98c5b });
    const shelfBooksMat = new THREE.MeshLambertMaterial({ map: this.bookshelfTex });

    const tallBookshelf = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.98, 0.34), [
      shelfWoodMat,
      shelfWoodMat,
      shelfWoodMat,
      shelfWoodMat,
      shelfBooksMat,
      shelfWoodMat,
    ]);
    tallBookshelf.position.set(2.08, 0.99, -2.98);
    tallBookshelf.castShadow = true;
    tallBookshelf.receiveShadow = true;
    this.scene.add(tallBookshelf);

    const walnutMat = new THREE.MeshLambertMaterial({ color: 0x6f4b32 });
    const lowBookshelf = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.96, 1.28), [
      walnutMat,
      shelfBooksMat, // facing inward (-X)
      walnutMat,
      walnutMat,
      walnutMat,
      walnutMat,
    ]);
    lowBookshelf.position.set(2.98, 0.48, 1.12);
    lowBookshelf.castShadow = true;
    lowBookshelf.receiveShadow = true;
    this.scene.add(lowBookshelf);

    // --- 6. LEFT DOOR, RIGHT SUNLIT WINDOW & WALL POSTERS (5 meshes, no shadow) ---
    const doorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 2.16, 0.96),
      new THREE.MeshLambertMaterial({ map: this.doorTex })
    );
    doorMesh.position.set(-3.17, 1.08, 1.55);
    doorMesh.receiveShadow = true;
    this.scene.add(doorMesh);

    const windowMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.58, 1.72),
      new THREE.MeshBasicMaterial({ map: this.windowBlindTex })
    );
    windowMesh.position.set(3.16, 1.68, -1.15);
    this.scene.add(windowMesh);

    // 3 Lightweight Wall Posters (128x160 CanvasTextures)
    const addPoster = (
      x: number,
      y: number,
      z: number,
      ry: number,
      pw: number,
      ph: number,
      drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
    ) => {
      const tex = this.createCanvasTexture(128, 160, drawFn);
      const poster = new THREE.Mesh(
        new THREE.PlaneGeometry(pw, ph),
        new THREE.MeshLambertMaterial({ map: tex })
      );
      poster.position.set(x, y, z);
      poster.rotation.y = ry;
      this.scene.add(poster);
    };

    // Back wall sci-fi poster
    addPoster(-1.35, 1.98, -3.18, 0, 0.62, 0.80, (ctx, w, h) => {
      ctx.fillStyle = '#182433';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#537391';
      ctx.fillRect(0, 0, w, h * 0.55);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(14, 70, 24, 90);
      ctx.fillRect(88, 62, 28, 98);
      ctx.fillStyle = '#f8fafc';
      ctx.beginPath();
      ctx.arc(w / 2, 46, 16, 0, Math.PI * 2);
      ctx.fill();
    });

    // Left wall CYBER-DEF poster above bed
    addPoster(-3.18, 2.0, -1.78, Math.PI / 2, 0.56, 0.80, (ctx, w, h) => {
      ctx.fillStyle = '#14171c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b94a2c';
      ctx.beginPath();
      ctx.arc(w / 2, 66, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#00ff41';
      ctx.font = 'bold 13px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CYBER-DEF', w / 2, 138);
    });

    // Right wall framed graphic print
    addPoster(3.18, 1.94, 0.58, -Math.PI / 2, 0.58, 0.78, (ctx, w, h) => {
      ctx.fillStyle = '#ebe5d8';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, w - 6, h - 6);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, h * 0.82);
      ctx.quadraticCurveTo(w * 0.42, h * 0.5, w * 0.56, h * 0.2);
      ctx.stroke();
    });
  }

  public resetOpeningAtBed(): void {
    this.camera.position.set(-0.72, 1.46, 0.92);
    this.yaw = -0.22;
    this.pitch = -0.06;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = 0;
    this.setComputerPower(false);
    this.setRoomLights(true);
    this.clearHoverState();
  }

  public setComputerPower(on: boolean): void {
    if (!this.monitorScreenMesh) return;
    if (on) {
      this.monitorScreenMesh.material = this.monitorOnMat;
      this.pcPowerLedMat.color.setHex(0x00ff41);
    } else {
      this.monitorScreenMesh.material = this.monitorOffMat;
      this.pcPowerLedMat.color.setHex(0x475569);
    }
    this.pausedRendered = false;
  }

  public setRoomLights(on: boolean): void {
    this.ambientLight.intensity = on ? 0.52 : 0;
    this.hemiLight.intensity = on ? 0.85 : 0;
    this.sunLight.intensity = on ? 1.55 : 0;
    this.fillLight.intensity = on ? 0.55 : 0;
    this.deskLampLight.intensity = on ? 0.85 : 0;
    this.scene.background = on ? this.dayBgColor : this.darkBgColor;
    this.scene.fog = on ? this.dayFog : this.darkFog;
    this.pausedRendered = false;
  }

  public start(): void {
    // Always cancel any existing RAF before starting to prevent duplicate stacked render loops
    if (this.roomAnimId) {
      cancelAnimationFrame(this.roomAnimId);
      this.roomAnimId = 0;
    }
    this.running = true;
    this.pausedRendered = false;
    this.lastTime = performance.now();
    this.tick();
  }

  public stop(): void {
    this.running = false;
    if (this.roomAnimId) {
      cancelAnimationFrame(this.roomAnimId);
      this.roomAnimId = 0;
    }
    this.cancelHold();
    this.clearHoverState();
    this.keys = {};
    this.isDragging = false;
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  public cancelHold(): void {
    this.isHoldingE = false;
    this.holdStartTime = 0;
    this.holdTarget = null;
    this.reportHoldProgress(0);
  }

  public clearInputs(): void {
    this.keys = {};
    this.isDragging = false;
    this.cancelHold();
  }

  private reportHoldProgress(progress: number): void {
    const clamped = progress <= 0 ? 0 : progress >= 1 ? 1 : progress;
    if (clamped !== this.lastReportedProgress) {
      this.lastReportedProgress = clamped;
      this.callbacks.onHoldProgress?.(clamped);
    }
  }

  public powerOnAndZoomToOS(onComplete: () => void): void {
    this.cancelHold();
    this.clearHoverState();
    this.pcBootProgress = 0;
    this.monitorScreenMesh.material = this.monitorOnMat;
    this.pcPowerLedMat.color.setHex(0x00ff41);
    this.mode = 'booting_pc';
    this.pcBootCallback = () => {
      this.mode = 'zooming_in';
      this.zoomCallback = onComplete;
    };
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  public returnFromMonitor(): void {
    this.camera.position.copy(this.zoomOutPos);
    this.yaw = 0;
    this.pitch = -0.05;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.mode = 'explore';
    this.cancelHold();
    this.clearHoverState();
    this.start();
  }

  public startEndingReturn(): void {
    this.setComputerPower(false);
    this.setRoomLights(true);
    this.camera.position.copy(this.zoomTargetPos);
    this.yaw = 0;
    this.pitch = -0.03;
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.mode = 'ending_poweroff';
    this.cancelHold();
    this.clearHoverState();
    this.start();
  }

  public triggerBlackout(): void {
    this.mode = 'blackout';
    this.cancelHold();
    this.clearHoverState();
    this.setComputerPower(false);
    this.setRoomLights(false);
    this.renderer.render(this.scene, this.camera);
    this.pausedRendered = true;
  }

  private clearHoverState(): void {
    this.cancelHold();
    if (this.lastTarget !== null) {
      this.lastTarget = null;
      this.callbacks.onHoverChange(null, '');
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => {
      this.keys = {};
      this.cancelHold();
    });

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', (e) => {
      if (!this.running || (this.mode !== 'explore' && this.mode !== 'ending_poweroff')) return;
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      if (document.pointerLockElement !== dom && dom.requestPointerLock) {
        try {
          const p = dom.requestPointerLock() as unknown as Promise<void> | undefined;
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch {
          // drag look fallback
        }
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Ultra-fast mouse look: direct camera.rotation.y & camera.rotation.x update with rotation.order = 'YXZ'
    window.addEventListener('mousemove', (e) => {
      if (!this.running || (this.mode !== 'explore' && this.mode !== 'ending_poweroff')) return;
      if (document.pointerLockElement === dom) {
        this.yaw -= e.movementX * 0.0022 * this.lookSensitivity;
        this.pitch -= e.movementY * 0.0022 * this.lookSensitivity;
        if (this.pitch < -1.1) this.pitch = -1.1;
        else if (this.pitch > 1.1) this.pitch = 1.1;
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
      } else if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.yaw -= dx * 0.004 * this.lookSensitivity;
        this.pitch -= dy * 0.004 * this.lookSensitivity;
        if (this.pitch < -1.1) this.pitch = -1.1;
        else if (this.pitch > 1.1) this.pitch = 1.1;
        this.camera.rotation.y = this.yaw;
        this.camera.rotation.x = this.pitch;
      }
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.running || (this.mode !== 'explore' && this.mode !== 'ending_poweroff')) return;
    this.keys[e.code] = true;
    // 1-second E-key Hold Interaction (ignore key-repeat, never trigger immediately on press)
    if (e.code === 'KeyE') {
      if (e.repeat) return;
      if (this.lastTarget && !this.isHoldingE) {
        this.isHoldingE = true;
        this.holdStartTime = performance.now();
        this.holdTarget = this.lastTarget;
        this.reportHoldProgress(0);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
    if (e.code === 'KeyE' && this.isHoldingE) {
      this.cancelHold();
    }
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.pausedRendered = false;
  };

  private isPositionBlocked(x: number, z: number): boolean {
    for (let i = 0; i < ROOM_COLLIDERS.length; i++) {
      const c = ROOM_COLLIDERS[i];
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) {
        return true;
      }
    }
    return false;
  }

  private updateMovement(dt: number): void {
    if (this.keys['ArrowLeft']) {
      this.yaw += 1.8 * dt;
      this.camera.rotation.y = this.yaw;
    }
    if (this.keys['ArrowRight']) {
      this.yaw -= 1.8 * dt;
      this.camera.rotation.y = this.yaw;
    }

    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rightX = Math.cos(this.yaw);
    const rightZ = -Math.sin(this.yaw);

    let moveX = 0;
    let moveZ = 0;
    if (this.keys['KeyW']) {
      moveX += fwdX;
      moveZ += fwdZ;
    }
    if (this.keys['KeyS']) {
      moveX -= fwdX;
      moveZ -= fwdZ;
    }
    if (this.keys['KeyD']) {
      moveX += rightX;
      moveZ += rightZ;
    }
    if (this.keys['KeyA']) {
      moveX -= rightX;
      moveZ -= rightZ;
    }

    const lenSq = moveX * moveX + moveZ * moveZ;
    if (lenSq > 0) {
      const invLen = (2.75 * dt) / Math.sqrt(lenSq);
      let candX = this.camera.position.x + moveX * invLen;
      let candZ = this.camera.position.z + moveZ * invLen;

      if (candX < -2.62) candX = -2.62;
      else if (candX > 2.62) candX = 2.62;
      if (candZ < -2.05) candZ = -2.05;
      else if (candZ > 2.62) candZ = 2.62;

      if (!this.isPositionBlocked(candX, this.camera.position.z)) {
        this.camera.position.x = candX;
      }
      if (!this.isPositionBlocked(this.camera.position.x, candZ)) {
        this.camera.position.z = candZ;
      }
    }
  }

  private updateProximityTarget(): void {
    // Pure squared-distance + facing check on 4 fixed coordinates (zero Raycaster!)
    const px = this.camera.position.x;
    const pz = this.camera.position.z;
    const lookX = -Math.sin(this.yaw);
    const lookZ = -Math.cos(this.yaw);

    let bestTarget: RoomInteractTarget | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < INTERACT_POINTS.length; i++) {
      const pt = INTERACT_POINTS[i];
      const dx = pt.x - px;
      const dz = pt.z - pz;
      const distSq = dx * dx + dz * dz;
      if (distSq > pt.maxDistSq) continue;

      const dist = Math.sqrt(distSq) || 0.001;
      const facingDot = (dx * lookX + dz * lookZ) / dist;
      if (facingDot < 0.42) continue;

      // Prefer object most directly in front & closest
      const score = facingDot * 2.0 - dist * 0.35;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = pt.id;
      }
    }

    // Strict state guard: update DOM ONLY when target (or ending mode label) actually changed!
    if (bestTarget !== this.lastTarget || (bestTarget === 'computer' && this.mode !== this.lastTargetMode)) {
      if (this.isHoldingE && bestTarget !== this.holdTarget) {
        this.cancelHold();
      }
      this.lastTarget = bestTarget;
      this.lastTargetMode = this.mode;
      let label = '';
      if (bestTarget === 'notebook') label = '꾹 눌러서 파이썬 수첩 읽기';
      else if (bestTarget === 'door') label = '꾹 눌러서 문 확인하기';
      else if (bestTarget === 'window') label = '꾹 눌러서 창문 확인하기';
      else if (bestTarget === 'computer') {
        label =
          this.mode === 'ending_poweroff'
            ? '꾹 눌러서 컴퓨터 전원 완전히 끄기'
            : '꾹 눌러서 컴퓨터 사용하기';
      }
      this.callbacks.onHoverChange(bestTarget, label);
    }
  }

  private updateHoldInteraction(now: number): void {
    if (!this.isHoldingE) return;
    if (
      !this.running ||
      (this.mode !== 'explore' && this.mode !== 'ending_poweroff') ||
      !this.lastTarget ||
      this.lastTarget !== this.holdTarget
    ) {
      this.cancelHold();
      return;
    }

    const elapsed = now - this.holdStartTime;
    const ratio = Math.min(1, Math.max(0, elapsed / HOLD_DURATION_MS));
    this.reportHoldProgress(ratio);

    if (ratio >= 1) {
      const completedTarget = this.holdTarget;
      this.cancelHold();
      if (completedTarget) {
        this.callbacks.onInteract(completedTarget);
      }
    }
  }

  private tick = (): void => {
    this.roomAnimId = 0;
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.mode === 'paused' || this.mode === 'blackout') {
      if (this.isHoldingE) this.cancelHold();
      if (!this.pausedRendered) {
        this.renderer.render(this.scene, this.camera);
        this.pausedRendered = true;
      }
      this.roomAnimId = requestAnimationFrame(this.tick);
      return;
    }

    this.pausedRendered = false;

    if (this.mode === 'explore') {
      this.updateMovement(dt);
      this.updateProximityTarget();
      this.updateHoldInteraction(now);
    } else if (this.mode === 'booting_pc') {
      this.pcBootProgress = Math.min(1, this.pcBootProgress + dt * 1.45);
      if (this.pcBootProgress >= 1) {
        const cb = this.pcBootCallback;
        this.pcBootCallback = null;
        if (cb) cb();
      }
    } else if (this.mode === 'zooming_in') {
      this.camera.position.x = THREE.MathUtils.damp(this.camera.position.x, this.zoomTargetPos.x, 5.8, dt);
      this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.zoomTargetPos.y, 5.8, dt);
      this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.zoomTargetPos.z, 5.8, dt);
      _lookMat.lookAt(this.camera.position, this.zoomLookTarget, _up);
      _targetLookQuat.setFromRotationMatrix(_lookMat);
      this.camera.quaternion.slerp(_targetLookQuat, 1 - Math.exp(-6.5 * dt));

      if (this.camera.position.distanceTo(this.zoomTargetPos) < 0.08) {
        const cb = this.zoomCallback;
        this.zoomCallback = null;
        this.mode = 'paused';
        if (cb) cb();
      }
    } else if (this.mode === 'ending_poweroff') {
      if (this.camera.position.z < -1.06 && !this.keys['KeyW']) {
        this.camera.position.z = THREE.MathUtils.damp(this.camera.position.z, this.zoomOutPos.z, 3.8, dt);
        this.camera.position.y = THREE.MathUtils.damp(this.camera.position.y, this.zoomOutPos.y, 3.8, dt);
      } else {
        this.updateMovement(dt);
      }
      this.updateProximityTarget();
      this.updateHoldInteraction(now);
    }

    this.renderer.render(this.scene, this.camera);
    if (this.running) {
      this.roomAnimId = requestAnimationFrame(this.tick);
    }
  };
}
