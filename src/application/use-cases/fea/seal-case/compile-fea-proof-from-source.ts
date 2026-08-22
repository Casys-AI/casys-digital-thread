/**
 * Recross one captured mechanical-proof-case source against the unique current
 * Thread tip: unique canonical part STEP, CAD provenance, and SysON tip.
 */

import {
  extractParametricCadProvenanceFromGeometryCapture,
} from "../../../../domain/fea/seal-case/fea-proof-cad-lineage.ts";
import {
  FEA_PROOF_GEOMETRY_KIND,
  FEA_PROOF_GEOMETRY_URI_PREFIX,
  FEA_PROOF_STEP_KIND,
  type FeaProofSealBindingDiagnostic,
  resolveGeometryForStep,
} from "../../../../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import {
  compileMechanicalProofCase,
  type MechanicalProofCaseSource,
  parametricCadSourceFromPartScript,
} from "../../../../domain/fea/seal-case/mechanical-proof-case-source.ts";
import type { MechanicalProofCase } from "../../../../domain/fea/seal-case/mechanical-proof-case.ts";
import {
  fingerprintsEqual,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { CanonicalAssetReader } from "../../../ports/out/canonical-asset-reader.ts";
import type { FeaProofSealGeometryCaptureReader } from "./fea-proof-seal-source-admission.ts";

export type RecrossedFeaProofCase =
  | {
    readonly status: "ok";
    readonly proofCase: MechanicalProofCase;
    readonly geometryArtifact: ThreadArtifact;
    readonly stepArtifact: ThreadArtifact;
    readonly stepBytes: number;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
  };

export async function recrossMechanicalProofCaseFromSource(input: {
  readonly source: MechanicalProofCaseSource;
  readonly projectId: string;
  readonly snapshot: ThreadSnapshot;
  readonly geometryCaptures: FeaProofSealGeometryCaptureReader;
  readonly stepAssets: CanonicalAssetReader;
}): Promise<RecrossedFeaProofCase> {
  const diagnostics: FeaProofSealBindingDiagnostic[] = [];
  if (input.source.project.id !== input.projectId) {
    diagnostics.push({
      code: "project-mismatch",
      artifactId: null,
      message:
        `Captured proof source project.id "${input.source.project.id}" does not match ` +
        `requested projectId "${input.projectId}".`,
    });
  }
  if (input.source.project.subjectId !== input.snapshot.subject.id) {
    diagnostics.push({
      code: "subject-mismatch",
      artifactId: null,
      message:
        `Captured proof source subjectId "${input.source.project.subjectId}" does not match ` +
        `Thread subject "${input.snapshot.subject.id}".`,
    });
  }
  if (diagnostics.length > 0) {
    return { status: "unresolved", diagnostics };
  }

  const lineage = await resolveUniqueCanonicalPartLineage({
    snapshot: input.snapshot,
    targetModelElementId: input.source.target.modelElementId,
    geometryCaptures: input.geometryCaptures,
    stepAssets: input.stepAssets,
  });
  if (lineage.status !== "ok") {
    return {
      status: lineage.status,
      diagnostics: [lineage.diagnostic],
    };
  }

  try {
    const proofCase = compileMechanicalProofCase({
      source: input.source,
      baseThreadSnapshot: {
        id: input.snapshot.id,
        revision: input.snapshot.revision,
        subjectId: input.snapshot.subject.id,
      },
      cadSource: parametricCadSourceFromPartScript(lineage.definition),
      expectedCadArtifact: {
        format: "step",
        sha256: lineage.stepArtifact.fingerprint.digest,
        bytes: lineage.stepBytes,
      },
    });
    return {
      status: "ok",
      proofCase,
      geometryArtifact: lineage.geometryArtifact,
      stepArtifact: lineage.stepArtifact,
      stepBytes: lineage.stepBytes,
    };
  } catch (error) {
    return {
      status: "unresolved",
      diagnostics: [{
        code: "proposal-grammar-rejected",
        artifactId: null,
        message: error instanceof Error
          ? error.message
          : "The recrossed mechanical proof case was refused.",
      }],
    };
  }
}

async function resolveUniqueCanonicalPartLineage(input: {
  readonly snapshot: ThreadSnapshot;
  readonly targetModelElementId: string;
  readonly geometryCaptures: FeaProofSealGeometryCaptureReader;
  readonly stepAssets: CanonicalAssetReader;
}): Promise<
  | {
    readonly status: "ok";
    readonly geometryArtifact: ThreadArtifact;
    readonly stepArtifact: ThreadArtifact;
    readonly stepBytes: number;
    readonly definition: { readonly sha256: string; readonly bytes: number };
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostic: FeaProofSealBindingDiagnostic;
  }
> {
  const geometries = input.snapshot.artifacts.filter((artifact) =>
    artifact.kind === FEA_PROOF_GEOMETRY_KIND &&
    artifact.uri?.startsWith(FEA_PROOF_GEOMETRY_URI_PREFIX)
  );
  if (geometries.length === 0) {
    return diagnostic(
      "unresolved",
      "geometry-absent",
      null,
      "No cad-model geometry capture in the current tip can be joined to a canonical part STEP.",
    );
  }

  const matches: Array<{
    readonly geometryArtifact: ThreadArtifact;
    readonly stepArtifact: ThreadArtifact;
    readonly definition: { readonly sha256: string; readonly bytes: number };
    readonly stepDigest: string;
  }> = [];
  let lastLineage:
    | { code: FeaProofSealBindingDiagnostic["code"]; message: string }
    | undefined;

  for (const geometry of geometries) {
    let text: string | undefined;
    try {
      text = await input.geometryCaptures.read(geometry.fingerprint);
    } catch (error) {
      return diagnostic(
        "unavailable",
        "geometry-capture-unavailable",
        geometry.id,
        `Geometry capture ${
          geometry.fingerprint.digest.slice(0, 16)
        }… could not be reopened: ${
          error instanceof Error ? error.message : String(error)
        }.`,
      );
    }
    if (!text) {
      return diagnostic(
        "unavailable",
        "geometry-capture-unavailable",
        geometry.id,
        `Geometry capture ${
          geometry.fingerprint.digest.slice(0, 16)
        }… is not readable.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return diagnostic(
        "unresolved",
        "geometry-capture-invalid",
        geometry.id,
        "Geometry capture is not valid JSON.",
      );
    }
    const extracted = await extractParametricCadProvenanceFromGeometryCapture(
      parsed,
      input.targetModelElementId,
    );
    if (extracted.status !== "ok") {
      lastLineage = { code: extracted.code, message: extracted.message };
      continue;
    }
    const steps = input.snapshot.artifacts.filter((artifact) =>
      artifact.kind === FEA_PROOF_STEP_KIND &&
      artifact.mediaType === "model/step" &&
      artifact.fingerprint.algorithm === "sha256" &&
      artifact.fingerprint.digest === extracted.stepDigest
    );
    const joined = steps.filter((step) => {
      const geometryForStep = resolveGeometryForStep(input.snapshot, step);
      return geometryForStep.status === "one" &&
        geometryForStep.artifact.id === geometry.id;
    });
    if (joined.length === 1) {
      matches.push({
        geometryArtifact: geometry,
        stepArtifact: joined[0]!,
        definition: extracted.definition,
        stepDigest: extracted.stepDigest,
      });
    }
  }

  if (matches.length === 0) {
    if (lastLineage) {
      return diagnostic(
        "unresolved",
        lastLineage.code,
        null,
        lastLineage.message,
      );
    }
    return diagnostic(
      "unresolved",
      "step-absent",
      null,
      "No unique canonical part STEP on the current tip joins the proof target.",
    );
  }
  if (matches.length > 1) {
    return diagnostic(
      "unresolved",
      "step-ambiguous",
      null,
      `The current tip has ${matches.length} canonical part STEPs for the proof target; the review will not pick one.`,
    );
  }
  const selected = matches[0]!;
  let stepBytesData: Uint8Array;
  try {
    stepBytesData = await input.stepAssets.read(selected.stepDigest);
  } catch (error) {
    return diagnostic(
      "unavailable",
      "step-unavailable",
      selected.stepArtifact.id,
      `STEP file read failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const observed = await sha256Hex(stepBytesData);
  if (
    !fingerprintsEqual(
      { algorithm: "sha256", digest: observed },
      { algorithm: "sha256", digest: selected.stepDigest },
    )
  ) {
    return diagnostic(
      "unresolved",
      "step-mismatch",
      selected.stepArtifact.id,
      `STEP SHA-256 mismatch: expected ${selected.stepDigest.slice(0, 16)}…, got ${
        observed.slice(0, 16)
      }….`,
    );
  }
  return {
    status: "ok",
    geometryArtifact: selected.geometryArtifact,
    stepArtifact: selected.stepArtifact,
    stepBytes: stepBytesData.byteLength,
    definition: selected.definition,
  };
}

function diagnostic(
  status: "unresolved" | "unavailable",
  code: FeaProofSealBindingDiagnostic["code"],
  artifactId: string | null,
  message: string,
): {
  readonly status: "unresolved" | "unavailable";
  readonly diagnostic: FeaProofSealBindingDiagnostic;
} {
  return { status, diagnostic: { code, artifactId, message } };
}
