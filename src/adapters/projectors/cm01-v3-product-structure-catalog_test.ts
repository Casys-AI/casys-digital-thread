import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type Cm01V3ArchitectureCaptureReader,
  COFFEE_MACHINE_CM01_V3_SUBJECT_ID,
  resolveCoffeeMachineCm01V3ProductStructureCatalog,
} from "./cm01-v3-product-structure-catalog.ts";

const AT = "2026-08-03T12:00:00.000Z";
const PART_DEFINITION =
  "siriusComponents://semantic?domain=sysml&entity=PartDefinition";

Deno.test("CM-01 V3 Product Structure derives only exact SysON definitions and the fresh R2 assembly", async () => {
  const fixture = await v3Fixture();
  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    fixture.snapshot,
    fixture.reader,
  );

  assertEquals(catalog?.subjectId, COFFEE_MACHINE_CM01_V3_SUBJECT_ID);
  assertEquals(catalog?.components.length, 11);
  assertEquals(catalog?.systemViews, {});
  const root = catalog?.components[0];
  assertEquals(root?.id, "cm01-v3:coffee-machine");
  assertEquals(root?.bindings, [{
    provider: "syson",
    kind: "part-definition",
    id: "sysml-coffee-machine",
    label: "CoffeeMachine",
    evidenceArtifactId: fixture.architectureId,
  }, {
    provider: "build123d",
    kind: "artifact",
    id: fixture.stepId,
    label: "CM-01 R2 assembly STEP export",
    evidenceArtifactId: fixture.stepId,
  }]);
  assertEquals(
    catalog?.components.slice(1).map((component) => ({
      id: component.id,
      label: component.label,
      parentId: component.parentId,
      binding: component.bindings[0],
    })),
    [
      "Enclosure",
      "WaterTank",
      "Boiler",
      "Pump",
      "BrewUnit",
      "ControlPCB",
      "PowerSupply",
      "TemperatureSensor",
      "UserInterface",
      "DripTray",
    ].map((label) => ({
      id: `cm01-v3:${semanticKey(label)}`,
      label,
      parentId: "cm01-v3:coffee-machine",
      binding: {
        provider: "syson" as const,
        kind: "part-definition" as const,
        id: `sysml-${semanticKey(label)}`,
        label,
        evidenceArtifactId: fixture.architectureId,
      },
    })),
  );
  assertEquals(
    catalog?.components.some((component) =>
      component.bindings.some((binding) => binding.provider === "erpnext")
    ),
    false,
  );
});

Deno.test("CM-01 V3 Product Structure still resolves when anchored requirements share the architecture's producer", async () => {
  // The live regression: anchoring the oracle requirements (R13) inserted a
  // second fresh sysml-model through the very same SysON tool, and a
  // provenance-based selector went ambiguous — the Product panel emptied.
  const fixture = await v3Fixture();
  const requirementsArtifact = {
    id: `oracle-requirements-${"4".repeat(64)}`,
    name: "CM-01 oracle requirements declaration",
    kind: "sysml-model",
    version: "4".repeat(64),
    fingerprint: fingerprint("4"),
    uri: `casys://oracle-requirements-seed-capture/sha256/${"4".repeat(64)}`,
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:anchor-oracle-requirements",
    },
    // The live artifact derives from the architecture with full verified
    // lineage; this fixture exercises only the selector's ambiguity, so it
    // declares no inputs rather than fabricate consumer fingerprints.
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [...fixture.snapshot.artifacts, requirementsArtifact],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  assertEquals(catalog?.components.length, 11);
  assertEquals(
    catalog?.components[0]?.bindings[0]?.evidenceArtifactId,
    fixture.architectureId,
  );
});

Deno.test("CM-01 V3 Product Structure withholds an assembly facet without its exact fresh R2 lineage", async () => {
  const fixture = await v3Fixture();
  const snapshot = structuredClone(fixture.snapshot);
  const step = snapshot.artifacts.find((artifact) => artifact.id === fixture.stepId);
  if (!step) throw new Error("Fixture has no R2 STEP artifact.");
  step.producer.tool = "build123d_export_legacy";

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  assertEquals(catalog?.components.length, 11);
  assertEquals(catalog?.components[0]?.bindings, [{
    provider: "syson",
    kind: "part-definition",
    id: "sysml-coffee-machine",
    label: "CoffeeMachine",
    evidenceArtifactId: fixture.architectureId,
  }]);
});

