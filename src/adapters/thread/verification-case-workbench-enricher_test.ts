import { assertEquals } from "@std/assert";
import type {
  ThreadArtifact,
  ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  canonicalProofText,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../domain/fea/seal-case/mechanical-proof-case.ts";
import { FEA_PROOF_CASE_CAPTURE_SCHEMA } from "../../domain/fea/seal-case/fea-proof-case-capture.ts";
import {
  SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
  SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX,
} from "../sensitivity/study/sensitivity-study-case-capture.ts";
import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  type SensitivityStudyCaseV2,
  validateSensitivityStudyCaseV2,
} from "../../domain/sensitivity/study/sensitivity-study-v2.ts";
import { enrichThreadWorkbenchWithVerificationCases } from "./verification-case-workbench-enricher.ts";

const PROOF_CASE = validateMechanicalProofCase(JSON.parse(
  await Deno.readTextFile(
    new URL(
      "../../../config/mechanical-proof-cases/desk-lamp-dl05-arm-cantilever.json",
      import.meta.url,
    ),
  ),
));
const CASE_CONTEXT = { projectId: PROOF_CASE.project.id } as const;

Deno.test(
  "verification case enricher reopens exact seals and projects many-to-many lineage without labels",
  async () => {
    const first = await sealedProof(PROOF_CASE, "run.seal.first");
    const second = await sealedProof({
      ...PROOF_CASE,
      id: `${PROOF_CASE.id}-alternate`,
      revision: PROOF_CASE.revision + 1,
      scope: `${PROOF_CASE.scope} Alternate reviewed load case.`,
    }, "run.seal.second");
    const snapshot = workbenchFor([first, second]);
    const captureByDigest = new Map([
      [first.captureFingerprint, first.captureText],
      [second.captureFingerprint, second.captureText],
    ]);

    const enriched = await enrichThreadWorkbenchWithVerificationCases(
      snapshot,
      {
        mechanicalProof: {
          read: (fingerprint) =>
            Promise.resolve(captureByDigest.get(fingerprint.digest)),
        },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      },
      CASE_CONTEXT,
    );

    assertEquals(enriched.verificationCases.status, "observed");
    assertEquals(enriched.verificationCases.issues, []);
    assertEquals(enriched.verificationCases.cases.length, 2);
    assertEquals(
      enriched.verificationCases.cases.map((item) => item.id),
      [PROOF_CASE.id, `${PROOF_CASE.id}-alternate`],
    );
    assertEquals(
      enriched.verificationCases.cases[0]?.scope,
      PROOF_CASE.scope,
      "scope remains source text and is never synthesized from a label",
    );

    const caseKeys = enriched.verificationCases.cases.map((item) => item.key);
    const sortedCaseKeys = [...caseKeys].sort();
    for (
      const ref of [
        "artifact:geometry",
        "artifact:requirements",
        "artifact:step",
        "artifact:result",
        "observation:observation",
        "requirement:requirement",
        "evaluation:evaluation",
        "violation:violation",
      ]
    ) {
      assertEquals(
        nodeByRef(enriched, ref)?.verificationCaseRefs,
        sortedCaseKeys,
        `${ref} belongs to both exact cases without a dominant case`,
      );
    }
    assertEquals(
      nodeByRef(enriched, `artifact:${first.artifact.id}`)
        ?.verificationCaseRefs,
      [caseKeys[0]],
    );
    assertEquals(
      nodeByRef(enriched, "artifact:unrelated")?.verificationCaseRefs,
      undefined,
      "an unrelated fact is never joined by component or label",
    );
  },
);

