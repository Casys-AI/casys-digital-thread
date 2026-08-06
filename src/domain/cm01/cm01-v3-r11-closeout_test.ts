import { assertEquals, assertThrows } from "@std/assert";
import { deriveCoffeeMachineCm01V3R12RequirementFamilyLinks } from "./cm01-v3-r11-closeout.ts";
import type { ThreadSnapshot } from "../thread/thread-snapshot.ts";

Deno.test("CM-01 R12 links only the proven R1 -> R2 -> R3 requirement family", () => {
  const links = deriveCoffeeMachineCm01V3R12RequirementFamilyLinks(familySnapshot());
  assertEquals(links.map((link) => [link.from.id, link.to.id]), [
    ["r3-displacement", "r1-displacement"],
    ["r3-von-mises", "r1-von-mises"],
  ]);
});

Deno.test("CM-01 R12 refuses an unrelated requirement supersession", () => {
  const snapshot = familySnapshot() as unknown as {
    provenance: {
      id: string;
      relation: string;
      from: { kind: string; id: string };
      to: { kind: string; id: string };
      rationale: string;
    }[];
  };
  snapshot.provenance = snapshot.provenance.map((link) =>
    link.id === "r3-displacement:supersedes:r2-displacement"
      ? {
        ...link,
        id: "r3-displacement:supersedes:unrelated",
        to: { kind: "requirement", id: "unrelated" },
      }
      : link
  );
  assertThrows(
    () =>
      deriveCoffeeMachineCm01V3R12RequirementFamilyLinks(snapshot as ThreadSnapshot),
    Error,
    "one terminal fresh passing successor",
  );
});

function familySnapshot(): ThreadSnapshot {
  const requirement = (id: string, metric: string, artifact: string) => ({
    id,
    criterion: {
      metric,
      operator: "<=",
      limit: {
        value: metric === "displacement" ? 1 : 20,
        unit: metric === "displacement" ? "mm" : "MPa",
      },
    },
    trace: {
      sourceArtifactId: `${artifact}-proof`,
      elementId: id,
      targetArtifactIds: [artifact],
    },
  });
  const evaluation = (requirementId: string, stale = false) => ({
    requirementId,
    status: "pass",
    freshness: stale
      ? {
        status: "stale",
        changedAt: "2026-08-03T12:00:00.000Z",
        reason: "corrected",
        invalidatedByChangeIds: [
          "coffee-machine-cm01-v3-drip-tray-height-28-to-30:applied",
        ],
      }
      : {
        status: "fresh",
        changedAt: "2026-08-03T13:00:00.000Z",
        invalidatedByChangeIds: [],
      },
  });
  return {
    requirements: [
      requirement("r1-displacement", "displacement", "r1-step"),
      requirement("r1-von-mises", "von-mises", "r1-step"),
      requirement("r2-displacement", "displacement", "r2-step"),
      requirement("r2-von-mises", "von-mises", "r2-step"),
      requirement("r3-displacement", "displacement", "r3-step"),
      requirement("r3-von-mises", "von-mises", "r3-step"),
    ],
    evaluations: [
      evaluation("r1-displacement", true),
      evaluation("r1-von-mises", true),
      evaluation("r2-displacement"),
      evaluation("r2-von-mises"),
      evaluation("r3-displacement"),
      evaluation("r3-von-mises"),
    ],
    provenance: [
      artifactLink("r3-step", "r2-step"),
      artifactLink("r2-step", "r1-step"),
      requirementLink("r3-displacement", "r2-displacement"),
      requirementLink("r3-von-mises", "r2-von-mises"),
    ],
  } as unknown as ThreadSnapshot;
}

function artifactLink(from: string, to: string) {
  return {
    id: `${from}:supersedes:${to}`,
    relation: "supersedes",
    from: { kind: "artifact", id: from },
    to: { kind: "artifact", id: to },
    rationale: "fixture",
  };
}

function requirementLink(from: string, to: string) {
  return {
    id: `${from}:supersedes:${to}`,
    relation: "supersedes",
    from: { kind: "requirement", id: from },
    to: { kind: "requirement", id: to },
    rationale: "fixture",
  };
}
