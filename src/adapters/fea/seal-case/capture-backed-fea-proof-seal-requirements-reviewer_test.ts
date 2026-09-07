/**
 * Capture-backed proof-seal requirements admission: extra non-mechanical
 * units may coexist; every declared criterion and every capture row whose
 * unit is a V1 mechanical proof unit must still match exactly, including
 * when SysON feature names are arbitrary.
 */
import { assertEquals } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { MechanicalProofCase } from "../../../domain/fea/seal-case/mechanical-proof-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  REQUIREMENTS_CAPTURE_SCHEMA,
  REQUIREMENTS_RECAPTURE_SCHEMA,
  REQUIREMENTS_TRACED_CAPTURE_SCHEMA,
  REQUIREMENTS_TRACED_RECAPTURE_SCHEMA,
} from "../../architecture/requirements/requirements-capture.ts";
import { CaptureBackedFeaProofSealRequirementsReviewer } from "./capture-backed-fea-proof-seal-requirements-reviewer.ts";

const TARGET_ELEMENT_ID = "part-definition:plate";
const REQUIREMENTS_ELEMENT_ID = "requirement-usage:plate";
const EDITING_CONTEXT_ID = "editing-context:plate";
const COMPONENT = "StagePlate";
const REQ_DIGEST = "c".repeat(64);
const SEED_DIGEST = "d".repeat(64);
const ARTIFACT_ID = "artifact:requirements-plate";

const DISPLACEMENT = {
  id: "plate-deflection",
  name: "Maximum displacement",
  metric: "arm_max_displacement",
  operator: "<=" as const,
  limit: { value: 1, unit: "mm" as const },
};
const STRESS = {
  id: "plate-stress",
  name: "Maximum von Mises",
  metric: "arm_max_von_mises",
  operator: "<=" as const,
  limit: { value: 80_000_000, unit: "Pa" as const },
};
const UNRELATED = {
  id: "plate-temperature",
  name: "Maximum surface temperature",
  metric: "maxSurfaceTemperature",
  operator: "<=" as const,
  limit: { value: 373, unit: "K" },
};

Deno.test(
  "proof-seal requirements review accepts a V4 recapture of the same native identities",
  async () => {
    const result = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      recapture: true,
    });
    assertEquals(result.status, "resolved");
  },
);

Deno.test(
  "proof-seal requirements review admits continuous V6 provenance and refuses its drift",
  async () => {
    const continuous = await tracedV6Fixture(false);
    const resolved = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      snapshot: continuous.snapshot,
      captures: continuous.captures,
    });
    assertEquals(resolved.status, "resolved");

    const drifted = await tracedV6Fixture(true);
    const unresolved = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      snapshot: drifted.snapshot,
      captures: drifted.captures,
    });
    assertEquals(unresolved.status, "unresolved");
    if (unresolved.status === "unresolved") {
      assertEquals(unresolved.diagnostics[0]?.code, "requirements-capture-invalid");
    }

    const dishonest = await tracedV6Fixture(false);
    const misleadingPredecessor = JSON.parse(
      dishonest.captures[dishonest.predecessorFingerprint.digest]!,
    ) as Record<string, unknown>;
    misleadingPredecessor.insertedAt = "2026-08-09T12:15:00.000Z";
    const misleading = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      snapshot: dishonest.snapshot,
      captures: {
        ...dishonest.captures,
        [dishonest.predecessorFingerprint.digest]: deterministicJson(
          misleadingPredecessor,
        ),
      },
    });
    assertEquals(misleading.status, "unresolved");
  },
);