Deno.test(
  "verification case enricher reopens a sensitivity case without treating it as a proof verdict",
  async () => {
    const studyCase = sensitivityStudyCase();
    const caseDigest = (await sha256Fingerprint(studyCase)).digest;
    const capture = {
      schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
      operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
      trustedRunId: "run.sensitivity.seal",
      caseDigest,
      canonicalCaseText: deterministicJson(studyCase),
      studyCase,
      admissionArtifact: {
        id: "geometry",
        fingerprint: {
          algorithm: "sha256" as const,
          digest: "1".repeat(64),
        },
      },
      sealedAt: "2026-08-20T00:00:00.000Z",
    };
    const captureText = deterministicJson(capture);
    const captureDigest = (await sha256Fingerprint(capture)).digest;
    const snapshot = workbenchFor([]);
    const authorityId = `sensitivity-case-${caseDigest}`;
    snapshot.artifacts.push({
      id: authorityId,
      label: "Display text must not carry identity",
      kind: "document",
      system: "digital-thread",
      revision: caseDigest,
      freshness: "fresh",
      fingerprint: `sha256:${captureDigest}`,
      uri: `${SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX}${captureDigest}`,
      producedBy:
        `${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id}@${ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version}`,
      producerRunId: capture.trustedRunId,
      dependsOn: ["geometry"],
    });
    snapshot.graph.nodes.push(
      graphNode(
        "artifact",
        authorityId,
        "Irrelevant presentation",
        "digital-thread",
      ),
    );
    snapshot.graph.edges.push(
      edge("input_to", "artifact", "geometry", "artifact", authorityId),
      edge("input_to", "artifact", authorityId, "artifact", "result"),
    );

    const enriched = await enrichThreadWorkbenchWithVerificationCases(
      snapshot,
      {
        mechanicalProof: { read: () => Promise.resolve(undefined) },
        sensitivityStudy: {
          read: (fingerprint) =>
            Promise.resolve(
              fingerprint.digest === captureDigest ? captureText : undefined,
            ),
        },
      },
      CASE_CONTEXT,
    );

    assertEquals(enriched.verificationCases.status, "observed");
    assertEquals(enriched.verificationCases.cases, [{
      key: `verification-case:sensitivity-study:${caseDigest}`,
      family: "sensitivity-study",
      caseSchemaVersion: "sensitivity-study-case/2.0",
      id: studyCase.id,
      revision: studyCase.revision,
      scope: studyCase.scope,
      caseDigest,
      authorityArtifactIds: [authorityId],
    }]);
    assertEquals(
      nodeByRef(enriched, "artifact:result")?.verificationCaseRefs,
      [`verification-case:sensitivity-study:${caseDigest}`],
    );
  },
);

Deno.test(
  "verification case enricher reports a corrupt known seal instead of hiding the trace gap",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.corrupt");
    const snapshot = workbenchFor([proof]);
    const enriched = await enrichThreadWorkbenchWithVerificationCases(
      snapshot,
      {
        mechanicalProof: { read: () => Promise.resolve("{") },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      },
      CASE_CONTEXT,
    );

    assertEquals(enriched.verificationCases.status, "unresolved");
    assertEquals(enriched.verificationCases.cases, []);
    assertEquals(enriched.verificationCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: proof.artifact.id,
      status: "error",
      reason: "capture-invalid",
    }]);
    assertEquals(
      enriched.graph.nodes.every((node) => node.verificationCaseRefs === undefined),
      true,
    );
  },
);

Deno.test(
  "verification case enricher keeps a known seal unresolved when its reader is unavailable",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.unavailable");
    const enriched = await enrichThreadWorkbenchWithVerificationCases(
      workbenchFor([proof]),
      {},
      CASE_CONTEXT,
    );

    assertEquals(enriched.verificationCases.status, "unresolved");
    assertEquals(enriched.verificationCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: proof.artifact.id,
      status: "unavailable",
      reason: "capture-reader-unavailable",
    }]);
  },
);

