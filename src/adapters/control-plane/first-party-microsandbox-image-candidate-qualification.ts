/**
 * Shared first-party Microsandbox candidate-qualification identities.
 *
 * A later per-domain gate binds one import record to the current matrix, then
 * records host/runtime evidence only. This module never selects a provider,
 * image, digest, platform, tool, or argument, never deletes a cached image,
 * and never claims catalogue promotion or L3/L4/L5 engineering evidence.
 */

import {
  type CapabilityRuntimeObservedHost,
  fingerprintCapabilityRuntimeObservedHost,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import type { CapabilityRuntimeHostObservation } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  fingerprintFirstPartyMicrosandboxImageCandidateImportRecord,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  firstPartyMicrosandboxImageCandidateReference,
  parseFirstPartyMicrosandboxImageCandidateImportRecord,
} from "./first-party-microsandbox-image-candidate-import-record.ts";

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_RECORD_SCHEMA =
  "first-party-microsandbox-image-candidate-qualification/1.0" as const;

export const FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_DIRECTORY =
  "state/local/first-party-microsandbox-image-candidate-qualification" as const;

export const BUILD123D_ISOLATED_WORKER_PHYSICAL_IMAGE_ID =
  "build123d-isolated-worker" as const;

export const GEOMETRY_MODULE_ASSEMBLER_WORKER_PHYSICAL_IMAGE_ID =
  "geometry-module-assembler-worker" as const;

export const CALCULIX_WORKER_PHYSICAL_IMAGE_ID = "calculix-worker" as const;

export const MODELICA_MICROSANDBOX_WORKER_PHYSICAL_IMAGE_ID =
  "modelica-microsandbox-worker" as const;

export const NGSPICE_WORKER_PHYSICAL_IMAGE_ID = "ngspice-worker" as const;

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SHA256_DIGEST = /^[0-9a-f]{64}$/u;
const FORBIDDEN_FLAG_PATTERN =
  /provider|image|digest|platform|command|endpoint|tool|worker|args|binding|unit-id/i;

export interface FirstPartyMicrosandboxImageCandidateQualificationRecord {
  readonly schemaVersion:
    typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_RECORD_SCHEMA;
  readonly kind: "candidate-qualification";
  readonly physicalImageId: string;
  readonly importRecord: {
    readonly fingerprint: string;
    readonly schemaVersion:
      typeof FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA;
  };
  readonly identities: {
    readonly ociIndexDigest: string;
    readonly ociPlatformManifestDigest: string;
    readonly microsandboxManifestDigest: string;
  };
  readonly candidateReference: string;
  readonly observedHost: {
    readonly identityFingerprint: ContentFingerprint;
    readonly platform: "linux/arm64";
    readonly fingerprint: ContentFingerprint;
  };
  readonly execution: {
    readonly runId: string;
    readonly receiptFingerprint: ContentFingerprint;
  };
  readonly runtimeQualification: "passed";
  readonly eligibleForPromotion: false;
  readonly evidence: "host-runtime-only";
  readonly engineeringLevels: {
    readonly l3: false;
    readonly l4: false;
    readonly l5: false;
  };
}

export interface FirstPartyMicrosandboxImageCandidateQualificationEvidence {
  readonly observedHost: CapabilityRuntimeHostObservation;
  readonly runId: string;
  readonly receiptFingerprint: ContentFingerprint;
}

export type FirstPartyMicrosandboxImageCandidateQualificationCliRequest =
  | { readonly mode: "help" }
  | { readonly mode: "plan"; readonly importRecordPath: string }
  | { readonly mode: "run"; readonly importRecordPath: string }
  | { readonly mode: "recover"; readonly importRecordPath: string }
  | {
    readonly mode: "retry-infrastructure-failure";
    readonly importRecordPath: string;
  };

export function assertBoundCandidateImportPhysicalImageId(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  physicalImageId: string,
): void {
  if (record.candidate.physicalImageId !== physicalImageId) {
    throw new TypeError(
      `Candidate qualification requires physicalImageId=${physicalImageId}; the bound import record names ${record.candidate.physicalImageId}.`,
    );
  }
}

export function firstPartyMicrosandboxImageCandidateQualificationIdentity(
  importRecordFingerprint: string,
): string {
  assertSha256(importRecordFingerprint, "candidate import-record fingerprint");
  return importRecordFingerprint.replace(":", "-");
}

