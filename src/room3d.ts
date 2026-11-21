import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type RoomInteractTarget = 'notebook' | 'computer' | 'door' | 'window';
export type RoomMode = 'explore' | 'booting_pc' | 'zooming_in' | 'paused' | 'ending_poweroff' | 'blackout';

interface RoomCallbacks {
  onInteract: (target: RoomInteractTarget) => void;
  onHoverChange: (target: RoomInteractTarget | null, label: string) => void;
}

const MAX_INTERACT_DISTANCE = 2.65;

const _vec2Center = new THREE.Vector2(0, 0);
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDelta = new THREE.Vector3();
const _targetLookQuat = new THREE.Quaternion();
const _lookMat = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

// Create a gently curved widescreen panel geometry bending toward the viewer (+Z)
function createCurvedScreenGeometry(width: number, height: number, radius: number, segments = 24): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, height, segments, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const theta = x / radius;
    const zOffset = radius * (1 - Math.cos(theta));
    pos.setZ(i, zOffset);
  }
  geo.computeVertexNormals();
  return geo;
}

// Create a soft organic wrinkled blanket surface for natural fabric folds
function createWrinkledClothGeometry(
  width: number,
  depth: number,
  segX = 24,
  segZ = 24,
  amplitude = 0.026,
  seed = 1
): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const nx = x / (width * 0.5);
    const nz = z / (depth * 0.5);
    const ridge1 = Math.sin(x * 7.5 + z * 4.2 + seed) * 0.55;
    const ridge2 = Math.cos(x * 13.0 - z * 6.5 + seed * 2.1) * 0.3;
    const ridge3 = Math.sin((x + z) * 18.0 + seed * 0.7) * 0.15;
    const edgeFade = Math.max(0.18, 1 - Math.pow(nx, 4) * 0.55 - Math.pow(nz, 4) * 0.45);
    const y = (ridge1 + ridge2 + ridge3) * amplitude * edgeFade;
    pos.setY(i, y);
  }
  geo.computeVertexNormals();
  return geo;
}

export class DeveloperRoom3D {
  private container: HTMLElement;
  private callbacks: RoomCallbacks;
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private interactables: THREE.Object3D[] = [];
  private targetAnchors = new Map<RoomInteractTarget, THREE.Vector3>();
  private isSoftwareGl = false;
  private frameId = 0;
  private running = false;
  private pausedRendered = false;
  private lastTime = performance.now();
  private dayBgColor = new THREE.Color(0xe9eef4);
  private darkBgColor = new THREE.Color(0x000000);
  private dayFog = new THREE.FogExp2(0xeae6df, 0.011);
  private darkFog = new THREE.FogExp2(0x000000, 0.08);

  public mode: RoomMode = 'paused';
  private yaw = -0.18;
  private pitch = -0.06;
  private lookSensitivity = 1.0;
  private keys: Record<string, boolean> = {};
  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;
  private currentHover: RoomInteractTarget | null = null;

  public setSensitivity(mult: number): void {
    this.lookSensitivity = Math.max(0.3, Math.min(2.5, mult));
  }

  // Lighting & Screen materials
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  private ceilingLight!: THREE.PointLight;
  private deskLampLight!: THREE.PointLight;
  private pcInteriorLight!: THREE.PointLight;
  private pcInteriorLedMat!: THREE.MeshStandardMaterial;
  private pcStripLedMat!: THREE.MeshStandardMaterial;
  private monitorScreenMesh!: THREE.Mesh;
  private monitorOnMat!: THREE.MeshStandardMaterial;
  private monitorOffMat!: THREE.MeshStandardMaterial;
  private pcPowerLedMat!: THREE.MeshStandardMaterial;
  private pcBootProgress = 0;
  private pcBootCallback: (() => void) | null = null;

  // Shared procedural textures
  private floorWoodTex!: THREE.CanvasTexture;
  private floorBumpTex!: THREE.CanvasTexture;
  private wallPaperTex!: THREE.CanvasTexture;
  private wallBumpTex!: THREE.CanvasTexture;
  private deskOakTex!: THREE.CanvasTexture;
  private bookshelfOakTex!: THREE.CanvasTexture;
  private darkWalnutTex!: THREE.CanvasTexture;
  private linenGrayTex!: THREE.CanvasTexture;
  private knitBlanketTex!: THREE.CanvasTexture;
  private vintageRugTex!: THREE.CanvasTexture;
  private meshBinAlphaTex!: THREE.CanvasTexture;

  // Camera transition targets (aligned with the wall-flush desk & single central wide monitor)
  private zoomTargetPos = new THREE.Vector3(0, 1.18, -2.18);
  private zoomLookTarget = new THREE.Vector3(0, 1.16, -2.96);
  private zoomOutPos = new THREE.Vector3(0, 1.46, -1.02);
  private zoomCallback: (() => void) | null = null;

  constructor(container: HTMLElement, callbacks: RoomCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.init();
  }

