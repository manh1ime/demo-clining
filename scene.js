import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MODEL_URL = new URL("./assets/premium-cleaning-collection.glb", import.meta.url).href;
const HIGHLIGHT = new THREE.Color("#c7ff5e");

const materialPalette = {
  IvoryBody: { color: "#eee9dc", metalness: 0.02, roughness: 0.36 },
  CharcoalRubber: { color: "#1c2325", metalness: 0.02, roughness: 0.7 },
  BrandAccent: { color: "#5b72ff", metalness: 0.08, roughness: 0.28 },
  SatinMetal: { color: "#bdc7ca", metalness: 0.92, roughness: 0.25 },
  MicrofiberFabric: { color: "#d8d5cc", metalness: 0, roughness: 0.94 },
  LabelSurface: { color: "#f5f1e8", metalness: 0, roughness: 0.48 },
  DustPolymer: { color: "#9eabad", metalness: 0, roughness: 0.3 },
};

function tuneMaterial(source, accentColor) {
  const material = source.clone();
  const preset = materialPalette[material.name];

  if (preset && material.color) material.color.set(preset.color);
  if (material.name === "BrandAccent" && material.color) material.color.copy(accentColor);
  if (preset && "metalness" in material) material.metalness = preset.metalness;
  if (preset && "roughness" in material) material.roughness = preset.roughness;
  if ("envMapIntensity" in material) material.envMapIntensity = material.name === "SatinMetal" ? 1.45 : 0.85;
  if ("clearcoat" in material && ["IvoryBody", "BrandAccent"].includes(material.name)) {
    material.clearcoat = material.name === "BrandAccent" ? 0.65 : 0.3;
    material.clearcoatRoughness = 0.25;
  }

  material.userData.baseColor = material.color?.clone();
  material.userData.baseEmissive = material.emissive?.clone();
  material.userData.baseEmissiveIntensity = material.emissiveIntensity || 0;
  material.needsUpdate = true;
  return material;
}

