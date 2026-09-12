/**
 * Exact, read-only whole-App binding for a published measured DFM check.
 * The provider owns the session schema; this adapter reopens recorded
 * captures and proves identities against the current Thread.
 */
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../domain/project/engineering-project.ts";
import { sameSnapshotRef } from "../../domain/project/validation/engineering-project-invariant-values.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  type DfmCheckCase,
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  parseDfmTargetArtifactUri,
} from "../../domain/make/dfm/dfm-case.ts";
import {
  attestCanonicalWriteGeometryStep,
  parseWriteGeometryStepOwner,
  WRITE_GEOMETRY_CAPTURE_URI_PREFIX,
} from "../../domain/make/dfm/dfm-canonical-step.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  DFM_CASE_CAPTURE_URI_PREFIX,
  fingerprintDfmCaseCapture,
  validateDfmCaseCapture,
} from "../make/dfm/dfm-case-capture.ts";
import {
  canonicalDfmCheckCaptureText,
  DFM_CHECK_CAPTURE_URI_PREFIX,
  type DfmCheckCapture,
  fingerprintDfmCheckCapture,
  validateDfmCheckCapture,
} from "../make/dfm/dfm-check-capture.ts";
import type { ThreadViewerAppMaterializationCatalogBinding } from "./thread-viewer-app-materializer.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import {
  currentViewerRegistrationBasis,
  exactViewerArtifact,
  installedViewerResource,
} from "./thread-viewer-registration-context.ts";

export const DFM_VIEWER_APP_ID = "io.casys.mcp-dfm.results";
export const DFM_VIEWER_RESOURCE_URI = "ui://mcp-dfm/results-viewer";
export const DFM_VIEWER_SESSION_SCHEMA = "io.casys.mcp-dfm.recorded-checks-session/1.0";
export const DFM_VIEWER_SESSION_KIND = "dfm.measured-checks";
export const DFM_VIEWER_AUTHORITY_MISSING_REASON =
  "No exact human-approved DFM-check MRTR decision is bound to this run basis.";
export const DFM_VIEWER_AUTHORITY_DIVERGENT_REASON =
  "The signed DFM-check approval basis differs from this run basis.";
export const DFM_VIEWER_AUTHORITY_AMBIGUOUS_REASON =
  "Multiple human-approved DFM-check MRTR decisions are bound to this run basis.";
const DFM_RECORDED_CHECKS_SCHEMA = "io.casys.mcp-dfm.recorded-checks/1.0";
const DFM_OPERATION =
  `${INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id}@${INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version}`;
const DFM_SEAL_OPERATION =
  `${INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.id}@${INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.version}`;

export interface DfmCaptureReader {
  read(
    fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
  ): Promise<string | undefined>;
}

