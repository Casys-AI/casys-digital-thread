import { assertEquals } from "@std/assert";
import type {
  AdoptedItem,
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingAttribute,
  ExistingPartDef,
  ExistingPartUsage,
} from "./architecture-proposal.ts";
import {
  type ArchitectureGraphRatchetFailureCode,
  type ArchitectureGraphRatchetSubject,
  ratchetArchitectureGraph,
  verifyProposedArchitecturePresence,
} from "./architecture-graph-ratchet.ts";

const PACKAGE = { packageId: "pkg-demo", packageLabel: "DemoPackage" } as const;

function proposal(
  overrides: Partial<ArchitectureProposal> = {},
): ArchitectureProposal {
  return {
    packageName: "DemoPackage",
    system: { name: "DemoSystem" },
    components: [
      { name: "Wing", usageName: "wing", parentName: "DemoSystem" },
      { name: "Motor", usageName: "leftMotor", parentName: "DemoSystem" },
      { name: "Motor", usageName: "rightMotor", parentName: "DemoSystem" },
    ],
    attributes: [{ name: "thickness", parentName: "Wing" }],
    ...overrides,
  };
}

function usage(
  id: string,
  label: string,
  targetId: string,
  targetLabel: string,
): ExistingPartUsage {
  return {
    id,
    kind: "PartUsage",
    label,
    targetId,
    targetKind: "PartDefinition",
    targetLabel,
  };
}

function attribute(id: string, label: string): ExistingAttribute {
  return { id, kind: "AttributeUsage", label };
}

function part(
  id: string,
  label: string,
  usages: readonly ExistingPartUsage[] = [],
  attributes: readonly ExistingAttribute[] = [],
): ExistingPartDef {
  return {
    id,
    kind: "PartDefinition",
    label,
    usages,
    ...(attributes.length > 0 ? { attributes } : {}),
  };
}

function graph(
  partDefs: readonly ExistingPartDef[],
  pkg = PACKAGE,
): ExistingArchitectureStructure {
  return { ...pkg, partDefs };
}

const initialLive = graph([
  part("def-system", "DemoSystem", [
    usage("use-wing", "wing", "def-wing", "Wing"),
    usage("use-left", "leftMotor", "def-motor", "Motor"),
    usage("use-right", "rightMotor", "def-motor", "Motor"),
  ]),
  part("def-wing", "Wing", [
    usage("use-mount-wing", "mount", "def-motor", "Motor"),
  ], [attribute("attr-thickness", "thickness")]),
  part("def-motor", "Motor"),
]);

const initialProposal = proposal({
  components: [
    { name: "Wing", usageName: "wing", parentName: "DemoSystem" },
    { name: "Motor", usageName: "leftMotor", parentName: "DemoSystem" },
    { name: "Motor", usageName: "rightMotor", parentName: "DemoSystem" },
    { name: "Motor", usageName: "mount", parentName: "Wing" },
  ],
});

const predecessorGraph = graph([
  part("def-system", "DemoSystem", [
    usage("use-wing", "wing", "def-wing", "Wing"),
  ]),
  part("def-wing", "Wing", [], [attribute("attr-thickness", "thickness")]),
]);

const enrichmentProposal = proposal({
  components: [
    { name: "Wing", usageName: "wing", parentName: "DemoSystem" },
    { name: "Motor", usageName: "leftMotor", parentName: "DemoSystem" },
    { name: "Motor", usageName: "rightMotor", parentName: "DemoSystem" },
  ],
});

const enrichmentLive = graph([
  part("def-system", "DemoSystem", [
    usage("use-wing", "wing", "def-wing", "Wing"),
    usage("use-left", "leftMotor", "def-motor", "Motor"),
    usage("use-right", "rightMotor", "def-motor", "Motor"),
  ]),
  part("def-wing", "Wing", [], [attribute("attr-thickness", "thickness")]),
  part("def-motor", "Motor"),
]);

