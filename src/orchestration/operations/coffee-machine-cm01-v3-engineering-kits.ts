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
  | "cm01.syson-oracle-requirements"
  | "cm01.cad-assembly"
  | "cm01.drip-tray-height-correction"
  | "cm01.cad-assembly-drip-tray-height-30"
  | "cm01.thermal-nominal"
  | "cm01.erp-bom-observation"
  | "cm01.drip-tray-static-proof"
  | "cm01.drip-tray-static-proof-height-30"
  | "cm01.drip-tray-static-proof-height-30-r3"
  | "cm01.drip-tray-static-proof-height-30-r3-identity-recovery"
  | "cm01.drip-tray-sensitivity";

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
  readonly version: "1" | "2" | "3";
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
  readonly kitVersion: "1" | "2" | "3";
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
    /** Records the one reviewed design correction before it schedules R2 work. */
    dripTrayHeightCorrection: Object.freeze(
      {
        id: "design.correct-coffee-machine-cm01-drip-tray-height",
        version: "1",
      } as const,
    ),
    /** Strict follow-up path for the one code-owned 28 mm -> 30 mm correction. */
    cadDripTrayHeight30: Object.freeze(
      {
        id: "design.build-coffee-machine-cm01-cad",
        version: "2",
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
    /** Must consume the R2 CAD result; it is never an independent repeat. */
    mechanicalDripTrayHeight30: Object.freeze(
      {
        id: "verify.coffee-machine-cm01-drip-tray-mechanical",
        version: "2",
      } as const,
    ),
    /** A separate recovery contract after the recorded failed R2 attempt. */
    mechanicalDripTrayHeight30R3: Object.freeze(
      {
        id: "verify.coffee-machine-cm01-drip-tray-mechanical",
        version: "3",
      } as const,
    ),
    /** Reprojects the one retained R3 capture whose R10 labels were wrong. */
    mechanicalDripTrayHeight30R3IdentityRecovery: Object.freeze(
      {
        id: "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
        version: "1",
      } as const,
    ),
    /**
     * Writes the reviewed DripTray mechanical limits into the SysML model as a
     * named PartDef element, then verifies re-extraction against the canonical
     * fingerprint. No provider arguments flow from the agent — the thresholds
     * come from the committed proof JSON via the server-fixed executor.
     */
    oracleRequirements: Object.freeze(
      {
        id: "model.write-coffee-machine-cm01-oracle-requirements",
        version: "1",
      } as const,
    ),
    /**
     * First-order forward finite-difference sensitivity of the DripTray FEA
     * metrics with respect to size-z at the reviewed 30 mm R2 baseline.
     * Produces local derivatives (value + unit); no verdict, no evaluation,
     * no requirement claim.
     */
    sensitivityDripTrayBaseZ: Object.freeze(
      {
        id: "analyze.coffee-machine-cm01-drip-tray-size-z-sensitivity",
        version: "1",
      } as const,
    ),
  } as const satisfies Record<string, CoffeeMachineCm01V3OperationRef>,
);

const APPROVED_BRIEF_BINDING = [{
  name: "approvedBrief",
  allowedSourceKinds: ["approved-brief"],
}] as const satisfies CoffeeMachineCm01V3OperationDescriptor["bindings"];

const APPROVED_BRIEF_AND_ARCHITECTURE_ARTIFACT_BINDINGS = [
  ...APPROVED_BRIEF_BINDING,
  {
    name: "architectureArtifact",
    allowedSourceKinds: ["thread-entity"],
  },
] as const satisfies CoffeeMachineCm01V3OperationDescriptor["bindings"];

const APPROVED_BRIEF_AND_DRIP_TRAY_CORRECTION_BINDINGS = [
  ...APPROVED_BRIEF_BINDING,
  {
    name: "dripTrayHeightCorrection",
    allowedSourceKinds: ["thread-entity"],
  },
] as const satisfies CoffeeMachineCm01V3OperationDescriptor["bindings"];

const APPROVED_BRIEF_AND_REVISED_CAD_BINDINGS = [
  ...APPROVED_BRIEF_AND_DRIP_TRAY_CORRECTION_BINDINGS,
  {
    name: "revisedCadStep",
    allowedSourceKinds: ["thread-entity"],
  },
] as const satisfies CoffeeMachineCm01V3OperationDescriptor["bindings"];

