/** Table fixtures for architecture graph ratchet tests. Not a runtime module. */

import type {
  ArchitectureProposal,
  ExistingArchitectureStructure,
  ExistingAttribute,
  ExistingPartDef,
  ExistingPartUsage,
} from "./architecture-proposal.ts";
import {
  ARCHITECTURE_RATCHET_MESSAGES as MSG,
  type ArchitectureGraphDeltaItem,
  type ArchitectureGraphDeltaKind,
  type ArchitectureGraphRatchetFailureCode,
  type ArchitectureGraphRatchetSubject,
  sortArchitectureGraphDelta,
} from "./architecture-graph-delta.ts";

const PACKAGE = { packageId: "pkg-demo", packageLabel: "DemoPackage" } as const;

export function proposal(
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

function wingOnly(
  extra: Partial<ArchitectureProposal> = {},
): ArchitectureProposal {
  return proposal({
    components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
    attributes: [],
    ...extra,
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

function attribute(id: string, label: string): ExistingAttribute {
  return { id, kind: "AttributeUsage", label };
}

export function part(
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

export function graph(
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

function d(
  subject: ArchitectureGraphDeltaItem["subject"],
  kind: ArchitectureGraphDeltaKind,
  fields: Omit<ArchitectureGraphDeltaItem, "subject" | "kind"> = {},
): ArchitectureGraphDeltaItem {
  return { subject, kind, ...fields };
}

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

const initialAcceptedDelta = sortArchitectureGraphDelta([
  d("Package", "reviewed_addition", { id: "pkg-demo", label: "DemoPackage" }),
  d("PartDefinition", "reviewed_addition", { id: "def-system", label: "DemoSystem" }),
  d("PartDefinition", "reviewed_addition", { id: "def-wing", label: "Wing" }),
  d("PartDefinition", "reviewed_addition", { id: "def-motor", label: "Motor" }),
  d("PartUsage", "reviewed_addition", {
    id: "use-wing",
    label: "wing",
    parentId: "def-system",
    parentLabel: "DemoSystem",
    targetId: "def-wing",
    targetLabel: "Wing",
  }),
  d("PartUsage", "reviewed_addition", {
    id: "use-left",
    label: "leftMotor",
    parentId: "def-system",
    parentLabel: "DemoSystem",
    targetId: "def-motor",
    targetLabel: "Motor",
  }),
  d("PartUsage", "reviewed_addition", {
    id: "use-right",
    label: "rightMotor",
    parentId: "def-system",
    parentLabel: "DemoSystem",
    targetId: "def-motor",
    targetLabel: "Motor",
  }),
  d("PartUsage", "reviewed_addition", {
    id: "use-mount-wing",
    label: "mount",
    parentId: "def-wing",
    parentLabel: "Wing",
    targetId: "def-motor",
    targetLabel: "Motor",
  }),
  d("AttributeUsage", "reviewed_addition", {
    id: "attr-thickness",
    label: "thickness",
    parentId: "def-wing",
    parentLabel: "Wing",
  }),
]);

const enrichmentAcceptedDelta = sortArchitectureGraphDelta([
  d("Package", "inherited_exact", { id: "pkg-demo", label: "DemoPackage" }),
  d("PartDefinition", "inherited_exact", { id: "def-system", label: "DemoSystem" }),
  d("PartDefinition", "inherited_exact", { id: "def-wing", label: "Wing" }),
  d("PartDefinition", "reviewed_addition", { id: "def-motor", label: "Motor" }),
  d("PartUsage", "inherited_exact", {
    id: "use-wing",
    label: "wing",
    parentId: "def-system",
    parentLabel: "DemoSystem",
    targetId: "def-wing",
    targetLabel: "Wing",
  }),
  d("PartUsage", "reviewed_addition", {
    id: "use-left",
    label: "leftMotor",
    parentId: "def-system",
    parentLabel: "DemoSystem",
    targetId: "def-motor",
    targetLabel: "Motor",
  }),
  d("PartUsage", "reviewed_addition", {
    id: "use-right",
    label: "rightMotor",
    parentId: "def-system",
    parentLabel: "DemoSystem",
    targetId: "def-motor",
    targetLabel: "Motor",
  }),
  d("AttributeUsage", "inherited_exact", {
    id: "attr-thickness",
    label: "thickness",
    parentId: "def-wing",
    parentLabel: "Wing",
  }),
]);

export const RATCHET_CASES: readonly {
  readonly name: string;
  readonly predecessor?: ExistingArchitectureStructure;
  readonly proposal: ArchitectureProposal;
  readonly live: ExistingArchitectureStructure;
  readonly status: "accepted" | "rejected";
  readonly code?: ArchitectureGraphRatchetFailureCode;
  readonly subject?: ArchitectureGraphRatchetSubject;
  readonly message?: string;
  readonly delta?: readonly ArchitectureGraphDeltaItem[];
}[] = [
  {
    name: "accepted initial write",
    proposal: initialProposal,
    live: initialLive,
    status: "accepted",
    delta: initialAcceptedDelta,
  },
  {
    name: "accepted enrichment with shared Motor target",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "accepted",
    delta: enrichmentAcceptedDelta,
  },
  {
    name: "accepted scoped homonyms and shared target",
    proposal: initialProposal,
    live: initialLive,
    status: "accepted",
    delta: initialAcceptedDelta,
  },
  {
    name: "package replacement",
    predecessor: { ...predecessorGraph, packageId: "pkg-old" },
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_package_replaced",
    subject: "Package",
    message: MSG.predPkg,
  },
  {
    name: "duplicate predecessor PartDefinition id",
    predecessor: graph([part("def-system", "DemoSystem"), part("def-system", "Wing")]),
    proposal: enrichmentProposal,
    live: enrichmentLive,
    status: "rejected",
    code: "predecessor_part_definition_duplicate_id",
    subject: "PartDefinition",
    message: MSG.predDefDup,
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
    message: MSG.predUsageDup,
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
    message: MSG.predAttrDup,
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
    message: MSG.predDefLabel,
  },
  {
    name: "duplicate live semantic id",
    proposal: initialProposal,
    live: graph([
      part("pkg-demo", "DemoSystem", [usage("use-wing", "wing", "def-wing", "Wing")]),
      part("def-wing", "Wing"),
    ]),
    status: "rejected",
    code: "live_semantic_id_duplicate",
    subject: "PartDefinition",
    message: MSG.liveIdDup,
  },
  {
    name: "unreviewed PartDefinition addition",
    proposal: proposal({ components: [], attributes: [] }),
    live: graph([part("def-system", "DemoSystem"), part("def-foreign", "Foreign")]),
    status: "rejected",
    code: "live_part_definition_unreviewed_or_replaced",
    subject: "PartDefinition",
    message: MSG.liveDef,
    delta: [d("PartDefinition", "unreviewed")],
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
    message: MSG.liveDef,
    delta: [d("PartDefinition", "missing", { label: "Motor" })],
  },
  {
    name: "missing and unreviewed PartDefinition labels",
    proposal: proposal({ components: [], attributes: [] }),
    live: graph([part("def-foreign", "Foreign")]),
    status: "rejected",
    code: "live_part_definition_unreviewed_or_replaced",
    subject: "PartDefinition",
    message: MSG.liveDef,
    delta: sortArchitectureGraphDelta([
      d("PartDefinition", "missing", { label: "DemoSystem" }),
      d("PartDefinition", "unreviewed", { label: "Foreign" }),
    ]),
  },
  {
    name: "live PartDefinition count exceeds attested universe",
    proposal: proposal({ components: [], attributes: [] }),
    live: graph([
      part("def-system", "DemoSystem"),
      part("def-foreign", "Foreign"),
      part("def-other", "Other"),
    ]),
    status: "rejected",
    code: "live_part_definition_unreviewed_or_replaced",
    subject: "PartDefinition",
    message: MSG.liveDef,
    delta: [d("PartDefinition", "unreviewed")],
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
    message: MSG.predDefReplaced,
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
    message: MSG.predUsageReplaced,
  },
  {
    name: "wrong new PartUsage target is unreviewed",
    proposal: wingOnly(),
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
    message: MSG.liveDef,
    delta: [d("PartDefinition", "unreviewed")],
  },
  {
    name: "wrong PartUsage target label on an otherwise exact occurrence",
    proposal: wingOnly(),
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
    message: MSG.liveUsageAmbiguous,
    delta: sortArchitectureGraphDelta([
      d("PartUsage", "missing", {
        parentLabel: "DemoSystem",
        label: "wing",
        targetLabel: "Wing",
      }),
      d("PartUsage", "unreviewed", {
        id: "use-wing",
        label: "wing",
        parentId: "def-system",
        parentLabel: "DemoSystem",
        targetId: "def-wing",
        targetLabel: "Motor",
      }),
    ]),
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
    message: MSG.liveDefKind,
    delta: sortArchitectureGraphDelta([
      d("PartDefinition", "missing", { label: "DemoSystem" }),
      d("PartDefinition", "unreviewed", {
        id: "def-system",
        label: "DemoSystem",
      }),
    ]),
  },
  {
    name: "unreviewed PartUsage occurrence",
    proposal: wingOnly(),
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
    message: MSG.liveUsageUnreviewed,
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
    message: MSG.proposalUsageMissing,
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
    message: MSG.predAttrMoved,
    delta: [d("AttributeUsage", "moved", {
      id: "attr-thickness",
      label: "thickness",
      parentId: "def-system",
      parentLabel: "DemoSystem",
    })],
  },
  {
    name: "predecessor AttributeUsage replaced under the same owner",
    predecessor: predecessorGraph,
    proposal: enrichmentProposal,
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
        usage("use-left", "leftMotor", "def-motor", "Motor"),
        usage("use-right", "rightMotor", "def-motor", "Motor"),
      ]),
      part("def-wing", "Wing", [], [attribute("attr-thickness-new", "thickness")]),
      part("def-motor", "Motor"),
    ]),
    status: "rejected",
    code: "predecessor_attribute_usage_replaced_or_moved",
    subject: "AttributeUsage",
    message: MSG.predAttrMoved,
    delta: [d("AttributeUsage", "replaced", {
      id: "attr-thickness-new",
      label: "thickness",
      parentId: "def-wing",
      parentLabel: "Wing",
    })],
  },
  {
    name: "invalid AttributeUsage missing id occupies the reviewed slot",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
    }),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing", [], [{ kind: "AttributeUsage", label: "thickness" }]),
    ]),
    status: "rejected",
    code: "live_attribute_usage_invalid",
    subject: "AttributeUsage",
    message: MSG.liveAttrInvalid,
    delta: sortArchitectureGraphDelta([
      d("AttributeUsage", "missing", {
        parentLabel: "Wing",
        label: "thickness",
      }),
      d("AttributeUsage", "unreviewed", {
        label: "thickness",
        parentId: "def-wing",
        parentLabel: "Wing",
      }),
    ]),
  },
  {
    name: "invalid AttributeUsage duplicate id is duplicate",
    proposal: proposal({
      components: [{ name: "Wing", usageName: "wing", parentName: "DemoSystem" }],
    }),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing", [], [attribute("pkg-demo", "thickness")]),
    ]),
    status: "rejected",
    code: "live_attribute_usage_invalid",
    subject: "AttributeUsage",
    message: MSG.liveAttrInvalid,
    delta: [d("AttributeUsage", "duplicate", {
      id: "pkg-demo",
      label: "thickness",
      parentId: "def-wing",
      parentLabel: "Wing",
    })],
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
    message: MSG.predAttrRemoved,
  },
  {
    name: "unreviewed AttributeUsage",
    proposal: wingOnly(),
    live: graph([
      part("def-system", "DemoSystem", [
        usage("use-wing", "wing", "def-wing", "Wing"),
      ]),
      part("def-wing", "Wing", [], [attribute("attr-foreign", "span")]),
    ]),
    status: "rejected",
    code: "live_attribute_usage_unreviewed",
    subject: "AttributeUsage",
    message: MSG.liveAttrUnreviewed,
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
    message: MSG.proposalAttrMissing,
  },
  {
    name: "duplicate live PartUsage ids under one PartDefinition",
    proposal: wingOnly(),
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
    message: MSG.predUsageDup,
  },
];
