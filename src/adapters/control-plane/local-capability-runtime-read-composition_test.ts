import { assertEquals } from "@std/assert";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
  BUILD123D_ISOLATED_WORKER_UNIT_ID,
} from "../cad/isolated/worker-contract.ts";
import { createLocalCapabilityRuntimeReadComposition } from "./local-capability-runtime-read-composition.ts";

Deno.test("local read composition without executable admitted runners leaves Modelica and SPICE cache materials unobserved", async () => {
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
  const modelica = composition.catalog.units.find((unit) =>
    unit.id === "casys.modelica-worker"
  )?.materials.find((material) => material.id === "modelica-admitted-worker-image");
  const spice = composition.catalog.units.find((unit) =>
    unit.id === "casys.spice-worker"
  )?.materials;
  if (!modelica || !spice) {
    throw new Error("code-owned catalog is missing admitted worker materials");
  }
  const source = spice.find((material) =>
    material.id === "ngspice-docker-source-image"
  );
  const runtime = spice.find((material) => material.id === "ngspice-runtime-image");
  if (!source || !runtime) throw new Error("SPICE material catalogue is incomplete");
  const microsandboxRequests: string[][] = [];
  const cacheRequests: string[][] = [];
  composition.microsandbox.observe = (materials) => {
    microsandboxRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(
      new Map(materials.map((material) => [
        capabilityRuntimeMaterialKey(material),
        { material: "installed" as const, runtime: "inactive" as const },
      ])),
    );
  };
  composition.cache.observe = (materials) => {
    cacheRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(
      new Map(materials.map((material) => [
        capabilityRuntimeMaterialKey(material),
        { material: "installed" as const, runtime: "inactive" as const },
      ])),
    );
  };
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
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(source, "casys.spice-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);
  assertEquals(microsandboxRequests, [[
    "casys.calculix-worker\u0000calculix-worker-image",
    capabilityRuntimeMaterialKey({
      unitId: BUILD123D_ISOLATED_WORKER_UNIT_ID,
      materialId: BUILD123D_ISOLATED_WORKER_MATERIAL_ID,
    }),
  ]]);
  assertEquals(cacheRequests, []);
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

Deno.test("local read composition enrolls the exact admitted SPICE and Modelica cache materials without starting a worker", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition({
    admittedModelicaExecutionProfile: profileFor(
      "casys/modelica-microsandbox-worker@sha256:d25f220287cd8d1713e9e7d773afb8bb867fc5404a112e5e50ffa2e862fd6fdf",
    ),
    admittedSpiceExecutionProfile: profileFor(
      "casys/ngspice-microsandbox-worker@sha256:3350527ceba0dbe8f2e31e435e834f962978e800134b83d6ee8f4875b7ffb79a",
    ),
  });
  const modelica = composition.catalog.units.find((unit) =>
    unit.id === "casys.modelica-worker"
  )?.materials.find((material) => material.id === "modelica-admitted-worker-image");
  const spice = composition.catalog.units.find((unit) =>
    unit.id === "casys.spice-worker"
  )?.materials;

  assertEquals(modelica?.platforms, ["linux/arm64"]);
  assertEquals(
    spice?.map((material) => material.id),
    ["ngspice-docker-source-image", "ngspice-runtime-image"],
  );
  assertEquals(
    spice?.map((material) => material.launchGroup),
    [null, null],
  );
  assertEquals(
    composition.cache.constructor.name,
    "LocalNgspiceDockerSourceImageCache",
  );

  if (!modelica || !spice) throw new Error("admitted material catalogue is incomplete");
  const source = spice.find((material) =>
    material.id === "ngspice-docker-source-image"
  );
  const runtime = spice.find((material) => material.id === "ngspice-runtime-image");
  if (!source || !runtime) throw new Error("SPICE material catalogue is incomplete");
  const microsandboxRequests: string[][] = [];
  const cacheRequests: string[][] = [];
  composition.microsandbox.observe = (materials) => {
    microsandboxRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(
      new Map(materials.map((material) => [
        capabilityRuntimeMaterialKey(material),
        { material: "installed" as const, runtime: "inactive" as const },
      ])),
    );
  };
  composition.cache.observe = (materials) => {
    cacheRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(
      new Map(materials.map((material) => [
        capabilityRuntimeMaterialKey(material),
        { material: "installed" as const, runtime: "inactive" as const },
      ])),
    );
  };
  const observed = await composition.states.observe([
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(source, "casys.spice-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);
  assertEquals(microsandboxRequests, [[
    "casys.modelica-worker\u0000modelica-admitted-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]]);
  assertEquals(cacheRequests, [[
    "casys.spice-worker\u0000ngspice-docker-source-image",
  ]]);
  assertEquals([...observed.keys()].toSorted(), [
    "casys.modelica-worker\u0000modelica-admitted-worker-image",
    "casys.spice-worker\u0000ngspice-docker-source-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]);
});

Deno.test("local read composition enrolls only the admitted Modelica material when only that runner exists", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition({
    admittedModelicaExecutionProfile: profileFor(
      "casys/modelica-microsandbox-worker@sha256:d25f220287cd8d1713e9e7d773afb8bb867fc5404a112e5e50ffa2e862fd6fdf",
    ),
  });
  const { modelica, source, runtime } = admittedMaterials(composition);
  const { microsandboxRequests, cacheRequests } = fakeInstalledObservers(composition);
  const observed = await composition.states.observe([
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(source, "casys.spice-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);

  assertEquals(microsandboxRequests, [[
    "casys.modelica-worker\u0000modelica-admitted-worker-image",
  ]]);
  assertEquals(cacheRequests, []);
  assertEquals([...observed.keys()], [
    "casys.modelica-worker\u0000modelica-admitted-worker-image",
  ]);
});

Deno.test("local read composition enrolls only the admitted SPICE source and runtime materials when only that runner exists", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition({
    admittedSpiceExecutionProfile: profileFor(
      "casys/ngspice-microsandbox-worker@sha256:3350527ceba0dbe8f2e31e435e834f962978e800134b83d6ee8f4875b7ffb79a",
    ),
  });
  const { modelica, source, runtime } = admittedMaterials(composition);
  const { microsandboxRequests, cacheRequests } = fakeInstalledObservers(composition);
  const observed = await composition.states.observe([
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(source, "casys.spice-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);

  assertEquals(microsandboxRequests, [[
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]]);
  assertEquals(cacheRequests, [[
    "casys.spice-worker\u0000ngspice-docker-source-image",
  ]]);
  assertEquals([...observed.keys()].toSorted(), [
    "casys.spice-worker\u0000ngspice-docker-source-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]);
});

function digestFromPinnedReference(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) throw new Error(`image reference is not digest-pinned: ${reference}`);
  return reference.slice(index + marker.length);
}

function profileFor(imageReference: string) {
  return {
    imageReference,
    imageDigest: {
      algorithm: "sha256" as const,
      digest: digestFromPinnedReference(imageReference),
    },
    profileFingerprint: { algorithm: "sha256" as const, digest: "a".repeat(64) },
  };
}

function identityFor(
  material: { readonly id: string; readonly imageReference: string },
  unitId: string,
) {
  return {
    unitId,
    materialId: material.id,
    imageDigest: digestFromPinnedReference(material.imageReference),
  };
}

function admittedMaterials(
  composition: Awaited<
    ReturnType<typeof createLocalCapabilityRuntimeReadComposition>
  >,
) {
  const modelica = composition.catalog.units.find((unit) =>
    unit.id === "casys.modelica-worker"
  )?.materials.find((material) => material.id === "modelica-admitted-worker-image");
  const spice = composition.catalog.units.find((unit) =>
    unit.id === "casys.spice-worker"
  )?.materials;
  const source = spice?.find((material) =>
    material.id === "ngspice-docker-source-image"
  );
  const runtime = spice?.find((material) => material.id === "ngspice-runtime-image");
  if (!modelica || !source || !runtime) {
    throw new Error("admitted material catalogue is incomplete");
  }
  return { modelica, source, runtime };
}

function fakeInstalledObservers(
  composition: Awaited<
    ReturnType<typeof createLocalCapabilityRuntimeReadComposition>
  >,
) {
  const microsandboxRequests: string[][] = [];
  const cacheRequests: string[][] = [];
  composition.microsandbox.observe = (materials) => {
    microsandboxRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(
      new Map(materials.map((material) => [
        capabilityRuntimeMaterialKey(material),
        { material: "installed" as const, runtime: "inactive" as const },
      ])),
    );
  };
  composition.cache.observe = (materials) => {
    cacheRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(
      new Map(materials.map((material) => [
        capabilityRuntimeMaterialKey(material),
        { material: "installed" as const, runtime: "inactive" as const },
      ])),
    );
  };
  return { microsandboxRequests, cacheRequests };
}
