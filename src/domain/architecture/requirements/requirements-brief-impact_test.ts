import { assertEquals } from "@std/assert";
import type { RequirementsBriefProvenance } from "./requirements-brief-provenance.ts";
import {
  compareRequirementsBriefImpact,
  REQUIREMENTS_BRIEF_TRACE_GAP,
} from "./requirements-brief-impact.ts";
import type {
  ProjectBriefItem,
  ProjectBriefRevision,
} from "../../project/project-brief.ts";

const DIGEST = "a".repeat(64);
const CONTENT_DIGEST = "b".repeat(64);

function item(
  id: string,
  options: Partial<ProjectBriefItem> = {},
): ProjectBriefItem {
  return {
    id,
    kind: "success-criterion",
    statement: `Statement for ${id}`,
    sourceRefs: [{ kind: "document", reference: `doc:${id}` }],
    dependsOnItemIds: [],
    ...options,
  };
}

function originalBrief(): ProjectBriefRevision {
  return {
    contractVersion: "2.0",
    briefId: "brief:demo",
    id: "brief:demo:r1",
    revision: 1,
    items: [
      item("container", { kind: "mission-scenario" }),
      item("max-stress", {
        verificationAuthority: { id: "method:static", version: "1" },
      }),
      item("max-displacement", {
        sourceRefs: [{ kind: "expert", reference: "expert:load-case" }],
      }),
    ],
    proposedAt: "2026-09-07T00:00:00.000Z",
    proposedBy: { id: "human:erwan", origin: "human" },
  };
}

function currentBrief(
  items: readonly ProjectBriefItem[] = originalBrief().items,
): ProjectBriefRevision {
  return {
    ...originalBrief(),
    id: "brief:demo:r2",
    revision: 2,
    previous: { snapshotId: "brief:demo:r1", revision: 1 },
    items,
  };
}

function provenance(
  brief: ProjectBriefRevision = originalBrief(),
): RequirementsBriefProvenance {
  return {
    schemaVersion: "requirements-brief-provenance/1.0",
    briefBasis: {
      kind: "approved-brief",
      projectId: "project:demo",
      projectSnapshotId: "project:demo:r7",
      projectRevision: 7,
      briefId: brief.briefId,
      briefSnapshotId: brief.id,
      briefRevision: brief.revision,
      approvedBriefFingerprint: { algorithm: "sha256", digest: DIGEST },
    },
    briefContentFingerprint: { algorithm: "sha256", digest: CONTENT_DIGEST },
    container: { sourceItem: brief.items[0]! },
    requirements: [
      {
        requirementId: "maxVonMises",
        sourceItem: brief.items[1]!,
        declaredThreshold: { value: 90, unit: "MPa" },
        transformation: "MPa-to-Pa",
      },
      {
        requirementId: "maxDisplacement",
        sourceItem: brief.items[2]!,
        declaredThreshold: { value: 1, unit: "mm" },
        transformation: "identity",
      },
    ],
  };
}

Deno.test("requirements brief impact keeps historical and current brief identities separate", () => {
  const impact = compareRequirementsBriefImpact({
    provenance: provenance(),
    currentBrief: currentBrief(),
  });

  assertEquals(impact.status, "available");
  if (impact.status !== "available") return;
  assertEquals(impact.originalBrief, {
    briefId: "brief:demo",
    snapshotId: "brief:demo:r1",
    revision: 1,
    basis: provenance().briefBasis,
    contentFingerprint: { algorithm: "sha256", digest: CONTENT_DIGEST },
  });
  assertEquals(impact.currentBrief, {
    briefId: "brief:demo",
    snapshotId: "brief:demo:r2",
    revision: 2,
  });
  assertEquals(impact.container.state, "unchanged");
  assertEquals(impact.requirements.map((entry) => [entry.requirementId, entry.state]), [
    ["maxVonMises", "unchanged"],
    ["maxDisplacement", "unchanged"],
  ]);
});

Deno.test("requirements brief impact compares every persisted clause field, not only prose", () => {
  const original = originalBrief();
  const changed = original.items.map((candidate) =>
    candidate.id === "max-stress"
      ? {
        ...candidate,
        sourceRefs: [{ kind: "document" as const, reference: "doc:new-load" }],
        verificationAuthority: { id: "method:static", version: "2" },
      }
      : candidate
  );

  const impact = compareRequirementsBriefImpact({
    provenance: provenance(original),
    currentBrief: currentBrief(changed),
  });

  assertEquals(impact.status, "available");
  if (impact.status !== "available") return;
  assertEquals(impact.requirements[0]!.state, "changed");
  assertEquals(impact.requirements[0]!.originalSourceItem, original.items[1]);
  assertEquals(impact.requirements[0]!.currentSourceItem, changed[1]);
});

Deno.test("requirements brief impact distinguishes removed, reappeared and unavailable clauses", () => {
  const original = originalBrief();
  const withoutStress = original.items.filter((entry) => entry.id !== "max-stress");
  const removed = compareRequirementsBriefImpact({
    provenance: provenance(original),
    currentBrief: currentBrief(withoutStress),
  });
  assertEquals(removed.status, "available");
  if (removed.status === "available") {
    assertEquals(removed.requirements[0]!.state, "removed");
  }

  const reappeared = compareRequirementsBriefImpact({
    provenance: provenance(original),
    currentBrief: currentBrief(),
  });
  assertEquals(reappeared.status, "available");
  if (reappeared.status === "available") {
    assertEquals(reappeared.requirements[0]!.state, "unchanged");
  }

  const unavailable = compareRequirementsBriefImpact({
    provenance: provenance(original),
  });
  assertEquals(unavailable.status, "available");
  if (unavailable.status === "available") {
    assertEquals(unavailable.container.state, "brief-unavailable");
    assertEquals(unavailable.requirements.map((entry) => entry.state), [
      "brief-unavailable",
      "brief-unavailable",
    ]);
  }
});

Deno.test("requirements brief impact reports literal TRACE GAP without inferring a source", () => {
  const impact = compareRequirementsBriefImpact({ currentBrief: currentBrief() });
  assertEquals(impact, {
    status: REQUIREMENTS_BRIEF_TRACE_GAP,
    currentBrief: {
      briefId: "brief:demo",
      snapshotId: "brief:demo:r2",
      revision: 2,
    },
  });
});
