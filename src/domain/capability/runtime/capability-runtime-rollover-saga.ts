/**
 * Immutable, fail-closed state for replacing one concrete runtime unit with
 * another. This is deliberately not a Docker plan: it records only the exact
 * identities, preservation obligations and observed transition evidence that
 * a future application service must honour.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyArray,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  type CapabilityRuntimeLaunchGroupReference,
  validateCapabilityRuntimeLaunchGroupReference,
} from "./capability-runtime-launch-group.ts";

export const CAPABILITY_RUNTIME_ROLLOVER_SAGA_SCHEMA =
  "capability-runtime-rollover-saga/1.0" as const;

export interface CapabilityRuntimeRolloverRuntimeReference {
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
  readonly unit: {
    readonly id: string;
    readonly version: string;
    readonly manifestFingerprint: ContentFingerprint;
  };
}

export interface CapabilityRuntimeRolloverAffectedProject {
  readonly projectId: string;
  readonly ledgerRevision: number;
  /** Exact predecessor ledger revision to which the successor must append. */
  readonly ledgerFingerprint: ContentFingerprint;
  readonly proposalFingerprint: ContentFingerprint;
}

/** A retained authority surface. The service must preserve every listed one. */
export interface CapabilityRuntimeRolloverPreservationSet {
  readonly thread: "preserve";
  readonly cas: "preserve";
  readonly wal: "preserve";
  readonly project: "preserve";
  readonly volumes: readonly { readonly id: string; readonly action: "preserve" }[];
}

/**
 * The code-owned transition id names this exact migration. A retry that tries
 * to quietly replace its predecessor or successor collides in the same
 * append-only history and is rejected rather than changing authority.
 */
export interface CapabilityRuntimeRolloverIdentity {
  /** Code-owned explicit migration identity; permits a later rollback saga. */
  readonly transitionId: string;
  /**
   * Server-selected instant at which the successor ledger amendment is
   * authorized.  It is carried by the prepared identity so a resumed saga
   * never rewrites history with a fresh clock value.
   */
  readonly authorizedAt: string;
  readonly predecessor: CapabilityRuntimeRolloverRuntimeReference;
  readonly successor: CapabilityRuntimeRolloverRuntimeReference;
  readonly affectedProjects: readonly CapabilityRuntimeRolloverAffectedProject[];
  readonly preserved: CapabilityRuntimeRolloverPreservationSet;
}

export interface CapabilityRuntimeRolloverKey {
  readonly transitionId: string;
}

export type CapabilityRuntimeRolloverPhase =
  | "intent-recorded"
  | "successor-material-observed"
  | "successor-runtime-observed"
  | "project-amendment-recorded"
  | "successor-lock-recorded"
  | "completed"
  | "recovery-required";

export interface CapabilityRuntimeRolloverSaga {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_ROLLOVER_SAGA_SCHEMA;
  readonly identity: CapabilityRuntimeRolloverIdentity;
  readonly phase: CapabilityRuntimeRolloverPhase;
  /** Present only for one exact project amendment transition. */
  readonly projectId?: string;
  /** Present only when a factual recovery gate finds a hybrid or foreign state. */
  readonly recoveryState?: "hybrid" | "foreign";
  /** Terminal result, deliberately distinct from a provider health status. */
  readonly outcome?: "completed" | "failed";
  /** Fingerprint of the identity for prepared, then the prior event. */
  readonly previousFingerprint: ContentFingerprint;
  /** Exact observed receipt/proof for this phase; no textual status is enough. */
  readonly evidenceFingerprint: ContentFingerprint;
  /** SHA-256 of this event body, excluding this field. */
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeRolloverAdvanceInput {
  readonly phase: Exclude<CapabilityRuntimeRolloverPhase, "intent-recorded">;
  readonly evidenceFingerprint: ContentFingerprint;
  readonly projectId?: string;
  readonly recoveryState?: "hybrid" | "foreign";
}

export class CapabilityRuntimeRolloverSagaIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeRolloverSagaIntegrityError";
  }
}