export function firstPartyMicrosandboxImageCandidateQualificationRoot(
  physicalImageId: string,
  importRecordFingerprint: string,
): string {
  if (physicalImageId.length === 0 || /[/\0]/.test(physicalImageId)) {
    throw new TypeError(
      "Candidate qualification physicalImageId is not a path segment.",
    );
  }
  return `${FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_DIRECTORY}/${physicalImageId}/${
    firstPartyMicrosandboxImageCandidateQualificationIdentity(importRecordFingerprint)
  }`;
}

export async function readObservedLinuxArm64Host(
  observedHost: { read(): Promise<CapabilityRuntimeHostObservation> },
): Promise<{
  readonly observation: CapabilityRuntimeHostObservation;
  readonly identity: CapabilityRuntimeObservedHost & {
    readonly platform: "linux/arm64";
  };
}> {
  const observation = await observedHost.read();
  if (observation.platform !== "linux/arm64") {
    throw new Error(
      "Candidate qualification requires authoritative linux/arm64 host observation.",
    );
  }
  return {
    observation,
    identity: await rebuildObservedLinuxArm64Host(observation),
  };
}

export async function persistFirstPartyMicrosandboxImageCandidateQualificationRecord(
  stateRoot: string,
  record: FirstPartyMicrosandboxImageCandidateQualificationRecord,
): Promise<FirstPartyMicrosandboxImageCandidateQualificationRecord> {
  const parsed = await parseFirstPartyMicrosandboxImageCandidateQualificationRecord(
    JSON.parse(deterministicJson(record)),
  );
  await Deno.mkdir(stateRoot, { recursive: true });
  const path = `${stateRoot}/qualification.json`;
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

export async function buildFirstPartyMicrosandboxImageCandidateQualificationRecord(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  evidence: FirstPartyMicrosandboxImageCandidateQualificationEvidence,
): Promise<FirstPartyMicrosandboxImageCandidateQualificationRecord> {
  const parsed = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(record)),
  );
  const rebuilt = await rebuildQualificationRecord({
    physicalImageId: parsed.candidate.physicalImageId,
    importRecordFingerprint:
      await fingerprintFirstPartyMicrosandboxImageCandidateImportRecord(parsed),
    identities: parsed.identities,
    candidateReference: parsed.candidate.microsandbox.candidateReference,
    observedHost: evidence.observedHost,
    runId: evidence.runId,
    receiptFingerprint: evidence.receiptFingerprint,
  });
  return await parseFirstPartyMicrosandboxImageCandidateQualificationRecord(
    JSON.parse(deterministicJson(rebuilt)),
  );
}

export async function parseFirstPartyMicrosandboxImageCandidateQualificationRecord(
  value: unknown,
): Promise<FirstPartyMicrosandboxImageCandidateQualificationRecord> {
  const root = jsonObject(value, "candidate qualification record");
  if (
    root.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_RECORD_SCHEMA
  ) {
    throw new TypeError(
      "Candidate qualification record schema is not first-party-microsandbox-image-candidate-qualification/1.0.",
    );
  }
  const importRecord = jsonObject(
    root.importRecord,
    "candidate qualification import record",
  );
  const identities = jsonObject(
    root.identities,
    "candidate qualification identities",
  );
  const observedHost = jsonObject(
    root.observedHost,
    "candidate qualification observed host",
  );
  const execution = jsonObject(
    root.execution,
    "candidate qualification execution",
  );
  const engineeringLevels = jsonObject(
    root.engineeringLevels,
    "candidate qualification engineering levels",
  );
  const rebuilt = await rebuildQualificationRecord({
    physicalImageId: requiredString(
      root.physicalImageId,
      "candidate qualification physicalImageId",
    ),
    importRecordFingerprint: requiredString(
      importRecord.fingerprint,
      "candidate qualification import-record fingerprint",
    ),
    identities: {
      ociIndexDigest: requiredString(
        identities.ociIndexDigest,
        "candidate qualification OCI index digest",
      ),
      ociPlatformManifestDigest: requiredString(
        identities.ociPlatformManifestDigest,
        "candidate qualification OCI platform-manifest digest",
      ),
      microsandboxManifestDigest: requiredString(
        identities.microsandboxManifestDigest,
        "candidate qualification Microsandbox digest",
      ),
    },
    candidateReference: requiredString(
      root.candidateReference,
      "candidate qualification candidateReference",
    ),
    observedHost: {
      identityFingerprint: contentFingerprint(
        observedHost.identityFingerprint,
        "candidate qualification observed host identity",
      ),
      platform: requiredLinuxArm64(observedHost.platform),
    },
    runId: requiredRunId(execution.runId),
    receiptFingerprint: contentFingerprint(
      execution.receiptFingerprint,
      "candidate qualification receipt fingerprint",
    ),
  });
  if (
    importRecord.schemaVersion !==
      FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA
  ) {
    throw new TypeError(
      "Candidate qualification import-record schema is not first-party-microsandbox-image-candidate-import/3.0.",
    );
  }
  if (
    root.kind !== "candidate-qualification" ||
    root.runtimeQualification !== "passed" ||
    root.eligibleForPromotion !== false ||
    root.evidence !== "host-runtime-only" ||
    engineeringLevels.l3 !== false ||
    engineeringLevels.l4 !== false ||
    engineeringLevels.l5 !== false
  ) {
    throw new TypeError(
      "Candidate qualification record must remain host-runtime evidence with eligibleForPromotion=false.",
    );
  }
  if (deterministicJson(rebuilt) !== deterministicJson(value)) {
    throw new TypeError(
      "Candidate qualification record is not the exact rebuilt first-party qualification record.",
    );
  }
  return rebuilt;
}

