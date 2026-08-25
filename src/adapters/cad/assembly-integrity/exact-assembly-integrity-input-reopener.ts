/**
 * Reopen the exact sealed geometry-module capture and its sibling canonical
 * STEP before factual observation. This adapter has no provider call, local
 * OCCT worker, execution/WAL side effect, or product verdict.
 */

import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type {
  AssemblyIntegrityInputResolver,
  ExactAssemblyIntegrityInputRequest,
  ExactAssemblyIntegrityThreadBasis,
  ResolvedAssemblyIntegrityInput,
} from "../../../application/ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type { AssemblyIntegrityObserverProfileCatalog } from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import {
  type AssemblyIntegrityGeometryModuleReference,
  createAssemblyIntegrityInputBundle,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-input-bundle.ts";
import {
  sameAssemblyIntegrityObserverProfileRef,
  validateAssemblyIntegrityObserverProfile,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import { parseGeometryModuleCapture } from "../../../domain/cad/canonical/geometry-module-capture.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  fingerprintResourceBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deepFreeze,
  exactRecord,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { validateContentFingerprint } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import {
  GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
  geometryModuleAssemblyStepArtifactId,
  geometryModuleBinaryProducer,
} from "../canonical/design-write-geometry-module-seal.ts";
import type { GeometryCaptureStore } from "../canonical/design-write-geometry-run-executor.ts";
import { GEOMETRY_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";

export type ExactAssemblyIntegrityInputResolutionCode =
  | "basis-mismatch"
  | "identity-mismatch"
  | "missing-evidence"
  | "ambiguous-evidence"
  | "archived-evidence"
  | "integrity-mismatch"
  | "profile-mismatch";

export class ExactAssemblyIntegrityInputResolutionError extends Error {
  constructor(
    readonly code: ExactAssemblyIntegrityInputResolutionCode,
    message: string,
  ) {
    super(message);
    this.name = "ExactAssemblyIntegrityInputResolutionError";
  }
}

export interface ExactAssemblyIntegrityInputReopenerOptions {
  /** Existing canonical geometry capture store; it rereads text by digest. */
  readonly geometryCaptures: Pick<GeometryCaptureStore, "read">;
  /** Normally a FileCanonicalAssetReader rooted by server composition. */
  readonly stepAssets: CanonicalAssetReader;
  /** Closed catalogue selected by server composition, never request input. */
  readonly profiles: AssemblyIntegrityObserverProfileCatalog;
}

/**
 * Exact Thread-basis reopener. The supplied snapshot must already be the
 * persisted snapshot named by `basis`; this small first slice deliberately
 * does not introduce a snapshot-store or a public operation executor.
 */
export class ExactAssemblyIntegrityInputReopener
  implements AssemblyIntegrityInputResolver {
  readonly #geometryCaptures: Pick<GeometryCaptureStore, "read">;
  readonly #stepAssets: CanonicalAssetReader;
  readonly #profiles: AssemblyIntegrityObserverProfileCatalog;

  constructor(options: ExactAssemblyIntegrityInputReopenerOptions) {
    const root = exactRecord(
      options,
      ["geometryCaptures", "stepAssets", "profiles"],
      "$exactAssemblyIntegrityInputReopener",
    );
    this.#geometryCaptures = root.geometryCaptures as Pick<
      GeometryCaptureStore,
      "read"
    >;
    this.#stepAssets = root.stepAssets as CanonicalAssetReader;
    this.#profiles = root.profiles as AssemblyIntegrityObserverProfileCatalog;
  }

  async resolve(
    value: ExactAssemblyIntegrityInputRequest,
  ): Promise<ResolvedAssemblyIntegrityInput> {
    const request = parseRequest(value);
    assertExactBasis(request.snapshot, request.basis);
    const profile = await validateAssemblyIntegrityObserverProfile(
      await this.#profiles.resolve(request.observerProfile.profile),
    );
    if (
      !sameAssemblyIntegrityObserverProfileRef(
        profile.profile,
        request.observerProfile.profile,
      ) ||
      !fingerprintsEqual(
        profile.profileFingerprint,
        request.observerProfile.fingerprint,
      )
    ) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "profile-mismatch",
        "The reopened observer profile does not equal the exact server-selected profile identity.",
      );
    }
    const primary = requireExactPrimary(
      request.snapshot,
      request.geometryModule,
    );
    const capture = await reopenExactCapture(
      this.#geometryCaptures,
      request.geometryModule,
    );
    assertPrimaryMetadata(primary, capture.trustedRunId, capture.sealedAt);
    const assemblyStep = requireExactAssemblyStep(
      request.snapshot,
      primary,
      capture,
    );
    const stepBytes = await this.#stepAssets.read(assemblyStep.fingerprint.digest);
    const stepDigest = await fingerprintResourceBytes(stepBytes);
    if (
      stepBytes.byteLength !== capture.assemblyStep.bytes ||
      stepDigest !== capture.assemblyStep.fingerprint.digest ||
      !fingerprintsEqual(capture.assemblyStep.fingerprint, assemblyStep.fingerprint)
    ) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "integrity-mismatch",
        "The reread assembly STEP does not equal the exact sealed module asset.",
      );
    }
    if (stepBytes.byteLength > profile.maximumStepBytes) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "profile-mismatch",
        "The exact assembly STEP exceeds the server-selected observer profile ceiling.",
      );
    }
    const inputBundle = await createAssemblyIntegrityInputBundle({
      geometryModule: request.geometryModule,
      geometryModuleCapture: capture,
      assemblyStepBytes: stepBytes,
      method: profile.method,
    });
    if (
      inputBundle.manifest.occurrences.length > profile.maximumOccurrences ||
      inputBundle.manifest.occurrences.length *
            (inputBundle.manifest.occurrences.length - 1) / 2 >
        profile.maximumPairs
    ) {
      throw new ExactAssemblyIntegrityInputResolutionError(
        "profile-mismatch",
        "The exact module occurrence basis exceeds the server-selected observer profile ceiling.",
      );
    }
    return deepFreeze({
      basis: request.basis,
      geometryModule: request.geometryModule,
      primary,
      assemblyStep,
      capture,
      profile,
      observerProfile: request.observerProfile,
      inputBundle,
    });
  }
}

