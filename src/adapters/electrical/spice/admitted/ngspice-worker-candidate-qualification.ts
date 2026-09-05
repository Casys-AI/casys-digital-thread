/**
 * Maintainer-only qualification of an imported ngspice-worker candidate.
 * Policy, limits, worker command, resistor-divider fixture and validators stay
 * code-owned. The CLI/gate never accepts a provider, image, digest, platform,
 * command, endpoint, tool, worker, binding, unit, profile, source, netlist or
 * args.
 *
 * Import already owns acquisition. This path never builds Docker, never loads
 * or removes images, and never assumes Docker and Microsandbox digest identity.
 * It is physical/runtime qualification only: not product admitted-SPICE, not a
 * method/binding qualification, and not L3/L4/L5 engineering evidence.
 */

import type { CapabilityRuntimeObservedHost } from "../../../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeHostObservation } from "../../../../domain/capability/runtime/capability-runtime-catalog.ts";
import {
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeOutputDeclaration,
  type IsolatedCodeOutputReceiptRecord,
  type IsolatedCodePolicyRef,
  type IsolatedCodeProfileRef,
  type IsolatedCodeRuntimeAttestation,
  type IsolatedOutputPublicationRef,
  runtimeAttestationsEqual,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { pinnedOciImageReference } from "../../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  parseSpiceIsolatedEvidence,
  parseSpiceOperatingPointResult,
  validateAdmittedSpiceIsolatedOutput,
} from "../../../../domain/electrical/spice/admitted/isolated-output.ts";
import { SPICE_ADMITTED_OUTPUT_VALIDATOR } from "../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  firstPartyMicrosandboxImageCandidateReference,
} from "../../../control-plane/first-party-microsandbox-image-candidate-import-record.ts";
import {
  assertBoundCandidateImportPhysicalImageId,
  buildFirstPartyMicrosandboxImageCandidateQualificationRecord,
  type FirstPartyMicrosandboxImageCandidateQualificationRecord,
  firstPartyMicrosandboxImageCandidateQualificationRoot,
  NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
  persistFirstPartyMicrosandboxImageCandidateQualificationRecord,
  readObservedLinuxArm64Host,
} from "../../../control-plane/first-party-microsandbox-image-candidate-qualification.ts";
import {
  assertNoCandidateQualificationRecord,
  assertNoCandidateQualificationSuccessor,
  buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  firstPartyMicrosandboxImageCandidateQualificationSuccessorRoot,
  persistFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  proveCandidateQualificationPredecessorUnpublishedAndDestroyed,
  requireSuccessorAttempt,
} from "../../../control-plane/first-party-microsandbox-image-candidate-qualification-successor.ts";
import {
  type AdmittedSpiceExecutionComposition,
  type AdmittedSpiceExecutionCompositionPaths,
  type AdmittedSpiceExecutionServerOptions,
  createAdmittedSpiceExecutionComposition,
} from "./execution-composition.ts";
import { createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport } from "./first-party-spice-execution.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "./local-image-references.ts";
import {
  FileNgspiceWorkerCandidateAttemptStore,
  type NgspiceWorkerCandidateAttempt,
  type NgspiceWorkerCandidateAttemptIdentity,
} from "./ngspice-worker-candidate-attempt-store.ts";

export const NGSPICE_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA =
  "ngspice-worker-candidate-qualification-plan/1.0" as const;
export const NGSPICE_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA =
  "ngspice-worker-candidate-qualification/1.0" as const;
export const NGSPICE_WORKER_CANDIDATE_PROOF_SCHEMA =
  "ngspice-worker-candidate-proof/1.0" as const;
export const NGSPICE_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID =
  "ngspice-worker-candidate-resistor-divider-v1" as const;
export const NGSPICE_ADMITTED_CIRCUIT_BINDING_ID = "ngspice-admitted-circuit" as const;
export const NGSPICE_WORKER_CANDIDATE_SOURCE_URL = new URL(
  "../../../../testing/fixtures/electrical/spice/operating-point/resistor-divider.cir",
  import.meta.url,
);

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;

export interface NgspiceWorkerCandidateQualificationPlan {
  readonly schemaVersion: typeof NGSPICE_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly mode: "plan";
  readonly mutation: false;
  readonly physicalImageId: typeof NGSPICE_WORKER_PHYSICAL_IMAGE_ID;
  readonly bindingId: typeof NGSPICE_ADMITTED_CIRCUIT_BINDING_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly fixtureId: typeof NGSPICE_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID;
  readonly runtimeQualification: "not-run";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
}

export interface NgspiceWorkerCandidateObservedHost {
  readonly identityFingerprint: ContentFingerprint;
  readonly platform: "linux/arm64";
  readonly fingerprint: ContentFingerprint;
}

export interface NgspiceWorkerCandidateProof {
  readonly schemaVersion: typeof NGSPICE_WORKER_CANDIDATE_PROOF_SCHEMA;
  readonly kind: "candidate-profile-proof";
  readonly physicalImageId: typeof NGSPICE_WORKER_PHYSICAL_IMAGE_ID;
  readonly bindingId: typeof NGSPICE_ADMITTED_CIRCUIT_BINDING_ID;
  readonly importRecord: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA;
  };
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly candidateReference: string;
  readonly observedHost: NgspiceWorkerCandidateObservedHost;
  readonly executionProfile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly execution: {
    readonly runId: string;
    readonly receiptFingerprint: ContentFingerprint;
  };
  readonly outputs: readonly {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[];
  readonly outputValidation: string;
  readonly reread: "publication-gated";
  readonly destruction: "proven";
  readonly runtimeQualification: "passed";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly methodQualification: "unqualified";
  readonly bindingQualification: "unqualified";
}