export function parseFirstPartyMicrosandboxImageCandidateQualificationCli(
  args: readonly string[],
  options: {
    readonly usage: string;
    readonly allowRecover?: boolean;
    readonly allowRetryInfrastructureFailure?: boolean;
  },
): FirstPartyMicrosandboxImageCandidateQualificationCliRequest {
  const flags = parseFlags(args, options.usage);
  if (flags.has("help")) {
    if (flags.size !== 1) {
      throw new TypeError(options.usage);
    }
    return { mode: "help" };
  }
  const allowed = new Set(["import-record", "run"]);
  if (options.allowRecover === true) allowed.add("recover");
  if (options.allowRetryInfrastructureFailure === true) {
    allowed.add("retry-infrastructure-failure");
  }
  for (const name of flags.keys()) {
    if (!allowed.has(name)) {
      throw new TypeError(
        `--${name} is not valid for first-party candidate qualification.\n${options.usage}`,
      );
    }
  }
  const importRecordPath = flags.get("import-record");
  if (typeof importRecordPath !== "string" || importRecordPath.length === 0) {
    throw new TypeError(options.usage);
  }
  const run = flags.get("run");
  const recover = flags.get("recover");
  const retry = flags.get("retry-infrastructure-failure");
  const acknowledgements = [run, recover, retry].filter((value) => value !== undefined);
  if (acknowledgements.length > 1) {
    throw new TypeError(
      options.allowRetryInfrastructureFailure === true
        ? "Candidate qualification accepts only one of --run, --recover, or --retry-infrastructure-failure."
        : "Candidate qualification accepts only one of --run or --recover.",
    );
  }
  if (run === true) {
    return { mode: "run", importRecordPath };
  }
  if (run !== undefined) {
    throw new TypeError(
      "Candidate qualification --run is a boolean acknowledgement and takes no value.",
    );
  }
  if (recover === true) {
    return { mode: "recover", importRecordPath };
  }
  if (recover !== undefined) {
    throw new TypeError(
      "Candidate qualification --recover is a boolean acknowledgement and takes no value.",
    );
  }
  if (retry === true) {
    return { mode: "retry-infrastructure-failure", importRecordPath };
  }
  if (retry !== undefined) {
    throw new TypeError(
      "Candidate qualification --retry-infrastructure-failure is a boolean acknowledgement and takes no value.",
    );
  }
  return { mode: "plan", importRecordPath };
}