Deno.test(
  "proof-seal requirements review selects the active family tip when old3 and v4 share native identities",
  async () => {
    const oldDigest = "1".repeat(64);
    const newDigest = REQ_DIGEST;
    const oldArtifact: ThreadArtifact = {
      id: "artifact:requirements-plate-old",
      name: `${COMPONENT} requirements`,
      kind: "sysml-model",
      version: oldDigest,
      fingerprint: { algorithm: "sha256", digest: oldDigest },
      uri: `casys://requirements-capture/${COMPONENT}/sha256/${oldDigest}`,
      mediaType: "application/json",
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:requirements",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: "2026-08-16T00:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    };
    const newArtifact: ThreadArtifact = {
      ...oldArtifact,
      id: ARTIFACT_ID,
      version: newDigest,
      fingerprint: { algorithm: "sha256", digest: newDigest },
      uri: `casys://requirements-capture/${COMPONENT}/sha256/${newDigest}`,
      producer: {
        serverId: "syson",
        tool: "syson_constraint_extract",
        runId: "run:requirements-recapture",
      },
      inputArtifactIds: [oldArtifact.id],
    };
    const result = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      recapture: true,
      snapshot: threadSnapshot({ artifacts: [oldArtifact, newArtifact] }),
      captures: {
        [oldDigest]: JSON.stringify(
          requirementsCapture([DISPLACEMENT, STRESS], false),
        ),
        [newDigest]: JSON.stringify(
          requirementsCapture([DISPLACEMENT, STRESS], true),
        ),
      },
    });
    assertEquals(result.status, "resolved");
    if (result.status === "resolved") {
      assertEquals(result.artifact.id, ARTIFACT_ID);
    }
  },
);

Deno.test(
  "proof-seal requirements review refuses two active tips with the same native identities",
  async () => {
    const otherDigest = "2".repeat(64);
    const left = threadSnapshot().artifacts[0]!;
    const right: ThreadArtifact = {
      ...left,
      id: "artifact:requirements-other",
      version: otherDigest,
      fingerprint: { algorithm: "sha256", digest: otherDigest },
      uri: `casys://requirements-capture/OtherPlate/sha256/${otherDigest}`,
      producer: {
        serverId: "syson",
        tool: "syson_element_insert_sysml",
        runId: "run:requirements-other",
      },
    };
    const otherCapture = {
      ...requirementsCapture([DISPLACEMENT, STRESS], false),
      containerComponent: "OtherPlate",
      target: {
        kind: "part-definition",
        label: "OtherPlate",
        elementId: TARGET_ELEMENT_ID,
      },
    };
    const result = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      snapshot: threadSnapshot({ artifacts: [left, right] }),
      captures: {
        [REQ_DIGEST]: JSON.stringify(
          requirementsCapture([DISPLACEMENT, STRESS], false),
        ),
        [otherDigest]: JSON.stringify(otherCapture),
      },
    });
    assertEquals(result.status, "unresolved");
    if (result.status === "unresolved") {
      assertEquals(result.diagnostics[0]?.code, "requirements-ambiguous");
    }
  },
);

Deno.test(
  "proof-seal requirements review refuses a forged producer/operation pair on the active tip",
  async () => {
    const result = await review({
      captured: [DISPLACEMENT, STRESS],
      declared: [displacementProof(), stressProof()],
      recapture: true,
      producerTool: "syson_element_insert_sysml",
    });
    assertEquals(result.status, "unresolved");
    if (result.status === "unresolved") {
      assertEquals(result.diagnostics[0]?.code, "requirements-component-mismatch");
    }
  },
);

Deno.test(
  "proof-seal requirements review accepts an unrelated extra capture criterion on the same component",
  async () => {
    const result = await review({
      captured: [DISPLACEMENT, STRESS, UNRELATED],
      declared: [displacementProof(), stressProof()],
    });
    assertEquals(result.status, "resolved");
    if (result.status === "resolved") {
      assertEquals(result.artifact.id, ARTIFACT_ID);
    }
  },
);

Deno.test(
  "proof-seal requirements review refuses an omitted mechanical criterion even when its SysON feature is arbitrary",
  async () => {
    const result = await review({
      captured: [DISPLACEMENT, STRESS, UNRELATED],
      declared: [displacementProof()],
    });
    assertEquals(result.status, "unresolved");
    if (result.status === "unresolved") {
      assertEquals(result.diagnostics.map((item) => item.code), [
        "requirements-capture-invalid",
      ]);
    }
  },
);