/** Builds a provider payload only from the exact published DFM check successor. */
export async function buildDfmViewerBinding(request: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly packages: readonly InstalledThreadViewerAppPackage[];
  readonly checks: DfmCaptureReader;
  readonly cases: DfmCaptureReader;
}): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
  const basis = currentViewerRegistrationBasis(request.project, request.thread);
  const resultArtifact = exactViewerArtifact(request.thread, request.artifactId);
  if (!isDfmProducer(resultArtifact)) return undefined;
  if (!isExactDfmCheckArtifact(resultArtifact)) {
    throw new TypeError(
      "DFM viewer requires one exact unarchived dfm-check evidence artifact.",
    );
  }
  if (resultArtifact.freshness.status !== "fresh") {
    throw new TypeError("The DFM check evidence is not fresh.");
  }
  const installed = installedViewerResource(
    request.packages,
    DFM_VIEWER_APP_ID,
    DFM_VIEWER_RESOURCE_URI,
    DFM_VIEWER_SESSION_SCHEMA,
  );
  if (!installed) return undefined;

  const capture = await reopenDfmCheckCapture(request.checks, resultArtifact);
  if (capture.trustedRunId !== resultArtifact.producer.runId) {
    throw new TypeError(
      "The DFM check capture trusted run does not match its Thread producer.",
    );
  }
  const run = exactCompletedDfmRun(request.project, capture, resultArtifact, basis);
  const { caseArtifact, geometryArtifact } = exactBoundInputs(
    request.thread,
    resultArtifact,
    capture,
    run,
  );
  const caseCapture = await reopenDfmCaseCapture(
    request.cases,
    caseArtifact,
    capture,
    basis,
  );
  const step = exactCanonicalStep(
    request.thread,
    geometryArtifact,
    capture,
    caseCapture.dfmCase.target,
    basis.projectId,
  );
  recrossRecordedLimits(capture, caseCapture.dfmCase);
  const authority = recrossDfmRunAuthority(request.project, run);
  const captureRef = {
    uri: resultArtifact.uri!,
    fingerprint: `sha256:${resultArtifact.fingerprint.digest}`,
  } as const;
  const projection = authority.status === "available"
    ? {
      status: "available" as const,
      result: recordedChecksResult(capture, resultArtifact.fingerprint.digest),
    }
    : { status: "unavailable" as const, reason: authority.reason };
  const unsigned = {
    schemaVersion: DFM_VIEWER_SESSION_SCHEMA,
    kind: DFM_VIEWER_SESSION_KIND,
    basis: { ...basis },
    anchor: {
      kind: "artifact",
      id: resultArtifact.id,
      uri: resultArtifact.uri!,
      fingerprint: `sha256:${resultArtifact.fingerprint.digest}`,
    },
    provenance: {
      kind: "digital-thread-operation",
      operation: DFM_OPERATION,
      runId: capture.trustedRunId,
      caseDigest: capture.caseDigest,
      captureArtifact: captureRef,
      inputArtifact: {
        uri: step.uri!,
        mediaType: "model/step",
        fingerprint: `sha256:${step.fingerprint.digest}`,
        bytes: capture.geometry.byteCount,
      },
      resultArtifact: captureRef,
    },
    projection,
  };
  const sessionFingerprint = await sha256Fingerprint(unsigned);
  const payload = {
    ...unsigned,
    basis: {
      ...unsigned.basis,
      sessionFingerprint: `sha256:${sessionFingerprint.digest}`,
    },
  };
  return {
    basis: { ...basis },
    anchor: { kind: "artifact", id: resultArtifact.id },
    app: { ...installed.app.app },
    manifest: { uri: installed.app.manifest.uri, path: installed.app.manifest.path },
    resource: { uri: installed.resource.uri, path: installed.resource.path },
    readResources: [],
    session: { schema: DFM_VIEWER_SESSION_SCHEMA, payload },
  };
}

function isDfmProducer(artifact: ThreadArtifact): boolean {
  return artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === DFM_OPERATION;
}

function isExactDfmCheckArtifact(artifact: ThreadArtifact): boolean {
  return artifact.id === `dfm-check-${artifact.fingerprint.digest}` &&
    artifact.kind === "evidence" &&
    artifact.version === artifact.fingerprint.digest &&
    artifact.mediaType === "application/json" &&
    artifact.uri ===
      `${DFM_CHECK_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}`;
}

async function reopenDfmCheckCapture(
  reader: DfmCaptureReader,
  artifact: ThreadArtifact,
): Promise<DfmCheckCapture> {
  const text = await reader.read(artifact.fingerprint);
  if (text === undefined) {
    throw new TypeError("The exact DFM check capture is unavailable.");
  }
  await assertRawFingerprint(text, artifact.fingerprint.digest, "DFM check");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("The DFM check capture is not JSON.");
  }
  const capture = validateDfmCheckCapture(value);
  if (canonicalDfmCheckCaptureText(capture) !== text) {
    throw new TypeError("The DFM check capture bytes are not canonical.");
  }
  const fingerprint = await fingerprintDfmCheckCapture(capture);
  if (fingerprint.digest !== artifact.fingerprint.digest) {
    throw new TypeError("The DFM check capture fingerprint is not canonical.");
  }
  return capture;
}

async function reopenDfmCaseCapture(
  reader: DfmCaptureReader,
  artifact: ThreadArtifact,
  check: DfmCheckCapture,
  basis: { readonly projectId: string; readonly subjectId: string },
) {
  if (!isExactDfmCaseArtifact(artifact, check.caseDigest)) {
    throw new TypeError(
      "The DFM check does not consume its exact sealed case artifact.",
    );
  }
  if (artifact.freshness.status !== "fresh") {
    throw new TypeError("The sealed DFM case artifact is not fresh.");
  }
  const text = await reader.read(artifact.fingerprint);
  if (text === undefined) {
    throw new TypeError("The exact DFM case capture is unavailable.");
  }
  await assertRawFingerprint(text, artifact.fingerprint.digest, "DFM case");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("The DFM case capture is not JSON.");
  }
  const capture = await validateDfmCaseCapture(value);
  if (deterministicJson(capture) !== text) {
    throw new TypeError("The DFM case capture bytes are not canonical.");
  }
  const fingerprint = await fingerprintDfmCaseCapture(capture);
  if (fingerprint.digest !== artifact.fingerprint.digest) {
    throw new TypeError("The DFM case capture fingerprint is not canonical.");
  }
  if (capture.caseDigest !== check.caseDigest) {
    throw new TypeError(
      "The sealed DFM case digest does not match the recorded check.",
    );
  }
  if (
    capture.dfmCase.project.id !== basis.projectId ||
    capture.dfmCase.project.subjectId !== basis.subjectId
  ) {
    throw new TypeError(
      "The sealed DFM case does not match the current project or subject.",
    );
  }
  return capture;
}

