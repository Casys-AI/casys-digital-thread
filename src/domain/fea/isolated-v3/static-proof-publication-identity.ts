/**
 * Exact CalculiX @3 Thread publication identities.
 *
 * The first branch on a basis keeps the historical digest-only layout so a
 * completed replay rematerializes byte-exactly. A later branch whose candidate
 * identities would conflict is published entirely under a deterministic
 * run-scoped layout keyed by the exact local operation run id. Matching is
 * exact equality of one of those two forms; prefix matching is not a layout.
 */

import { CALCULIX_ISOLATED_OUTPUT_MANIFEST } from "./calculix-isolated-execution.ts";
import type { ThreadArtifact } from "../../thread/thread-snapshot.ts";

export const STATIC_PROOF_PUBLICATION_RUN_SCOPE = "-run-" as const;

export type StaticProofPublicationLayout = "legacy" | "run-scoped";

export function staticProofPublicationIdentity(
  legacyId: string,
  identityScope?: string,
): string {
  if (identityScope === undefined) return legacyId;
  if (typeof identityScope !== "string" || identityScope.trim() === "") {
    throw new TypeError("identityScope must be a non-empty string.");
  }
  return `${legacyId}${STATIC_PROOF_PUBLICATION_RUN_SCOPE}${identityScope}`;
}

export function staticProofPublicationLayout(
  id: string,
  legacyId: string,
  runId: string,
): StaticProofPublicationLayout | undefined {
  if (id === legacyId) return "legacy";
  if (id === staticProofPublicationIdentity(legacyId, runId)) return "run-scoped";
  return undefined;
}

export function staticProofPublicationScope(
  layout: StaticProofPublicationLayout,
  runId: string,
): string | undefined {
  return layout === "legacy" ? undefined : runId;
}

export function staticProofOutputArtifactLegacyId(
  role: string,
  digest: string,
): string {
  return `calculix-isolated-${role.replaceAll(".", "-")}-${digest}`;
}

export function staticProofEvidenceArtifactLegacyId(digest: string): string {
  return `calculix-isolated-evidence-${digest}`;
}

export function staticProofEvaluationCaptureArtifactLegacyId(
  digest: string,
): string {
  return `calculix-isolated-syson-evaluation-${digest}`;
}

export function staticProofObservationLegacyId(
  resultDigest: string,
  requirementId: string,
): string {
  return `calculix-isolated-observation-${resultDigest}-${requirementId}`;
}

export function staticProofInputConsumptionLegacyId(artifactId: string): string {
  return `calculix-isolated-input-${artifactId}`;
}

export function staticProofCasRereadConsumptionLegacyId(
  artifactId: string,
): string {
  return `calculix-isolated-cas-reread-${artifactId}`;
}

export function isExactStaticProofOutputArtifactId(
  id: string,
  role: string,
  digest: string,
  runId: string,
): boolean {
  return staticProofPublicationLayout(
    id,
    staticProofOutputArtifactLegacyId(role, digest),
    runId,
  ) !== undefined;
}

export function isExactStaticProofEvidenceArtifactId(
  id: string,
  digest: string,
  runId: string,
): boolean {
  return staticProofPublicationLayout(
    id,
    staticProofEvidenceArtifactLegacyId(digest),
    runId,
  ) !== undefined;
}

export function isExactStaticProofEvaluationCaptureArtifactId(
  id: string,
  digest: string,
  runId: string,
): boolean {
  return staticProofPublicationLayout(
    id,
    staticProofEvaluationCaptureArtifactLegacyId(digest),
    runId,
  ) !== undefined;
}

export function requireExactStaticProofPublicationLayout(
  artifacts: readonly ThreadArtifact[],
  runId: string,
): StaticProofPublicationLayout {
  const layouts = new Set<StaticProofPublicationLayout>();
  for (const declaration of CALCULIX_ISOLATED_OUTPUT_MANIFEST) {
    const matches = artifacts.filter((artifact) =>
      artifact.name === `Local CalculiX ${declaration.role}`
    );
    if (matches.length !== 1) {
      throw new TypeError(
        "The isolated CalculiX local artifacts are not the exact nine closed outputs.",
      );
    }
    const artifact = matches[0]!;
    const layout = staticProofPublicationLayout(
      artifact.id,
      staticProofOutputArtifactLegacyId(
        declaration.role,
        artifact.fingerprint.digest,
      ),
      runId,
    );
    if (layout === undefined) {
      throw new TypeError(
        "The isolated CalculiX output identities are not the exact legacy or run-scoped publication layout.",
      );
    }
    layouts.add(layout);
  }
  const evidence = uniqueNamed(
    artifacts,
    "Isolated local CalculiX execution evidence",
    "execution evidence",
  );
  const evaluation = uniqueNamed(
    artifacts,
    "SysON evaluation of isolated CalculiX evidence",
    "SysON evidence",
  );
  const evidenceLayout = staticProofPublicationLayout(
    evidence.id,
    staticProofEvidenceArtifactLegacyId(evidence.fingerprint.digest),
    runId,
  );
  const evaluationLayout = staticProofPublicationLayout(
    evaluation.id,
    staticProofEvaluationCaptureArtifactLegacyId(evaluation.fingerprint.digest),
    runId,
  );
  if (
    layouts.size !== 1 ||
    evidenceLayout === undefined ||
    evaluationLayout === undefined
  ) {
    throw new TypeError(
      "The isolated CalculiX local artifacts mix or omit the exact publication layout.",
    );
  }
  const layout = [...layouts][0]!;
  if (evidenceLayout !== layout || evaluationLayout !== layout) {
    throw new TypeError(
      "The isolated CalculiX capture identities do not match the output publication layout.",
    );
  }
  return layout;
}

function uniqueNamed(
  artifacts: readonly ThreadArtifact[],
  name: string,
  label: string,
): ThreadArtifact {
  const matches = artifacts.filter((artifact) => artifact.name === name);
  if (matches.length !== 1) {
    throw new TypeError(
      `The isolated CalculiX completion requires exactly one ${label} artifact.`,
    );
  }
  return matches[0]!;
}