export interface NgspiceWorkerCandidateQualificationResult {
  readonly schemaVersion: typeof NGSPICE_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly status: "passed";
  readonly physicalImageId: typeof NGSPICE_WORKER_PHYSICAL_IMAGE_ID;
  readonly bindingId: typeof NGSPICE_ADMITTED_CIRCUIT_BINDING_ID;
  readonly candidateReference: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateImportRecord["identities"];
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly isolationClass: string;
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly sourceSha256: string;
  readonly receiptFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly outputs: readonly {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[];
  readonly outputValidation: string;
  readonly reread: "publication-gated";
  readonly destruction: "proven";
  readonly runtimeQualification: "passed";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
  readonly methodQualification: "unqualified";
  readonly bindingQualification: "unqualified";
  readonly proof: NgspiceWorkerCandidateProof;
  readonly qualification: FirstPartyMicrosandboxImageCandidateQualificationRecord;
}

export interface NgspiceWorkerCandidateQualificationPorts {
  readonly compose?: (
    options: AdmittedSpiceExecutionServerOptions,
    paths: AdmittedSpiceExecutionCompositionPaths,
  ) => Promise<AdmittedSpiceExecutionComposition>;
  readonly observedHost: { read(): Promise<CapabilityRuntimeHostObservation> };
  readonly now?: () => string;
  readonly stateRoot?: string;
}

export function ngspiceWorkerCandidateQualificationPaths(
  stateRoot: string,
): {
  readonly outputCasDirectory: string;
  readonly attemptDirectory: string;
  readonly captureDirectory: string;
} {
  return Object.freeze({
    outputCasDirectory: `${stateRoot}/outputs`,
    attemptDirectory: `${stateRoot}/attempts`,
    captureDirectory: `${stateRoot}/captures`,
  });
}

export async function readNgspiceWorkerCandidateQualificationSource(): Promise<
  Uint8Array
> {
  return await Deno.readFile(NGSPICE_WORKER_CANDIDATE_SOURCE_URL);
}

export async function planNgspiceWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): Promise<NgspiceWorkerCandidateQualificationPlan> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
  );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  return Object.freeze({
    schemaVersion: NGSPICE_WORKER_CANDIDATE_QUALIFICATION_PLAN_SCHEMA,
    kind: "candidate-qualification",
    mode: "plan",
    mutation: false,
    physicalImageId: NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
    bindingId: NGSPICE_ADMITTED_CIRCUIT_BINDING_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint,
    stateRoot: firstPartyMicrosandboxImageCandidateQualificationRoot(
      NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    ),
    fixtureId: NGSPICE_WORKER_CANDIDATE_QUALIFICATION_FIXTURE_ID,
    runtimeQualification: "not-run",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
  });
}

export function renderNgspiceWorkerCandidateQualificationPlanText(
  plan: NgspiceWorkerCandidateQualificationPlan,
): string {
  return [
    `schemaVersion=${plan.schemaVersion}`,
    `kind=${plan.kind}`,
    `mode=${plan.mode}`,
    `mutation=${plan.mutation}`,
    `physicalImageId=${plan.physicalImageId}`,
    `bindingId=${plan.bindingId}`,
    `candidateReference=${plan.candidateReference}`,
    `microsandbox.manifestDigest=${plan.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${plan.importRecordFingerprint}`,
    `stateRoot=${plan.stateRoot}`,
    `fixtureId=${plan.fixtureId}`,
    `runtimeQualification=${plan.runtimeQualification}`,
    `eligibleForPromotion=${plan.eligibleForPromotion}`,
    "Candidate qualification only. Promotion is false.",
    "Admitted method and binding qualification remain unqualified.",
    "This is not L3/L4/L5 engineering evidence.",
    "",
  ].join("\n");
}

export async function qualifyNgspiceWorkerCandidate(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: NgspiceWorkerCandidateQualificationPorts,
): Promise<NgspiceWorkerCandidateQualificationResult> {
  return await orchestrateNgspiceWorkerCandidateQualification(record, ports, "run");
}

export async function recoverNgspiceWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: NgspiceWorkerCandidateQualificationPorts,
): Promise<NgspiceWorkerCandidateQualificationResult> {
  return await orchestrateNgspiceWorkerCandidateQualification(
    record,
    ports,
    "recover",
  );
}

export async function retryNgspiceWorkerCandidateQualificationFromInfrastructureFailure(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: NgspiceWorkerCandidateQualificationPorts,
): Promise<NgspiceWorkerCandidateQualificationResult> {
  return await orchestrateNgspiceWorkerCandidateQualification(
    record,
    ports,
    "retry-infrastructure-failure",
  );
}

export function renderNgspiceWorkerCandidateQualificationResultText(
  result: NgspiceWorkerCandidateQualificationResult,
): string {
  return [
    `schemaVersion=${result.schemaVersion}`,
    `kind=${result.kind}`,
    `status=${result.status}`,
    `physicalImageId=${result.physicalImageId}`,
    `bindingId=${result.bindingId}`,
    `candidateReference=${result.candidateReference}`,
    `microsandbox.manifestDigest=${result.identities.microsandboxManifestDigest}`,
    `importRecord.fingerprint=${result.importRecordFingerprint}`,
    `outputs=${result.outputs.length}`,
    `destruction=${result.destruction}`,
    `observedHost.platform=${result.qualification.observedHost.platform}`,
    `execution.runId=${result.qualification.execution.runId}`,
    `execution.receipt=${result.qualification.execution.receiptFingerprint.algorithm}:${result.qualification.execution.receiptFingerprint.digest}`,
    `runtimeQualification=${result.runtimeQualification}`,
    `eligibleForPromotion=${result.eligibleForPromotion}`,
    `methodQualification=${result.methodQualification}`,
    `bindingQualification=${result.bindingQualification}`,
    "Candidate qualification only. Promotion is false.",
    "Admitted method and binding qualification remain unqualified.",
    "This is not L3/L4/L5 engineering evidence.",
    "",
  ].join("\n");
}