async function rebuildQualificationRecord(input: {
  readonly physicalImageId: string;
  readonly importRecordFingerprint: string;
  readonly identities: FirstPartyMicrosandboxImageCandidateQualificationRecord[
    "identities"
  ];
  readonly candidateReference: string;
  readonly observedHost: Pick<
    CapabilityRuntimeHostObservation,
    "identityFingerprint" | "platform"
  >;
  readonly runId: string;
  readonly receiptFingerprint: ContentFingerprint;
}): Promise<FirstPartyMicrosandboxImageCandidateQualificationRecord> {
  assertSha256(
    input.importRecordFingerprint,
    "candidate qualification import-record fingerprint",
  );
  assertSha256(
    input.identities.ociIndexDigest,
    "candidate qualification OCI index digest",
  );
  assertSha256(
    input.identities.ociPlatformManifestDigest,
    "candidate qualification OCI platform-manifest digest",
  );
  assertSha256(
    input.identities.microsandboxManifestDigest,
    "candidate qualification Microsandbox digest",
  );
  const candidateReference = firstPartyMicrosandboxImageCandidateReference(
    input.physicalImageId,
    input.identities.microsandboxManifestDigest,
  );
  if (input.candidateReference !== candidateReference) {
    throw new TypeError(
      "Candidate qualification candidateReference is not casys/first-party-candidate-<physicalImageId>@sha256:<recorded Microsandbox digest>.",
    );
  }
  const observedHost = await rebuildObservedLinuxArm64Host(input.observedHost);
  const receiptFingerprint = contentFingerprint(
    input.receiptFingerprint,
    "candidate qualification receipt fingerprint",
  );
  return Object.freeze({
    schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_RECORD_SCHEMA,
    kind: "candidate-qualification" as const,
    physicalImageId: input.physicalImageId,
    importRecord: Object.freeze({
      fingerprint: input.importRecordFingerprint,
      schemaVersion: FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_SCHEMA,
    }),
    identities: Object.freeze({
      ociIndexDigest: input.identities.ociIndexDigest,
      ociPlatformManifestDigest: input.identities.ociPlatformManifestDigest,
      microsandboxManifestDigest: input.identities.microsandboxManifestDigest,
    }),
    candidateReference,
    observedHost,
    execution: Object.freeze({
      runId: requiredRunId(input.runId),
      receiptFingerprint,
    }),
    runtimeQualification: "passed" as const,
    eligibleForPromotion: false as const,
    evidence: "host-runtime-only" as const,
    engineeringLevels: Object.freeze({
      l3: false as const,
      l4: false as const,
      l5: false as const,
    }),
  });
}

async function rebuildObservedLinuxArm64Host(
  observedHost: Pick<
    CapabilityRuntimeHostObservation,
    "identityFingerprint" | "platform"
  >,
): Promise<
  CapabilityRuntimeObservedHost & { readonly platform: "linux/arm64" }
> {
  requiredLinuxArm64(observedHost.platform);
  const identityFingerprint = contentFingerprint(
    observedHost.identityFingerprint,
    "candidate qualification observed host identity",
  );
  return Object.freeze({
    identityFingerprint,
    platform: "linux/arm64" as const,
    fingerprint: await fingerprintCapabilityRuntimeObservedHost(
      "linux/arm64",
      identityFingerprint,
    ),
  });
}

function parseFlags(
  values: readonly string[],
  usage: string,
): ReadonlyMap<string, string | true> {
  const result = new Map<string, string | true>();
  for (const value of values) {
    if (!value.startsWith("--")) {
      throw new TypeError(
        `Unsupported first-party candidate qualification argument ${value}.\n${usage}`,
      );
    }
    const [name, ...rest] = value.slice(2).split("=");
    if (!name || result.has(name)) {
      throw new TypeError(
        `Invalid repeated first-party candidate qualification flag ${value}.`,
      );
    }
    if (FORBIDDEN_FLAG_PATTERN.test(name) && name !== "import-record") {
      throw new TypeError(
        `--${name} is refused: candidate qualification does not accept provider, image, digest, platform, command, endpoint, tool, or worker inputs.\n${usage}`,
      );
    }
    result.set(name, rest.length === 0 ? true : rest.join("="));
  }
  return result;
}

function assertSha256(value: string, label: string): void {
  if (!SHA256.test(value)) {
    throw new TypeError(`${label} must be an exact lowercase sha256 digest.`);
  }
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

function requiredRunId(value: unknown): string {
  const runId = requiredString(value, "candidate qualification runId");
  if (/[\r\n\0]/.test(runId)) {
    throw new TypeError("Candidate qualification runId must be a single line.");
  }
  return runId;
}

function requiredLinuxArm64(value: unknown): "linux/arm64" {
  if (value !== "linux/arm64") {
    throw new TypeError(
      "Candidate qualification requires authoritative linux/arm64 host observation.",
    );
  }
  return value;
}

function contentFingerprint(value: unknown, label: string): ContentFingerprint {
  const root = jsonObject(value, label);
  if (root.algorithm !== "sha256") {
    throw new TypeError(`${label} algorithm must be sha256.`);
  }
  const digest = requiredString(root.digest, `${label} digest`);
  if (!SHA256_DIGEST.test(digest)) {
    throw new TypeError(`${label} digest must be an exact lowercase sha256 digest.`);
  }
  return Object.freeze({ algorithm: "sha256" as const, digest });
}
