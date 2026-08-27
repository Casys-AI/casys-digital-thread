/**
 * Closed, provider-free evidence contracts for `design.execute-build123d@1`.
 *
 * An execution produces two deliberately separate records:
 *
 * - a non-canonical draft that a later geometry MRTR may review; and
 * - one documentary capture that may be attached to the Thread.
 *
 * Neither record contains source bytes, a host/container path, a backend
 * handle, or a canonical STEP artifact. The isolated-output publication stays
 * the sole byte-visibility gate until a distinct geometry-write operation.
 */

import {
  BUILD123D_EXECUTION_OUTPUT,
  type Build123dExecutionAdmission,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  validateBuild123dExecutionAdmission,
} from "./build123d-execution-proposal.ts";
import {
  fingerprintIsolatedOutputPublicationManifest,
  type IsolatedCodeExecutionReceiptRecord,
  type IsolatedCodeOutputReceiptRecord,
  isolatedCodeRefsEqual,
  type IsolatedCodeRuntimeAttestation,
  type IsolatedOutputProducerGeneration,
  type IsolatedOutputPublicationRef,
  runtimeAttestationsEqual,
  validateContentFingerprint,
  validateIsolatedCodeExecutionReceiptRecord,
  validateIsolatedOutputProducerGeneration,
  validateIsolatedOutputPublicationRef,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const BUILD123D_EXECUTION_CAPTURE_SCHEMA =
  "build123d-execution-capture/1.0" as const;
export const BUILD123D_EXECUTION_DRAFT_SCHEMA =
  "build123d-execution-draft/1.0" as const;
export const BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA =
  "build123d-execution-draft-reference/1.0" as const;

export interface Build123dExecutionBasis {
  readonly kind: "thread-snapshot";
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
  readonly fingerprint: ContentFingerprint;
}

export interface Build123dExecutionDraftReference {
  readonly schemaVersion: typeof BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA;
  readonly draftId: string;
  readonly fingerprint: ContentFingerprint;
}

interface Build123dExecutionEvidenceCore {
  readonly operation: typeof DESIGN_EXECUTE_BUILD123D_OPERATION;
  readonly projectId: string;
  readonly basis: Build123dExecutionBasis;
  /** The project-control run id, not an execution-backend handle. */
  readonly trustedAgentRunId: string;
  /** Globally stable server-derived identity used by the isolated runner. */
  readonly executionRunId: string;
  /** Exact server-owned producer generation that published this receipt. */
  readonly producerGeneration: IsolatedOutputProducerGeneration;
  readonly decisionId: string;
  /** Exact durable `EngineeringAgentRun.startedAt`. */
  readonly executedAt: string;
  readonly admission: Build123dExecutionAdmission;
  readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
  readonly publicationRef: IsolatedOutputPublicationRef;
}

/**
 * Reviewable but non-canonical CAD evidence. STEP bytes remain behind the
 * publication-gated isolated-output CAS and are not embedded here.
 */
export interface Build123dExecutionDraft extends Build123dExecutionEvidenceCore {
  readonly schemaVersion: typeof BUILD123D_EXECUTION_DRAFT_SCHEMA;
  readonly kind: "noncanonical-build123d-execution-draft";
  readonly stepOutput: IsolatedCodeOutputReceiptRecord;
  readonly status: "noncanonical-awaiting-geometry-review";
}

/** Documentary evidence for exactly one future Thread artifact of kind document. */
export interface Build123dExecutionCapture extends Build123dExecutionEvidenceCore {
  readonly schemaVersion: typeof BUILD123D_EXECUTION_CAPTURE_SCHEMA;
  readonly noncanonicalDraft: Build123dExecutionDraftReference;
}

export interface CreateBuild123dExecutionEvidenceInput {
  readonly projectId: string;
  readonly basis: Build123dExecutionBasis;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly decisionId: string;
  readonly executedAt: string;
  readonly admission: Build123dExecutionAdmission;
  readonly receiptRecord: IsolatedCodeExecutionReceiptRecord;
}

export interface CreateBuild123dExecutionCaptureInput
  extends CreateBuild123dExecutionEvidenceInput {
  readonly draftReference: Build123dExecutionDraftReference;
}

/**
 * Derive the only isolated execution identity available to this operation.
 * The preimage contains exactly the project, trusted run, and operation refs.
 */
export async function deriveBuild123dExecutionRunId(
  projectIdValue: unknown,
  agentRunIdValue: unknown,
): Promise<string> {
  const projectId = safeId(projectIdValue, "$executionRunId.projectId");
  const agentRunId = safeId(agentRunIdValue, "$executionRunId.agentRunId");
  const fingerprint = await sha256Fingerprint({
    projectId,
    agentRunId,
    operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
  });
  return `build123d-execution-${fingerprint.digest}`;
}

export async function createBuild123dExecutionDraft(
  input: CreateBuild123dExecutionEvidenceInput,
): Promise<Build123dExecutionDraft> {
  return await validateBuild123dExecutionDraft({
    schemaVersion: BUILD123D_EXECUTION_DRAFT_SCHEMA,
    kind: "noncanonical-build123d-execution-draft",
    operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
    projectId: input.projectId,
    basis: input.basis,
    trustedAgentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    producerGeneration: input.receiptRecord.producerGeneration,
    decisionId: input.decisionId,
    executedAt: input.executedAt,
    admission: input.admission,
    receiptRecord: input.receiptRecord,
    publicationRef: input.receiptRecord.publication.ref,
    stepOutput: exactGeometryOutput(input.receiptRecord),
    status: "noncanonical-awaiting-geometry-review",
  });
}

export async function createBuild123dExecutionCapture(
  input: CreateBuild123dExecutionCaptureInput,
): Promise<Build123dExecutionCapture> {
  return await validateBuild123dExecutionCapture({
    schemaVersion: BUILD123D_EXECUTION_CAPTURE_SCHEMA,
    operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
    projectId: input.projectId,
    basis: input.basis,
    trustedAgentRunId: input.agentRunId,
    executionRunId: input.executionRunId,
    producerGeneration: input.receiptRecord.producerGeneration,
    decisionId: input.decisionId,
    executedAt: input.executedAt,
    admission: input.admission,
    receiptRecord: input.receiptRecord,
    publicationRef: input.receiptRecord.publication.ref,
    noncanonicalDraft: input.draftReference,
  });
}

export async function validateBuild123dExecutionDraft(
  value: unknown,
): Promise<Build123dExecutionDraft> {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "operation",
    "projectId",
    "basis",
    "trustedAgentRunId",
    "executionRunId",
    "producerGeneration",
    "decisionId",
    "executedAt",
    "admission",
    "receiptRecord",
    "publicationRef",
    "stepOutput",
    "status",
  ], "$build123dExecutionDraft");
  literalValue(
    root.schemaVersion,
    BUILD123D_EXECUTION_DRAFT_SCHEMA,
    "$build123dExecutionDraft.schemaVersion",
  );
  literalValue(
    root.kind,
    "noncanonical-build123d-execution-draft",
    "$build123dExecutionDraft.kind",
  );
  literalValue(
    root.status,
    "noncanonical-awaiting-geometry-review",
    "$build123dExecutionDraft.status",
  );
  const core = await validateEvidenceCore(root, "$build123dExecutionDraft");
  const stepOutput = validateExactStepOutput(
    root.stepOutput,
    core.receiptRecord,
    "$build123dExecutionDraft.stepOutput",
  );
  return deepFreeze({
    schemaVersion: BUILD123D_EXECUTION_DRAFT_SCHEMA,
    kind: "noncanonical-build123d-execution-draft",
    ...core,
    stepOutput,
    status: "noncanonical-awaiting-geometry-review",
  });
}