async function orchestrateNgspiceWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: NgspiceWorkerCandidateQualificationPorts,
  mode: "run" | "recover" | "retry-infrastructure-failure",
): Promise<NgspiceWorkerCandidateQualificationResult> {
  const composed = await composeNgspiceWorkerCandidateQualification(
    record,
    ports,
    mode === "retry-infrastructure-failure" ? "run" : mode,
  );
  const ctx = mode === "retry-infrastructure-failure"
    ? await authorizeNgspiceWorkerCandidateSuccessor(composed, ports)
    : composed;
  const proof = await settleAttempt(
    ctx,
    mode === "retry-infrastructure-failure" ? "run" : mode,
  );
  const qualification =
    await persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
      ctx.stateRoot,
      await buildFirstPartyMicrosandboxImageCandidateQualificationRecord(record, {
        observedHost: ctx.host.observation,
        runId: proof.execution.runId,
        receiptFingerprint: proof.execution.receiptFingerprint,
      }),
    );
  return Object.freeze({
    schemaVersion: NGSPICE_WORKER_CANDIDATE_QUALIFICATION_RESULT_SCHEMA,
    kind: "candidate-qualification",
    status: "passed",
    physicalImageId: NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
    bindingId: NGSPICE_ADMITTED_CIRCUIT_BINDING_ID,
    candidateReference: record.candidate.microsandbox.candidateReference,
    identities: record.identities,
    importRecordFingerprint: ctx.importRecordFingerprint,
    stateRoot: ctx.stateRoot,
    isolationClass: ctx.runtime.isolationClass,
    executionProfile: ctx.executionProfile,
    sourceSha256: ctx.sourceSha256,
    receiptFingerprint: proof.execution.receiptFingerprint,
    outputs: proof.outputs,
    outputValidation: proof.outputValidation,
    reread: "publication-gated" as const,
    destruction: "proven" as const,
    runtimeQualification: "passed" as const,
    eligibleForPromotion: false as const,
    evidence: "host-runtime-only" as const,
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
    methodQualification: "unqualified" as const,
    bindingQualification: "unqualified" as const,
    proof,
    qualification,
  });
}

async function authorizeNgspiceWorkerCandidateSuccessor(
  ctx: QualificationContext,
  ports: NgspiceWorkerCandidateQualificationPorts,
): Promise<QualificationContext> {
  await assertNoCandidateQualificationSuccessor(ctx.stateRoot);
  await assertNoCandidateQualificationRecord(ctx.stateRoot);
  const attempt = await ctx.wal.read();
  if (attempt === undefined) {
    throw new Error(
      "Candidate qualification successor requires an existing producerGeneration-0 predecessor.",
    );
  }
  if (attempt.phase === "prepared") {
    throw new Error(
      "Candidate qualification successor refuses a prepared-only predecessor.",
    );
  }
  if (attempt.phase === "attested") {
    throw new Error(
      "Candidate qualification successor refuses an already-successful predecessor.",
    );
  }
  if (attempt.phase !== "dispatching") {
    throw new Error(
      "Candidate qualification successor requires a dispatched unpublished predecessor.",
    );
  }
  if (attempt.identity.importRecordFingerprint !== ctx.importRecordFingerprint) {
    throw new Error(
      "Candidate qualification successor predecessor does not belong to the bound import.",
    );
  }
  const predecessorFiles = await snapshotDirectory(
    ngspiceWorkerCandidateQualificationPaths(ctx.stateRoot).attemptDirectory,
  );
  const destruction =
    await proveCandidateQualificationPredecessorUnpublishedAndDestroyed(
      ctx.execution,
      attempt.identity.executionRunId,
    );
  await assertUnchangedSnapshot(
    ngspiceWorkerCandidateQualificationPaths(ctx.stateRoot).attemptDirectory,
    predecessorFiles,
    "ngspice-worker candidate qualification successor mutated the predecessor WAL.",
  );
  const successor =
    await persistFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
      ctx.stateRoot,
      await buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor({
        physicalImageId: NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
        importRecordFingerprint: ctx.importRecordFingerprint,
        predecessorAttempts: [{
          id: NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
          runId: attempt.identity.executionRunId,
          destruction,
        }],
      }),
    );
  const retryRoot = firstPartyMicrosandboxImageCandidateQualificationSuccessorRoot(
    ctx.stateRoot,
  );
  const startedAt = (ports.now ?? (() => new Date().toISOString()))();
  return {
    ...ctx,
    identity: Object.freeze({
      ...ctx.identity,
      executionRunId: requireSuccessorAttempt(
        successor,
        NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
      ).runId,
      startedAt,
    }),
    wal: new FileNgspiceWorkerCandidateAttemptStore(
      `${retryRoot}/attempts`,
      ctx.stateRoot,
    ),
    proofPath: `${retryRoot}/captures/proof.json`,
  };
}

