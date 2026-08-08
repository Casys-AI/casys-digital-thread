import type { RegisteredEngineeringOperation } from "./registry.ts";

/**
 * The only provider-backed architecture operation for the approved V4 drone
 * brief.  It owns a fixed SysML recipe; these bindings are provenance gates,
 * not provider inputs.
 */
export const INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION = {
  id: "architecture.author-inspection-drone",
  version: "3",
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

export function listInspectionDroneV4OperationDescriptors(): readonly RegisteredEngineeringOperation[] {
  return [{
    ...INSPECTION_DRONE_V4_ARCHITECTURE_DESCRIPTOR,
    allowedBasisKinds: [
      ...INSPECTION_DRONE_V4_ARCHITECTURE_DESCRIPTOR.allowedBasisKinds,
    ],
    bindings: INSPECTION_DRONE_V4_ARCHITECTURE_DESCRIPTOR.bindings.map((binding) => ({
      ...binding,
      allowedSourceKinds: [...binding.allowedSourceKinds],
      ...("allowedThreadEntityKinds" in binding && binding.allowedThreadEntityKinds
        ? { allowedThreadEntityKinds: [...binding.allowedThreadEntityKinds] }
        : {}),
    })),
  }];
}