Deno.test("CM-01 V3 Product Structure fails closed when the read capture does not match thread evidence", async () => {
  const fixture = await v3Fixture();
  const corrupted = structuredClone(fixture.capture) as {
    declarations: Array<{ id: string; kind: string; label: string }>;
  };
  corrupted.declarations[0]!.label = "TamperedCoffeeMachine";
  const reader: Cm01V3ArchitectureCaptureReader = {
    read: () => Promise.resolve(deterministicJson(corrupted)),
  };

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    fixture.snapshot,
    reader,
  );

  assertEquals(catalog?.components, []);
  assertStringIncludes(catalog?.rationale ?? "", "cannot be verified");
});

Deno.test("CM-01 V3 Product Structure does not apply to another subject", async () => {
  const fixture = await v3Fixture();
  const anotherSubject = {
    ...fixture.snapshot,
    subject: { ...fixture.snapshot.subject, id: "project:another-product" },
  };

  assertEquals(
    await resolveCoffeeMachineCm01V3ProductStructureCatalog(
      anotherSubject,
      fixture.reader,
    ),
    undefined,
  );
});

async function v3Fixture(): Promise<{
  readonly snapshot: ThreadSnapshot;
  readonly capture: Record<string, unknown>;
  readonly reader: Cm01V3ArchitectureCaptureReader;
  readonly architectureId: string;
  readonly stepId: string;
}> {
  const declarations = [
    "CoffeeMachine",
    "Enclosure",
    "WaterTank",
    "Boiler",
    "Pump",
    "BrewUnit",
    "ControlPCB",
    "PowerSupply",
    "TemperatureSensor",
    "UserInterface",
    "DripTray",
  ].map((label) => ({
    id: `sysml-${semanticKey(label)}`,
    kind: PART_DEFINITION,
    label,
  }));
  const capture = {
    architecturePackage: { id: "package", kind: "Package", label: "CM01" },
    capturedAt: AT,
    declarations,
    insertion: { parentId: "package" },
    kind: "cm01-sysml-architecture",
    operation: { serverId: "syson", tool: "syson_element_insert_sysml" },
    recipe: { key: "coffee-machine-cm01" },
    schemaVersion: "coffee-machine-cm01-v3-architecture-capture/1.0",
    scope: { kind: "system" },
    seed: { artifactId: "seed" },
    semanticArtifactRole: "architecture-model",
    statement: "Exact fixture architecture.",
    trustedRunId: "run:fixture",
  };
  const architectureFingerprint = await sha256Fingerprint(capture);
  const architectureId =
    `coffee-machine-cm01-v3-architecture-${architectureFingerprint.digest}`;
  const planId = "cm01-v3-cad-r2-plan";
  const scriptId = "cm01-v3-cad-r2-script";
  const stepId = "cm01-v3-cad-r2-step";
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "cm01-v3-product-structure-fixture:r9",
    revision: 9,
    generatedAt: AT,
    subject: {
      id: COFFEE_MACHINE_CM01_V3_SUBJECT_ID,
      name: "CoffeeMachine CM-01 V3",
      kind: "system",
      version: "9".repeat(64),
      modelArtifactId: architectureId,
    },
    freshness: fresh(),
    changeSet: {
      id: "cm01-v3-r9",
      name: "CM-01 V3 R2 assembly",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-cm01-v3-r9",
        kind: "created",
        target: { kind: "artifact", id: architectureId },
        summary: "Recorded exact V3 architecture and R2 assembly.",
        afterFingerprint: architectureFingerprint,
      }],
    },
    artifacts: [{
      id: architectureId,
      name: "CM-01 V3 architecture",
      kind: "sysml-model",
      version: architectureFingerprint.digest,
      fingerprint: architectureFingerprint,
      uri:
        `casys://coffee-machine-cm01-v3-architecture/sha256/${architectureFingerprint.digest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:architecture",
      },
      inputArtifactIds: [],
      freshness: fresh(),
    }, {
      id: planId,
      name: "CM-01 R2 CAD plan",
      kind: "document",
      version: "1".repeat(64),
      fingerprint: fingerprint("1"),
      producer: {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
        runId: "run:cad-plan",
      },
      inputArtifactIds: [architectureId],
      freshness: fresh(),
    }, {
      id: scriptId,
      name: "CM-01 R2 CAD script",
      kind: "script",
      version: "2".repeat(64),
      fingerprint: fingerprint("2"),
      producer: {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
        runId: "run:cad-script",
      },
      inputArtifactIds: [planId],
      freshness: fresh(),
    }, {
      id: stepId,
      name: "CM-01 R2 assembly STEP export",
      kind: "step",
      version: "3".repeat(64),
      fingerprint: fingerprint("3"),
      producer: {
        serverId: "build123d",
        tool: "build123d_export",
        runId: "run:cad-export",
      },
      inputArtifactIds: [scriptId],
      freshness: fresh(),
    }],
    consumptions: [{
      id: "consume-architecture-by-r2-plan",
      artifactId: architectureId,
      consumer: {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
        runId: "run:cad-plan",
      },
      observedFingerprint: architectureFingerprint,
      verifiedAt: AT,
      status: "verified",
    }, {
      id: "consume-plan-by-r2-script",
      artifactId: planId,
      consumer: {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
        runId: "run:cad-script",
      },
      observedFingerprint: fingerprint("1"),
      verifiedAt: AT,
      status: "verified",
    }, {
      id: "consume-script-by-r2-step",
      artifactId: scriptId,
      consumer: {
        serverId: "build123d",
        tool: "build123d_export",
        runId: "run:cad-export",
      },
      observedFingerprint: fingerprint("2"),
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "change-to-architecture",
      relation: "changes",
      from: { kind: "change", id: "change-cm01-v3-r9" },
      to: { kind: "artifact", id: architectureId },
      rationale: "Fixture change records the exact architecture evidence.",
    }, {
      id: "r2-plan-from-architecture",
      relation: "derived_from",
      from: { kind: "artifact", id: planId },
      to: { kind: "artifact", id: architectureId },
      rationale: "The exact R2 plan consumed the exact V3 architecture.",
    }, {
      id: "r2-script-from-plan",
      relation: "derived_from",
      from: { kind: "artifact", id: scriptId },
      to: { kind: "artifact", id: planId },
      rationale: "The exact R2 script consumed the exact R2 plan.",
    }, {
      id: "r2-step-from-script",
      relation: "derived_from",
      from: { kind: "artifact", id: stepId },
      to: { kind: "artifact", id: scriptId },
      rationale: "The exact R2 STEP consumed the exact R2 script.",
    }, {
      id: "consume-architecture-uses",
      relation: "uses",
      from: { kind: "consumption", id: "consume-architecture-by-r2-plan" },
      to: { kind: "artifact", id: architectureId },
      rationale: "The R2 plan attested its exact architecture input.",
    }, {
      id: "consume-plan-uses",
      relation: "uses",
      from: { kind: "consumption", id: "consume-plan-by-r2-script" },
      to: { kind: "artifact", id: planId },
      rationale: "The R2 script attested its exact plan input.",
    }, {
      id: "consume-script-uses",
      relation: "uses",
      from: { kind: "consumption", id: "consume-script-by-r2-step" },
      to: { kind: "artifact", id: scriptId },
      rationale: "The R2 STEP attested its exact script input.",
    }],
    proposedActions: [],
  });
  const reader: Cm01V3ArchitectureCaptureReader = {
    read: (fingerprint) =>
      Promise.resolve(
        fingerprint.digest === architectureFingerprint.digest
          ? deterministicJson(capture)
          : undefined,
      ),
  };
  return { snapshot, capture, reader, architectureId, stepId };
}

// ── @3 presentation-mesh binding tests ───────────────────────────────────────

Deno.test("CM-01 V3 Product Structure binds @3 mesh artifacts to assembly and matching parts", async () => {
  const fixture = await v3Fixture();
  const capture64 = "c".repeat(64);
  const prefix = `coffee-machine-cm01-v3-cad-r3-${capture64}`;
  const assemblyMeshId = `${prefix}-mesh-assembly`;

  // Build a mesh artifact for the assembly and for drip-tray
  const meshArtifact = (key: string) => ({
    id: `${prefix}-mesh-${key}`,
    name: `CM-01 30 mm ${key} presentation STL`,
    kind: "mesh",
    version: capture64,
    fingerprint: fingerprint("c"),
    uri: `cm01-semantic-cad-r3-capture://test#coffee-machine-cm01-v3-r3-${key}.stl`,
    mediaType: "model/stl",
    producer: {
      serverId: "build123d",
      tool: "build123d_export",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  });

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      meshArtifact("assembly"),
      meshArtifact("drip-tray"),
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  // Assembly component must have the mesh binding AND a preview
  const assemblyComponent = catalog?.components[0];
  assertEquals(assemblyComponent?.id, "cm01-v3:coffee-machine");
  const assemblyMeshBinding = assemblyComponent?.bindings.find(
    (b) => b.provider === "build123d" && b.id === assemblyMeshId,
  );
  assertEquals(assemblyMeshBinding?.kind, "artifact");
  assertEquals(assemblyMeshBinding?.evidenceArtifactId, assemblyMeshId);
  assertEquals(assemblyComponent?.preview?.artifactId, assemblyMeshId);
  assertEquals(
    assemblyComponent?.preview?.url,
    "/api/thread/assets/coffee-machine-cm01-v3-r3-assembly.stl",
  );
  assertEquals(assemblyComponent?.preview?.sha256, "c".repeat(64));

  // DripTray component must have a build123d mesh binding AND a preview
  const dripTrayComponent = catalog?.components.find(
    (c) => c.id === "cm01-v3:drip-tray",
  );
  const dripTrayMeshId = `${prefix}-mesh-drip-tray`;
  const dripTrayMeshBinding = dripTrayComponent?.bindings.find(
    (b) => b.provider === "build123d",
  );
  assertEquals(dripTrayMeshBinding?.id, dripTrayMeshId);
  assertEquals(dripTrayMeshBinding?.evidenceArtifactId, dripTrayMeshId);
  assertEquals(dripTrayComponent?.preview?.artifactId, dripTrayMeshId);
  assertEquals(
    dripTrayComponent?.preview?.url,
    "/api/thread/assets/coffee-machine-cm01-v3-r3-drip-tray.stl",
  );

  // A part without a matching @3 mesh must have no build123d binding
  const enclosureComponent = catalog?.components.find(
    (c) => c.id === "cm01-v3:enclosure",
  );
  assertEquals(
    enclosureComponent?.bindings.some((b) => b.provider === "build123d"),
    false,
  );
  assertEquals(enclosureComponent?.preview, undefined);
});