export async function validateBuild123dExecutionCapture(
  value: unknown,
): Promise<Build123dExecutionCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "projectId",
    "basis",
    "trustedAgentRunId",
    "executionRunId",
    "producerGeneration",
    "decisionId",
    "executedAt",
    "admission",
    "receiptRecord",
    "publicationRef",
    "noncanonicalDraft",
  ], "$build123dExecutionCapture");
  literalValue(
    root.schemaVersion,
    BUILD123D_EXECUTION_CAPTURE_SCHEMA,
    "$build123dExecutionCapture.schemaVersion",
  );
  const core = await validateEvidenceCore(root, "$build123dExecutionCapture");
  const noncanonicalDraft = validateBuild123dExecutionDraftReference(
    root.noncanonicalDraft,
    "$build123dExecutionCapture.noncanonicalDraft",
  );
  const expectedDraft = await createBuild123dExecutionDraft({
    projectId: core.projectId,
    basis: core.basis,
    agentRunId: core.trustedAgentRunId,
    executionRunId: core.executionRunId,
    decisionId: core.decisionId,
    executedAt: core.executedAt,
    admission: core.admission,
    receiptRecord: core.receiptRecord,
  });
  const expectedReference = await buildBuild123dExecutionDraftReference(
    expectedDraft,
  );
  if (deterministicJson(noncanonicalDraft) !== deterministicJson(expectedReference)) {
    throw new TypeError(
      "$build123dExecutionCapture.noncanonicalDraft does not name the exact execution draft.",
    );
  }
  return deepFreeze({
    schemaVersion: BUILD123D_EXECUTION_CAPTURE_SCHEMA,
    ...core,
    noncanonicalDraft,
  });
}

