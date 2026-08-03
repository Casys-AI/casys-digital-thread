import { assertEquals, assertThrows } from "@std/assert";
import {
  cm01DripTrayMechanicalRequestR3,
  parseCm01DripTrayMechanicalProofR3,
} from "./cm01-drip-tray-mechanical-proof.ts";
import R3_PROOF from "../../config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-height-30-static-r3.json" with {
  type: "json",
};

Deno.test("CM-01 R3 proof pins the padded 30 mm face boxes", () => {
  const proof = parseCm01DripTrayMechanicalProofR3(R3_PROOF);
  const request = cm01DripTrayMechanicalRequestR3(proof, {
    path: "/exports/coffee-machine-cm01-v3-drip-tray-height-30.step",
    sha256: "a".repeat(64),
  });
  assertEquals(request.selections, [
    { name: "FIXED", box: { min: [-96, 66.5, -16], max: [96, 68.5, 16] } },
    { name: "LOADED", box: { min: [-96, -68.5, -16], max: [96, -66.5, 16] } },
  ]);
});

Deno.test("CM-01 R3 proof rejects the unpadded R2 Z bounds", () => {
  const drifted = structuredClone(R3_PROOF);
  drifted.fixed.box.min[2] = -15;
  assertThrows(
    () => parseCm01DripTrayMechanicalProofR3(drifted),
    TypeError,
    "reviewed R3 padded face box",
  );
});