Deno.test("CM-01 V3 Product Structure ignores @3 meshes from two different captures to remain fail-closed", async () => {
  const fixture = await v3Fixture();
  const prefixA = `coffee-machine-cm01-v3-cad-r3-${"a".repeat(64)}`;
  const prefixB = `coffee-machine-cm01-v3-cad-r3-${"b".repeat(64)}`;

  const meshArtifact = (prefix: string, key: string, char: string) => ({
    id: `${prefix}-mesh-${key}`,
    name: `CM-01 ${key} STL`,
    kind: "mesh",
    version: char.repeat(64),
    fingerprint: fingerprint(char),
    uri: `cm01-semantic-cad-r3-capture://test#coffee-machine-cm01-v3-r3-${key}.stl`,
    mediaType: "model/stl",
    producer: { serverId: "build123d", tool: "build123d_export", runId: "run" },
    inputArtifactIds: [],
    freshness: fresh(),
  });

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      meshArtifact(prefixA, "assembly", "a"),
      meshArtifact(prefixB, "drip-tray", "b"), // different capture prefix
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  // No @3 mesh binding on any component — the ambiguous set is ignored
  assertEquals(
    catalog?.components.some((c) => c.preview !== undefined),
    false,
  );
  assertEquals(
    catalog?.components.some((c) =>
      c.bindings.some((b) => b.provider === "build123d" && b.id.includes("-mesh-"))
    ),
    false,
  );
});