async function snapshotDirectory(
  directory: string,
): Promise<ReadonlyMap<string, string>> {
  const files = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(current));
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return;
      throw error;
    }
    for (const entry of entries) {
      const path = `${current}/${entry.name}`;
      if (entry.isDirectory) {
        await walk(path);
        continue;
      }
      if (!entry.isFile) continue;
      files.set(path, await Deno.readTextFile(path));
    }
  }
  await walk(directory);
  return files;
}

async function assertUnchangedSnapshot(
  directory: string,
  expected: ReadonlyMap<string, string>,
  message: string,
): Promise<void> {
  const actual = await snapshotDirectory(directory);
  if (actual.size !== expected.size) throw new Error(message);
  for (const [path, text] of expected) {
    if (actual.get(path) !== text) throw new Error(message);
  }
}

async function composeNgspiceWorkerCandidateQualification(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  ports: NgspiceWorkerCandidateQualificationPorts,
  mode: "run" | "recover",
): Promise<QualificationContext> {
  assertBoundCandidateImportPhysicalImageId(
    record,
    NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
  );
  const host = await readObservedLinuxArm64Host(ports.observedHost);
  const options =
    await createAdmittedSpiceExecutionServerOptionsForBoundCandidateImport(
      record,
    );
  const importRecordFingerprint =
    await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(record);
  const stateRoot = ports.stateRoot ??
    firstPartyMicrosandboxImageCandidateQualificationRoot(
      NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
      importRecordFingerprint,
    );
  const paths = ngspiceWorkerCandidateQualificationPaths(stateRoot);
  const compose = ports.compose ?? createAdmittedSpiceExecutionComposition;
  const composition = await compose(options, {
    outputCasDirectory: paths.outputCasDirectory,
  });
  const execution = composition.execution;
  if (execution === undefined) {
    throw new Error("The imported ngspice-worker candidate runtime was not composed.");
  }
  const profile = await composition.profiles.initial();
  const expectedImageReference = pinnedOciImageReference(
    record.candidate.microsandbox.candidateReference,
    "$ngspiceWorkerCandidate.imageReference",
  );
  const expectedDigest = record.identities.microsandboxManifestDigest.slice(
    "sha256:".length,
  );
  if (
    profile.runtimeBackend.imageReference !== expectedImageReference ||
    profile.runtime.imageDigest.digest !== expectedDigest
  ) {
    throw new Error(
      "The composed ngspice-worker candidate profile did not retain the bound Microsandbox candidate reference and digest.",
    );
  }
  if (expectedImageReference === LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE) {
    throw new Error(
      "ngspice-worker candidate qualification must not substitute the active catalogue pin.",
    );
  }
  const sourceBytes = await readNgspiceWorkerCandidateQualificationSource();
  const sourceSha256 = await fingerprintResourceBytes(sourceBytes);
  const executionRunId = `ngspice-worker-candidate-qualification-${
    (await sha256Fingerprint({
      schemaVersion: "ngspice-worker-candidate-qualification-run/1.0",
      importRecordFingerprint,
      candidateReference: record.candidate.microsandbox.candidateReference,
      microsandboxManifestDigest: record.identities.microsandboxManifestDigest,
      observedHost: host.identity.fingerprint,
      sourceSha256,
    })).digest
  }`;
  const wal = new FileNgspiceWorkerCandidateAttemptStore(
    paths.attemptDirectory,
    stateRoot,
  );
  const existing = await wal.read();
  if (mode === "recover" && existing === undefined) {
    throw new Error(
      "ngspice-worker candidate qualification recovery requires an existing WAL attempt.",
    );
  }
  const startedAt = existing?.identity.startedAt ??
    (ports.now ?? (() => new Date().toISOString()))();
  const identity: NgspiceWorkerCandidateAttemptIdentity = Object.freeze({
    importRecordFingerprint,
    candidateReference: record.candidate.microsandbox.candidateReference,
    microsandboxManifestDigest: record.identities.microsandboxManifestDigest,
    observedHostFingerprint: host.identity.fingerprint,
    profileFingerprint: profile.profileFingerprint,
    executionRunId,
    sourceSha256,
    startedAt,
  });
  if (
    existing !== undefined &&
    deterministicJson(existing.identity) !== deterministicJson(identity)
  ) {
    throw new Error(
      "The ngspice-worker candidate WAL identity diverged from the bound import.",
    );
  }
  return {
    record,
    importRecordFingerprint,
    stateRoot,
    host,
    identity: existing?.identity ?? identity,
    execution,
    executionProfile: profile.executionProfile,
    isolationPolicy: profile.isolationPolicy,
    outputManifest: profile.outputManifest,
    profileFingerprint: profile.profileFingerprint,
    runtime: profile.runtime,
    sourceBytes,
    sourceSha256,
    wal,
    proofPath: `${paths.captureDirectory}/proof.json`,
    outputValidation:
      `${SPICE_ADMITTED_OUTPUT_VALIDATOR.id}@${SPICE_ADMITTED_OUTPUT_VALIDATOR.version}`,
  };
}

async function settleAttempt(
  ctx: QualificationContext,
  mode: "run" | "recover",
): Promise<NgspiceWorkerCandidateProof> {
  const attempt = await ctx.wal.read();
  if (mode === "recover" && attempt === undefined) {
    throw new Error(
      "ngspice-worker candidate qualification recovery requires an existing WAL attempt.",
    );
  }
  if (attempt?.phase === "attested") {
    return await rereadAttested(ctx, attempt);
  }
  if (attempt?.phase === "dispatching") {
    return await recoverDispatching(ctx, attempt);
  }
  if (attempt?.phase === "prepared" && mode === "recover") {
    throw new Error(
      "ngspice-worker candidate qualification recovery does not dispatch a prepared attempt.",
    );
  }
  if (mode === "recover") {
    throw new Error(
      "ngspice-worker candidate qualification recovery requires an existing WAL attempt.",
    );
  }
  return await dispatchAndRun(ctx, attempt);
}

