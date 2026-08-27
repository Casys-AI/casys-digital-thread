/**
 * Reopen one exact canonical static assembly basis.
 *
 * This adapter verifies the Thread basis, geometry-module capture, sibling
 * STEP artifact, provenance graph, and reread STEP bytes. It has no observer,
 * provider call, profile, runtime, method, WAL, or engineering verdict.
 */

import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import {
  type ExactStaticAssemblyBasisRequest,
  type ExactStaticAssemblyBasisResolver,
  type ExactStaticAssemblyThreadBasis,
  parseExactStaticAssemblyThreadBasis,
  readExactStaticAssemblySnapshotIdentity,
  type ResolvedStaticAssemblyBasis,
  sameExactStaticAssemblyThreadBasis,
} from "../../../application/ports/out/cad/exact-static-assembly-basis-resolver.ts";
import {
  type GeometryModuleReference,
  validateGeometryModuleReference,
} from "../../../domain/cad/canonical/geometry-module-reference.ts";
import { parseGeometryModuleCapture } from "../../../domain/cad/canonical/geometry-module-capture.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import {
  fingerprintResourceBytes,
  immutableBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import { deepFreeze, exactRecord } from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
  geometryModuleAssemblyStepArtifactId,
  geometryModuleBinaryProducer,
} from "./design-write-geometry-module-seal.ts";
import { GEOMETRY_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";

export type ExactStaticAssemblyBasisResolutionCode =
  | "basis-mismatch"
  | "identity-mismatch"
  | "missing-evidence"
  | "ambiguous-evidence"
  | "archived-evidence"
  | "integrity-mismatch";

export class ExactStaticAssemblyBasisResolutionError extends Error {
  constructor(
    readonly code: ExactStaticAssemblyBasisResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "ExactStaticAssemblyBasisResolutionError";
  }
}

/** Capture reread only; the write-geometry store stays behind composition. */
export interface ExactStaticAssemblyGeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ExactStaticAssemblyBasisReopenerOptions {
  /** Existing canonical geometry capture store; it rereads text by digest. */
  readonly geometryCaptures: ExactStaticAssemblyGeometryCaptureReader;
  /** Normally a FileCanonicalAssetReader rooted by server composition. */
  readonly stepAssets: CanonicalAssetReader;
}

/** Exact static evidence reopener shared by bounded geometry consumers. */
export class ExactStaticAssemblyBasisReopener
  implements ExactStaticAssemblyBasisResolver {
  readonly #geometryCaptures: ExactStaticAssemblyGeometryCaptureReader;
  readonly #stepAssets: CanonicalAssetReader;

  constructor(options: ExactStaticAssemblyBasisReopenerOptions) {
    exactRecord(
      options,
      ["geometryCaptures", "stepAssets"],
      "$exactStaticAssemblyBasisReopener",
    );
    this.#geometryCaptures = options.geometryCaptures;
    this.#stepAssets = options.stepAssets;
  }

  async resolve(
    value: ExactStaticAssemblyBasisRequest,
  ): Promise<ResolvedStaticAssemblyBasis> {
    const request = parseRequest(value);
    assertExactBasis(request.snapshot, request.basis);
    const primary = requireExactPrimary(request.snapshot, request.geometryModule);
    const capture = await reopenExactCapture(
      this.#geometryCaptures,
      request.geometryModule,
    );
    assertPrimaryMetadata(primary, capture.trustedRunId, capture.sealedAt);
    const assemblyStep = requireExactAssemblyStep(request.snapshot, primary, capture);
    const stepBytes = await this.#stepAssets.read(assemblyStep.fingerprint.digest);
    const stepDigest = await fingerprintResourceBytes(stepBytes);
    if (
      stepBytes.byteLength !== capture.assemblyStep.bytes ||
      stepDigest !== capture.assemblyStep.fingerprint.digest ||
      !fingerprintsEqual(capture.assemblyStep.fingerprint, assemblyStep.fingerprint)
    ) {
      throw new ExactStaticAssemblyBasisResolutionError(
        "integrity-mismatch",
        "The reread assembly STEP does not equal the exact sealed module asset.",
      );
    }
    return deepFreeze({
      basis: request.basis,
      geometryModule: request.geometryModule,
      primary,
      assemblyStep,
      capture,
      assemblyStepBytes: immutableBytes(stepBytes),
    });
  }
}

function parseRequest(value: unknown): ExactStaticAssemblyBasisRequest {
  const root = exactRecord(
    value,
    ["basis", "snapshot", "geometryModule"],
    "$exactStaticAssemblyBasis",
  );
  if (readExactStaticAssemblySnapshotIdentity(root.snapshot) === undefined) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "basis-mismatch",
      "The exact static assembly basis requires a persisted Thread snapshot.",
    );
  }
  return deepFreeze({
    basis: parseExactStaticAssemblyThreadBasis(
      root.basis,
      "$exactStaticAssemblyBasis.basis",
    ),
    snapshot: root.snapshot as ThreadSnapshot,
    geometryModule: validateGeometryModuleReference(
      root.geometryModule,
      "$exactStaticAssemblyBasis.geometryModule",
    ),
  });
}

