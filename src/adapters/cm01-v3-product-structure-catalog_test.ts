import { assertEquals, assertStringIncludes } from "@std/assert";
import { deterministicJson, sha256Fingerprint } from "../domain/deterministic-json.ts";
import type { ThreadSnapshot } from "../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../domain/thread-snapshot-validation.ts";
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

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function semanticKey(label: string): string {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
