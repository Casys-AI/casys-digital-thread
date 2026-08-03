import { assertEquals, assertRejects } from "@std/assert";
import {
  INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS,
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
  INSPECTION_DRONE_ARCHITECTURE_V3_CAPTURE_SCHEMA,
  INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION,
  InspectionDroneArchitectureReadbackError,
  inspectionDroneArchitectureSysmlFingerprint,
  materializeInspectionDroneArchitecture,
  validateInspectionDroneArchitectureReadback,
} from "./inspection-drone-architecture.ts";
import { materializeSysonModelSeed } from "./syson-model-seed.ts";
import type { ThreadSnapshot } from "./thread-snapshot.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

Deno.test("inspection-drone architecture accepts only the reviewed SysML acknowledgement and readback", async () => {
  const result = await validateInspectionDroneArchitectureReadback(happyPath());

  assertEquals(result.insertion, {
    inserted: true,
    parentId: "root-package-012",
    textSha256: await inspectionDroneArchitectureSysmlFingerprint(),
  });
  assertEquals(result.architecturePackage, {
    id: "architecture-package-123",
    kind: "sysml::Package",
    label: "InspectionDroneArchitecture",
  });
  assertEquals(
    result.declarations.map((item) => item.label).sort(),
    [...INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS].sort(),
  );
});

Deno.test("inspection-drone architecture never accepts caller-altered SysML text", async () => {
  const input = happyPath();
  (input.insertionResult as { text: string }).text =
    `${INSPECTION_DRONE_ARCHITECTURE_SYSML}\n`;

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(input),
    InspectionDroneArchitectureReadbackError,
    "exactly match the reviewed SysML recipe",
  );
});

Deno.test("inspection-drone architecture rejects ambiguous or incomplete post-write reads", async () => {
  const ambiguousRoot = happyPath();
  (ambiguousRoot.rootChildrenResult as { children: unknown[]; count: number }).children
    .push({ id: "manual-package", kind: "Package", label: "ManualEdit" });
  (ambiguousRoot.rootChildrenResult as { count: number }).count = 2;

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(ambiguousRoot),
    InspectionDroneArchitectureReadbackError,
    "exactly one post-insert architecture package",
  );

  const incompleteDeclarations = happyPath();
  (incompleteDeclarations.architectureChildrenResult as {
    children: unknown[];
    count: number;
  }).children.pop();
  (incompleteDeclarations.architectureChildrenResult as { count: number }).count =
    INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.length - 1;

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(incompleteDeclarations),
    InspectionDroneArchitectureReadbackError,
    "must contain exactly",
  );
});

Deno.test("inspection-drone architecture requires reviewed SysML semantic kinds", async () => {
  const wrongRequirementKind = happyPath();
  const requirement = (wrongRequirementKind.architectureChildrenResult as {
    children: Array<{ label: string; kind: string }>;
  }).children.find((child) => child.label === "Requirements")!;
  requirement.kind = "siriusComponents://semantic?domain=sysml&entity=RequirementUsage";

  await assertRejects(
    () => validateInspectionDroneArchitectureReadback(wrongRequirementKind),
    InspectionDroneArchitectureReadbackError,
    "must identify a SysML Package",
  );
});

Deno.test("inspection-drone architecture accepts SysON Sirius semantic URIs", async () => {
  const input = happyPath();
  (input.rootChildrenResult as {
    children: Array<{ kind: string }>;
  }).children[0]!.kind = "siriusComponents://semantic?domain=sysml&entity=Package";
  (input.architectureChildrenResult as {
    children: Array<{ label: string; kind: string }>;
  }).children.forEach((child) => {
    child.kind = `siriusComponents://semantic?domain=sysml&entity=${
      child.label === "Requirements" ? "Package" : "PartDefinition"
    }`;
  });

  const result = await validateInspectionDroneArchitectureReadback(input);
  assertEquals(
    result.declarations.length,
    INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.length,
  );
});

