import {
  type CrossDomainImpactEvaluation,
  evaluateCrossDomainImpact,
} from "../domain/impact/cross-domain-impact-evaluation.ts";
import type {
  MechanicalPreservationCloseoutEvidence,
  MechanicalPreservationFeaEvidence,
  MechanicalPreservationInput,
} from "../domain/impact/cross-domain-impact-mechanical-preservation.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
} from "./cross-domain-impact-fixtures.ts";

export const MECHANICAL_PRESERVATION_FEA_TOOL =
  "verify.run-fea-static-proof@3" as const;
export const MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL =
  "verify.seal-proof-case@1" as const;
export const MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL =
  "decide.accept-evaluation-closeout@1" as const;

export async function validMechanicalPreservationInput(): Promise<
  MechanicalPreservationInput
> {
  const evaluationInput = await validCrossDomainImpactEvaluationInput();
  const evaluation = await evaluateCrossDomainImpact(evaluationInput);
  return {
    manifest: evaluationInput.manifest,
    evaluation,
    project: evaluation.project,
    subject: evaluation.subject,
    basis: evaluation.basis,
    reviewTrigger: evaluation.reviewTrigger,
    evaluatedAt: evaluation.evaluatedAt,
    feaEvidence: validFeaEvidence(evaluation),
    closeout: validCloseout(evaluation),
  };
}

export function validFeaEvidence(
  evaluation: CrossDomainImpactEvaluation,
): MechanicalPreservationFeaEvidence {
  const mechanical = evaluation.mechanicalEvidence!;
  const step = mechanical.consumptions.find((item) =>
    item.id === "mechanical-consumption-step"
  );
  if (!step) {
    throw new TypeError(
      "Mechanical FEA evidence is missing mechanical-consumption-step.",
    );
  }
  return {
    execution: {
      id: mechanical.evidence.id,
      fingerprint: mechanical.evidence.fingerprint,
      producer: {
        serverId: "digital-thread",
        tool: MECHANICAL_PRESERVATION_FEA_TOOL,
        runId: "run-fea-static-proof",
      },
      kind: "evidence",
      freshness: "fresh",
    },
    sealedProof: {
      id: "mechanical-sealed-proof",
      fingerprint: impactFingerprint("1"),
      producerTool: MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL,
    },
    canonicalStep: {
      id: step.input.id,
      fingerprint: step.input.fingerprint,
      kind: "step",
      mediaType: "model/step",
    },
    l4Evaluation: {
      id: "mechanical-l4-evaluation",
      fingerprint: impactFingerprint("2"),
      producerTool: MECHANICAL_PRESERVATION_FEA_TOOL,
    },
    consumptions: mechanical.consumptions.map((item) => ({
      id: item.id,
      consumerEvidence: item.consumerEvidence,
      input: item.input,
      status: "verified" as const,
    })),
  };
}

export function closeoutConsumption(
  closeoutArtifactId: string,
  input: {
    readonly id: string;
    readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  },
): MechanicalPreservationCloseoutEvidence["consumptions"][number] {
  return {
    id: `consume-${input.id}-by-${closeoutArtifactId}`,
    input: { id: input.id, fingerprint: input.fingerprint },
    status: "verified",
  };
}

export function validCloseout(
  evaluation: CrossDomainImpactEvaluation,
): MechanicalPreservationCloseoutEvidence {
  const fea = validFeaEvidence(evaluation);
  return {
    artifact: {
      id: "mechanical-l5-closeout",
      fingerprint: impactFingerprint("3"),
    },
    producerTool: MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
    consequence: "accept",
    inputs: {
      canonicalStep: {
        id: fea.canonicalStep.id,
        fingerprint: fea.canonicalStep.fingerprint,
      },
      sealedProof: {
        id: fea.sealedProof.id,
        fingerprint: fea.sealedProof.fingerprint,
      },
      executionEvidence: {
        id: fea.execution.id,
        fingerprint: fea.execution.fingerprint,
      },
      evaluationCapture: {
        id: fea.l4Evaluation.id,
        fingerprint: fea.l4Evaluation.fingerprint,
      },
    },
    consumptions: [
      closeoutConsumption("mechanical-l5-closeout", fea.canonicalStep),
      closeoutConsumption("mechanical-l5-closeout", fea.sealedProof),
      closeoutConsumption("mechanical-l5-closeout", {
        id: fea.execution.id,
        fingerprint: fea.execution.fingerprint,
      }),
      closeoutConsumption("mechanical-l5-closeout", fea.l4Evaluation),
    ],
  };
}