function parseRequest(value: unknown): {
  readonly basis: ExactAssemblyIntegrityThreadBasis;
  readonly snapshot: ThreadSnapshot;
  readonly geometryModule: AssemblyIntegrityGeometryModuleReference;
  readonly observerProfile: {
    readonly profile: { readonly id: string; readonly version: string };
    readonly fingerprint: ContentFingerprint;
  };
} {
  const root = exactRecord(
    value,
    ["basis", "snapshot", "geometryModule", "observerProfile"],
    "$exactAssemblyIntegrityInput",
  );
  if (root.snapshot === null || typeof root.snapshot !== "object") {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "basis-mismatch",
      "The exact assembly-integrity input requires a persisted Thread snapshot.",
    );
  }
  return deepFreeze({
    basis: parseBasis(root.basis),
    snapshot: root.snapshot as ThreadSnapshot,
    geometryModule: parseGeometryModuleReference(root.geometryModule),
    observerProfile: parseObserverProfile(root.observerProfile),
  });
}

function parseObserverProfile(value: unknown): {
  readonly profile: { readonly id: string; readonly version: string };
  readonly fingerprint: ContentFingerprint;
} {
  const root = exactRecord(
    value,
    ["profile", "fingerprint"],
    "$exactAssemblyIntegrityInput.observerProfile",
  );
  const profile = exactRecord(
    root.profile,
    ["id", "version"],
    "$exactAssemblyIntegrityInput.observerProfile.profile",
  );
  return deepFreeze({
    profile: {
      id: safeId(
        profile.id,
        "$exactAssemblyIntegrityInput.observerProfile.profile.id",
      ),
      version: safeVersion(
        profile.version,
        "$exactAssemblyIntegrityInput.observerProfile.profile.version",
      ),
    },
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$exactAssemblyIntegrityInput.observerProfile.fingerprint",
    ),
  });
}

