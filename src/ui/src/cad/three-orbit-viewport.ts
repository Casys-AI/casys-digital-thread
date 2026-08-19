import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  boundedViewportDimensions,
  orbitCameraFrame,
} from "./three-orbit-viewport-model.ts";

export interface ThreeOrbitViewport {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  isDisposed(): boolean;
  fitRadius(radius: number): void;
  start(): void;
  dispose(disposeSceneResources?: () => void): void;
}

/** Shared browser lifecycle for the product's passive Three.js asset viewers. */
export function createThreeOrbitViewport(
  container: HTMLDivElement,
): ThreeOrbitViewport {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = true;

  const resize = () => {
    const dimensions = boundedViewportDimensions(
      container.clientWidth,
      container.clientHeight,
    );
    renderer.setSize(dimensions.width, dimensions.height, false);
    camera.aspect = dimensions.width / dimensions.height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  let disposed = false;
  let frame: number | undefined;
  const render = () => {
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };

  return {
    scene,
    camera,
    controls,
    isDisposed: () => disposed,
    fitRadius: (radius) => {
      const cameraFrame = orbitCameraFrame(radius);
      camera.near = cameraFrame.near;
      camera.far = cameraFrame.far;
      camera.position.set(...cameraFrame.position);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
    },
    start: () => {
      if (disposed || frame !== undefined) return;
      render();
    },
    dispose: (disposeSceneResources) => {
      if (disposed) return;
      disposed = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      disposeSceneResources?.();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