export function validateCapabilityRuntimeRolloverIdentity(
  value: unknown,
  path = "$capabilityRuntimeRolloverIdentity",
): CapabilityRuntimeRolloverIdentity {
  const root = exactRecord(value, [
    "transitionId",
    "authorizedAt",
    "predecessor",
    "successor",
    "affectedProjects",
    "preserved",
  ], path);
  const predecessor = runtimeReference(root.predecessor, `${path}.predecessor`);
  const successor = runtimeReference(root.successor, `${path}.successor`);
  if (deterministicJson(predecessor) === deterministicJson(successor)) {
    throw integrity(`${path} successor must differ from predecessor.`);
  }
  // A purely administrative rollover can have no authorized project ledger.
  // In that case the phase machine advances from runtime observation directly
  // to successor-lock recording; it never invents an amendment.
  const affectedProjects = arrayOf(
    root.affectedProjects,
    `${path}.affectedProjects`,
  ).map((project, index) =>
    affectedProject(project, `${path}.affectedProjects[${index}]`)
  );
  rejectDuplicates(
    affectedProjects.map((project) => project.projectId),
    `${path}.affectedProjects.projectId`,
  );
  assertLexicallySorted(
    affectedProjects.map((project) => project.projectId),
    `${path}.affectedProjects`,
  );
  return freeze({
    transitionId: safeId(root.transitionId, `${path}.transitionId`),
    authorizedAt: timestamp(root.authorizedAt, `${path}.authorizedAt`),
    predecessor,
    successor,
    affectedProjects,
    preserved: preservationSet(root.preserved, `${path}.preserved`),
  });
}

export function validateCapabilityRuntimeRolloverKey(
  value: unknown,
): CapabilityRuntimeRolloverKey {
  const root = exactRecord(value, ["transitionId"], "$capabilityRuntimeRolloverKey");
  return freeze({
    transitionId: safeId(
      root.transitionId,
      "$capabilityRuntimeRolloverKey.transitionId",
    ),
  });
}

export function capabilityRuntimeRolloverKeyFor(
  identity: CapabilityRuntimeRolloverIdentity,
): CapabilityRuntimeRolloverKey {
  const valid = validateCapabilityRuntimeRolloverIdentity(identity);
  return freeze({ transitionId: valid.transitionId });
}

export function assertCapabilityRuntimeRolloverIdentity(
  saga: CapabilityRuntimeRolloverSaga,
  identity: CapabilityRuntimeRolloverIdentity,
): void {
  if (
    deterministicJson(saga.identity) !==
      deterministicJson(validateCapabilityRuntimeRolloverIdentity(identity))
  ) {
    throw integrity(
      "Capability runtime rollover identity conflicts with its durable history.",
    );
  }
}

export function assertCapabilityRuntimeRolloverKey(
  saga: CapabilityRuntimeRolloverSaga,
  key: CapabilityRuntimeRolloverKey,
): void {
  if (
    saga.identity.transitionId !==
      validateCapabilityRuntimeRolloverKey(key).transitionId
  ) {
    throw integrity("Capability runtime rollover key does not match its durable body.");
  }
}

export async function capabilityRuntimeRolloverStorageKey(
  value: CapabilityRuntimeRolloverKey,
): Promise<string> {
  return await sha256Hex(
    new TextEncoder().encode(
      deterministicJson(validateCapabilityRuntimeRolloverKey(value)),
    ),
  );
}

export async function fingerprintCapabilityRuntimeRolloverIdentity(
  value: CapabilityRuntimeRolloverIdentity,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateCapabilityRuntimeRolloverIdentity(value));
}

export async function validateCapabilityRuntimeRolloverSaga(
  value: unknown,
  path = "$capabilityRuntimeRolloverSaga",
): Promise<CapabilityRuntimeRolloverSaga> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw integrity(`${path} must be an object.`);
  }
  const root = exactRecord(value, eventFields(value), path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_ROLLOVER_SAGA_SCHEMA,
    `${path}.schemaVersion`,
  );
  const identity = validateCapabilityRuntimeRolloverIdentity(
    root.identity,
    `${path}.identity`,
  );
  const phase = rolloverPhase(root.phase, `${path}.phase`);
  const projectId = phase === "project-amendment-recorded"
    ? safeId(root.projectId, `${path}.projectId`)
    : undefined;
  if (
    projectId &&
    !identity.affectedProjects.some((project) => project.projectId === projectId)
  ) {
    throw integrity(
      `${path}.projectId is not in the rollover's affected project ledger set.`,
    );
  }
  const recoveryState = phase === "recovery-required"
    ? recoveryClassification(root.recoveryState, `${path}.recoveryState`)
    : undefined;
  const outcome = phase === "completed"
    ? completedOutcome(root.outcome, `${path}.outcome`)
    : phase === "recovery-required"
    ? failedOutcome(root.outcome, `${path}.outcome`)
    : undefined;
  const withoutFingerprint = {
    schemaVersion: CAPABILITY_RUNTIME_ROLLOVER_SAGA_SCHEMA,
    identity,
    phase,
    previousFingerprint: fingerprint(
      root.previousFingerprint,
      `${path}.previousFingerprint`,
    ),
    evidenceFingerprint: fingerprint(
      root.evidenceFingerprint,
      `${path}.evidenceFingerprint`,
    ),
    ...(projectId === undefined ? {} : { projectId }),
    ...(recoveryState === undefined ? {} : { recoveryState }),
    ...(outcome === undefined ? {} : { outcome }),
  } as const;
  const expected = await sha256Fingerprint(withoutFingerprint);
  const provided = fingerprint(root.fingerprint, `${path}.fingerprint`);
  if (!fingerprintsEqual(expected, provided)) {
    throw integrity(`${path}.fingerprint does not match its exact canonical body.`);
  }
  return freeze({ ...withoutFingerprint, fingerprint: provided });
}