export async function fingerprintBuild123dExecutionDraft(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(await validateBuild123dExecutionDraft(value));
}

export async function buildBuild123dExecutionDraftReference(
  value: unknown,
): Promise<Build123dExecutionDraftReference> {
  const fingerprint = await fingerprintBuild123dExecutionDraft(value);
  return deepFreeze({
    schemaVersion: BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA,
    draftId: `build123d-execution-draft-${fingerprint.digest}`,
    fingerprint,
  });
}

export function validateBuild123dExecutionDraftReference(
  value: unknown,
  path = "$build123dExecutionDraftReference",
): Build123dExecutionDraftReference {
  const reference = exactRecord(
    value,
    ["schemaVersion", "draftId", "fingerprint"],
    path,
  );
  literalValue(
    reference.schemaVersion,
    BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = validateContentFingerprint(
    reference.fingerprint,
    `${path}.fingerprint`,
  );
  const draftId = safeId(reference.draftId, `${path}.draftId`);
  if (draftId !== `build123d-execution-draft-${fingerprint.digest}`) {
    throw new TypeError(`${path}.draftId must derive from its exact fingerprint.`);
  }
  return deepFreeze({
    schemaVersion: BUILD123D_EXECUTION_DRAFT_REFERENCE_SCHEMA,
    draftId,
    fingerprint,
  });
}

async function validateEvidenceCore(
  root: Record<string, unknown>,
  path: string,
): Promise<Build123dExecutionEvidenceCore> {
  validateOperation(root.operation, `${path}.operation`);
  const projectId = safeId(root.projectId, `${path}.projectId`);
  const basis = validateBuild123dExecutionBasis(root.basis, `${path}.basis`);
  const trustedAgentRunId = safeId(
    root.trustedAgentRunId,
    `${path}.trustedAgentRunId`,
  );
  const expectedExecutionRunId = await deriveBuild123dExecutionRunId(
    projectId,
    trustedAgentRunId,
  );
  const executionRunId = safeId(root.executionRunId, `${path}.executionRunId`);
  if (executionRunId !== expectedExecutionRunId) {
    throw new TypeError(`${path}.executionRunId is not the server-derived identity.`);
  }
  const admission = validateBuild123dExecutionAdmission(
    root.admission,
    `${path}.admission`,
  );
  const receiptRecord = await validateIsolatedCodeExecutionReceiptRecord(
    root.receiptRecord,
  );
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    root.producerGeneration,
    `${path}.producerGeneration`,
  );
  const publicationRef = await validateIsolatedOutputPublicationRef(
    root.publicationRef,
    executionRunId,
    `${path}.publicationRef`,
    producerGeneration,
  );
  await assertReceiptMatchesAdmission(
    receiptRecord,
    admission,
    executionRunId,
    producerGeneration,
    publicationRef,
    path,
  );
  return deepFreeze({
    operation: DESIGN_EXECUTE_BUILD123D_OPERATION,
    projectId,
    basis,
    trustedAgentRunId,
    executionRunId,
    producerGeneration,
    decisionId: safeId(root.decisionId, `${path}.decisionId`),
    executedAt: isoTimestamp(root.executedAt, `${path}.executedAt`),
    admission,
    receiptRecord,
    publicationRef,
  });
}

export function validateBuild123dExecutionBasis(
  value: unknown,
  path: string,
): Build123dExecutionBasis {
  const basis = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId", "fingerprint"],
    path,
  );
  literalValue(basis.kind, "thread-snapshot", `${path}.kind`);
  const snapshotId = safeId(basis.snapshotId, `${path}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path}.snapshotId must name an exact snapshot.`);
  }
  return deepFreeze({
    kind: "thread-snapshot",
    snapshotId,
    revision: positiveInteger(basis.revision, `${path}.revision`),
    subjectId: safeId(basis.subjectId, `${path}.subjectId`),
    fingerprint: validateContentFingerprint(
      basis.fingerprint,
      `${path}.fingerprint`,
    ),
  });
}

