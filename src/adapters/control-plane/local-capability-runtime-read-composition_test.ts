import { assertEquals } from "@std/assert";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
} from "../cad/isolated/worker-contract.ts";
import { createLocalCapabilityRuntimeReadComposition } from "./local-capability-runtime-read-composition.ts";

Deno.test("local read composition observes CalculiX and Build123d exact cache contracts", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition();
  const calculix = composition.catalog.units.find((unit) =>
    unit.id === "casys.calculix-worker"
  )?.materials.find((material) => material.id === "calculix-worker-image");
  const build123d = composition.catalog.units.find((unit) =>
    unit.id === BUILD123D_ISOLATED_WORKER_UNIT_ID
  )?.materials.find((material) =>
    material.id === BUILD123D_ISOLATED_WORKER_MATERIAL_ID
  );
  if (!calculix || !build123d) {
    throw new Error("code-owned catalog is missing the isolated worker materials");
  }
  const observed = await composition.states.observe([
    {
      unitId: "casys.calculix-worker",
      materialId: "calculix-worker-image",
      imageDigest: digestFromPinnedReference(calculix.imageReference),
    },
    {
      unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
      materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
      imageDigest: digestFromPinnedReference(build123d.imageReference),
    },
  ]);
  assertEquals(
    [...observed.keys()].toSorted(),
    [
      "casys.calculix-worker\u0000calculix-worker-image",
      capabilityRuntimeMaterialKey({
        unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
        materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
      }),
    ].toSorted(),
  );
});

function digestFromPinnedReference(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) throw new Error(`image reference is not digest-pinned: ${reference}`);
  return reference.slice(index + marker.length);
}
