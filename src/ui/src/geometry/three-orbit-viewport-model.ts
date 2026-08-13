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

export function orbitCameraFrame(radius: number): OrbitCameraFrame {
  return {
    near: Math.max(radius / 100, 0.1),
    far: radius * 30,
    position: [radius * 1.6, radius * 1.15, radius * 1.9],
  };
}