function validateOperation(value: unknown, path: string): void {
  const operation = exactRecord(value, ["id", "version"], path);
  literalValue(
    operation.id,
    DESIGN_EXECUTE_BUILD123D_OPERATION.id,
    `${path}.id`,
  );
  literalValue(
    operation.version,
    DESIGN_EXECUTE_BUILD123D_OPERATION.version,
    `${path}.version`,
  );
}

async function assertReceiptMatchesAdmission(
  receipt: IsolatedCodeExecutionReceiptRecord,
  admission: Build123dExecutionAdmission,
  executionRunId: string,
  producerGeneration: IsolatedOutputProducerGeneration,
  publicationRef: IsolatedOutputPublicationRef,
  path: string,
): Promise<void> {
  const expectedRuntime: IsolatedCodeRuntimeAttestation = {
    isolationClass: admission.execution.runtime.isolationClass,
    imageDigest: admission.execution.runtime.imageDigest,
    requestedLimits: admission.execution.runtime.limits,
    limitAssurance: admission.execution.runtime.limitAssurance,
  };
  const expectedProfile = {
    id: admission.execution.profile.id,
    version: admission.execution.profile.version,
  };
  if (
    receipt.runId !== executionRunId ||
    receipt.producerGeneration !== producerGeneration ||
    !isolatedCodeRefsEqual(receipt.profile, expectedProfile) ||
    receipt.sourceSha256 !== admission.compilation.source.sourceFingerprint.digest ||
    !isolatedCodeRefsEqual(receipt.policy, admission.execution.isolationPolicy) ||
    !runtimeAttestationsEqual(receipt.runtime, expectedRuntime) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.outputs.length !== 1 ||
    deterministicJson(receipt.publication.ref) !== deterministicJson(publicationRef)
  ) {
    throw new TypeError(`${path}.receiptRecord does not match the exact admission.`);
  }
  const output = receipt.outputs[0]!;
  if (
    output.role !== BUILD123D_EXECUTION_OUTPUT.role ||
    output.basename !== BUILD123D_EXECUTION_OUTPUT.basename ||
    output.mediaType !== BUILD123D_EXECUTION_OUTPUT.mediaType ||
    output.format !== BUILD123D_EXECUTION_OUTPUT.format ||
    output.role !== admission.execution.output.role ||
    output.basename !== admission.execution.output.basename ||
    output.mediaType !== admission.execution.output.mediaType ||
    output.format !== admission.execution.output.format
  ) {
    throw new TypeError(
      `${path}.receiptRecord output is not the admitted STEP member.`,
    );
  }
  if (
    admission.execution.minimumDestructionAssurance === "proven" &&
    receipt.destruction.status !== "proven"
  ) {
    throw new TypeError(
      `${path}.receiptRecord does not meet the admitted destruction assurance.`,
    );
  }
  if (receipt.destruction.runId !== executionRunId) {
    throw new TypeError(`${path}.receiptRecord destruction names another run.`);
  }
  const expectedPublicationFingerprint =
    await fingerprintIsolatedOutputPublicationManifest(
      executionRunId,
      producerGeneration,
      receipt.outputs.map((member) => ({
        role: member.role,
        basename: member.basename,
        mediaType: member.mediaType,
        format: member.format,
        byteCount: member.byteCount,
        sha256: member.sha256,
        casUri: member.casUri,
      })),
    );
  if (
    !fingerprintsEqual(
      receipt.publication.ref.fingerprint,
      expectedPublicationFingerprint,
    )
  ) {
    throw new TypeError(
      `${path}.receiptRecord publication does not commit its exact output manifest.`,
    );
  }
}

function validateExactStepOutput(
  value: unknown,
  receipt: IsolatedCodeExecutionReceiptRecord,
  path: string,
): IsolatedCodeOutputReceiptRecord {
  const expected = exactGeometryOutput(receipt);
  if (deterministicJson(value) !== deterministicJson(expected)) {
    throw new TypeError(`${path} must repeat the exact published STEP member.`);
  }
  return expected;
}

function exactGeometryOutput(
  receipt: IsolatedCodeExecutionReceiptRecord,
): IsolatedCodeOutputReceiptRecord {
  const matches = receipt.outputs.filter((output) => output.role === "geometry");
  if (matches.length !== 1) {
    throw new TypeError("The execution receipt must contain one geometry output.");
  }
  return matches[0]!;
}

function isoTimestamp(value: unknown, path: string): string {
  const timestamp = nonEmptyText(value, path);
  const epoch = Date.parse(timestamp);
  if (Number.isNaN(epoch) || new Date(epoch).toISOString() !== timestamp) {
    throw new TypeError(`${path} must be a canonical ISO-8601 timestamp.`);
  }
  return timestamp;
}
