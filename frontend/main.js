// main.js — Three.js scene, animation loop, raycasting, camera tweens.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { UIController, EDGE_COLORS } from './ui.js';

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const NODE_RADIUS = 0.6;
const HOVER_SCALE = 1.4;
const SELECTED_SCALE = 1.55;
const IDLE_MS_BEFORE_AUTOORBIT = 4000;
const CAMERA_TWEEN_MS = 700;
const DEFAULT_CAMERA_POS = new THREE.Vector3(0, 6, 26);
const DEFAULT_TARGET = new THREE.Vector3(0, 0, 0);
const DIM_OPACITY = 0.25;
const FILTER_DIM_OPACITY = 0.1;

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------
loadGraph();

async function loadGraph() {
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');
  errorOverlay.hidden = true;

  try {
    const [graph, categories] = await Promise.all([
      fetchJSON('/api/graph'),
      fetchJSON('/api/categories'),
    ]);

    if (!graph || !Array.isArray(graph.concepts)) {
      throw new Error('Invalid /api/graph payload');
    }

    boot(graph, categories);

    loadingOverlay.classList.add('gone');
    setTimeout(() => loadingOverlay.remove(), 500);
  } catch (err) {
    console.error('[graph] load failed', err);
    errorMessage.textContent = err && err.message ? err.message : 'Could not reach the backend.';
    errorOverlay.hidden = false;
    document.getElementById('error-retry').onclick = () => {
      errorOverlay.hidden = true;
      // Re-show loading + retry
      loadingOverlay.classList.remove('gone');
      loadingOverlay.style.display = '';
      loadGraph();
    };
  }
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------------
// Scene boot
// ------------------------------------------------------------------
function boot(graph, categories) {
  const concepts = graph.concepts;
  const relationships = graph.relationships || [];
  const byId = new Map(concepts.map((c) => [c.id, c]));

  // -------- Renderer setup --------
  const container = document.getElementById('canvas-container');
  const labelContainer = document.getElementById('label-container');

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0a12, 0.012);

  const camera = new THREE.PerspectiveCamera(
    55, window.innerWidth / window.innerHeight, 0.1, 600
  );
  camera.position.copy(DEFAULT_CAMERA_POS);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const labelRenderer = new CSS2DRenderer({ element: labelContainer });
  labelRenderer.setSize(window.innerWidth, window.innerHeight);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.copy(DEFAULT_TARGET);
  controls.minDistance = 4;
  controls.maxDistance = 120;
  controls.autoRotateSpeed = 0.35;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // -------- Lights --------
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.7);
  dir1.position.set(10, 12, 8);
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0x7aa2ff, 0.35);
  dir2.position.set(-8, -6, -10);
  scene.add(dir2);

  // -------- Starfield --------
  buildStarfield(scene);

  // -------- Nodes --------
  const sharedSphereGeo = new THREE.SphereGeometry(NODE_RADIUS, 28, 22);
  /** @type {{concept: object, mesh: THREE.Mesh, label: CSS2DObject, baseScale: number, phase: number,
   *  targetScale: number, currentScale: number, baseEmissive: number, targetEmissive: number,
   *  currentEmissive: number, dim: number, currentDim: number}[]} */
  const nodes = [];
  const nodesGroup = new THREE.Group();
  scene.add(nodesGroup);

  for (let i = 0; i < concepts.length; i++) {
    const c = concepts[i];
    const colorHex = (c.color || '#88aaff').replace('#', '');
    const color = new THREE.Color('#' + colorHex);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.35,
      roughness: 0.45,
      metalness: 0.15,
      transparent: true,
      opacity: 1.0,
    });
    const mesh = new THREE.Mesh(sharedSphereGeo, mat);
    const pos = c.position || { x: 0, y: 0, z: 0 };
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.userData.conceptId = c.id;
    nodesGroup.add(mesh);

    // CSS2D label
    const labelDiv = document.createElement('div');
    labelDiv.className = 'node-label';
    labelDiv.textContent = c.name;
    const labelObj = new CSS2DObject(labelDiv);
    labelObj.position.set(0, NODE_RADIUS + 0.2, 0);
    mesh.add(labelObj);

    nodes.push({
      concept: c,
      mesh,
      label: labelObj,
      labelEl: labelDiv,
      baseScale: 1,
      phase: Math.random() * Math.PI * 2,
      targetScale: 1,
      currentScale: 1,
      baseEmissive: 0.35,
      targetEmissive: 0.35,
      currentEmissive: 0.35,
      targetOpacity: 1.0,
      currentOpacity: 1.0,
      pickable: true,
    });
  }
  const nodeByConceptId = new Map(nodes.map((n) => [n.concept.id, n]));

  // -------- Edges --------
  // We build one LineSegments per edge type so we can color/animate independently.
  const edgesByType = new Map(); // type -> { lineSeg, positions: Float32Array, vertexCount, baseOpacity }
  // Also keep per-edge metadata so we can know which edges connect to a selected node.
  /** @type {{type:string, source:string, target:string, idx:number}[]} */
  const edgeRecords = [];

  // Group relationships by type
  const byType = {};
  for (const r of relationships) {
    if (!byId.has(r.source_id) || !byId.has(r.target_id)) continue;
    (byType[r.type] = byType[r.type] || []).push(r);
  }

  for (const type of Object.keys(byType)) {
    const list = byType[type];
    const positions = new Float32Array(list.length * 2 * 3);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const a = byId.get(r.source_id).position;
      const b = byId.get(r.target_id).position;
      positions[i * 6 + 0] = a.x;
      positions[i * 6 + 1] = a.y;
      positions[i * 6 + 2] = a.z;
      positions[i * 6 + 3] = b.x;
      positions[i * 6 + 4] = b.y;
      positions[i * 6 + 5] = b.z;
      edgeRecords.push({ type, source: r.source_id, target: r.target_id, idx: i });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const colorHex = EDGE_COLORS[type] || '#ffffff';
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    scene.add(lines);
    edgesByType.set(type, { lines, mat, baseOpacity: 0.18, list });
  }

  // Highlight overlay — separate LineSegments rebuilt per selection so we
  // can pulse ONLY the edges incident to the selected node.
  const highlightGeo = new THREE.BufferGeometry();
  highlightGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  highlightGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(0), 3));
  const highlightMat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    linewidth: 2,
  });
  const highlightLines = new THREE.LineSegments(highlightGeo, highlightMat);
  scene.add(highlightLines);

  function rebuildHighlightForSelection() {
    if (!selected) {
      highlightGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
      highlightGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(0), 3));
      return;
    }
    const selId = selected.concept.id;
    const incident = relationships.filter(
      (r) => r.source_id === selId || r.target_id === selId
    );
    const positions = new Float32Array(incident.length * 6);
    const colors    = new Float32Array(incident.length * 6);
    const tmpColor = new THREE.Color();
    for (let i = 0; i < incident.length; i++) {
      const r = incident[i];
      const a = byId.get(r.source_id).position;
      const b = byId.get(r.target_id).position;
      positions[i*6+0] = a.x; positions[i*6+1] = a.y; positions[i*6+2] = a.z;
      positions[i*6+3] = b.x; positions[i*6+4] = b.y; positions[i*6+5] = b.z;
      tmpColor.set(EDGE_COLORS[r.type] || '#ffffff');
      colors[i*6+0] = tmpColor.r; colors[i*6+1] = tmpColor.g; colors[i*6+2] = tmpColor.b;
      colors[i*6+3] = tmpColor.r; colors[i*6+4] = tmpColor.g; colors[i*6+5] = tmpColor.b;
    }
    highlightGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    highlightGeo.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  }

  // Build neighbor lookup (concept id -> Set of neighbor ids)
  const neighborSet = new Map();
  for (const c of concepts) neighborSet.set(c.id, new Set());
  for (const r of relationships) {
    if (neighborSet.has(r.source_id)) neighborSet.get(r.source_id).add(r.target_id);
    if (neighborSet.has(r.target_id)) neighborSet.get(r.target_id).add(r.source_id);
  }

  // -------- State --------
  let hovered = null;
  let selected = null;
  let searchPredicate = null;
  let activeCategories = new Set(categories.map((c) => c.name));
  let lastInputAt = performance.now();
  let cameraTween = null; // { from, to, fromTarget, toTarget, t0, dur }

  // -------- Raycaster --------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerOnScreen = { x: 0, y: 0 };
  let pointerInside = false;

  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', (e) => {
    pointerInside = true;
    pointerOnScreen = { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    markInput();
  });
  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
    setHover(null);
    ui.hideTooltip();
  });
  canvas.addEventListener('pointerdown', () => markInput());
  canvas.addEventListener('wheel', () => markInput(), { passive: true });
  document.addEventListener('pointerdown', markInput);
  document.addEventListener('keydown',     markInput);
  // NOTE: we deliberately only listen to `start`, not `change`. OrbitControls'
  // damping + autoRotate fire `change` every frame and would create a feedback
  // loop that prevents auto-orbit from ever kicking in.
  controls.addEventListener('start', () => { markInput(); });

  // Click to select / deselect
  canvas.addEventListener('click', (e) => {
    // Determine pointer in NDC at the moment of click
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const hit = pickNode();
    if (hit) {
      selectNode(hit.concept.id);
    } else {
      bridge.deselect();
    }
  });

  function pickNode() {
    raycaster.setFromCamera(pointer, camera);
    const pickables = nodes.filter((n) => n.pickable).map((n) => n.mesh);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const id = hits[0].object.userData.conceptId;
    return nodeByConceptId.get(id) || null;
  }

  function setHover(node) {
    if (hovered === node) return;
    if (hovered) {
      hovered.targetScale = (selected && selected === hovered) ? SELECTED_SCALE : 1.0;
      hovered.targetEmissive = (selected && selected === hovered) ? 0.95 : 0.35;
      hovered.labelEl.classList.remove('hovered');
    }
    hovered = node;
    if (hovered) {
      hovered.targetScale = HOVER_SCALE;
      hovered.targetEmissive = 0.85;
      hovered.labelEl.classList.add('hovered');
      canvas.style.cursor = 'pointer';
    } else {
      canvas.style.cursor = '';
    }
  }

  function selectNode(id) {
    const node = nodeByConceptId.get(id);
    if (!node) return;
    selected = node;
    // Camera tween
    const offset = new THREE.Vector3(0, 2.2, 7.5);
    const targetPos = node.mesh.position.clone();
    const camPos = targetPos.clone().add(offset);
    startCameraTween(camPos, targetPos);
    applyVisibilityMasks();
    rebuildHighlightForSelection();
    ui.openDetail(node.concept);
  }

  function deselect() {
    if (!selected) {
      // Ensure overview camera anyway if user pressed Esc twice / clicked empty
      if (panelOpen()) ui.closeDetail();
      return;
    }
    selected = null;
    ui.closeDetail();
    startCameraTween(DEFAULT_CAMERA_POS.clone(), DEFAULT_TARGET.clone());
    applyVisibilityMasks();
    rebuildHighlightForSelection();
  }

  function resetView() {
    selected = null;
    ui.closeDetail();
    startCameraTween(DEFAULT_CAMERA_POS.clone(), DEFAULT_TARGET.clone());
    applyVisibilityMasks();
    rebuildHighlightForSelection();
    // Also clear search/filter? No — only camera per spec.
  }

  function panelOpen() {
    return document.getElementById('detail-panel').classList.contains('open');
  }

  function applyVisibilityMasks() {
    // Determine each node's pickability + target opacity based on
    // (a) search predicate, (b) active categories, (c) selection neighborhood.
    const selId = selected ? selected.concept.id : null;
    const neighbors = selId ? neighborSet.get(selId) : null;

    for (const n of nodes) {
      const c = n.concept;
      const matchesSearch = !searchPredicate || searchPredicate(c);
      const matchesCategory = activeCategories.has(c.category);

      let opacity = 1.0;
      let pickable = true;
      let dimLabel = false;
      let hideLabel = false;

      if (!matchesSearch || !matchesCategory) {
        opacity = FILTER_DIM_OPACITY;
        pickable = false;
        hideLabel = !matchesSearch && searchPredicate ? true : false;
        dimLabel = true;
      } else if (selId) {
        if (c.id === selId || (neighbors && neighbors.has(c.id))) {
          opacity = 1.0;
          dimLabel = false;
        } else {
          opacity = DIM_OPACITY;
          dimLabel = true;
        }
      }

      n.targetOpacity = opacity;
      n.pickable = pickable;
      n.labelEl.classList.toggle('dimmed', dimLabel);
      n.labelEl.classList.toggle('hidden', hideLabel);

      // Persistent selected-node highlight (hover still overrides via setHover).
      const isSelected = selId && c.id === selId;
      const isHovered  = hovered && hovered.concept.id === c.id;
      if (!isHovered) {
        n.targetScale    = isSelected ? SELECTED_SCALE : 1.0;
        n.targetEmissive = isSelected ? 0.95           : 0.35;
      }
    }

    // Edge base opacity: background edges fade when a node is selected
    // so the pulsing highlight overlay stands out.
    for (const [, info] of edgesByType) {
      info.baseOpacity = selId ? 0.06 : 0.18;
    }
  }

  // -------- Camera tweening --------
  function startCameraTween(toPos, toTarget) {
    controls.enabled = false;
    cameraTween = {
      from: camera.position.clone(),
      to: toPos.clone(),
      fromTarget: controls.target.clone(),
      toTarget: toTarget.clone(),
      t0: performance.now(),
      dur: CAMERA_TWEEN_MS,
    };
  }

  function tickCameraTween(now) {
    if (!cameraTween) return;
    const t = Math.min(1, (now - cameraTween.t0) / cameraTween.dur);
    const k = easeInOutCubic(t);
    camera.position.lerpVectors(cameraTween.from, cameraTween.to, k);
    controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, k);
    if (t >= 1) {
      cameraTween = null;
      controls.enabled = true;
    }
  }

  function markInput() {
    lastInputAt = performance.now();
    controls.autoRotate = false;
  }

  // -------- UI bridge --------
  const bridge = {
    selectById: (id) => selectNode(typeof id === 'string' ? Number(id) : id),
    deselect: () => deselect(),
    resetView: () => resetView(),
    setSearchPredicate: (fn) => {
      searchPredicate = fn;
      applyVisibilityMasks();
    },
    setCategoryFilter: (set) => {
      activeCategories = set;
      applyVisibilityMasks();
    },
  };

  const ui = new UIController({ concepts, relationships, categories, bridge });

  // Reset view button
  document.getElementById('reset-view').addEventListener('click', () => resetView());

  // -------- Resize --------
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
  });

  // -------- Animation loop --------
  const clock = new THREE.Clock();
  let lastFrame = performance.now();

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    // Clamp delta when tab was backgrounded
    let delta = (now - lastFrame) / 1000;
    if (delta > 0.1) delta = 0.1;
    lastFrame = now;
    const elapsed = clock.getElapsedTime();

    // Camera tween (cancels OrbitControls damping influence during tween)
    if (cameraTween) {
      tickCameraTween(now);
    }

    // Auto-orbit kicks in after idle
    const idleMs = now - lastInputAt;
    const shouldAutoOrbit = idleMs > IDLE_MS_BEFORE_AUTOORBIT && !cameraTween && !selected && !reduceMotion;
    if (shouldAutoOrbit && !controls.autoRotate) controls.autoRotate = true;
    if (!shouldAutoOrbit && controls.autoRotate) controls.autoRotate = false;

    // Hover detection (skip while tweening to avoid jitter)
    if (!cameraTween && pointerInside) {
      const hit = pickNode();
      setHover(hit);
      if (hit) {
        ui.showTooltip(hit.concept, pointerOnScreen.x, pointerOnScreen.y);
      } else {
        ui.hideTooltip();
      }
    } else if (cameraTween) {
      ui.hideTooltip();
      setHover(null);
    }

    // Node breathing + scale/emissive lerp + opacity lerp
    const lerpK = 1 - Math.pow(0.001, delta); // frame-rate-independent lerp
    for (const n of nodes) {
      const breathing = 1 + Math.sin(elapsed * 1.2 + n.phase) * 0.05;
      // Smoothly approach targetScale, then multiply by breathing factor
      n.currentScale += (n.targetScale - n.currentScale) * lerpK;
      const s = reduceMotion ? n.currentScale : n.currentScale * breathing;
      n.mesh.scale.setScalar(s);

      n.currentEmissive += (n.targetEmissive - n.currentEmissive) * lerpK;
      n.mesh.material.emissiveIntensity = n.currentEmissive;

      n.currentOpacity += (n.targetOpacity - n.currentOpacity) * lerpK;
      n.mesh.material.opacity = n.currentOpacity;
      n.label.visible = n.currentOpacity > 0.2;
    }

    // Base edges ease toward their target opacity (dim when something is selected).
    for (const [, info] of edgesByType) {
      info.mat.opacity += (info.baseOpacity - info.mat.opacity) * lerpK;
    }
    // Highlight overlay (only the edges incident to the selected node) pulses.
    const targetHighlight = selected
      ? 0.55 + 0.35 * (Math.sin(elapsed * 4) * 0.5 + 0.5)
      : 0.0;
    highlightMat.opacity += (targetHighlight - highlightMat.opacity) * lerpK;

    // Tooltip follows cursor
    if (hovered && pointerInside) {
      ui.moveTooltip(pointerOnScreen.x, pointerOnScreen.y);
    }

    controls.update();
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  animate();
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function buildStarfield(scene) {
  const count = 1800;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Distribute in a large spherical shell
    const r = 80 + Math.random() * 180;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    // Slight color variation
    const c = 0.55 + Math.random() * 0.45;
    const tint = Math.random();
    colors[i * 3 + 0] = c * (0.85 + tint * 0.15);
    colors[i * 3 + 1] = c * (0.9 + tint * 0.1);
    colors[i * 3 + 2] = c * (0.95 + (1 - tint) * 0.05);
    sizes[i] = 0.4 + Math.random() * 1.0;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.55,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -1;
  scene.add(points);
}