Deno.test(
  "proof-seal requirements review refuses a mismatched mechanical criterion",
  async () => {
    const result = await review({
      captured: [{ ...DISPLACEMENT, limit: { value: 5, unit: "mm" } }, STRESS],
      declared: [displacementProof(), stressProof()],
    });
    assertEquals(result.status, "unresolved");
    if (result.status === "unresolved") {
      assertEquals(result.diagnostics.map((item) => item.code), [
        "requirements-capture-invalid",
      ]);
    }
  },
);

async function review(input: {
  readonly captured: readonly CaptureRequirement[];
  readonly declared: MechanicalProofCase["requirements"];
  readonly recapture?: boolean;
  readonly snapshot?: ThreadSnapshot;
  readonly captures?: Readonly<Record<string, string>>;
  readonly producerTool?: string;
}) {
  const captureText = JSON.stringify(
    requirementsCapture(input.captured, input.recapture === true),
  );
  const reviewer = new CaptureBackedFeaProofSealRequirementsReviewer({
    requirementsCaptures: memoryReader(
      input.captures ?? { [REQ_DIGEST]: captureText },
    ),
    seedCaptures: memoryReader({ [SEED_DIGEST]: JSON.stringify(seedCapture()) }),
  });
  return await reviewer.review({
    snapshot: input.snapshot ??
      threadSnapshot({
        recapture: input.recapture === true,
        producerTool: input.producerTool,
      }),
    proofCase: proofCase(input.declared),
  });
}

interface CaptureRequirement {
  readonly id: string;
  readonly name: string;
  readonly metric: string;
  readonly operator: "<=";
  readonly limit: { readonly value: number; readonly unit: string };
}

function displacementProof(): MechanicalProofCase["requirements"][number] {
  return {
    id: "proof-deflection",
    name: "maxDisplacement",
    metric: "maximum-displacement",
    feature: DISPLACEMENT.metric,
    operator: "<=",
    limit: DISPLACEMENT.limit,
  };
}

function stressProof(): MechanicalProofCase["requirements"][number] {
  return {
    id: "proof-stress",
    name: "maxVonMises",
    metric: "maximum-von-mises-stress",
    feature: STRESS.metric,
    operator: "<=",
    limit: STRESS.limit,
  };
}

function proofCase(
  requirements: MechanicalProofCase["requirements"],
): MechanicalProofCase {
  return {
    target: { modelElementId: TARGET_ELEMENT_ID },
    requirementsSource: {
      editingContextId: EDITING_CONTEXT_ID,
      elementId: REQUIREMENTS_ELEMENT_ID,
    },
    requirements,
  } as MechanicalProofCase;
}

function requirementsCapture(
  requirements: readonly CaptureRequirement[],
  recapture = false,
) {
  const common = {
    trustedRunId: "run:requirements",
    containerComponent: COMPONENT,
    partDefName: `${COMPONENT}Requirements`,
    target: {
      kind: "part-definition",
      label: COMPONENT,
      elementId: TARGET_ELEMENT_ID,
    },
    architectureBasis: {
      snapshotId: "thread:plate:r2",
      revision: 2,
      fingerprint: "a".repeat(64),
    },
    requirements,
    seed: {
      artifactId: "artifact:seed",
      fingerprint: { algorithm: "sha256", digest: SEED_DIGEST },
      producerRunId: "run:seed",
    },
    architecture: {
      artifactId: "artifact:architecture",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run:architecture",
    },
    requirementsElementId: REQUIREMENTS_ELEMENT_ID,
    requirementUsage: {
      id: REQUIREMENTS_ELEMENT_ID,
      kind: "RequirementUsage",
    },
    constraintUsages: requirements.map((requirement) => ({
      requirementId: requirement.id,
      id: `constraint-usage:${requirement.id}`,
      kind: "ConstraintUsage",
      sourceId: `constraint-usage:${requirement.id}`,
    })),
  };
  if (!recapture) {
    return {
      schemaVersion: REQUIREMENTS_CAPTURE_SCHEMA,
      operation: { id: "model.write-requirements", version: "1" },
      ...common,
      insertedAt: "2026-08-08T12:15:00.000Z",
    };
  }
  return {
    schemaVersion: REQUIREMENTS_RECAPTURE_SCHEMA,
    operation: { id: "model.recapture-requirements", version: "1" },
    ...common,
    predecessor: {
      artifactId: "artifact:prior-requirements",
      fingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
      producerRunId: "run:requirements",
    },
    capturedAt: "2026-09-07T12:00:00.000Z",
    subject: {
      id: "reference-usage:plate-target",
      kind: "ReferenceUsage",
      name: "target",
    },
  };
}

