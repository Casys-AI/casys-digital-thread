import { assertEquals } from "@std/assert";
import {
  boundedViewportDimensions,
  orbitCameraFrame,
} from "./src/geometry/three-orbit-viewport-model.ts";

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
    near: 0.1,
    far: 30,
    position: [1.6, 1.15, 1.9],
  });
});
