/** @jsxImportSource preact */

import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export interface GltfAssetCanvasProps {
  readonly url: string;
  readonly ariaLabel: string;
  readonly loadingLabel: string;
  readonly errorLabel: string;
  readonly readyLabel?: string;
}

/** Shared light-theme viewer for one exact GLB asset URL. */
export function GltfAssetCanvas({
  url,
  ariaLabel,
  loadingLabel,
  errorLabel,
  readyLabel = "Drag to orbit · scroll to zoom",
}: GltfAssetCanvasProps): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const resetView = useRef<(() => void) | undefined>(undefined);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let frame = 0;
    let loadedScene: THREE.Object3D | undefined;
    setState("loading");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4efe5);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.replaceChildren(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9aa98, 2.4));
    const key = new THREE.DirectionalLight(0xfff8ed, 3.4);
    key.position.set(180, 220, 260);
    scene.add(key);

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        loadedScene = gltf.scene;
        scene.add(loadedScene);
        const box = new THREE.Box3().setFromObject(loadedScene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 1);
        loadedScene.position.sub(center);
        resetView.current = () => {
          camera.near = Math.max(radius / 100, 0.1);
          camera.far = radius * 30;
          camera.position.set(radius * 1.6, radius * 1.15, radius * 1.9);
          camera.updateProjectionMatrix();
          controls.target.set(0, 0, 0);
          controls.update();
        };
        resetView.current();
        setState("ready");
      },
      undefined,
      () => !disposed && setState("error"),
    );

    const render = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      if (loadedScene) {
        scene.remove(loadedScene);
        disposeObject(loadedScene);
      }
      resetView.current = undefined;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div class="geometry-draft-canvas-shell">
      <div class="geometry-draft-canvas" ref={host} aria-label={ariaLabel} />
      <div class="geometry-draft-canvas-state" data-state={state}>
        {state === "loading"
          ? loadingLabel
          : state === "error"
          ? errorLabel
          : readyLabel}
      </div>
      <button
        type="button"
        class="geometry-draft-reset"
        disabled={state !== "ready"}
        onClick={() => resetView.current?.()}
      >
        Fit / reset
      </button>
    </div>
  );
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
      ? [mesh.material]
      : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