  private detectSoftwareGl(): boolean {
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    } catch {
      return true;
    }
  }

  private createCanvasTexture(
    w: number,
    h: number,
    drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    repeatX = 1,
    repeatY = 1,
    isColorMap = true
  ): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    if (isColorMap) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (repeatX > 1 || repeatY > 1) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    }
    return tex;
  }

  private hash2d(i: number, seed = 17): number {
    const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  private createProceduralTextures(): void {
    // 1. Warm Honey-Oak Hardwood Planks (albedo + bump map for wood plank seams & grain)
    this.floorWoodTex = this.createCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        ctx.fillStyle = '#b48354';
        ctx.fillRect(0, 0, w, h);
        const plankRows = 8;
        const plankH = h / plankRows;
        const baseTones = ['#bc8b5b', '#a87648', '#c69767', '#b18050', '#c09060', '#9f6e42'];

        for (let r = 0; r < plankRows; r++) {
          const y0 = r * plankH;
          const jointX = Math.floor(((r * 197 + 84) % (w - 96)) + 48);
          const segments: Array<[number, number, string]> = [
            [0, jointX, baseTones[r % baseTones.length]],
            [jointX, w - jointX, baseTones[(r + 3) % baseTones.length]],
          ];

          for (const [sx, sw, tone] of segments) {
            ctx.fillStyle = tone;
            ctx.fillRect(sx, y0, sw, plankH);

            // Subtle longitudinal shade variation
            const shadeGrad = ctx.createLinearGradient(sx, y0, sx + sw, y0 + plankH);
            shadeGrad.addColorStop(0, 'rgba(255, 236, 206, 0.08)');
            shadeGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.0)');
            shadeGrad.addColorStop(1, 'rgba(62, 34, 14, 0.12)');
            ctx.fillStyle = shadeGrad;
            ctx.fillRect(sx, y0, sw, plankH);

            // Flowing organic wood grain fibers
            for (let g = 0; g < 18; g++) {
              const gy = y0 + 2.5 + (g / 18) * (plankH - 5);
              ctx.strokeStyle =
                g % 3 === 0 ? 'rgba(72, 42, 18, 0.22)' : 'rgba(248, 224, 188, 0.13)';
              ctx.lineWidth = 0.8 + (g % 3) * 0.45;
              ctx.beginPath();
              ctx.moveTo(sx, gy);
              for (let px = sx; px <= sx + sw; px += 20) {
                const wave = Math.sin(px * 0.022 + r * 2.1 + g * 0.85) * 2.4;
                ctx.lineTo(px, gy + wave);
              }
              ctx.stroke();
            }

            // Natural oak knot
            if ((r + sx) % 3 === 0 && sw > 110) {
              const kx = sx + sw * 0.54;
              const ky = y0 + plankH * 0.5;
              ctx.strokeStyle = 'rgba(64, 36, 14, 0.34)';
              ctx.lineWidth = 1.4;
              ctx.beginPath();
              ctx.ellipse(kx, ky, 9, 3.8, 0.08, 0, Math.PI * 2);
              ctx.stroke();
              ctx.fillStyle = 'rgba(62, 35, 14, 0.25)';
              ctx.beginPath();
              ctx.ellipse(kx, ky, 4, 1.8, 0.08, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          // Deep beveled plank grooves
          ctx.fillStyle = 'rgba(48, 28, 12, 0.62)';
          ctx.fillRect(0, y0 + plankH - 2, w, 2);
          ctx.fillStyle = 'rgba(255, 234, 200, 0.12)';
          ctx.fillRect(0, y0, w, 1);
          ctx.fillStyle = 'rgba(48, 28, 12, 0.55)';
          ctx.fillRect(jointX - 1, y0, 2, plankH);
        }
      },
      3,
      3,
      true
    );

    this.floorBumpTex = this.createCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        ctx.fillStyle = '#c8c8c8';
        ctx.fillRect(0, 0, w, h);
        const plankRows = 8;
        const plankH = h / plankRows;
        for (let r = 0; r < plankRows; r++) {
          const y0 = r * plankH;
          const jointX = Math.floor(((r * 197 + 84) % (w - 96)) + 48);
          for (let g = 0; g < 14; g++) {
            const gy = y0 + (g / 14) * plankH;
            ctx.fillStyle = g % 2 === 0 ? 'rgba(255,255,255,0.08)' : 'rgba(60,60,60,0.08)';
            ctx.fillRect(0, gy, w, 1.5);
          }
          ctx.fillStyle = '#242424';
          ctx.fillRect(0, y0 + plankH - 2, w, 2);
          ctx.fillRect(jointX - 1, y0, 2, plankH);
        }
      },
      3,
      3,
      false
    );

    // 2. Warm Ivory / Light-Gray Textured Matte Plaster Wallpaper + Bump Map
    this.wallPaperTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#e4ddd1';
        ctx.fillRect(0, 0, w, h);
        // Soft mottled plaster clouds
        for (let i = 0; i < 42; i++) {
          const cx = this.hash2d(i, 3) * w;
          const cy = this.hash2d(i, 13) * h;
          const rad = 18 + this.hash2d(i, 23) * 34;
          const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad);
          const warm = i % 2 === 0 ? 'rgba(198, 188, 172, 0.14)' : 'rgba(252, 249, 244, 0.16)';
          grad.addColorStop(0, warm);
          grad.addColorStop(1, 'rgba(228, 221, 209, 0)');
          ctx.fillStyle = grad;
          ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
        }
        // Fine plaster micro-speckle
        for (let i = 0; i < 3200; i++) {
          const nx = Math.floor(this.hash2d(i, 7) * w);
          const ny = Math.floor(this.hash2d(i, 19) * h);
          const alpha = 0.025 + this.hash2d(i, 31) * 0.05;
          ctx.fillStyle = i % 2 === 0 ? `rgba(116, 108, 96, ${alpha})` : `rgba(255, 253, 248, ${alpha})`;
          ctx.fillRect(nx, ny, 2, 2);
        }
      },
      4,
      2,
      true
    );

    this.wallBumpTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) {
          const nx = Math.floor(this.hash2d(i, 41) * w);
          const ny = Math.floor(this.hash2d(i, 53) * h);
          const v = Math.floor(110 + this.hash2d(i, 67) * 44);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(nx, ny, 2, 2);
        }
      },
      4,
      2,
      false
    );

    // 3. Natural Furniture Wood Grain Textures (Desk Oak, Bookshelf Oak, Dark Walnut)
    const buildWoodTex = (
      baseHex: string,
      grainDark: string,
      grainLight: string,
      plankCount = 0
    ) =>
      this.createCanvasTexture(
        512,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = baseHex;
          ctx.fillRect(0, 0, w, h);
          if (plankCount > 0) {
            const ph = h / plankCount;
            for (let p = 0; p < plankCount; p++) {
              ctx.fillStyle = p % 2 === 0 ? 'rgba(255, 238, 210, 0.06)' : 'rgba(65, 38, 16, 0.06)';
              ctx.fillRect(0, p * ph, w, ph);
              ctx.fillStyle = 'rgba(56, 32, 12, 0.25)';
              ctx.fillRect(0, p * ph, w, 1.5);
            }
          }
          for (let i = 0; i < 72; i++) {
            const y = (i / 72) * h;
            ctx.strokeStyle = i % 3 === 0 ? grainDark : grainLight;
            ctx.lineWidth = 0.9 + (i % 3) * 0.55;
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 0; x <= w; x += 18) {
              const offset = Math.sin(x * 0.02 + i * 0.6) * 2.8 + Math.cos(x * 0.008 + i) * 1.4;
              ctx.lineTo(x, y + offset);
            }
            ctx.stroke();
          }
        },
        1,
        1,
        true
      );

    this.deskOakTex = buildWoodTex('#cca06b', 'rgba(84, 52, 22, 0.22)', 'rgba(255, 238, 212, 0.14)', 4);
    this.bookshelfOakTex = buildWoodTex('#b68b5a', 'rgba(72, 44, 18, 0.22)', 'rgba(246, 222, 188, 0.12)', 0);
    this.darkWalnutTex = buildWoodTex('#6e4c31', 'rgba(34, 19, 8, 0.28)', 'rgba(176, 136, 98, 0.14)', 0);

    // 4. Matte Linen Bedding Texture (cool warm-gray linen weave)
    this.linenGrayTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#c9ccd0';
        ctx.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 3) {
          ctx.fillStyle = y % 6 === 0 ? 'rgba(255,255,255,0.14)' : 'rgba(82,88,96,0.09)';
          ctx.fillRect(0, y, w, 1);
        }
        for (let x = 0; x < w; x += 3) {
          ctx.fillStyle = x % 6 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(72,78,86,0.08)';
          ctx.fillRect(x, 0, 1, h);
        }
        // Soft natural fabric creases
        for (let i = 0; i < 16; i++) {
          const sx = this.hash2d(i, 9) * w;
          const sy = this.hash2d(i, 21) * h;
          ctx.strokeStyle = i % 2 === 0 ? 'rgba(92,98,108,0.12)' : 'rgba(255,255,255,0.15)';
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx + 25, sy + 18, sx + 55, sy + 6);
          ctx.stroke();
        }
      },
      3,
      3,
      true
    );

    // 5. Chunky Oatmeal Knit Throw Blanket Texture (matches rumpled knit blanket in reference)
    this.knitBlanketTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#c5b091';
        ctx.fillRect(0, 0, w, h);
        const colStep = 12;
        const rowStep = 10;
        for (let y = 0; y < h; y += rowStep) {
          for (let x = 0; x < w; x += colStep) {
            // V-stitch cable knit loop
            ctx.strokeStyle = 'rgba(248, 238, 222, 0.42)';
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(x + 2, y + 2);
            ctx.lineTo(x + colStep * 0.5, y + rowStep - 2);
            ctx.lineTo(x + colStep - 2, y + 2);
            ctx.stroke();

            ctx.strokeStyle = 'rgba(96, 74, 48, 0.34)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(x + 1, y + 4);
            ctx.lineTo(x + colStep * 0.5, y + rowStep);
            ctx.lineTo(x + colStep - 1, y + 4);
            ctx.stroke();
          }
        }
      },
      4,
      4,
      true
    );

    // 6. Vintage Patterned Persian / Bohemian Floor Rug Texture (matches reference rug!)
    this.vintageRugTex = this.createCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        // Warm distressed cream/stone base
        ctx.fillStyle = '#c8beae';
        ctx.fillRect(0, 0, w, h);

        // Outer dark charcoal & muted crimson borders
        ctx.strokeStyle = '#3a2d28';
        ctx.lineWidth = 22;
        ctx.strokeRect(16, 16, w - 32, h - 32);

        ctx.strokeStyle = '#7d443a';
        ctx.lineWidth = 10;
        ctx.strokeRect(36, 36, w - 72, h - 72);

        ctx.strokeStyle = '#4c3e37';
        ctx.lineWidth = 3;
        ctx.strokeRect(52, 52, w - 104, h - 104);

        // Decorative border motifs
        ctx.fillStyle = '#6e3a32';
        for (let i = 44; i < w - 44; i += 24) {
          ctx.fillRect(i - 4, 11, 8, 10);
          ctx.fillRect(i - 4, h - 21, 8, 10);
          ctx.fillRect(11, i - 4, 10, 8);
          ctx.fillRect(w - 21, i - 4, 10, 8);
        }

        // Inner vintage patterned field
        ctx.fillStyle = '#b9ad9b';
        ctx.fillRect(58, 58, w - 116, h - 116);

        // Subtle ornamental diamond lattice
        ctx.strokeStyle = 'rgba(74, 52, 44, 0.35)';
        ctx.lineWidth = 2;
        const step = 36;
        for (let y = 70; y <= h - 70; y += step) {
          for (let x = 70; x <= w - 70; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, y - 12);
            ctx.lineTo(x + 12, y);
            ctx.lineTo(x, y + 12);
            ctx.lineTo(x - 12, y);
            ctx.closePath();
            ctx.stroke();

            ctx.fillStyle = (x + y) % 72 === 0 ? 'rgba(122, 62, 52, 0.4)' : 'rgba(56, 62, 70, 0.32)';
            ctx.beginPath();
            ctx.arc(x, y, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Central distressed medallion
        const cx = w / 2;
        const cy = h / 2;
        ctx.fillStyle = 'rgba(116, 56, 48, 0.65)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 92);
        ctx.lineTo(cx + 68, cy);
        ctx.lineTo(cx, cy + 92);
        ctx.lineTo(cx - 68, cy);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = '#dfd5c5';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = '#38302d';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 42);
        ctx.lineTo(cx + 30, cy);
        ctx.lineTo(cx, cy + 42);
        ctx.lineTo(cx - 30, cy);
        ctx.closePath();
        ctx.fill();

        // Woven carpet fiber noise overlay
        for (let i = 0; i < 4500; i++) {
          const rx = Math.floor(this.hash2d(i, 11) * w);
          const ry = Math.floor(this.hash2d(i, 29) * h);
          ctx.fillStyle = i % 2 === 0 ? 'rgba(255,250,240,0.09)' : 'rgba(38,28,22,0.09)';
          ctx.fillRect(rx, ry, 2, 2);
        }
      },
      1,
      1,
      true
    );

    // 7. Wire-Mesh Wastebasket Alpha Texture (crisp perforated metal grid)
    this.meshBinAlphaTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, w, h);
        // Solid top & bottom rim bands
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, 16);
        ctx.fillRect(0, h - 18, w, 18);
        // Fine diagonal wire mesh lattice
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.4;
        const gap = 10;
        for (let i = -h; i < w + h; i += gap) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + h, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(i + h, 0);
          ctx.lineTo(i, h);
          ctx.stroke();
        }
      },
      3,
      2,
      false
    );
  }

  private init(): void {
    this.isSoftwareGl = this.detectSoftwareGl();

    this.scene = new THREE.Scene();
    this.scene.background = this.dayBgColor;
    this.scene.fog = this.dayFog;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 45);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Cap pixel ratio to 1.5 for crisp photorealistic quality with lower GPU fill-rate load
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Static furniture & sunlight: bake shadow map once instead of redrawing every frame
    this.renderer.shadowMap.autoUpdate = false;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.44;
    pmrem.dispose();

    this.createProceduralTextures();
    this.buildPhotorealDaylightRig();
    this.buildRoomShell();
    this.buildCompositeBedAndNightstand();
    this.buildWallFlushDeskAndChair();
    this.buildCompositeComputerStation();
    this.buildDeskPropsAndCables();
    this.buildCompositeNotebook();
    this.buildBookshelvesAndWastebasket();
    this.buildCompositeDoorAndWindow();
    this.buildWallPostersAndFrames();

    this.resetOpeningAtBed();

    if (!this.isSoftwareGl) {
      this.renderer.shadowMap.needsUpdate = true;
      this.renderer.compile(this.scene, this.camera);
    }
    this.bindEvents();
  }

  private buildPhotorealDaylightRig(): void {
    // Soft neutral baseline ambient
    this.ambientLight = new THREE.AmbientLight(0xfff5e8, 0.28);
    this.scene.add(this.ambientLight);

    // Indoor bounce: cool daytime window sky above + warm oak hardwood reflection below
    this.hemiLight = new THREE.HemisphereLight(0xeef5ff, 0x9b744c, 0.85);
    this.scene.add(this.hemiLight);

    // Warm afternoon sunlight entering obliquely from the RIGHT window (x = +3.18, z = -1.25)
    this.sunLight = new THREE.DirectionalLight(0xffe7c4, 2.35);
    this.sunLight.position.set(5.4, 3.65, -0.55);
    this.sunLight.target.position.set(-1.1, 0.4, -1.05);
    if (!this.isSoftwareGl) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(1024, 1024);
      this.sunLight.shadow.camera.near = 0.5;
      this.sunLight.shadow.camera.far = 14.5;
      this.sunLight.shadow.camera.left = -4.0;
      this.sunLight.shadow.camera.right = 4.0;
      this.sunLight.shadow.camera.top = 3.8;
      this.sunLight.shadow.camera.bottom = -3.8;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.022;
      this.sunLight.shadow.radius = 2.8;
    }
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Subtle overhead daylight bounce fill (keeps shadows natural and readable)
    this.ceilingLight = new THREE.PointLight(0xfff6e8, 0.72, 12, 1.5);
    this.ceilingLight.position.set(0.2, 2.85, 0.15);
    this.scene.add(this.ceilingLight);

    // Warm incandescent desk/nightstand architect lamp PointLight (left of desk)
    this.deskLampLight = new THREE.PointLight(0xffcb84, 1.45, 4.2, 1.6);
    this.deskLampLight.position.set(-1.12, 1.24, -2.72);
    this.scene.add(this.deskLampLight);

    // Subtle cool-white interior glow from the tempered-glass custom PC tower (right of desk)
    this.pcInteriorLight = new THREE.PointLight(0xd9ecff, 0.95, 2.4, 1.8);
    this.pcInteriorLight.position.set(0.66, 1.06, -2.70);
    this.scene.add(this.pcInteriorLight);
  }

  private buildRoomShell(): void {
    const roomW = 6.4;
    const roomD = 6.4;
    const roomH = 3.05;
    const halfW = roomW * 0.5;
    const halfD = roomD * 0.5;

    // Warm semi-gloss oak hardwood floor (roughness: 0.45)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(roomW, roomD),
      new THREE.MeshStandardMaterial({
        map: this.floorWoodTex,
        bumpMap: this.floorBumpTex,
        bumpScale: 0.012,
        roughness: 0.45,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Matte textured ivory/light-gray wallpaper (roughness: 0.9)
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.wallPaperTex,
      bumpMap: this.wallBumpTex,
      bumpScale: 0.008,
      roughness: 0.9,
      metalness: 0.0,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xf4f1eb,
      roughness: 0.52,
      metalness: 0.02,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0xf2efe9,
      roughness: 0.9,
      metalness: 0.0,
    });

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomD), ceilingMat);
    ceiling.position.y = roomH;
    ceiling.rotation.x = Math.PI / 2;
    this.scene.add(ceiling);

    // Flush-mount minimalist ceiling fixture
    const fixtureGroup = new THREE.Group();
    fixtureGroup.position.set(0, roomH - 0.03, -0.2);
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0xd6dae0,
      roughness: 0.25,
      metalness: 0.8,
    });
    const frameRing = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.045, 24), housingMat);
    const diffuser = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xfff3de,
        emissiveIntensity: 0.65,
        roughness: 0.4,
      })
    );
    diffuser.position.y = -0.022;
    fixtureGroup.add(frameRing, diffuser);
    this.scene.add(fixtureGroup);

    const walls: Array<[number, number, number, number]> = [
      [0, roomH * 0.5, -halfD, 0],
      [0, roomH * 0.5, halfD, Math.PI],
      [-halfW, roomH * 0.5, 0, Math.PI / 2],
      [halfW, roomH * 0.5, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, ry] of walls) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(roomW, roomH), wallMat);
      w.position.set(x, y, z);
      w.rotation.y = ry;
      w.receiveShadow = true;
      this.scene.add(w);

      // Clean architectural baseboards & subtle crown molding
      const baseboard = new THREE.Mesh(new THREE.BoxGeometry(roomW, 0.095, 0.028), trimMat);
      baseboard.position.set(x, 0.048, z);
      baseboard.rotation.y = ry;
      baseboard.receiveShadow = true;
      this.scene.add(baseboard);

      const crown = new THREE.Mesh(new THREE.BoxGeometry(roomW, 0.05, 0.024), trimMat);
      crown.position.set(x, roomH - 0.025, z);
      crown.rotation.y = ry;
      this.scene.add(crown);
    }

    // Vintage Patterned Floor Rug under desk & chair (matte fabric roughness: 0.9)
    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(2.58, 0.014, 2.08),
      new THREE.MeshStandardMaterial({
        map: this.vintageRugTex,
        roughness: 0.9,
        metalness: 0.0,
      })
    );
    rug.position.set(0.02, 0.007, -1.68);
    rug.receiveShadow = true;
    this.scene.add(rug);
  }

  private buildCompositeBedAndNightstand(): void {
    // Cozy Upholstered Bed tucked against the LEFT wall (back-left zone, matching reference image)
    const bed = new THREE.Group();
    bed.position.set(-2.36, 0, -1.94);

    const frameFabricMat = new THREE.MeshStandardMaterial({
      map: this.linenGrayTex,
      color: 0x6c7178,
      roughness: 0.9,
      metalness: 0.0,
    });
    const oakLegMat = new THREE.MeshStandardMaterial({
      map: this.bookshelfOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const sheetMat = new THREE.MeshStandardMaterial({
      map: this.linenGrayTex,
      color: 0xe6e7e8,
      roughness: 0.9,
      metalness: 0.0,
    });
    const duvetMat = new THREE.MeshStandardMaterial({
      map: this.linenGrayTex,
      color: 0xbcc1c6,
      roughness: 0.9,
      metalness: 0.0,
    });
    const knitThrowMat = new THREE.MeshStandardMaterial({
      map: this.knitBlanketTex,
      roughness: 0.9,
      metalness: 0.0,
    });
    const accentPillowMat = new THREE.MeshStandardMaterial({
      map: this.linenGrayTex,
      color: 0xc2b299,
      roughness: 0.9,
      metalness: 0.0,
    });

    // 4 Short Tapered Wooden Bed Legs
    for (const lx of [-0.62, 0.62]) {
      for (const lz of [-0.94, 0.94]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.14, 12), oakLegMat);
        leg.position.set(lx, 0.07, lz);
        leg.castShadow = true;
        leg.receiveShadow = true;
        bed.add(leg);
      }
    }

    // Upholstered Dark-Gray Platform Base
    const baseBox = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.24, 2.08), frameFabricMat);
    baseBox.position.y = 0.24;
    baseBox.castShadow = true;
    baseBox.receiveShadow = true;
    bed.add(baseBox);

    // Subtle Padded Headboard against the back wall
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.56, 0.09), frameFabricMat);
    headboard.position.set(0, 0.58, -1.0);
    headboard.castShadow = true;
    headboard.receiveShadow = true;
    bed.add(headboard);

    // Plush White/Ivory Mattress
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.22, 1.98), sheetMat);
    mattress.position.set(0, 0.46, 0.02);
    mattress.castShadow = true;
    mattress.receiveShadow = true;
    bed.add(mattress);

    // Wrinkled Light-Gray Duvet Layer
    const duvetBase = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.075, 1.38), duvetMat);
    duvetBase.position.set(0, 0.59, 0.26);
    duvetBase.castShadow = true;
    duvetBase.receiveShadow = true;
    bed.add(duvetBase);

    const duvetTopCloth = new THREE.Mesh(
      createWrinkledClothGeometry(1.38, 1.38, 22, 22, 0.024, 2.3),
      duvetMat
    );
    duvetTopCloth.position.set(0, 0.635, 0.26);
    duvetTopCloth.castShadow = true;
    duvetTopCloth.receiveShadow = true;
    bed.add(duvetTopCloth);

    // Rumpled Chunky Oatmeal Knit Throw Blanket draped diagonally over the bed & cascading over the foot
    const knitTop = new THREE.Mesh(
      createWrinkledClothGeometry(1.22, 1.02, 26, 22, 0.036, 5.1),
      knitThrowMat
    );
    knitTop.position.set(0.05, 0.665, 0.46);
    knitTop.rotation.y = 0.14;
    knitTop.castShadow = true;
    knitTop.receiveShadow = true;
    bed.add(knitTop);

    // Natural bunched knit fold & front drape cascading toward the hardwood floor
    const knitRidge = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.082, 1.15, 14), knitThrowMat);
    knitRidge.rotation.z = Math.PI / 2;
    knitRidge.rotation.y = 0.16;
    knitRidge.scale.set(1, 1, 0.55);
    knitRidge.position.set(0.06, 0.64, 0.88);
    knitRidge.castShadow = true;
    bed.add(knitRidge);

    const knitCascade = new THREE.Mesh(
      createWrinkledClothGeometry(0.86, 0.54, 16, 12, 0.028, 8.4),
      knitThrowMat
    );
    knitCascade.rotation.x = Math.PI * 0.44;
    knitCascade.rotation.z = -0.08;
    knitCascade.position.set(0.08, 0.36, 1.04);
    knitCascade.castShadow = true;
    knitCascade.receiveShadow = true;
    bed.add(knitCascade);

    const knitSideDrape = new THREE.Mesh(
      createWrinkledClothGeometry(0.58, 0.44, 14, 10, 0.022, 3.7),
      knitThrowMat
    );
    knitSideDrape.rotation.z = -Math.PI * 0.46;
    knitSideDrape.position.set(0.71, 0.43, 0.48);
    knitSideDrape.castShadow = true;
    bed.add(knitSideDrape);

    // 2 Main Sleeping Pillows + 1 Warm Taupe Accent Pillow (matching reference image)
    for (const [px, pz, rotY, mat] of [
      [-0.31, -0.68, 0.08, sheetMat],
      [0.31, -0.66, -0.1, sheetMat],
      [-0.24, -0.34, 0.24, accentPillowMat],
    ] as Array<[number, number, number, THREE.Material]>) {
      const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), mat);
      pillow.scale.set(1.24, 0.35, 0.82);
      pillow.position.set(px, 0.64, pz);
      pillow.rotation.set(-0.18, rotY, 0);
      pillow.castShadow = true;
      pillow.receiveShadow = true;
      bed.add(pillow);
    }

    this.scene.add(bed);

    // Small Wooden Nightstand between Bed and Wall-Flush Desk (supports the architect lamp)
    const nightstand = new THREE.Group();
    nightstand.position.set(-1.38, 0, -2.94);

    const nsBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.52, 0.42), oakLegMat);
    nsBody.position.y = 0.26;
    nsBody.castShadow = true;
    nsBody.receiveShadow = true;
    nightstand.add(nsBody);

    const grooveMat = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.7 });
    for (const dy of [0.16, 0.37]) {
      const drFront = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.16, 0.018), oakLegMat);
      drFront.position.set(0, dy, 0.212);
      drFront.receiveShadow = true;
      const pullSlot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.018, 0.014), grooveMat);
      pullSlot.position.set(0, dy + 0.055, 0.22);
      nightstand.add(drFront, pullSlot);
    }
    this.scene.add(nightstand);
  }

  private buildWallFlushDeskAndChair(): void {
    // Wall-Flush Computer Desk (back edge at Z = -3.17 against Z = -3.20 wall!)
    const desk = new THREE.Group();
    desk.position.set(0, 0, -2.74);

    const woodTopMat = new THREE.MeshStandardMaterial({
      map: this.deskOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const drawerWoodMat = new THREE.MeshStandardMaterial({
      map: this.bookshelfOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const brushedMetalMat = new THREE.MeshStandardMaterial({
      color: 0xa6b0bc,
      roughness: 0.25,
      metalness: 0.8,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x353c46,
      roughness: 0.28,
      metalness: 0.8,
    });
    const recessSlotMat = new THREE.MeshStandardMaterial({
      color: 0x1b1511,
      roughness: 0.75,
    });

    // Thick Beveled Solid-Oak Tabletop (2.16m x 0.86m)
    const hw = 1.07;
    const hd = 0.42;
    const topShape = new THREE.Shape();
    topShape.moveTo(-hw, -hd);
    topShape.lineTo(hw, -hd);
    topShape.lineTo(hw, hd);
    topShape.lineTo(-hw, hd);
    topShape.closePath();

    const topGeo = new THREE.ExtrudeGeometry(topShape, {
      depth: 0.036,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.008,
      bevelSegments: 2,
    });
    topGeo.rotateX(Math.PI / 2);
    const tabletop = new THREE.Mesh(topGeo, woodTopMat);
    tabletop.position.y = 0.76;
    tabletop.castShadow = true;
    tabletop.receiveShadow = true;
    desk.add(tabletop);

    // Under-frame steel apron bar for structural realism
    const apron = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.032, 0.04), darkSteelMat);
    apron.position.set(0, 0.70, -0.32);
    desk.add(apron);

    // 4 Sturdy Brushed Metallic Cylindrical Legs + Foot Levelers
    for (const lx of [-0.96, 0.96]) {
      for (const lz of [-0.34, 0.34]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.715, 16), brushedMetalMat);
        leg.position.set(lx, 0.365, lz);
        leg.castShadow = true;
        leg.receiveShadow = true;
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.018, 14), darkSteelMat);
        collar.position.set(lx, 0.71, lz);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.018, 14), darkSteelMat);
        foot.position.set(lx, 0.009, lz);
        desk.add(leg, collar, foot);
      }
    }

    // Right-Side 3-Drawer Wood Cabinet (sleek recessed pull slots like reference photo)
    const drawerHousing = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.64, 0.68), drawerWoodMat);
    drawerHousing.position.set(0.67, 0.33, 0.02);
    drawerHousing.castShadow = true;
    drawerHousing.receiveShadow = true;
    desk.add(drawerHousing);

    for (let i = 0; i < 3; i++) {
      const dy = 0.13 + i * 0.205;
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.415, 0.185, 0.02), drawerWoodMat);
      front.position.set(0.67, dy, 0.365);
      front.receiveShadow = true;
      const pullCutout = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.022, 0.015), recessSlotMat);
      pullCutout.position.set(0.67, dy + 0.062, 0.372);
      desk.add(front, pullCutout);
    }

    this.scene.add(desk);

    // Ergonomic Racing-Style Gaming Chair in front of Desk (matches reference silhouette!)
    const chair = new THREE.Group();
    chair.position.set(-0.04, 0, -1.78);
    chair.rotation.y = 0.16;

    const leatherMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d21,
      roughness: 0.62,
      metalness: 0.08,
    });
    const trimAccentMat = new THREE.MeshStandardMaterial({
      color: 0x8f5634,
      roughness: 0.55,
      metalness: 0.1,
    });
    const meshSeatMat = new THREE.MeshStandardMaterial({
      map: this.linenGrayTex,
      color: 0x262930,
      roughness: 0.9,
      metalness: 0.0,
    });

    // 5-Star Base & Casters
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.06, 14), darkSteelMat);
    hub.position.y = 0.075;
    chair.add(hub);

    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.33, 10), darkSteelMat);
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.y = -ang;
      spoke.position.set(Math.cos(ang) * 0.165, 0.065, Math.sin(ang) * 0.165);

      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.028, 12), leatherMat);
      caster.rotation.z = Math.PI / 2;
      caster.rotation.y = -ang;
      caster.position.set(Math.cos(ang) * 0.31, 0.026, Math.sin(ang) * 0.31);
      chair.add(spoke, caster);
    }

    const gasLift = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.35, 14), brushedMetalMat);
    gasLift.position.y = 0.26;
    chair.add(gasLift);

    // Seat Base + Side Bolsters
    const seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.085, 0.48), meshSeatMat);
    seatBase.position.y = 0.46;
    seatBase.castShadow = true;
    seatBase.receiveShadow = true;
    chair.add(seatBase);

    for (const sx of [-0.25, 0.25]) {
      const seatBolster = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.11, 0.46), leatherMat);
      seatBolster.position.set(sx, 0.48, 0);
      seatBolster.rotation.z = sx > 0 ? 0.18 : -0.18;
      seatBolster.castShadow = true;
      chair.add(seatBolster);
    }

    // Racing Backrest (sculpted lower back + side wings + upper headrest with twin harness cutouts)
    const backLower = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.07), meshSeatMat);
    backLower.position.set(0, 0.72, 0.22);
    backLower.rotation.x = 0.09;
    backLower.castShadow = true;
    chair.add(backLower);

    for (const sx of [-0.22, 0.22]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.68, 0.1), leatherMat);
      wing.position.set(sx, 0.84, 0.21);
      wing.rotation.x = 0.09;
      wing.rotation.y = sx > 0 ? -0.22 : 0.22;
      wing.castShadow = true;
      chair.add(wing);

      const trimStripe = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.64, 0.02), trimAccentMat);
      trimStripe.position.set(sx * 1.12, 0.84, 0.17);
      trimStripe.rotation.x = 0.09;
      chair.add(trimStripe);
    }

    // Center pillar between the twin shoulder harness cutouts + top headrest arch
    const centerBridge = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.16, 0.065), leatherMat);
    centerBridge.position.set(0, 0.99, 0.245);
    centerBridge.rotation.x = 0.09;
    const headCrown = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.15, 0.075), leatherMat);
    headCrown.position.set(0, 1.13, 0.258);
    headCrown.rotation.x = 0.09;
    headCrown.castShadow = true;
    const headTrim = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.018, 0.08), trimAccentMat);
    headTrim.position.set(0, 1.21, 0.264);
    chair.add(centerBridge, headCrown, headTrim);

    // Armrests
    for (const ax of [-0.29, 0.29]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.19, 0.045), darkSteelMat);
      post.position.set(ax, 0.56, 0.02);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.028, 0.27), leatherMat);
      pad.position.set(ax, 0.66, 0.01);
      pad.castShadow = true;
      chair.add(post, pad);
    }

    this.scene.add(chair);
  }

  private buildCompositeComputerStation(): void {
    // Centered on the wall-flush desk (desk top surface is at Y = 0.768, Z center = -2.74)
    const pc = new THREE.Group();
    pc.position.set(0, 0.768, -2.74);

    const chassisBlackMat = new THREE.MeshStandardMaterial({
      color: 0x16191f,
      roughness: 0.38,
      metalness: 0.42,
    });
    const brushedAluminumMat = new THREE.MeshStandardMaterial({
      color: 0xc8cfd8,
      roughness: 0.25,
      metalness: 0.8,
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x3b424d,
      roughness: 0.25,
      metalness: 0.8,
    });

    // 1. SINGLE WIDE BLACK MONITOR WITH THIN BEZEL & V-SHAPED METALLIC STAND (dead center!)
    const standGroup = new THREE.Group();
    standGroup.position.set(0, 0, -0.22);

    // V-shaped splayed brushed-metal legs (matching reference photo!)
    for (const side of [-1, 1]) {
      const vLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.026), brushedAluminumMat);
      vLeg.position.set(side * 0.098, 0.008, 0.055);
      vLeg.rotation.y = side * -0.44;
      vLeg.castShadow = true;
      standGroup.add(vLeg);
    }
    // Rear stabilizing heel & tapered brushed-metal neck column
    const rearHeel = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.014, 0.085), brushedAluminumMat);
    rearHeel.position.set(0, 0.008, -0.01);
    const neckCol = new THREE.Mesh(new THREE.BoxGeometry(0.056, 0.34, 0.028), brushedAluminumMat);
    neckCol.position.set(0, 0.175, -0.032);
    neckCol.rotation.x = 0.08;
    neckCol.castShadow = true;
    const vesaHub = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.03), darkMetalMat);
    vesaHub.position.set(0, 0.34, -0.022);
    standGroup.add(rearHeel, neckCol, vesaHub);
    pc.add(standGroup);

    // Single Ultrawide Curved Thin-Bezel Monitor (1 monitor only!)
    const curveRadius = 2.5;
    const screenW = 0.94;
    const screenH = 0.44;

    const bezelBackGeo = createCurvedScreenGeometry(screenW + 0.022, screenH + 0.026, curveRadius, 24);
    const monitorBack = new THREE.Mesh(
      bezelBackGeo,
      new THREE.MeshStandardMaterial({
        color: 0x101216,
        roughness: 0.35,
        metalness: 0.45,
        side: THREE.DoubleSide,
      })
    );
    monitorBack.position.set(0, 0.39, -0.22);
    monitorBack.castShadow = true;

    // Slight dark metallic chin bar along the bottom bezel
    const chinGeo = createCurvedScreenGeometry(screenW + 0.022, 0.016, curveRadius, 24);
    const chinBar = new THREE.Mesh(chinGeo, darkMetalMat);
    chinBar.position.set(0, 0.39 - screenH * 0.5 - 0.006, -0.214);
    pc.add(chinBar);

    const screenTex = this.createCanvasTexture(512, 256, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#041a3c');
      grad.addColorStop(1, '#0b5ca8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(298, 56, 58, 58);
      ctx.fillRect(366, 56, 58, 58);
      ctx.fillRect(298, 124, 58, 58);
      ctx.fillRect(366, 124, 58, 58);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 21px sans-serif';
      ctx.fillText('CYBER-OS READY', 34, 62);
    });

    this.monitorOnMat = new THREE.MeshStandardMaterial({
      map: screenTex,
      emissive: 0x38bdf8,
      emissiveMap: screenTex,
      emissiveIntensity: 0,
      roughness: 0.16,
    });
    this.monitorOffMat = new THREE.MeshStandardMaterial({
      color: 0x07090c,
      emissive: 0x000000,
      roughness: 0.14,
      metalness: 0.15,
    });

    const screenGeo = createCurvedScreenGeometry(screenW, screenH, curveRadius, 24);
    this.monitorScreenMesh = new THREE.Mesh(screenGeo, this.monitorOffMat);
    this.monitorScreenMesh.position.set(0, 0.39, -0.214);
    pc.add(monitorBack, this.monitorScreenMesh);

    // 2. RGB MECHANICAL KEYBOARD (centered in front of monitor)
    const rgbKeyAlbedo = this.createCanvasTexture(512, 160, (ctx, w, h) => {
      ctx.fillStyle = '#12151a';
      ctx.fillRect(0, 0, w, h);
      const rows = 5;
      const cols = 18;
      const kw = (w - 18) / cols;
      const kh = (h - 18) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r === 4 && c >= 4 && c <= 9) continue;
          const hue = (c / cols) * 320 + r * 14;
          ctx.fillStyle = `hsl(${hue}, 88%, 55%)`;
          ctx.fillRect(9 + c * kw + 0.5, 9 + r * kh + 0.5, kw - 2, kh - 2);
          ctx.fillStyle = '#1a1f28';
          ctx.fillRect(9 + c * kw + 2.5, 9 + r * kh + 2.5, kw - 6, kh - 6);
        }
      }
      // Spacebar with glowing RGB under-edge
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(9 + 4 * kw + 1, 9 + 4 * kh + 1, 6 * kw - 3, kh - 3);
      ctx.fillStyle = '#191e26';
      ctx.fillRect(9 + 4 * kw + 3, 9 + 4 * kh + 3, 6 * kw - 7, kh - 7);
    });

    const kbBase = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.018, 0.148), chassisBlackMat);
    kbBase.position.set(-0.04, 0.01, 0.19);
    kbBase.castShadow = true;
    const kbDeck = new THREE.Mesh(
      new THREE.BoxGeometry(0.432, 0.01, 0.132),
      new THREE.MeshStandardMaterial({
        map: rgbKeyAlbedo,
        emissive: 0xffffff,
        emissiveMap: rgbKeyAlbedo,
        emissiveIntensity: 0.72,
        roughness: 0.48,
        metalness: 0.1,
      })
    );
    kbDeck.position.set(-0.04, 0.022, 0.19);
    pc.add(kbBase, kbDeck);

    // 3. BLACK MOUSEPAD & ERGONOMIC GAMING MOUSE (right of keyboard)
    const mousepadTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#17191e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2b303a';
      ctx.lineWidth = 6;
      ctx.strokeRect(5, 5, w - 10, h - 10);
      // Tiny crisp corner logo emblem
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(w - 28, h - 26, 9, 0.4, Math.PI * 1.8);
      ctx.stroke();
    });
    const mousepad = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.005, 0.24),
      new THREE.MeshStandardMaterial({
        map: mousepadTex,
        roughness: 0.9,
        metalness: 0.0,
      })
    );
    mousepad.position.set(0.39, 0.003, 0.19);
    mousepad.receiveShadow = true;
    pc.add(mousepad);

    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.038, 16, 12), chassisBlackMat);
    mouse.scale.set(0.78, 0.56, 1.38);
    mouse.position.set(0.39, 0.024, 0.18);
    mouse.castShadow = true;
    const scrollWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.006, 10), brushedAluminumMat);
    scrollWheel.rotation.z = Math.PI / 2;
    scrollWheel.position.set(0.39, 0.041, 0.155);
    pc.add(mouse, scrollWheel);

    // 4. SHOWCASE TEMPERED-GLASS CUSTOM PC TOWER (right side of desk, Lian Li O11 style!)
    const tower = new THREE.Group();
    tower.position.set(0.84, 0.23, -0.06);
    tower.rotation.y = -0.14;

    const towerW = 0.25;
    const towerH = 0.44;
    const towerD = 0.45;

    // Brushed aluminum outer structural panels (right solid side, top, bottom, rear, corner pillar)
    const rightSide = new THREE.Mesh(new THREE.BoxGeometry(0.018, towerH, towerD), brushedAluminumMat);
    rightSide.position.x = towerW * 0.5 - 0.009;
    rightSide.castShadow = true;
    const topPanel = new THREE.Mesh(new THREE.BoxGeometry(towerW, 0.02, towerD), brushedAluminumMat);
    topPanel.position.y = towerH * 0.5 - 0.01;
    topPanel.castShadow = true;
    const botPanel = new THREE.Mesh(new THREE.BoxGeometry(towerW, 0.022, towerD), brushedAluminumMat);
    botPanel.position.y = -towerH * 0.5 + 0.011;
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(towerW, towerH, 0.018), chassisBlackMat);
    backPanel.position.z = -towerD * 0.5 + 0.009;
    const frontRightPillar = new THREE.Mesh(new THREE.BoxGeometry(0.055, towerH, 0.026), brushedAluminumMat);
    frontRightPillar.position.set(towerW * 0.5 - 0.028, 0, towerD * 0.5 - 0.013);
    frontRightPillar.castShadow = true;

    // Vertical white/cool-blue LED accent strip on front-right pillar
    this.pcStripLedMat = new THREE.MeshStandardMaterial({
      color: 0xeef6ff,
      emissive: 0xcbe4ff,
      emissiveIntensity: 1.25,
      roughness: 0.2,
    });
    const frontLedStrip = new THREE.Mesh(new THREE.BoxGeometry(0.008, towerH - 0.05, 0.008), this.pcStripLedMat);
    frontLedStrip.position.set(towerW * 0.5 - 0.056, 0, towerD * 0.5 - 0.004);

    // Interior hardware: ATX motherboard, VRM heatsinks, horizontal GPU, glowing LED fans, AIO cooler tubes
    const mobo = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, 0.34, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x111622, roughness: 0.45, metalness: 0.45 })
    );
    mobo.position.set(0.088, 0.01, -0.02);

    const vrmHeatsink = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.14, 0.042), brushedAluminumMat);
    vrmHeatsink.position.set(0.072, 0.09, -0.11);

    const gpuCard = new THREE.Mesh(
      new THREE.BoxGeometry(0.135, 0.042, 0.27),
      new THREE.MeshStandardMaterial({ color: 0x1d232d, roughness: 0.3, metalness: 0.72 })
    );
    gpuCard.position.set(0.015, -0.045, -0.01);

    const aioPump = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 0.032, 16),
      darkMetalMat
    );
    aioPump.rotation.z = Math.PI / 2;
    aioPump.position.set(0.068, 0.06, -0.04);

    this.pcInteriorLedMat = new THREE.MeshStandardMaterial({
      color: 0xf4f9ff,
      emissive: 0xd8ecff,
      emissiveIntensity: 1.3,
      roughness: 0.2,
    });

    const pumpRing = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.004, 8, 18), this.pcInteriorLedMat);
    pumpRing.rotation.y = Math.PI / 2;
    pumpRing.position.set(0.051, 0.06, -0.04);

    // 2 Glowing White Ring Case Fans (rear & upper intake)
    for (const [fx, fy, fz, ry] of [
      [0.01, 0.07, -0.20, 0],
      [0.078, 0.07, 0.08, Math.PI / 2],
      [0.078, -0.07, 0.08, Math.PI / 2],
    ] as Array<[number, number, number, number]>) {
      const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.007, 8, 20), this.pcInteriorLedMat);
      fanRing.rotation.y = ry;
      fanRing.position.set(fx, fy, fz);
      tower.add(fanRing);
    }

    // Curved AIO Liquid Cooler Tubes inside the PC
    const tubeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.055, 0.06, -0.02),
      new THREE.Vector3(-0.02, 0.12, 0.04),
      new THREE.Vector3(0.01, 0.19, 0.09),
    ]);
    const aioTube = new THREE.Mesh(
      new THREE.TubeGeometry(tubeCurve, 14, 0.0075, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x12151a, roughness: 0.65 })
    );

    // Translucent Tempered Glass Side & Front Panels (depthWrite: false for clean interior visibility)
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x24303f,
      roughness: 0.08,
      metalness: 0.2,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    const glassSide = new THREE.Mesh(new THREE.PlaneGeometry(towerD - 0.03, towerH - 0.04), glassMat);
    glassSide.rotation.y = -Math.PI / 2;
    glassSide.position.x = -towerW * 0.5 + 0.002;
    glassSide.renderOrder = 2;

    const glassFront = new THREE.Mesh(new THREE.PlaneGeometry(towerW - 0.06, towerH - 0.04), glassMat);
    glassFront.position.set(-0.028, 0, towerD * 0.5 - 0.002);
    glassFront.renderOrder = 2;

    // Power Button LED on the front-right brushed aluminum pillar
    this.pcPowerLedMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    const powerBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 14), this.pcPowerLedMat);
    powerBtn.rotation.x = Math.PI / 2;
    powerBtn.position.set(towerW * 0.5 - 0.028, 0.145, towerD * 0.5 + 0.001);

    tower.add(
      rightSide,
      topPanel,
      botPanel,
      backPanel,
      frontRightPillar,
      frontLedStrip,
      mobo,
      vrmHeatsink,
      gpuCard,
      aioPump,
      pumpRing,
      aioTube,
      glassSide,
      glassFront,
      powerBtn
    );
    pc.add(tower);

    // Interactive HitBox for 'computer' (covers monitor + PC tower cleanly)
    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.72, 0.72),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitBox.position.set(0.22, 0.34, -0.08);
    hitBox.userData.interactId = 'computer' as RoomInteractTarget;
    this.interactables.push(hitBox);
    this.targetAnchors.set('computer', new THREE.Vector3(0.05, 1.16, -2.55));
    pc.add(hitBox);

    this.scene.add(pc);
  }

  private buildCompositeNotebook(): void {
    // Open Ruled Python Notebook on the left side of the desk (interactive target: 'notebook')
    const nb = new THREE.Group();
    nb.position.set(-0.46, 0.768, -2.54);
    nb.rotation.y = 0.14;

    const coverMat = new THREE.MeshStandardMaterial({ color: 0x3f434a, roughness: 0.85 });
    const pageTex = this.createCanvasTexture(256, 192, (ctx, w, h) => {
      ctx.fillStyle = '#faf7ef';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      for (let y = 22; y < h; y += 14) {
        ctx.beginPath();
        ctx.moveTo(8, y);
        ctx.lineTo(w - 8, y);
        ctx.stroke();
      }
      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 14px monospace';
      ctx.fillText('PYTHON NOTES', 18, 32);
      ctx.font = '12px monospace';
      ctx.fillText('def defend(x):', 18, 60);
      ctx.fillText('  return x * 2', 18, 78);
      ctx.fillText('# firewall v30', 18, 108);
    });
    const pageMat = new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.9 });
    const wireMat = new THREE.MeshStandardMaterial({ color: 0xb8c0ca, roughness: 0.25, metalness: 0.8 });

    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.01, 0.23), coverMat);
    cover.castShadow = true;
    const leftPage = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.014, 0.215), pageMat);
    leftPage.position.set(-0.076, 0.01, 0);
    const rightPage = new THREE.Mesh(new THREE.BoxGeometry(0.145, 0.014, 0.215), pageMat);
    rightPage.position.set(0.076, 0.01, 0);

    for (let z = -0.09; z <= 0.09; z += 0.036) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.011, 0.0022, 8, 12), wireMat);
      coil.position.set(0, 0.018, z);
      nb.add(coil);
    }

    // Pen beside the notebook
    const penBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.15, 10),
      new THREE.MeshStandardMaterial({ color: 0x1e2430, roughness: 0.3, metalness: 0.5 })
    );
    penBody.rotation.z = Math.PI / 2;
    penBody.rotation.y = 0.52;
    penBody.position.set(0.19, 0.007, 0.03);

    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.22, 0.36),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitBox.position.y = 0.08;
    hitBox.userData.interactId = 'notebook' as RoomInteractTarget;
    this.interactables.push(hitBox);
    this.targetAnchors.set('notebook', new THREE.Vector3(-0.46, 0.84, -2.54));

    nb.add(cover, leftPage, rightPage, penBody, hitBox);
    this.scene.add(nb);
  }

  private buildDeskPropsAndCables(): void {
    const deskTopY = 0.768;

    // 1. Ceramic Matte Stoneware Coffee Mug (left-center of desk, matching reference!)
    const mug = new THREE.Group();
    mug.position.set(-0.37, deskTopY, -2.74);
    const ceramicMat = new THREE.MeshStandardMaterial({ color: 0xcdc6bc, roughness: 0.38, metalness: 0.05 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.036, 0.092, 16), ceramicMat);
    cup.position.y = 0.046;
    cup.castShadow = true;
    const coffee = new THREE.Mesh(
      new THREE.CylinderGeometry(0.034, 0.034, 0.004, 14),
      new THREE.MeshStandardMaterial({ color: 0x26140c, roughness: 0.14 })
    );
    coffee.position.y = 0.088;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.006, 8, 14, Math.PI), ceramicMat);
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(0.037, 0.048, 0);
    mug.add(cup, coffee, handle);
    this.scene.add(mug);

    // 2. Stacked Books on the far left of the desk (matching reference photo!)
    const bookStack = new THREE.Group();
    bookStack.position.set(-0.82, deskTopY, -2.56);
    const stackSpecs: Array<[number, number, number, number, number, number]> = [
      [0.24, 0.032, 0.175, 0.016, 0.06, 0x3b3835],
      [0.22, 0.028, 0.165, 0.046, -0.04, 0x5c4738],
      [0.16, 0.018, 0.115, 0.069, 0.14, 0x9b8e7e],
    ];
    for (const [bw, bh, bd, by, rotY, col] of stackSpecs) {
      const b = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        new THREE.MeshStandardMaterial({ color: col, roughness: 0.82 })
      );
      b.position.y = by;
      b.rotation.y = rotY;
      b.castShadow = true;
      b.receiveShadow = true;
      bookStack.add(b);
    }
    this.scene.add(bookStack);

    // 3. Over-Ear Studio Headphones resting on the right side of the desk
    const hp = new THREE.Group();
    hp.position.set(0.62, deskTopY + 0.015, -2.47);
    hp.rotation.y = -0.35;
    const hpBodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.42, metalness: 0.25 });
    const hpPadMat = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.85 });
    const hpMetalMat = new THREE.MeshStandardMaterial({ color: 0x8e98a4, roughness: 0.25, metalness: 0.8 });

    for (const side of [-1, 1]) {
      const cupOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.024, 16), hpBodyMat);
      cupOuter.position.set(side * 0.068, 0.016, 0);
      cupOuter.rotation.x = Math.PI * 0.44;
      cupOuter.castShadow = true;
      const earPad = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.013, 10, 18), hpPadMat);
      earPad.position.set(side * 0.068, 0.014, 0.012);
      earPad.rotation.x = Math.PI * 0.06;
      hp.add(cupOuter, earPad);
    }
    const bandCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.072, 0.024, -0.005),
      new THREE.Vector3(-0.065, 0.03, -0.095),
      new THREE.Vector3(0, 0.032, -0.128),
      new THREE.Vector3(0.065, 0.03, -0.095),
      new THREE.Vector3(0.072, 0.024, -0.005),
    ]);
    const band = new THREE.Mesh(new THREE.TubeGeometry(bandCurve, 18, 0.01, 8, false), hpMetalMat);
    band.castShadow = true;
    hp.add(band);
    this.scene.add(hp);

    // 4. Articulated Silver Architect Lamp (mounted on nightstand/left-back corner, matching reference!)
    const lamp = new THREE.Group();
    lamp.position.set(-1.35, 0.52, -2.92);
    lamp.rotation.y = 0.45;
    const lampMetal = new THREE.MeshStandardMaterial({
      color: 0xb7bfc8,
      roughness: 0.25,
      metalness: 0.8,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.098, 0.022, 18), lampMetal);
    base.position.y = 0.011;
    base.castShadow = true;
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.44, 10), lampMetal);
    arm1.position.set(0, 0.22, 0.04);
    arm1.rotation.x = 0.2;
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 10), lampMetal);
    joint.position.set(0, 0.43, 0.085);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.36, 10), lampMetal);
    arm2.position.set(0, 0.59, 0.04);
    arm2.rotation.x = -0.32;
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.088, 0.13, 18, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x9aa2ac,
        roughness: 0.28,
        metalness: 0.78,
        side: THREE.DoubleSide,
      })
    );
    shade.position.set(0, 0.74, 0.08);
    shade.rotation.x = Math.PI * 0.74;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.026, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xffce84, emissiveIntensity: 1.9 })
    );
    bulb.position.set(0, 0.71, 0.09);
    lamp.add(base, arm1, joint, arm2, shade, bulb);
    this.scene.add(lamp);

    // 5. Rear Desk Cables & Floor Power Strip (TubeGeometry for realistic cable clutter!)
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.75 });
    const cablePaths: THREE.Vector3[][] = [
      // Monitor rear to PC tower rear
      [
        new THREE.Vector3(0.04, 1.06, -2.99),
        new THREE.Vector3(0.18, 0.78, -2.99),
        new THREE.Vector3(0.52, 0.775, -3.02),
        new THREE.Vector3(0.84, 0.85, -3.02),
      ],
      // Keyboard wire across desk back to PC
      [
        new THREE.Vector3(-0.04, 0.775, -2.63),
        new THREE.Vector3(0.08, 0.775, -2.86),
        new THREE.Vector3(0.45, 0.775, -2.95),
        new THREE.Vector3(0.82, 0.82, -2.98),
      ],
      // Mouse wire toward back of desk
      [
        new THREE.Vector3(0.39, 0.775, -2.64),
        new THREE.Vector3(0.46, 0.775, -2.88),
        new THREE.Vector3(0.76, 0.775, -2.96),
      ],
      // Cables hanging below desk into floor surge protector
      [
        new THREE.Vector3(0.15, 0.74, -3.14),
        new THREE.Vector3(0.22, 0.36, -3.10),
        new THREE.Vector3(0.34, 0.04, -2.96),
      ],
      [
        new THREE.Vector3(0.76, 0.74, -3.12),
        new THREE.Vector3(0.56, 0.32, -3.08),
        new THREE.Vector3(0.42, 0.04, -2.96),
      ],
    ];

    for (const pts of cablePaths) {
      const curve = new THREE.CatmullRomCurve3(pts);
      const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 14, 0.0045, 6, false), cableMat);
      this.scene.add(wire);
    }

    // White Floor Multi-Outlet Power Strip beneath desk
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.032, 0.062),
      new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.55 })
    );
    strip.position.set(0.38, 0.016, -2.96);
    strip.rotation.y = 0.08;
    this.scene.add(strip);
  }

  private buildBookshelvesAndWastebasket(): void {
    const oakMat = new THREE.MeshStandardMaterial({
      map: this.bookshelfOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const walnutMat = new THREE.MeshStandardMaterial({
      map: this.darkWalnutTex,
      roughness: 0.45,
      metalness: 0.04,
    });

    const bookColors = [
      0x2f3b4c, 0x7c3a2d, 0x3f5e46, 0xc7bba8, 0x4b423b, 0x26466d, 0x9c7b52, 0x22262b,
    ];
    const bookMats = bookColors.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.84, metalness: 0.02 })
    );

    const populateShelfBooks = (
      parent: THREE.Group,
      baseY: number,
      startX: number,
      count: number,
      seedOffset: number,
      depthZ = 0.22
    ) => {
      let curX = startX;
      for (let i = 0; i < count; i++) {
        const idx = i + seedOffset;
        const bw = 0.038 + (idx % 3) * 0.011;
        const bh = 0.22 + (idx % 4) * 0.028;
        const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, depthZ), bookMats[idx % bookMats.length]);
        book.position.set(curX + bw * 0.5, baseY + bh * 0.5, 0.02);
        if (i === count - 1 && count <= 6) {
          book.rotation.z = -0.2;
          book.position.x += 0.038;
        }
        book.castShadow = true;
        parent.add(book);
        curX += bw + 0.008;
      }
    };

    // 1. Tall Natural-Oak Bookshelf (back-right corner next to desk & window, matching reference!)
    const tallShelf = new THREE.Group();
    tallShelf.position.set(2.26, 0, -2.97);

    const tsW = 0.96;
    const tsH = 2.04;
    const tsD = 0.36;
    for (const sx of [-tsW * 0.5, tsW * 0.5]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.035, tsH, tsD), oakMat);
      side.position.set(sx, tsH * 0.5, 0);
      side.castShadow = true;
      side.receiveShadow = true;
      tallShelf.add(side);
    }
    const tsBack = new THREE.Mesh(new THREE.BoxGeometry(tsW, tsH, 0.02), oakMat);
    tsBack.position.set(0, tsH * 0.5, -tsD * 0.5 + 0.01);
    tallShelf.add(tsBack);

    const tallLevels = [0.06, 0.48, 0.90, 1.32, 1.72, 2.02];
    for (const y of tallLevels) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(tsW, 0.03, tsD), oakMat);
      plank.position.set(0, y, 0);
      plank.receiveShadow = true;
      tallShelf.add(plank);
    }

    populateShelfBooks(tallShelf, 0.495, -0.42, 6, 0);
    populateShelfBooks(tallShelf, 0.915, -0.40, 7, 3);
    populateShelfBooks(tallShelf, 1.335, -0.42, 5, 5);
    populateShelfBooks(tallShelf, 1.735, -0.42, 4, 2);

    // Ring binders on top shelf right + cardboard storage box on top of bookcase (just like reference!)
    for (let b = 0; b < 3; b++) {
      const binder = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.27, 0.24),
        bookMats[(b + 1) % bookMats.length]
      );
      binder.position.set(0.24 + b * 0.065, 1.87, 0.02);
      tallShelf.add(binder);
    }
    const topBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.16, 0.26),
      new THREE.MeshStandardMaterial({ color: 0xb69974, roughness: 0.88 })
    );
    topBox.position.set(0.24, 2.115, 0);
    topBox.castShadow = true;
    tallShelf.add(topBox);
    this.scene.add(tallShelf);

    // 2. Low Dark-Walnut Bookshelf on the right wall foreground (matching reference foreground!)
    const lowShelf = new THREE.Group();
    lowShelf.position.set(2.97, 0, 1.15);
    lowShelf.rotation.y = -Math.PI / 2;

    const lsW = 1.48;
    const lsH = 1.12;
    const lsD = 0.36;
    for (const sx of [-lsW * 0.5, lsW * 0.5]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.036, lsH, lsD), walnutMat);
      side.position.set(sx, lsH * 0.5, 0);
      side.castShadow = true;
      lowShelf.add(side);
    }
    const lsBack = new THREE.Mesh(new THREE.BoxGeometry(lsW, lsH, 0.02), walnutMat);
    lsBack.position.set(0, lsH * 0.5, -lsD * 0.5 + 0.01);
    lowShelf.add(lsBack);
    for (const y of [0.06, 0.40, 0.74, 1.10]) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(lsW, 0.032, lsD), walnutMat);
      plank.position.set(0, y, 0);
      plank.receiveShadow = true;
      lowShelf.add(plank);
    }
    populateShelfBooks(lowShelf, 0.076, -0.64, 9, 1);
    populateShelfBooks(lowShelf, 0.416, -0.62, 8, 4);
    populateShelfBooks(lowShelf, 0.756, -0.64, 9, 2);

    // Stacked flat hardcover books on top of low shelf
    const flatBook1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.035, 0.19), bookMats[2]);
    flatBook1.position.set(-0.35, 1.135, 0.01);
    flatBook1.rotation.y = 0.08;
    const flatBook2 = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.028, 0.17), bookMats[5]);
    flatBook2.position.set(-0.34, 1.166, 0.01);
    flatBook2.rotation.y = -0.05;
    lowShelf.add(flatBook1, flatBook2);
    this.scene.add(lowShelf);

    // 3. Wire-Mesh Metal Wastebasket beside the left leg of the desk (matching reference!)
    const binGroup = new THREE.Group();
    binGroup.position.set(-1.14, 0, -2.26);

    const meshBinMat = new THREE.MeshStandardMaterial({
      color: 0x767f8a,
      alphaMap: this.meshBinAlphaTex,
      transparent: true,
      alphaTest: 0.35,
      side: THREE.DoubleSide,
      roughness: 0.32,
      metalness: 0.78,
    });
    const binWall = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.105, 0.31, 20, 1, true), meshBinMat);
    binWall.position.y = 0.155;
    binWall.castShadow = true;

    const rimMat = new THREE.MeshStandardMaterial({ color: 0x8f98a3, roughness: 0.25, metalness: 0.8 });
    const topRim = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.006, 8, 22), rimMat);
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = 0.31;
    const binBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.008, 18), rimMat);
    binBottom.position.y = 0.004;

    // Crumpled white paper balls inside the wire wastebasket
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xebe8e0, roughness: 0.92 });
    for (const [px, py, pz, r] of [
      [-0.03, 0.05, 0.02, 0.042],
      [0.04, 0.06, -0.02, 0.048],
      [-0.01, 0.10, -0.01, 0.038],
    ] as Array<[number, number, number, number]>) {
      const ball = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), paperMat);
      ball.position.set(px, py, pz);
      ball.rotation.set(px * 12, pz * 14, py * 9);
      binGroup.add(ball);
    }

    binGroup.add(binWall, topRim, binBottom);
    this.scene.add(binGroup);
  }

  private buildCompositeDoorAndWindow(): void {
    const whiteTrimMat = new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.5 });
    const whiteDoorMat = new THREE.MeshStandardMaterial({ color: 0xebe7de, roughness: 0.56, metalness: 0.02 });
    const steelHandleMat = new THREE.MeshStandardMaterial({
      color: 0xcbd3dc,
      roughness: 0.25,
      metalness: 0.8,
    });

    // 1. LEFT WALL ROOM DOOR (frame, matte-ivory panel, stainless lever handle + light switch — interactive: 'door')
    const doorGroup = new THREE.Group();
    doorGroup.position.set(-3.17, 0, 1.42);
    doorGroup.rotation.y = Math.PI / 2;

    const jambL = new THREE.Mesh(new THREE.BoxGeometry(0.085, 2.26, 0.085), whiteTrimMat);
    jambL.position.set(-0.51, 1.13, 0);
    const jambR = jambL.clone();
    jambR.position.x = 0.51;
    const header = new THREE.Mesh(new THREE.BoxGeometry(1.11, 0.085, 0.085), whiteTrimMat);
    header.position.set(0, 2.26, 0);

    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.94, 2.18, 0.045), whiteDoorMat);
    doorPanel.position.set(0, 1.09, 0.014);
    doorPanel.receiveShadow = true;
    doorPanel.castShadow = true;

    // Stainless Steel Escutcheon Plate & Lever Handle (matching left door in reference photo!)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.19, 0.012), steelHandleMat);
    plate.position.set(0.36, 1.03, 0.042);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.036, 10), steelHandleMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0.36, 1.06, 0.06);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.135, 10), steelHandleMat);
    lever.rotation.z = Math.PI / 2;
    lever.position.set(0.30, 1.06, 0.078);

    // Wall light switch beside door frame
    const switchPlate = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.082, 0.014), whiteTrimMat);
    switchPlate.position.set(0.68, 1.18, 0.012);
    const switchRocker = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.052, 0.016), whiteDoorMat);
    switchRocker.position.set(0.68, 1.18, 0.018);

    const doorHit = new THREE.Mesh(
      new THREE.BoxGeometry(1.16, 2.28, 0.36),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    doorHit.position.set(0, 1.14, 0.12);
    doorHit.userData.interactId = 'door' as RoomInteractTarget;
    this.interactables.push(doorHit);
    this.targetAnchors.set('door', new THREE.Vector3(-2.98, 1.18, 1.42));

    doorGroup.add(jambL, jambR, header, doorPanel, plate, collar, lever, switchPlate, switchRocker, doorHit);
    this.scene.add(doorGroup);

    // 2. RIGHT WALL SUNLIT WINDOW WITH HORIZONTAL VENETIAN BLINDS (interactive: 'window')
    const winGroup = new THREE.Group();
    winGroup.position.set(3.17, 1.72, -1.25);
    winGroup.rotation.y = -Math.PI / 2;

    const winW = 1.62;
    const winH = 1.44;

    // Deep Architectural Window Frame & Sill
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.16, 0.075, 0.11), whiteTrimMat);
    frameTop.position.set(0, winH * 0.5 + 0.035, 0.01);
    const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.075, winH + 0.06, 0.11), whiteTrimMat);
    frameL.position.set(-winW * 0.5 - 0.035, 0, 0.01);
    const frameR = frameL.clone();
    frameR.position.x = winW * 0.5 + 0.035;
    const sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.24, 0.052, 0.22), whiteTrimMat);
    sill.position.set(0, -winH * 0.5 - 0.02, 0.06);
    sill.receiveShadow = true;

    // Bright Soft Overexposed Daytime Sky & Distant City Silhouette Backdrop
    const skyTex = this.createCanvasTexture(256, 256, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#eef4fb');
      grad.addColorStop(0.5, '#fffcf2');
      grad.addColorStop(0.82, '#ebe4d8');
      grad.addColorStop(1, '#d2c9bc');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Soft distant building silhouettes
      ctx.fillStyle = 'rgba(182, 174, 162, 0.45)';
      ctx.fillRect(10, h - 78, 52, 78);
      ctx.fillRect(72, h - 98, 64, 98);
      ctx.fillRect(148, h - 68, 48, 68);
      ctx.fillRect(202, h - 86, 46, 86);
    });

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(winW, winH),
      new THREE.MeshStandardMaterial({
        map: skyTex,
        emissive: 0xfff5e4,
        emissiveMap: skyTex,
        emissiveIntensity: 1.05,
        roughness: 0.12,
      })
    );
    glass.position.z = 0.025;

    // Window Mullions
    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.036, winH, 0.038), whiteTrimMat);
    barV.position.z = 0.042;
    const barH = new THREE.Mesh(new THREE.BoxGeometry(winW, 0.036, 0.038), whiteTrimMat);
    barH.position.set(0, -0.06, 0.042);

    // Crisp Horizontal Venetian Blinds covering upper 60% of the window (matching reference!)
    const blindMat = new THREE.MeshStandardMaterial({
      color: 0xf4f2ee,
      roughness: 0.48,
      metalness: 0.12,
    });
    const blindValance = new THREE.Mesh(new THREE.BoxGeometry(winW - 0.02, 0.052, 0.058), blindMat);
    blindValance.position.set(0, winH * 0.5 - 0.03, 0.072);
    winGroup.add(blindValance);

    const slatCount = 13;
    for (let i = 0; i < slatCount; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(winW - 0.04, 0.024, 0.006), blindMat);
      slat.position.set(0, winH * 0.5 - 0.085 - i * 0.056, 0.072);
      slat.rotation.x = 0.36;
      winGroup.add(slat);
    }

    const cordMat = new THREE.MeshStandardMaterial({ color: 0xe2e4e8, roughness: 0.8 });
    for (const cx of [-0.46, 0.46]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.74, 6), cordMat);
      cord.position.set(cx, 0.31, 0.075);
      winGroup.add(cord);
    }

    // Small Potted Succulent on Window Sill (matches reference window sill detail!)
    const sillPot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.042, 0.09, 12),
      new THREE.MeshStandardMaterial({ color: 0xe6dfd3, roughness: 0.72 })
    );
    sillPot.position.set(-0.52, -winH * 0.5 + 0.05, 0.11);
    const sillLeaf = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.06, 0),
      new THREE.MeshStandardMaterial({ color: 0x4b6e44, roughness: 0.8 })
    );
    sillLeaf.position.set(-0.52, -winH * 0.5 + 0.125, 0.11);
    winGroup.add(sillPot, sillLeaf);

    const winHit = new THREE.Mesh(
      new THREE.BoxGeometry(winW + 0.2, winH + 0.15, 0.38),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    winHit.position.z = 0.12;
    winHit.userData.interactId = 'window' as RoomInteractTarget;
    this.interactables.push(winHit);
    this.targetAnchors.set('window', new THREE.Vector3(2.96, 1.56, -1.25));

    winGroup.add(frameTop, frameL, frameR, sill, glass, barV, barH, winHit);
    this.scene.add(winGroup);
  }

  private buildWallPostersAndFrames(): void {
    const darkFrameMat = new THREE.MeshStandardMaterial({
      color: 0x26211e,
      roughness: 0.38,
      metalness: 0.15,
    });

    const addWallArt = (
      x: number,
      y: number,
      z: number,
      rotY: number,
      w: number,
      h: number,
      tex: THREE.CanvasTexture,
      framed: boolean
    ) => {
      const grp = new THREE.Group();
      grp.position.set(x, y, z);
      grp.rotation.y = rotY;
      if (framed) {
        const outer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.065, h + 0.065, 0.024), darkFrameMat);
        outer.castShadow = true;
        grp.add(outer);
      }
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.65 })
      );
      art.position.z = framed ? 0.013 : 0.004;
      grp.add(art);
      this.scene.add(grp);
    };

    // 1. Back Wall Moody Atmospheric Landscape Poster (above bed/nightstand, matching reference!)
    const atmosphericPosterTex = this.createCanvasTexture(256, 320, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#4f5d66');
      g.addColorStop(0.5, '#7e898d');
      g.addColorStop(1, '#1d2226');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // Silhouette ruins & distant lone figure
      ctx.fillStyle = '#181c20';
      ctx.fillRect(0, 120, 75, 200);
      ctx.fillRect(195, 145, 65, 175);
      ctx.beginPath();
      ctx.arc(130, 118, 38, 0, Math.PI * 2);
      ctx.fillStyle = '#c8c2b6';
      ctx.fill();
      ctx.fillStyle = '#15181b';
      ctx.beginPath();
      ctx.ellipse(128, 225, 16, 42, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    addWallArt(-1.35, 1.98, -3.17, 0, 0.62, 0.80, atmosphericPosterTex, false);

    // 2. Left Wall Dark Sci-Fi Poster + White Graphic Spec Sheet (above bed, matching reference!)
    const scifiPosterTex = this.createCanvasTexture(256, 360, (ctx, w, h) => {
      ctx.fillStyle = '#14171c';
      ctx.fillRect(0, 0, w, h);
      const glow = ctx.createRadialGradient(w / 2, 145, 10, w / 2, 145, 95);
      glow.addColorStop(0, '#c85a32');
      glow.addColorStop(0.55, '#2b4056');
      glow.addColorStop(1, '#14171c');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e5e7eb';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('CYBER-DEF', w / 2, 315);
    });
    addWallArt(-3.17, 2.02, -1.78, Math.PI / 2, 0.56, 0.82, scifiPosterTex, false);

    const specSheetTex = this.createCanvasTexture(220, 280, (ctx, w, h) => {
      ctx.fillStyle = '#f2efe8';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          ctx.strokeRect(24 + c * 62, 32 + r * 66, 44, 44);
        }
      }
      ctx.fillStyle = '#475569';
      ctx.fillRect(24, 240, 172, 10);
    });
    addWallArt(-3.17, 1.78, -1.06, Math.PI / 2, 0.36, 0.48, specSheetTex, false);

    // 3. Right Wall Framed Botanical Ink Print + Dark Graphic Poster (matching reference!)
    const inkArtTex = this.createCanvasTexture(256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#ebe5d8';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#2d2c2a';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(w * 0.48, h * 0.85);
      ctx.quadraticCurveTo(w * 0.42, h * 0.5, w * 0.56, h * 0.18);
      ctx.stroke();
      for (let i = 0; i < 14; i++) {
        const y = 65 + i * 14;
        const side = i % 2 === 0 ? 1 : -1;
        ctx.beginPath();
        ctx.ellipse(w * 0.49 + side * 26, y, 22, 6, side * 0.45, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    addWallArt(3.17, 1.94, 0.16, -Math.PI / 2, 0.58, 0.76, inkArtTex, true);

    const darkGraphicTex = this.createCanvasTexture(256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#181a1e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(42, 260);
      ctx.lineTo(128, 62);
      ctx.lineTo(214, 260);
      ctx.closePath();
      ctx.stroke();
      ctx.strokeStyle = '#00ff41';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(128, 180, 42, 0, Math.PI * 2);
      ctx.stroke();
    });
    addWallArt(3.17, 1.96, 1.05, -Math.PI / 2, 0.62, 0.82, darkGraphicTex, false);
  }

  public resetOpeningAtBed(): void {
    // Positioned cleanly in the room looking toward the wall-flush desk, single monitor, sunlit right window & left bed
    this.camera.position.set(-0.72, 1.46, 0.92);
    this.yaw = -0.22;
    this.pitch = -0.06;
    this.applyCameraEuler();
    this.setComputerPower(false);
    this.setRoomLights(true);
  }

  public setComputerPower(on: boolean): void {
    if (!this.monitorScreenMesh) return;
    if (on) {
      this.monitorScreenMesh.material = this.monitorOnMat;
      this.monitorOnMat.emissiveIntensity = 1.05;
      this.pcPowerLedMat.color.setHex(0x00ff41);
      this.pcPowerLedMat.emissive.setHex(0x00ff41);
      this.pcPowerLedMat.emissiveIntensity = 1.5;
      this.pcInteriorLedMat.emissiveIntensity = 1.6;
      this.pcStripLedMat.emissiveIntensity = 1.5;
      this.pcInteriorLight.intensity = 1.2;
    } else {
      this.monitorScreenMesh.material = this.monitorOffMat;
      this.pcPowerLedMat.color.setHex(0x475569);
      this.pcPowerLedMat.emissive.setHex(0x000000);
      this.pcPowerLedMat.emissiveIntensity = 0;
      this.pcInteriorLedMat.emissiveIntensity = 0.85;
      this.pcStripLedMat.emissiveIntensity = 0.85;
      this.pcInteriorLight.intensity = 0.72;
    }
  }

  public setRoomLights(on: boolean): void {
    this.ambientLight.intensity = on ? 0.28 : 0;
    this.hemiLight.intensity = on ? 0.85 : 0;
    this.sunLight.intensity = on ? 2.35 : 0;
    this.ceilingLight.intensity = on ? 0.72 : 0;
    this.deskLampLight.intensity = on ? 1.45 : 0;
    this.pcInteriorLight.intensity = on ? 0.95 : 0;
    this.scene.environmentIntensity = on ? 0.44 : 0;
    this.scene.background = on ? this.dayBgColor : this.darkBgColor;
    this.scene.fog = on ? this.dayFog : this.darkFog;
    if (on && !this.isSoftwareGl) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.pausedRendered = false;
  }

  public start(): void {
    if (this.running) return;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameId);
      this.frameId = 0;
    }
    this.running = true;
    this.pausedRendered = false;
    this.lastTime = performance.now();
    this.tick();
  }

  public stop(): void {
    this.running = false;
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      clearTimeout(this.frameId);
      this.frameId = 0;
    }
    this.keys = {};
    this.isDragging = false;
    if (document.pointerLockElement === this.renderer.domElement) {
      document.exitPointerLock();
    }
  }

  public powerOnAndZoomToOS(onComplete: () => void): void {
    this.pcBootProgress = 0;
    this.monitorScreenMesh.material = this.monitorOnMat;
    this.monitorOnMat.emissiveIntensity = 0;
    this.pcPowerLedMat.color.setHex(0x00ff41);
    this.pcPowerLedMat.emissive.setHex(0x00ff41);
    this.pcPowerLedMat.emissiveIntensity = 1.6;
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
    this.applyCameraEuler();
    this.mode = 'explore';
    this.start();
  }

  public startEndingReturn(): void {
    this.setComputerPower(false);
    this.setRoomLights(true);
    this.camera.position.copy(this.zoomTargetPos);
    this.camera.lookAt(this.zoomLookTarget);
    this.mode = 'ending_poweroff';
    this.start();
  }

  public triggerBlackout(): void {
    this.mode = 'blackout';
    this.setComputerPower(false);
    this.setRoomLights(false);
    this.renderer.render(this.scene, this.camera);
  }

  private applyCameraEuler(): void {
    _euler.set(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(_euler);
  }

  private bindEvents(): void {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    const dom = this.renderer.domElement;
    dom.addEventListener('mousedown', (e) => {
      if (this.mode !== 'explore' && this.mode !== 'ending_poweroff') return;
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
      if (this.currentHover) {
        this.callbacks.onInteract(this.currentHover);
      }
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'explore' && this.mode !== 'ending_poweroff') return;
      if (document.pointerLockElement === dom) {
        this.yaw -= e.movementX * 0.0022 * this.lookSensitivity;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch - e.movementY * 0.0022 * this.lookSensitivity,
          -1.1,
          1.1
        );
        this.applyCameraEuler();
      } else if (this.isDragging) {
        const dx = e.clientX - this.lastMouseX;
        const dy = e.clientY - this.lastMouseY;
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        this.yaw -= dx * 0.004 * this.lookSensitivity;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch - dy * 0.004 * this.lookSensitivity,
          -1.1,
          1.1
        );
        this.applyCameraEuler();
      }
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys[e.code] = true;
    // Proximity Interaction Guard: only triggers if currentHover is valid (ray hit AND within MAX_INTERACT_DISTANCE)
    if (e.code === 'KeyE' && (this.mode === 'explore' || this.mode === 'ending_poweroff')) {
      if (this.currentHover) {
        this.callbacks.onInteract(this.currentHover);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys[e.code] = false;
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private isPositionBlocked(x: number, z: number): boolean {
    // Wall-flush desk & chair immediate zone
    if (x > -1.32 && x < 1.32 && z < -2.02) return true;
    // Bed zone on the back-left wall
    if (x < -1.45 && z < -0.68) return true;
    // Tall bookshelf back-right corner
    if (x > 1.56 && z < -2.42) return true;
    // Low bookshelf right foreground wall
    if (x > 2.42 && z > 0.22 && z < 2.08) return true;
    return false;
  }

  private updateMovement(dt: number): void {
    const speed = 2.75 * dt;
    _forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).normalize();
    _moveDelta.set(0, 0, 0);

    if (this.keys['KeyW']) _moveDelta.addScaledVector(_forward, speed);
    if (this.keys['KeyS']) _moveDelta.addScaledVector(_forward, -speed);
    if (this.keys['KeyD']) _moveDelta.addScaledVector(_right, speed);
    if (this.keys['KeyA']) _moveDelta.addScaledVector(_right, -speed);

    if (this.keys['ArrowLeft']) {
      this.yaw += 1.8 * dt;
      this.applyCameraEuler();
    }
    if (this.keys['ArrowRight']) {
      this.yaw -= 1.8 * dt;
      this.applyCameraEuler();
    }

    if (_moveDelta.lengthSq() > 0) {
      const candX = THREE.MathUtils.clamp(this.camera.position.x + _moveDelta.x, -2.62, 2.62);
      const candZ = THREE.MathUtils.clamp(this.camera.position.z + _moveDelta.z, -2.05, 2.62);

      // Smooth axis-independent sliding collision against room furniture
      if (!this.isPositionBlocked(candX, this.camera.position.z)) {
        this.camera.position.x = candX;
      }
      if (!this.isPositionBlocked(this.camera.position.x, candZ)) {
        this.camera.position.z = candZ;
      }
    }
  }

  private updateRaycast(): void {
    this.raycaster.setFromCamera(_vec2Center, this.camera);
    this.raycaster.far = 6.0;
    const hits = this.raycaster.intersectObjects(this.interactables, false);

    let nextHover: RoomInteractTarget | null = null;
    if (hits.length > 0) {
      const candidate = hits[0].object.userData.interactId as RoomInteractTarget;
      const anchor = this.targetAnchors.get(candidate);
      if (anchor && this.camera.position.distanceTo(anchor) <= MAX_INTERACT_DISTANCE) {
        nextHover = candidate;
      }
    }

    if (nextHover !== this.currentHover) {
      this.currentHover = nextHover;
      let label = '';
      if (nextHover === 'notebook') label = 'Press [E] to Interact · 파이썬 수첩 읽기';
      else if (nextHover === 'door') label = 'Press [E] to Interact · 문 확인하기';
      else if (nextHover === 'window') label = 'Press [E] to Interact · 창문 확인하기';
      else if (nextHover === 'computer') {
        label =
          this.mode === 'ending_poweroff'
            ? 'Press [E] to Interact · 컴퓨터 전원 완전히 끄기'
            : 'Press [E] to Interact · 컴퓨터 켜기';
      }
      this.callbacks.onHoverChange(nextHover, label);
    }
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (!gl || !gl.fenceSync) {
      this.frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    if (this.mode === 'paused' || this.mode === 'blackout') {
      if (!this.pausedRendered) {
        this.renderer.render(this.scene, this.camera);
        this.pausedRendered = true;
      }
      this.frameId = requestAnimationFrame(this.tick);
      return;
    }

    this.pausedRendered = false;

    if (this.mode === 'explore') {
      this.updateMovement(dt);
      this.updateRaycast();
    } else if (this.mode === 'booting_pc') {
      this.pcBootProgress = Math.min(1, this.pcBootProgress + dt * 1.4);
      this.monitorOnMat.emissiveIntensity = this.pcBootProgress * 1.15;
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
      this.updateRaycast();
    }

    this.renderer.render(this.scene, this.camera);

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };
}
