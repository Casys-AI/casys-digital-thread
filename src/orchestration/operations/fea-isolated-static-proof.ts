import type { RegisteredEngineeringOperation } from "./operation-contract.ts";

/**
 * Isolated CalculiX product run. Historical MCP FEA @1/@2 stay as thin
 * identity constants for `unknown_operation` tests and ROP kind guards; they
 * are not registered and cannot be queued. Historical recorded Modelica
 * `simulate.seal-simulation-case@1/@2` and `simulate.run-modelica-scenario@1/@2`
 * are likewise unregistered; they are not a fallback for admitted or kit runs.
 */
export const VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "2",
} as const;

/** Isolated CalculiX product run. */
export const VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION = {
  id: "verify.run-fea-static-proof",
  version: "3",
} as const;

export const FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS = [
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