function isExactDfmCaseArtifact(
  artifact: ThreadArtifact,
  caseDigest: string,
): boolean {
  return artifact.id === `dfm-case-${caseDigest}` &&
    artifact.kind === "document" &&
    artifact.version === caseDigest &&
    artifact.mediaType === "application/json" &&
    artifact.uri === `${DFM_CASE_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}` &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === DFM_SEAL_OPERATION;
}

function exactCompletedDfmRun(
  project: EngineeringProjectSnapshot,
  capture: DfmCheckCapture,
  artifact: ThreadArtifact,
  basis: { readonly subjectId: string },
) {
  const run = unique(
    project.agentRuns.filter((item) => item.id === capture.trustedRunId),
    "DFM viewer requires the exact completed measured-check run.",
  );
  if (
    run.status !== "completed" ||
    run.id !== artifact.producer.runId ||
    !run.resultSnapshot
  ) {
    throw new TypeError(
      "DFM viewer requires the exact completed measured-check run.",
    );
  }
  const workItem = unique(
    project.workItems.filter((item) => item.id === run.workItemId),
    "The DFM check run is not bound to its work item.",
  );
  const operation = workItem.operation;
  if (
    operation?.id !== INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id ||
    operation.version !== INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version
  ) {
    throw new TypeError(
      "The completed run is not bound to industrialize.run-dfm-checks@1.",
    );
  }
  const evidence = unique(
    run.evidenceRefs.filter((item) =>
      item.kind === "artifact" && item.id === artifact.id
    ),
    "The completed DFM run does not name the exact check evidence.",
  );
  if (
    evidence.snapshotId !== run.resultSnapshot.snapshotId ||
    evidence.snapshotRevision !== run.resultSnapshot.revision
  ) {
    throw new TypeError(
      "The completed DFM run evidence does not match its result snapshot.",
    );
  }
  assertKnownSnapshot(project, run.resultSnapshot, basis.subjectId, "result");
  if (run.basis?.kind === "thread-snapshot") {
    assertKnownSnapshot(project, run.basis, basis.subjectId, "basis");
  }
  return { run, workItem, operation };
}

function recrossDfmRunAuthority(
  project: EngineeringProjectSnapshot,
  binding: ReturnType<typeof exactCompletedDfmRun>,
): { readonly status: "available" } | {
  readonly status: "unavailable";
  readonly reason: string;
} {
  const runBasis = threadSnapshotBasis(binding.run);
  if (!runBasis) {
    return {
      status: "unavailable",
      reason: DFM_VIEWER_AUTHORITY_MISSING_REASON,
    };
  }
  const matching = [];
  let signedOnAnotherBasis = false;
  for (const decisionId of binding.workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    const decisionBasis = decision?.proposal ? decision.baseSnapshot : undefined;
    if (!decision || !decisionBasis) continue;
    const approvals = project.approvals.filter((approval) => {
      const approvalBasis = approval.baseSnapshot;
      return approval.decisionId === decision.id &&
        approval.status === "approved" &&
        approval.decidedByOrigin === "human" &&
        approvalBasis !== undefined &&
        fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
        sameSnapshotRef(approvalBasis, decisionBasis);
    });
    if (approvals.length !== 1) continue;
    if (sameSnapshotRef(decisionBasis, runBasis)) {
      matching.push(decision);
    } else {
      signedOnAnotherBasis = true;
    }
  }
  if (matching.length === 1) return { status: "available" };
  if (matching.length > 1) {
    return {
      status: "unavailable",
      reason: DFM_VIEWER_AUTHORITY_AMBIGUOUS_REASON,
    };
  }
  return {
    status: "unavailable",
    reason: signedOnAnotherBasis
      ? DFM_VIEWER_AUTHORITY_DIVERGENT_REASON
      : DFM_VIEWER_AUTHORITY_MISSING_REASON,
  };
}

function threadSnapshotBasis(
  run: EngineeringAgentRun,
): EngineeringThreadSnapshotRef | undefined {
  if (run.basis?.kind !== "thread-snapshot") return undefined;
  return {
    snapshotId: run.basis.snapshotId,
    revision: run.basis.revision,
    subjectId: run.basis.subjectId,
  };
}

