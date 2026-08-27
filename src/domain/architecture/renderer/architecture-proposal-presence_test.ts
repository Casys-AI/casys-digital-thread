import { assertEquals } from "@std/assert";
import type {
  AdoptedItem,
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingPartDef,
  ExistingPartUsage,
} from "./architecture-proposal.ts";
import {
  type ArchitectureGraphDeltaKind,
  type ArchitectureGraphRatchetFailureCode,
  type ArchitectureGraphRatchetSubject,
  verifyProposedArchitecturePresence,
} from "./architecture-graph-ratchet.ts";

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

function wingOnly(): ArchitectureProposal {
  return proposal({
    components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
    attributes: [],
  });
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

function part(
  id: string,
  label: string,
  usages: readonly ExistingPartUsage[] = [],
): ExistingPartDef {
  return { id, kind: "PartDefinition", label, usages };
}

function graph(
  partDefs: readonly ExistingPartDef[],
): ExistingArchitectureStructure {
  return { packageId: "pkg-demo", packageLabel: "DemoPackage", partDefs };
}

const initialProposal = proposal({
  components: [
    { name: "Wing", usageName: "wing", parentName: "DemoSystem" },
    { name: "Motor", usageName: "leftMotor", parentName: "DemoSystem" },
    { name: "Motor", usageName: "rightMotor", parentName: "DemoSystem" },
    { name: "Motor", usageName: "mount", parentName: "Wing" },
  ],
});

const initialLive = graph([
  part("def-system", "DemoSystem", [
    usage("use-wing", "wing", "def-wing", "Wing"),
    usage("use-left", "leftMotor", "def-motor", "Motor"),
    usage("use-right", "rightMotor", "def-motor", "Motor"),
  ]),
  part("def-wing", "Wing", [usage("use-mount-wing", "mount", "def-motor", "Motor")]),
  part("def-motor", "Motor"),
]);

const KINDS: readonly ArchitectureGraphDeltaKind[] = [
  "inherited_exact",
  "reviewed_addition",
  "missing",
  "replaced",
  "moved",
  "duplicate",
  "unreviewed",
];

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
    proposal: wingOnly(),
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
    proposal: wingOnly(),
    adopted: [],
    status: "rejected",
    code: "proposal_component_part_definition_missing",
    subject: "PartDefinition",
    message: 'Verification failed: component PartDef "Wing" is absent after insertion.',
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
    proposal: wingOnly(),
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
    proposal: wingOnly(),
    adopted: [],
    status: "rejected",
    code: "live_part_usage_wrong_target",
    subject: "PartUsage",
    message:
      'Verification failed: usage "wing" under "DemoSystem" types "Motor" instead of the proposed "Wing".',
  },
  {
    name: "missing proposed PartUsage under parent",
    live: graph([part("def-system", "DemoSystem"), part("def-wing", "Wing")]),
    proposal: wingOnly(),
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
    proposal: wingOnly(),
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
    for (const item of result.delta) {
      assertEquals(KINDS.includes(item.kind), true, testCase.name);
    }
    if (testCase.status === "rejected" && result.status === "rejected") {
      assertEquals(result.code, testCase.code, testCase.name);
      assertEquals(result.subject, testCase.subject, testCase.name);
      assertEquals(result.message, testCase.message, testCase.name);
    }
  }
});