const RATCHET_CASES: readonly {
  readonly name: string;
  readonly predecessor?: ExistingArchitectureStructure;
  readonly proposal: ArchitectureProposal;
  readonly live: ExistingArchitectureStructure;
  readonly status: "accepted" | "rejected";
  readonly code?: ArchitectureGraphRatchetFailureCode;
  readonly subject?: ArchitectureGraphRatchetSubject;
  readonly message?: string;
}[] = [
  {
    name: "accepted initial write",
    proposal: initialProposal,
    live: initialLive,
    status: "accepted",
  },
  {
    name: "accepted enrichment with shared Motor target",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "accepted",
  },
  {
    name: "accepted scoped homonyms and shared target",
    proposal: initialProposal,
    live: initialLive,
    status: "accepted",
  },
  {
    name: "package replacement",
    predecessor: { ...predecessorGraph, packageId: "pkg-old" },
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_package_replaced",
    subject: "Package",
    message:
      "Verification failed: the attested predecessor Package was replaced or removed.",
  },
  {
    name: "duplicate predecessor PartDefinition id",
    predecessor: graph([
      part("def-system", "DemoSystem"),
      part("def-system", "Wing"),
    ]),
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_part_definition_duplicate_id",
    subject: "PartDefinition",
    message:
      "Verification failed: the predecessor capture repeats a PartDefinition identity.",
  },
  {
    name: "duplicate predecessor PartUsage id",
    predecessor: graph([
      part("def-system", "DemoSystem", [
        usage("use-dup", "wing", "def-wing", "Wing"),
        usage("use-dup", "other", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_part_usage_duplicate_id",
    subject: "PartUsage",
    message:
      "Verification failed: the predecessor capture repeats a PartUsage identity.",
  },
  {
    name: "duplicate predecessor AttributeUsage id",
    predecessor: graph([
      part("def-system", "DemoSystem"),
      part("def-wing", "Wing", [], [
        attribute("attr-dup", "thickness"),
        attribute("attr-dup", "span"),
      ]),
    ]),
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_attribute_usage_duplicate_id",
    subject: "AttributeUsage",
    message:
      "Verification failed: the predecessor capture repeats an AttributeUsage identity.",
  },
  {
    name: "ambiguous predecessor PartDefinition labels",
    predecessor: graph([
      part("def-system", "DemoSystem"),
      part("def-wing-a", "Wing"),
      part("def-wing-b", "Wing"),
    ]),
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_part_definition_ambiguous_label",
    subject: "PartDefinition",
    message:
      "Verification failed: the predecessor capture has ambiguous PartDefinition labels.",
  },
  {
    name: "duplicate live semantic id",
    proposal: initialProposal,
    live: graph([
      part("pkg-demo", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    status: "rejected",
    code: "live_semantic_id_duplicate",
    subject: "PartDefinition",
    message:
      "Verification failed: live architecture repeats a semantic identity across its Package, PartDefinitions, or PartUsages.",
  },
  {
    name: "unreviewed PartDefinition addition",
    proposal: proposal({ components: [], attributes: [] }),
    live: graph([
      part("def-system", "DemoSystem"),
      part("def-foreign", "Foreign"),
    ]),
    status: "rejected",
    code: "live_part_definition_unreviewed_or_replaced",
    subject: "PartDefinition",
    message:
      "Verification failed: live architecture contains an unreviewed PartDefinition addition, removal, replacement, or duplicate.",
  },
  {
    name: "missing proposed PartDefinition",
    proposal: initialProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing", [], [attribute("attr-thickness", "thickness")]),
    ]),
    status: "rejected",
    code: "live_part_definition_unreviewed_or_replaced",
    subject: "PartDefinition",
    message:
      "Verification failed: live architecture contains an unreviewed PartDefinition addition, removal, replacement, or duplicate.",
  },
  {
    name: "predecessor PartDefinition replaced",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-left", "leftMotor", "def-motor", "Motor"),
        usage("use-right", "rightMotor", "def-motor", "Motor"),
      ]),
      part("def-wing-new", "Wing", [], [attribute("attr-thickness", "thickness")]),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "predecessor_part_definition_replaced",
    subject: "PartDefinition",
    message:
      "Verification failed: an attested predecessor PartDefinition was replaced or removed.",
  },
  {
    name: "predecessor PartUsage replaced",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-motor", "Motor"),
        usage("use-left", "leftMotor", "def-motor", "Motor"),
        usage("use-right", "rightMotor", "def-motor", "Motor"),
      ]),
      part("def-wing", "Wing", [], [attribute("attr-thickness", "thickness")]),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "predecessor_part_usage_replaced",
    subject: "PartUsage",
    message:
      "Verification failed: an attested predecessor PartUsage was replaced or removed.",
  },
  {
    name: "wrong new PartUsage target is unreviewed",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-motor", "Motor"),
      ]),
      part("def-wing", "Wing"),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "live_part_definition_unreviewed_or_replaced",
    subject: "PartDefinition",
    message:
      "Verification failed: live architecture contains an unreviewed PartDefinition addition, removal, replacement, or duplicate.",
  },
  {
    name: "wrong PartUsage target label on an otherwise exact occurrence",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    live: graph([
      part("def-system", "DemoSystem", [{
        id: "use-wing",
        kind: "PartUsage",
        label: "wing",
        targetId: "def-wing",
        targetKind: "PartDefinition",
        targetLabel: "Motor",
      }]),
      part("def-wing", "Wing"),
    ]),
    status: "rejected",
    code: "live_part_usage_ambiguous",
    subject: "PartUsage",
    message:
      "Verification failed: live architecture has an invalid or ambiguous PartUsage occurrence.",
  },
  {
    name: "ambiguous live PartDefinition kind",
    proposal: proposal({ components: [], attributes: [] }),
    live: graph([{
      id: "def-system",
      kind: "Package",
      label: "DemoSystem",
      usages: [],
    }]),
    status: "rejected",
    code: "live_part_definition_ambiguous_identity",
    subject: "PartDefinition",
    message:
      "Verification failed: live architecture has an ambiguous PartDefinition identity.",
  },
  {
    name: "unreviewed PartUsage occurrence",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-extra", "spare", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    status: "rejected",
    code: "live_part_usage_unreviewed",
    subject: "PartUsage",
    message:
      "Verification failed: live architecture contains an unreviewed PartUsage occurrence outside the attested predecessor plus proposal graph.",
  },
  {
    name: "missing proposed PartUsage",
    proposal: initialProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-left", "leftMotor", "def-motor", "Motor"),
      ]),
      part("def-wing", "Wing", [], [attribute("attr-thickness", "thickness")]),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "proposal_part_usage_missing",
    subject: "PartUsage",
    message:
      "Verification failed: a proposal PartUsage occurrence is absent from live architecture.",
  },
  {
    name: "AttributeUsage owner move",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-left", "leftMotor", "def-motor", "Motor"),
        usage("use-right", "rightMotor", "def-motor", "Motor"),
      ], [attribute("attr-thickness", "thickness")]),
      part("def-wing", "Wing"),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "predecessor_attribute_usage_replaced_or_moved",
    subject: "AttributeUsage",
    message:
      "Verification failed: an attested predecessor AttributeUsage was replaced or moved.",
  },
  {
    name: "predecessor AttributeUsage removed",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-left", "leftMotor", "def-motor", "Motor"),
        usage("use-right", "rightMotor", "def-motor", "Motor"),
      ]),
      part("def-wing", "Wing"),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "predecessor_attribute_usage_removed",
    subject: "AttributeUsage",
    message:
      "Verification failed: an attested predecessor AttributeUsage was replaced or removed.",
  },
  {
    name: "unreviewed AttributeUsage",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing", [], [attribute("attr-foreign", "span")]),
    ]),
    status: "rejected",
    code: "live_attribute_usage_unreviewed",
    subject: "AttributeUsage",
    message:
      "Verification failed: live architecture contains an unreviewed AttributeUsage outside the attested predecessor plus proposal graph.",
  },
  {
    name: "missing proposed AttributeUsage",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
    }),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    status: "rejected",
    code: "proposal_attribute_usage_missing",
    subject: "AttributeUsage",
    message:
      "Verification failed: a proposal AttributeUsage is absent from live architecture.",
  },
  {
    name: "duplicate live PartUsage ids under one PartDefinition",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    predecessor: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-wing", "spare", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-wing", "spare", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    status: "rejected",
    code: "predecessor_part_usage_duplicate_id",
    subject: "PartUsage",
    message:
      "Verification failed: the predecessor capture repeats a PartUsage identity.",
  },
];

