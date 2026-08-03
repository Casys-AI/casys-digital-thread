import type {
  EngineeringOperationInputBinding,
  EngineeringProjectStartingPoint,
  EngineeringWorkItemKind,
} from "../../domain/engineering-project.ts";

/**
 * Static, reviewed CM-01 reference kits.
 *
 * These definitions are deliberately code-owned rather than provider
 * configuration. They describe the bounded evidence that the golden path may
 * plan; a later executor must be registered separately before any kit can run.
 * The shape is also the target contract for a future oracle-onboarding flow:
 * candidates may be proposed dynamically, but only a reviewed static kit is
 * eligible for this catalog.
 */

export type CoffeeMachineCm01V3EngineeringKitId =
  | "cm01.syson-architecture"
  | "cm01.cad-assembly"
  | "cm01.thermal-nominal"
  | "cm01.erp-bom-observation"
  | "cm01.drip-tray-static-proof";

export type CoffeeMachineCm01V3PresentationRole =
  | "architecture"
  | "cad"
  | "simulation"
  | "supply"
  | "verification";

export type CoffeeMachineCm01V3ActivityCategory =
  | "model"
  | "design"
  | "analysis"
  | "observation"
  | "verification";

/** Trusted is granted only after the corresponding server executor is wired. */
export type CoffeeMachineCm01V3OperationExecution =
  | "trusted"
  | "planning-only";

export type CoffeeMachineCm01V3SourceReferenceKind =
  | "golden-reference"
  | "historical-evidence"
  | "reviewed-configuration";

export interface CoffeeMachineCm01V3SourceReference {
  readonly kind: CoffeeMachineCm01V3SourceReferenceKind;
  /** Repository-relative, reviewed source. It is never a provider URI. */
  readonly path: string;
  readonly purpose: string;
}

/** Manual qualification is evidence of review, not runtime provider proof. */
export interface CoffeeMachineCm01V3KitQualification {
  readonly status: "manually-qualified";
  readonly sourceRefs: readonly CoffeeMachineCm01V3SourceReference[];
}

export interface CoffeeMachineCm01V3OperationRef {
  readonly id: string;
  readonly version: "1";
}

/**
 * Structural subset of the safe operation-registry descriptor.
 *
 * It intentionally carries neither an executor name nor provider/tool/argument
 * information, so importing it into the registry cannot grant authority.
 */
export interface CoffeeMachineCm01V3OperationDescriptor
  extends CoffeeMachineCm01V3OperationRef {
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly allowedBasisKinds: readonly (
    | "approved-brief"
    | "approved-discovery"
    | "thread-snapshot"
  )[];
  readonly title: string;
  readonly description: string;
  readonly workItemKind: EngineeringWorkItemKind;
  readonly riskClass: "low" | "consequential";
  /** A descriptor never embeds authority; trusted execution stays server-owned. */
  readonly execution: CoffeeMachineCm01V3OperationExecution;
  readonly bindings: readonly {
    readonly name: string;
    readonly allowedSourceKinds:
      readonly EngineeringOperationInputBinding["source"]["kind"][];
  }[];
}

export interface CoffeeMachineCm01V3EngineeringKit {
  readonly kitId: CoffeeMachineCm01V3EngineeringKitId;
  readonly kitVersion: "1";
  readonly qualification: CoffeeMachineCm01V3KitQualification;
  /** Explicitly limits what a completed operation may claim. */
  readonly evidenceBoundary: string;
  /** Generic UI metadata; neither value names a provider, tool, or product. */
  readonly presentationRole: CoffeeMachineCm01V3PresentationRole;
  readonly activityCategory: CoffeeMachineCm01V3ActivityCategory;
  readonly operation: CoffeeMachineCm01V3OperationDescriptor;
}

export const COFFEE_MACHINE_CM01_V3_OPERATION_REFS = Object.freeze(
  {
    architecture: Object.freeze(
      {
        id: "architecture.author-coffee-machine-cm01",
        version: "1",
      } as const,
    ),
    cad: Object.freeze(
      {
        id: "design.build-coffee-machine-cm01-cad",
        version: "1",
      } as const,
    ),
    thermal: Object.freeze(
      {
        id: "simulate.coffee-machine-cm01-thermal-nominal",
        version: "1",
      } as const,
    ),
    bom: Object.freeze(
      {
        id: "industrialize.observe-coffee-machine-cm01-bom",
        version: "1",
      } as const,
    ),
    mechanical: Object.freeze(
      {
        id: "verify.coffee-machine-cm01-drip-tray-mechanical",
        version: "1",
      } as const,
    ),
  } as const satisfies Record<string, CoffeeMachineCm01V3OperationRef>,
);

const APPROVED_BRIEF_BINDING = [{
  name: "approvedBrief",
  allowedSourceKinds: ["approved-brief"],
}] as const satisfies CoffeeMachineCm01V3OperationDescriptor["bindings"];