export async function canonicalCapabilityRuntimeRolloverSagaText(
  value: unknown,
): Promise<string> {
  return deterministicJson(await validateCapabilityRuntimeRolloverSaga(value));
}

export async function capabilityRuntimeRolloverEventFileName(
  value: CapabilityRuntimeRolloverSaga,
): Promise<string> {
  const saga = await validateCapabilityRuntimeRolloverSaga(value);
  return `event-${saga.phase}-${saga.fingerprint.digest}.json`;
}

export async function prepareCapabilityRuntimeRolloverSaga(
  value: CapabilityRuntimeRolloverIdentity,
  current: CapabilityRuntimeRolloverSaga | undefined,
): Promise<CapabilityRuntimeRolloverSaga> {
  const identity = validateCapabilityRuntimeRolloverIdentity(value);
  if (current) {
    assertCapabilityRuntimeRolloverIdentity(current, identity);
    return current;
  }
  const identityFingerprint = await fingerprintCapabilityRuntimeRolloverIdentity(
    identity,
  );
  return await event(
    identity,
    "intent-recorded",
    identityFingerprint,
    identityFingerprint,
  );
}

/**
 * Only the next monotone phase may be appended. Repeating an exact command
 * returns the already recorded event; changing its proof fails closed.
 */
export async function advanceCapabilityRuntimeRolloverSaga(
  current: CapabilityRuntimeRolloverSaga,
  input: CapabilityRuntimeRolloverAdvanceInput,
): Promise<CapabilityRuntimeRolloverSaga> {
  const valid = await validateCapabilityRuntimeRolloverSaga(current);
  const phase = rolloverPhase(input.phase, "$capabilityRuntimeRolloverAdvance.phase");
  if (phase === "intent-recorded") {
    throw integrity("Rollover intent cannot be appended twice.");
  }
  const evidenceFingerprint = fingerprint(
    input.evidenceFingerprint,
    "$capabilityRuntimeRolloverAdvance.evidenceFingerprint",
  );
  if (
    valid.phase === phase && valid.projectId === input.projectId &&
    valid.recoveryState === input.recoveryState
  ) {
    if (!fingerprintsEqual(valid.evidenceFingerprint, evidenceFingerprint)) {
      throw integrity("Capability runtime rollover phase proof cannot be rewritten.");
    }
    return valid;
  }
  if (terminal(valid.phase)) {
    throw integrity("Capability runtime rollover terminal outcome cannot be advanced.");
  }
  if (phase !== "recovery-required" && !isExpectedNext(valid, phase, input.projectId)) {
    throw integrity(
      "Capability runtime rollover phase cannot skip a durable predecessor.",
    );
  }
  return await event(valid.identity, phase, valid.fingerprint, evidenceFingerprint, {
    projectId: input.projectId,
    recoveryState: input.recoveryState,
  });
}