function assertExactBasis(
  snapshot: ThreadSnapshot,
  basis: ExactStaticAssemblyThreadBasis,
): void {
  if (!sameExactStaticAssemblyThreadBasis(snapshot, basis)) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "basis-mismatch",
      "The supplied Thread snapshot does not equal the exact static assembly basis.",
    );
  }
}

function requireExactPrimary(
  snapshot: ThreadSnapshot,
  reference: GeometryModuleReference,
): ThreadArtifact {
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.id === reference.artifactId
  );
  if (candidates.length === 0) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "missing-evidence",
      "The exact geometry-module primary is absent from the Thread basis.",
    );
  }
  if (candidates.length !== 1) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "ambiguous-evidence",
      "The exact geometry-module primary is ambiguous in the Thread basis.",
    );
  }
  const primary = candidates[0]!;
  if (archivedRefKeys(snapshot).has(`artifact:${primary.id}`)) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "archived-evidence",
      "The exact geometry-module primary is archived in the Thread basis.",
    );
  }
  if (!fingerprintsEqual(primary.fingerprint, reference.fingerprint)) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "identity-mismatch",
      "The named geometry-module primary does not have the requested fingerprint.",
    );
  }
  return primary;
}

async function reopenExactCapture(
  captures: ExactStaticAssemblyGeometryCaptureReader,
  reference: GeometryModuleReference,
) {
  const text = await captures.read(reference.fingerprint);
  if (text === undefined) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "missing-evidence",
      "The exact geometry-module capture is not durably readable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExactStaticAssemblyBasisResolutionError(
      "integrity-mismatch",
      "The exact geometry-module capture is not JSON.",
    );
  }
  let capture;
  try {
    capture = await parseGeometryModuleCapture(parsed);
  } catch {
    throw new ExactStaticAssemblyBasisResolutionError(
      "integrity-mismatch",
      "The exact geometry-module capture fails its closed parser.",
    );
  }
  const observed = await sha256Fingerprint(capture);
  if (
    text !== deterministicJson(capture) ||
    !fingerprintsEqual(observed, reference.fingerprint)
  ) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "integrity-mismatch",
      "The reread geometry-module capture is non-canonical or fingerprint-divergent.",
    );
  }
  return capture;
}

