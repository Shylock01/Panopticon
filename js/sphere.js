// ============================================================
// sphere.js — Camera-orbit approach (uses global THREE)
// The sphere is stationary. Dragging orbits the camera around
// it using spherical coords (theta/phi). No quaternion chains
// → zero gimbal lock, zero drift, always consistent feel.
// ============================================================

const SPHERE_RADIUS = 2.6;
const DETAIL        = 3;
const CAM_RADIUS    = 7.2;    // Camera distance from origin
const DRAG_SENS     = 0.007;  // Radians per pixel dragged
const INERTIA_DAMP  = 0.88;   // Velocity decay per frame
const IDLE_ROT      = 0.0004; // Radians/frame idle rotation (reduced by 50%)
const NODE_R        = 0.16;  // Badge radius (circle, reduced by 20%)
const NODE_H        = 0.065; // Badge thickness
const BEVEL_TUBE    = 0.013; // Bevel torus tube radius
const HOVER_SCALE   = 1.12;  // Subtle scale-up on hover
const LERP_SPEED    = 0.14;  // Animation smoothness
const PHI_MIN       = 0.15;   // Clamp away from poles (~8.6°)
const PHI_MAX       = Math.PI - 0.15;
window.GlobalIconScale = 1.0; // Dynamic scale controlled by Style settings

