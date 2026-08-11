import { assertEquals, assertThrows } from "@std/assert";
import {
  centeredBoxZFaceSelectionBoxes,
  CONTRACT_CAPTURE_MESH_SIZE_MM,
  contractCaptureSelections,
  LIVE_SMOKE_MESH_SIZE_MM,
  liveSmokeSelections,
} from "./fea-provider-smoke-inputs.ts";

Deno.test("contract capture selects the complete centered-box bottom and top faces", () => {
  assertEquals(CONTRACT_CAPTURE_MESH_SIZE_MM, 10);
  assertEquals(contractCaptureSelections(), [
    {
      name: "FIXED",
      box: { min: [-41, -26, -26], max: [41, 26, -24] },
    },
    {
      name: "LOADED",
      box: { min: [-41, -26, 24], max: [41, 26, 26] },
    },
  ]);
});

Deno.test("live smoke selects the complete centered-box bottom and top faces", () => {
  assertEquals(LIVE_SMOKE_MESH_SIZE_MM, 5);
  assertEquals(liveSmokeSelections(), [
    {
      name: "BASE",
      box: { min: [-11, -11, -11], max: [11, 11, -9] },
    },
    {
      name: "TOP",
      box: { min: [-11, -11, 9], max: [11, 11, 11] },
    },
  ]);
});

Deno.test("centered-box face selections reject dimensions or margins that can overlap", () => {
  assertThrows(
    () => centeredBoxZFaceSelectionBoxes([20, 0, 20]),
    TypeError,
    "Box dimensions must be positive finite numbers",
  );
  assertThrows(
    () => centeredBoxZFaceSelectionBoxes([20, 20, 20], 10),
    TypeError,
    "Selection margin must be smaller than the box half-height",
  );
});
