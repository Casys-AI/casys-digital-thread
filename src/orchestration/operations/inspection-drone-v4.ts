import type { RegisteredEngineeringOperation } from "./operation-contract.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "../../domain/inspection-drone/author/inspection-drone-v4-architecture.ts";
import { INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION } from "../../domain/inspection-drone/part-definitions/inspection-drone-v4-part-definitions.ts";

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