function parseBasis(value: unknown): ExactAssemblyIntegrityThreadBasis {
  const root = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    "$exactAssemblyIntegrityInput.basis",
  );
  return deepFreeze({
    snapshotId: safeId(
      root.snapshotId,
      "$exactAssemblyIntegrityInput.basis.snapshotId",
    ),
    revision: positiveInteger(
      root.revision,
      "$exactAssemblyIntegrityInput.basis.revision",
    ),
    subjectId: safeId(root.subjectId, "$exactAssemblyIntegrityInput.basis.subjectId"),
  });
}

function parseGeometryModuleReference(
  value: unknown,
): AssemblyIntegrityGeometryModuleReference {
  const root = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint"],
    "$exactAssemblyIntegrityInput.geometryModule",
  );
  if (root.schemaVersion !== "geometry-module-capture/1.0") {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "identity-mismatch",
      "The exact assembly-integrity input must name geometry-module-capture/1.0.",
    );
  }
  return deepFreeze({
    schemaVersion: "geometry-module-capture/1.0" as const,
    artifactId: safeId(
      root.artifactId,
      "$exactAssemblyIntegrityInput.geometryModule.artifactId",
    ),
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      "$exactAssemblyIntegrityInput.geometryModule.fingerprint",
    ),
  });
}

function assertExactBasis(
  snapshot: ThreadSnapshot,
  basis: ExactAssemblyIntegrityThreadBasis,
): void {
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "basis-mismatch",
      "The supplied Thread snapshot does not equal the exact assembly-integrity basis.",
    );
  }
}

function requireExactPrimary(
  snapshot: ThreadSnapshot,
  reference: AssemblyIntegrityGeometryModuleReference,
): ThreadArtifact {
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.id === reference.artifactId
  );
  if (candidates.length === 0) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "missing-evidence",
      "The exact geometry-module primary is absent from the Thread basis.",
    );
  }
  if (candidates.length !== 1) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "ambiguous-evidence",
      "The exact geometry-module primary is ambiguous in the Thread basis.",
    );
  }
  const primary = candidates[0]!;
  if (archivedRefKeys(snapshot).has(`artifact:${primary.id}`)) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "archived-evidence",
      "The exact geometry-module primary is archived in the Thread basis.",
    );
  }
  if (!fingerprintsEqual(primary.fingerprint, reference.fingerprint)) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "identity-mismatch",
      "The named geometry-module primary does not have the requested fingerprint.",
    );
  }
  return primary;
}

async function reopenExactCapture(
  captures: Pick<GeometryCaptureStore, "read">,
  reference: AssemblyIntegrityGeometryModuleReference,
) {
  const text = await captures.read(reference.fingerprint);
  if (text === undefined) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "missing-evidence",
      "The exact geometry-module capture is not durably readable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "integrity-mismatch",
      "The exact geometry-module capture is not JSON.",
    );
  }
  let capture;
  try {
    capture = await parseGeometryModuleCapture(parsed);
  } catch {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "integrity-mismatch",
      "The exact geometry-module capture fails its closed parser.",
    );
  }
  const observed = await sha256Fingerprint(capture);
  if (
    text !== deterministicJson(capture) ||
    !fingerprintsEqual(observed, reference.fingerprint)
  ) {
    throw new ExactAssemblyIntegrityInputResolutionError(
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
    throw new ExactAssemblyIntegrityInputResolutionError(
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
    throw new ExactAssemblyIntegrityInputResolutionError(
      "archived-evidence",
      "The exact sibling assembly STEP is archived in the Thread basis.",
    );
  }
  const candidates = snapshot.artifacts.filter((artifact) =>
    artifact.id === expectedId
  );
  if (candidates.length === 0) {
    throw new ExactAssemblyIntegrityInputResolutionError(
      "missing-evidence",
      "The exact sibling assembly STEP is absent from the Thread basis.",
    );
  }
  if (candidates.length !== 1) {
    throw new ExactAssemblyIntegrityInputResolutionError(
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
    throw new ExactAssemblyIntegrityInputResolutionError(
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
    link.from.id === step.id && link.to.kind === "artifact" &&
    link.to.id === primary.id
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
    throw new ExactAssemblyIntegrityInputResolutionError(
      "identity-mismatch",
      "The sibling assembly STEP provenance is not the exact sealed graph.",
    );
  }
}
