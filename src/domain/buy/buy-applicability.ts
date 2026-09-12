/**
 * Current versus historical Buy applicability.
 *
 * A new canonical STEP or configuration revision does not relabel previous
 * Buy evidence as current. Behave and Make verdicts never transfer into Buy.
 */

import { attestCanonicalWriteGeometryStep } from "../cad/canonical/canonical-write-geometry-step.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../thread/thread-snapshot.ts";
import type { BuyConfiguration } from "./buy-configuration.ts";

export type BuyApplicability =
  | {
    readonly status: "current";
    readonly geometry: ThreadArtifact;
    readonly step: ThreadArtifact;
  }
  | {
    readonly status: "historical";
    readonly reason: string;
    readonly boundStepFingerprint: string;
    readonly currentStepFingerprint?: string;
  }
  | {
    readonly status: "refused";
    readonly reason: string;
  };

/**
 * Recross a configuration's embedded basis and subject against an exact
 * Thread snapshot identity. Geometry currentness is a separate check:
 * a still-current STEP does not make a foreign or predecessor
 * configuration admissible for a new capture.
 */
export function recrossBuyConfigurationThreadBasis(
  configuration: BuyConfiguration,
  basis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
): { readonly status: "current" } | {
  readonly status: "refused";
  readonly reason: string;
} {
  if (configuration.subjectId !== basis.subjectId) {
    return {
      status: "refused",
      reason: "Buy configuration subjectId does not match the exact Thread basis.",
    };
  }
  if (configuration.basis.subjectId !== basis.subjectId) {
    return {
      status: "refused",
      reason:
        "Buy configuration basis.subjectId does not match the exact Thread basis.",
    };
  }
  if (
    configuration.basis.snapshotId !== basis.snapshotId ||
    configuration.basis.revision !== basis.revision
  ) {
    return {
      status: "refused",
      reason: "Buy configuration basis does not match the exact Thread basis.",
    };
  }
  return { status: "current" };
}

export function buyGeometryApplicability(
  snapshot: ThreadSnapshot,
  configuration: BuyConfiguration,
): BuyApplicability {
  const step = snapshot.artifacts.find((item) =>
    item.id === configuration.geometry.stepArtifactId
  );
  if (!step) {
    return {
      status: "refused",
      reason:
        `Buy configuration STEP "${configuration.geometry.stepArtifactId}" is absent from the basis snapshot.`,
    };
  }
  const attested = attestCanonicalWriteGeometryStep(
    snapshot,
    step,
    configuration.geometry.stepFingerprint,
    { role: "Buy geometry STEP" },
  );
  if (attested.status !== "attested") {
    return { status: "refused", reason: attested.message };
  }
  if (attested.geometry.id !== configuration.geometry.parentArtifactId) {
    return {
      status: "refused",
      reason:
        `Buy configuration parent geometry "${configuration.geometry.parentArtifactId}" does not match attested parent "${attested.geometry.id}".`,
    };
  }
  if (
    attested.geometry.fingerprint.digest !== configuration.geometry.parentFingerprint
  ) {
    return {
      status: "refused",
      reason: "Buy configuration parent geometry fingerprint does not match the basis.",
    };
  }
  const current = currentCanonicalStep(snapshot);
  if (
    current &&
    current.step.fingerprint.digest !== configuration.geometry.stepFingerprint
  ) {
    return {
      status: "historical",
      reason:
        "A newer canonical write-geometry STEP is the current basis; this Buy evidence remains historical.",
      boundStepFingerprint: configuration.geometry.stepFingerprint,
      currentStepFingerprint: current.step.fingerprint.digest,
    };
  }
  return {
    status: "current",
    geometry: attested.geometry,
    step: attested.step,
  };
}

export function currentCanonicalStep(
  snapshot: ThreadSnapshot,
): { readonly geometry: ThreadArtifact; readonly step: ThreadArtifact } | undefined {
  const steps = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "step" && artifact.mediaType === "model/step"
  );
  const attested = steps
    .map((artifact) =>
      attestCanonicalWriteGeometryStep(snapshot, artifact, undefined, {
        role: "Buy geometry STEP",
      })
    )
    .filter((item) => item.status === "attested");
  if (attested.length === 0) return undefined;
  const latest = attested.at(-1);
  if (!latest || latest.status !== "attested") return undefined;
  return { geometry: latest.geometry, step: latest.step };
}
