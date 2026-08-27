import { assertEquals, assertThrows } from "@std/assert";
import type { EngineeringWorkItem } from "../project/engineering-project.ts";
import {
  applyCrossDomainImpactWorkItemClaims,
  recrossCrossDomainImpactManifestGateMap,
  recrossCrossDomainImpactWorkItemClaims,
} from "./cross-domain-impact-decision.ts";

Deno.test("impact decision recrosses each proposed gate onto exactly one work-item claim", () => {
  const transitions = recrossCrossDomainImpactWorkItemClaims(
    workItems(),
    [
      { gateItemId: "gate-electrical", role: "satisfies", status: "invalidated" },
      { gateItemId: "gate-thermal", role: "contributes-to", status: "invalidated" },
      { gateItemId: "gate-mechanical", role: "satisfies", status: "carried-forward" },
    ],
  );
  assertEquals(transitions.map((item) => item.workItemId), [
    "work-electrical",
    "work-mechanical",
    "work-thermal",
  ]);
  assertEquals(transitions.map((item) => item.previousStatus), [
    "current",
    "current",
    "current",
  ]);
});

Deno.test("impact manifest gateMap recrosses unique current work-item claims and names missing or ambiguous gates", () => {
  const gateMap = [
    { gateItemId: "gate-electrical", role: "satisfies" as const },
    { gateItemId: "gate-thermal", role: "contributes-to" as const },
    { gateItemId: "gate-mechanical", role: "satisfies" as const },
  ];
  const resolved = recrossCrossDomainImpactManifestGateMap(workItems(), gateMap);
  assertEquals(resolved.map((item) => item.workItemId), [
    "work-electrical",
    "work-thermal",
    "work-mechanical",
  ]);
  assertEquals(resolved.every((item) => item.status === "current"), true);

  assertThrows(
    () =>
      recrossCrossDomainImpactManifestGateMap(workItems(), [
        { gateItemId: "gate-missing", role: "satisfies" },
      ]),
    TypeError,
    'gateItemId "gate-missing" is a missing work-item gate claim',
  );
  const duplicated = workItems();
  duplicated.push({
    ...duplicated[0]!,
    id: "work-electrical-duplicate",
  });
  assertThrows(
    () => recrossCrossDomainImpactManifestGateMap(duplicated, gateMap),
    TypeError,
    'gateItemId "gate-electrical" is an ambiguous work-item gate claim',
  );
});

Deno.test("impact decision recross refuses missing, mismatched, and ambiguous work-item claims", () => {
  assertThrows(
    () =>
      recrossCrossDomainImpactWorkItemClaims(workItems(), [
        { gateItemId: "gate-missing", role: "satisfies", status: "invalidated" },
      ]),
    TypeError,
    "missing work-item gate claim",
  );
  assertThrows(
    () =>
      recrossCrossDomainImpactWorkItemClaims(workItems(), [
        {
          gateItemId: "gate-electrical",
          role: "contributes-to",
          status: "invalidated",
        },
      ]),
    TypeError,
    "mismatched work-item gate claim",
  );
  const duplicated = workItems();
  duplicated.push({
    ...duplicated[0]!,
    id: "work-electrical-duplicate",
  });
  assertThrows(
    () =>
      recrossCrossDomainImpactWorkItemClaims(duplicated, [
        { gateItemId: "gate-electrical", role: "satisfies", status: "invalidated" },
      ]),
    TypeError,
    "ambiguous work-item gate claim",
  );
});

Deno.test("impact decision applies the signed transitions atomically and leaves other work untouched", () => {
  const items = workItems();
  const applied = applyCrossDomainImpactWorkItemClaims(items, [
    {
      workItemId: "work-electrical",
      gateItemId: "gate-electrical",
      role: "satisfies",
      previousStatus: "current",
      status: "invalidated",
    },
    {
      workItemId: "work-mechanical",
      gateItemId: "gate-mechanical",
      role: "satisfies",
      previousStatus: "current",
      status: "carried-forward",
    },
    {
      workItemId: "work-thermal",
      gateItemId: "gate-thermal",
      role: "contributes-to",
      previousStatus: "current",
      status: "invalidated",
    },
  ]);
  assertEquals(applied.map((item) => item.status), [
    "completed",
    "completed",
    "completed",
  ]);
  assertEquals(applied[0]?.gateClaims?.[0]?.status, "invalidated");
  assertEquals(applied[1]?.gateClaims?.[0]?.status, "invalidated");
  assertEquals(applied[2]?.gateClaims?.[0]?.status, "carried-forward");
  assertEquals(items[0]?.gateClaims?.[0]?.status, "current");
});

Deno.test("impact decision apply refuses a stale previous claim status", () => {
  assertThrows(
    () =>
      applyCrossDomainImpactWorkItemClaims(workItems(), [
        {
          workItemId: "work-electrical",
          gateItemId: "gate-electrical",
          role: "satisfies",
          previousStatus: "invalidated",
          status: "invalidated",
        },
        {
          workItemId: "work-mechanical",
          gateItemId: "gate-mechanical",
          role: "satisfies",
          previousStatus: "current",
          status: "carried-forward",
        },
        {
          workItemId: "work-thermal",
          gateItemId: "gate-thermal",
          role: "contributes-to",
          previousStatus: "current",
          status: "invalidated",
        },
      ]),
    TypeError,
    "do not equal the signed impact-decision recross",
  );
});

function workItems(): EngineeringWorkItem[] {
  return [
    workItem("work-electrical", "gate-electrical", "satisfies"),
    workItem("work-thermal", "gate-thermal", "contributes-to"),
    workItem("work-mechanical", "gate-mechanical", "satisfies"),
  ];
}

function workItem(
  id: string,
  gateItemId: string,
  role: "satisfies" | "contributes-to",
): EngineeringWorkItem {
  return {
    id,
    activityId: `activity:${id}`,
    phaseId: "phase-proof",
    title: id,
    description: id,
    kind: "verify",
    status: "completed",
    owner: "agent",
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
    gateClaims: [{ gateItemId, role, status: "current" }],
  };
}