Deno.test("architecture graph ratchet accepts and rejects the closed SysML table", () => {
  for (const testCase of RATCHET_CASES) {
    const result = ratchetArchitectureGraph({
      predecessor: testCase.predecessor,
      proposal: testCase.proposal,
      live: testCase.live,
    });
    assertEquals(result.status, testCase.status, testCase.name);
    if (testCase.status === "rejected" && result.status === "rejected") {
      assertEquals(result.code, testCase.code, testCase.name);
      assertEquals(result.subject, testCase.subject, testCase.name);
      assertEquals(result.message, testCase.message, testCase.name);
    }
  }
});

const PRESENCE_CASES: readonly {
  readonly name: string;
  readonly live?: ExistingArchitectureStructure;
  readonly proposal: ArchitectureProposal;
  readonly adopted: readonly AdoptedItem[];
  readonly status: "accepted" | "rejected";
  readonly code?: ArchitectureGraphRatchetFailureCode;
  readonly subject?: ArchitectureGraphRatchetSubject;
  readonly message?: string;
}[] = [
  {
    name: "accepted presence for scoped homonyms",
    live: initialLive,
    proposal: initialProposal,
    adopted: [],
    status: "accepted",
  },
  {
    name: "ambiguous PartDefinition labels after insertion",
    live: graph([
      part("def-system", "DemoSystem"),
      part("def-wing-a", "Wing"),
      part("def-wing-b", "Wing"),
    ]),
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [],
    status: "rejected",
    code: "live_part_definition_ambiguous_label",
    subject: "PartDefinition",
    message:
      "Verification failed: ambiguous PartDefinition labels after insertion: Wing. Manual SysON inspection required.",
  },
  {
    name: "missing system PartDefinition",
    live: graph([part("def-wing", "Wing")]),
    proposal: proposal({ components: [], attributes: [] }),
    adopted: [],
    status: "rejected",
    code: "proposal_system_part_definition_missing",
    subject: "PartDefinition",
    message:
      'Verification failed: system PartDef "DemoSystem" is absent after insertion.',
  },
  {
    name: "missing component PartDefinition",
    live: graph([part("def-system", "DemoSystem")]),
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [],
    status: "rejected",
    code: "proposal_component_part_definition_missing",
    subject: "PartDefinition",
    message:
      'Verification failed: component PartDef "Wing" is absent after insertion.',
  },
  {
    name: "missing parent PartDefinition",
    live: graph([part("def-wing", "Wing"), part("def-motor", "Motor")]),
    proposal: proposal({
      system: { name: "Wing" },
      components: [{ name: "Motor", usageName: "motor", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [],
    status: "rejected",
    code: "proposal_parent_part_definition_missing",
    subject: "PartDefinition",
    message:
      'Verification failed: parent PartDef "DemoSystem" for component "Motor" is absent after insertion.',
  },
  {
    name: "ambiguous PartUsage label under one parent",
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing-a", "wing", "def-wing", "Wing"),
        usage("use-wing-b", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [],
    status: "rejected",
    code: "live_part_usage_label_ambiguous",
    subject: "PartUsage",
    message:
      'Verification failed: usage "wing" appears 2 times under "DemoSystem". A unique parent→usage→target relationship is required.',
  },
  {
    name: "wrong PartUsage target",
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-motor", "Motor"),
      ]),
      part("def-wing", "Wing"),
      part("def-motor", "Motor"),
    ]),
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [],
    status: "rejected",
    code: "live_part_usage_wrong_target",
    subject: "PartUsage",
    message:
      'Verification failed: usage "wing" under "DemoSystem" types "Motor" instead of the proposed "Wing".',
  },
  {
    name: "missing proposed PartUsage under parent",
    live: graph([
      part("def-system", "DemoSystem"),
      part("def-wing", "Wing"),
    ]),
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [],
    status: "rejected",
    code: "proposal_part_usage_absent_under_parent",
    subject: "PartUsage",
    message:
      'Verification failed: usage "wing" is absent under "DemoSystem" after insertion of component "Wing".',
  },
  {
    name: "adopted PartDefinition removed",
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing"),
    ]),
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
      attributes: [],
    }),
    adopted: [{ componentName: "Motor", existingPartDefId: "def-motor" }],
    status: "rejected",
    code: "adopted_part_definition_removed",
    subject: "PartDefinition",
    message:
      'Verification failed: previously-adopted component "Motor" was removed from the model during this run.',
  },
];

Deno.test("proposed architecture presence accepts and rejects the closed SysML table", () => {
  for (const testCase of PRESENCE_CASES) {
    const result = verifyProposedArchitecturePresence({
      live: testCase.live,
      proposal: testCase.proposal,
      adopted: testCase.adopted,
    });
    assertEquals(result.status, testCase.status, testCase.name);
    if (testCase.status === "rejected" && result.status === "rejected") {
      assertEquals(result.code, testCase.code, testCase.name);
      assertEquals(result.subject, testCase.subject, testCase.name);
      assertEquals(result.message, testCase.message, testCase.name);
    }
  }
});
