/**
 * Provider-free reader for a sealed technical-compilation admission.
 *
 * The Thread artefact is the locator and authority boundary. This adapter
 * reopens its exact CAS bytes, validates the closed capture schema, and proves
 * the original reviewed Thread/SysML basis before returning any executable
 * compilation facts to a downstream operation.
 */

import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
  TechnicalCompilationAdmissionReadRequest,
} from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { TechnicalCompilationSourceReader } from "../../../application/ports/out/compile/admission/technical-compilation-source-reader.ts";
import {
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  assertTechnicalSourceProvenanceIdentitiesEqual,
  type TechnicalSourceProvenanceIdentity,
} from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX,
  type TechnicalCompilationAdmissionCapture,
  type TechnicalCompilationAdmissionCaptureStore,
  technicalCompilationAnchorArtifactReferences,
  validateTechnicalCompilationAdmissionCapture,
} from "../executors/compile-seal-admission-run-executor.ts";
import {
  assertThreadSnapshotLineageIntact,
  threadSnapshotDescendsFrom,
} from "../../shared/stores/thread-snapshot-lineage.ts";

const ADMISSION_ARTIFACT_ID_PREFIX = "technical-compilation-admission-";
const ADMISSION_PRODUCER_SERVER = "digital-thread";
const ADMISSION_PRODUCER_TOOL = COMPILE_SEAL_ADMISSION_PRODUCER_TOOL;

export interface CaptureBackedTechnicalCompilationAdmissionReaderDependencies {
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly captures: Pick<TechnicalCompilationAdmissionCaptureStore, "read">;
  readonly sources: TechnicalCompilationSourceReader;
}

export class TechnicalCompilationAdmissionReadError extends Error {
  constructor(detail: string) {
    super(`Technical compilation admission is not exact: ${detail}`);
    this.name = "TechnicalCompilationAdmissionReadError";
  }
}