/** Resolve an unordered set of immutable files by their fingerprint chain. */
export async function resolveCapabilityRuntimeRolloverSaga(
  events: readonly CapabilityRuntimeRolloverSaga[],
): Promise<CapabilityRuntimeRolloverSaga | undefined> {
  if (events.length === 0) return undefined;
  const valid = await Promise.all(
    events.map((event) => validateCapabilityRuntimeRolloverSaga(event)),
  );
  const prepared = valid.filter((event) => event.phase === "intent-recorded");
  if (prepared.length !== 1) {
    throw integrity(
      "Capability runtime rollover WAL must contain exactly one intent event.",
    );
  }
  const first = prepared[0]!;
  const identityFingerprint = await fingerprintCapabilityRuntimeRolloverIdentity(
    first.identity,
  );
  if (
    !fingerprintsEqual(first.previousFingerprint, identityFingerprint) ||
    !fingerprintsEqual(first.evidenceFingerprint, identityFingerprint)
  ) {
    throw integrity(
      "Capability runtime rollover intent must chain to its exact identity.",
    );
  }
  const remaining = new Map(valid.map((event) => [event.fingerprint.digest, event]));
  remaining.delete(first.fingerprint.digest);
  let current = first;
  while (remaining.size > 0) {
    const next = [...remaining.values()].filter((event) =>
      fingerprintsEqual(event.previousFingerprint, current.fingerprint)
    );
    if (next.length !== 1) {
      throw integrity(
        "Capability runtime rollover WAL has a fork, gap or unrelated event.",
      );
    }
    const candidate = next[0]!;
    assertCapabilityRuntimeRolloverIdentity(candidate, current.identity);
    if (candidate.phase === "intent-recorded") {
      throw integrity("Capability runtime rollover WAL has a duplicate intent event.");
    }
    current = await advanceCapabilityRuntimeRolloverSaga(current, {
      phase: candidate.phase,
      evidenceFingerprint: candidate.evidenceFingerprint,
      projectId: candidate.projectId,
      recoveryState: candidate.recoveryState,
    });
    if (!fingerprintsEqual(current.fingerprint, candidate.fingerprint)) {
      throw integrity(
        "Capability runtime rollover WAL event is not the canonical transition.",
      );
    }
    remaining.delete(candidate.fingerprint.digest);
  }
  return current;
}

function runtimeReference(
  value: unknown,
  path: string,
): CapabilityRuntimeRolloverRuntimeReference {
  const root = exactRecord(value, ["launchGroup", "unit"], path);
  const unit = exactRecord(
    root.unit,
    ["id", "version", "manifestFingerprint"],
    `${path}.unit`,
  );
  return freeze({
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      `${path}.launchGroup`,
    ),
    unit: freeze({
      id: safeId(unit.id, `${path}.unit.id`),
      version: exactVersionToken(unit.version, `${path}.unit.version`),
      manifestFingerprint: fingerprint(
        unit.manifestFingerprint,
        `${path}.unit.manifestFingerprint`,
      ),
    }),
  });
}

function affectedProject(
  value: unknown,
  path: string,
): CapabilityRuntimeRolloverAffectedProject {
  const root = exactRecord(value, [
    "projectId",
    "ledgerRevision",
    "ledgerFingerprint",
    "proposalFingerprint",
  ], path);
  return freeze({
    projectId: safeId(root.projectId, `${path}.projectId`),
    ledgerRevision: positiveInteger(root.ledgerRevision, `${path}.ledgerRevision`),
    ledgerFingerprint: fingerprint(
      root.ledgerFingerprint,
      `${path}.ledgerFingerprint`,
    ),
    proposalFingerprint: fingerprint(
      root.proposalFingerprint,
      `${path}.proposalFingerprint`,
    ),
  });
}

function preservationSet(
  value: unknown,
  path: string,
): CapabilityRuntimeRolloverPreservationSet {
  const root = exactRecord(value, ["thread", "cas", "wal", "project", "volumes"], path);
  const volumes = nonEmptyArray(root.volumes, `${path}.volumes`).map((value, index) => {
    const volume = exactRecord(value, ["id", "action"], `${path}.volumes[${index}]`);
    return freeze({
      id: safeId(volume.id, `${path}.volumes[${index}].id`),
      action: preserve(volume.action, `${path}.volumes[${index}].action`),
    });
  });
  rejectDuplicates(volumes.map((volume) => volume.id), `${path}.volumes.id`);
  assertLexicallySorted(volumes.map((volume) => volume.id), `${path}.volumes`);
  return freeze({
    thread: preserve(root.thread, `${path}.thread`),
    cas: preserve(root.cas, `${path}.cas`),
    wal: preserve(root.wal, `${path}.wal`),
    project: preserve(root.project, `${path}.project`),
    volumes,
  });
}

function preserve(value: unknown, path: string): "preserve" {
  if (value !== "preserve") throw integrity(`${path} must be literal preserve.`);
  return value;
}