Deno.test("inspection-drone architecture materializes only normalized r3 evidence from exact r2", async () => {
  const seed = await seededR2();
  const input = happyPath();
  const readback = await validateInspectionDroneArchitectureReadback(input);
  const result = await materializeInspectionDroneArchitecture({
    base: seed.snapshot,
    seedCapture: seed.capture,
    trustedRunId: "run:author-inspection-drone",
    capturedAt: "2026-08-03T08:00:00.000Z",
    insertion: readback.insertion,
    rootChildrenResult: input.rootChildrenResult,
    architectureChildrenResult: input.architectureChildrenResult,
    operation: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION,
    authorization: v3Authorization(seed.snapshot),
  });

  const artifact = result.snapshot.artifacts.at(-1)!;
  assertEquals(result.snapshot.revision, 3);
  assertEquals(result.snapshot.previous, {
    snapshotId: seed.snapshot.id,
    revision: 2,
  });
  assertEquals(artifact.kind, "sysml-model");
  assertEquals(artifact.inputArtifactIds, [seed.snapshot.artifacts.at(-1)!.id]);
  assertEquals(result.snapshot.consumptions.length, 1);
  assertEquals(
    result.snapshot.provenance.some((link) => link.relation === "derived_from"),
    true,
  );
  assertEquals(result.capture.insertion, readback.insertion);
  assertEquals(
    result.capture.schemaVersion,
    INSPECTION_DRONE_ARCHITECTURE_V3_CAPTURE_SCHEMA,
  );
  assertEquals(result.capture.operation, INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION);
  assertEquals(result.text.includes("approved-discovery"), false);
  assertEquals(result.text.includes(INSPECTION_DRONE_ARCHITECTURE_SYSML), false);
  assertEquals(result.snapshot.requirements, []);
  assertEquals(result.snapshot.evaluations, []);
  assertEquals(result.snapshot.violations, []);
  assertEquals(result.snapshot.proposedActions, []);
});

Deno.test("inspection-drone architecture materializer rejects a seed capture that does not match r2", async () => {
  const seed = await seededR2();
  const input = happyPath();
  const readback = await validateInspectionDroneArchitectureReadback(input);
  const mismatchedSeed = {
    ...structuredClone(seed.capture),
    normalizedResults: {
      ...seed.capture.normalizedResults,
      rootPackage: {
        ...seed.capture.normalizedResults.rootPackage,
        id: "other-root",
      },
    },
  };

  await assertRejects(
    () =>
      materializeInspectionDroneArchitecture({
        base: seed.snapshot,
        seedCapture: mismatchedSeed,
        trustedRunId: "run:author-inspection-drone",
        capturedAt: "2026-08-03T08:00:00.000Z",
        insertion: readback.insertion,
        rootChildrenResult: input.rootChildrenResult,
        architectureChildrenResult: input.architectureChildrenResult,
        operation: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION,
        authorization: v3Authorization(seed.snapshot),
      }),
    Error,
    "does not exactly match",
  );
});

function happyPath() {
  const architecturePackage = {
    id: "architecture-package-123",
    kind: "sysml::Package",
    label: "InspectionDroneArchitecture",
  };
  return {
    rootPackageId: "root-package-012",
    insertionResult: {
      inserted: true,
      parentId: "root-package-012",
      text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
    },
    rootChildrenResult: {
      parentId: "root-package-012",
      children: [architecturePackage],
      count: 1,
    },
    architectureChildrenResult: {
      parentId: architecturePackage.id,
      children: INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.map((label, index) => ({
        id: `declaration-${index}`,
        kind: label === "Requirements" ? "sysml::Package" : "sysml::PartDefinition",
        label,
      })),
      count: INSPECTION_DRONE_ARCHITECTURE_DECLARATIONS.length,
    },
  };
}

async function seededR2() {
  const base = documentaryBaseline();
  return await materializeSysonModelSeed({
    base,
    lineage: seedLineage(base),
    trustedRunId: "run:seed-syson-model",
    capturedAt: "2026-08-02T12:10:00.000Z",
    projectCreateResult: {
      id: "project-123",
      name: "Drone concept",
      editingContextId: "editing-context-456",
    },
    modelCreateResult: {
      documentId: "document-789",
      documentName: "Drone system model",
      documentKind: "Document",
      rootPackageId: "root-package-012",
      rootPackageLabel: "Drone system model",
    },
    rootPackageGetResult: {
      id: "root-package-012",
      kind: "sysml::Package",
      label: "Drone system model",
    },
  });
}