// ── @3 whole-assembly binding tests ──────────────────────────────────────────

Deno.test("CM-01 V3 Product Structure binds @3 whole-assembly plan, script, and STEP to assembly", async () => {
  const fixture = await v3Fixture();
  const captureDigest = "d".repeat(64);
  const prefix = `coffee-machine-cm01-v3-cad-r3-${captureDigest}`;

  const planArtifact = {
    id: `${prefix}-plan`,
    name: "CM-01 30 mm DripTray semantic CAD plan",
    kind: "document",
    version: captureDigest,
    fingerprint: fingerprint("d"),
    uri: `cm01-semantic-cad-r3://test#plan`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const scriptArtifact = {
    id: `${prefix}-script`,
    name: "CM-01 30 mm DripTray deterministic build123d script",
    kind: "script",
    version: captureDigest,
    fingerprint: fingerprint("d"),
    uri: `cm01-semantic-cad-r3://test#script`,
    mediaType: "text/x-python",
    producer: {
      serverId: "digital-thread",
      tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const stepArtifact = {
    id: `${prefix}-step`,
    name: "CM-01 30 mm DripTray assembly STEP export",
    kind: "step",
    version: captureDigest,
    fingerprint: fingerprint("d"),
    uri: `cm01-semantic-cad-r3://test#step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d",
      tool: "build123d_export",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      planArtifact,
      scriptArtifact,
      stepArtifact,
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  const assemblyComponent = catalog?.components[0];
  assertEquals(assemblyComponent?.id, "cm01-v3:coffee-machine");
  assertEquals(assemblyComponent?.kind, "assembly");

  // Plan binding: provider digital-thread, artifact kind
  const planBinding = assemblyComponent?.bindings.find(
    (b) => b.id === `${prefix}-plan`,
  );
  assertEquals(planBinding?.provider, "digital-thread");
  assertEquals(planBinding?.kind, "artifact");
  assertEquals(planBinding?.evidenceArtifactId, `${prefix}-plan`);

  // Script binding: provider digital-thread, artifact kind
  const scriptBinding = assemblyComponent?.bindings.find(
    (b) => b.id === `${prefix}-script`,
  );
  assertEquals(scriptBinding?.provider, "digital-thread");
  assertEquals(scriptBinding?.kind, "artifact");
  assertEquals(scriptBinding?.evidenceArtifactId, `${prefix}-script`);

  // STEP binding: provider build123d, artifact kind
  const stepBinding = assemblyComponent?.bindings.find(
    (b) => b.id === `${prefix}-step`,
  );
  assertEquals(stepBinding?.provider, "build123d");
  assertEquals(stepBinding?.kind, "artifact");
  assertEquals(stepBinding?.evidenceArtifactId, `${prefix}-step`);

  // Total component count unchanged: 11 (assembly + 10 parts)
  assertEquals(catalog?.components.length, 11);
});

Deno.test("CM-01 V3 Product Structure anchors @3 assembly STEP to assembly — not to any part", async () => {
  const fixture = await v3Fixture();
  const captureDigest = "e".repeat(64);
  const prefix = `coffee-machine-cm01-v3-cad-r3-${captureDigest}`;

  const stepArtifact = {
    id: `${prefix}-step`,
    name: "CM-01 30 mm DripTray assembly STEP export",
    kind: "step",
    version: captureDigest,
    fingerprint: fingerprint("e"),
    uri: `cm01-semantic-cad-r3://test#step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d",
      tool: "build123d_export",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const dripTrayMeshArtifact = {
    id: `${prefix}-mesh-drip-tray`,
    name: "CM-01 30 mm drip-tray presentation STL",
    kind: "mesh",
    version: captureDigest,
    fingerprint: fingerprint("e"),
    uri: `cm01-semantic-cad-r3://test#drip-tray.stl`,
    mediaType: "model/stl",
    producer: {
      serverId: "build123d",
      tool: "build123d_export",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      stepArtifact,
      dripTrayMeshArtifact,
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  // STEP must be anchored to the assembly
  const assemblyComponent = catalog?.components[0];
  assertEquals(assemblyComponent?.id, "cm01-v3:coffee-machine");
  const assemblyStepBinding = assemblyComponent?.bindings.find(
    (b) => b.id === `${prefix}-step`,
  );
  assertEquals(assemblyStepBinding?.provider, "build123d");
  assertEquals(assemblyStepBinding?.kind, "artifact");

  // STEP must NOT appear in any part binding
  const parts = catalog?.components.slice(1) ?? [];
  assertEquals(
    parts.some((c) => c.bindings.some((b) => b.id === `${prefix}-step`)),
    false,
  );

  // Drip-tray mesh must remain anchored to the drip-tray part
  const dripTrayComponent = catalog?.components.find(
    (c) => c.id === "cm01-v3:drip-tray",
  );
  const dripTrayMeshBinding = dripTrayComponent?.bindings.find(
    (b) => b.provider === "build123d",
  );
  assertEquals(dripTrayMeshBinding?.id, `${prefix}-mesh-drip-tray`);
  assertEquals(
    dripTrayMeshBinding?.evidenceArtifactId,
    `${prefix}-mesh-drip-tray`,
  );

  // Drip-tray mesh must NOT appear in the assembly bindings
  assertEquals(
    assemblyComponent?.bindings.some((b) => b.id === `${prefix}-mesh-drip-tray`),
    false,
  );
});

Deno.test("CM-01 V3 Product Structure withholds @3 whole-assembly bindings from two different captures", async () => {
  const fixture = await v3Fixture();
  const prefixA = `coffee-machine-cm01-v3-cad-r3-${"a".repeat(64)}`;
  const prefixB = `coffee-machine-cm01-v3-cad-r3-${"b".repeat(64)}`;

  const wholeAssemblyArtifact = (
    prefix: string,
    suffix: "plan" | "script" | "step",
    char: string,
  ) => ({
    id: `${prefix}-${suffix}`,
    name: `CM-01 ${suffix}`,
    kind: suffix === "plan" ? "document" : suffix,
    version: char.repeat(64),
    fingerprint: fingerprint(char),
    uri: `cm01-semantic-cad-r3://test#${suffix}`,
    mediaType: "application/octet-stream",
    producer: {
      serverId: suffix === "step" ? "build123d" : "digital-thread",
      tool: suffix === "step"
        ? "build123d_export"
        : "compile_coffee_machine_cm01_semantic_cad_plan_r2",
      runId: "run",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  });

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      wholeAssemblyArtifact(prefixA, "plan", "a"),
      wholeAssemblyArtifact(prefixB, "script", "b"), // different capture prefix
      wholeAssemblyArtifact(prefixA, "step", "a"),
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  const assemblyComponent = catalog?.components[0];
  // Ambiguous set is ignored: no whole-assembly bindings should appear
  assertEquals(
    assemblyComponent?.bindings.some((b) =>
      (b.id.endsWith("-plan") || b.id.endsWith("-script") ||
        b.id.endsWith("-step")) &&
      b.id.startsWith("coffee-machine-cm01-v3-cad-r3-")
    ),
    false,
  );
});

Deno.test("CM-01 V3 Product Structure ignores @3 whole-assembly artifact with wrong kind", async () => {
  const fixture = await v3Fixture();
  const captureDigest = "f".repeat(64);
  const prefix = `coffee-machine-cm01-v3-cad-r3-${captureDigest}`;

  // "plan" id but wrong kind: "script" instead of "document" → must be excluded
  const wrongKindPlan = {
    id: `${prefix}-plan`,
    name: "CM-01 wrong-kind plan",
    kind: "script", // expected "document"
    version: captureDigest,
    fingerprint: fingerprint("f"),
    uri: `cm01-semantic-cad-r3://test#plan`,
    mediaType: "text/x-python",
    producer: {
      serverId: "digital-thread",
      tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const stepArtifact = {
    id: `${prefix}-step`,
    name: "CM-01 assembly STEP",
    kind: "step",
    version: captureDigest,
    fingerprint: fingerprint("f"),
    uri: `cm01-semantic-cad-r3://test#step`,
    mediaType: "model/step",
    producer: {
      serverId: "build123d",
      tool: "build123d_export",
      runId: "run:r3",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      wrongKindPlan,
      stepArtifact,
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  // The wrong-kind plan must NOT appear in any binding
  const assemblyComponent = catalog?.components[0];
  assertEquals(
    assemblyComponent?.bindings.some((b) => b.id === `${prefix}-plan`),
    false,
  );
  // The step from the same prefix must still be present (only plan is wrong)
  const stepBinding = assemblyComponent?.bindings.find(
    (b) => b.id === `${prefix}-step`,
  );
  assertEquals(stepBinding?.provider, "build123d");
});

// ── Part-definition artifact binding tests (US-3) ────────────────────────────

Deno.test("CM-01 V3 Product Structure falls back to architecture id when no part-definition artifacts are present", async () => {
  // Baseline fixture has no part-definition artifacts; every binding should use
  // architecture.id — exact same behaviour as before US-3.
  const fixture = await v3Fixture();
  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    fixture.snapshot,
    fixture.reader,
  );

  assertEquals(catalog?.components.length, 11);
  for (const component of catalog?.components ?? []) {
    const sysonBinding = component.bindings.find(
      (b) => b.provider === "syson" && b.kind === "part-definition",
    );
    assertEquals(
      sysonBinding?.evidenceArtifactId,
      fixture.architectureId,
      `Component ${component.id} must fall back to architecture.id`,
    );
  }
});

Deno.test("CM-01 V3 Product Structure leaves label-only part-definition artifacts unanchored", async () => {
  const fixture = await v3Fixture();

  const cmPartDefId = "part-definition-coffee-machine-" + "a".repeat(64);
  const dtPartDefId = "part-definition-drip-tray-" + "b".repeat(64);

  const cmPartDefArtifact = {
    id: cmPartDefId,
    name: "CM-01 CoffeeMachine part definition",
    kind: "sysml-model",
    version: "a".repeat(64),
    fingerprint: fingerprint("a"),
    uri: `casys://part-definitions-capture/sha256/${"a".repeat(64)}`,
    producer: {
      serverId: "syson",
      tool: "syson_part_structure",
      runId: "run:part-def",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  const dtPartDefArtifact = {
    id: dtPartDefId,
    name: "CM-01 DripTray part definition",
    kind: "sysml-model",
    version: "b".repeat(64),
    fingerprint: fingerprint("b"),
    uri: `casys://part-definitions-capture/sha256/${"b".repeat(64)}`,
    producer: {
      serverId: "syson",
      tool: "syson_part_structure",
      runId: "run:part-def",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };

  const snapshot = validateThreadSnapshot({
    ...fixture.snapshot,
    artifacts: [
      ...fixture.snapshot.artifacts,
      cmPartDefArtifact,
      dtPartDefArtifact,
    ],
  });

  const catalog = await resolveCoffeeMachineCm01V3ProductStructureCatalog(
    snapshot,
    fixture.reader,
  );

  assertEquals(catalog?.components.length, 11);

  // Names alone are not SysON identity. These artifacts have no matching
  // hashed capture record, so the catalog must retain architecture evidence.
  const cmComponent = catalog?.components[0];
  assertEquals(cmComponent?.id, "cm01-v3:coffee-machine");
  const cmSysonBinding = cmComponent?.bindings.find(
    (b) => b.provider === "syson" && b.kind === "part-definition",
  );
  assertEquals(cmSysonBinding?.evidenceArtifactId, fixture.architectureId);

  // Ditto for DripTray: a label-only match is deliberately not a join key.
  const dtComponent = catalog?.components.find(
    (c) => c.id === "cm01-v3:drip-tray",
  );
  const dtSysonBinding = dtComponent?.bindings.find(
    (b) => b.provider === "syson" && b.kind === "part-definition",
  );
  assertEquals(dtSysonBinding?.evidenceArtifactId, fixture.architectureId);

  // The 9 other parts must still fall back to architecture.id.
  const otherParts = catalog?.components.slice(1).filter(
    (c) => c.id !== "cm01-v3:drip-tray",
  ) ?? [];
  assertEquals(otherParts.length, 9);
  for (const component of otherParts) {
    const sysonBinding = component.bindings.find(
      (b) => b.provider === "syson" && b.kind === "part-definition",
    );
    assertEquals(
      sysonBinding?.evidenceArtifactId,
      fixture.architectureId,
      `Part ${component.id} must still use architecture.id`,
    );
  }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: AT,
    invalidatedByChangeIds: [],
  };
}

function semanticKey(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
