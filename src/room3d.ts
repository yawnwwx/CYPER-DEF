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

// Create a curved plane geometry bending gently toward the viewer (+Z)
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
  private lastTime = performance.now();

  public mode: RoomMode = 'paused';
  private yaw = -0.45;
  private pitch = -0.04;
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
  private pcInteriorLedMat!: THREE.MeshStandardMaterial;
  private monitorScreenMesh!: THREE.Mesh;
  private monitorOnMat!: THREE.MeshStandardMaterial;
  private monitorOffMat!: THREE.MeshStandardMaterial;
  private pcPowerLedMat!: THREE.MeshStandardMaterial;
  private pcBootProgress = 0;
  private pcBootCallback: (() => void) | null = null;

  // Shared procedural textures
  private floorWoodTex!: THREE.CanvasTexture;
  private wallPaperTex!: THREE.CanvasTexture;
  private accentWallTex!: THREE.CanvasTexture;
  private lightOakTex!: THREE.CanvasTexture;
  private warmOakTex!: THREE.CanvasTexture;
  private darkWalnutTex!: THREE.CanvasTexture;
  private blanketFabricTex!: THREE.CanvasTexture;
  private sheetFabricTex!: THREE.CanvasTexture;
  private rugFabricTex!: THREE.CanvasTexture;

  // Camera transition targets
  private zoomTargetPos = new THREE.Vector3(0, 1.24, -1.66);
  private zoomLookTarget = new THREE.Vector3(0, 1.24, -2.5);
  private zoomOutPos = new THREE.Vector3(0, 1.46, -0.78);
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
    repeatY = 1
  ): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (repeatX > 1 || repeatY > 1) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
    }
    return tex;
  }

  // Deterministic pseudo-random helper for clean repeatable procedural textures
  private hash2d(i: number, seed = 17): number {
    const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  private createProceduralTextures(): void {
    // 1. Warm Hardwood Floor Texture (staggered planks + wood grain + grooves)
    this.floorWoodTex = this.createCanvasTexture(
      512,
      512,
      (ctx, w, h) => {
        ctx.fillStyle = '#c29b70';
        ctx.fillRect(0, 0, w, h);
        const plankRows = 8;
        const plankH = h / plankRows;
        const baseTones = ['#c79e72', '#b98e62', '#cfa77b', '#bf9468', '#c59c70', '#b58a5e'];

        for (let r = 0; r < plankRows; r++) {
          const y0 = r * plankH;
          const jointX = Math.floor(((r * 173 + 90) % (w - 80)) + 40);
          const segments: Array<[number, number, string]> = [
            [0, jointX, baseTones[r % baseTones.length]],
            [jointX, w - jointX, baseTones[(r + 3) % baseTones.length]],
          ];

          for (const [sx, sw, tone] of segments) {
            ctx.fillStyle = tone;
            ctx.fillRect(sx, y0, sw, plankH);

            // Flowing wood grain lines
            for (let g = 0; g < 16; g++) {
              const gy = y0 + 3 + (g / 16) * (plankH - 6);
              ctx.strokeStyle = g % 3 === 0 ? 'rgba(92, 58, 28, 0.16)' : 'rgba(245, 222, 190, 0.13)';
              ctx.lineWidth = 1 + (g % 2) * 0.6;
              ctx.beginPath();
              ctx.moveTo(sx, gy);
              for (let px = sx; px <= sx + sw; px += 24) {
                const wave = Math.sin(px * 0.025 + r * 1.9 + g) * 2.1;
                ctx.lineTo(px, gy + wave);
              }
              ctx.stroke();
            }

            // Occasional subtle knot
            if ((r + sx) % 3 === 0 && sw > 120) {
              const kx = sx + sw * 0.55;
              const ky = y0 + plankH * 0.52;
              ctx.strokeStyle = 'rgba(84, 52, 24, 0.22)';
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.ellipse(kx, ky, 9, 4, 0.1, 0, Math.PI * 2);
              ctx.stroke();
            }
          }

          // Horizontal & vertical plank grooves
          ctx.fillStyle = 'rgba(66, 42, 20, 0.45)';
          ctx.fillRect(0, y0 + plankH - 2, w, 2);
          ctx.fillRect(jointX - 1, y0, 2, plankH);
        }
      },
      3,
      3
    );

    // 2. Wallpaper Texture (bright warm ivory & light gray with subtle micro-noise)
    const buildWallTex = (baseHex: string, noiseRgb: string) =>
      this.createCanvasTexture(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = baseHex;
          ctx.fillRect(0, 0, w, h);
          // Subtle vertical linen weave
          for (let x = 0; x < w; x += 4) {
            ctx.fillStyle = x % 8 === 0 ? 'rgba(255,255,255,0.06)' : `rgba(${noiseRgb}, 0.035)`;
            ctx.fillRect(x, 0, 1, h);
          }
          // Fine matte plaster speckle noise
          for (let i = 0; i < 2400; i++) {
            const nx = Math.floor(this.hash2d(i, 3) * w);
            const ny = Math.floor(this.hash2d(i, 11) * h);
            const alpha = 0.02 + this.hash2d(i, 29) * 0.045;
            ctx.fillStyle = i % 2 === 0 ? `rgba(${noiseRgb}, ${alpha})` : `rgba(255,255,255,${alpha})`;
            ctx.fillRect(nx, ny, 2, 2);
          }
        },
        4,
        2
      );

    this.wallPaperTex = buildWallTex('#efece5', '120, 114, 102');
    this.accentWallTex = buildWallTex('#e1e7ee', '96, 110, 128');

    // 3. Natural Furniture Wood Grain Textures
    const buildFurnitureWood = (baseHex: string, grainDark: string, grainLight: string) =>
      this.createCanvasTexture(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = baseHex;
          ctx.fillRect(0, 0, w, h);
          for (let i = 0; i < 64; i++) {
            const y = (i / 64) * h;
            ctx.strokeStyle = i % 3 === 0 ? grainDark : grainLight;
            ctx.lineWidth = 1 + (i % 3) * 0.5;
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 0; x <= w; x += 16) {
              const offset = Math.sin(x * 0.03 + i * 0.7) * 2.5 + Math.cos(x * 0.012 + i) * 1.5;
              ctx.lineTo(x, y + offset);
            }
            ctx.stroke();
          }
        },
        2,
        2
      );

    this.lightOakTex = buildFurnitureWood('#dcc4a4', 'rgba(128, 92, 54, 0.16)', 'rgba(255, 244, 228, 0.14)');
    this.warmOakTex = buildFurnitureWood('#a98158', 'rgba(72, 46, 22, 0.22)', 'rgba(232, 202, 166, 0.14)');
    this.darkWalnutTex = buildFurnitureWood('#755438', 'rgba(42, 25, 12, 0.26)', 'rgba(182, 144, 108, 0.14)');

    // 4. Woven Fabric Grid Textures (blanket, sheets, rectangular rug)
    const buildFabricTex = (baseHex: string, threadA: string, threadB: string, step = 4, rep = 4) =>
      this.createCanvasTexture(
        256,
        256,
        (ctx, w, h) => {
          ctx.fillStyle = baseHex;
          ctx.fillRect(0, 0, w, h);
          for (let y = 0; y < h; y += step) {
            ctx.fillStyle = threadA;
            ctx.fillRect(0, y, w, 1);
          }
          for (let x = 0; x < w; x += step) {
            ctx.fillStyle = threadB;
            ctx.fillRect(x, 0, 1, h);
          }
          for (let i = 0; i < 900; i++) {
            const fx = Math.floor(this.hash2d(i, 7) * w);
            const fy = Math.floor(this.hash2d(i, 19) * h);
            ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            ctx.fillRect(fx, fy, 2, 2);
          }
        },
        rep,
        rep
      );

    this.blanketFabricTex = buildFabricTex('#3e648c', 'rgba(255,255,255,0.08)', 'rgba(18,32,54,0.14)', 4, 4);
    this.sheetFabricTex = buildFabricTex('#f5f7fa', 'rgba(180,190,204,0.12)', 'rgba(255,255,255,0.18)', 4, 5);
    this.rugFabricTex = this.createCanvasTexture(
      256,
      256,
      (ctx, w, h) => {
        ctx.fillStyle = '#c8c2b8';
        ctx.fillRect(0, 0, w, h);
        // Woven grid pattern
        for (let y = 0; y < h; y += 5) {
          ctx.fillStyle = y % 10 === 0 ? 'rgba(110, 102, 92, 0.16)' : 'rgba(255, 252, 245, 0.15)';
          ctx.fillRect(0, y, w, 2);
        }
        for (let x = 0; x < w; x += 5) {
          ctx.fillStyle = x % 10 === 0 ? 'rgba(95, 88, 80, 0.14)' : 'rgba(255, 255, 255, 0.12)';
          ctx.fillRect(x, 0, 2, h);
        }
        // Subtle modern geometric border frame
        ctx.strokeStyle = 'rgba(64, 82, 98, 0.42)';
        ctx.lineWidth = 8;
        ctx.strokeRect(14, 14, w - 28, h - 28);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(24, 24, w - 48, h - 48);
      },
      1,
      1
    );
  }

  private init(): void {
    this.isSoftwareGl = this.detectSoftwareGl();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdbeafe);
    this.scene.fog = new THREE.FogExp2(0xeef2f6, 0.012);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 45);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.setPixelRatio(this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.52;
    pmrem.dispose();

    this.createProceduralTextures();
    this.buildDaylightRig();
    this.buildRoomShell();
    this.buildCompositeBed();
    this.buildCompositeDeskAndChair();
    this.buildCompositeComputerStation();
    this.buildCompositeNotebook();
    this.buildDeskLampAndMug();
    this.buildCompositeWardrobeAndBookshelf();
    this.buildCompositeDoorAndWindow();
    this.buildWallPosters();

    this.resetOpeningAtBed();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }
    this.bindEvents();
  }

  private buildDaylightRig(): void {
    // Soft baseline fill
    this.ambientLight = new THREE.AmbientLight(0xfff9f2, 0.42);
    this.scene.add(this.ambientLight);

    // Indirect bounce: ceiling cool-white sky bounce + warm oak floor reflection
    this.hemiLight = new THREE.HemisphereLight(0xf2f7ff, 0xd4b692, 0.88);
    this.scene.add(this.hemiLight);

    // Sunlight streaming softly through the window (x = -3.36, z = -0.75) into the room
    this.sunLight = new THREE.DirectionalLight(0xfff2dc, 1.75);
    this.sunLight.position.set(-4.8, 4.1, -0.45);
    this.sunLight.target.position.set(0.6, 0.3, -1.2);
    if (!this.isSoftwareGl) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(1024, 1024);
      this.sunLight.shadow.camera.near = 0.5;
      this.sunLight.shadow.camera.far = 14;
      this.sunLight.shadow.camera.left = -4.2;
      this.sunLight.shadow.camera.right = 4.2;
      this.sunLight.shadow.camera.top = 4.2;
      this.sunLight.shadow.camera.bottom = -4.2;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02;
      this.sunLight.shadow.radius = 2.5;
    }
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Overhead LED ceiling fill (no shadow map for crisp 60FPS budget)
    this.ceilingLight = new THREE.PointLight(0xfffaf0, 1.15, 13, 1.4);
    this.ceilingLight.position.set(0, 2.86, 0);
    this.scene.add(this.ceilingLight);

    // Warm desk lamp PointLight casting cozy incandescent pool over desk & notebook
    this.deskLampLight = new THREE.PointLight(0xffcf8b, 1.85, 4.8, 1.5);
    this.deskLampLight.position.set(-0.92, 1.22, -2.32);
    this.scene.add(this.deskLampLight);
  }

  private buildRoomShell(): void {
    // Semi-gloss hardwood floor (roughness: 0.45)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(6.8, 6.8),
      new THREE.MeshStandardMaterial({
        map: this.floorWoodTex,
        roughness: 0.45,
        metalness: 0.04,
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Matte textured wallpaper (roughness: 0.9)
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.wallPaperTex,
      roughness: 0.9,
      metalness: 0.0,
    });
    const accentWallMat = new THREE.MeshStandardMaterial({
      map: this.accentWallTex,
      roughness: 0.9,
      metalness: 0.0,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.48,
      metalness: 0.02,
    });
    const ceilingMat = new THREE.MeshStandardMaterial({
      color: 0xf6f7f9,
      roughness: 0.9,
      metalness: 0.0,
    });

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 6.8), ceilingMat);
    ceiling.position.y = 3.1;
    ceiling.rotation.x = Math.PI / 2;
    this.scene.add(ceiling);

    // Sleek Modern Ceiling LED Panel Fixture (metallic housing + glowing acrylic diffuser)
    const fixtureGroup = new THREE.Group();
    fixtureGroup.position.set(0, 3.06, 0);
    const housingMat = new THREE.MeshStandardMaterial({
      color: 0xd1d5db,
      roughness: 0.25,
      metalness: 0.8,
    });
    const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.055, 0.54), housingMat);
    const diffuser = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.035, 0.46),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xfff6e5,
        emissiveIntensity: 0.85,
        roughness: 0.3,
      })
    );
    diffuser.position.y = -0.025;
    fixtureGroup.add(frameOuter, diffuser);
    this.scene.add(fixtureGroup);

    const walls: Array<[number, number, number, number, THREE.Material]> = [
      [0, 1.55, -3.4, 0, accentWallMat],
      [0, 1.55, 3.4, Math.PI, wallMat],
      [-3.4, 1.55, 0, Math.PI / 2, wallMat],
      [3.4, 1.55, 0, -Math.PI / 2, wallMat],
    ];
    for (const [x, y, z, ry, mat] of walls) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 3.1), mat);
      w.position.set(x, y, z);
      w.rotation.y = ry;
      w.receiveShadow = true;
      this.scene.add(w);

      // Baseboard & crown molding
      const baseboard = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.11, 0.035), trimMat);
      baseboard.position.set(x, 0.055, z);
      baseboard.rotation.y = ry;
      baseboard.receiveShadow = true;
      this.scene.add(baseboard);

      const crown = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.06, 0.03), trimMat);
      crown.position.set(x, 3.07, z);
      crown.rotation.y = ry;
      this.scene.add(crown);
    }

    // Center Rectangular Woven Rug (matte fabric roughness: 0.9)
    const rug = new THREE.Mesh(
      new THREE.BoxGeometry(2.55, 0.016, 1.85),
      new THREE.MeshStandardMaterial({
        map: this.rugFabricTex,
        roughness: 0.9,
        metalness: 0.0,
      })
    );
    rug.position.set(0.25, 0.008, 0.15);
    rug.receiveShadow = true;
    this.scene.add(rug);
  }

  private buildCompositeBed(): void {
    const bed = new THREE.Group();
    bed.position.set(-2.15, 0, 1.78);

    const oakMat = new THREE.MeshStandardMaterial({
      map: this.warmOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const sheetMat = new THREE.MeshStandardMaterial({
      map: this.sheetFabricTex,
      roughness: 0.9,
      metalness: 0.0,
    });
    const blanketMat = new THREE.MeshStandardMaterial({
      map: this.blanketFabricTex,
      roughness: 0.9,
      metalness: 0.0,
    });
    const blanketInnerMat = new THREE.MeshStandardMaterial({
      map: this.sheetFabricTex,
      color: 0xdbe5f0,
      roughness: 0.9,
      metalness: 0.0,
    });
    const pillowMat = new THREE.MeshStandardMaterial({
      map: this.sheetFabricTex,
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0.0,
    });

    // 4 Tapered Wooden Legs
    for (const lx of [-0.66, 0.66]) {
      for (const lz of [-1.0, 1.0]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.034, 0.24, 14), oakMat);
        leg.position.set(lx, 0.12, lz);
        leg.castShadow = true;
        leg.receiveShadow = true;
        bed.add(leg);
      }
    }

    // Wooden Frame Platform & Slatted Headboard
    const platform = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.13, 2.14), oakMat);
    platform.position.y = 0.285;
    platform.castShadow = true;
    platform.receiveShadow = true;
    bed.add(platform);

    const hbTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.085), oakMat);
    hbTop.position.set(0, 0.96, 1.04);
    hbTop.castShadow = true;
    bed.add(hbTop);
    for (let sx = -0.6; sx <= 0.6; sx += 0.2) {
      const slat = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.68, 10), oakMat);
      slat.position.set(sx, 0.61, 1.04);
      slat.castShadow = true;
      bed.add(slat);
    }

    // Thick Layered Mattress + Plush Topper
    const mattress = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.21, 2.0), sheetMat);
    mattress.position.set(0, 0.445, -0.02);
    mattress.castShadow = true;
    mattress.receiveShadow = true;

    const topper = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.055, 2.02), sheetMat);
    topper.position.set(0, 0.565, -0.02);
    topper.receiveShadow = true;

    // Draped Fabric Blanket + Slightly Folded Back Flap
    const blanket = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.075, 1.24), blanketMat);
    blanket.position.set(0, 0.615, -0.39);
    blanket.castShadow = true;
    blanket.receiveShadow = true;

    // Side overhangs so the blanket wraps naturally over the mattress edges
    for (const sx of [-0.7, 0.7]) {
      const sideDrape = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 1.22), blanketMat);
      sideDrape.position.set(sx, 0.51, -0.39);
      sideDrape.castShadow = true;
      bed.add(sideDrape);
    }

    // Folded-back duvet cuff (slightly angled for natural lived-in look)
    const foldedCuff = new THREE.Mesh(new THREE.BoxGeometry(1.43, 0.05, 0.28), blanketInnerMat);
    foldedCuff.position.set(0, 0.655, 0.14);
    foldedCuff.rotation.x = -0.08;
    foldedCuff.castShadow = true;
    foldedCuff.receiveShadow = true;

    const blanketRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 1.43, 14), blanketMat);
    blanketRoll.rotation.z = Math.PI / 2;
    blanketRoll.position.set(0, 0.635, 0.26);

    // 2 Sculpted Fabric Pillows
    for (const [px, rotY] of [
      [-0.33, 0.08],
      [0.33, -0.06],
    ] as Array<[number, number]>) {
      const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.24, 18, 14), pillowMat);
      pillow.scale.set(1.22, 0.36, 0.8);
      pillow.position.set(px, 0.645, 0.72);
      pillow.rotation.set(0.2, rotY, 0);
      pillow.castShadow = true;
      pillow.receiveShadow = true;
      bed.add(pillow);
    }

    bed.add(mattress, topper, blanket, foldedCuff, blanketRoll);
    this.scene.add(bed);
  }

  private buildCompositeDeskAndChair(): void {
    const desk = new THREE.Group();
    desk.position.set(0, 0, -2.5);

    // Semi-gloss light oak wood grain (roughness: 0.45)
    const woodTopMat = new THREE.MeshStandardMaterial({
      map: this.lightOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    // Brushed metallic steel & chrome (metalness: 0.8, roughness: 0.25)
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x3b4758,
      roughness: 0.25,
      metalness: 0.8,
    });
    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdbe4ee,
      roughness: 0.22,
      metalness: 0.85,
    });
    const mousepadMat = new THREE.MeshStandardMaterial({
      map: this.blanketFabricTex,
      color: 0x1e293b,
      roughness: 0.9,
      metalness: 0.0,
    });

    // Beveled Desk Tabletop via ExtrudeGeometry
    const topShape = new THREE.Shape();
    const hw = 1.15;
    const hd = 0.46;
    topShape.moveTo(-hw, -hd);
    topShape.lineTo(hw, -hd);
    topShape.lineTo(hw, hd);
    topShape.lineTo(-hw, hd);
    topShape.closePath();

    const topGeo = new THREE.ExtrudeGeometry(topShape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 2,
    });
    topGeo.rotateX(Math.PI / 2);
    const tabletop = new THREE.Mesh(topGeo, woodTopMat);
    tabletop.position.y = 0.78;
    tabletop.castShadow = true;
    tabletop.receiveShadow = true;
    desk.add(tabletop);

    // 4 Metallic Cylindrical Legs + Leveler Foot Pads + Crossbars
    for (const lx of [-1.04, 1.04]) {
      for (const lz of [-0.38, 0.38]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.023, 0.72, 14), steelMat);
        leg.position.set(lx, 0.37, lz);
        leg.castShadow = true;
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.039, 0.02, 14), chromeMat);
        foot.position.set(lx, 0.01, lz);
        desk.add(leg, foot);
      }
      const sideBar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.76, 10), steelMat);
      sideBar.rotation.x = Math.PI / 2;
      sideBar.position.set(lx, 0.18, 0);
      desk.add(sideBar);
    }

    // Drawer Cabinet with 3 Recessed Drawers & Metallic Pull Handles
    const drawerHousing = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.57, 0.72), woodTopMat);
    drawerHousing.position.set(0.76, 0.295, 0);
    drawerHousing.castShadow = true;
    drawerHousing.receiveShadow = true;
    desk.add(drawerHousing);

    for (let i = 0; i < 3; i++) {
      const dy = 0.12 + i * 0.175;
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.39, 0.145, 0.022), woodTopMat);
      front.position.set(0.76, dy, 0.366);
      front.receiveShadow = true;
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 10), chromeMat);
      handle.rotation.z = Math.PI / 2;
      handle.position.set(0.76, dy, 0.39);
      for (const hx of [-0.055, 0.055]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 8), chromeMat);
        post.rotation.x = Math.PI / 2;
        post.position.set(0.76 + hx, dy, 0.38);
        desk.add(post);
      }
      desk.add(front, handle);
    }

    // Extended Fabric Desk Mat / Mousepad
    const deskMat = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.007, 0.42), mousepadMat);
    deskMat.position.set(-0.04, 0.794, 0.12);
    deskMat.receiveShadow = true;
    desk.add(deskMat);

    this.scene.add(desk);

    // Ergonomic Chair (metallic frame + matte fabric seat/backrest)
    const chair = new THREE.Group();
    chair.position.set(0.18, 0, -1.52);
    chair.rotation.y = 0.3;

    const fabric = new THREE.MeshStandardMaterial({
      map: this.blanketFabricTex,
      color: 0x243044,
      roughness: 0.9,
      metalness: 0.0,
    });
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.06, 14), steelMat);
    hub.position.y = 0.07;
    chair.add(hub);

    for (let i = 0; i < 5; i++) {
      const ang = (i / 5) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 10), steelMat);
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.y = -ang;
      spoke.position.set(Math.cos(ang) * 0.16, 0.06, Math.sin(ang) * 0.16);

      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.025, 12), fabric);
      wheel.rotation.z = Math.PI / 2;
      wheel.rotation.y = -ang;
      wheel.position.set(Math.cos(ang) * 0.3, 0.028, Math.sin(ang) * 0.3);
      chair.add(spoke, wheel);
    }

    const gasLift = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.38, 14), chromeMat);
    gasLift.position.y = 0.27;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.075, 0.46), fabric);
    seat.position.y = 0.48;
    seat.castShadow = true;
    seat.receiveShadow = true;
    const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.56, 0.065), fabric);
    backrest.position.set(0, 0.82, 0.21);
    backrest.rotation.x = 0.08;
    backrest.castShadow = true;
    const headrest = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.06), fabric);
    headrest.position.set(0, 1.18, 0.22);

    for (const ax of [-0.27, 0.27]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.18, 10), steelMat);
      post.position.set(ax, 0.56, 0.02);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 0.26), fabric);
      pad.position.set(ax, 0.65, 0.02);
      chair.add(post, pad);
    }

    chair.add(gasLift, seat, backrest, headrest);
    this.scene.add(chair);
  }

  private buildCompositeComputerStation(): void {
    const pc = new THREE.Group();
    pc.position.set(0, 0.79, -2.5);

    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x1b202b,
      roughness: 0.35,
      metalness: 0.55,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0xb6c2d1,
      roughness: 0.25,
      metalness: 0.8,
    });

    // Sculpted Metallic Monitor Stand
    const standFoot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.018, 22), metalMat);
    standFoot.scale.set(1.2, 1, 0.7);
    standFoot.position.set(0, 0.009, -0.2);
    standFoot.castShadow = true;
    const standNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.034, 0.4, 14), metalMat);
    standNeck.position.set(0, 0.21, -0.24);
    standNeck.castShadow = true;

    // Thin-Bezel Curved Ultrawide Monitor
    const curveRadius = 2.4;
    const screenW = 0.96;
    const screenH = 0.52;

    const bezelGeo = createCurvedScreenGeometry(screenW + 0.032, screenH + 0.036, curveRadius, 22);
    const bezelBack = new THREE.Mesh(
      bezelGeo,
      new THREE.MeshStandardMaterial({
        color: 0x12161f,
        roughness: 0.32,
        metalness: 0.52,
        side: THREE.DoubleSide,
      })
    );
    bezelBack.position.set(0, 0.46, -0.21);
    bezelBack.castShadow = true;

    const screenTex = this.createCanvasTexture(512, 288, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#021c44');
      grad.addColorStop(1, '#0c63b8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(290, 62, 65, 65);
      ctx.fillRect(365, 62, 65, 65);
      ctx.fillRect(290, 137, 65, 65);
      ctx.fillRect(365, 137, 65, 65);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px sans-serif';
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
      color: 0x05070a,
      emissive: 0x000000,
      roughness: 0.12,
      metalness: 0.18,
    });

    const screenGeo = createCurvedScreenGeometry(screenW, screenH, curveRadius, 22);
    this.monitorScreenMesh = new THREE.Mesh(screenGeo, this.monitorOffMat);
    this.monitorScreenMesh.position.set(0, 0.46, -0.205);

    // Mechanical Keyboard with Crisp Keycap Texture + Raised 3D Keycap Rows
    const keycapTex = this.createCanvasTexture(256, 96, (ctx, w, h) => {
      ctx.fillStyle = '#11161f';
      ctx.fillRect(0, 0, w, h);
      const rows = 5;
      const cols = 15;
      const kw = (w - 12) / cols;
      const kh = (h - 12) / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (r === 4 && c >= 4 && c <= 9) continue;
          ctx.fillStyle = c === 0 || c === cols - 1 ? '#293548' : '#3b4a62';
          ctx.fillRect(6 + c * kw + 1, 6 + r * kh + 1, kw - 2.5, kh - 2.5);
        }
      }
      // Spacebar
      ctx.fillStyle = '#334155';
      ctx.fillRect(6 + 4 * kw + 1, 6 + 4 * kh + 1, 6 * kw - 2.5, kh - 2.5);
    });

    const kbBase = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.02, 0.155), chassisMat);
    kbBase.position.set(-0.06, 0.016, 0.14);
    kbBase.castShadow = true;
    const kbKeyDeck = new THREE.Mesh(
      new THREE.BoxGeometry(0.425, 0.012, 0.135),
      new THREE.MeshStandardMaterial({ map: keycapTex, roughness: 0.55, metalness: 0.1 })
    );
    kbKeyDeck.position.set(-0.06, 0.03, 0.14);
    pc.add(kbKeyDeck);

    // Ergonomic Mouse with Scroll Wheel Accent
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.042, 16, 12), chassisMat);
    mouse.scale.set(0.75, 0.55, 1.3);
    mouse.position.set(0.3, 0.022, 0.14);
    mouse.castShadow = true;
    const scrollWheel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 10), metalMat);
    scrollWheel.rotation.z = Math.PI / 2;
    scrollWheel.position.set(0.3, 0.042, 0.115);
    pc.add(scrollWheel);

    // PC Tower with Tempered Glass Side Panel & Subtle Internal LED Glow
    const towerGroup = new THREE.Group();
    towerGroup.position.set(0.84, 0.24, -0.06);

    // Hollow-feel chassis outer shell (back, top, bottom, front, right side) so interior is visible through glass
    const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.48, 0.44), chassisMat);
    rightPanel.position.x = 0.11;
    rightPanel.castShadow = true;
    const topPanel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.022, 0.44), chassisMat);
    topPanel.position.y = 0.23;
    topPanel.castShadow = true;
    const botPanel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.022, 0.44), chassisMat);
    botPanel.position.y = -0.23;
    const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.48, 0.025), chassisMat);
    frontPanel.position.z = 0.21;
    const backPanel = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.48, 0.022), chassisMat);
    backPanel.position.z = -0.21;

    // Internal motherboard + GPU card + subtle glowing LED rings & strip
    const mobo = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.38, 0.34),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.4 })
    );
    mobo.position.set(0.085, 0, -0.01);

    const gpuCard = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.036, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x263143, roughness: 0.3, metalness: 0.75 })
    );
    gpuCard.position.set(0.01, -0.03, -0.02);

    this.pcInteriorLedMat = new THREE.MeshStandardMaterial({
      color: 0x00ff41,
      emissive: 0x00ff41,
      emissiveIntensity: 0.85,
      roughness: 0.2,
    });

    const gpuLedStrip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.22), this.pcInteriorLedMat);
    gpuLedStrip.position.set(-0.062, -0.03, -0.02);

    for (const fy of [-0.09, 0.09]) {
      const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.056, 0.008, 10, 20), this.pcInteriorLedMat);
      fanRing.rotation.y = Math.PI / 2;
      fanRing.position.set(-0.04, fy, 0.08);
      towerGroup.add(fanRing);
    }

    // Translucent Tempered Glass Side Panel
    const glassSide = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.43),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.08,
        metalness: 0.15,
        transparent: true,
        opacity: 0.32,
      })
    );
    glassSide.rotation.y = -Math.PI / 2;
    glassSide.position.x = -0.121;

    towerGroup.add(rightPanel, topPanel, botPanel, frontPanel, backPanel, mobo, gpuCard, gpuLedStrip, glassSide);

    this.pcPowerLedMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });
    const powerLed = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.016, 14), this.pcPowerLedMat);
    powerLed.rotation.x = Math.PI / 2;
    powerLed.position.set(0.84, 0.42, 0.166);

    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.72, 0.65),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitBox.position.set(0.24, 0.36, -0.04);
    hitBox.userData.interactId = 'computer' as RoomInteractTarget;
    this.interactables.push(hitBox);
    this.targetAnchors.set('computer', new THREE.Vector3(0.05, 1.18, -2.38));

    pc.add(standFoot, standNeck, bezelBack, this.monitorScreenMesh, kbBase, mouse, towerGroup, powerLed, hitBox);
    this.scene.add(pc);
  }

  private buildCompositeNotebook(): void {
    const nb = new THREE.Group();
    nb.position.set(-0.68, 0.79, -2.32);
    nb.rotation.y = 0.24;

    const coverMat = new THREE.MeshStandardMaterial({ color: 0x1e40af, roughness: 0.78 });
    const pageTex = this.createCanvasTexture(256, 192, (ctx, w, h) => {
      ctx.fillStyle = '#fffef7';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#cbd5e1';
      for (let y = 24; y < h; y += 16) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 15px monospace';
      ctx.fillText('PYTHON NOTES', 18, 34);
      ctx.font = '12px monospace';
      ctx.fillText('def solve(x):', 18, 66);
      ctx.fillText('  return x * 2', 18, 86);
    });
    const pageMat = new THREE.MeshStandardMaterial({ map: pageTex, roughness: 0.9 });
    const wireMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.25, metalness: 0.8 });

    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.012, 0.26), coverMat);
    cover.castShadow = true;
    const leftPage = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.016, 0.24), pageMat);
    leftPage.position.set(-0.085, 0.012, 0);
    const rightPage = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.016, 0.24), pageMat);
    rightPage.position.set(0.085, 0.012, 0);

    for (let z = -0.1; z <= 0.1; z += 0.04) {
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.0025, 8, 12), wireMat);
      coil.position.set(0, 0.02, z);
      nb.add(coil);
    }

    // Metallic clip ballpoint pen
    const penBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.16, 10),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.3, metalness: 0.4 })
    );
    penBody.rotation.z = Math.PI / 2;
    penBody.rotation.y = 0.45;
    penBody.position.set(0.22, 0.008, 0.04);

    const hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.22, 0.4),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitBox.position.y = 0.08;
    hitBox.userData.interactId = 'notebook' as RoomInteractTarget;
    this.interactables.push(hitBox);
    this.targetAnchors.set('notebook', new THREE.Vector3(-0.68, 0.85, -2.32));

    nb.add(cover, leftPage, rightPage, penBody, hitBox);
    this.scene.add(nb);
  }

  private buildDeskLampAndMug(): void {
    // Articulated Metallic Desk Lamp (metalness: 0.8, roughness: 0.25)
    const lamp = new THREE.Group();
    lamp.position.set(-0.98, 0.79, -2.62);
    const metal = new THREE.MeshStandardMaterial({
      color: 0x3b4656,
      roughness: 0.25,
      metalness: 0.8,
    });
    const brassAccent = new THREE.MeshStandardMaterial({
      color: 0xd9a05b,
      roughness: 0.25,
      metalness: 0.82,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.026, 18), metal);
    base.position.y = 0.013;
    base.castShadow = true;
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.38, 10), metal);
    arm1.position.set(0, 0.2, 0.04);
    arm1.rotation.x = 0.22;
    const joint = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 10), brassAccent);
    joint.position.set(0.01, 0.38, 0.08);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.28, 10), metal);
    arm2.position.set(0.04, 0.44, 0.18);
    arm2.rotation.x = 1.05;
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.098, 0.135, 18, 1, true),
      new THREE.MeshStandardMaterial({
        color: 0x2f3b4c,
        roughness: 0.25,
        metalness: 0.8,
        side: THREE.DoubleSide,
      })
    );
    shade.position.set(0.06, 0.46, 0.3);
    shade.rotation.x = Math.PI * 0.82;
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.032, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xfff8dc, emissive: 0xffcf88, emissiveIntensity: 1.8 })
    );
    bulb.position.set(0.06, 0.42, 0.3);
    lamp.add(base, arm1, joint, arm2, shade, bulb);
    this.scene.add(lamp);

    // Ceramic Coffee Mug + Coaster on the desk
    const mugGroup = new THREE.Group();
    mugGroup.position.set(0.49, 0.79, -2.26);
    const coaster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.056, 0.058, 0.006, 16),
      new THREE.MeshStandardMaterial({ map: this.warmOakTex, roughness: 0.7 })
    );
    coaster.position.y = 0.003;
    const ceramicMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.22, metalness: 0.05 });
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.038, 0.095, 16), ceramicMat);
    cup.position.y = 0.054;
    cup.castShadow = true;
    const coffee = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, 0.004, 14),
      new THREE.MeshStandardMaterial({ color: 0x2c1810, roughness: 0.15 })
    );
    coffee.position.y = 0.098;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.0065, 8, 14, Math.PI), ceramicMat);
    handle.rotation.z = -Math.PI / 2;
    handle.position.set(0.04, 0.054, 0);
    mugGroup.add(coaster, cup, coffee, handle);
    this.scene.add(mugGroup);
  }

  private buildCompositeWardrobeAndBookshelf(): void {
    const wood = new THREE.MeshStandardMaterial({
      map: this.warmOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const darkWood = new THREE.MeshStandardMaterial({
      map: this.darkWalnutTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0xd1dbe6,
      roughness: 0.25,
      metalness: 0.8,
    });

    // Wardrobe (Plinth + Wood Body + Crown Molding + Double Doors + Metallic Handles)
    const wardrobe = new THREE.Group();
    wardrobe.position.set(2.55, 0, 1.55);
    wardrobe.rotation.y = -Math.PI / 2;

    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.1, 0.72), darkWood);
    plinth.position.y = 0.05;
    const wBody = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.08, 0.7), wood);
    wBody.position.y = 1.14;
    wBody.castShadow = true;
    wBody.receiveShadow = true;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.08, 0.76), darkWood);
    crown.position.y = 2.22;

    for (const dx of [-0.36, 0.36]) {
      const doorLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.96, 0.03), wood);
      doorLeaf.position.set(dx, 1.14, 0.36);
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 10), handleMat);
      handle.position.set(dx > 0 ? dx - 0.26 : dx + 0.26, 1.14, 0.39);
      wardrobe.add(doorLeaf, handle);
    }
    wardrobe.add(plinth, wBody, crown);
    this.scene.add(wardrobe);

    // Bookshelf + Rich Multi-Shelf Book Collection + Potted Plant
    const shelf = new THREE.Group();
    shelf.position.set(-2.95, 0, -1.95);
    shelf.rotation.y = Math.PI / 2;

    for (const sx of [-0.58, 0.58]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.9, 0.38), darkWood);
      side.position.set(sx, 0.95, 0);
      side.castShadow = true;
      shelf.add(side);
    }
    const sBack = new THREE.Mesh(new THREE.BoxGeometry(1.16, 1.9, 0.03), darkWood);
    sBack.position.set(0, 0.95, -0.175);
    shelf.add(sBack);

    const shelfLevels = [0.12, 0.55, 0.98, 1.41, 1.84];
    for (const y of shelfLevels) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.035, 0.36), darkWood);
      plank.position.set(0, y, 0);
      plank.receiveShadow = true;
      shelf.add(plank);
    }

    const bookColors = [
      0xdc2626, 0x2563eb, 0x059669, 0xd97706, 0x4f46e5, 0x0f766e, 0x9333ea, 0x475569,
    ];
    const bookMats = bookColors.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.78, metalness: 0.02 })
    );

    // Populate 3 shelves with varied heights/thicknesses & subtle tilted books
    const shelfConfigs = [
      { baseY: 0.568, count: 7, startX: -0.46 },
      { baseY: 0.998, count: 6, startX: -0.42 },
      { baseY: 1.428, count: 5, startX: -0.46 },
    ];
    let colorIdx = 0;
    for (const cfg of shelfConfigs) {
      let curX = cfg.startX;
      for (let i = 0; i < cfg.count; i++) {
        const bw = 0.045 + (colorIdx % 3) * 0.012;
        const bh = 0.24 + (colorIdx % 4) * 0.028;
        const book = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.23), bookMats[colorIdx % bookMats.length]);
        book.position.set(curX + bw * 0.5, cfg.baseY + bh * 0.5, 0.02);
        if (i === cfg.count - 1 && cfg.count < 7) {
          book.rotation.z = -0.22;
          book.position.x += 0.045;
        }
        book.castShadow = true;
        shelf.add(book);
        curX += bw + 0.012;
        colorIdx++;
      }
    }

    // Small Terracotta Plant Pot with Layered Foliage on Top Shelf
    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.06, 0.125, 14),
      new THREE.MeshStandardMaterial({ color: 0xc26d3a, roughness: 0.72 })
    );
    pot.position.set(0.32, 1.92, 0.02);
    pot.castShadow = true;
    const soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.072, 0.072, 0.012, 12),
      new THREE.MeshStandardMaterial({ color: 0x3b2818, roughness: 0.95 })
    );
    soil.position.set(0.32, 1.98, 0.02);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.75 });
    for (const [lx, ly, lz, sc] of [
      [0.32, 2.09, 0.02, 0.1],
      [0.25, 2.06, 0.06, 0.075],
      [0.39, 2.07, -0.02, 0.075],
      [0.31, 2.16, -0.01, 0.068],
    ] as Array<[number, number, number, number]>) {
      const clump = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 0), leafMat);
      clump.position.set(lx, ly, lz);
      clump.castShadow = true;
      shelf.add(clump);
    }
    shelf.add(pot, soil);

    this.scene.add(shelf);
  }

  private buildCompositeDoorAndWindow(): void {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.5 });
    const doorMat = new THREE.MeshStandardMaterial({
      map: this.warmOakTex,
      roughness: 0.45,
      metalness: 0.04,
    });
    // Metallic door handle (metalness: 0.8, roughness: 0.25)
    const metalHandleMat = new THREE.MeshStandardMaterial({
      color: 0xd4b06a,
      roughness: 0.25,
      metalness: 0.8,
    });

    // Composite Wood-Grain Door with Frame, Panel Moldings & Metallic Lever Handle
    const doorGroup = new THREE.Group();
    doorGroup.position.set(3.36, 0, -0.45);
    doorGroup.rotation.y = -Math.PI / 2;

    const jambL = new THREE.Mesh(new THREE.BoxGeometry(0.085, 2.28, 0.095), frameMat);
    jambL.position.set(-0.52, 1.14, 0);
    const jambR = jambL.clone();
    jambR.position.x = 0.52;
    const header = new THREE.Mesh(new THREE.BoxGeometry(1.13, 0.085, 0.095), frameMat);
    header.position.set(0, 2.28, 0);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.96, 2.2, 0.05), doorMat);
    panel.position.set(0, 1.1, 0.015);
    panel.receiveShadow = true;
    const recessTop = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.76, 0.022), doorMat);
    recessTop.position.set(0, 1.56, 0.042);
    const recessBot = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.76, 0.022), doorMat);
    recessBot.position.set(0, 0.62, 0.042);

    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.16, 0.012), metalHandleMat);
    plate.position.set(0.36, 1.05, 0.046);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.036, 10), metalHandleMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.set(0.36, 1.07, 0.064);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.135, 10), metalHandleMat);
    lever.rotation.z = Math.PI / 2;
    lever.position.set(0.3, 1.07, 0.084);

    const doorHit = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 2.3, 0.35),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    doorHit.position.set(0, 1.15, 0.1);
    doorHit.userData.interactId = 'door' as RoomInteractTarget;
    this.interactables.push(doorHit);
    this.targetAnchors.set('door', new THREE.Vector3(3.2, 1.2, -0.45));

    doorGroup.add(jambL, jambR, header, panel, recessTop, recessBot, plate, collar, lever, doorHit);
    this.scene.add(doorGroup);

    // Sunlit Window + Sill + Outside Sky Backdrop + Horizontal Venetian Blinds
    const winGroup = new THREE.Group();
    winGroup.position.set(-3.36, 1.72, -0.75);
    winGroup.rotation.y = Math.PI / 2;

    const winFrame = new THREE.Mesh(new THREE.BoxGeometry(1.82, 1.38, 0.09), frameMat);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.98, 0.055, 0.19), frameMat);
    sill.position.set(0, -0.69, 0.05);

    const skyTex = this.createCanvasTexture(256, 192, (ctx, w, h) => {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#3b82f6');
      grad.addColorStop(0.55, '#93c5fd');
      grad.addColorStop(1, '#e0f2fe');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      // Soft sunlight glow & fluffy clouds
      const sunGrad = ctx.createRadialGradient(48, 38, 4, 48, 38, 56);
      sunGrad.addColorStop(0, 'rgba(255, 250, 220, 0.95)');
      sunGrad.addColorStop(1, 'rgba(255, 250, 220, 0)');
      ctx.fillStyle = sunGrad;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.beginPath();
      ctx.arc(140, 62, 20, 0, Math.PI * 2);
      ctx.arc(166, 56, 26, 0, Math.PI * 2);
      ctx.arc(194, 64, 18, 0, Math.PI * 2);
      ctx.fill();
      // Distant soft horizon silhouette
      ctx.fillStyle = 'rgba(100, 148, 190, 0.25)';
      ctx.fillRect(0, h - 24, w, 24);
    });
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.62, 1.18),
      new THREE.MeshStandardMaterial({
        map: skyTex,
        emissive: 0xcbe8ff,
        emissiveMap: skyTex,
        emissiveIntensity: 0.72,
        roughness: 0.15,
      })
    );
    glass.position.z = 0.048;

    const barV = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.2, 0.04), frameMat);
    barV.position.z = 0.06;
    const barH = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.04, 0.04), frameMat);
    barH.position.z = 0.06;

    // Venetian Blinds (top valance box + 7 slightly tilted horizontal louvers + pull cords)
    const blindMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.52, metalness: 0.1 });
    const blindHeader = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.055, 0.065), blindMat);
    blindHeader.position.set(0, 0.59, 0.08);
    winGroup.add(blindHeader);

    for (let i = 0; i < 7; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.026, 0.008), blindMat);
      slat.position.set(0, 0.52 - i * 0.055, 0.082);
      slat.rotation.x = 0.42;
      winGroup.add(slat);
    }
    const cordMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85 });
    for (const cx of [-0.52, 0.52]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.42, 6), cordMat);
      cord.position.set(cx, 0.37, 0.084);
      winGroup.add(cord);
    }

    // Metallic Curtain Rod & Matte Fabric Side Drapes
    const rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 2.2, 12),
      new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.25 })
    );
    rod.rotation.z = Math.PI / 2;
    rod.position.set(0, 0.78, 0.13);
    winGroup.add(rod);

    const drapeMat = new THREE.MeshStandardMaterial({
      map: this.sheetFabricTex,
      color: 0xe8edf3,
      roughness: 0.9,
      metalness: 0.0,
    });
    for (const side of [-0.95, 0.95]) {
      for (let p = -1; p <= 1; p++) {
        const pleat = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 1.66, 10), drapeMat);
        pleat.position.set(side + p * 0.058, -0.04, 0.11);
        winGroup.add(pleat);
      }
    }

    const winHit = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 1.4, 0.35),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    winHit.position.z = 0.1;
    winHit.userData.interactId = 'window' as RoomInteractTarget;
    this.interactables.push(winHit);
    this.targetAnchors.set('window', new THREE.Vector3(-3.2, 1.55, -0.75));

    winGroup.add(winFrame, sill, glass, barV, barH, winHit);
    this.scene.add(winGroup);
  }

  private buildWallPosters(): void {
    const frameWoodMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.32,
      metalness: 0.45,
    });

    // Poster 1: Minimalist Python / Geometric Art above the Desk
    const poster1Tex = this.createCanvasTexture(256, 320, (ctx, w, h) => {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#00ff41';
      ctx.lineWidth = 3;
      ctx.strokeRect(18, 18, w - 36, h - 36);
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(w / 2, 130, 62, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(w / 2, 130, 44, 0.3, Math.PI * 1.65);
      ctx.stroke();
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 20px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SYNTAX // 01', w / 2, 238);
      ctx.fillStyle = '#00ff41';
      ctx.font = '13px monospace';
      ctx.fillText('def defend(): pass', w / 2, 266);
    });

    const addFramedPoster = (
      x: number,
      y: number,
      z: number,
      rotY: number,
      w: number,
      h: number,
      tex: THREE.CanvasTexture
    ) => {
      const grp = new THREE.Group();
      grp.position.set(x, y, z);
      grp.rotation.y = rotY;
      const outer = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.025), frameWoodMat);
      outer.castShadow = true;
      const art = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 })
      );
      art.position.z = 0.014;
      grp.add(outer, art);
      this.scene.add(grp);
    };

    // Above desk right-side accent wall
    addFramedPoster(1.48, 1.92, -3.37, 0, 0.58, 0.74, poster1Tex);

    // Poster 2: Warm Architectural Sun / Mountain Minimalist Art above Bed
    const poster2Tex = this.createCanvasTexture(320, 220, (ctx, w, h) => {
      ctx.fillStyle = '#f8f5ef';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#e07a5f';
      ctx.beginPath();
      ctx.arc(215, 76, 36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3d5a80';
      ctx.beginPath();
      ctx.moveTo(20, 195);
      ctx.lineTo(125, 86);
      ctx.lineTo(225, 195);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#293241';
      ctx.beginPath();
      ctx.moveTo(135, 195);
      ctx.lineTo(228, 110);
      ctx.lineTo(300, 195);
      ctx.closePath();
      ctx.fill();
    });
    addFramedPoster(-2.15, 1.88, 3.37, Math.PI, 0.88, 0.6, poster2Tex);
  }

  public resetOpeningAtBed(): void {
    this.camera.position.set(-1.65, 1.32, 1.38);
    this.yaw = -0.45;
    this.pitch = -0.04;
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
      this.pcInteriorLedMat.emissiveIntensity = 1.4;
    } else {
      this.monitorScreenMesh.material = this.monitorOffMat;
      this.pcPowerLedMat.color.setHex(0x334155);
      this.pcPowerLedMat.emissive.setHex(0x000000);
      this.pcPowerLedMat.emissiveIntensity = 0;
      this.pcInteriorLedMat.emissiveIntensity = 0.35;
    }
  }

  public setRoomLights(on: boolean): void {
    this.ambientLight.intensity = on ? 0.42 : 0;
    this.hemiLight.intensity = on ? 0.88 : 0;
    this.sunLight.intensity = on ? 1.75 : 0;
    this.ceilingLight.intensity = on ? 1.15 : 0;
    this.deskLampLight.intensity = on ? 1.85 : 0;
    this.scene.environmentIntensity = on ? 0.52 : 0;
    this.scene.background = new THREE.Color(on ? 0xdbeafe : 0x000000);
    this.scene.fog = new THREE.FogExp2(on ? 0xeef2f6 : 0x000000, on ? 0.012 : 0.08);
  }

  public start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.tick();
  }

  public stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
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
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
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
      const nextX = THREE.MathUtils.clamp(this.camera.position.x + _moveDelta.x, -2.7, 2.7);
      const nextZ = THREE.MathUtils.clamp(this.camera.position.z + _moveDelta.z, -1.75, 2.7);
      const insideDesk = nextX > -1.35 && nextX < 1.35 && nextZ < -1.85;
      if (!insideDesk) {
        this.camera.position.x = nextX;
        this.camera.position.z = nextZ;
      } else if (this.camera.position.z >= -1.85) {
        this.camera.position.x = nextX;
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
      // Physical distance check using camera.position.distanceTo(anchor)
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
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

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
      if (this.camera.position.z < -0.82 && !this.keys['KeyW']) {
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