function exactBoundInputs(
  thread: ThreadSnapshot,
  artifact: ThreadArtifact,
  capture: DfmCheckCapture,
  binding: ReturnType<typeof exactCompletedDfmRun>,
): {
  readonly caseArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
} {
  if (artifact.inputArtifactIds.length !== 2) {
    throw new TypeError(
      "The DFM check artifact must consume the exact case and geometry artifacts.",
    );
  }
  const caseId = artifact.inputArtifactIds[0]!;
  const geometryId = artifact.inputArtifactIds[1]!;
  if (caseId !== `dfm-case-${capture.caseDigest}`) {
    throw new TypeError(
      "The DFM check does not consume its exact sealed case artifact.",
    );
  }
  if (geometryId !== capture.geometry.artifactId) {
    throw new TypeError(
      "The DFM check does not consume its exact recorded STEP artifact.",
    );
  }
  const caseBinding = binding.operation.bindings.find((item) =>
    item.name === "dfmCase"
  );
  const geometryBinding = binding.operation.bindings.find((item) =>
    item.name === "geometry"
  );
  if (
    caseBinding?.source.kind !== "thread-entity" ||
    caseBinding.source.reference.id !== caseId ||
    geometryBinding?.source.kind !== "thread-entity" ||
    geometryBinding.source.reference.id !== geometryId
  ) {
    throw new TypeError(
      "The completed DFM run is not bound to the exact case and geometry artifacts.",
    );
  }
  const caseArtifact = exactFreshArtifact(thread, caseId);
  const geometryArtifact = exactFreshArtifact(thread, geometryId);
  assertRecordedConsumption(thread, artifact, caseArtifact);
  assertRecordedConsumption(thread, artifact, geometryArtifact);
  assertDerivedFrom(thread, artifact, caseArtifact);
  assertDerivedFrom(thread, artifact, geometryArtifact);
  return { caseArtifact, geometryArtifact };
}

function exactCanonicalStep(
  thread: ThreadSnapshot,
  geometryArtifact: ThreadArtifact,
  capture: DfmCheckCapture,
  target: DfmCheckCase["target"],
  projectId: string,
): ThreadArtifact {
  if (geometryArtifact.id !== capture.geometry.artifactId) {
    throw new TypeError(
      "The DFM check does not consume its exact recorded STEP artifact.",
    );
  }
  if (
    geometryArtifact.kind !== "step" ||
    geometryArtifact.mediaType !== "model/step" ||
    geometryArtifact.freshness.status !== "fresh" ||
    geometryArtifact.fingerprint.digest !== capture.geometry.sha256 ||
    geometryArtifact.fingerprint.digest !==
      capture.providerCallParams.expectedStepSha256
  ) {
    throw new TypeError(
      "The recorded DFM STEP artifact is not the exact fresh canonical STEP.",
    );
  }
  const parsed = parseDfmTargetArtifactUri(target.artifactUri);
  if (
    parsed.projectId !== projectId ||
    parsed.artifactId !== geometryArtifact.id ||
    target.sha256 !== geometryArtifact.fingerprint.digest ||
    target.mediaType !== "model/step"
  ) {
    throw new TypeError(
      "The sealed DFM case target does not match the canonical STEP.",
    );
  }
  const attested = attestCanonicalWriteGeometryStep(
    thread,
    geometryArtifact,
    capture.geometry.sha256,
  );
  if (attested.status !== "attested") {
    throw new TypeError(attested.message);
  }
  const owner = parseWriteGeometryStepOwner(attested.step);
  if (!owner || attested.step.id !== geometryArtifact.id) {
    throw new TypeError(
      "DFM viewer requires a published write-geometry STEP child.",
    );
  }
  const parent = attested.geometry;
  if (
    parent.id !== `geometry-${owner.captureDigest}` ||
    parent.fingerprint.digest !== owner.captureDigest ||
    parent.uri !==
      `${WRITE_GEOMETRY_CAPTURE_URI_PREFIX}sha256/${owner.captureDigest}` ||
    parent.freshness.status !== "fresh" ||
    archivedRefKeys(thread).has(`artifact:${parent.id}`)
  ) {
    throw new TypeError(
      "The canonical write-geometry parent does not match the published STEP child.",
    );
  }
  if (attested.step.uri === undefined || attested.step.uri.length === 0) {
    throw new TypeError("The canonical STEP has no Thread identity URI.");
  }
  return attested.step;
}