async function dispatchAndRun(
  ctx: QualificationContext,
  attempt: NgspiceWorkerCandidateAttempt | undefined,
): Promise<NgspiceWorkerCandidateProof> {
  if (attempt === undefined) {
    await ctx.wal.prepare(ctx.identity);
  }
  const current = await ctx.wal.read();
  if (current?.phase === "prepared") {
    await ctx.wal.markDispatching(ctx.identity);
  }
  const receipt = await ctx.execution.runner.run({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: ctx.identity.executionRunId,
    producerGeneration: 0,
    profile: ctx.executionProfile,
    source: { bytes: ctx.sourceBytes, sha256: ctx.sourceSha256 },
    policy: ctx.isolationPolicy,
    outputs: ctx.outputManifest,
  });
  return await settleFromReceipt(ctx, receipt);
}

async function recoverDispatching(
  ctx: QualificationContext,
  attempt: Extract<NgspiceWorkerCandidateAttempt, { phase: "dispatching" }>,
): Promise<NgspiceWorkerCandidateProof> {
  let resolution;
  try {
    resolution = await ctx.execution.publications.resolvePublicationByRunId(
      attempt.identity.executionRunId,
      attempt.dispatch.producerGeneration,
    );
  } catch {
    throw new Error(
      "The ngspice-worker candidate qualification publication could not be resolved safely; no redispatch occurs.",
    );
  }
  if (resolution.status === "outcome-unknown") {
    throw new Error(
      "The ngspice-worker candidate qualification publication outcome is unknown; no redispatch occurs.",
    );
  }
  if (resolution.status !== "published") {
    throw new Error(
      "The ngspice-worker candidate qualification publication is unpublished; recovery does not redispatch.",
    );
  }
  const receipt = await ctx.execution.publications.readReceipt(resolution.ref);
  if (receipt === undefined) {
    throw new Error(
      "The ngspice-worker candidate qualification publication-gated receipt could not be reopened.",
    );
  }
  return await settleFromReceipt(ctx, receipt);
}

async function settleFromReceipt(
  ctx: QualificationContext,
  receipt: IsolatedCodeExecutionReceipt,
): Promise<NgspiceWorkerCandidateProof> {
  assertReceiptMatchesCurrentProfile(ctx, receipt);
  if (receipt.termination.kind !== "exited" || receipt.termination.exitCode !== 0) {
    throw new Error(
      "The imported ngspice-worker candidate worker did not exit successfully.",
    );
  }
  const resolution = await ctx.execution.publications.resolvePublicationByRunId(
    ctx.identity.executionRunId,
    0,
  );
  if (resolution.status !== "published") {
    throw new Error(
      "The ngspice-worker candidate qualification CAS publication was not durably resolvable.",
    );
  }
  if (receipt.destruction.status !== "proven") {
    throw new Error(
      "ngspice-worker candidate qualification requires proven microVM destruction.",
    );
  }
  if (
    deterministicJson(resolution.receipt) !==
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt))
  ) {
    throw new Error(
      "The ngspice-worker candidate qualification CAS receipt record differs from the run receipt.",
    );
  }
  const rereadReceipt = await ctx.execution.publications.readReceipt(resolution.ref);
  if (rereadReceipt === undefined) {
    throw new Error(
      "The ngspice-worker candidate qualification publication-gated receipt could not be reopened.",
    );
  }
  if (rereadReceipt.fingerprint.digest !== receipt.fingerprint.digest) {
    throw new Error(
      "The reopened ngspice-worker candidate qualification receipt fingerprint drifted.",
    );
  }
  if (receipt.outputs.length !== ctx.outputManifest.length) {
    throw new Error(
      "The published ngspice-worker candidate qualification receipt does not contain the complete output batch.",
    );
  }
  const bytesByRole = await reopenPublishedOutputs(
    ctx,
    resolution.ref,
    resolution.receipt.outputs,
  );
  await validateCandidateOutputs(ctx, receipt, bytesByRole);
  const proof = await persistProof(ctx.proofPath, buildProof(ctx, receipt));
  const current = await ctx.wal.read();
  if (current?.phase !== "attested") {
    await ctx.wal.attest(ctx.identity, {
      receiptFingerprint: receipt.fingerprint,
      outputs: proof.outputs,
      destruction: "proven",
      attestedAt: ctx.identity.startedAt,
    });
  }
  return proof;
}

