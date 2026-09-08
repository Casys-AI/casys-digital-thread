/**
 * Closed proof that H1 cleaned one exact terminal failed qualification start.
 *
 * This is not a qualification start proof and can never support provider
 * dispatch or an attestation. It binds the failed start journal fact to one
 * exact succeeded runtime-stop fact for the same reserved owner and group.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID,
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  validateCapabilityRuntimeJournalEntry,
  validateCapabilityRuntimeJournalOutcome,
} from "./capability-runtime-supervision.ts";

export const CAPABILITY_RUNTIME_QUALIFICATION_FAILED_START_CLEANUP_PROOF_SCHEMA =
  "capability-runtime-qualification-failed-start-cleanup-proof/1.0" as const;

export interface CapabilityRuntimeQualificationFailedStartCleanupProof {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_QUALIFICATION_FAILED_START_CLEANUP_PROOF_SCHEMA;
  readonly startJournalEntry: CapabilityRuntimeJournalEntry;
  readonly startOutcome: CapabilityRuntimeJournalOutcome;
  readonly cleanupJournalEntry: CapabilityRuntimeJournalEntry;
  readonly cleanupOutcome: CapabilityRuntimeJournalOutcome | null;
  readonly convergence:
    | "host-outcome-succeeded"
    | "observed-all-inactive-after-exact-intent";
  readonly observations: CapabilityRuntimeJournalOutcome["observations"];
  readonly observedAt: string;
  readonly fingerprint: ContentFingerprint;
}

type ProofInput = Omit<
  CapabilityRuntimeQualificationFailedStartCleanupProof,
  "fingerprint"
>;

export async function createCapabilityRuntimeQualificationFailedStartCleanupProof(
  value: ProofInput,
): Promise<CapabilityRuntimeQualificationFailedStartCleanupProof> {
  const body = await proofBody(value);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeQualificationFailedStartCleanupProof(
  value: unknown,
  path = "$capabilityRuntimeQualificationFailedStartCleanupProof",
): Promise<CapabilityRuntimeQualificationFailedStartCleanupProof> {
  const root = exactRecord(value, [
    "schemaVersion",
    "startJournalEntry",
    "startOutcome",
    "cleanupJournalEntry",
    "cleanupOutcome",
    "convergence",
    "observations",
    "observedAt",
    "fingerprint",
  ], path);
  const body = await proofBody({
    schemaVersion: root.schemaVersion as ProofInput["schemaVersion"],
    startJournalEntry: root.startJournalEntry as ProofInput["startJournalEntry"],
    startOutcome: root.startOutcome as ProofInput["startOutcome"],
    cleanupJournalEntry: root.cleanupJournalEntry as ProofInput["cleanupJournalEntry"],
    cleanupOutcome: root.cleanupOutcome as ProofInput["cleanupOutcome"],
    convergence: root.convergence as ProofInput["convergence"],
    observations: root.observations as ProofInput["observations"],
    observedAt: root.observedAt as ProofInput["observedAt"],
  }, path);
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(expected, fingerprint)) {
    throw new TypeError(`${path}.fingerprint is not canonical.`);
  }
  return deepFreeze({ ...body, fingerprint });
}

export function canonicalCapabilityRuntimeQualificationFailedStartCleanupProofText(
  value: unknown,
): Promise<string> {
  return validateCapabilityRuntimeQualificationFailedStartCleanupProof(value).then(
    deterministicJson,
  );
}

async function proofBody(
  value: ProofInput,
  path = "$capabilityRuntimeQualificationFailedStartCleanupProof",
): Promise<ProofInput> {
  const root = exactRecord(value, [
    "schemaVersion",
    "startJournalEntry",
    "startOutcome",
    "cleanupJournalEntry",
    "cleanupOutcome",
    "convergence",
    "observations",
    "observedAt",
  ], path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_QUALIFICATION_FAILED_START_CLEANUP_PROOF_SCHEMA,
    `${path}.schemaVersion`,
  );
  if (
    root.convergence !== "host-outcome-succeeded" &&
    root.convergence !== "observed-all-inactive-after-exact-intent"
  ) {
    throw new TypeError(`${path}.convergence is unsupported.`);
  }
  const startJournalEntry = await validateCapabilityRuntimeJournalEntry(
    root.startJournalEntry,
  );
  const startOutcome = validateCapabilityRuntimeJournalOutcome(root.startOutcome);
  const cleanupJournalEntry = await validateCapabilityRuntimeJournalEntry(
    root.cleanupJournalEntry,
  );
  const cleanupOutcome = root.cleanupOutcome === null
    ? null
    : validateCapabilityRuntimeJournalOutcome(root.cleanupOutcome);
  const observedAt = timestamp(root.observedAt, `${path}.observedAt`);
  const observations = validateCapabilityRuntimeJournalOutcome({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
    journalEntryId: cleanupJournalEntry.id,
    recordedAt: observedAt,
    status: "uncertain",
    observations: root.observations,
    detail: "failed-start-cleanup-proof-observation-vector",
  }).observations;
  if (
    startJournalEntry.action !== "runtime-qualification-start" ||
    startJournalEntry.projectId !==
      CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID ||
    startOutcome.journalEntryId !== startJournalEntry.id ||
    startOutcome.status !== "failed"
  ) {
    throw new TypeError(`${path} requires one exact terminal failed start.`);
  }
  if (
    cleanupJournalEntry.action !== "runtime-stop" ||
    cleanupJournalEntry.projectId !==
      CAPABILITY_RUNTIME_QUALIFICATION_SYSTEM_PROJECT_ID ||
    (cleanupOutcome !== null &&
      cleanupOutcome.journalEntryId !== cleanupJournalEntry.id)
  ) {
    throw new TypeError(`${path} requires one exact cleanup stop intent.`);
  }
  if (
    deterministicJson(startJournalEntry.launchGroup) !==
      deterministicJson(cleanupJournalEntry.launchGroup) ||
    deterministicJson(startJournalEntry.materials) !==
      deterministicJson(cleanupJournalEntry.materials) ||
    cleanupJournalEntry.plannedAt !== startJournalEntry.plannedAt ||
    cleanupJournalEntry.effectiveRuntimeProjection !== null ||
    cleanupJournalEntry.qualificationStartAuthority !== null ||
    cleanupJournalEntry.administrativeRemovalPlanFingerprint !== null
  ) {
    throw new TypeError(`${path} cleanup stop does not bind the failed start.`);
  }
  if (
    observations.length !== cleanupJournalEntry.materials.length ||
    observations.some((observation, index) =>
      deterministicJson(observation.material) !==
        deterministicJson(cleanupJournalEntry.materials[index]) ||
      observation.state === null || observation.state.runtime !== "inactive"
    )
  ) {
    throw new TypeError(`${path} cleanup outcome is not the exact inactive group.`);
  }
  const outcomeIsExactInactive = cleanupOutcome !== null &&
    cleanupOutcome.status === "succeeded" &&
    cleanupOutcome.observations.length === cleanupJournalEntry.materials.length &&
    cleanupOutcome.observations.every((observation, index) =>
      deterministicJson(observation.material) ===
        deterministicJson(cleanupJournalEntry.materials[index]) &&
      observation.state !== null && observation.state.runtime === "inactive"
    );
  if (root.convergence === "host-outcome-succeeded") {
    if (
      !outcomeIsExactInactive ||
      deterministicJson(observations) !==
        deterministicJson(cleanupOutcome!.observations)
    ) {
      throw new TypeError(
        `${path} host-outcome convergence contradicts its cleanup outcome.`,
      );
    }
  } else if (outcomeIsExactInactive) {
    throw new TypeError(
      `${path} observed convergence contradicts its exact cleanup outcome.`,
    );
  }
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_FAILED_START_CLEANUP_PROOF_SCHEMA,
    startJournalEntry,
    startOutcome,
    cleanupJournalEntry,
    cleanupOutcome,
    convergence: root.convergence,
    observations,
    observedAt,
  });
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be exact ISO timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new TypeError(`${path} must be exact ISO timestamp.`);
  }
  return value;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !/^[a-f0-9]{64}$/.test(root.digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest: root.digest });
}