function recrossRecordedLimits(
  capture: DfmCheckCapture,
  dfmCase: DfmCheckCase,
): void {
  const params = capture.providerCallParams;
  if (
    params.buildVolumeMm.x !== dfmCase.buildVolumeMm.x.value ||
    params.buildVolumeMm.y !== dfmCase.buildVolumeMm.y.value ||
    params.buildVolumeMm.z !== dfmCase.buildVolumeMm.z.value ||
    params.minThicknessMm !== dfmCase.minThicknessMm.value ||
    params.maxOverhangDeg !== dfmCase.maxOverhangAngleDeg.value ||
    params.meshSizeMm !== dfmCase.meshSizeMm.value ||
    deterministicJson(params.buildDirection) !==
      deterministicJson(dfmCase.buildDirection) ||
    deterministicJson(capture.zMinFilter.declared) !==
      deterministicJson(dfmCase.zMinFilter) ||
    deterministicJson(capture.limitations) !==
      deterministicJson(dfmCase.limitations)
  ) {
    throw new TypeError(
      "The recorded DFM call limits do not match the sealed case.",
    );
  }
}

function recordedChecksResult(capture: DfmCheckCapture, digest: string) {
  return {
    schemaVersion: DFM_RECORDED_CHECKS_SCHEMA,
    kind: "digital-thread-measured-checks",
    capture: {
      schemaVersion: capture.schemaVersion,
      fingerprint: `sha256:${digest}`,
      capturedAt: capture.capturedAt,
      dispatchedAt: capture.dispatchedAt,
    },
    geometry: {
      artifactId: capture.geometry.artifactId,
      sha256: capture.geometry.sha256,
      byteCount: capture.geometry.byteCount,
      mediaType: capture.geometry.mediaType,
    },
    caseDigest: capture.caseDigest,
    envelope: {
      ...capture.envelope,
      declaredVolumeMm: capture.providerCallParams.buildVolumeMm,
    },
    thickness: {
      ...capture.thickness,
      thresholdMm: capture.providerCallParams.minThicknessMm,
    },
    overhang: {
      ...capture.overhang,
      thresholdDeg: capture.providerCallParams.maxOverhangDeg,
      buildDirection: capture.providerCallParams.buildDirection,
    },
    zMinFilter: capture.zMinFilter,
    evaluations: {
      owner: "digital-thread",
      status: capture.evaluations.status,
      verdicts: capture.evaluations.verdicts,
    },
    limitations: capture.limitations,
  };
}

function exactFreshArtifact(
  thread: ThreadSnapshot,
  artifactId: string,
): ThreadArtifact {
  const artifact = exactViewerArtifact(thread, artifactId);
  if (artifact.freshness.status !== "fresh") {
    throw new TypeError(`Viewer registration requires one exact unarchived artifact.`);
  }
  return artifact;
}

function assertRecordedConsumption(
  thread: ThreadSnapshot,
  consumer: ThreadArtifact,
  upstream: ThreadArtifact,
): void {
  unique(
    thread.consumptions.filter((item) =>
      item.artifactId === upstream.id &&
      item.status === "verified" &&
      sameProducer(item.consumer, consumer.producer) &&
      deterministicJson(item.observedFingerprint) ===
        deterministicJson(upstream.fingerprint)
    ),
    `The DFM check has no verified consumption of ${upstream.id}.`,
  );
}

function assertDerivedFrom(
  thread: ThreadSnapshot,
  downstream: ThreadArtifact,
  upstream: ThreadArtifact,
): void {
  unique(
    thread.provenance.filter((item) =>
      item.relation === "derived_from" &&
      item.from.kind === "artifact" && item.from.id === downstream.id &&
      item.to.kind === "artifact" && item.to.id === upstream.id
    ),
    `The DFM check is not derived_from ${upstream.id}.`,
  );
}

function assertKnownSnapshot(
  project: EngineeringProjectSnapshot,
  reference: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
  subjectId: string,
  label: string,
): void {
  if (reference.subjectId !== subjectId) {
    throw new TypeError(
      `The completed DFM run ${label} snapshot is not this project subject.`,
    );
  }
  unique(
    project.threadSnapshots.filter((item) =>
      item.snapshotId === reference.snapshotId &&
      item.revision === reference.revision &&
      item.subjectId === reference.subjectId
    ),
    `The completed DFM run ${label} snapshot is unknown to this project.`,
  );
}

async function assertRawFingerprint(
  text: string,
  digest: string,
  label: string,
): Promise<void> {
  if (await sha256Hex(new TextEncoder().encode(text)) !== digest) {
    throw new TypeError(
      `The ${label} capture bytes do not match the Thread fingerprint.`,
    );
  }
}

function sameProducer(
  left: ThreadArtifact["producer"],
  right: ThreadArtifact["producer"],
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function unique<T>(items: readonly T[], message: string): T {
  if (items.length !== 1) throw new TypeError(message);
  return items[0]!;
}