function assertPrimaryMetadata(
  primary: ThreadArtifact,
  trustedRunId: string,
  sealedAt: string,
): void {
  const digest = primary.fingerprint.digest;
  if (
    primary.id !== `geometry-${digest}` ||
    primary.kind !== "cad-model" ||
    primary.version !== digest ||
    primary.uri !== `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    primary.mediaType !== "application/json" ||
    primary.producer.serverId !== "digital-thread" ||
    primary.producer.tool !==
      `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}` ||
    primary.producer.runId !== trustedRunId ||
    primary.freshness.status !== "fresh" ||
    primary.freshness.changedAt !== sealedAt ||
    primary.freshness.invalidatedByChangeIds.length !== 0
  ) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "identity-mismatch",
      "The geometry-module primary metadata is not the exact sealed identity.",
    );
  }
}

function requireExactAssemblyStep(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  capture: Awaited<ReturnType<typeof parseGeometryModuleCapture>>,
): ThreadArtifact {
  const expectedId = geometryModuleAssemblyStepArtifactId(
    primary.fingerprint.digest,
    capture.assemblyStep.fingerprint.digest,
  );
  if (archivedRefKeys(snapshot).has(`artifact:${expectedId}`)) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "archived-evidence",
      "The exact sibling assembly STEP is archived in the Thread basis.",
    );
  }
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.id === expectedId
  );
  if (candidates.length === 0) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "missing-evidence",
      "The exact sibling assembly STEP is absent from the Thread basis.",
    );
  }
  if (candidates.length !== 1) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "ambiguous-evidence",
      "The exact sibling assembly STEP is ambiguous in the Thread basis.",
    );
  }
  const step = candidates[0]!;
  const producer = geometryModuleBinaryProducer(capture.receipt);
  if (
    step.name !== `Authoritative STEP: ${capture.manifest.target.label}` ||
    step.kind !== "step" ||
    step.version !== capture.assemblyStep.fingerprint.digest ||
    !fingerprintsEqual(step.fingerprint, capture.assemblyStep.fingerprint) ||
    step.uri !== `/api/thread/assets/${capture.assemblyStep.fingerprint.digest}.step` ||
    step.mediaType !== "model/step" ||
    deterministicJson(step.producer) !== deterministicJson(producer) ||
    deterministicJson(step.inputArtifactIds) !== deterministicJson([primary.id]) ||
    step.freshness.status !== "fresh" ||
    step.freshness.changedAt !== capture.sealedAt ||
    step.freshness.invalidatedByChangeIds.length !== 0
  ) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "identity-mismatch",
      "The sibling assembly STEP metadata is not the exact sealed identity.",
    );
  }
  assertStepProvenance(snapshot, primary, step, capture.sealedAt);
  return step;
}

function assertStepProvenance(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  step: ThreadArtifact,
  sealedAt: string,
): void {
  const traces = snapshot.provenance.filter((link) =>
    link.relation === "traces_to" && link.from.kind === "artifact" &&
    link.from.id === step.id && link.to.kind === "artifact" && link.to.id === primary.id
  );
  const consumptionId = `consume-${primary.id}-by-${step.id}`;
  const consumptions = snapshot.consumptions.filter((consumption) =>
    consumption.id === consumptionId && consumption.artifactId === primary.id &&
    deterministicJson(consumption.consumer) === deterministicJson(step.producer) &&
    fingerprintsEqual(consumption.observedFingerprint, primary.fingerprint) &&
    consumption.status === "verified" && consumption.verifiedAt === sealedAt
  );
  const uses = snapshot.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === consumptionId && link.to.kind === "artifact" &&
    link.to.id === primary.id
  );
  const derived = snapshot.provenance.filter((link) =>
    link.id === `derived-from-module-primary-${step.id}` &&
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === step.id && link.to.kind === "artifact" &&
    link.to.id === primary.id &&
    link.rationale === GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE
  );
  if (
    traces.length !== 1 ||
    traces[0]!.id !== `traces-${step.id}-from-${primary.id}` ||
    traces[0]!.rationale !== GEOMETRY_BINARY_TRACE_RATIONALE ||
    consumptions.length !== 1 ||
    uses.length !== 1 ||
    uses[0]!.id !== `uses-${consumptionId}` ||
    uses[0]!.rationale !== GEOMETRY_BINARY_CAPTURE_USE_RATIONALE ||
    derived.length !== 1
  ) {
    throw new ExactStaticAssemblyBasisResolutionError(
      "identity-mismatch",
      "The sibling assembly STEP provenance is not the exact sealed graph.",
    );
  }
}