const KITS = [
  {
    kitId: "cm01.syson-architecture",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "golden-reference",
          path: "config/golden-references/coffee-machine-cm01-v3.json",
          purpose: "Defines the CM-01 architecture comparison contract.",
        },
        {
          kind: "historical-evidence",
          path: "config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
          purpose: "Provides the observed historical architecture lineage.",
        },
      ],
    },
    evidenceBoundary:
      "Captures a bounded system-model architecture and its read-back. It is not CAD, physical behavior, cost, manufacturing, certification, or a verification verdict.",
    presentationRole: "architecture",
    activityCategory: "model",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Author the CM-01 system architecture",
      description:
        "Record the reviewed CoffeeMachine CM-01 system architecture from the exact project baseline.",
      workItemKind: "architect",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_BINDING,
    },
  },
  {
    kitId: "cm01.cad-assembly",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "golden-reference",
          path: "config/golden-references/coffee-machine-cm01-v3.json",
          purpose: "Defines the expected derived CAD evidence roles.",
        },
        {
          kind: "reviewed-configuration",
          path: "config/thread-subjects/coffee-machine-cm01.build.json",
          purpose: "Defines the reviewed historical CM-01 CAD build declaration.",
        },
      ],
    },
    evidenceBoundary:
      "Captures generated geometry and its provenance. It does not establish editable product CAD, tolerances, manufacturability, fabrication release, or certification.",
    presentationRole: "cad",
    activityCategory: "design",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Build the CM-01 CAD assembly",
      description:
        "Generate and attest the reviewed CoffeeMachine CM-01 CAD assembly from traceable model values.",
      workItemKind: "design",
      riskClass: "low",
      execution: "trusted",
      bindings: APPROVED_BRIEF_BINDING,
    },
  },
  {
    kitId: "cm01.thermal-nominal",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "golden-reference",
          path: "config/golden-references/coffee-machine-cm01-v3.json",
          purpose: "Defines nominal thermal measurements and comparison tolerances.",
        },
        {
          kind: "historical-evidence",
          path: "config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
          purpose: "Provides the observed nominal thermal run evidence.",
        },
      ],
    },
    evidenceBoundary:
      "Captures one nominal thermal simulation scenario. It is not a product requirement verdict, physical test, safety assessment, certification, or complete machine validation.",
    presentationRole: "simulation",
    activityCategory: "analysis",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Run CM-01 nominal thermal simulation",
      description:
        "Run the reviewed nominal CoffeeMachine thermal scenario and record its observed measurements.",
      workItemKind: "simulate",
      riskClass: "low",
      execution: "trusted",
      bindings: APPROVED_BRIEF_BINDING,
    },
  },
  {
    kitId: "cm01.erp-bom-observation",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "golden-reference",
          path: "config/golden-references/coffee-machine-cm01-v3.json",
          purpose: "Defines the CM-01 BOM comparison boundary.",
        },
        {
          kind: "reviewed-configuration",
          path: "config/thread-subjects/coffee-machine-cm01.components.json",
          purpose: "Defines the reviewed CM-01 component and BOM identities.",
        },
      ],
    },
    evidenceBoundary:
      "Captures a dated manufacturing BOM observation. It does not establish current availability, supplier commitment, exact cost, purchasing approval, or fabrication release.",
    presentationRole: "supply",
    activityCategory: "observation",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Observe the CM-01 manufacturing BOM",
      description:
        "Capture the reviewed CoffeeMachine CM-01 manufacturing bill of materials as dated evidence.",
      workItemKind: "industrialize",
      riskClass: "low",
      execution: "trusted",
      bindings: APPROVED_BRIEF_BINDING,
    },
  },
  {
    kitId: "cm01.drip-tray-static-proof",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "golden-reference",
          path: "config/golden-references/coffee-machine-cm01-v3.json",
          purpose: "Defines the bounded DripTray comparison measurements and verdicts.",
        },
        {
          kind: "reviewed-configuration",
          path:
            "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json",
          purpose: "Defines the reviewed isolated DripTray analysis case and limits.",
        },
        {
          kind: "reviewed-configuration",
          path: "config/thread-workflows/coffee-machine-mechanical-v1.yaml",
          purpose: "Defines the reviewed CAD-to-analysis evidence sequence.",
        },
      ],
    },
    evidenceBoundary:
      "Concept verification only for the isolated CM-01 DripTray under its reviewed static case. It is not a whole-machine, certification, durability, safety, or fabrication-release claim.",
    presentationRole: "verification",
    activityCategory: "verification",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Verify the CM-01 DripTray concept",
      description:
        "Evaluate the reviewed isolated DripTray static proof case against named, traceable evidence.",
      workItemKind: "verify",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_BINDING,
    },
  },
] as const satisfies readonly CoffeeMachineCm01V3EngineeringKit[];

/** Return isolated copies so callers cannot mutate the code-owned catalog. */
export function listCoffeeMachineCm01V3EngineeringKits(): readonly CoffeeMachineCm01V3EngineeringKit[] {
  return KITS.map(copyKit);
}

/** Resolve one exact reviewed kit identity without exposing the backing array. */
export function getCoffeeMachineCm01V3EngineeringKit(
  kitId: CoffeeMachineCm01V3EngineeringKitId,
): CoffeeMachineCm01V3EngineeringKit | undefined {
  const kit = KITS.find((candidate) => candidate.kitId === kitId);
  return kit === undefined ? undefined : copyKit(kit);
}

/**
 * The registry consumes only these safe planning descriptors. Qualification,
 * source references and presentation metadata remain catalog data and never
 * become runtime provider authority.
 */
export function listCoffeeMachineCm01V3OperationDescriptors(): readonly CoffeeMachineCm01V3OperationDescriptor[] {
  return KITS.map((kit) => copyOperation(kit.operation));
}

function copyKit(
  kit: CoffeeMachineCm01V3EngineeringKit,
): CoffeeMachineCm01V3EngineeringKit {
  return {
    ...kit,
    qualification: {
      ...kit.qualification,
      sourceRefs: kit.qualification.sourceRefs.map((source) => ({ ...source })),
    },
    operation: copyOperation(kit.operation),
  };
}

function copyOperation(
  operation: CoffeeMachineCm01V3OperationDescriptor,
): CoffeeMachineCm01V3OperationDescriptor {
  return {
    ...operation,
    allowedBasisKinds: [...operation.allowedBasisKinds],
    bindings: operation.bindings.map((binding) => ({
      ...binding,
      allowedSourceKinds: [...binding.allowedSourceKinds],
    })),
  };
}
