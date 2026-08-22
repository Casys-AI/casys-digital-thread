import { assertEquals } from "@std/assert";
import type {
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingPartDef,
  ExistingPartUsage,
} from "./architecture-proposal.ts";
import { ratchetArchitectureGraph } from "./architecture-graph-ratchet.ts";
import {
  graph,
  part,
  proposal,
  RATCHET_CASES,
} from "./architecture-graph-ratchet-fixtures.ts";

type ArrangeMode = "identity" | "reverse" | "rotate";

function arrange<T>(items: readonly T[], mode: ArrangeMode): T[] {
  if (mode === "identity") return [...items];
  if (mode === "reverse") return [...items].reverse();
  if (items.length === 0) return [];
  return [...items.slice(1), items[0]!];
}

function arrangeGraph(
  structure: ExistingArchitectureStructure,
  mode: ArrangeMode,
): ExistingArchitectureStructure {
  return {
    ...structure,
    partDefs: arrange(structure.partDefs, mode).map((part) => ({
      ...part,
      usages: arrange(part.usages, mode),
      ...(part.attributes ? { attributes: arrange(part.attributes, mode) } : {}),
    })),
  };
}

function arrangeProposal(
  value: ArchitectureProposal,
  mode: ArrangeMode,
): ArchitectureProposal {
  return {
    ...value,
    components: arrange(value.components, mode),
    ...(value.attributes ? { attributes: arrange(value.attributes, mode) } : {}),
  };
}

const COUNTEREXAMPLE_PROPOSAL: ArchitectureProposal = {
  packageName: "Package",
  system: { name: "System" },
  components: [{
    name: "Component",
    usageName: "component",
    parentName: "System",
  }],
  attributes: [],
};

Deno.test(
  "same-id Block/Class PartDefinitions select a canonical rejected result in either order",
  () => {
    const a = { id: "same", kind: "Block", label: "System", usages: [] };
    const b = { id: "same", kind: "Class", label: "System", usages: [] };
    const live = (partDefs: readonly ExistingPartDef[]) => ({
      packageId: "pkg",
      packageLabel: "Package",
      partDefs,
    });
    const first = ratchetArchitectureGraph({
      proposal: COUNTEREXAMPLE_PROPOSAL,
      live: live([a, b]),
    });
    const second = ratchetArchitectureGraph({
      proposal: COUNTEREXAMPLE_PROPOSAL,
      live: live([b, a]),
    });
    assertEquals(first, second);
    assertEquals(first.status, "rejected");
    if (first.status === "rejected") {
      assertEquals(first.code, "live_part_definition_ambiguous_identity");
      assertEquals(first.context.kind, "Block");
      assertEquals(first.delta, [
        { subject: "PartDefinition", kind: "missing", label: "System" },
        {
          subject: "PartDefinition",
          kind: "unreviewed",
          id: "same",
          label: "System",
        },
      ]);
    }
  },
);

Deno.test(
  "architecture graph ratchet is order-independent under shuffled definitions and features",
  () => {
    const modes: readonly ArrangeMode[] = ["identity", "reverse", "rotate"];
    for (const testCase of RATCHET_CASES) {
      const canonical = ratchetArchitectureGraph({
        predecessor: testCase.predecessor,
        proposal: testCase.proposal,
        live: testCase.live,
      });
      for (const predecessorMode of modes) {
        for (const proposalMode of modes) {
          for (const liveMode of modes) {
            const result = ratchetArchitectureGraph({
              predecessor: testCase.predecessor
                ? arrangeGraph(testCase.predecessor, predecessorMode)
                : undefined,
              proposal: arrangeProposal(testCase.proposal, proposalMode),
              live: arrangeGraph(testCase.live, liveMode),
            });
            assertEquals(
              result,
              canonical,
              `${testCase.name} [${predecessorMode}/${proposalMode}/${liveMode}]`,
            );
          }
        }
      }
    }
  },
);

Deno.test(
  "pre-index PartDefinition count overflow is identity-free unreviewed",
  () => {
    const result = ratchetArchitectureGraph({
      proposal: proposal({ components: [], attributes: [] }),
      live: graph([
        part("def-system", "DemoSystem"),
        part("def-foreign", "Foreign"),
        part("def-other", "Other"),
      ]),
    });
    assertEquals(result.status, "rejected");
    if (result.status === "rejected") {
      assertEquals(result.code, "live_part_definition_unreviewed_or_replaced");
      assertEquals(result.context.admittedCount, 1);
      assertEquals(result.context.observedCount, 3);
      assertEquals(result.delta, [{
        subject: "PartDefinition",
        kind: "unreviewed",
      }]);
      assertEquals("id" in result.delta[0]!, false);
    }
  },
);

Deno.test(
  "same-id invalid PartUsages with different targets select a canonical result in either order",
  () => {
    const usageProposal: ArchitectureProposal = {
      packageName: "Package",
      system: { name: "System" },
      components: [
        { name: "Component", usageName: "left", parentName: "System" },
        { name: "Component", usageName: "right", parentName: "System" },
      ],
      attributes: [],
    };
    const left = {
      id: "same",
      kind: "ReferenceUsage",
      label: "left",
      targetId: "def-component",
      targetKind: "PartDefinition",
      targetLabel: "Component",
    };
    const right = {
      id: "same",
      kind: "ReferenceUsage",
      label: "right",
      targetId: "def-other",
      targetKind: "PartDefinition",
      targetLabel: "Other",
    };
    const liveOf = (usages: readonly ExistingPartUsage[]) => ({
      packageId: "pkg",
      packageLabel: "Package",
      partDefs: [
        { id: "def-system", kind: "PartDefinition", label: "System", usages },
        {
          id: "def-component",
          kind: "PartDefinition",
          label: "Component",
          usages: [],
        },
      ],
    });
    const first = ratchetArchitectureGraph({
      proposal: usageProposal,
      live: liveOf([left, right]),
    });
    const second = ratchetArchitectureGraph({
      proposal: usageProposal,
      live: liveOf([right, left]),
    });
    assertEquals(first, second);
    assertEquals(first.status, "rejected");
    if (first.status === "rejected") {
      assertEquals(first.code, "live_part_usage_ambiguous");
      assertEquals(first.context.label, "left");
      assertEquals(first.context.targetLabel, "Component");
      assertEquals(first.delta, [
        {
          subject: "PartUsage",
          kind: "missing",
          parentLabel: "System",
          label: "left",
          targetLabel: "Component",
        },
        {
          subject: "PartUsage",
          kind: "unreviewed",
          id: "same",
          label: "left",
          parentId: "def-system",
          parentLabel: "System",
          targetId: "def-component",
          targetLabel: "Component",
        },
      ]);
    }
  },
);
