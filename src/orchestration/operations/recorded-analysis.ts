import type { RegisteredEngineeringOperation } from "./operation-contract.ts";

/**
 * Isolated CalculiX product run. Historical MCP FEA @1/@2 and recorded Modelica
 * scenario/seal versions stay as code constants for dead executors; they are
 * not registered and cannot be queued.
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

/** Isolated CalculiX product run. */
export const VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "3",
} as const;

export const RECORDED_ANALYSIS_OPERATION_DESCRIPTORS = [
  {
    ...VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
    startingPoint: "idea-or-spec",
    allowedBasisKinds: ["thread-snapshot"],
    title: "Run the isolated local CalculiX static proof",
    description:
      "Execute exactly the server-sealed resolved-operation-plan/2.0 with the " +
      "digest-pinned local Microsandbox profile, bind the reviewed STEP and proof " +
      "case into one immutable bundle, publish the nine output objects and isolated " +
      "execution evidence through CAS, then apply the separately qualified SysON " +
      "evaluation method. Historical MCP plans are never routed to this executor.",
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
