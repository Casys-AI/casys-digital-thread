import { assertEquals, assertThrows } from "@std/assert";
import {
  assemblyIntegrityCloseoutAcceptGateClaims,
  assemblyIntegrityEvaluationGateClaimIssue,
} from "./assembly-integrity-evaluation-gate-policy.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../project/engineering-project.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "./assembly-integrity-evaluation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "./assembly-integrity-observation.ts";

Deno.test("L4 allows zero or many exact authority claims and refuses other gates", () => {
  const project = {
    framing: {
      currentBrief: {
        contractVersion: "2.0",
        id: "brief-r1",
        revision: 1,
        items: [
          { id: "gate-a", kind: "success-criterion" },
          {
            id: "gate-b",
            kind: "verification-activity",
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          },
          {
            id: "gate-c",
            kind: "verification-activity",
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          },
          {
            id: "gate-other",
            kind: "verification-activity",
            verificationAuthority: { id: "other-method", version: "1.0" },
          },
          { id: "gate-unqualified", kind: "verification-activity" },
        ],
      },
      currentBriefApproval: {
        status: "approved",
        briefSnapshotId: "brief-r1",
        briefRevision: 1,
      },
    },
  } as unknown as EngineeringProjectSnapshot;

  assertEquals(assemblyIntegrityEvaluationGateClaimIssue(project, work([])), undefined);
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
        { gateItemId: "gate-c", role: "contributes-to", status: "current" },
      ]),
    ),
    undefined,
  );
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
      ]),
    ),
    "L4 may claim each current Brief V2 gate at most once.",
  );
  assertEquals(
    assemblyIntegrityEvaluationGateClaimIssue(
      project,
      work([
        { gateItemId: "gate-b", role: "satisfies", status: "current" },
      ]),
    ),
    "L4 may retain only current contributes-to claims targeting current approved Brief V2 assembly-integrity verification activities.",
  );
  for (const gateItemId of ["gate-a", "gate-other", "gate-unqualified"]) {
    assertEquals(
      assemblyIntegrityEvaluationGateClaimIssue(
        project,
        work([{ gateItemId, role: "contributes-to", status: "current" }]),
      ),
      "L4 may retain only current contributes-to claims targeting current approved Brief V2 assembly-integrity verification activities.",
    );
  }
});

Deno.test("L5 accept satisfies only recorded current L4 contributes-to claims among compatible Brief gates", () => {
  const project = briefProject(["gate-b", "gate-c"]);

  assertEquals(assemblyIntegrityCloseoutAcceptGateClaims(project, l4Work([])), []);
  assertEquals(
    assemblyIntegrityCloseoutAcceptGateClaims(
      project,
      l4Work([{ gateItemId: "gate-c", role: "contributes-to", status: "current" }]),
    ),
    [{ gateItemId: "gate-c", role: "satisfies", status: "current" }],
  );
  assertEquals(
    assemblyIntegrityCloseoutAcceptGateClaims(
      project,
      l4Work([
        { gateItemId: "gate-c", role: "contributes-to", status: "current" },
        { gateItemId: "gate-b", role: "contributes-to", status: "current" },
      ]),
    ),
    [
      { gateItemId: "gate-b", role: "satisfies", status: "current" },
      { gateItemId: "gate-c", role: "satisfies", status: "current" },
    ],
  );
});

Deno.test("L5 accept refuses stale, incompatible, duplicate, or non-L4 claims rather than inventing Brief satisfaction", () => {
  const project = briefProject(["gate-b", "gate-c"]);

  assertThrows(
    () =>
      assemblyIntegrityCloseoutAcceptGateClaims(
        project,
        l4Work([{
          gateItemId: "gate-removed",
          role: "contributes-to",
          status: "current",
        }]),
      ),
    TypeError,
    "current contributes-to claims targeting current approved Brief V2",
  );
  assertThrows(
    () =>
      assemblyIntegrityCloseoutAcceptGateClaims(
        project,
        l4Work([{
          gateItemId: "gate-other",
          role: "contributes-to",
          status: "current",
        }]),
      ),
    TypeError,
    "current contributes-to claims targeting current approved Brief V2",
  );
  assertThrows(
    () =>
      assemblyIntegrityCloseoutAcceptGateClaims(
        project,
        l4Work([
          { gateItemId: "gate-b", role: "contributes-to", status: "current" },
          { gateItemId: "gate-b", role: "contributes-to", status: "current" },
        ]),
      ),
    TypeError,
    "at most once",
  );
  assertThrows(
    () =>
      assemblyIntegrityCloseoutAcceptGateClaims(
        project,
        {
          operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
          gateClaims: [{
            gateItemId: "gate-b",
            role: "contributes-to",
            status: "current",
          }],
        } as unknown as EngineeringWorkItem,
      ),
    TypeError,
    "selected L4 evaluation work item",
  );
});

function briefProject(assemblyGateIds: readonly string[]): EngineeringProjectSnapshot {
  return {
    framing: {
      currentBrief: {
        contractVersion: "2.0",
        id: "brief-r1",
        revision: 1,
        items: [
          { id: "gate-a", kind: "success-criterion" },
          ...assemblyGateIds.map((id) => ({
            id,
            kind: "verification-activity" as const,
            verificationAuthority: { id: "assembly-integrity", version: "1.0" },
          })),
          {
            id: "gate-other",
            kind: "verification-activity",
            verificationAuthority: { id: "other-method", version: "1.0" },
          },
          { id: "gate-unqualified", kind: "verification-activity" },
        ],
      },
      currentBriefApproval: {
        status: "approved",
        briefSnapshotId: "brief-r1",
        briefRevision: 1,
      },
    },
  } as unknown as EngineeringProjectSnapshot;
}

function work(gateClaims: EngineeringWorkItem["gateClaims"]): EngineeringWorkItem {
  return { gateClaims } as unknown as EngineeringWorkItem;
}

function l4Work(gateClaims: EngineeringWorkItem["gateClaims"]): EngineeringWorkItem {
  return {
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    gateClaims,
  } as unknown as EngineeringWorkItem;
}
