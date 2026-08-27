import { assertEquals } from "@std/assert";
import {
  boundedViewportDimensions,
  framingRadiusForBox,
  orbitCameraFrame,
} from "./src/cad/three-orbit-viewport-model.ts";

Deno.test("Three orbit viewport never exposes a zero-sized render target", () => {
  assertEquals(boundedViewportDimensions(0, -12), { width: 1, height: 1 });
  assertEquals(boundedViewportDimensions(720, 480), {
    width: 720,
    height: 480,
  });
});

Deno.test("Three orbit viewport derives the shared engineering camera frame from radius", () => {
  assertEquals(orbitCameraFrame(50), {
    near: 0.5,
    far: 1500,
    position: [80, 57.49999999999999, 95],
  });
  assertEquals(orbitCameraFrame(1), {
    near: 0.01,
    far: 30,
    position: [1.6, 1.15, 1.9],
  });
});

Deno.test("Fit/reset frames a thin 80x20x4 box instead of a hairline", () => {
  const aspect = 16 / 9;
  const fov = 36;
  const visibleShare = (
    size: readonly [number, number, number],
  ): number => {
    const radius = framingRadiusForBox(size, aspect, fov);
    const frame = orbitCameraFrame(radius);
    const distance = Math.hypot(...frame.position);
    const visibleWidth = 2 * distance * Math.tan((fov * Math.PI) / 360) * aspect;
    const longest = Math.max(...size);
    return longest / visibleWidth;
  };

  const millimetreShare = visibleShare([80, 20, 4]);
  const metreShare = visibleShare([0.08, 0.02, 0.004]);
  assertEquals(millimetreShare > 0.25 && millimetreShare <= 1, true);
  assertEquals(metreShare > 0.25 && metreShare <= 1, true);

  const metreFrame = orbitCameraFrame(
    framingRadiusForBox([0.08, 0.02, 0.004], aspect, fov),
  );
  assertEquals(
    metreFrame.near < Math.hypot(...metreFrame.position) / 10,
    true,
  );
});