export class CaptureBackedTechnicalCompilationAdmissionReader
  implements TechnicalCompilationAdmissionReader {
  constructor(
    private readonly dependencies:
      CaptureBackedTechnicalCompilationAdmissionReaderDependencies,
  ) {}

  async read(
    value: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ReopenedTechnicalCompilationAdmission | undefined> {
    const request = parseRequest(value);
    const rawSnapshot = await readSnapshot(
      this.dependencies.snapshots,
      request.basis.snapshotId,
      "the requested Thread snapshot could not be read",
    );
    if (!rawSnapshot) return undefined;

    const snapshot = integrity(
      "the requested Thread snapshot is invalid",
      () => validateThreadSnapshot(rawSnapshot),
    );
    assertExactSnapshot(snapshot, request.basis);
    const normalizedLineageReader = {
      get: (snapshotId: string) =>
        readSnapshot(
          this.dependencies.snapshots,
          snapshotId,
          "a Thread lineage predecessor could not be read",
        ),
    };
    await integrityAsync(
      "the requested Thread lineage is not intact",
      () => assertThreadSnapshotLineageIntact(snapshot, normalizedLineageReader),
    );

    const matches = snapshot.artifacts.filter((candidate) =>
      candidate.id === request.artifactId
    );
    if (matches.length === 0) return undefined;
    if (matches.length !== 1) {
      throw new TechnicalCompilationAdmissionReadError(
        `artefact ${request.artifactId} is ambiguous in the exact Thread basis`,
      );
    }
    const artifact = matches[0]!;
    assertAdmissionArtifactIdentity(snapshot, artifact, request);

    const captureText = await readCapture(
      this.dependencies.captures,
      artifact.fingerprint,
    );
    if (captureText === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(captureText);
    } catch {
      throw new TechnicalCompilationAdmissionReadError(
        "the capture CAS returned non-JSON bytes",
      );
    }
    const capture = await integrityAsync(
      "the capture document is invalid",
      () => validateTechnicalCompilationAdmissionCapture(parsed),
    );
    const canonicalText = deterministicJson(capture);
    const captureFingerprint = await sha256Fingerprint(capture);
    if (
      captureText !== canonicalText ||
      !fingerprintsEqual(captureFingerprint, artifact.fingerprint)
    ) {
      throw new TechnicalCompilationAdmissionReadError(
        "the capture CAS bytes do not exactly match the Thread artefact fingerprint",
      );
    }

    assertCaptureScope(capture, artifact, request);
    const admissionBasis = await this.#reopenAdmissionBasis(capture, request);
    const descends = await integrityAsync(
      "the requested basis cannot be related to the reviewed admission basis",
      () =>
        threadSnapshotDescendsFrom(
          snapshot,
          admissionBasis,
          this.dependencies.snapshots,
        ),
    );
    if (!descends) {
      throw new TechnicalCompilationAdmissionReadError(
        "the requested Thread basis is not an exact descendant of the reviewed admission basis",
      );
    }

    const anchorReferences = integrity(
      "the SysML anchor provenance closure is contradictory",
      () =>
        technicalCompilationAnchorArtifactReferences(
          capture.document.basis.sysmlAnchor,
        ),
    );
    const originalSysml = anchorReferences.map((reference) =>
      exactFreshSysmlArtifact(
        admissionBasis,
        reference.artifactId,
        reference.artifactFingerprint,
        "reviewed admission basis",
      )
    );
    const currentSysml = originalSysml.map((sysmlArtifact) =>
      exactFreshSysmlArtifact(
        snapshot,
        sysmlArtifact.id,
        sysmlArtifact.fingerprint,
        "requested execution basis",
      )
    );
    assertInputEvidence(snapshot, artifact, currentSysml, capture.sealedAt);

    await this.#recrossSources(request, capture);

    return deepFreeze({
      schemaVersion: capture.schemaVersion,
      operation: capture.operation,
      trustedRunId: capture.trustedRunId,
      decisionId: capture.decisionId,
      sealedAt: capture.sealedAt,
      draftReference: capture.draftReference,
      admission: capture.admission,
      document: capture.document,
    });
  }

  async #recrossSources(
    request: TechnicalCompilationAdmissionReadRequest,
    capture: Pick<
      TechnicalCompilationAdmissionCapture,
      "sourceCaptures" | "admission" | "document"
    >,
  ): Promise<void> {
    const documentSourceById = new Map(
      capture.document.inputManifest.sources.map((source) => [
        source.analysis.source.id,
        source,
      ]),
    );
    for (const expected of capture.admission.sources) {
      const stored = documentSourceById.get(expected.id);
      const captureRef = capture.sourceCaptures.find((item) =>
        item.sourceId === expected.id
      );
      if (!stored || !captureRef) {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} is not exactly covered by its locator`,
        );
      }
      let reopened;
      try {
        reopened = await this.dependencies.sources.read({
          projectId: request.projectId,
          basis: capture.document.basis,
          reference: captureRef.reference,
          referenceFingerprint: captureRef.referenceFingerprint,
        });
      } catch (cause) {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} failed exact workspace recross: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
      if (!reopened) {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} could not be recrossed from its locator`,
        );
      }
      if (reopened.provenance.attachmentAlignment !== "exact") {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} is not exact against the sealed compilation basis`,
        );
      }
      if (reopened.source.effectiveUnit.closureKind === "unlowered-closure") {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} has no language-specific dependency lowering`,
        );
      }
      try {
        assertTechnicalSourceProvenanceIdentitiesEqual(
          {
            sourceId: expected.id,
            role: expected.role,
            language: expected.language,
            profileId: expected.profileId,
            profileVersion: expected.profileVersion,
            profileFingerprint: expected.profileFingerprint,
            analyzer: expected.analyzer,
            sourceFingerprint: expected.sourceFingerprint,
            captureFingerprint: expected.captureFingerprint,
            analysisFingerprint: expected.analysisFingerprint,
            effectiveUnit: expected.effectiveUnit,
            attachment: expected.attachment,
            sourceClosure: expected.sourceClosure,
            locator: expected.locator,
          },
          {
            sourceId: reopened.source.analysis.source.id,
            role: reopened.source.analysis.source.role,
            language: reopened.source.analysis.source.language,
            profileId: reopened.provenance.profile.id,
            profileVersion: reopened.provenance.profile.version,
            profileFingerprint: reopened.provenance.profile.fingerprint,
            analyzer: reopened.provenance.analyzer,
            sourceFingerprint: reopened.provenance.sourceFingerprint,
            captureFingerprint: reopened.provenance.captureFingerprint,
            analysisFingerprint: reopened.provenance.analysisFingerprint,
            effectiveUnit: reopened.provenance.effectiveUnit,
            attachment: reopened.provenance.attachment,
            sourceClosure: reopened.provenance.sourceClosure,
            locator: reopened.provenance.locator,
          } satisfies TechnicalSourceProvenanceIdentity,
          `$admission.sources.${expected.id}`,
        );
      } catch (cause) {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} recross does not match the sealed project-source identity: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
      if (reopened.source.sourceText !== stored.sourceText) {
        throw new TechnicalCompilationAdmissionReadError(
          `admitted source ${expected.id} recross does not match the sealed project-source bytes`,
        );
      }
    }
  }

  async #reopenAdmissionBasis(
    capture: ReopenedTechnicalCompilationAdmission,
    request: TechnicalCompilationAdmissionReadRequest,
  ): Promise<ThreadSnapshot> {
    const declared = capture.admission.basis.thread;
    const raw = await readSnapshot(
      this.dependencies.snapshots,
      declared.snapshotId,
      "the reviewed admission basis could not be read",
    );
    if (!raw) {
      throw new TechnicalCompilationAdmissionReadError(
        `reviewed basis ${declared.snapshotId}@${declared.revision} is unavailable`,
      );
    }
    const snapshot = integrity(
      "the reviewed admission basis is invalid",
      () => validateThreadSnapshot(raw),
    );
    if (
      snapshot.id !== declared.snapshotId ||
      snapshot.revision !== declared.revision ||
      snapshot.subject.id !== declared.subjectId ||
      declared.projectId !== request.projectId
    ) {
      throw new TechnicalCompilationAdmissionReadError(
        "the reviewed admission basis has a stale or foreign identity",
      );
    }
    const fingerprint = await sha256Fingerprint(snapshot);
    if (!fingerprintsEqual(fingerprint, declared.fingerprint)) {
      throw new TechnicalCompilationAdmissionReadError(
        "the reviewed admission basis bytes do not match their sealed fingerprint",
      );
    }
    return snapshot;
  }
}