async function rereadAttested(
  ctx: QualificationContext,
  attempt: Extract<NgspiceWorkerCandidateAttempt, { phase: "attested" }>,
): Promise<NgspiceWorkerCandidateProof> {
  const stored = await readProof(ctx.proofPath);
  const resolution = await ctx.execution.publications.resolvePublicationByRunId(
    attempt.identity.executionRunId,
    0,
  );
  if (resolution.status !== "published") {
    throw new Error(
      "The attested ngspice-worker candidate publication is no longer durably resolvable.",
    );
  }
  const receipt = await ctx.execution.publications.readReceipt(resolution.ref);
  if (receipt === undefined) {
    throw new Error(
      "The attested ngspice-worker candidate receipt could not be reopened.",
    );
  }
  assertReceiptMatchesCurrentProfile(ctx, receipt);
  if (
    receipt.runId !== attempt.identity.executionRunId ||
    receipt.producerGeneration !== 0 ||
    !fingerprintsEqual(
      receipt.fingerprint,
      attempt.attestation.receiptFingerprint,
    ) ||
    !fingerprintsEqual(receipt.fingerprint, stored.execution.receiptFingerprint) ||
    receipt.termination.kind !== "exited" ||
    receipt.termination.exitCode !== 0 ||
    receipt.destruction.status !== "proven" ||
    deterministicJson(resolution.receipt) !==
      deterministicJson(isolatedCodeExecutionReceiptRecord(receipt))
  ) {
    throw new Error(
      "The attested ngspice-worker candidate receipt diverged from its proof, WAL attestation, current execution context, or publication resolution.",
    );
  }
  const rebound = buildProof(ctx, receipt);
  if (deterministicJson(rebound) !== deterministicJson(stored)) {
    throw new Error(
      "The durable ngspice-worker candidate proof diverged from its bound import, host, current server-owned profile, or WAL attestation.",
    );
  }
  const receiptOutputs = profileOutputEvidence(receipt.outputs);
  if (
    deterministicJson(receiptOutputs) !== deterministicJson(stored.outputs) ||
    deterministicJson(receiptOutputs) !==
      deterministicJson(attempt.attestation.outputs) ||
    deterministicJson(receiptOutputs) !==
      deterministicJson(profileOutputEvidence(resolution.receipt.outputs))
  ) {
    throw new Error(
      "The attested ngspice-worker candidate output manifest diverged from its proof, WAL attestation, receipt, or current server-owned manifest.",
    );
  }
  const bytesByRole = await reopenPublishedOutputs(
    ctx,
    resolution.ref,
    resolution.receipt.outputs,
  );
  await validateCandidateOutputs(ctx, receipt, bytesByRole);
  return stored;
}

function assertReceiptMatchesCurrentProfile(
  ctx: QualificationContext,
  receipt: IsolatedCodeExecutionReceipt,
): void {
  if (!runtimeAttestationsEqual(receipt.runtime, ctx.runtime)) {
    throw new Error(
      "The ngspice-worker candidate receipt runtime attestation diverged from the current candidate profile runtime.",
    );
  }
  if (deterministicJson(receipt.profile) !== deterministicJson(ctx.executionProfile)) {
    throw new Error(
      "The ngspice-worker candidate receipt profile diverged from the current server-owned candidate profile.",
    );
  }
  if (deterministicJson(receipt.policy) !== deterministicJson(ctx.isolationPolicy)) {
    throw new Error(
      "The ngspice-worker candidate receipt policy diverged from the current server-owned candidate policy.",
    );
  }
  if (receipt.sourceSha256 !== ctx.sourceSha256) {
    throw new Error(
      "The ngspice-worker candidate receipt source SHA diverged from the code-owned resistor-divider fixture.",
    );
  }
  const receiptManifest = receipt.outputs.map((output) => ({
    role: output.role,
    basename: output.basename,
    mediaType: output.mediaType,
    format: output.format,
  }));
  if (
    deterministicJson(receiptManifest) !== deterministicJson(ctx.outputManifest)
  ) {
    throw new Error(
      "The ngspice-worker candidate receipt output manifest diverged from the current server-owned manifest.",
    );
  }
}

async function reopenPublishedOutputs(
  ctx: QualificationContext,
  ref: IsolatedOutputPublicationRef,
  outputs: readonly IsolatedCodeOutputReceiptRecord[],
): Promise<Map<string, Uint8Array>> {
  const bytesByRole = new Map<string, Uint8Array>();
  for (const member of outputs) {
    const bytes = await ctx.execution.publications.readPublishedObject(
      ref,
      member,
    );
    if (bytes === undefined) {
      throw new Error(
        "A publication-gated ngspice-worker candidate output could not be reopened.",
      );
    }
    if (
      bytes.byteLength !== member.byteCount ||
      await fingerprintResourceBytes(bytes) !== member.sha256
    ) {
      throw new Error(
        "A reopened ngspice-worker candidate output drifted after CAS reread.",
      );
    }
    bytesByRole.set(member.role, bytes);
  }
  return bytesByRole;
}

async function validateCandidateOutputs(
  ctx: QualificationContext,
  receipt: IsolatedCodeExecutionReceipt,
  bytesByRole: ReadonlyMap<string, Uint8Array>,
): Promise<void> {
  const evidenceBytes = bytesByRole.get("evidence");
  const resultBytes = bytesByRole.get("result");
  if (!evidenceBytes || !resultBytes || bytesByRole.size !== 2) {
    throw new Error(
      "The ngspice-worker candidate publication must contain exactly result.json and evidence.json.",
    );
  }
  for (const declaration of ctx.outputManifest) {
    const bytes = bytesByRole.get(declaration.role);
    if (!bytes) {
      throw new Error("The ngspice-worker candidate output declaration is missing.");
    }
    validateAdmittedSpiceIsolatedOutput(declaration, bytes);
  }
  const result = parseSpiceOperatingPointResult(resultBytes);
  const evidence = parseSpiceIsolatedEvidence(evidenceBytes);
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  if (
    evidence.inputSourceSha256 !== ctx.sourceSha256 ||
    evidence.result.sha256 !== resultSha256 ||
    evidence.result.byteCount !== resultBytes.byteLength ||
    evidence.counts.sourceBytes !== ctx.sourceBytes.byteLength ||
    evidence.counts.observableCount !== result.observables.length
  ) {
    throw new Error(
      "The ngspice-worker candidate evidence does not bind the code-owned resistor-divider source and exact result bytes.",
    );
  }
  const vOut = result.observables.find((item) => item.nativeName === "v(out)");
  const iVin = result.observables.find((item) => item.nativeName === "i(vin)");
  if (
    vOut?.kind !== "node-voltage" || vOut.unit !== "V" || vOut.value !== 2.5 ||
    iVin?.kind !== "branch-current" || iVin.unit !== "A" || iVin.value !== -0.0025
  ) {
    throw new Error(
      "The ngspice-worker candidate resistor-divider operating point is not v(out)=2.5 V and i(vin)=-0.0025 A.",
    );
  }
  if (receipt.destruction.status !== "proven") {
    throw new Error(
      "ngspice-worker candidate qualification requires proven microVM destruction.",
    );
  }
}

