import type { RegisteredEngineeringOperation } from "./operation-contract.ts";

/**
 * The only provider-backed architecture operation for the approved V4 drone
 * brief.  It owns a fixed SysML recipe; these bindings are provenance gates,
 * not provider inputs.
 */
export const INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION = {
  id: "architecture.author-inspection-drone",
  version: "3",
} as const;

/**
 * Read-only successor to the architecture run. The provider is queried only
 * against the content-addressed architecture artifact attached to r3.
 */
export const INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION = {
  id: "model.capture-inspection-drone-part-definitions",
  version: "1",
} as const;

export const INSPECTION_DRONE_V4_ARCHITECTURE_DESCRIPTOR = {
  ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Author the qualitative inspection-drone architecture",
  description:
    "Insert the reviewed qualitative inspection-drone SysML architecture into the exact empty SysON model container. It preserves explicit TBDs and produces no CAD, physics, operational-flight, certification, or manufacturing verdict.",
  workItemKind: "architect",
  riskClass: "low",
  execution: "trusted",
  bindings: [
    {
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    },
    {
      name: "sysonModelSeed",
      allowedSourceKinds: ["thread-entity"],
      allowedThreadEntityKinds: ["artifact"],
    },
  ],
} as const satisfies RegisteredEngineeringOperation;

export const INSPECTION_DRONE_V4_PART_DEFINITIONS_DESCRIPTOR = {
  ...INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
  startingPoint: "idea-or-spec",
  allowedBasisKinds: ["thread-snapshot"],
  title: "Capture the inspection-drone PartDefinitions",
  description:
    "Read the six reviewed inspection-drone PartDefinitions from the exact r3 SysON architecture and record a content-addressed product-structure bundle. It performs no SysML write, CAD, physics, quantity inference, or verdict.",
  workItemKind: "define",
  riskClass: "low",
  execution: "trusted",
  bindings: [{
    name: "architecture",
    allowedSourceKinds: ["thread-entity"],
    allowedThreadEntityKinds: ["artifact"],
  }],
} as const satisfies RegisteredEngineeringOperation;

export function listInspectionDroneV4OperationDescriptors(): readonly RegisteredEngineeringOperation[] {
  return [
    INSPECTION_DRONE_V4_ARCHITECTURE_DESCRIPTOR,
    INSPECTION_DRONE_V4_PART_DEFINITIONS_DESCRIPTOR,
  ].map((descriptor) => ({
    ...descriptor,
    allowedBasisKinds: [
      ...descriptor.allowedBasisKinds,
    ],
    bindings: descriptor.bindings.map((binding) => ({
      ...binding,
      allowedSourceKinds: [...binding.allowedSourceKinds],
      ...("allowedThreadEntityKinds" in binding && binding.allowedThreadEntityKinds
        ? { allowedThreadEntityKinds: [...binding.allowedThreadEntityKinds] }
        : {}),
    })),
  }));
}