const APPROVED_BRIEF_AND_HISTORICAL_R3_RESULT_BINDINGS = [
  ...APPROVED_BRIEF_BINDING,
  {
    name: "historicalMechanicalR3Result",
    allowedSourceKinds: ["thread-entity"],
  },
] as const satisfies CoffeeMachineCm01V3OperationDescriptor["bindings"];

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
    kitId: "cm01.syson-oracle-requirements",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "reviewed-configuration",
          path:
            "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-static.json",
          purpose:
            "Defines the reviewed DripTray mechanical limits (thresholds and units) that are anchored in the SysML model.",
        },
        {
          kind: "reviewed-configuration",
          path: "src/domain/proof-case.ts",
          purpose:
            "Provides the deterministic SysML renderer and fingerprint that produce the canonical requirement element text.",
        },
        {
          kind: "reviewed-configuration",
          path: "src/adapters/syson-requirements-extractor.ts",
          purpose:
            "Defines the extraction and verification contract that re-reads the anchored requirements after insertion.",
        },
      ],
    },
    /**
     * Anchors a reviewed declaration only. This kit does not produce a
     * verification verdict, run a solver, generate CAD, make a cost or
     * supply claim, assess durability or safety, or constitute certification
     * of the product or the component.
     */
    evidenceBoundary:
      "Anchors the reviewed DripTray mechanical requirement declarations as a named SysML element. It is not a verification verdict, solver run, CAD result, whole-machine claim, durability assessment, safety analysis, or certification.",
    presentationRole: "architecture",
    activityCategory: "model",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.oracleRequirements,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Write the CM-01 oracle requirements into the SysML model",
      description:
        "Insert the reviewed DripTray mechanical requirement declarations into the CM-01 SysON model from the committed proof JSON, then verify re-extraction matches the canonical fingerprint.",
      workItemKind: "architect",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_AND_ARCHITECTURE_ARTIFACT_BINDINGS,
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
    kitId: "cm01.drip-tray-height-correction",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "reviewed-configuration",
          path: "src/domain/cm01-drip-tray-height-correction.ts",
          purpose:
            "Defines the one code-owned 28 mm to 30 mm DripTray correction and its bounded impact set.",
        },
      ],
    },
    evidenceBoundary:
      "Records the reviewed CM-01 DripTray geometry correction and invalidates only bounded stale evidence. It performs no CAD, solver, thermal, ERP, manufacturing, certification, or fabrication-release operation.",
    presentationRole: "cad",
    activityCategory: "design",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.dripTrayHeightCorrection,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Record CM-01 30 mm DripTray correction",
      description:
        "Record the reviewed 28 mm to 30 mm CM-01 DripTray correction before successor CAD and mechanical evidence is recomputed.",
      workItemKind: "design",
      riskClass: "consequential",
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
    kitId: "cm01.cad-assembly-drip-tray-height-30",
    kitVersion: "2",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "reviewed-configuration",
          path: "src/domain/coffee-machine-cm01-semantic-recipe.ts",
          purpose:
            "Defines the closed R2 semantic recipe with DripTray size-z fixed at 30 mm.",
        },
        {
          kind: "reviewed-configuration",
          path: "src/domain/cm01-drip-tray-height-correction.ts",
          purpose:
            "Defines the code-owned 28 mm to 30 mm correction and its bounded impact set.",
        },
      ],
    },
    evidenceBoundary:
      "Rebuilds only the reviewed CM-01 CAD evidence after the named DripTray height correction. It does not recalculate thermal behavior, refresh an ERP observation, release fabrication, or certify the product.",
    presentationRole: "cad",
    activityCategory: "design",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Rebuild CM-01 CAD for the 30 mm DripTray",
      description:
        "Generate the reviewed CM-01 CAD evidence from the exact 28 mm to 30 mm DripTray correction record.",
      workItemKind: "design",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_AND_DRIP_TRAY_CORRECTION_BINDINGS,
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
  {
    kitId: "cm01.drip-tray-static-proof-height-30",
    kitVersion: "2",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "reviewed-configuration",
          path: "src/domain/cm01-drip-tray-mechanical-proof.ts",
          purpose:
            "Defines the closed R2 isolated DripTray static proof with height fixed at 30 mm.",
        },
        {
          kind: "reviewed-configuration",
          path: "src/domain/cm01-drip-tray-height-correction.ts",
          purpose:
            "Binds the mechanical recomputation to the same explicit design correction as CAD.",
        },
      ],
    },
    evidenceBoundary:
      "Concept verification only for the isolated 30 mm CM-01 DripTray under its reviewed static case. It consumes the replacement CAD STEP; it does not re-run thermal, ERP, whole-machine, certification, durability, safety, or fabrication-release evidence.",
    presentationRole: "verification",
    activityCategory: "verification",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Verify the 30 mm CM-01 DripTray concept",
      description:
        "Evaluate the reviewed R2 isolated DripTray static proof against the exact replacement CAD STEP and correction record.",
      workItemKind: "verify",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_AND_REVISED_CAD_BINDINGS,
    },
  },
  {
    kitId: "cm01.drip-tray-static-proof-height-30-r3",
    kitVersion: "3",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [{
        kind: "reviewed-configuration",
        path:
          "config/mechanical-proof-cases/coffee-machine-cm01-v3-drip-tray-height-30-static-r3.json",
        purpose: "Defines the closed R3 recovery proof and its padded Gmsh face boxes.",
      }],
    },
    evidenceBoundary:
      "Recovery concept verification only for the isolated 30 mm CM-01 DripTray. It consumes a separately exported isolated STEP and traces, but does not consume, the retained R2 assembly STEP.",
    presentationRole: "verification",
    activityCategory: "verification",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Recover the 30 mm CM-01 DripTray concept proof",
      description:
        "Run the reviewed R3 isolated DripTray proof after the recorded failed R2 attempt, using the exact retained correction and replacement CAD STEP.",
      workItemKind: "verify",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_AND_REVISED_CAD_BINDINGS,
    },
  },
  {
    kitId: "cm01.drip-tray-static-proof-height-30-r3-identity-recovery",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [{
        kind: "reviewed-configuration",
        path:
          "src/adapters/coffee-machine-cm01-v3-r3-identity-recovery-run-executor.ts",
        purpose:
          "Defines the bounded, provider-free recovery from the retained R10 naming defect to a correctly identified R3 successor.",
      }],
    },
    evidenceBoundary:
      "Identity recovery only. It reads the immutable completed R3 capture, produces a correctly named successor and preserves the malformed R10 projection as superseded history. It does not invoke build123d, CalculiX, thermal, ERP, CAD or any provider.",
    presentationRole: "verification",
    activityCategory: "verification",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS
        .mechanicalDripTrayHeight30R3IdentityRecovery,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Correct the recorded CM-01 R3 mechanical evidence identity",
      description:
        "Reproject the retained R3 static-solve capture under its correct identity without rerunning providers or rewriting R10.",
      workItemKind: "verify",
      riskClass: "consequential",
      execution: "trusted",
      bindings: APPROVED_BRIEF_AND_HISTORICAL_R3_RESULT_BINDINGS,
    },
  },
  {
    kitId: "cm01.drip-tray-sensitivity",
    kitVersion: "1",
    qualification: {
      status: "manually-qualified",
      sourceRefs: [
        {
          kind: "reviewed-configuration",
          path: "config/sensitivity-cases/coffee-machine-cm01-v3-drip-tray-size-z.json",
          purpose:
            "Defines the reviewed finite-difference case: base value, step, mesh, material, selection boxes, and domain limitations.",
        },
        {
          kind: "reviewed-configuration",
          path: "src/domain/sensitivity-study.ts",
          purpose:
            "Provides the pure-domain validator, deterministic script renderer, and derivative arithmetic with unit composition.",
        },
      ],
    },
    /**
     * Sensitivity is purely local evidence — not a verdict, not a threshold
     * check, not a conformance or certification claim.
     */
    evidenceBoundary:
      "Produces first-order forward finite-difference derivatives of the isolated DripTray FEA metrics with respect to size-z at the reviewed 30 mm R2 base. It is not a pass/fail verdict, requirement evaluation, whole-machine claim, durability assessment, or certification.",
    presentationRole: "verification",
    activityCategory: "analysis",
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityDripTrayBaseZ,
      startingPoint: "idea-or-spec",
      allowedBasisKinds: ["thread-snapshot"],
      title: "Measure DripTray size-z sensitivity at the reviewed 30 mm base",
      description:
        "Run the reviewed first-order finite-difference sensitivity study for DripTray size-z at the exact 30 mm R2 baseline and record the derivative evidence.",
      workItemKind: "simulate",
      riskClass: "low",
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