function buildProof(
  ctx: QualificationContext,
  receipt: IsolatedCodeExecutionReceipt,
): NgspiceWorkerCandidateProof {
  return parseNgspiceWorkerCandidateProof({
    schemaVersion: NGSPICE_WORKER_CANDIDATE_PROOF_SCHEMA,
    kind: "candidate-profile-proof",
    physicalImageId: NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
    bindingId: NGSPICE_ADMITTED_CIRCUIT_BINDING_ID,
    importRecord: {
      fingerprint: ctx.importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    },
    identities: ctx.record.identities,
    candidateReference: ctx.record.candidate.microsandbox.candidateReference,
    observedHost: observedHostRecord(ctx.host.identity),
    executionProfile: {
      id: ctx.executionProfile.id,
      version: ctx.executionProfile.version,
      fingerprint: ctx.profileFingerprint,
    },
    execution: {
      runId: receipt.runId,
      receiptFingerprint: receipt.fingerprint,
    },
    outputs: profileOutputEvidence(receipt.outputs),
    outputValidation: ctx.outputValidation,
    reread: "publication-gated",
    destruction: "proven",
    runtimeQualification: "passed",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
    engineeringLevels: { l3: false, l4: false, l5: false },
    methodQualification: "unqualified",
    bindingQualification: "unqualified",
  });
}

export function parseNgspiceWorkerCandidateProof(
  value: unknown,
): NgspiceWorkerCandidateProof {
  const root = jsonObject(value, "ngspice-worker candidate proof");
  if (root.schemaVersion !== NGSPICE_WORKER_CANDIDATE_PROOF_SCHEMA) {
    throw new TypeError(
      "ngspice-worker candidate proof schema is not ngspice-worker-candidate-proof/1.0.",
    );
  }
  const importRecord = jsonObject(root.importRecord, "candidate proof import record");
  const identities = jsonObject(root.identities, "candidate proof identities");
  const observedHost = jsonObject(root.observedHost, "candidate proof observed host");
  const executionProfile = jsonObject(
    root.executionProfile,
    "candidate proof execution profile",
  );
  const execution = jsonObject(root.execution, "candidate proof execution");
  const engineeringLevels = jsonObject(
    root.engineeringLevels,
    "candidate proof engineering levels",
  );
  if (
    root.kind !== "candidate-profile-proof" ||
    root.physicalImageId !== NGSPICE_WORKER_PHYSICAL_IMAGE_ID ||
    root.bindingId !== NGSPICE_ADMITTED_CIRCUIT_BINDING_ID ||
    root.runtimeQualification !== "passed" ||
    root.eligibleForPromotion !== false ||
    root.evidence !== "host-runtime-only" ||
    root.reread !== "publication-gated" ||
    root.destruction !== "proven" ||
    root.methodQualification !== "unqualified" ||
    root.bindingQualification !== "unqualified" ||
    importRecord.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA ||
    engineeringLevels.l3 !== false ||
    engineeringLevels.l4 !== false ||
    engineeringLevels.l5 !== false
  ) {
    throw new TypeError(
      "ngspice-worker candidate proof must remain host-runtime evidence with eligibleForPromotion=false.",
    );
  }
  if (!Array.isArray(root.outputs) || root.outputs.length !== 2) {
    throw new TypeError(
      "ngspice-worker candidate proof must contain exactly result.json and evidence.json.",
    );
  }
  const rebuiltIdentities = {
    ociIndexDigest: requiredSha256(
      identities.ociIndexDigest,
      "candidate proof OCI index digest",
    ),
    ociPlatformManifestDigest: requiredSha256(
      identities.ociPlatformManifestDigest,
      "candidate proof OCI platform-manifest digest",
    ),
    microsandboxManifestDigest: requiredSha256(
      identities.microsandboxManifestDigest,
      "candidate proof Microsandbox digest",
    ),
  };
  const candidateReference = firstPartyMicrosandboxImageCandidateReference(
    NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
    rebuiltIdentities.microsandboxManifestDigest,
  );
  if (root.candidateReference !== candidateReference) {
    throw new TypeError(
      "ngspice-worker candidate proof candidateReference is not the bound Microsandbox candidate.",
    );
  }
  const rebuilt: NgspiceWorkerCandidateProof = Object.freeze({
    schemaVersion: NGSPICE_WORKER_CANDIDATE_PROOF_SCHEMA,
    kind: "candidate-profile-proof",
    physicalImageId: NGSPICE_WORKER_PHYSICAL_IMAGE_ID,
    bindingId: NGSPICE_ADMITTED_CIRCUIT_BINDING_ID,
    importRecord: Object.freeze({
      fingerprint: requiredSha256(
        importRecord.fingerprint,
        "candidate proof import-record fingerprint",
      ),
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    }),
    identities: Object.freeze(rebuiltIdentities),
    candidateReference,
    observedHost: parseObservedHost(observedHost),
    executionProfile: Object.freeze({
      id: requiredString(executionProfile.id, "candidate proof executionProfile.id"),
      version: requiredString(
        executionProfile.version,
        "candidate proof executionProfile.version",
      ),
      fingerprint: contentFingerprint(
        executionProfile.fingerprint,
        "candidate proof executionProfile.fingerprint",
      ),
    }),
    execution: Object.freeze({
      runId: requiredString(execution.runId, "candidate proof runId"),
      receiptFingerprint: contentFingerprint(
        execution.receiptFingerprint,
        "candidate proof receipt fingerprint",
      ),
    }),
    outputs: Object.freeze(root.outputs.map((item, index) => {
      const output = jsonObject(item, `candidate proof outputs[${index}]`);
      return Object.freeze({
        role: requiredString(output.role, `candidate proof outputs[${index}].role`),
        byteCount: requiredPositiveInteger(
          output.byteCount,
          `candidate proof outputs[${index}].byteCount`,
        ),
        sha256: requiredHex(output.sha256, `candidate proof outputs[${index}].sha256`),
      });
    })),
    outputValidation: requiredString(
      root.outputValidation,
      "candidate proof outputValidation",
    ),
    reread: "publication-gated",
    destruction: "proven",
    runtimeQualification: "passed",
    eligibleForPromotion: false,
    evidence: "host-runtime-only",
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
    methodQualification: "unqualified",
    bindingQualification: "unqualified",
  });
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "ngspice-worker candidate proof is not the exact rebuilt record.",
    );
  }
  return rebuilt;
}

