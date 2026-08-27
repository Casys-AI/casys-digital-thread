import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { framingRadiusForBox } from "../cad/three-orbit-viewport-model.ts";
import { createThreeOrbitViewport } from "../cad/three-orbit-viewport.ts";

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
    let loadedScene: THREE.Object3D | undefined;
    setState("loading");

    const viewport = createThreeOrbitViewport(container);
    const { scene } = viewport;
    scene.background = new THREE.Color(0xf2f4f6);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9aa98, 2.4));
    const key = new THREE.DirectionalLight(0xfff8ed, 3.4);
    key.position.set(180, 220, 260);
    scene.add(key);

    new GLTFLoader().load(
      url,
      (gltf) => {
        if (viewport.isDisposed()) {
          disposeObject(gltf.scene);
          return;
        }
        loadedScene = gltf.scene;
        scene.add(loadedScene);
        const box = new THREE.Box3().setFromObject(loadedScene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        loadedScene.position.sub(center);
        resetView.current = () => {
          const radius = framingRadiusForBox(
            [size.x, size.y, size.z],
            viewport.camera.aspect,
            viewport.camera.fov,
          );
          viewport.fitRadius(radius);
        };
        resetView.current();
        setState("ready");
      },
      undefined,
      () => !viewport.isDisposed() && setState("error"),
    );

    viewport.start();

    return () => {
      viewport.dispose(() => {
        if (loadedScene) {
          scene.remove(loadedScene);
          disposeObject(loadedScene);
        }
        resetView.current = undefined;
      });
    };
  }, [url]);

  return (
    <div className="geometry-draft-canvas-shell">
      <div
        className="geometry-draft-canvas"
        ref={host}
        aria-label={ariaLabel}
      />
      <div className="geometry-draft-canvas-state" data-state={state}>
        {state === "loading"
          ? loadingLabel
          : state === "error"
          ? errorLabel
          : readyLabel}
      </div>
      <button
        type="button"
        className="geometry-draft-reset"
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
