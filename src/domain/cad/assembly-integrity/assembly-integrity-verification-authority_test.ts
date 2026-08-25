import { assertEquals } from "@std/assert";
import {
  ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
  canonicalAssemblyIntegrityVerificationGateIds,
  currentApprovedAssemblyIntegrityVerificationGateIds,
  isAssemblyIntegrityVerificationAuthority,
} from "./assembly-integrity-verification-authority.ts";
import type { EngineeringProjectSnapshot } from "../../project/engineering-project.ts";
import type { ProjectBriefRevision } from "../../project/project-brief.ts";

Deno.test("assembly-integrity verification authority selects only exact V2 activities in canonical order", () => {
  const brief = briefOf([
    verification("z-unqualified"),
    verification("b-other", { id: "other-method", version: "1.0" }),
    verification("a-assembly", ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY),
    verification("c-assembly", { id: "assembly-integrity", version: "1.0" }),
    {
      id: "criterion-with-lookalike",
      kind: "success-criterion" as const,
      statement: "assembly-integrity@1.0 in prose must not qualify this item",
      sourceRefs: sourceRefs(),
      dependsOnItemIds: [],
    },
  ]);

  assertEquals(
    canonicalAssemblyIntegrityVerificationGateIds(brief),
    ["a-assembly", "c-assembly"],
  );
  assertEquals(
    isAssemblyIntegrityVerificationAuthority(
      ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY,
    ),
    true,
  );
  assertEquals(
    isAssemblyIntegrityVerificationAuthority({
      id: "assembly-integrity",
      version: "1.0.1",
    }),
    false,
  );
});

Deno.test("current approved assembly-integrity gates require one exact V2 brief approval", () => {
  const brief = briefOf([
    verification("assembly-gate", ASSEMBLY_INTEGRITY_VERIFICATION_AUTHORITY),
  ]);
  const project = {
    framing: {
      currentBrief: brief,
      currentBriefApproval: {
        status: "approved",
        briefSnapshotId: brief.id,
        briefRevision: brief.revision,
      },
    },
  } as unknown as EngineeringProjectSnapshot;
  assertEquals(
    currentApprovedAssemblyIntegrityVerificationGateIds(project),
    ["assembly-gate"],
  );

  const stale = structuredClone(project) as EngineeringProjectSnapshot;
  (stale.framing!.currentBriefApproval as { briefRevision: number }).briefRevision = 2;
  assertEquals(currentApprovedAssemblyIntegrityVerificationGateIds(stale), []);
});

function briefOf(items: ProjectBriefRevision["items"]): ProjectBriefRevision {
  return {
    contractVersion: "2.0",
    briefId: "project:brief",
    id: "project:brief:r1",
    revision: 1,
    items,
    proposedAt: "2026-08-26T05:00:00.000Z",
    proposedBy: { id: "agent:fixture", origin: "agent" },
  };
}

function verification(
  id: string,
  verificationAuthority?: { readonly id: string; readonly version: string },
) {
  return {
    id,
    kind: "verification-activity" as const,
    statement: `Verification activity ${id}.`,
    sourceRefs: sourceRefs(),
    dependsOnItemIds: [],
    ...(verificationAuthority === undefined ? {} : { verificationAuthority }),
  };
}

function sourceRefs() {
  return [{ kind: "intent" as const, reference: "conversation:fixture" }];
}