Deno.test(
  "verification case enricher ignores another document emitted by the proof operation",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.with-offer");
    const snapshot = workbenchFor([proof]);
    snapshot.artifacts.push({
      id: `sensitivity-catalog-offer-${"9".repeat(64)}`,
      label: "Sensitivity catalog offer",
      kind: "document",
      system: "digital-thread",
      revision: "8".repeat(64),
      freshness: "fresh",
      fingerprint: `sha256:${"9".repeat(64)}`,
      uri: `casys://sensitivity-catalog-offer-capture/sha256/${"9".repeat(64)}`,
      producedBy: "verify.seal-proof-case@1",
      dependsOn: [proof.artifact.id],
    });
    let reads = 0;
    const enriched = await enrichThreadWorkbenchWithVerificationCases(
      snapshot,
      {
        mechanicalProof: {
          read: () => {
            reads += 1;
            return Promise.resolve(proof.captureText);
          },
        },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      },
      CASE_CONTEXT,
    );

    assertEquals(reads, 1);
    assertEquals(enriched.verificationCases.status, "observed");
    assertEquals(enriched.verificationCases.issues, []);
  },
);

Deno.test(
  "verification case enricher reports a case whose canonical id diverges from its exact URI",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.bad-id");
    const divergent = {
      ...proof,
      artifact: { ...proof.artifact, id: "tampered-proof-id" },
    };
    const enriched = await enrichThreadWorkbenchWithVerificationCases(
      workbenchFor([divergent]),
      {
        mechanicalProof: { read: () => Promise.resolve(proof.captureText) },
        sensitivityStudy: { read: () => Promise.resolve(undefined) },
      },
      CASE_CONTEXT,
    );

    assertEquals(enriched.verificationCases.status, "unresolved");
    assertEquals(enriched.verificationCases.issues, [{
      family: "mechanical-proof",
      authorityArtifactId: "tampered-proof-id",
      status: "error",
      reason: "case-binding-divergent",
    }]);
  },
);

Deno.test(
  "verification case enricher cross-binds project, authority run, and FEA input runs",
  async () => {
    const proof = await sealedProof(PROOF_CASE, "run.seal.bound");
    const mutations: Array<{
      name: string;
      snapshot: ThreadWorkbenchSnapshot;
      context: { projectId: string };
    }> = [
      {
        name: "foreign project",
        snapshot: workbenchFor([proof]),
        context: { projectId: "another-project" },
      },
      {
        name: "foreign authority run",
        snapshot: (() => {
          const candidate = workbenchFor([proof]);
          candidate.artifacts.find((artifact) => artifact.id === proof.artifact.id)!
            .producerRunId = "run.seal.other";
          return candidate;
        })(),
        context: CASE_CONTEXT,
      },
      {
        name: "foreign input run",
        snapshot: (() => {
          const candidate = workbenchFor([proof]);
          candidate.artifacts.find((artifact) => artifact.id === "geometry")!
            .producerRunId = "run.geometry.other";
          return candidate;
        })(),
        context: CASE_CONTEXT,
      },
    ];

    for (const mutation of mutations) {
      const enriched = await enrichThreadWorkbenchWithVerificationCases(
        mutation.snapshot,
        {
          mechanicalProof: { read: () => Promise.resolve(proof.captureText) },
          sensitivityStudy: { read: () => Promise.resolve(undefined) },
          },
        mutation.context,
      );
      assertEquals(enriched.verificationCases.cases, [], mutation.name);
      assertEquals(enriched.verificationCases.issues, [{
        family: "mechanical-proof",
        authorityArtifactId: proof.artifact.id,
        status: "error",
        reason: "case-binding-divergent",
      }], mutation.name);
    }
  },
);

interface SealedProof {
  readonly proofCase: MechanicalProofCase;
  readonly proofDigest: string;
  readonly captureFingerprint: string;
  readonly captureText: string;
  readonly artifact: ThreadArtifact;
}