async function tracedV6Fixture(drift: boolean): Promise<{
  readonly snapshot: ThreadSnapshot;
  readonly captures: Readonly<Record<string, string>>;
  readonly predecessorFingerprint: ContentFingerprint;
}> {
  const tracedRequirements = [DISPLACEMENT, STRESS].map((requirement) => ({
    ...requirement,
    id: requirement.metric,
  }));
  const v5: Record<string, unknown> = {
    ...requirementsCapture(tracedRequirements, false),
    schemaVersion: REQUIREMENTS_TRACED_CAPTURE_SCHEMA,
    operation: { id: "model.write-requirements", version: "2" },
    trustedRunId: "run:requirements-v5",
    briefProvenance: tracedBriefProvenance(tracedRequirements, "brief:canonical"),
  };
  const v5Text = deterministicJson(v5);
  const predecessorFingerprint = await sha256Fingerprint(v5);
  const { insertedAt: _insertedAt, ...v6Common } = v5;
  const v6 = {
    ...v6Common,
    schemaVersion: REQUIREMENTS_TRACED_RECAPTURE_SCHEMA,
    operation: { id: "model.recapture-requirements", version: "2" },
    trustedRunId: "run:requirements",
    predecessor: {
      artifactId: "artifact:requirements-plate-v5",
      fingerprint: predecessorFingerprint,
      producerRunId: "run:requirements-v5",
    },
    capturedAt: "2026-09-07T12:00:00.000Z",
    subject: {
      id: "reference-usage:plate-target",
      kind: "ReferenceUsage",
      name: "target",
    },
    briefProvenance: tracedBriefProvenance(
      tracedRequirements,
      drift ? "brief:forged" : "brief:canonical",
    ),
  };
  const v6Text = deterministicJson(v6);
  const currentFingerprint = await sha256Fingerprint(v6);
  const predecessor: ThreadArtifact = {
    ...threadSnapshot().artifacts[0]!,
    id: "artifact:requirements-plate-v5",
    version: predecessorFingerprint.digest,
    fingerprint: predecessorFingerprint,
    uri:
      `casys://requirements-capture/${COMPONENT}/sha256/${predecessorFingerprint.digest}`,
    producer: {
      serverId: "syson",
      tool: "model.write-requirements@2",
      runId: "run:requirements-v5",
    },
  };
  const current: ThreadArtifact = {
    ...threadSnapshot().artifacts[0]!,
    id: ARTIFACT_ID,
    producer: {
      serverId: "syson",
      tool: "model.recapture-requirements@2",
      runId: "run:requirements",
    },
    version: currentFingerprint.digest,
    fingerprint: currentFingerprint,
    uri:
      `casys://requirements-capture/${COMPONENT}/sha256/${currentFingerprint.digest}`,
    inputArtifactIds: [predecessor.id],
  };
  return {
    snapshot: threadSnapshot({ artifacts: [predecessor, current] }),
    captures: {
      [predecessorFingerprint.digest]: v5Text,
      [currentFingerprint.digest]: v6Text,
    },
    predecessorFingerprint,
  };
}

