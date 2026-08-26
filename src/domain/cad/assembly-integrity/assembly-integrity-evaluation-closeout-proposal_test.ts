import { assertEquals, assertThrows } from "@std/assert";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
  assemblyIntegrityEvaluationCloseoutWorkItemOperation,
  encodeAssemblyIntegrityEvaluationCloseoutAdmission,
  parseAcceptAssemblyIntegrityEvaluationParameters,
  parseRejectAssemblyIntegrityEvaluationParameters,
  validateAssemblyIntegrityEvaluationCloseoutAdmission,
} from "./assembly-integrity-evaluation-closeout-proposal.ts";
import { ASSEMBLY_INTEGRITY_EVALUATION_LIMITS } from "./assembly-integrity-evaluation.ts";
import { ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY } from "./assembly-integrity-verification-authority.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const G = "1".repeat(64);

Deno.test("assembly-integrity L5 accept grammar requires all five literal L4 passes", () => {
  const accepted = validAdmission("accept", "pass");
  const parameters = encodeAssemblyIntegrityEvaluationCloseoutAdmission(accepted);

  assertEquals(
    parseAcceptAssemblyIntegrityEvaluationParameters(parameters),
    accepted,
  );
  assertThrows(
    () =>
      validateAssemblyIntegrityEvaluationCloseoutAdmission({
        ...accepted,
        criteria: accepted.criteria.map((criterion, index) =>
          index === 3 ? { ...criterion, verdict: "unresolved" } : criterion
        ),
      }),
    TypeError,
    "all five literal L4 criteria",
  );
  assertThrows(
    () => parseRejectAssemblyIntegrityEvaluationParameters(parameters),
    TypeError,
    "must be reject",
  );
});

Deno.test("assembly-integrity L5 work-item contract is human-owned approvedBrief plus admission gateClaims", () => {
  const accepted = validAdmission("accept", "pass");
  const rejected = validAdmission("reject", "unresolved");
  assertEquals(assemblyIntegrityEvaluationCloseoutWorkItemOperation("accept"), {
    id: "decide.accept-assembly-integrity-evaluation",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  });
  assertEquals(assemblyIntegrityEvaluationCloseoutWorkItemOperation("reject"), {
    id: "decide.reject-assembly-integrity-evaluation",
    version: "1",
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
  });
  assertEquals(
    accepted.gateClaims.every((claim) =>
      claim.role === "satisfies" && claim.status === "current"
    ),
    true,
  );
  assertEquals(rejected.gateClaims, []);
});

Deno.test("assembly-integrity L5 seals canonical accepted authority gate claims and reject seals none", () => {
  const accepted = validAdmission("accept", "pass");
  assertEquals(accepted.gateClaims, [
    { gateItemId: "gate-assembly-a", role: "satisfies", status: "current" },
    { gateItemId: "gate-assembly-z", role: "satisfies", status: "current" },
  ]);
  assertEquals(
    accepted.verificationAuthority,
    ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
  );
  assertThrows(
    () =>
      validateAssemblyIntegrityEvaluationCloseoutAdmission({
        ...accepted,
        gateClaims: [...accepted.gateClaims].reverse(),
      }),
    TypeError,
    "canonical gate-id order",
  );
  assertThrows(
    () =>
      validateAssemblyIntegrityEvaluationCloseoutAdmission({
        ...validAdmission("reject", "unresolved"),
        gateClaims: [{
          gateItemId: "gate-assembly-a",
          role: "satisfies",
          status: "current",
        }],
      }),
    TypeError,
    "retain no gate claims",
  );
});

Deno.test("assembly-integrity L5 reject retains literal L4 limits and does not become accept", () => {
  const rejected = validAdmission("reject", "unresolved");
  const parameters = encodeAssemblyIntegrityEvaluationCloseoutAdmission(rejected);

  assertEquals(rejected.rejectionDisposition, "assembly-integrity-review-required");
  assertEquals(rejected.limitations, ASSEMBLY_INTEGRITY_EVALUATION_LIMITS);
  assertEquals(
    parseRejectAssemblyIntegrityEvaluationParameters(parameters),
    rejected,
  );
  assertThrows(
    () => parseAcceptAssemblyIntegrityEvaluationParameters(parameters),
    TypeError,
    "must be accept",
  );
});

function validAdmission(
  consequence: "accept" | "reject",
  tailVerdict: "pass" | "unresolved",
) {
  return validateAssemblyIntegrityEvaluationCloseoutAdmission({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_SCHEMA,
    consequence,
    rejectionDisposition: consequence === "accept" || tailVerdict === "pass"
      ? "none"
      : "assembly-integrity-review-required",
    projectId: "project-assembly",
    subjectId: "assembly-subject",
    approvedBriefBasis: {
      kind: "approved-brief",
      projectId: "project-assembly",
      projectSnapshotId: "project-assembly-r2",
      projectRevision: 2,
      briefId: "brief-assembly",
      briefSnapshotId: "brief-assembly-r2",
      briefRevision: 2,
      approvedBriefFingerprint: fp(G),
    },
    verificationAuthority: ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
    gateClaims: consequence === "accept"
      ? [
        { gateItemId: "gate-assembly-a", role: "satisfies", status: "current" },
        { gateItemId: "gate-assembly-z", role: "satisfies", status: "current" },
      ]
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
      { id: "pairwise-intersection", verdict: tailVerdict },
    ],
    limitations: ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
  });
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}