async function sealedProof(
  proofCase: MechanicalProofCase,
  trustedRunId: string,
): Promise<SealedProof> {
  const proofDigest = (await sha256Fingerprint(proofCase)).digest;
  const capture = {
    schemaVersion: FEA_PROOF_CASE_CAPTURE_SCHEMA,
    operation: VERIFY_SEAL_PROOF_CASE_OPERATION,
    trustedRunId,
    proofDigest,
    canonicalProofText: canonicalProofText(proofCase),
    geometryArtifact: artifactRef("geometry", "1"),
    requirementsArtifact: artifactRef("requirements", "2"),
    stepArtifact: {
      ...artifactRef("step", "3"),
      bytes: 42,
    },
    requirementsElementId: proofCase.requirementsSource.elementId,
    seedIdentity: {
      editingContextId: proofCase.requirementsSource.editingContextId,
      elementId: proofCase.requirementsSource.elementId,
    },
    sealedAt: "2026-08-20T00:00:00.000Z",
  };
  const captureText = deterministicJson(capture);
  const captureFingerprint = (await sha256Fingerprint(capture)).digest;
  return {
    proofCase,
    proofDigest,
    captureFingerprint,
    captureText,
    artifact: {
      id: `fea-proof-${captureFingerprint}`,
      label: "This display label is deliberately irrelevant",
      kind: "document",
      system: "digital-thread",
      revision: proofDigest,
      freshness: "fresh",
      fingerprint: `sha256:${captureFingerprint}`,
      uri: `casys://fea-proof-case-capture/sha256/${captureFingerprint}`,
      producedBy: "verify.seal-proof-case@1",
      producerRunId: trustedRunId,
      dependsOn: ["geometry", "requirements", "step"],
    },
  };
}

function artifactRef(id: string, digit: string) {
  return {
    id,
    fingerprint: { algorithm: "sha256" as const, digest: digit.repeat(64) },
    producerRunId: `run.${id}`,
  };
}

function workbenchFor(proofs: readonly SealedProof[]): ThreadWorkbenchSnapshot {
  const artifacts: ThreadArtifact[] = [
    inputArtifact("geometry", "1"),
    inputArtifact("requirements", "2"),
    inputArtifact("step", "3"),
    ...proofs.map((proof) => proof.artifact),
    {
      id: "result",
      label: "Result",
      kind: "solver-result",
      system: "calculix",
      revision: "1",
      freshness: "fresh",
      fingerprint: `sha256:${"4".repeat(64)}`,
      producerRunId: "run.result",
      dependsOn: proofs.map((proof) => proof.artifact.id),
    },
    inputArtifact("unrelated", "5"),
  ];
  const nodes: ThreadGraphNode[] = [
    ...artifacts.map((artifact) =>
      graphNode("artifact", artifact.id, artifact.label, artifact.system)
    ),
    graphNode("observation", "observation", "Observation", "calculix"),
    graphNode("requirement", "requirement", "Requirement", "digital-thread"),
    graphNode("evaluation", "evaluation", "Evaluation", "digital-thread"),
    graphNode("violation", "violation", "Violation", "digital-thread"),
  ];
  const edges: ThreadGraphEdge[] = [];
  for (const proof of proofs) {
    for (const input of ["geometry", "requirements", "step"]) {
      edges.push(edge("input_to", "artifact", input, "artifact", proof.artifact.id));
    }
    edges.push(edge(
      "input_to",
      "artifact",
      proof.artifact.id,
      "artifact",
      "result",
    ));
  }
  edges.push(
    edge("source_of", "artifact", "result", "observation", "observation"),
    edge("uses", "observation", "observation", "evaluation", "evaluation"),
    edge("evaluates", "requirement", "requirement", "evaluation", "evaluation"),
    edge("caused_by", "evaluation", "evaluation", "violation", "violation"),
  );

  return {
    schemaVersion: "thread-workbench/0.1",
    id: "snapshot",
    subject: {
      id: PROOF_CASE.project.subjectId,
      label: "Subject",
      program: "Test",
    },
    generatedAt: "2026-08-20T00:00:00.000Z",
    source: "observed",
    sourceLabel: "Test",
    change: {
      id: "change",
      title: "Change",
      summary: "Change",
      author: "Test",
      revision: "1",
      changedAt: "2026-08-20T00:00:00.000Z",
      status: "evaluated",
      files: [],
    },
    components: {
      schemaVersion: "thread-components/1.0",
      authority: "workspace-declared",
      subjectId: PROOF_CASE.project.subjectId,
      rationale: "Test",
      systemViews: {},
      components: [],
    },
    verificationCases: {
      schemaVersion: "thread-verification-cases/1.0",
      status: "unavailable",
      coverage: [
        { family: "mechanical-proof", status: "unavailable" },
        { family: "sensitivity-study", status: "unavailable" },
      ],
      cases: [],
      issues: [],
    },
    graph: { nodes, edges },
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0",
      asOf: { snapshotId: "snapshot", revision: 1 },
      families: [],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    },
    flow: [],
    artifacts,
    observations: [],
    requirements: [],
    violations: [],
    actions: [],
  };
}