function tracedBriefProvenance(
  requirements: readonly CaptureRequirement[],
  sourceItemId: string,
) {
  return {
    schemaVersion: "requirements-brief-provenance/1.0",
    briefBasis: {
      kind: "approved-brief",
      projectId: "project:plate",
      projectSnapshotId: "project:plate:r1",
      projectRevision: 1,
      briefId: "brief:plate",
      briefSnapshotId: "brief:plate:r1",
      briefRevision: 1,
      approvedBriefFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
    },
    briefContentFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    container: {
      sourceItem: {
        id: "brief:container",
        kind: "objective",
        statement: "Constrain the plate.",
        sourceRefs: [{ kind: "intent", reference: "conversation:plate" }],
      },
    },
    requirements: requirements.map((requirement) => ({
      requirementId: requirement.id,
      sourceItem: {
        id: sourceItemId,
        kind: "success-criterion",
        statement: `Constrain ${requirement.metric}.`,
        sourceRefs: [{ kind: "document", reference: "brief:plate" }],
      },
      declaredThreshold: requirement.limit,
      transformation: "identity",
    })),
  };
}

function seedCapture() {
  return {
    schemaVersion: "syson-model-seed-capture/2.0",
    kind: "syson-model-seed",
    scope: "sysml-container-identity",
    statement:
      "Immutable normalized identity record of a newly created SysON project, SysML document, and root package. It does not capture model semantics, requirements, CAD, simulation, measurements, or verification verdicts.",
    capturedAt: "2026-08-09T10:00:00.000Z",
    trustedRunId: "run:seed",
    operation: { id: "architecture.seed-syson-model", version: "2" },
    lineage: {
      approvedBriefBasis: {
        kind: "approved-brief",
        projectId: "plate-proof",
        projectSnapshotId: "proj-snap-seed",
        projectRevision: 1,
        briefId: "brief-001",
        briefSnapshotId: "brief-snap-001",
        briefRevision: 1,
        approvedBriefFingerprint: {
          algorithm: "sha256",
          digest: "1".repeat(64),
        },
      },
      plan: {
        publishedAt: "2026-08-09T10:00:00.000Z",
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      projectChange: {
        id: "change-001",
        commandId: "cmd-001",
        publishedAt: "2026-08-09T10:01:00.000Z",
        publishedBy: { id: "agent:test", origin: "agent" },
      },
      workItemId: "work-001",
      baseSnapshot: {
        snapshotId: "snap-r1",
        revision: 1,
        subjectId: "project:plate-proof",
      },
      documentaryArtifact: {
        id: "doc-artifact-001",
        fingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
        uri: `casys://approved-brief-capture/sha256/${"2".repeat(64)}`,
        producerRunId: "run-baseline",
      },
    },
    provider: {
      serverId: "syson",
      tools: {
        projectCreate: "syson_project_create",
        modelCreate: "syson_model_create",
        rootPackageGet: "syson_element_get",
      },
    },
    normalizedResults: {
      project: {
        id: "syson-proj",
        name: "Plate Proof",
        editingContextId: EDITING_CONTEXT_ID,
      },
      document: { id: "syson-doc", name: "Plate", kind: "SysML" },
      rootPackage: { id: "syson-pkg", kind: "Package", label: "Plate" },
    },
  };
}

function threadSnapshot(options: {
  readonly recapture?: boolean;
  readonly producerTool?: string;
  readonly artifacts?: ThreadArtifact[];
} = {}): ThreadSnapshot {
  const digest = REQ_DIGEST;
  const artifact: ThreadArtifact = {
    id: ARTIFACT_ID,
    name: `${COMPONENT} requirements`,
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://requirements-capture/${COMPONENT}/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: options.producerTool ??
        (options.recapture ? "syson_constraint_extract" : "syson_element_insert_sysml"),
      runId: "run:requirements",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-16T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
  return {
    artifacts: options.artifacts ?? [artifact],
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;
}

function memoryReader(
  captures: Readonly<Record<string, string>>,
): { read(fingerprint: ContentFingerprint): Promise<string | undefined> } {
  return {
    read: (fingerprint) => Promise.resolve(captures[fingerprint.digest]),
  };
}
