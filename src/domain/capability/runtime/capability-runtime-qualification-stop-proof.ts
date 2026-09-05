/**
 * Terminal proof for one private runtime-qualification attempt.
 *
 * Chrono owns the host-journal variant.  Fixed isolated workers do not start
 * a Compose group, so they must record the independent broker destruction
 * proof rather than manufacture a host journal entry.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA,
  type CapabilityRuntimeQualificationHostStopProof,
  validateCapabilityRuntimeQualificationHostStopProof,
} from "./capability-runtime-qualification-host-proof.ts";

export const CAPABILITY_RUNTIME_QUALIFICATION_ISOLATED_DESTRUCTION_PROOF_SCHEMA =
  "capability-runtime-qualification-isolated-destruction-proof/1.0" as const;

export interface CapabilityRuntimeQualificationIsolatedDestructionProof {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_QUALIFICATION_ISOLATED_DESTRUCTION_PROOF_SCHEMA;
  readonly runId: string;
  readonly producerGeneration: 0;
  /** Null when an exact unpublished run was destroyed without a receipt. */
  readonly receiptFingerprint: ContentFingerprint | null;
  readonly destruction: {
    readonly status: "proven";
    readonly runId: string;
    readonly proofFingerprint: ContentFingerprint;
  };
  readonly fingerprint: ContentFingerprint;
}

export type CapabilityRuntimeQualificationStopProof =
  | CapabilityRuntimeQualificationHostStopProof
  | CapabilityRuntimeQualificationIsolatedDestructionProof;

export async function createCapabilityRuntimeQualificationIsolatedDestructionProof(
  input: Omit<
    CapabilityRuntimeQualificationIsolatedDestructionProof,
    "schemaVersion" | "fingerprint"
  >,
): Promise<CapabilityRuntimeQualificationIsolatedDestructionProof> {
  const body = isolatedDestructionProofBody(input);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeQualificationStopProof(
  value: unknown,
  path = "$capabilityRuntimeQualificationStopProof",
): Promise<CapabilityRuntimeQualificationStopProof> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  if (schemaVersion === CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA) {
    return await validateCapabilityRuntimeQualificationHostStopProof(value, path);
  }
  if (
    schemaVersion !==
      CAPABILITY_RUNTIME_QUALIFICATION_ISOLATED_DESTRUCTION_PROOF_SCHEMA
  ) {
    throw new TypeError(`${path}.schemaVersion is unsupported.`);
  }
  const root = exactRecord(value, [
    "schemaVersion",
    "runId",
    "producerGeneration",
    "receiptFingerprint",
    "destruction",
    "fingerprint",
  ], path);
  const body = isolatedDestructionProofBody({
    runId: root.runId,
    producerGeneration: root.producerGeneration,
    receiptFingerprint: root.receiptFingerprint,
    destruction: root.destruction,
  }, path);
  const fingerprint = contentFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(`${path}.fingerprint is not canonical.`);
  }
  return deepFreeze({ ...body, fingerprint });
}

function isolatedDestructionProofBody(
  value: unknown,
  path = "$capabilityRuntimeQualificationIsolatedDestructionProof",
): Omit<CapabilityRuntimeQualificationIsolatedDestructionProof, "fingerprint"> {
  const root = exactRecord(value, [
    "runId",
    "producerGeneration",
    "receiptFingerprint",
    "destruction",
  ], path);
  if (root.producerGeneration !== 0) {
    throw new TypeError(`${path}.producerGeneration must equal 0.`);
  }
  const runId = safeId(root.runId, `${path}.runId`);
  const destruction = exactRecord(
    root.destruction,
    ["status", "runId", "proofFingerprint"],
    `${path}.destruction`,
  );
  literalValue(destruction.status, "proven", `${path}.destruction.status`);
  if (safeId(destruction.runId, `${path}.destruction.runId`) !== runId) {
    throw new TypeError(`${path}.destruction.runId must equal ${path}.runId.`);
  }
  return {
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_ISOLATED_DESTRUCTION_PROOF_SCHEMA,
    runId,
    producerGeneration: 0,
    receiptFingerprint: root.receiptFingerprint === null
      ? null
      : contentFingerprint(root.receiptFingerprint, `${path}.receiptFingerprint`),
    destruction: {
      status: "proven",
      runId,
      proofFingerprint: contentFingerprint(
        destruction.proofFingerprint,
        `${path}.destruction.proofFingerprint`,
      ),
    },
  };
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !/^[a-f0-9]{64}$/.test(root.digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest: root.digest });
}
