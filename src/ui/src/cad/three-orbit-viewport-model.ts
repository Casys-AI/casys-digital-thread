export interface OrbitCameraFrame {
  readonly near: number;
  readonly far: number;
  readonly position: readonly [number, number, number];
}

export function boundedViewportDimensions(
  width: number,
  height: number,
): Readonly<{ width: number; height: number }> {
  return {
    width: Math.max(width, 1),
    height: Math.max(height, 1),
  };
}

const CAMERA_POSITION_SCALE = Math.hypot(1.6, 1.15, 1.9);

export function orbitCameraFrame(radius: number): OrbitCameraFrame {
  const safe = Math.max(radius, 1e-6);
  return {
    near: safe / 100,
    far: safe * 30,
    position: [safe * 1.6, safe * 1.15, safe * 1.9],
  };
}

/** Camera radius that frames a thin AABB instead of collapsing it to a hairline. */
export function framingRadiusForBox(
  size: readonly [number, number, number],
  aspect: number,
  fovDeg: number,
): number {
  const extents = size.map((value) => Math.abs(value)).toSorted((left, right) =>
    right - left
  );
  const longest = Math.max(extents[0] ?? 0, 1e-9);
  const middle = Math.max(extents[1] ?? longest, 1e-9);
  const fov = (fovDeg * Math.PI) / 180;
  const halfFov = Math.tan(fov / 2);
  const safeAspect = Math.max(Math.abs(aspect), 1e-6);
  const fitHeight = middle / (2 * halfFov);
  const fitWidth = longest / (2 * halfFov * safeAspect);
  const distance = Math.max(fitHeight, fitWidth) * 1.25;
  return Math.max(distance / CAMERA_POSITION_SCALE, 1e-6);
}
