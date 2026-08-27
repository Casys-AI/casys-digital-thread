import { assertEquals } from "@std/assert";
import type {
  ArchitectureGraphDeltaItem,
  ArchitectureGraphDeltaKind,
} from "./architecture-graph-ratchet.ts";
import { ratchetArchitectureGraph } from "./architecture-graph-ratchet.ts";
import { ARCHITECTURE_RATCHET_MESSAGES as MSG } from "./architecture-graph-delta.ts";
import { RATCHET_CASES } from "./architecture-graph-ratchet-fixtures.ts";

function assertClosedDelta(
  items: readonly ArchitectureGraphDeltaItem[],
  name: string,
): void {
  const kinds: ArchitectureGraphDeltaKind[] = [
    "inherited_exact",
    "reviewed_addition",
    "missing",
    "replaced",
    "moved",
    "duplicate",
    "unreviewed",
  ];
  for (const item of items) {
    assertEquals(kinds.includes(item.kind), true, `${name}: ${item.subject}`);
  }
}

Deno.test("architecture graph ratchet accepts and rejects the closed SysML table", () => {
  for (const testCase of RATCHET_CASES) {
    const result = ratchetArchitectureGraph({
      predecessor: testCase.predecessor,
      proposal: testCase.proposal,
      live: testCase.live,
    });
    assertEquals(result.status, testCase.status, testCase.name);
    assertClosedDelta(result.delta, testCase.name);
    if (testCase.delta) {
      assertEquals(result.delta, testCase.delta, testCase.name);
    }
    if (testCase.status === "rejected" && result.status === "rejected") {
      assertEquals(result.code, testCase.code, testCase.name);
      assertEquals(result.subject, testCase.subject, testCase.name);
      assertEquals(result.message, testCase.message, testCase.name);
    }
  }
});

Deno.test(
  "malformed first-time PartDefinition occupying a proposal slot is missing plus unreviewed",
  () => {
    const result = ratchetArchitectureGraph({
      proposal: {
        packageName: "Package",
        system: { name: "System" },
        components: [],
        attributes: [],
      },
      live: {
        packageId: "pkg",
        packageLabel: "Package",
        partDefs: [{
          id: "def-system",
          kind: "Package",
          label: "System",
          usages: [],
        }],
      },
    });
    assertEquals(result.status, "rejected");
    if (result.status !== "rejected") return;
    assertEquals(result.code, "live_part_definition_ambiguous_identity");
    assertEquals(result.subject, "PartDefinition");
    assertEquals(result.message, MSG.liveDefKind);
    assertEquals(result.context, {
      id: "def-system",
      kind: "Package",
      label: "System",
    });
    assertEquals(result.delta, [
      { subject: "PartDefinition", kind: "missing", label: "System" },
      {
        subject: "PartDefinition",
        kind: "unreviewed",
        id: "def-system",
        label: "System",
      },
    ]);
  },
);

Deno.test(
  "malformed first-time PartUsage occupying a proposal slot is missing plus unreviewed",
  () => {
    const result = ratchetArchitectureGraph({
      proposal: {
        packageName: "Package",
        system: { name: "System" },
        components: [{
          name: "Component",
          usageName: "component",
          parentName: "System",
        }],
        attributes: [],
      },
      live: {
        packageId: "pkg",
        packageLabel: "Package",
        partDefs: [
          {
            id: "def-system",
            kind: "PartDefinition",
            label: "System",
            usages: [{
              kind: "PartUsage",
              label: "component",
              targetId: "def-component",
              targetKind: "PartDefinition",
              targetLabel: "Component",
            }],
          },
          {
            id: "def-component",
            kind: "PartDefinition",
            label: "Component",
            usages: [],
          },
        ],
      },
    });
    assertEquals(result.status, "rejected");
    if (result.status !== "rejected") return;
    assertEquals(result.code, "live_part_usage_ambiguous");
    assertEquals(result.subject, "PartUsage");
    assertEquals(result.message, MSG.liveUsageAmbiguous);
    assertEquals(result.context, {
      label: "component",
      parentId: "def-system",
      parentLabel: "System",
      targetId: "def-component",
      targetLabel: "Component",
    });
    assertEquals(result.delta, [
      {
        subject: "PartUsage",
        kind: "missing",
        parentLabel: "System",
        label: "component",
        targetLabel: "Component",
      },
      {
        subject: "PartUsage",
        kind: "unreviewed",
        label: "component",
        parentId: "def-system",
        parentLabel: "System",
        targetId: "def-component",
        targetLabel: "Component",
      },
    ]);
  },
);

Deno.test(
  "malformed first-time AttributeUsage occupying a proposal slot is missing plus unreviewed",
  () => {
    const result = ratchetArchitectureGraph({
      proposal: {
        packageName: "Package",
        system: { name: "System" },
        components: [{
          name: "Wing",
          usageName: "wing",
          parentName: "System",
        }],
        attributes: [{ name: "thickness", parentName: "Wing" }],
      },
      live: {
        packageId: "pkg",
        packageLabel: "Package",
        partDefs: [
          {
            id: "def-system",
            kind: "PartDefinition",
            label: "System",
            usages: [{
              id: "use-wing",
              kind: "PartUsage",
              label: "wing",
              targetId: "def-wing",
              targetKind: "PartDefinition",
              targetLabel: "Wing",
            }],
          },
          {
            id: "def-wing",
            kind: "PartDefinition",
            label: "Wing",
            usages: [],
            attributes: [{ kind: "AttributeUsage", label: "thickness" }],
          },
        ],
      },
    });
    assertEquals(result.status, "rejected");
    if (result.status !== "rejected") return;
    assertEquals(result.code, "live_attribute_usage_invalid");
    assertEquals(result.subject, "AttributeUsage");
    assertEquals(result.message, MSG.liveAttrInvalid);
    assertEquals(result.context, {
      label: "thickness",
      parentId: "def-wing",
      reason: "missing_id",
    });
    assertEquals(result.delta, [
      {
        subject: "AttributeUsage",
        kind: "missing",
        parentLabel: "Wing",
        label: "thickness",
      },
      {
        subject: "AttributeUsage",
        kind: "unreviewed",
        label: "thickness",
        parentId: "def-wing",
        parentLabel: "Wing",
      },
    ]);
  },
);