function timestamp(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw integrity(`${path} must be an exact ISO timestamp.`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw integrity(`${path} must be an exact ISO timestamp.`);
  }
  return value;
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  if (typeof root.digest !== "string" || !/^[a-f0-9]{64}$/.test(root.digest)) {
    throw integrity(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return freeze({ algorithm: "sha256", digest: root.digest });
}

function rolloverPhase(value: unknown, path: string): CapabilityRuntimeRolloverPhase {
  if (
    value === "intent-recorded" || value === "successor-material-observed" ||
    value === "successor-runtime-observed" || value === "project-amendment-recorded" ||
    value === "successor-lock-recorded" || value === "completed" ||
    value === "recovery-required"
  ) {
    return value;
  }
  throw integrity(`${path} is not a supported rollover phase.`);
}

function isExpectedNext(
  current: CapabilityRuntimeRolloverSaga,
  phase: CapabilityRuntimeRolloverPhase,
  projectId: string | undefined,
): boolean {
  if (current.phase === "intent-recorded") {
    return phase === "successor-material-observed";
  }
  if (current.phase === "successor-material-observed") {
    return phase === "successor-runtime-observed";
  }
  if (current.phase === "successor-runtime-observed") {
    const firstProject = current.identity.affectedProjects[0];
    return firstProject
      ? phase === "project-amendment-recorded" && projectId === firstProject.projectId
      : phase === "successor-lock-recorded";
  }
  if (current.phase === "project-amendment-recorded") {
    const index = current.identity.affectedProjects.findIndex((project) =>
      project.projectId === current.projectId
    );
    const nextProject = current.identity.affectedProjects[index + 1];
    return nextProject
      ? phase === "project-amendment-recorded" && projectId === nextProject.projectId
      : phase === "successor-lock-recorded";
  }
  if (current.phase === "successor-lock-recorded") return phase === "completed";
  return false;
}

function terminal(phase: CapabilityRuntimeRolloverPhase): boolean {
  return phase === "completed" || phase === "recovery-required";
}

async function event(
  identity: CapabilityRuntimeRolloverIdentity,
  phase: CapabilityRuntimeRolloverPhase,
  previousFingerprint: ContentFingerprint,
  evidenceFingerprint: ContentFingerprint,
  detail: {
    readonly projectId?: string;
    readonly recoveryState?: "hybrid" | "foreign";
  } = {},
): Promise<CapabilityRuntimeRolloverSaga> {
  if (phase === "project-amendment-recorded" && detail.projectId === undefined) {
    throw integrity(
      "Project amendment transition needs one exact affected project id.",
    );
  }
  if (phase !== "project-amendment-recorded" && detail.projectId !== undefined) {
    throw integrity("Only a project amendment transition may name a project id.");
  }
  if (phase === "recovery-required" && detail.recoveryState === undefined) {
    throw integrity(
      "Recovery-required transition needs hybrid or foreign classification.",
    );
  }
  if (phase !== "recovery-required" && detail.recoveryState !== undefined) {
    throw integrity(
      "Only a recovery-required transition may name recovery classification.",
    );
  }
  const body = freeze({
    schemaVersion: CAPABILITY_RUNTIME_ROLLOVER_SAGA_SCHEMA,
    identity: validateCapabilityRuntimeRolloverIdentity(identity),
    phase,
    previousFingerprint: fingerprint(previousFingerprint, "$previousFingerprint"),
    evidenceFingerprint: fingerprint(evidenceFingerprint, "$evidenceFingerprint"),
    ...(detail.projectId === undefined
      ? {}
      : { projectId: safeId(detail.projectId, "$projectId") }),
    ...(detail.recoveryState === undefined
      ? {}
      : { recoveryState: detail.recoveryState }),
    ...(phase === "completed" ? { outcome: "completed" as const } : {}),
    ...(phase === "recovery-required" ? { outcome: "failed" as const } : {}),
  });
  return freeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

function eventFields(value: unknown): readonly string[] {
  const phase = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).phase
    : undefined;
  const base = [
    "schemaVersion",
    "identity",
    "phase",
    "previousFingerprint",
    "evidenceFingerprint",
    "fingerprint",
  ];
  if (phase === "project-amendment-recorded") return [...base, "projectId"];
  if (phase === "recovery-required") return [...base, "recoveryState", "outcome"];
  if (phase === "completed") return [...base, "outcome"];
  return base;
}

function recoveryClassification(value: unknown, path: string): "hybrid" | "foreign" {
  if (value === "hybrid" || value === "foreign") return value;
  throw integrity(`${path} must be hybrid or foreign.`);
}

function completedOutcome(value: unknown, path: string): "completed" {
  if (value !== "completed") throw integrity(`${path} must be completed.`);
  return value;
}

function failedOutcome(value: unknown, path: string): "failed" {
  if (value !== "failed") throw integrity(`${path} must be failed.`);
  return value;
}

function assertLexicallySorted(values: readonly string[], path: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1]!.localeCompare(values[index]!) >= 0) {
      throw integrity(`${path} must be strictly sorted by stable id.`);
    }
  }
}

function freeze<T>(value: T): T {
  return deepFreeze(value);
}

function integrity(message: string): CapabilityRuntimeRolloverSagaIntegrityError {
  return new CapabilityRuntimeRolloverSagaIntegrityError(message);
}