export function createCleaningScene(host, options = {}) {
  const mode = options.mode || "client";
  const accentColor = new THREE.Color(options.accentColor || "#5b72ff");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mode === "admin" ? 1.6 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mode === "admin" ? 1.12 : 1.18;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(mode === "admin" ? 32 : 30, 1, 0.001, 100);
  const stage = new THREE.Group();
  scene.add(stage);

  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  environment.dispose();
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xe9efff, 0x111719, mode === "admin" ? 1.7 : 2.15));

  const key = new THREE.DirectionalLight(0xfffbef, mode === "admin" ? 3.8 : 4.5);
  key.position.set(-3.5, 6.5, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.015;
  scene.add(key);

  const rim = new THREE.DirectionalLight(accentColor, mode === "admin" ? 2.7 : 3.4);
  rim.position.set(4, 3, -4);
  scene.add(rim);

  const fill = new THREE.PointLight(0xc7ff5e, 0.35, 4, 2);
  fill.position.set(-1, 0.6, 1.5);
  scene.add(fill);

  const focusLight = new THREE.PointLight(0xc7ff5e, 0, 2.4, 2);
  scene.add(focusLight);

  const groundMaterial = new THREE.ShadowMaterial({ color: 0x000000, opacity: mode === "admin" ? 0.2 : 0.27 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  let model;
  let bounds;
  let selectedName = null;
  let queuedFocus = "Caddy";
  let visible = true;
  let disposed = false;
  let dragging = false;
  let pointerX = 0;
  let targetRotationX = mode === "admin" ? -0.035 : -0.05;
  let targetRotationY = mode === "admin" ? -0.22 : -0.32;
  let rotationX = targetRotationX;
  let rotationY = targetRotationY;
  let lastInteraction = performance.now();

  const assemblies = new Map();
  const clock = new THREE.Clock();
  const targetScale = new THREE.Vector3(1, 1, 1);

  function fitCamera() {
    if (!bounds) return;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    camera.aspect = width / height;

    const size = bounds.getSize(new THREE.Vector3());
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const fitHeight = size.y / (2 * Math.tan(verticalFov / 2));
    const fitWidth = size.x / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(fitHeight, fitWidth) * (mode === "admin" ? 1.42 : 1.3);
    const targetY = size.y * (mode === "admin" ? 0.45 : 0.43);

    camera.near = Math.max(0.001, distance / 100);
    camera.far = distance * 20;
    camera.position.set(distance * 0.18, targetY + distance * 0.14, distance);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();

    ground.position.y = -size.y * 0.006;
    ground.scale.setScalar(Math.max(size.x, size.z, 1) * 0.75);
  }

  function resize() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    fitCamera();
  }

  function setAssemblyHighlight(root, highlighted, muted) {
    root.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.color && material.userData.baseColor) {
          material.color.copy(material.userData.baseColor);
          if (muted) material.color.lerp(new THREE.Color("#313738"), 0.24);
        }
        if (material.emissive) {
          material.emissive.copy(material.userData.baseEmissive || new THREE.Color(0x000000));
          material.emissiveIntensity = material.userData.baseEmissiveIntensity || 0;
          if (highlighted) {
            material.emissive.copy(HIGHLIGHT);
            material.emissiveIntensity = material.name === "CharcoalRubber" ? 0.18 : 0.27;
          }
        }
      });
    });
  }

  function focus(name = "Caddy") {
    queuedFocus = name;
    if (!model) return;

    const showAll = name === "Caddy";
    selectedName = showAll ? null : name;
    assemblies.forEach((root, rootName) => {
      setAssemblyHighlight(root, rootName === selectedName, !showAll && rootName !== selectedName);
      root.userData.focusTarget = rootName === selectedName ? 1.035 : 1;
    });

    if (selectedName && assemblies.has(selectedName)) {
      const target = assemblies.get(selectedName);
      const box = new THREE.Box3().setFromObject(target);
      box.getCenter(focusLight.position);
      focusLight.intensity = mode === "admin" ? 1.4 : 1.75;
    } else {
      focusLight.intensity = 0;
    }
    lastInteraction = performance.now();
  }

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      model = gltf.scene;
      model.name = "CleaningCollection";

      model.children.forEach((root) => {
        if (root.name) assemblies.set(root.name, root);
        root.userData.baseScale = root.scale.clone();
        root.userData.focusTarget = 1;
      });

      model.traverse((child) => {
        if (!child.isMesh) return;
        child.castShadow = true;
        child.receiveShadow = true;
        child.material = Array.isArray(child.material)
          ? child.material.map((material) => tuneMaterial(material, accentColor))
          : tuneMaterial(child.material, accentColor);
      });

      const originalBox = new THREE.Box3().setFromObject(model);
      const center = originalBox.getCenter(new THREE.Vector3());
      model.position.set(-center.x, -originalBox.min.y, -center.z);
      stage.add(model);
      stage.updateMatrixWorld(true);
      bounds = new THREE.Box3().setFromObject(stage);
      fitCamera();
      focus(queuedFocus);
      host.classList.add("scene-ready");
      options.onReady?.({ assemblies: [...assemblies.keys()], focus });
    },
    undefined,
    (error) => {
      console.warn("3D model could not be loaded; the local fallback remains visible.", error);
      host.classList.add("scene-error");
      const loading = host.querySelector(".model-loading");
      if (loading) loading.lastChild.textContent = " Статичный preview";
      options.onError?.(error);
    },
  );

  function pointerDown(event) {
    dragging = true;
    pointerX = event.clientX;
    lastInteraction = performance.now();
    host.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!dragging) return;
    const delta = event.clientX - pointerX;
    pointerX = event.clientX;
    targetRotationY += delta * 0.008;
    targetRotationX = THREE.MathUtils.clamp(targetRotationX + event.movementY * 0.003, -0.28, 0.2);
    lastInteraction = performance.now();
  }

  function pointerUp(event) {
    dragging = false;
    host.releasePointerCapture?.(event.pointerId);
  }

  host.addEventListener("pointerdown", pointerDown);
  host.addEventListener("pointermove", pointerMove);
  host.addEventListener("pointerup", pointerUp);
  host.addEventListener("pointercancel", pointerUp);

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const visibilityObserver = new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; }, { threshold: 0.02 });
  visibilityObserver.observe(host);
  resize();

  function render() {
    if (disposed) return;
    requestAnimationFrame(render);
    if (!visible || document.hidden) {
      clock.getDelta();
      return;
    }

    const delta = Math.min(clock.getDelta(), 0.05);
    const paused = reducedMotion.matches || options.isPaused?.();
    if (!paused && !dragging && performance.now() - lastInteraction > 2200) targetRotationY += delta * (mode === "admin" ? 0.08 : 0.11);

    rotationX += (targetRotationX - rotationX) * 0.08;
    rotationY += (targetRotationY - rotationY) * 0.08;
    stage.rotation.x = rotationX;
    stage.rotation.y = rotationY;

    if (model) {
      assemblies.forEach((root) => {
        const factor = root.userData.focusTarget || 1;
        targetScale.copy(root.userData.baseScale || new THREE.Vector3(1, 1, 1)).multiplyScalar(factor);
        root.scale.lerp(targetScale, 0.09);
      });
      if (!paused) fill.intensity = 0.28 + Math.sin(performance.now() * 0.0014) * 0.07;
    }

    renderer.render(scene, camera);
  }
  render();

  return {
    focus,
    reset: () => focus("Caddy"),
    dispose() {
      disposed = true;
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      host.removeEventListener("pointerdown", pointerDown);
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerup", pointerUp);
      host.removeEventListener("pointercancel", pointerUp);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