async function persistProof(
  path: string,
  proof: NgspiceWorkerCandidateProof,
): Promise<NgspiceWorkerCandidateProof> {
  const parsed = parseNgspiceWorkerCandidateProof(JSON.parse(deterministicJson(proof)));
  await Deno.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const text = `${deterministicJson(parsed)}\n`;
  try {
    const existing = await Deno.readTextFile(path);
    if (existing === text) return parsed;
    throw new Error(
      "A different candidate qualification record already occupies this import-record identity.",
    );
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  await Deno.writeTextFile(path, text, { createNew: true });
  if (await Deno.readTextFile(path) !== text) {
    throw new Error("The candidate qualification record failed durable reread.");
  }
  return parsed;
}

async function readProof(path: string): Promise<NgspiceWorkerCandidateProof> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("The attested ngspice-worker candidate proof is missing.");
    }
    throw error;
  }
  const parsed = parseNgspiceWorkerCandidateProof(JSON.parse(text));
  if (`${deterministicJson(parsed)}\n` !== text) {
    throw new Error("The attested ngspice-worker candidate proof is not canonical.");
  }
  return parsed;
}

function profileOutputEvidence(
  outputs: readonly {
    readonly role: string;
    readonly byteCount: number;
    readonly sha256: string;
  }[],
): readonly {
  readonly role: string;
  readonly byteCount: number;
  readonly sha256: string;
}[] {
  return Object.freeze(outputs.map((output) =>
    Object.freeze({
      role: output.role,
      byteCount: output.byteCount,
      sha256: output.sha256,
    })
  ));
}

function observedHostRecord(
  host: CapabilityRuntimeObservedHost & { readonly platform: "linux/arm64" },
): NgspiceWorkerCandidateObservedHost {
  return Object.freeze({
    identityFingerprint: host.identityFingerprint,
    platform: "linux/arm64",
    fingerprint: host.fingerprint,
  });
}

function parseObservedHost(
  value: Record<string, unknown>,
): NgspiceWorkerCandidateObservedHost {
  if (value.platform !== "linux/arm64") {
    throw new TypeError(
      "Candidate qualification requires authoritative linux/arm64 host observation.",
    );
  }
  return Object.freeze({
    identityFingerprint: contentFingerprint(
      value.identityFingerprint,
      "observed host identity",
    ),
    platform: "linux/arm64",
    fingerprint: contentFingerprint(value.fingerprint, "observed host fingerprint"),
  });
}

function jsonObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredSha256(value: unknown, label: string): string {
  const digest = requiredString(value, label);
  if (!SHA256.test(digest)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
  return digest;
}

function requiredHex(value: unknown, label: string): string {
  const digest = requiredString(value, label);
  if (!SHA256_DIGEST.test(digest)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
  return digest;
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function contentFingerprint(value: unknown, label: string): ContentFingerprint {
  const root = jsonObject(value, label);
  if (root.algorithm !== "sha256") {
    throw new TypeError(`${label} algorithm must be sha256.`);
  }
  return Object.freeze({
    algorithm: "sha256" as const,
    digest: requiredHex(root.digest, `${label} digest`),
  });
}

interface QualificationContext {
  readonly record: FirstPartyMicrosandboxImageCandidateImportRecord;
  readonly importRecordFingerprint: string;
  readonly stateRoot: string;
  readonly host: {
    readonly observation: CapabilityRuntimeHostObservation;
    readonly identity: CapabilityRuntimeObservedHost & {
      readonly platform: "linux/arm64";
    };
  };
  readonly identity: NgspiceWorkerCandidateAttemptIdentity;
  readonly execution: NonNullable<AdmittedSpiceExecutionComposition["execution"]>;
  readonly executionProfile: IsolatedCodeProfileRef;
  readonly isolationPolicy: IsolatedCodePolicyRef;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly profileFingerprint: ContentFingerprint;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly sourceBytes: Uint8Array;
  readonly sourceSha256: string;
  readonly wal: FileNgspiceWorkerCandidateAttemptStore;
  readonly proofPath: string;
  readonly outputValidation: string;
}
