import { assertEquals } from "@std/assert";
import { assemblyIntegrityEvaluationCloseoutReviewNext } from "./assembly-integrity-evaluation-closeout-review-next.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  assemblyIntegrityEvaluationCloseoutWorkItemOperation,
  encodeAssemblyIntegrityEvaluationCloseoutAdmission,
  validateAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import { ASSEMBLY_INTEGRITY_EVALUATION_LIMITS } from "../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import { ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY } from "../../../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const G = "1".repeat(64);

Deno.test("L5 closeout next.append is the exact human leaf bound to the current L4 identity", () => {
  const admission = validAdmission("accept");
  const next = assemblyIntegrityEvaluationCloseoutReviewNext({
    projectId: "project-assembly",
    expectedRevision: 11,
    l4WorkItemId: "work-l4-current",
    baseSnapshot: {
      snapshotId: "thread-assembly-r4",
      revision: 4,
      subjectId: "assembly-subject",
    },
    admission,
  });

  assertEquals(next.append.tool, "project_change_append");
  assertEquals(
    next.append.arguments.commandId,
    `append-assembly-integrity-accept-${
      admission.evaluationCapture.fingerprint.digest.slice(0, 16)
    }-r4`,
  );
  assertEquals(next.append.arguments.projectId, "project-assembly");
  assertEquals(next.append.arguments.expectedRevision, 11);
  assertEquals(next.append.arguments.baseSnapshot, {
    snapshotId: "thread-assembly-r4",
    revision: 4,
    subjectId: "assembly-subject",
  });
  assertEquals("kind" in next.append.arguments.baseSnapshot, false);
  assertEquals(next.append.arguments.workItems[0], {
    id: `work-assembly-integrity-accept-${
      admission.evaluationCapture.fingerprint.digest.slice(0, 16)
    }-r4`,
    phaseId: `phase-assembly-integrity-accept-${
      admission.evaluationCapture.fingerprint.digest.slice(0, 16)
    }-r4`,
    owner: "human",
    dependsOnWorkItemIds: ["work-l4-current"],
    decisionIds: [
      `decision-assembly-integrity-accept-${
        admission.evaluationCapture.fingerprint.digest.slice(0, 16)
      }-r4`,
    ],
    operation: assemblyIntegrityEvaluationCloseoutWorkItemOperation("accept"),
    gateClaims: [{
      gateItemId: "verification.assembly-integrity",
      role: "satisfies",
      status: "current",
    }],
  });
  assertEquals(next.append.arguments.workItems[0]?.operation.bindings, [{
    name: "approvedBrief",
    source: { kind: "approved-brief" },
  }]);
  assertEquals(next.propose.tool, "project_decision_propose");
  assertEquals(
    next.propose.arguments.decisionId,
    next.append.arguments.requiredDecisions[0]?.id,
  );
  assertEquals(
    next.propose.arguments.proposal.parameters,
    encodeAssemblyIntegrityEvaluationCloseoutAdmission(admission),
  );
});

Deno.test("L5 closeout reject next.append retains the L4 predecessor and does not satisfy a gate", () => {
  const admission = validAdmission("reject");
  const next = assemblyIntegrityEvaluationCloseoutReviewNext({
    projectId: "project-assembly",
    expectedRevision: 11,
    l4WorkItemId: "work-l4-current",
    baseSnapshot: {
      snapshotId: "thread-assembly-r4",
      revision: 4,
      subjectId: "assembly-subject",
    },
    admission,
  });

  assertEquals(
    next.append.arguments.workItems[0]?.operation,
    assemblyIntegrityEvaluationCloseoutWorkItemOperation("reject"),
  );
  assertEquals(next.append.arguments.workItems[0]?.dependsOnWorkItemIds, [
    "work-l4-current",
  ]);
  assertEquals(next.append.arguments.workItems[0]?.gateClaims, []);
  assertEquals(
    next.append.arguments.workItems[0]?.gateClaims.some((claim) =>
      claim.role === "satisfies"
    ),
    false,
  );
});

function validAdmission(consequence: "accept" | "reject") {
  return validateAssemblyIntegrityEvaluationCloseoutAdmission({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    consequence,
    rejectionDisposition: "none",
    projectId: "project-assembly",
    subjectId: "assembly-subject",
    approvedBriefBasis: {
      kind: "approved-brief",
      projectId: "project-assembly",
      projectSnapshotId: "project-assembly-r2",
      projectRevision: 2,
      briefId: "project-assembly:brief",
      briefSnapshotId: "project-assembly:brief:r2",
      briefRevision: 2,
      approvedBriefFingerprint: fp(G),
    },
    verificationAuthority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
    gateClaims: consequence === "accept"
      ? [{
        gateItemId: "verification.assembly-integrity",
        role: "satisfies",
        status: "current",
      }]
      : [],
    basis: {
      snapshotId: "thread-assembly-r4",
      revision: 4,
      fingerprint: fp(G),
    },
    evaluationCapture: {
      id: `assembly-integrity-evaluation-${A}`,
      fingerprint: fp(A),
    },
    geometryModule: { id: `geometry-${B}`, fingerprint: fp(B) },
    assemblyStep: {
      id: `cad-asset-${B}-module-step-${C}`,
      fingerprint: fp(C),
    },
    observation: {
      id: `assembly-integrity-observation-${D}`,
      fingerprint: fp(D),
      observationFingerprint: fp(E),
    },
    method: {
      schemaVersion: "assembly-integrity-evaluation-method/1.0",
      id: "assembly-integrity-evaluation",
      version: "1.0",
      fingerprint: fp(F),
    },
    criteria: [
      { id: "assembly-import", verdict: "pass" },
      { id: "occurrence-coverage", verdict: "pass" },
      { id: "placement-recross", verdict: "pass" },
      { id: "brep-validity", verdict: "pass" },
      { id: "pairwise-intersection", verdict: "pass" },
    ],
    limitations: ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
  });
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
