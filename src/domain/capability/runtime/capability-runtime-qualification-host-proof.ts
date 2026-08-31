/**
 * Closed host qualification stop proof. It is a private WAL value object, not
 * a Docker payload, MCP grant or engineering verdict.
 */

import { deepFreeze, exactRecord, literalValue } from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type CapabilityRuntimeJournalEntry,
  type CapabilityRuntimeJournalOutcome,
  validateCapabilityRuntimeJournalEntry,
  validateCapabilityRuntimeJournalOutcome,
} from "./capability-runtime-supervision.ts";

export const CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA =
  "capability-runtime-qualification-host-stop-proof/1.0" as const;

export type CapabilityRuntimeQualificationHostStopConvergence =
  | "host-outcome-succeeded"
  | "observed-all-inactive-after-exact-intent";

export interface CapabilityRuntimeQualificationHostStopProof {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA;
  readonly journalEntry: CapabilityRuntimeJournalEntry;
  readonly outcome: CapabilityRuntimeJournalOutcome | null;
  readonly convergence: CapabilityRuntimeQualificationHostStopConvergence;
  readonly observations: CapabilityRuntimeJournalOutcome["observations"];
  readonly observedAt: string;
  readonly startProofFingerprint: ContentFingerprint;
  readonly fingerprint: ContentFingerprint;
}

export type CapabilityRuntimeQualificationHostStopProofInput = Omit<
  CapabilityRuntimeQualificationHostStopProof,
  "fingerprint"
>;

export async function createCapabilityRuntimeQualificationHostStopProof(
  value: CapabilityRuntimeQualificationHostStopProofInput,
): Promise<CapabilityRuntimeQualificationHostStopProof> {
  const body = await stopProofBody(value);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeQualificationHostStopProof(
  value: unknown,
  path = "$capabilityRuntimeQualificationHostStopProof",
): Promise<CapabilityRuntimeQualificationHostStopProof> {
  const root = exactRecord(value, [
    "schemaVersion",
    "journalEntry",
    "outcome",
    "convergence",
    "observations",
    "observedAt",
    "startProofFingerprint",
    "fingerprint",
  ], path);
  const body = await stopProofBody({
    schemaVersion: root.schemaVersion,
    journalEntry: root.journalEntry,
    outcome: root.outcome,
    convergence: root.convergence,
    observations: root.observations,
    observedAt: root.observedAt,
    startProofFingerprint: root.startProofFingerprint,
  }, path);
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(expected, fingerprint)) {
    throw new TypeError(`${path}.fingerprint is not canonical.`);
  }
  return deepFreeze({ ...body, fingerprint });
}

async function stopProofBody(
  value: unknown,
  path = "$capabilityRuntimeQualificationHostStopProof",
): Promise<CapabilityRuntimeQualificationHostStopProofInput> {
  const root = exactRecord(value, [
    "schemaVersion",
    "journalEntry",
    "outcome",
    "convergence",
    "observations",
    "observedAt",
    "startProofFingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA,
    `${path}.schemaVersion`,
  );
  if (
    root.convergence !== "host-outcome-succeeded" &&
    root.convergence !== "observed-all-inactive-after-exact-intent"
  ) {
    throw new TypeError(`${path}.convergence is unsupported.`);
  }
  const journalEntry = await validateCapabilityRuntimeJournalEntry(
    root.journalEntry,
  );
  if (journalEntry.action !== "runtime-stop") {
    throw new TypeError(`${path}.journalEntry.action must be runtime-stop.`);
  }
  const outcome = root.outcome === null
    ? null
    : validateCapabilityRuntimeJournalOutcome(root.outcome);
  if (outcome && outcome.journalEntryId !== journalEntry.id) {
    throw new TypeError(`${path}.outcome does not bind the stop intent.`);
  }
  const observations = validateCapabilityRuntimeJournalOutcome({
    schemaVersion: "capability-runtime-host-mutation-outcome/1.0",
    journalEntryId: journalEntry.id,
    recordedAt: timestamp(root.observedAt, `${path}.observedAt`),
    status: "uncertain",
    observations: root.observations,
    detail: "proof-observation-vector",
  }).observations;
  return {
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_HOST_STOP_PROOF_SCHEMA,
    journalEntry,
    outcome,
    convergence: root.convergence,
    observations,
    observedAt: timestamp(root.observedAt, `${path}.observedAt`),
    startProofFingerprint: parseFingerprint(
      root.startProofFingerprint,
      `${path}.startProofFingerprint`,
    ),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = typeof root.digest === "string" ? root.digest : "";
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
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

export function canonicalCapabilityRuntimeQualificationHostStopProofText(
  value: unknown,
): Promise<string> {
  return validateCapabilityRuntimeQualificationHostStopProof(value).then(
    deterministicJson,
  );
}
