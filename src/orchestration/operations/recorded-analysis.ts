import type { RegisteredEngineeringOperation } from "./registry.ts";

/**
 * Successor operations for the recorded-analysis verticals.
 *
 * The seal is deliberately planless: it materialises the exact, reviewable
 * inputs which a later queued run plan can bind.  The two run operations opt
 * into resolved-operation-plan/2.0 and cannot be queued without a server-owned
 * resolver and a durably reread CAS plan.
 */
export const SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION = {
  id: "simulate.seal-simulation-case",
  version: "2",
} as const;

export const SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION = {
  id: "simulate.run-modelica-scenario",
  version: "2",
} as const;

export const VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "2",
} as const;

export const RECORDED_ANALYSIS_OPERATION_DESCRIPTORS = [
  {
    ...SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Qualify and seal the reviewed Modelica simulation case",
    description:
      "Re-read the closed simulation-case/2.0 declaration, cross-check its native " +
      "scenario-source and public-projection SHA-256 identities against the exact " +
      "qualified Modelica manifest, then acquire its model, scenario and optional " +
      "parameter-schema resources " +
      "by immutable identity, and publish distinct content-addressed case, method and " +
      "source artifacts. No simulation is submitted.",
    workItemKind: "simulate",
    riskClass: "consequential",
    execution: "trusted",
    bindings: [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }],
  },
  {
    ...SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the planned resumable Modelica scenario",
    description:
      "Execute exactly the server-sealed resolved-operation-plan/2.0 with the " +
      "qualified Modelica manifest, use the durable request id for read-only recovery, " +
      "capture every provider resource through CAS, and publish observations without " +
      "deriving a verdict.",
    workItemKind: "simulate",
    riskClass: "low",
    execution: "trusted",
    resolvedOperationPlan: "2.0",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "simulationCase",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
      {
        name: "methodManifest",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
    ],
  },
  {
    ...VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the planned recorded CalculiX static proof",
    description:
      "Execute exactly the server-sealed resolved-operation-plan/2.0, stage the linked " +
      "STEP through the private input boundary, recover only by the durable request id, " +
      "capture the nine recorded solver resources, then apply the separately qualified " +
      "evaluation method.",
    workItemKind: "verify",
    riskClass: "consequential",
    execution: "trusted",
    resolvedOperationPlan: "2.0",
    decisionEvidenceScope: "thread-entity-bindings",
    bindings: [
      {
        name: "proofCase",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
      {
        name: "geometry",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
    ],
  },
] as const satisfies readonly RegisteredEngineeringOperation[];