function parseRequest(
  value: unknown,
): TechnicalCompilationAdmissionReadRequest {
  const request = exactRecord(value, [
    "projectId",
    "basis",
    "artifactId",
    "artifactFingerprint",
  ], "$technicalCompilationAdmissionRead");
  const projectId = safeId(
    request.projectId,
    "$technicalCompilationAdmissionRead.projectId",
  );
  const rawBasis = exactRecord(
    request.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$technicalCompilationAdmissionRead.basis",
  );
  literalValue(
    rawBasis.kind,
    "thread-snapshot",
    "$technicalCompilationAdmissionRead.basis.kind",
  );
  const snapshotId = safeId(
    rawBasis.snapshotId,
    "$technicalCompilationAdmissionRead.basis.snapshotId",
  );
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(
      "$technicalCompilationAdmissionRead.basis.snapshotId must name an exact snapshot.",
    );
  }
  const basis: EngineeringThreadSnapshotBasis = {
    kind: "thread-snapshot",
    snapshotId,
    revision: positiveInteger(
      rawBasis.revision,
      "$technicalCompilationAdmissionRead.basis.revision",
    ),
    subjectId: safeId(
      rawBasis.subjectId,
      "$technicalCompilationAdmissionRead.basis.subjectId",
    ),
  };
  return {
    projectId,
    basis,
    artifactId: safeId(
      request.artifactId,
      "$technicalCompilationAdmissionRead.artifactId",
    ),
    artifactFingerprint: parseFingerprint(
      request.artifactFingerprint,
      "$technicalCompilationAdmissionRead.artifactFingerprint",
    ),
  };
}

function assertExactSnapshot(
  snapshot: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): void {
  if (
    snapshot.id !== basis.snapshotId || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new TechnicalCompilationAdmissionReadError(
      "the snapshot reader returned a stale or foreign Thread identity",
    );
  }
}