function documentaryBaseline(): ThreadSnapshot {
  const digest = "a".repeat(64);
  const artifactId = `approved-brief-document-${digest}`;
  const changeSetId = `approved-brief-baseline-${digest}`;
  const changeId = `${changeSetId}:record-document`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `project:drone-concept:r1:${changeSetId}`,
    revision: 1,
    generatedAt: "2026-08-02T12:00:00.000Z",
    subject: {
      id: "project:drone-concept",
      name: "Drone concept",
      kind: "system",
      version: digest,
      modelArtifactId: artifactId,
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-02T12:00:00.000Z",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: changeSetId,
      name: "Record approved project brief documentary baseline",
      status: "applied",
      createdAt: "2026-08-02T12:00:00.000Z",
      appliedAt: "2026-08-02T12:00:00.000Z",
      changes: [{
        id: changeId,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Recorded documentary baseline.",
        afterFingerprint: { algorithm: "sha256", digest },
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Approved project brief documentary baseline (pre-technical)",
      kind: "document",
      version: digest,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://approved-brief-capture/sha256/${digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "casys-digital-thread",
        tool: "baseline_from_approved_brief",
        runId: "run:approved-brief-baseline",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: "2026-08-02T12:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `${changeSetId}:changes:${artifactId}`,
      relation: "changes",
      from: { kind: "change", id: changeId },
      to: { kind: "artifact", id: artifactId },
      rationale: "This records the documentary pre-technical baseline.",
    }],
    proposedActions: [],
  });
}

const APPROVED_BRIEF_BASIS = {
  kind: "approved-brief" as const,
  projectId: "drone-concept",
  projectSnapshotId: "project:drone-concept:r4",
  projectRevision: 4,
  briefId: "brief:drone-concept",
  briefSnapshotId: "brief:drone-concept:r1",
  briefRevision: 1,
  approvedBriefFingerprint: {
    algorithm: "sha256" as const,
    digest: "b".repeat(64),
  },
};

const APPROVED_BRIEF = {
  briefId: APPROVED_BRIEF_BASIS.briefId,
  id: APPROVED_BRIEF_BASIS.briefSnapshotId,
  revision: 1,
  items: [{
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Perform controlled visual inspection with a light camera.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:turn-1" }],
  }],
  proposedAt: "2026-08-02T11:55:00.000Z",
  proposedBy: { id: "agent:guide", origin: "agent" as const },
};

function seedLineage(base: ThreadSnapshot) {
  const document = base.artifacts[0]!;
  return {
    approvedBriefBasis: APPROVED_BRIEF_BASIS,
    plan: {
      publishedAt: "2026-08-02T11:58:00.000Z",
      publishedBy: { id: "agent:guide", origin: "agent" as const },
    },
    projectChange: {
      id: "change:append-syson-seed",
      commandId: "append-syson-seed",
      publishedAt: "2026-08-02T12:05:00.000Z",
      publishedBy: { id: "agent:guide", origin: "agent" as const },
    },
    workItemId: "seed-syson-model",
    baseSnapshot: {
      snapshotId: base.id,
      revision: base.revision,
      subjectId: base.subject.id,
    },
    documentaryArtifact: {
      id: document.id,
      fingerprint: document.fingerprint,
      uri: document.uri!,
      producerRunId: document.producer.runId,
    },
  };
}

function v3Authorization(base: ThreadSnapshot) {
  const document = base.artifacts.find((artifact) => artifact.kind === "document")!;
  return {
    projectId: APPROVED_BRIEF_BASIS.projectId,
    approvedBriefBasis: APPROVED_BRIEF_BASIS,
    approvedBrief: APPROVED_BRIEF,
    documentaryBaseline: {
      snapshotId: base.previous!.snapshotId,
      revision: 1 as const,
      subjectId: base.subject.id,
      artifactId: document.id,
      fingerprint: document.fingerprint,
    },
  };
}