// Fibonacci sphere positions, sorted equator-first.
// First slots go to equatorial band; later slots approach poles.
// Positions within ~22° of each pole are excluded.
function _fibPositions(n, r) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const raw = Array.from({ length: n }, (_, i) => {
    const y   = 1 - (i / (n - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    return new THREE.Vector3(
      Math.cos(golden * i) * rad * r,
      y * r,
      Math.sin(golden * i) * rad * r
    );
  });
  const poleExclude = r * Math.cos(0.38); // ~22° from each pole
  const startPoint = new THREE.Vector3(0, 0, r); // Default camera view is at (0, 0, r)
  
  return raw
    .filter(p => Math.abs(p.y) <= poleExclude)
    .sort((a, b) => a.distanceToSquared(startPoint) - b.distanceToSquared(startPoint));
}

class PanopticonSphere {
  constructor(canvas, onNodeClick, initialZoom = null) {
    if (typeof THREE === 'undefined') {
      throw new Error('Three.js is not loaded. Check your internet connection and reload.');
    }

    this.canvas      = canvas;
    this.onNodeClick = onNodeClick;
    this.nodes       = new Map();
    this.usedSlots   = new Set();

    // Spherical camera orbit state
    this._theta    = 0.3;           // Horizontal angle (azimuth)
    this._phi      = Math.PI / 2;   // Vertical angle (elevation, start at equator)
    this._velTheta = 0;
    this._velPhi   = 0;

    this._isDragging  = false;
    this._prevPtr     = { x: 0, y: 0 };
    this._dragDist    = 0;
    this._hoveredNode = null;
    this._raycaster   = new THREE.Raycaster();
    this._mouse       = new THREE.Vector2();
    this._animId      = null;

    // Focus state
    this._focusedRepoName = null;
    this._targetTheta     = null;
    this._targetPhi       = null;
    this._isLocked        = false;

    // Zoom state
    // Zoom state
    const savedZoom = initialZoom || {};
    this._radius         = (typeof savedZoom.radius === 'number') ? savedZoom.radius : CAM_RADIUS;
    this._targetRadius   = this._radius;
    this._defaultRadius  = this._radius;
    this._zoomLocked     = savedZoom ? savedZoom.locked : false;
    this._accentColor    = new THREE.Color(0x1243b5);
    
    this._pinchDist      = 0;
    this._holdStartTime  = 0;
    this._isHolding      = false;
    this._holdCancelled  = false;
    this._zoomLastActiveTime = 0;
    this._ptrPos         = { x: 0, y: 0 };

    // Cached DOM refs
    this._ui = {
      indicator: document.getElementById('zoom-indicator'),
      ring:      document.getElementById('zoom-ring-progress'),
      flash:     document.getElementById('zoom-flash')
    };

    // Pre-allocated vectors for loop performance
    this._tmpDir = new THREE.Vector3();
    this._tmpPos = new THREE.Vector3();

    this._slotPositions = _fibPositions(64, SPHERE_RADIUS);

    this._init();
    this._bindEvents();
    this._animate();
  }

  // ── Scene Setup ──────────────────────────────────────────────────────────

  _init() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.setClearColor(0x000000, 0);

    // Offscreen render target to capture and blur glowing background components
    this.blurTarget = new THREE.WebGLRenderTarget(w / 4, h / 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat
    });

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 200);
    this._updateCamera(); // set initial position

    // ── Lighting ────────────────────────────────────────────────────────────
    // Attach lights to the camera so sphere shading stays consistent
    // from every viewing angle. Must add camera to scene for this to work.
    this.scene.add(this.camera);

    // Soft ambient base — reduced for better icon legibility
    this._ambientLight = new THREE.AmbientLight(0x2a2d3a, 1.2);
    this.scene.add(this._ambientLight);

    // Key light: soft, slightly above-left in camera space
    const keyLight = new THREE.DirectionalLight(0xc8d4f0, 0.9);
    keyLight.position.set(-3, 5, 3); // camera-relative
    this.camera.add(keyLight);

    // Fill light: low intensity from below-right to soften shadows
    this._fillLight = new THREE.DirectionalLight(0x7080aa, 0.3);
    this._fillLight.position.set(4, -3, 2);
    this.camera.add(this._fillLight);

    // Back glow: world-space, feeds the eclipse halo behind the sphere
    this._backLight = new THREE.PointLight(0x3a6fff, 20, 40);
    this._backLight.position.set(0, 0, -8);
    this.scene.add(this._backLight);

    this._addEclipseHalo();
    this._initGlowTexture();

    // Sphere + nodes group — stays at origin, never rotates
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this._addSphere();
    this._addPulseShell();
    this._addEdges();
    this._addInnerCore();
  }

  // Move camera to current theta/phi position, always look at origin.
  // Also repositions halo planes to stay behind sphere from camera's POV.
  _updateCamera() {
    const r = this._radius;
    const sinPhi = Math.sin(this._phi);
    const cx = r * sinPhi * Math.sin(this._theta);
    const cy = r * Math.cos(this._phi);
    const cz = r * sinPhi * Math.cos(this._theta);
    this.camera.position.set(cx, cy, cz);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);

    // Keep halo planes and back light locked directly behind the sphere
    // (opposite the camera, always facing toward camera)
    if (this._haloMesh && this._coronaMesh) {
      this._tmpDir.copy(this.camera.position).normalize();
      
      // Back light pulses from directly behind the sphere
      this._backLight.position.copy(this._tmpDir).multiplyScalar(-8);
      
      // Halo planes sit behind sphere, oriented to face camera
      this._haloMesh.position.copy(this._tmpDir).multiplyScalar(-9);
      this._haloMesh.lookAt(this.camera.position);
      
      this._coronaMesh.position.copy(this._tmpDir).multiplyScalar(-5.6);
      this._coronaMesh.lookAt(this.camera.position);

      // Scale glow INVERSELY to distance so it shrinks with the sphere when zooming out
      const glowScale = CAM_RADIUS / r;
      this._haloMesh.scale.setScalar(glowScale);
      this._coronaMesh.scale.setScalar(glowScale);
    }

    if (this._sphereUniforms) {
      this._sphereUniforms.uCameraPos.value.copy(this.camera.position);
    }
    if (this._edgeUniforms) {
      this._edgeUniforms.uCameraPos.value.copy(this.camera.position);
    }
  }

  // ── Eclipse Halo ─────────────────────────────────────────────────────────

  _addEclipseHalo() {
    const c1 = document.createElement('canvas');
    c1.width = c1.height = 512;
    const x1 = c1.getContext('2d');
    this._haloCanvas = c1;
    this._haloCtx = x1;
    this._haloTexture = new THREE.CanvasTexture(c1);

    this._haloMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(21.6, 21.6),
      new THREE.MeshBasicMaterial({
        map: this._haloTexture,
        color: new THREE.Color(0xffffff), // base color is white to let canvas colors render exactly
        transparent: true, depthWrite: false,
        blending: THREE.NormalBlending,
      })
    );
    this.scene.add(this._haloMesh);

    const c2 = document.createElement('canvas');
    c2.width = c2.height = 512;
    const x2 = c2.getContext('2d');
    this._coronaCanvas = c2;
    this._coronaCtx = x2;
    this._coronaTexture = new THREE.CanvasTexture(c2);

    this._coronaMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(11.6, 11.6),
      new THREE.MeshBasicMaterial({
        map: this._coronaTexture,
        color: new THREE.Color(0xffffff), // base color is white to let canvas colors render exactly
        transparent: true, depthWrite: false,
        blending: THREE.NormalBlending,
      })
    );
    this.scene.add(this._coronaMesh);

    // Initial draw using the default accent color
    const defaultHex = '#' + this._accentColor.getHexString();
    this._updateEclipseGlowTextures(defaultHex);
  }

  _updateEclipseGlowTextures(themeColorHex) {
    try {
      const color = new THREE.Color(themeColorHex);
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);

      // 1. Redraw Halo Canvas
      if (this._haloCtx) {
        this._haloCtx.clearRect(0, 0, 512, 512);
        const g1 = this._haloCtx.createRadialGradient(256, 256, 30, 256, 256, 256);
        g1.addColorStop(0,    'rgba(255,255,255,0.95)'); // Pure white at the center
        g1.addColorStop(0.18, 'rgba(255,255,255,0.75)'); // Soft white glow
        g1.addColorStop(0.42, `rgba(${r},${g},${b},0.35)`); // Transition to theme color
        g1.addColorStop(0.70, `rgba(${r},${g},${b},0.12)`);
        g1.addColorStop(1,    `rgba(${r},${g},${b},0)`);
        this._haloCtx.fillStyle = g1;
        this._haloCtx.fillRect(0, 0, 512, 512);
        if (this._haloTexture) this._haloTexture.needsUpdate = true;
      }

      // 2. Redraw Corona Canvas (replaces hollow ring with solid glow disk having a white center)
      if (this._coronaCtx) {
        this._coronaCtx.clearRect(0, 0, 512, 512);
        const g2 = this._coronaCtx.createRadialGradient(256, 256, 0, 256, 256, 256); // Start at 0 to eliminate empty center
        g2.addColorStop(0,    'rgba(255,255,255,0.95)'); // Pure white at the center
        g2.addColorStop(0.50, 'rgba(255,255,255,0.65)'); // Smooth white glow
        g2.addColorStop(0.72, `rgba(${r},${g},${b},0.45)`); // Transition to theme color
        g2.addColorStop(0.84, `rgba(${r},${g},${b},0.15)`);
        g2.addColorStop(1,    `rgba(${r},${g},${b},0)`);
        this._coronaCtx.fillStyle = g2;
        this._coronaCtx.fillRect(0, 0, 512, 512);
        if (this._coronaTexture) this._coronaTexture.needsUpdate = true;
      }
    } catch (err) {
      console.error("Error in _updateEclipseGlowTextures:", err);
    }
  }

  _initGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0,   'rgba(255,255,255,0.7)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.3)');
    g.addColorStop(1,   'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    this._glowTex = new THREE.CanvasTexture(c);
  }

  // ── Sphere Geometry ───────────────────────────────────────────────────────

  _addSphere() {
    const baseGeo = new THREE.IcosahedronGeometry(SPHERE_RADIUS, DETAIL);
    const nonIndexedGeo = baseGeo.toNonIndexed();

    const posAttr = nonIndexedGeo.attributes.position;
    const count = posAttr.count;

    // We will extrude each triangle into a 3D prism.
    // Outer/side faces: 1 outer triangle + 3 side quads (6 triangles) = 7 triangles per original triangle.
    const outerCount = (count / 3) * 21;
    const outerVertices = new Float32Array(outerCount * 3);
    const outerCentroids = new Float32Array(outerCount * 3);

    // Inner back face: 1 triangle per original triangle.
    const backVertices = new Float32Array(count * 3);
    const backCentroids = new Float32Array(count * 3);

    const THICKNESS = 0.04; // 0.04 units thickness for a beautifully defined solid panel look

    let outerIdx = 0;
    let backIdx = 0;

    for (let i = 0; i < count; i += 3) {
      const x0 = posAttr.getX(i), y0 = posAttr.getY(i), z0 = posAttr.getZ(i);
      const x1 = posAttr.getX(i + 1), y1 = posAttr.getY(i + 1), z1 = posAttr.getZ(i + 1);
      const x2 = posAttr.getX(i + 2), y2 = posAttr.getY(i + 2), z2 = posAttr.getZ(i + 2);

      const cx = (x0 + x1 + x2) / 3;
      const cy = (y0 + y1 + y2) / 3;
      const cz = (z0 + z1 + z2) / 3;

      // Calculate the radial face normal (outward from the sphere center)
      const len = Math.sqrt(cx*cx + cy*cy + cz*cz);
      const ndx = cx / len;
      const ndy = cy / len;
      const ndz = cz / len;

      // Inner vertices (extruded inward along the normal)
      const ix0 = x0 - ndx * THICKNESS, iy0 = y0 - ndy * THICKNESS, iz0 = z0 - ndz * THICKNESS;
      const ix1 = x1 - ndx * THICKNESS, iy1 = y1 - ndy * THICKNESS, iz1 = z1 - ndz * THICKNESS;
      const ix2 = x2 - ndx * THICKNESS, iy2 = y2 - ndy * THICKNESS, iz2 = z2 - ndz * THICKNESS;

      // Helper to push vertex coordinates and matching centroids to the outer/side buffer arrays
      const pushOuterVert = (vx, vy, vz) => {
        outerVertices[outerIdx]     = vx;
        outerVertices[outerIdx + 1] = vy;
        outerVertices[outerIdx + 2] = vz;

        outerCentroids[outerIdx]     = cx;
        outerCentroids[outerIdx + 1] = cy;
        outerCentroids[outerIdx + 2] = cz;

        outerIdx += 3;
      };

      // 1. Front/Outer Face (Wound counter-clockwise facing outwards)
      pushOuterVert(x0, y0, z0);
      pushOuterVert(x1, y1, z1);
      pushOuterVert(x2, y2, z2);

      // 2. Side Quad 0 (between v0 and v1)
      pushOuterVert(x0, y0, z0);
      pushOuterVert(ix0, iy0, iz0);
      pushOuterVert(x1, y1, z1);

      pushOuterVert(x1, y1, z1);
      pushOuterVert(ix0, iy0, iz0);
      pushOuterVert(ix1, iy1, iz1);

      // 3. Side Quad 1 (between v1 and v2)
      pushOuterVert(x1, y1, z1);
      pushOuterVert(ix1, iy1, iz1);
      pushOuterVert(x2, y2, z2);

      pushOuterVert(x2, y2, z2);
      pushOuterVert(ix1, iy1, iz1);
      pushOuterVert(ix2, iy2, iz2);

      // 4. Side Quad 2 (between v2 and v0)
      pushOuterVert(x2, y2, z2);
      pushOuterVert(ix2, iy2, iz2);
      pushOuterVert(x0, y0, z0);

      pushOuterVert(x0, y0, z0);
      pushOuterVert(ix2, iy2, iz2);
      pushOuterVert(ix0, iy0, iz0);

      // Helper to push vertex coordinates and matching centroids to the back/interior buffer arrays
      const pushBackVert = (vx, vy, vz) => {
        backVertices[backIdx]     = vx;
        backVertices[backIdx + 1] = vy;
        backVertices[backIdx + 2] = vz;

        backCentroids[backIdx]     = cx;
        backCentroids[backIdx + 1] = cy;
        backCentroids[backIdx + 2] = cz;

        backIdx += 3;
      };

      // 5. Back/Inner Face (Wound same as original to render correctly with THREE.BackSide)
      pushBackVert(ix0, iy0, iz0);
      pushBackVert(ix1, iy1, iz1);
      pushBackVert(ix2, iy2, iz2);
    }

    const prismOuterGeo = new THREE.BufferGeometry();
    prismOuterGeo.setAttribute('position', new THREE.BufferAttribute(outerVertices, 3));
    prismOuterGeo.setAttribute('aCentroid', new THREE.BufferAttribute(outerCentroids, 3));
    prismOuterGeo.computeVertexNormals();

    const prismBackGeo = new THREE.BufferGeometry();
    prismBackGeo.setAttribute('position', new THREE.BufferAttribute(backVertices, 3));
    prismBackGeo.setAttribute('aCentroid', new THREE.BufferAttribute(backCentroids, 3));
    prismBackGeo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      color:    this._accentColor.clone().multiplyScalar(1.0),
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.FrontSide
    });

    this._sphereUniforms = {
      uCameraPos: { value: new THREE.Vector3() },
      uPulseTime: { value: 0 },
      uPulseStartTime: { value: 0 },
      uPulseOrigin: { value: new THREE.Vector3(0, 1, 0) },
      uPulseActive: { value: 0.0 }
    };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCameraPos = this._sphereUniforms.uCameraPos;
      shader.uniforms.uPulseTime = this._sphereUniforms.uPulseTime;
      shader.uniforms.uPulseStartTime = this._sphereUniforms.uPulseStartTime;
      shader.uniforms.uPulseOrigin = this._sphereUniforms.uPulseOrigin;
      shader.uniforms.uPulseActive = this._sphereUniforms.uPulseActive;

      shader.vertexShader = `
        attribute vec3 aCentroid;
        uniform vec3 uCameraPos;
        uniform float uPulseTime;
        uniform float uPulseStartTime;
        uniform vec3 uPulseOrigin;
        uniform float uPulseActive;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `
        vec3 objectNormal = normalize(aCentroid);
        `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        vec3 faceNormal = normalize(aCentroid);
        vec3 camDir = normalize(uCameraPos);
        float dotCam = dot(faceNormal, camDir);
        // Start the resizing falloff earlier (from 0.50 instead of 0.66) for a more gradual opening effect
        float t = clamp((dotCam - 0.50) / 0.50, 0.0, 1.0);
        float scale = 1.0 - pow(t, 4.0);
        
        // Dynamic thickness scaling based on camera angle (up to 4.5x thicker at grazing angles)
        float thicknessScale = mix(4.5, 1.0, clamp(dotCam, 0.0, 1.0));
        
        vec3 localPos = position - aCentroid;
        float distToCentroidNormal = dot(localPos, faceNormal);
        vec3 thicknessPos = distToCentroidNormal * faceNormal;
        vec3 lateralPos = localPos - thicknessPos;
        
        vec3 displacement = vec3(0.0);
        if (uPulseActive > 0.5) {
          vec3 nCent = normalize(aCentroid);
          vec3 nOri = normalize(uPulseOrigin);
          float d = acos(clamp(dot(nCent, nOri), -1.0, 1.0));
          float period = 2.0;
          float elapsedTime = uPulseTime - uPulseStartTime;
          float tPulse = mod(elapsedTime, period) / period;
          float wavePos = tPulse * 3.14159 * 1.2;
          float width = 0.35;
          float wave = smoothstep(wavePos - width, wavePos, d) * 
                       smoothstep(wavePos + width, wavePos, d);
          float edgeFade = 1.0 - tPulse;
          float lift = wave * edgeFade * 0.15;
          displacement = faceNormal * lift;
        }
        
        // Apply lateral scale, dynamic thickness scale, and wave displacement
        vec3 transformed = aCentroid + lateralPos * scale + thicknessPos * thicknessScale + displacement;
        `
      );
    };

    this._sphereMesh = new THREE.Mesh(prismOuterGeo, mat);
    this.group.add(this._sphereMesh);

    // Interior material: solid logo blue, no gradient, renders on the backside
    const backColor = this._accentColor.clone().lerp(new THREE.Color(0xffffff), 0.4);
    const backMat = new THREE.MeshBasicMaterial({
      color: backColor,
      side: THREE.BackSide
    });

    backMat.onBeforeCompile = (shader) => {
      shader.uniforms.uCameraPos = this._sphereUniforms.uCameraPos;
      shader.uniforms.uPulseTime = this._sphereUniforms.uPulseTime;
      shader.uniforms.uPulseStartTime = this._sphereUniforms.uPulseStartTime;
      shader.uniforms.uPulseOrigin = this._sphereUniforms.uPulseOrigin;
      shader.uniforms.uPulseActive = this._sphereUniforms.uPulseActive;

      shader.vertexShader = `
        attribute vec3 aCentroid;
        uniform vec3 uCameraPos;
        uniform float uPulseTime;
        uniform float uPulseStartTime;
        uniform vec3 uPulseOrigin;
        uniform float uPulseActive;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        vec3 faceNormal = normalize(aCentroid);
        vec3 camDir = normalize(uCameraPos);
        float dotCam = dot(faceNormal, camDir);
        // Start the resizing falloff earlier (from 0.50 instead of 0.66) for a more gradual opening effect
        float t = clamp((dotCam - 0.50) / 0.50, 0.0, 1.0);
        float scale = 1.0 - pow(t, 4.0);
        
        // Dynamic thickness scaling based on camera angle (up to 4.5x thicker at grazing angles)
        float thicknessScale = mix(4.5, 1.0, clamp(dotCam, 0.0, 1.0));
        
        vec3 localPos = position - aCentroid;
        float distToCentroidNormal = dot(localPos, faceNormal);
        vec3 thicknessPos = distToCentroidNormal * faceNormal;
        vec3 lateralPos = localPos - thicknessPos;
        
        vec3 displacement = vec3(0.0);
        if (uPulseActive > 0.5) {
          vec3 nCent = normalize(aCentroid);
          vec3 nOri = normalize(uPulseOrigin);
          float d = acos(clamp(dot(nCent, nOri), -1.0, 1.0));
          float period = 2.0;
          float elapsedTime = uPulseTime - uPulseStartTime;
          float tPulse = mod(elapsedTime, period) / period;
          float wavePos = tPulse * 3.14159 * 1.2;
          float width = 0.35;
          float wave = smoothstep(wavePos - width, wavePos, d) * 
                       smoothstep(wavePos + width, wavePos, d);
          float edgeFade = 1.0 - tPulse;
          float lift = wave * edgeFade * 0.15;
          displacement = faceNormal * lift;
        }
        
        // Apply lateral scale (with a tiny overlap to close seams on the back side), dynamic thickness scale, and wave displacement
        vec3 transformed = aCentroid + lateralPos * (scale * 1.03) + thicknessPos * thicknessScale + displacement;
        `
      );
    };

    this._sphereInteriorMesh = new THREE.Mesh(prismBackGeo, backMat);
    this.group.add(this._sphereInteriorMesh);
  }

  _addEdges() {
    const baseGeo = new THREE.IcosahedronGeometry(SPHERE_RADIUS + 0.002, DETAIL);
    const nonIndexedGeo = baseGeo.toNonIndexed();

    const posAttr = nonIndexedGeo.attributes.position;
    const count = posAttr.count;

    const lineVertices = new Float32Array(count * 2 * 3);
    const lineCentroids = new Float32Array(count * 2 * 3);

    let lineIdx = 0;
    for (let i = 0; i < count; i += 3) {
      const x0 = posAttr.getX(i), y0 = posAttr.getY(i), z0 = posAttr.getZ(i);
      const x1 = posAttr.getX(i + 1), y1 = posAttr.getY(i + 1), z1 = posAttr.getZ(i + 1);
      const x2 = posAttr.getX(i + 2), y2 = posAttr.getY(i + 2), z2 = posAttr.getZ(i + 2);

      const cx = (x0 + x1 + x2) / 3;
      const cy = (y0 + y1 + y2) / 3;
      const cz = (z0 + z1 + z2) / 3;

      const pts = [
        x0, y0, z0,  x1, y1, z1,
        x1, y1, z1,  x2, y2, z2,
        x2, y2, z2,  x0, y0, z0
      ];

      for (let j = 0; j < 18; j += 3) {
        lineVertices[lineIdx]     = pts[j];
        lineVertices[lineIdx + 1] = pts[j + 1];
        lineVertices[lineIdx + 2] = pts[j + 2];

        lineCentroids[lineIdx]     = cx;
        lineCentroids[lineIdx + 1] = cy;
        lineCentroids[lineIdx + 2] = cz;

        lineIdx += 3;
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lineVertices, 3));
    lineGeo.setAttribute('aCentroid', new THREE.BufferAttribute(lineCentroids, 3));

    this._edgeUniforms = {
      uCameraPos: { value: new THREE.Vector3() },
      uColor: { value: this._accentColor.clone() },
      uPulseTime: { value: 0 },
      uPulseStartTime: { value: 0 },
      uPulseOrigin: { value: new THREE.Vector3(0, 1, 0) },
      uPulseActive: { value: 0.0 }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this._edgeUniforms,
      vertexShader: `
        attribute vec3 aCentroid;
        uniform vec3 uCameraPos;
        uniform float uPulseTime;
        uniform float uPulseStartTime;
        uniform vec3 uPulseOrigin;
        uniform float uPulseActive;
        varying float vScale;
        void main() {
          vec3 faceNormal = normalize(aCentroid);
          vec3 camDir = normalize(uCameraPos);
          float dotCam = dot(faceNormal, camDir);
          // Start the resizing falloff earlier (from 0.50 instead of 0.66) for a more gradual opening effect
          float t = clamp((dotCam - 0.50) / 0.50, 0.0, 1.0);
          float scale = 1.0 - pow(t, 4.0);
          vScale = scale;
          
          vec3 displacement = vec3(0.0);
          if (uPulseActive > 0.5) {
            vec3 nCent = normalize(aCentroid);
            vec3 nOri = normalize(uPulseOrigin);
            float d = acos(clamp(dot(nCent, nOri), -1.0, 1.0));
            float period = 2.0;
            float elapsedTime = uPulseTime - uPulseStartTime;
            float tPulse = mod(elapsedTime, period) / period;
            float wavePos = tPulse * 3.14159 * 1.2;
            float width = 0.35;
            float wave = smoothstep(wavePos - width, wavePos, d) * 
                         smoothstep(wavePos + width, wavePos, d);
            float edgeFade = 1.0 - tPulse;
            float lift = wave * edgeFade * 0.15;
            displacement = faceNormal * lift;
          }
          
          vec3 localPos = position - aCentroid;
          vec3 scaledPos = aCentroid + localPos * scale + displacement;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(scaledPos, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vScale;
        void main() {
          if (vScale < 0.01) discard;
          gl_FragColor = vec4(uColor, vScale * 0.32);
        }
      `,
      transparent: true,
      depthWrite: false,
    });

    this._edgeLines = new THREE.LineSegments(lineGeo, mat);
    this.group.add(this._edgeLines);
  }

  _addPulseShell() {
    this._pulseUniforms = {
      uTime:   { value: 0 },
      uStartTime: { value: 0 },
      uOrigin: { value: new THREE.Vector3(0, 1, 0) },
      uActive: { value: 0.0 },
      uColor:  { value: this._accentColor.clone() }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this._pulseUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uStartTime;
        uniform vec3 uOrigin;
        uniform float uActive;
        uniform vec3 uColor;
        varying vec3 vPos;

        void main() {
          if (uActive < 0.5) discard;
          
          vec3 nPos = normalize(vPos);
          vec3 nOri = normalize(uOrigin);
          float d = acos(clamp(dot(nPos, nOri), -1.0, 1.0));
          
          float period = 2.0;
          float elapsedTime = max(0.0, uTime - uStartTime);
          float t = mod(elapsedTime, period) / period;
          
          // The wave front travels from 0 to PI (opposite pole)
          float wavePos = t * 3.14159 * 1.2;
          float width = 0.35;
          
          float wave = smoothstep(wavePos - width, wavePos, d) * 
                       smoothstep(wavePos + width, wavePos, d);
          
          // Stronger at start, fades at end
          float edgeFade = 1.0 - t;
          
          // Mix the theme color with white (split difference at 0.25) to make the pulse wave lighter and brighter
          vec3 finalColor = mix(uColor, vec3(1.0, 1.0, 1.0), 0.25);
          
          // Increased opacity multiplier to 0.65 (from 0.22) to make the pulse significantly more visible
          float alpha = wave * edgeFade * 0.65;
          
          gl_FragColor = vec4(finalColor, alpha);
        }
      `
    });

    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(SPHERE_RADIUS + 0.015, DETAIL), mat);
    this.group.add(shell);
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────

  // Draws the icon url onto a circular-clipped canvas and returns a CanvasTexture.
  _circularTexture(iconDataUrl) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    const img = new Image();
    if (iconDataUrl && (iconDataUrl.startsWith('http://') || iconDataUrl.startsWith('https://'))) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      
      const padding = size * 0.15;
      const s = size - padding * 2;
      
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      
      ctx.drawImage(img, padding, padding, s, s);
      tex.needsUpdate = true;
    };
    img.onerror = (err) => {
      console.error("Failed to load icon image in _circularTexture for src:", iconDataUrl, err);
    };
    img.src = iconDataUrl;
    return tex;
  }

  addNode(appEntry) {
    const repoName = appEntry.repoName || appEntry.name;
    if (!repoName) return;
    if (this.nodes.has(repoName)) this.removeNode(repoName);

    let slot = 0;
    while (this.usedSlots.has(slot) && slot < this._slotPositions.length) slot++;
    this.usedSlots.add(slot);

    const slotPos = this._slotPositions[slot % this._slotPositions.length];
    const normal  = slotPos.clone().normalize();

    // App Icon: The logo icon representing the individual app, loaded as a circular canvas texture
    const iconTex = this._circularTexture(appEntry.iconDataUrl);
    
    // --- 3D App Shell Construction (Tactile Squircle with Physical Glass Blur) ---
    // The App Shell is the 3D squircle that sits on the sphere representing each linked app.
    // It is a dark, premium frosted glassmorphic squircle with rounded corners and beveled edges.
    
    // 1. Create beveled squircle 2D shape & 3D geometry
    const w = NODE_R * 2.0;
    const h = NODE_R * 2.0;
    const radius = NODE_R * 0.45; // Smooth corner radius (iOS squircle aesthetic)
    const shape = new THREE.Shape();
    
    // Centered rounded rectangle path coordinates
    const x0 = -w / 2;
    const y0 = -h / 2;
    shape.moveTo(x0, y0 + radius);
    shape.lineTo(x0, y0 + h - radius);
    shape.quadraticCurveTo(x0, y0 + h, x0 + radius, y0 + h);
    shape.lineTo(x0 + w - radius, y0 + h);
    shape.quadraticCurveTo(x0 + w, y0 + h, x0 + w, y0 + h - radius);
    shape.lineTo(x0 + w, y0 + radius);
    shape.quadraticCurveTo(x0 + w, y0, x0 + w - radius, y0);
    shape.lineTo(x0 + radius, y0);
    shape.quadraticCurveTo(x0, y0, x0, y0 + radius);
    
    // Extrusion settings, scaled down 20% along with NODE_R for perfect depth proportions
    const extrudeSettings = {
      depth: 0.02,             // Shortened by 50%
      bevelEnabled: true,      // Rounded front/back edges
      bevelSegments: 6,        // Premium high-fidelity rounding
      steps: 1,
      bevelSize: 0.014,        // Shortened by 50%
      bevelThickness: 0.014,   // Shortened by 50%
      curveSegments: 24        // Extremely smooth corner curvature
    };
    
    const squircleGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    squircleGeo.center();      // Center geometry around (0,0,0)
    
    // 2. High-end glassmorphic physical dark shader material
    // Overriding standard transmission to blur transparent grid lines/glowing core
    const shellMat = new THREE.ShaderMaterial({
      uniforms: {
        uBlurTexture: { value: this.blurTarget ? this.blurTarget.texture : null },
        uColor: { value: new THREE.Color(0x000000) },
        uRoughness: { value: 0.6 },
        uMetalness: { value: 0.1 },
        uOpacity: { value: 0.8 }
      },
      vertexShader: `
        varying vec4 vScreenPos;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPosition = -mvPosition.xyz;
          vNormal = normalize(normalMatrix * normal);
          vScreenPos = projectionMatrix * mvPosition;
          gl_Position = vScreenPos;
        }
      `,
      fragmentShader: `
        varying vec4 vScreenPos;
        varying vec3 vNormal;
        varying vec3 vViewPosition;

        uniform sampler2D uBlurTexture;
        uniform vec3 uColor;
        uniform float uRoughness;
        uniform float uMetalness;
        uniform float uOpacity;

        void main() {
          // Calculate screen-space coordinates
          vec2 screenUv = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;

          // Add realistic screen-space refraction based on normal vector
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          vec2 offset = normal.xy * 0.032; // Glass refractive distortion factor

          // Multi-tap weighted blur kernel to achieve silky-smooth frosting
          vec4 blurredSample = vec4(0.0);
          float totalWeight = 0.0;
          const int blurRadius = 2;
          const float stepSize = 0.0035;

          for (int x = -blurRadius; x <= blurRadius; x++) {
            for (int y = -blurRadius; y <= blurRadius; y++) {
              float weight = 1.0 - (length(vec2(x, y)) / (float(blurRadius) + 1.0));
              vec2 sampleUv = screenUv + offset + vec2(float(x), float(y)) * stepSize;
              
              sampleUv = clamp(sampleUv, 0.001, 0.999);
              blurredSample += texture2D(uBlurTexture, sampleUv) * weight;
              totalWeight += weight;
            }
          }
          blurredSample /= totalWeight;

          // Tint and Blend (Black color at 0.8 opacity)
          vec3 finalRgb = mix(blurredSample.rgb, uColor, uOpacity);
          float finalAlpha = max(uOpacity, blurredSample.a * uOpacity);

          // Blinn-Phong Specular Reflection for the premium tactile satin-matte look
          vec3 lightDir = normalize(vec3(-3.0, 5.0, 3.0));
          vec3 halfDir = normalize(lightDir + viewDir);

          float specPower = mix(120.0, 6.0, uRoughness);
          float specIntensity = mix(0.15, 0.75, uMetalness);
          float spec = pow(max(dot(normal, halfDir), 0.0), specPower) * specIntensity;

          finalRgb += vec3(spec);

          gl_FragColor = vec4(finalRgb, finalAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    const shellMesh = new THREE.Mesh(squircleGeo, shellMat);
    shellMesh.userData = { appEntry, slot }; // For raycaster hit metadata mapping
    
    // Backwards compatible reference so we don't break raycaster:
    const disc = shellMesh;

    // 3. Suspended Flat Logo Plane (App Icon) sitting perfectly on the front face of the squircle
    // Sized slightly smaller than the squircle shell for an elegant inset
    const logoGeo = new THREE.PlaneGeometry(NODE_R * 1.8, NODE_R * 1.8);
    const logoMat = new THREE.MeshBasicMaterial({
      map: iconTex,
      transparent: true,
      depthWrite: false
    });
    const logoMesh = new THREE.Mesh(logoGeo, logoMat);
    // Positioned flat on the front of the beveled squircle (depth/2 + bevel = 0.01 + 0.014 = 0.024)
    // Placed at z = 0.026 to sit exactly 0.002 units in front of the beveled face, staying sharp and legible
    logoMesh.position.z = 0.026;
    
    const iconMat = logoMat; // Backwards compatible mapping

    // 4. Custom 3D organic bubbling/rippling highlight sphere (positioned inside the shell behind the app icon)
    const rippleGeo = new THREE.SphereGeometry(NODE_R * 0.95, 32, 16);
    const rippleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHoverProgress: { value: 0 },
        uFocusedProgress: { value: 0 },
        uThemeColor: { value: this._accentColor.clone() }
      },
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vLocalNormal;
        varying vec3 vViewPosition;
        varying float vNoise;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vLocalNormal = normal; // Pass local normal to lock the gradient to the center of the app shell
          vViewPosition = -mvPosition.xyz;

          // Warp coordinate lookup with dynamic low-frequency sines to add natural organic swirling distortion
          vec3 warpedPos = position + vec3(
            sin(position.y * 10.0 + uTime * 1.5),
            cos(position.z * 10.0 + uTime * 1.2),
            sin(position.x * 10.0 + uTime * 1.7)
          ) * 0.05;

          // Composite wave for a premium "bubbling noise" effect
          float wave1 = sin(warpedPos.x * 15.0 + uTime * 3.0) * 
                        cos(warpedPos.y * 15.0 + uTime * 2.0) * 0.012;
          float wave2 = sin(warpedPos.z * 30.0 - uTime * 5.0) * 
                        cos(warpedPos.x * 30.0 + uTime * 4.0) * 0.004;
          float wave = wave1 + wave2;

          vNoise = wave; // Pass displacement to fragment shader for peak coloring

          vec3 displacedPosition = position + normal * wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vLocalNormal;
        varying vec3 vViewPosition;
        varying float vNoise;
        uniform float uTime;
        uniform float uHoverProgress;
        uniform float uFocusedProgress;
        uniform vec3 uThemeColor;

        void main() {
          float activeProgress = max(uHoverProgress, uFocusedProgress);
          if (activeProgress < 0.001) {
            discard;
          }

          // Use the local normal's Z component for a perfectly centered, camera-independent radial gradient
          float rim = max(0.0, normalize(vLocalNormal).z);

          // Base highlight color: white for hover, uThemeColor for focus/background
          vec3 targetColor = mix(vec3(1.0, 1.0, 1.0), uThemeColor, uFocusedProgress);

          // Volumetric noise-based inner core coloring for glowing organic energy feel
          float noiseFactor = smoothstep(-0.008, 0.012, vNoise);
          // Reduced contrast between dark and light for a softer, more subtle bubbling effect
          vec3 baseColor = mix(targetColor * 0.85, targetColor * 1.0, noiseFactor);

          // Spread the gradient across the ENTIRE sphere so it stays massive and soft
          float alpha = smoothstep(0.0, 1.0, rim) * 0.85 * activeProgress;

          if (alpha < 0.01) {
            discard;
          }

          gl_FragColor = vec4(baseColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });
    // Increased the sphere radius from 0.95 to 1.1 so it creates a nice halo peeking out from solid icons
    const rippleMesh = new THREE.Mesh(new THREE.SphereGeometry(NODE_R * 1.1, 32, 16), rippleMat);
    rippleMesh.scale.set(1.0, 1.0, 0.14); // Squash it slightly to form a neat bubble
    rippleMesh.position.set(0, 0, 0.024); // Placed exactly on the front face of the squircle shell

    const nodeGroup = new THREE.Group();
    // Add components to nodeGroup
    nodeGroup.add(shellMesh, logoMesh, rippleMesh);

    // Outer glow plane — locked to node orientation
    const glowMat = new THREE.MeshBasicMaterial({
      map: this._glowTex,
      color: this._accentColor.clone(),
      transparent: true,
      opacity: 0,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      glowMat
    );
    glow.scale.set(NODE_R * 3.5, NODE_R * 3.5, 1);
    glow.position.z = -0.010; // slightly behind the back face
    nodeGroup.add(glow);

    // Assign explicit rendering orders to guarantee correct layer sorting:
    glow.renderOrder = 8;
    shellMesh.renderOrder = 10;
    rippleMesh.renderOrder = 11; // Drawn ON TOP of the shell, so it isn't hidden by the background blur
    logoMesh.renderOrder = 12;   // Drawn ON TOP of the ripple sphere

    // Position nodeGroup slightly away from center
    nodeGroup.position.copy(normal.clone().multiplyScalar(SPHERE_RADIUS + 0.03));
    nodeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    this.group.add(nodeGroup);
    const normalizedEntry = {
      repoName:    repoName,
      pagesUrl:    appEntry.pagesUrl || appEntry.pages,
      iconDataUrl: appEntry.iconDataUrl || appEntry.icon,
      description: appEntry.description || appEntry.desc || ''
    };

    this.nodes.set(repoName, {
      nodeGroup, disc, iconMat, iconTex, appEntry: normalizedEntry, slot, glowMat,
      glowSprite: glow, rippleMat,
      targetScale: 1, targetGlow: 0,
      slotNormal: normal.clone()
    });
  }

  removeNode(repoName) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    this.group.remove(entry.nodeGroup);
    const disposedGeos = new Set();
    entry.nodeGroup.traverse(child => {
      if (child.isMesh) {
        if (child.geometry && !disposedGeos.has(child.geometry)) {
          child.geometry.dispose();
          disposedGeos.add(child.geometry);
        }
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
    this.usedSlots.delete(entry.slot);
    this.nodes.delete(repoName);
  }

  updateNodeIcon(repoName, iconDataUrl) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    const oldTex = entry.iconTex;
    const newTex = this._circularTexture(iconDataUrl);
    entry.iconMat.map = newTex;
    entry.iconMat.needsUpdate = true;
    entry.iconTex = newTex;
    if (oldTex) oldTex.dispose();
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  _bindEvents() {
    const el = this.canvas;

    this._upBound   = () => this._up();
    this._moveBound = (e) => this._move(e.clientX, e.clientY);
    this._resizeBound = this._resize.bind(this);

    el.addEventListener('mousedown',  e => this._down(e.clientX, e.clientY));
    window.addEventListener('mousemove',  this._moveBound);
    window.addEventListener('mouseup',   this._upBound);
    el.addEventListener('click',     e => { if (this._dragDist < 10) this._click(e.clientX, e.clientY); });
    el.addEventListener('mousemove', e => this._hover(e.clientX, e.clientY));

    // Mouse Wheel Zoom
    el.addEventListener('wheel', e => {
      e.preventDefault();
      const zoomSpeed = 0.015;
      this._targetRadius = Math.max(4.0, Math.min(12.0, this._targetRadius + e.deltaY * zoomSpeed));
      this._zoomLastActiveTime = Date.now();
    }, { passive: false });

    el.addEventListener('touchstart', e => { 
      e.preventDefault(); 
      if (e.touches.length === 1) {
        const t = e.touches[0]; 
        this._down(t.clientX, t.clientY); 
      } else if (e.touches.length === 2) {
        this._pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: false });

    el.addEventListener('touchmove',  e => { 
      e.preventDefault(); 
      if (e.touches.length === 1) {
        const t = e.touches[0]; 
        this._move(t.clientX, t.clientY); 
      } else if (e.touches.length === 2) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const diff = d - this._pinchDist;
        this._targetRadius = Math.max(4.0, Math.min(12.0, this._targetRadius - diff * 0.025));
        this._pinchDist = d;
        this._holdCancelled = true;
        this._zoomLastActiveTime = Date.now();
      }
    }, { passive: false });

    el.addEventListener('touchend',   e => {
      e.preventDefault(); this._up();
      if (e.changedTouches.length && this._dragDist < 8 && e.touches.length === 0) {
        const t = e.changedTouches[0]; this._click(t.clientX, t.clientY);
      }
    }, { passive: false });

    window.addEventListener('resize', this._resizeBound);
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.blurTarget) {
      this.blurTarget.setSize(w / 4, h / 4);
    }
  }

  _down(x, y) {
    this._isDragging = true;
    this._prevPtr = { x, y };
    this._ptrPos = { x, y };
    this._velTheta = this._velPhi = this._dragDist = 0;
    this.canvas.style.cursor = 'grabbing';

    // Start long-press timer for zoom lock
    this._isHolding = true;
    this._holdStartTime = Date.now();
    this._holdCancelled = false;
  }

  _move(x, y) {
    this._ptrPos = { x, y };
    if (!this._isDragging) return;
    const dx = x - this._prevPtr.x;
    const dy = y - this._prevPtr.y;
    const move = Math.hypot(dx, dy);
    this._dragDist += move;

    if (move > 1) this._holdCancelled = true;

    // Horizontal drag → orbit left/right (theta)
    this._theta -= dx * DRAG_SENS;
    // Vertical drag → orbit up/down (phi), clamped away from poles.
    // Subtract dy so dragging UP raises the view (natural globe feel).
    this._phi = Math.max(PHI_MIN, Math.min(PHI_MAX, this._phi - dy * DRAG_SENS));

    // Store velocity for inertia
    this._velTheta = -dx * DRAG_SENS;
    this._velPhi   = -dy * DRAG_SENS;
    this._prevPtr  = { x, y };

    this._updateCamera();
  }

  _up() {
    this._isDragging = false;
    this._isHolding = false;
    this.canvas.style.cursor = 'grab';
    
    // Reset zoom indicator
    if (this._ui.indicator) this._ui.indicator.setAttribute('hidden', '');
  }

  _click(cx, cy) {
    const hitDisc = this._raycast(cx, cy);
    if (hitDisc) {
      this.onNodeClick(hitDisc.userData.appEntry);
    } else {
      this.onNodeClick(null);
    }
  }

  _hover(cx, cy) {
    const hitDisc = this._raycast(cx, cy);
    const hitGroup = hitDisc ? hitDisc.parent : null;

    this.nodes.forEach((entry, repoName) => {
      const isFocused = repoName === this._focusedRepoName;
      if (entry.nodeGroup === hitGroup || isFocused) {
        entry.targetScale = isFocused ? 1.0 : HOVER_SCALE; // Don't scale up too much if focused
        entry.targetGlow = 1;
      } else {
        entry.targetScale = 1;
        entry.targetGlow = 0;
      }
    });

    if (this._hoveredNode && this._hoveredNode !== hitGroup) {
      this._hoveredNode = null;
      if (!this._isDragging) this.canvas.style.cursor = 'grab';
    }
    if (hitGroup) {
      this._hoveredNode = hitGroup;
      this.canvas.style.cursor = 'pointer';
    }
  }

  _raycast(cx, cy) {
    const rect = this.canvas.getBoundingClientRect();
    this._mouse.set(
      ((cx - rect.left) / rect.width)  *  2 - 1,
      ((cy - rect.top)  / rect.height) * -2 + 1
    );
    this._raycaster.setFromCamera(this._mouse, this.camera);
    const discs = [...this.nodes.values()].map(n => n.disc);
    const hits = this._raycaster.intersectObjects(discs);
    return hits.length ? hits[0].object : null;
  }

  // ── Animation Loop ────────────────────────────────────────────────────────

  _animate() {
    this._animId = requestAnimationFrame(() => this._animate());

    if (!this._isDragging) {
      if (this._focusedRepoName !== null && this._targetTheta !== null) {
        // --- Elastic Snap to Focus ---
        const SPRING = 0.045;
        const DAMP   = 0.78;

        // Shortest path for theta
        let dTheta = this._targetTheta - this._theta;
        dTheta = ((dTheta + Math.PI) % (Math.PI * 2)) - Math.PI;

        this._velTheta = (this._velTheta + dTheta * SPRING) * DAMP;
        this._theta += this._velTheta;

        let dPhi = this._targetPhi - this._phi;
        this._velPhi = (this._velPhi + dPhi * SPRING) * DAMP;
        this._phi += this._velPhi;
      } else {
        // --- Normal Inertia / Idle ---
        const speed = Math.hypot(this._velTheta, this._velPhi);
        if (speed > 0.00004) {
          // Inertia coast
          this._theta += this._velTheta;
          this._phi    = Math.max(PHI_MIN, Math.min(PHI_MAX, this._phi + this._velPhi));
          this._velTheta *= INERTIA_DAMP;
          this._velPhi   *= INERTIA_DAMP;
        } else {
          // Idle slow rotation
          this._theta += IDLE_ROT;
          this._velTheta = this._velPhi = 0;
        }
      }
    }

    // --- Zoom Revert & Locking Logic ---
    const REVERT_SPEED = 0.008; // How fast it drifts back to center
    const ZOOM_LERP    = 0.12;  // How fast radius snaps to target
    const now = Date.now();

    const shouldRevert = !this._zoomLocked && 
                         !this._isHolding && 
                         (now - this._zoomLastActiveTime > 5000);

    if (shouldRevert) {
      // Gradually drift back to default distance
      this._targetRadius += (this._defaultRadius - this._targetRadius) * REVERT_SPEED;
    }

    // Smoothly apply radius changes
    this._radius += (this._targetRadius - this._radius) * ZOOM_LERP;
    this._updateCamera();

    // --- Hold-to-Lock Timer ---
    if (this._isHolding && !this._holdCancelled) {
      const elapsed = now - this._holdStartTime;
      const DISPLAY_DELAY = 1000;  // Wait 1s before showing indicator
      const LOCK_TIME     = 2000;  // Ring fills between 1s and 2s

      if (elapsed > DISPLAY_DELAY) {
        const progress = Math.min(1, (elapsed - DISPLAY_DELAY) / (LOCK_TIME - DISPLAY_DELAY));

        if (this._ui.indicator) {
          this._ui.indicator.removeAttribute('hidden');
          this._ui.indicator.style.transform = `translate(${this._ptrPos.x}px, ${this._ptrPos.y}px) translate(-50%, -50%)`;
        }
        if (this._ui.ring) {
          const circumference = 2 * Math.PI * 26; // r=26 from SVG
          this._ui.ring.style.strokeDashoffset = circumference * (1 - progress);
        }

        if (progress >= 1) {
          this._zoomLocked = true;
          this._defaultRadius = this._targetRadius; // Lock current zoom
          if (typeof Store !== 'undefined') {
            Store.saveZoom({ radius: this._defaultRadius, locked: true });
          }
          
          // Visual Feedback
          if (this._ui.indicator) {
            this._ui.indicator.classList.add('locked');
            setTimeout(() => {
                if (this._ui.indicator) {
                  this._ui.indicator.setAttribute('hidden', '');
                  this._ui.indicator.classList.remove('locked');
                }
            }, 600);
          }

          // Blue Double Flash
          if (this._ui.flash) {
            this._ui.flash.removeAttribute('hidden');
            setTimeout(() => { if (this._ui.flash) this._ui.flash.setAttribute('hidden', ''); }, 700);
          }

          this._holdCancelled = true; // Stop processing hold for this touch
        }
      } else {
        if (this._ui.indicator) this._ui.indicator.setAttribute('hidden', '');
      }
    } else {
      if (this._ui.indicator) this._ui.indicator.setAttribute('hidden', '');
    }

    // Update pulse time
    const pTime = performance.now() / 1000;
    if (this._pulseUniforms) {
      this._pulseUniforms.uTime.value = pTime;
    }
    if (this._sphereUniforms) {
      this._sphereUniforms.uPulseTime.value = pTime;
    }
    if (this._edgeUniforms) {
      this._edgeUniforms.uPulseTime.value = pTime;
    }

    // Update core time
    if (this._coreMesh && this._coreMesh.material.uniforms) {
      this._coreMesh.material.uniforms.uTime.value = performance.now() / 1000;
    }

    // Subtle backlight pulse
    const time = performance.now() * 0.0005;
    this._backLight.intensity = 20 + Math.sin(time) * 4;

    // Smooth node animations (scale & glow)
    this.nodes.forEach(entry => {
      // Calculate dynamic physical wave displacement to prevent geodesic panel clipping
      let lift = 0.0;
      if (entry.slotNormal && this._sphereUniforms && this._sphereUniforms.uPulseActive.value > 0.5) {
        const nCent = entry.slotNormal;
        const uPulseOrigin = this._sphereUniforms.uPulseOrigin.value;
        const nOri = uPulseOrigin.clone().normalize();
        const d = Math.acos(Math.max(-1.0, Math.min(1.0, nCent.dot(nOri))));
        
        const period = 2.0;
        const elapsedTime = this._sphereUniforms.uPulseTime.value - this._sphereUniforms.uPulseStartTime.value;
        const tPulse = (elapsedTime % period) / period;
        const wavePos = tPulse * Math.PI * 1.2;
        const width = 0.35;
        
        const smoothstepVal = (edge0, edge1, x) => {
          const t = Math.max(0.0, Math.min(1.0, (x - edge0) / (edge1 - edge0)));
          return t * t * (3.0 - 2.0 * t);
        };
        
        const wave = smoothstepVal(wavePos - width, wavePos, d) * 
                     smoothstepVal(wavePos + width, wavePos, d);
        const edgeFade = 1.0 - tPulse;
        lift = wave * edgeFade * 0.15;
      }
      const targetRadius = SPHERE_RADIUS + 0.03 + lift;
      entry.nodeGroup.position.copy(entry.slotNormal).multiplyScalar(targetRadius);

      // Lerp scale
      const curS = entry.nodeGroup.scale.x;
      const targetBaseScale = (window.GlobalIconScale || 1.0) * entry.targetScale;
      const nextS = curS + (targetBaseScale - curS) * LERP_SPEED;
      entry.nodeGroup.scale.setScalar(nextS);

      // Lerp glow opacity
      let targetO = entry.targetGlow;

      const curO = entry.glowMat.opacity;
      const nextO = curO + (targetO - curO) * LERP_SPEED;
      entry.glowMat.opacity = nextO;

      // Reset scale logic to normal scale (no special scale up for backgrounded glow sprite)
      const tGlowS = NODE_R * 3.5;
      const curGlowS = entry.glowSprite.scale.x;
      const nextGlowS = curGlowS + (tGlowS - curGlowS) * LERP_SPEED;
      entry.glowSprite.scale.set(nextGlowS, nextGlowS, 1);
      
      // Lerp custom rippling shader outline uniforms
      if (entry.rippleMat) {
        const isHovered = (this._hoveredNode === entry.nodeGroup);
        const isFocused = (entry.appEntry.repoName === this._focusedRepoName);
        const isBackground = entry.isBackground === true;

        // If focused or running in the background, we trigger the colored/green ripple
        const targetFocused = (isFocused || isBackground) ? 1.0 : 0.0;
        // If hovered and NOT focused/backgrounded, we trigger the white hover ripple
        const targetHover = (isHovered && !isFocused && !isBackground) ? 1.0 : 0.0;

        entry.rippleMat.uniforms.uHoverProgress.value += (targetHover - entry.rippleMat.uniforms.uHoverProgress.value) * LERP_SPEED;
        entry.rippleMat.uniforms.uFocusedProgress.value += (targetFocused - entry.rippleMat.uniforms.uFocusedProgress.value) * LERP_SPEED;
        entry.rippleMat.uniforms.uTime.value = performance.now() / 1000;

        // Color selection: pulsing green for background syncing, active theme accent color otherwise
        if (isBackground) {
          entry.rippleMat.uniforms.uThemeColor.value.set(0x22ff88);
        } else {
          entry.rippleMat.uniforms.uThemeColor.value.copy(this._accentColor);
        }
      }
    });

    // 1. Temporarily hide app node groups to draw background components alone
    this.nodes.forEach(node => {
      node.nodeGroup.visible = false;
    });

    // 2. Render background to downscaled offscreen buffer
    if (this.blurTarget) {
      this.renderer.setRenderTarget(this.blurTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
    }

    // 3. Make node groups visible again
    this.nodes.forEach(node => {
      node.nodeGroup.visible = true;
    });

    // 4. Render the full interactive scene with blurred dark squircles
    this.renderer.render(this.scene, this.camera);
  }

  setNodeBackground(repoName, isBackground) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    entry.isBackground = isBackground;
    // Reset glow color to dynamic theme accent and set target opacity to 0
    entry.glowMat.color.copy(this._accentColor);
    entry.targetGlow = 0;
  }

  updateAccentColor(hex) {
    try {
      const theme = document.documentElement.getAttribute('data-theme') || 'blue';
      const THEME_ACCENTS = {
        'blue': '#1243b5',
        'white': '#1a5ecc',
        'red': '#b71414',
        'green': '#1ab256',
        'purple': '#6c25be',
        'gold': '#bc800f',
        'black-white': '#686868',
        'blue-gold': '#1243b5',
        'red-gold': '#b71414',
        'brown-blue': '#c8ad93',
        'black-red': '#222222'
      };

      const themeHex = THEME_ACCENTS[theme] || hex || '#1243b5';
      const color = new THREE.Color(themeHex);
      this._accentColor.copy(color);
      
      const isLightMode = (theme === 'white');

      // Use the gold theme color (#bc800f) for core and backing interior in the hybrid themes, otherwise fall back to theme color
      let coreAndInteriorColor = isLightMode ? new THREE.Color('#1243b5') : color;
      if (theme === 'blue-gold' || theme === 'red-gold') {
        coreAndInteriorColor = new THREE.Color('#bc800f');
      } else if (theme === 'brown-blue') {
        coreAndInteriorColor = new THREE.Color('#1243b5');
      } else if (theme === 'black-red') {
        coreAndInteriorColor = new THREE.Color('#b71414');
      }

      // Update global lights for shadow color
      if (this._ambientLight) {
        this._ambientLight.color.setHex(isLightMode ? 0x5a6a8a : 0x2a2d3a);
        this._ambientLight.intensity = isLightMode ? 1.2 : 1.2;
      }
      if (this._fillLight) {
        this._fillLight.color.setHex(isLightMode ? 0x7080aa : 0x7080aa);
        this._fillLight.intensity = isLightMode ? 0.4 : 0.3;
      }

      // 1. Backlight
      if (this._backLight) {
        if (isLightMode) {
          const backColor = color.clone().lerp(new THREE.Color(0xffffff), 0.3);
          this._backLight.color.copy(backColor);
        } else {
          this._backLight.color.copy(color);
        }
      }
      
      // 2. Pulse shell
      if (this._pulseUniforms && this._pulseUniforms.uColor) {
        this._pulseUniforms.uColor.value.copy(color);
      }
      
      // 3. Sphere base color
      if (this._sphereMesh && this._sphereMesh.material) {
        if (isLightMode) {
          this._sphereMesh.material.color.set(0xffffff);
        } else {
          this._sphereMesh.material.color.copy(color);
        }
      }

      // 3b. Sphere interior color
      if (this._sphereInteriorMesh && this._sphereInteriorMesh.material) {
        const lightColor = coreAndInteriorColor.clone().lerp(new THREE.Color(0xffffff), 0.4);
        this._sphereInteriorMesh.material.color.copy(lightColor);
      }
      
      // 4. Edges
      if (this._edgeLines && this._edgeLines.material && this._edgeLines.material.uniforms && this._edgeLines.material.uniforms.uColor) {
        this._edgeLines.material.uniforms.uColor.value.copy(color);
      }

      // 6. Halo and Corona Canvas Dynamic Gradient Re-draw
      const coreHex = '#' + coreAndInteriorColor.getHexString();
      this._updateEclipseGlowTextures(coreHex);

      // 7. Existing node glows
      if (this.nodes) {
        this.nodes.forEach(entry => {
          if (entry && entry.glowMat) {
            entry.glowMat.color.copy(color);
          }
        });
      }

      // 8. Core dynamic colors
      if (this._coreUniforms) {
        if (this._coreUniforms.uDarkColor && this._coreUniforms.uDarkColor.value) {
          this._coreUniforms.uDarkColor.value.copy(coreAndInteriorColor).multiplyScalar(0.015);
        }
        if (this._coreUniforms.uLightColor && this._coreUniforms.uLightColor.value) {
          this._coreAndLightColor = coreAndInteriorColor.clone().lerp(new THREE.Color(0xffffff), 0.4);
          this._coreUniforms.uLightColor.value.copy(this._coreAndLightColor);
        }
      }

      // 9. Core outer glow
      if (this._coreGlowMesh && this._coreGlowMesh.material && this._coreGlowMesh.material.uniforms) {
        if (this._coreGlowMesh.material.uniforms.uGlowColor && this._coreGlowMesh.material.uniforms.uGlowColor.value) {
          this._coreGlowMesh.material.uniforms.uGlowColor.value.copy(coreAndInteriorColor);
        }
        if (this._coreGlowMesh.material.uniforms.uCenterColor && this._coreGlowMesh.material.uniforms.uCenterColor.value) {
          this._coreGlowMesh.material.uniforms.uCenterColor.value.copy(coreAndInteriorColor).lerp(new THREE.Color(0xffffff), 0.4);
        }
      }
    } catch (err) {
      console.error("Error in updateAccentColor:", err);
    }
  }

  _addInnerCore() {
    // The core is a soft, organic white-blue glowing ball with a dynamic bubbling noise effect
    const coreGeo = new THREE.SphereGeometry(1.2, 32, 32);
    this._coreUniforms = {
      uTime:       { value: 0 },
      uDarkColor:  { value: this._accentColor.clone().multiplyScalar(0.015) },
      uLightColor: { value: this._accentColor.clone().lerp(new THREE.Color(0xffffff), 0.4) }
    };
    const coreMat = new THREE.ShaderMaterial({
      uniforms: this._coreUniforms,
      vertexShader: `
        uniform float uTime;
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying float vNoise;

        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewPosition = -mvPosition.xyz;

          // Warp coordinate lookup with dynamic low-frequency sines to add natural organic swirling distortion
          vec3 warpedPos = position + vec3(
            sin(position.y * 1.8 + uTime * 0.8),
            cos(position.z * 1.8 + uTime * 0.7),
            sin(position.x * 1.8 + uTime * 0.9)
          ) * 0.22;

          // Composite wave for a premium "bubbling noise" effect
          // Scale is made larger by reducing frequency multiplier (2.2 and 5.5 instead of 4.0 and 10.0)
          float wave1 = sin(warpedPos.x * 2.2 + uTime * 1.6) * 
                        cos(warpedPos.y * 2.2 + uTime * 1.2) * 0.042;
          float wave2 = sin(warpedPos.z * 5.5 - uTime * 2.8) * 
                        cos(warpedPos.x * 5.5 + uTime * 2.2) * 0.016;
          float wave = wave1 + wave2;

          vNoise = wave; // Pass displacement to fragment shader for peak coloring

          vec3 displacedPosition = position + normal * wave;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(displacedPosition, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        varying float vNoise;
        uniform float uTime;
        uniform vec3 uDarkColor;
        uniform vec3 uLightColor;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);

          // Soft spherical glow falloff - widened to make the edge extremely soft and fuzzy
          float rim = max(0.0, dot(normal, viewDir));

          // Map vNoise (roughly -0.045 to +0.045) to a [0.0, 1.0] range
          float colorMix = smoothstep(-0.02, 0.028, vNoise);
          vec3 baseColor = mix(uDarkColor, uLightColor, colorMix);

          // Subtle constant energy flicker
          float brightness = 1.0 + sin(uTime * 18.0) * 0.05;

          // Super soft, fuzzy fading edge
          float alpha = smoothstep(0.0, 0.45, rim) * 0.92 * brightness;

          gl_FragColor = vec4(baseColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this._coreMesh = new THREE.Mesh(coreGeo, coreMat);
    this.group.add(this._coreMesh);

    // Soft, volumetric Fresnel glow around the inner core with a seamless falloff
    // Transitions from theme accent color at the outer edges to white closest to the core
    const glowGeo = new THREE.SphereGeometry(1.5, 32, 32);
    const glowMat = new THREE.ShaderMaterial({
      uniforms: {
        uGlowColor: { value: this._accentColor.clone() },
        uCenterColor: { value: this._accentColor.clone().lerp(new THREE.Color(0xffffff), 0.4) },
        uGlowPower: { value: 1.5 },
        uGlowMultiplier: { value: 0.8 }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalize(normalMatrix * normal);
          vViewPosition = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vViewPosition;
        uniform vec3 uGlowColor;
        uniform vec3 uCenterColor;
        uniform float uGlowPower;
        uniform float uGlowMultiplier;

        void main() {
          vec3 normal = normalize(vNormal);
          vec3 viewDir = normalize(vViewPosition);
          
          float rim = max(0.0, dot(normal, viewDir));
          
          // Color transitions from theme color at the edges to a premium soft light blue near the center core
          float colorBlend = smoothstep(0.4, 0.85, rim);
          vec3 finalColor = mix(uGlowColor, uCenterColor, colorBlend);
          
          // Opacity peaks in the center (meeting the core) and fades out smoothly to the edges
          float alpha = pow(rim, uGlowPower) * uGlowMultiplier;
          
          gl_FragColor = vec4(finalColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    this._coreGlowMesh = new THREE.Mesh(glowGeo, glowMat);
    this.group.add(this._coreGlowMesh);
  }

  lockFocus(repoName) {
    this._isLocked = true;
    this.setFocusedNode(repoName);
  }

  unlockFocus() {
    this._isLocked = false;
    this.clearFocusedNode();
  }

  // Point the camera directly at a linked node by repo name.
  focusNode(repoName) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    const norm = entry.nodeGroup.position.clone().normalize();
    this._phi   = Math.acos(Math.max(-1, Math.min(1, norm.y)));
    this._theta = Math.atan2(norm.x, norm.z);
    this._velTheta = this._velPhi = 0;
    this._updateCamera();
  }

  setFocusedNode(repoName) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    const norm = entry.nodeGroup.position.clone().normalize();
    this._targetPhi   = Math.acos(Math.max(-1, Math.min(1, norm.y)));
    
    // Shortest-path theta wrapping
    let targetTheta = Math.atan2(norm.x, norm.z);
    let diff = targetTheta - this._theta;
    while (diff < -Math.PI) { targetTheta += 2 * Math.PI; diff = targetTheta - this._theta; }
    while (diff >  Math.PI) { targetTheta -= 2 * Math.PI; diff = targetTheta - this._theta; }
    this._targetTheta = targetTheta;

    this._focusedRepoName = repoName;

    const now = performance.now() / 1000;
    if (this._pulseUniforms) {
      this._pulseUniforms.uActive.value = 1.0;
      this._pulseUniforms.uOrigin.value.copy(entry.nodeGroup.position);
      this._pulseUniforms.uStartTime.value = now;
    }
    if (this._sphereUniforms) {
      this._sphereUniforms.uPulseActive.value = 1.0;
      this._sphereUniforms.uPulseOrigin.value.copy(entry.nodeGroup.position);
      this._sphereUniforms.uPulseStartTime.value = now;
    }
    if (this._edgeUniforms) {
      this._edgeUniforms.uPulseActive.value = 1.0;
      this._edgeUniforms.uPulseOrigin.value.copy(entry.nodeGroup.position);
      this._edgeUniforms.uPulseStartTime.value = now;
    }
  }

  clearFocusedNode() {
    if (this._isLocked) return;
    this._focusedRepoName = null;
    this._targetTheta = null;
    this._targetPhi = null;

    if (this._pulseUniforms) {
      this._pulseUniforms.uActive.value = 0.0;
    }
    if (this._sphereUniforms) {
      this._sphereUniforms.uPulseActive.value = 0.0;
    }
    if (this._edgeUniforms) {
      this._edgeUniforms.uPulseActive.value = 0.0;
    }
  }

  destroy() {
    cancelAnimationFrame(this._animId);
    
    // Unbind window events
    window.removeEventListener('mousemove', this._moveBound);
    window.removeEventListener('mouseup',   this._upBound);
    window.removeEventListener('resize',    this._resizeBound);

    if (this.blurTarget) {
      this.blurTarget.dispose();
    }
    this.renderer.dispose();
    this.scene.traverse(child => {
      if (child.isMesh || child.isLine || child.isSprite) {
        child.geometry?.dispose();
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(m => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      }
    });
  }
}

window.PanopticonSphere = PanopticonSphere;