function assertAdmissionArtifactIdentity(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  request: TechnicalCompilationAdmissionReadRequest,
): void {
  const digest = request.artifactFingerprint.digest;
  if (
    !fingerprintsEqual(artifact.fingerprint, request.artifactFingerprint) ||
    artifact.id !== `${ADMISSION_ARTIFACT_ID_PREFIX}${digest}` ||
    artifact.kind !== "document" || artifact.version !== digest ||
    artifact.uri !== `${TECHNICAL_COMPILATION_ADMISSION_CAPTURE_URI_PREFIX}${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== ADMISSION_PRODUCER_SERVER ||
    artifact.producer.tool !== ADMISSION_PRODUCER_TOOL ||
    artifact.freshness.status !== "fresh" ||
    archivedRefKeys(snapshot).has(`artifact:${artifact.id}`)
  ) {
    throw new TechnicalCompilationAdmissionReadError(
      `artefact ${artifact.id} has a non-exact identity, producer, URI, or freshness state`,
    );
  }
}

function assertCaptureScope(
  capture: ReopenedTechnicalCompilationAdmission,
  artifact: ThreadArtifact,
  request: TechnicalCompilationAdmissionReadRequest,
): void {
  if (
    capture.trustedRunId !== artifact.producer.runId ||
    capture.sealedAt !== artifact.freshness.changedAt ||
    capture.admission.draft.projectId !== request.projectId ||
    capture.admission.basis.thread.projectId !== request.projectId ||
    capture.admission.basis.thread.subjectId !== request.basis.subjectId
  ) {
    throw new TechnicalCompilationAdmissionReadError(
      "the capture scope, producer run, or sealing timestamp differs from its Thread artefact",
    );
  }
}

function exactFreshSysmlArtifact(
  snapshot: ThreadSnapshot,
  id: string,
  fingerprint: ContentFingerprint,
  context: string,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((candidate) =>
    candidate.id === id && candidate.kind === "sysml-model" &&
    fingerprintsEqual(candidate.fingerprint, fingerprint) &&
    candidate.freshness.status === "fresh" &&
    !archivedRefKeys(snapshot).has(`artifact:${candidate.id}`)
  );
  if (matches.length !== 1) {
    throw new TechnicalCompilationAdmissionReadError(
      `the exact admitted SysML input is absent, stale, archived, ambiguous, or fingerprint-divergent in the ${context}`,
    );
  }
  return matches[0]!;
}

function assertInputEvidence(
  snapshot: ThreadSnapshot,
  admissionArtifact: ThreadArtifact,
  sysmlArtifacts: readonly ThreadArtifact[],
  sealedAt: string,
): void {
  const expectedArtifactIds = sysmlArtifacts.map((artifact) => artifact.id);
  if (
    deterministicJson(admissionArtifact.inputArtifactIds) !==
      deterministicJson(expectedArtifactIds)
  ) {
    throw new TechnicalCompilationAdmissionReadError(
      "the admission artefact does not name the exact ordered SysML provenance closure",
    );
  }
  const candidateConsumptions = snapshot.consumptions.filter((consumption) =>
    consumption.consumer.serverId === admissionArtifact.producer.serverId &&
    consumption.consumer.tool === admissionArtifact.producer.tool &&
    consumption.consumer.runId === admissionArtifact.producer.runId
  );
  const expectedConsumptionIds = new Set(
    sysmlArtifacts.map((sysmlArtifact) =>
      `consume-${sysmlArtifact.id}-by-${admissionArtifact.id}`
    ),
  );
  const exactConsumptions = sysmlArtifacts.every((sysmlArtifact) => {
    const consumptionId = `consume-${sysmlArtifact.id}-by-${admissionArtifact.id}`;
    return candidateConsumptions.filter((consumption) =>
      consumption.id === consumptionId &&
      consumption.artifactId === sysmlArtifact.id &&
      fingerprintsEqual(
        consumption.observedFingerprint,
        sysmlArtifact.fingerprint,
      ) && consumption.status === "verified" && consumption.verifiedAt === sealedAt
    ).length === 1;
  });
  if (
    candidateConsumptions.length !== sysmlArtifacts.length ||
    !exactConsumptions
  ) {
    throw new TechnicalCompilationAdmissionReadError(
      "the verified SysML consumptions are not bijective with the anchor provenance closure",
    );
  }

  const derivedFrom = snapshot.provenance.filter((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === admissionArtifact.id
  );
  const exactDerivedFrom = sysmlArtifacts.every((sysmlArtifact) =>
    derivedFrom.filter((link) =>
      link.to.kind === "artifact" && link.to.id === sysmlArtifact.id
    ).length === 1
  );
  if (derivedFrom.length !== sysmlArtifacts.length || !exactDerivedFrom) {
    throw new TechnicalCompilationAdmissionReadError(
      "the derived-from links are not bijective with the anchor provenance closure",
    );
  }

  const uses = snapshot.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    expectedConsumptionIds.has(link.from.id)
  );
  const exactUses = sysmlArtifacts.every((sysmlArtifact) => {
    const consumptionId = `consume-${sysmlArtifact.id}-by-${admissionArtifact.id}`;
    return uses.filter((link) =>
      link.from.id === consumptionId && link.to.kind === "artifact" &&
      link.to.id === sysmlArtifact.id
    ).length === 1;
  });
  if (uses.length !== sysmlArtifacts.length || !exactUses) {
    throw new TechnicalCompilationAdmissionReadError(
      "the uses links are not bijective with the verified SysML consumptions",
    );
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  const digest = safeId(fingerprint.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function integrity<T>(label: string, read: () => T): T {
  try {
    return read();
  } catch {
    throw new TechnicalCompilationAdmissionReadError(label);
  }
}

async function integrityAsync<T>(
  label: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch {
    throw new TechnicalCompilationAdmissionReadError(label);
  }
}

async function readSnapshot(
  snapshots: Pick<ThreadSnapshotStore, "get">,
  snapshotId: string,
  failure: string,
): Promise<ThreadSnapshot | undefined> {
  try {
    return await snapshots.get(snapshotId);
  } catch {
    throw new TechnicalCompilationAdmissionReadError(failure);
  }
}

async function readCapture(
  captures: Pick<TechnicalCompilationAdmissionCaptureStore, "read">,
  fingerprint: ContentFingerprint,
): Promise<string | undefined> {
  try {
    return await captures.read(fingerprint);
  } catch {
    throw new TechnicalCompilationAdmissionReadError(
      "the admission capture could not be read",
    );
  }
}
