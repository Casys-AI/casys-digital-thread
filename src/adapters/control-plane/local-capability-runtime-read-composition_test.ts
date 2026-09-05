import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "../electrical/spice/admitted/local-image-references.ts";
import { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "./first-party-capability-runtime-identities.ts";
import {
  createLocalCapabilityRuntimeReadComposition,
  overlayExecutionProfiles,
} from "./local-capability-runtime-read-composition.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyNonpersistentMicrosandboxExpectations } from "./first-party-capability-runtime-nonpersistent-materials.ts";

Deno.test("local read composition observes every catalogued microVM without optional executors", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition();
  const materials = cataloguedMicrosandboxMaterials(composition);
  const microsandboxRequests: string[][] = [];
  composition.microsandbox.observe = (materials) => {
    microsandboxRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(installedStates(materials));
  };
  const expected = materialKeys(materials);
  const observed = await composition.states.observe(
    materials.map(({ unitId, material }) => identityFor(material, unitId)),
  );

  assertEquals(microsandboxRequests, [expected]);
  assertEquals([...observed.keys()].toSorted(), expected.toSorted());
  assertEquals(
    expected.includes(
      "casys.geometry-module-assembler-worker\u0000geometry-module-assembler-worker-image",
    ),
    true,
  );
});

Deno.test("local read composition enrolls the exact admitted SPICE and Modelica Microsandbox materials without starting a worker", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition({
    admittedModelicaExecutionProfile: profileFor(
      LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
    ),
    admittedSpiceExecutionProfile: profileFor(
      LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    ),
  });
  const { modelica, runtime } = admittedMaterials(composition);
  const spice = composition.catalog.units.find((unit) =>
    unit.id === "casys.spice-worker"
  )?.materials;

  assertEquals(modelica.platforms, ["linux/arm64"]);
  assertEquals(spice?.map((material) => material.id), ["ngspice-runtime-image"]);
  assertEquals(spice?.map((material) => material.launchGroup), [null]);

  const { microsandboxRequests } = fakeInstalledMicrosandbox(composition);
  const observed = await composition.states.observe([
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);
  assertEquals(microsandboxRequests, [[
    "casys.modelica-worker\u0000modelica-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]]);
  assertEquals([...observed.keys()].toSorted(), [
    "casys.modelica-worker\u0000modelica-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]);
});

Deno.test("local read composition keeps catalogued SPICE observable when only the Modelica profile is configured", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition({
    admittedModelicaExecutionProfile: profileFor(
      LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
    ),
  });
  const { modelica, runtime } = admittedMaterials(composition);
  const { microsandboxRequests } = fakeInstalledMicrosandbox(composition);
  const observed = await composition.states.observe([
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);

  assertEquals(microsandboxRequests, [[
    "casys.modelica-worker\u0000modelica-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]]);
  assertEquals([...observed.keys()].toSorted(), [
    "casys.modelica-worker\u0000modelica-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]);
});

Deno.test("local read composition keeps catalogued Modelica observable when only the SPICE profile is configured", async () => {
  const composition = await createLocalCapabilityRuntimeReadComposition({
    admittedSpiceExecutionProfile: profileFor(
      LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    ),
  });
  const { modelica, runtime } = admittedMaterials(composition);
  const { microsandboxRequests } = fakeInstalledMicrosandbox(composition);
  const observed = await composition.states.observe([
    identityFor(modelica, "casys.modelica-worker"),
    identityFor(runtime, "casys.spice-worker"),
  ]);

  assertEquals(microsandboxRequests, [[
    "casys.modelica-worker\u0000modelica-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]]);
  assertEquals([...observed.keys()].toSorted(), [
    "casys.modelica-worker\u0000modelica-worker-image",
    "casys.spice-worker\u0000ngspice-runtime-image",
  ]);
});

Deno.test("local read composition rejects an optional execution profile that drifts from its catalogued microVM target", async () => {
  await assertRejects(
    () =>
      createLocalCapabilityRuntimeReadComposition({
        admittedSpiceExecutionProfile: profileFor(
          `casys/ngspice-microsandbox-worker@sha256:${"f".repeat(64)}`,
        ),
      }),
    Error,
    "target drifted",
  );
});

Deno.test("qualified and admitted Modelica profiles overlay the same catalogued worker image", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const qualified = profileFor(LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE, "b");
  const admitted = profileFor(LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE, "c");
  const overlaid = overlayExecutionProfiles(
    createFirstPartyNonpersistentMicrosandboxExpectations(catalog),
    {
      qualifiedModelicaExecutionProfile: qualified,
      admittedModelicaExecutionProfile: admitted,
    },
  );
  const modelica = overlaid.find((expectation) =>
    expectation.material.unitId === "casys.modelica-worker" &&
    expectation.material.materialId === "modelica-worker-image"
  );
  assertEquals(modelica?.allowedExecutionProfileFingerprints, [
    qualified.profileFingerprint,
    admitted.profileFingerprint,
  ]);
  await createLocalCapabilityRuntimeReadComposition({
    qualifiedModelicaExecutionProfile: qualified,
    admittedModelicaExecutionProfile: admitted,
  });
});

Deno.test("Modelica profile overlays reject a conflicting image target on the same material", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const expectations = createFirstPartyNonpersistentMicrosandboxExpectations(catalog);
  assertThrows(
    () =>
      overlayExecutionProfiles(expectations, {
        qualifiedModelicaExecutionProfile: profileFor(
          LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
          "b",
        ),
        admittedModelicaExecutionProfile: profileFor(
          `casys/modelica-microsandbox-worker@sha256:${"f".repeat(64)}`,
          "c",
        ),
      }),
    Error,
    "targets conflict",
  );
});

Deno.test("Modelica profile overlays reject a duplicate fingerprint claim on the same material", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const shared = profileFor(LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE, "b");
  assertThrows(
    () =>
      overlayExecutionProfiles(
        createFirstPartyNonpersistentMicrosandboxExpectations(catalog),
        {
          qualifiedModelicaExecutionProfile: shared,
          admittedModelicaExecutionProfile: shared,
        },
      ),
    Error,
    "Duplicate execution profile fingerprint",
  );
});

function digestFromPinnedReference(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) throw new Error(`image reference is not digest-pinned: ${reference}`);
  return reference.slice(index + marker.length);
}

function profileFor(imageReference: string, fingerprintSeed = "a") {
  return {
    imageReference,
    imageDigest: {
      algorithm: "sha256" as const,
      digest: digestFromPinnedReference(imageReference),
    },
    profileFingerprint: {
      algorithm: "sha256" as const,
      digest: fingerprintSeed.repeat(64),
    },
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
  )?.materials.find((material) => material.id === "modelica-worker-image");
  const runtime = composition.catalog.units.find((unit) =>
    unit.id === "casys.spice-worker"
  )?.materials.find((material) => material.id === "ngspice-runtime-image");
  if (!modelica || !runtime) {
    throw new Error("admitted material catalogue is incomplete");
  }
  return { modelica, runtime };
}

function cataloguedMicrosandboxMaterials(
  composition: Awaited<
    ReturnType<typeof createLocalCapabilityRuntimeReadComposition>
  >,
) {
  const materials = composition.catalog.units.flatMap((unit) =>
    unit.materials.filter((material) =>
      material.launchGroup === null && material.kind === "microvm-image" &&
      material.lifecycle === "ephemeral"
    ).map((material) => ({ unitId: unit.id, material }))
  );
  if (materials.length === 0) {
    throw new Error("code-owned catalogue has no observable microVM materials");
  }
  return materials;
}

function materialKeys(
  materials: readonly {
    readonly unitId: string;
    readonly material: { readonly id: string };
  }[],
): string[] {
  return materials.map(({ unitId, material }) =>
    capabilityRuntimeMaterialKey({ unitId, materialId: material.id })
  );
}

function fakeInstalledMicrosandbox(
  composition: Awaited<
    ReturnType<typeof createLocalCapabilityRuntimeReadComposition>
  >,
) {
  const microsandboxRequests: string[][] = [];
  composition.microsandbox.observe = (materials) => {
    microsandboxRequests.push(materials.map(capabilityRuntimeMaterialKey));
    return Promise.resolve(installedStates(materials));
  };
  return { microsandboxRequests };
}

function installedStates(
  materials: readonly {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  }[],
) {
  return new Map(materials.map((material) => [
    capabilityRuntimeMaterialKey(material),
    { material: "installed" as const, runtime: "inactive" as const },
  ]));
}