function inputArtifact(id: string, digit: string): ThreadArtifact {
  return {
    id,
    label: id,
    kind: id === "step" ? "step" : "document",
    system: "digital-thread",
    revision: "1",
    freshness: "fresh",
    fingerprint: `sha256:${digit.repeat(64)}`,
    producerRunId: `run.${id}`,
    dependsOn: [],
  };
}

function graphNode(
  kind: ThreadGraphNode["entityKind"],
  id: string,
  label: string,
  system: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    ...(kind === "artifact" ? { artifactKind: "document" } : {}),
    label,
    system,
    freshness: "fresh",
    summary: label,
  };
}

function edge(
  relation: ThreadGraphEdge["relation"],
  fromKind: ThreadGraphNode["entityKind"],
  fromId: string,
  toKind: ThreadGraphNode["entityKind"],
  toId: string,
): ThreadGraphEdge {
  return {
    id: `${relation}:${fromKind}:${fromId}:${toKind}:${toId}`,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    relation,
    rationale: "Recorded test relation",
    origin: relation === "input_to" || relation === "source_of"
      ? "structure"
      : "provenance",
  };
}

function sensitivityStudyCase(): SensitivityStudyCaseV2 {
  return validateSensitivityStudyCaseV2({
    schemaVersion: "sensitivity-study-case/2.0",
    id: "dl05-arm-thickness-sensitivity",
    revision: 1,
    scope: "mechanical-structural",
    evidenceBoundary: "fea-static",
    project: {
      id: "desk-lamp-dl05",
      subjectId: PROOF_CASE.project.subjectId,
    },
    target: { componentKey: "arm", semanticKey: "arm_thickness" },
    cadSource: {
      artifactUri: "thread-artifact://desk-lamp-dl05/geometry",
      sha256: "1".repeat(64),
    },
    baseValue: { value: 10, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [{ id: "assembly_max_displacement", unit: "mm" }],
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 69_000,
        nu: 0.33,
        basis: "reviewed aluminium declaration",
      },
      supports: [{
        id: "base-fixed",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: {
            min: [0, 0, 0],
            max: [1, 1, 1],
            unit: "mm",
          },
        },
      }],
      loads: [{
        id: "tip-load",
        kind: "force",
        selection: {
          name: "LOADED",
          box: {
            min: [10, 10, 10],
            max: [11, 11, 11],
            unit: "mm",
          },
        },
        force: { value: [0, 0, -10], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "Valid for arm_thickness in [10, 11] mm.",
      limitations: ["Local study only."],
    },
  });
}

function nodeByRef(
  snapshot: ThreadWorkbenchSnapshot,
  reference: string,
): ThreadGraphNode | undefined {
  return snapshot.graph.nodes.find((node) =>
    `${node.ref.kind}:${node.ref.id}` === reference
  );
}
