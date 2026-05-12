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
const NODE_R        = 0.20;  // Badge radius (circle)
const NODE_H        = 0.065; // Badge thickness
const BEVEL_TUBE    = 0.013; // Bevel torus tube radius
const HOVER_SCALE   = 1.12;  // Subtle scale-up on hover
const LERP_SPEED    = 0.14;  // Animation smoothness
const PHI_MIN       = 0.15;   // Clamp away from poles (~8.6°)
const PHI_MAX       = Math.PI - 0.15;

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
  return raw
    .filter(p => Math.abs(p.y) <= poleExclude)
    .sort((a, b) => Math.abs(a.y) - Math.abs(b.y));
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

    // Zoom state
    // Zoom state
    const savedZoom = initialZoom || {};
    this._radius         = (typeof savedZoom.radius === 'number') ? savedZoom.radius : CAM_RADIUS;
    this._targetRadius   = this._radius;
    this._defaultRadius  = this._radius;
    this._zoomLocked     = savedZoom ? savedZoom.locked : false;
    
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

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 200);
    this._updateCamera(); // set initial position

    // ── Lighting ────────────────────────────────────────────────────────────
    // Attach lights to the camera so sphere shading stays consistent
    // from every viewing angle. Must add camera to scene for this to work.
    this.scene.add(this.camera);

    // Soft ambient base — reduced for better icon legibility
    this.scene.add(new THREE.AmbientLight(0x2a2d3a, 1.2));

    // Key light: soft, slightly above-left in camera space
    const keyLight = new THREE.DirectionalLight(0xc8d4f0, 0.9);
    keyLight.position.set(-3, 5, 3); // camera-relative
    this.camera.add(keyLight);

    // Fill light: low intensity from below-right to soften shadows
    const fillLight = new THREE.DirectionalLight(0x7080aa, 0.3);
    fillLight.position.set(4, -3, 2);
    this.camera.add(fillLight);

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
    this._addInnerGlow();
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
  }

  // ── Eclipse Halo ─────────────────────────────────────────────────────────

  _addEclipseHalo() {
    const c1 = document.createElement('canvas');
    c1.width = c1.height = 512;
    const x1 = c1.getContext('2d');
    const g1 = x1.createRadialGradient(256, 256, 30, 256, 256, 256);
    g1.addColorStop(0,    'rgba(80,150,255,0.9)');
    g1.addColorStop(0.18, 'rgba(60,110,240,0.55)');
    g1.addColorStop(0.42, 'rgba(30,70,190,0.22)');
    g1.addColorStop(0.70, 'rgba(10,30,120,0.08)');
    g1.addColorStop(1,    'rgba(0,0,0,0)');
    x1.fillStyle = g1; x1.fillRect(0, 0, 512, 512);

    this._haloMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(21.6, 21.6),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c1),
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.scene.add(this._haloMesh);

    const c2 = document.createElement('canvas');
    c2.width = c2.height = 512;
    const x2 = c2.getContext('2d');
    const g2 = x2.createRadialGradient(256, 256, 80, 256, 256, 256);
    g2.addColorStop(0,    'rgba(0,0,0,0)');
    g2.addColorStop(0.60, 'rgba(40,100,255,0.0)');
    g2.addColorStop(0.72, 'rgba(80,160,255,0.45)');
    g2.addColorStop(0.84, 'rgba(120,180,255,0.15)');
    g2.addColorStop(1,    'rgba(0,0,0,0)');
    x2.fillStyle = g2; x2.fillRect(0, 0, 512, 512);

    this._coronaMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(11.6, 11.6),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(c2),
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.scene.add(this._coronaMesh);
  }

  _initGlowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0,   'rgba(80,150,255,0.7)');
    g.addColorStop(0.4, 'rgba(60,120,255,0.3)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    this._glowTex = new THREE.CanvasTexture(c);
  }

  // ── Sphere Geometry ───────────────────────────────────────────────────────

  _addSphere() {
    // Diffuse obsidian-like material: dark gray, matte, minimal metalness.
    // High roughness = spread, soft light response with no harsh reflections.
    const mat = new THREE.MeshStandardMaterial({
      color:    0x1c1c24,   // very dark blue-gray (truer to obsidian than pure black)
      roughness: 0.82,      // mostly diffuse — soft, stone-like shading
      metalness: 0.04,      // nearly zero — avoids mirror-like highlights
    });
    this._sphereMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(SPHERE_RADIUS, DETAIL), mat);
    this.group.add(this._sphereMesh);
  }

  _addEdges() {
    const edges = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(SPHERE_RADIUS + 0.004, DETAIL));
    const mat   = new THREE.LineBasicMaterial({ color: 0x4a6eaa, transparent: true, opacity: 0.32 });
    this.group.add(new THREE.LineSegments(edges, mat));
  }

  _addPulseShell() {
    this._pulseUniforms = {
      uTime:   { value: 0 },
      uOrigin: { value: new THREE.Vector3(0, 1, 0) },
      uActive: { value: 0.0 },
      uColor:  { value: new THREE.Color(0x50aaff) }
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this._pulseUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vPos;
        void main() {
          vPos = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
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
          float t = mod(uTime, period) / period;
          
          // The wave front travels from 0 to PI (opposite pole)
          float wavePos = t * 3.14159 * 1.2;
          float width = 0.35;
          
          float wave = smoothstep(wavePos - width, wavePos, d) * 
                       smoothstep(wavePos + width, wavePos, d);
          
          // Stronger at start, fades at end
          float edgeFade = 1.0 - t;
          float alpha = wave * edgeFade * 0.22;
          
          gl_FragColor = vec4(uColor, alpha);
        }
      `
    });

    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(SPHERE_RADIUS + 0.015, DETAIL), mat);
    this.group.add(shell);
  }

  _addInnerGlow() {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1a2a50, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    this.group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(SPHERE_RADIUS * 0.96, 2), mat));
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
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      tex.needsUpdate = true;
    };
    img.src = iconDataUrl;
    return tex;
  }

  addNode(appEntry) {
    if (this.nodes.has(appEntry.repoName)) this.removeNode(appEntry.repoName);

    let slot = 0;
    while (this.usedSlots.has(slot) && slot < this._slotPositions.length) slot++;
    this.usedSlots.add(slot);

    const slotPos = this._slotPositions[slot % this._slotPositions.length];
    const normal  = slotPos.clone().normalize();

    const iconTex = this._circularTexture(appEntry.iconDataUrl);
    const iconMat = new THREE.MeshStandardMaterial({ map: iconTex, roughness: 0.55, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x22222c, roughness: 0.75, metalness: 0.15 });
    const bevelMat = new THREE.MeshStandardMaterial({ color: 0x2e2e3c, roughness: 0.55, metalness: 0.25 });

    // Round disc: CylinderGeometry rotated so top cap (+Y→+Z) shows icon
    // CylinderGeometry groups: [lateral(0), topCap(1), bottomCap(2)]
    const discGeo = new THREE.CylinderGeometry(NODE_R, NODE_R, NODE_H, 32, 1, false);
    discGeo.rotateX(Math.PI / 2); // top cap now faces local +Z
    discGeo.rotateZ(Math.PI / 2); // Rotate 90deg CCW to correct icon orientation
    const disc = new THREE.Mesh(discGeo, [darkMat, iconMat, darkMat]);
    disc.userData = { appEntry, slot }; // for raycasting

    // Bevel torus rings the front edge
    const bevelGeo = new THREE.TorusGeometry(NODE_R, BEVEL_TUBE, 8, 32);
    const bevel = new THREE.Mesh(bevelGeo, bevelMat);
    bevel.position.z = NODE_H / 2; // sit at front face edge

    const nodeGroup = new THREE.Group();
    nodeGroup.add(disc, bevel);

    // Outer glow sprite (hidden by default)
    const glowMat = new THREE.SpriteMaterial({
      map: this._glowTex,
      color: 0x4f8ef7,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(NODE_R * 3.5, NODE_R * 3.5, 1);
    glow.position.z = -0.02; // slightly behind the disc
    nodeGroup.add(glow);

    nodeGroup.position.copy(normal.clone().multiplyScalar(SPHERE_RADIUS + NODE_H / 2 + 0.06));
    nodeGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);

    this.group.add(nodeGroup);
    this.nodes.set(appEntry.repoName, {
      nodeGroup, disc, iconMat, iconTex, appEntry, slot, glowMat,
      glowSprite: glow,
      targetScale: 1, targetGlow: 0
    });
  }

  removeNode(repoName) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    this.group.remove(entry.nodeGroup);
    entry.nodeGroup.traverse(child => {
      if (child.isMesh) {
        child.geometry.dispose();
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

    this._upBound   = this._up.bind(this);
    this._moveBound = this._move.bind(this);
    this._resizeBound = this._resize.bind(this);

    el.addEventListener('mousedown',  e => this._down(e.clientX, e.clientY));
    window.addEventListener('mousemove',  this._moveBound);
    window.addEventListener('mouseup',   this._upBound);
    el.addEventListener('click',     e => { if (this._dragDist < 5) this._click(e.clientX, e.clientY); });
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

    if (move > 10) this._holdCancelled = true;

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
    if (hitDisc) this.onNodeClick(hitDisc.userData.appEntry);
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
      const DISPLAY_DELAY = 500;  // Don't show indicator for first 0.5s
      const LOCK_TIME     = 1500; // Total time to lock (faster now!)

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
            this._ui.indicator.querySelector('.zoom-indicator-text').textContent = 'LOCKED';
            setTimeout(() => {
                if (this._ui.indicator) {
                  this._ui.indicator.setAttribute('hidden', '');
                  this._ui.indicator.classList.remove('locked');
                }
            }, 800);
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
    if (this._pulseUniforms) {
      this._pulseUniforms.uTime.value = performance.now() / 1000;
    }

    // Subtle backlight pulse
    const time = performance.now() * 0.0005;
    this._backLight.intensity = 20 + Math.sin(time) * 4;

    // Smooth node animations (scale & glow)
    this.nodes.forEach(entry => {
      // Lerp scale
      const curS = entry.nodeGroup.scale.x;
      const nextS = curS + (entry.targetScale - curS) * LERP_SPEED;
      entry.nodeGroup.scale.setScalar(nextS);

      // Lerp glow opacity
      let targetO = entry.targetGlow;
      if (entry.isBackground) {
        // More prominent pulse: 0.3 to 1.0 opacity
        targetO = 0.65 + Math.sin(now * 0.004) * 0.35;
      }

      const curO = entry.glowMat.opacity;
      const nextO = curO + (targetO - curO) * LERP_SPEED;
      entry.glowMat.opacity = nextO;

      // Also slightly scale up the glow if backgrounded
      const tGlowS = entry.isBackground ? (NODE_R * 4.2) : (NODE_R * 3.5);
      const curGlowS = entry.glowSprite.scale.x;
      const nextGlowS = curGlowS + (tGlowS - curGlowS) * LERP_SPEED;
      entry.glowSprite.scale.set(nextGlowS, nextGlowS, 1);
    });

    this.renderer.render(this.scene, this.camera);
  }

  setNodeBackground(repoName, isBackground) {
    const entry = this.nodes.get(repoName);
    if (!entry) return;
    entry.isBackground = isBackground;
    if (isBackground) {
      entry.glowMat.color.set(0x22ff88); // Pulsing green
    } else {
      entry.glowMat.color.set(0x4f8ef7); // Back to blue
      entry.targetGlow = 0;
    }
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

    if (this._pulseUniforms) {
      this._pulseUniforms.uActive.value = 1.0;
      this._pulseUniforms.uOrigin.value.copy(entry.nodeGroup.position);
    }
  }

  clearFocusedNode() {
    this._focusedRepoName = null;
    this._targetTheta = null;
    this._targetPhi = null;

    if (this._pulseUniforms) {
      this._pulseUniforms.uActive.value = 0.0;
    }
  }

  destroy() {
    cancelAnimationFrame(this._animId);
    
    // Unbind window events
    window.removeEventListener('mousemove', this._moveBound);
    window.removeEventListener('mouseup',   this._upBound);
    window.removeEventListener('resize',    this._resizeBound);

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
