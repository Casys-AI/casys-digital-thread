/**
 * Pure value object, codec and monotone transition rules for the private
 * capability-runtime qualification WAL. File publication belongs in an
 * adapter; provider calls and host mutation belong in the application layer.
 */

import {
  type CapabilityRuntimeObservedHost,
  fingerprintCapabilityRuntimeObservedHost,
} from "./capability-runtime-binding-qualification-attestation.ts";
import {
  CAPABILITY_RUNTIME_QUALIFICATION_ISOLATED_DESTRUCTION_PROOF_SCHEMA,
  type CapabilityRuntimeQualificationStopProof,
  validateCapabilityRuntimeQualificationStopProof,
} from "./capability-runtime-qualification-stop-proof.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_SCHEMA =
  "capability-runtime-qualification-attempt/1.0" as const;

export const CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_OUTCOME_SCHEMA =
  "capability-runtime-qualification-attempt-outcome/1.0" as const;

const IDENTITY_FIELDS = [
  "candidate",
  "observedHost",
  "reviewFingerprint",
  "requestId",
  "sourceFingerprint",
  "loweringFingerprint",
  "caseFingerprint",
  "runRequestFingerprint",
  "qualificationSpecFingerprint",
] as const;

export interface CapabilityRuntimeQualificationAttemptIdentity {
  readonly candidate: { readonly id: string; readonly fingerprint: ContentFingerprint };
  readonly observedHost: CapabilityRuntimeObservedHost;
  readonly reviewFingerprint: ContentFingerprint;
  readonly requestId: string;
  readonly sourceFingerprint: ContentFingerprint;
  readonly loweringFingerprint: ContentFingerprint;
  readonly caseFingerprint: ContentFingerprint;
  readonly runRequestFingerprint: ContentFingerprint;
  readonly qualificationSpecFingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeQualificationAttemptKey {
  readonly candidateId: string;
  readonly candidateFingerprint: ContentFingerprint;
  readonly observedHostFingerprint: ContentFingerprint;
  readonly qualificationSpecFingerprint: ContentFingerprint;
}

type Base = CapabilityRuntimeQualificationAttemptIdentity & {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_SCHEMA;
  readonly preparedAt: string;
};
type Active = { readonly runtimeStartFingerprint: ContentFingerprint };
type Submitted = { readonly caseSha256: string; readonly caseUri: string };

export interface CapabilityRuntimeQualificationAttemptOutcome {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_OUTCOME_SCHEMA;
  readonly status: "qualified" | "failed" | "unavailable";
  readonly basis: "recorded" | "quarantined" | "pre-dispatch";
  /** Immutable time at which this exact outcome was first recorded. */
  readonly recordedAt: string;
  /** Exact receipt or quarantine-event fingerprint on which it is based. */
  readonly basisFingerprint: ContentFingerprint;
  /** SHA-256 of this outcome body, excluding this field. */
  readonly fingerprint: ContentFingerprint;
}

export type CapabilityRuntimeQualificationAttemptOutcomeInput = Omit<
  CapabilityRuntimeQualificationAttemptOutcome,
  "fingerprint"
>;

export type CapabilityRuntimeQualificationAttempt =
  | (Base & { readonly phase: "prepared" })
  | (Base & Active & { readonly phase: "active" })
  | (Base & Active & Submitted & { readonly phase: "case-submitted" })
  | (Base & Active & Submitted & {
    readonly phase: "dispatching";
    readonly claimedAt: string;
    readonly deadlineAt: string;
  })
  | (Base & Active & Submitted & {
    readonly phase: "recorded";
    readonly receiptSha256: string;
    readonly receiptFingerprint: ContentFingerprint;
  })
  | (Base & Active & Submitted & {
    readonly phase: "quarantined";
    readonly quarantineReason: "uncertain" | "absent" | "malformed";
    readonly claimedAt: string;
    readonly deadlineAt: string;
  })
  | (Base & Active & Submitted & {
    readonly phase: "outcome";
    readonly outcome: CapabilityRuntimeQualificationAttemptOutcome;
  })
  | (Base & Active & Submitted & {
    readonly phase: "stopped";
    readonly outcome: CapabilityRuntimeQualificationAttemptOutcome;
    readonly runtimeStopProof: CapabilityRuntimeQualificationStopProof;
  })
  | (Base & Active & Submitted & {
    readonly phase: "attested";
    readonly outcome: CapabilityRuntimeQualificationAttemptOutcome;
    readonly runtimeStopProof: CapabilityRuntimeQualificationStopProof;
    readonly attestationFingerprint: ContentFingerprint;
  });

export type CapabilityRuntimeQualificationDispatchingAttempt = Extract<
  CapabilityRuntimeQualificationAttempt,
  { readonly phase: "dispatching" }
>;

export class CapabilityRuntimeQualificationAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeQualificationAttemptIntegrityError";
  }
}

export async function validateCapabilityRuntimeQualificationAttemptIdentity(
  value: unknown,
  path = "$capabilityRuntimeQualificationAttemptIdentity",
): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
  const root = exactRecord(value, IDENTITY_FIELDS, path);
  const candidate = exactRecord(
    root.candidate,
    ["id", "fingerprint"],
    `${path}.candidate`,
  );
  return freeze({
    candidate: {
      id: safeId(candidate.id, `${path}.candidate.id`),
      fingerprint: fingerprint(candidate.fingerprint, `${path}.candidate.fingerprint`),
    },
    observedHost: await observedHost(root.observedHost, `${path}.observedHost`),
    requestId: safeId(root.requestId, `${path}.requestId`),
    reviewFingerprint: fingerprint(
      root.reviewFingerprint,
      `${path}.reviewFingerprint`,
    ),
    sourceFingerprint: fingerprint(root.sourceFingerprint, `${path}.sourceFingerprint`),
    loweringFingerprint: fingerprint(
      root.loweringFingerprint,
      `${path}.loweringFingerprint`,
    ),
    caseFingerprint: fingerprint(root.caseFingerprint, `${path}.caseFingerprint`),
    runRequestFingerprint: fingerprint(
      root.runRequestFingerprint,
      `${path}.runRequestFingerprint`,
    ),
    qualificationSpecFingerprint: fingerprint(
      root.qualificationSpecFingerprint,
      `${path}.qualificationSpecFingerprint`,
    ),
  });
}

export function validateCapabilityRuntimeQualificationAttemptKey(
  value: unknown,
): CapabilityRuntimeQualificationAttemptKey {
  const root = exactRecord(value, [
    "candidateId",
    "candidateFingerprint",
    "observedHostFingerprint",
    "qualificationSpecFingerprint",
  ], "$capabilityRuntimeQualificationAttemptKey");
  return freeze({
    candidateId: safeId(
      root.candidateId,
      "$capabilityRuntimeQualificationAttemptKey.candidateId",
    ),
    candidateFingerprint: fingerprint(
      root.candidateFingerprint,
      "$capabilityRuntimeQualificationAttemptKey.candidateFingerprint",
    ),
    observedHostFingerprint: fingerprint(
      root.observedHostFingerprint,
      "$capabilityRuntimeQualificationAttemptKey.observedHostFingerprint",
    ),
    qualificationSpecFingerprint: fingerprint(
      root.qualificationSpecFingerprint,
      "$capabilityRuntimeQualificationAttemptKey.qualificationSpecFingerprint",
    ),
  });
}

export function qualificationAttemptKeyFor(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): CapabilityRuntimeQualificationAttemptKey {
  return freeze({
    candidateId: identity.candidate.id,
    candidateFingerprint: identity.candidate.fingerprint,
    observedHostFingerprint: identity.observedHost.fingerprint,
    qualificationSpecFingerprint: identity.qualificationSpecFingerprint,
  });
}

export function assertQualificationAttemptKey(
  attempt: CapabilityRuntimeQualificationAttempt,
  key: CapabilityRuntimeQualificationAttemptKey,
): void {
  const expected = validateCapabilityRuntimeQualificationAttemptKey(key);
  if (
    attempt.candidate.id !== expected.candidateId ||
    !fingerprintsEqual(attempt.candidate.fingerprint, expected.candidateFingerprint) ||
    !fingerprintsEqual(
      attempt.observedHost.fingerprint,
      expected.observedHostFingerprint,
    ) ||
    !fingerprintsEqual(
      attempt.qualificationSpecFingerprint,
      expected.qualificationSpecFingerprint,
    )
  ) throw integrity("Qualification WAL key does not match its body.");
}

export async function capabilityRuntimeQualificationAttemptStorageKey(
  key: CapabilityRuntimeQualificationAttemptKey,
): Promise<string> {
  const valid = validateCapabilityRuntimeQualificationAttemptKey(key);
  return await sha256Hex(new TextEncoder().encode(deterministicJson(valid)));
}

export async function validateCapabilityRuntimeQualificationAttempt(
  value: unknown,
  path = "$capabilityRuntimeQualificationAttempt",
): Promise<CapabilityRuntimeQualificationAttempt> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw integrity(`${path} must be an object.`);
  }
  const phase = (value as Record<string, unknown>).phase;
  const root = exactRecord(value, fieldsFor(phase), path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_SCHEMA,
    `${path}.schemaVersion`,
  );
  const identity = await identityFields(root, path);
  const preparedAt = timestamp(root.preparedAt, `${path}.preparedAt`);
  if (phase === "prepared") {
    return freeze({ ...base(identity, preparedAt), phase });
  }
  const active = {
    runtimeStartFingerprint: fingerprint(
      root.runtimeStartFingerprint,
      `${path}.runtimeStartFingerprint`,
    ),
  };
  if (phase === "active") {
    return freeze({ ...base(identity, preparedAt), phase, ...active });
  }
  const submitted = submission(
    { caseSha256: root.caseSha256, caseUri: root.caseUri },
    identity.caseFingerprint,
    path,
  );
  if (phase === "case-submitted") {
    return freeze({ ...base(identity, preparedAt), phase, ...active, ...submitted });
  }
  if (phase === "dispatching") {
    return freeze({
      ...base(identity, preparedAt),
      phase,
      ...active,
      ...submitted,
      claimedAt: timestamp(root.claimedAt, `${path}.claimedAt`),
      deadlineAt: timestamp(root.deadlineAt, `${path}.deadlineAt`),
    });
  }
  if (phase === "recorded") {
    return freeze({
      ...base(identity, preparedAt),
      phase,
      ...active,
      ...submitted,
      receiptSha256: sha256(root.receiptSha256, `${path}.receiptSha256`),
      receiptFingerprint: fingerprint(
        root.receiptFingerprint,
        `${path}.receiptFingerprint`,
      ),
    });
  }
  if (phase === "quarantined") {
    return freeze({
      ...base(identity, preparedAt),
      phase,
      ...active,
      ...submitted,
      quarantineReason: quarantineReason(root.quarantineReason),
      claimedAt: timestamp(root.claimedAt, `${path}.claimedAt`),
      deadlineAt: timestamp(root.deadlineAt, `${path}.deadlineAt`),
    });
  }
  const outcome = await validateCapabilityRuntimeQualificationAttemptOutcome(
    root.outcome,
    `${path}.outcome`,
  );
  if (phase === "outcome") {
    return freeze({
      ...base(identity, preparedAt),
      phase,
      ...active,
      ...submitted,
      outcome,
    });
  }
  const runtimeStopProof = await validateCapabilityRuntimeQualificationStopProof(
    root.runtimeStopProof,
    `${path}.runtimeStopProof`,
  );
  if (phase === "stopped") {
    return freeze({
      ...base(identity, preparedAt),
      phase,
      ...active,
      ...submitted,
      outcome,
      runtimeStopProof,
    });
  }
  if (phase === "attested") {
    return freeze({
      ...base(identity, preparedAt),
      phase,
      ...active,
      ...submitted,
      outcome,
      runtimeStopProof,
      attestationFingerprint: fingerprint(
        root.attestationFingerprint,
        `${path}.attestationFingerprint`,
      ),
    });
  }
  throw integrity(`${path}.phase is unsupported.`);
}

export async function canonicalCapabilityRuntimeQualificationAttemptText(
  value: unknown,
): Promise<string> {
  return deterministicJson(await validateCapabilityRuntimeQualificationAttempt(value));
}

/** Fingerprint an exact validated WAL event for file names and outcome bases. */
export async function fingerprintCapabilityRuntimeQualificationAttempt(
  value: CapabilityRuntimeQualificationAttempt,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    await validateCapabilityRuntimeQualificationAttempt(value),
  );
}

export async function qualificationAttemptEventFileName(
  value: CapabilityRuntimeQualificationAttempt,
): Promise<string> {
  const attempt = await validateCapabilityRuntimeQualificationAttempt(value);
  const fingerprint = await fingerprintCapabilityRuntimeQualificationAttempt(attempt);
  return `event-${attempt.phase}-${fingerprint.digest}.json`;
}

export async function qualificationAttemptDispatchClaimFileName(
  value: CapabilityRuntimeQualificationDispatchingAttempt,
): Promise<string> {
  const attempt = await validateCapabilityRuntimeQualificationAttempt(value);
  if (attempt.phase !== "dispatching") {
    throw integrity("Only dispatching state can be a claim.");
  }
  const fingerprint = await fingerprintCapabilityRuntimeQualificationAttempt(attempt);
  return `dispatch-claim-${fingerprint.digest}.json`;
}

export async function qualificationAttemptIdentityOf(
  attempt: CapabilityRuntimeQualificationAttempt,
): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
  return await identityFields(
    attempt as unknown as Record<string, unknown>,
    "$capabilityRuntimeQualificationAttempt",
  );
}

export function prepareQualificationAttempt(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
  current: CapabilityRuntimeQualificationAttempt | undefined,
  preparedAt: string,
): CapabilityRuntimeQualificationAttempt {
  if (current) {
    assertQualificationAttemptIdentity(current, identity);
    return current;
  }
  return freeze({
    ...base(identity, timestamp(preparedAt, "$preparedAt")),
    phase: "prepared",
  });
}

export function activateQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  input: { readonly runtimeStartFingerprint: ContentFingerprint },
): CapabilityRuntimeQualificationAttempt {
  const active = {
    runtimeStartFingerprint: fingerprint(
      input.runtimeStartFingerprint,
      "$runtimeStartFingerprint",
    ),
  };
  if (current.phase === "prepared") {
    return freeze({
      ...base(current, current.preparedAt),
      phase: "active",
      ...active,
    });
  }
  assertActive(current, active);
  return current;
}

export function submitQualificationAttemptCase(
  current: CapabilityRuntimeQualificationAttempt,
  input: { readonly caseSha256: string; readonly caseUri: string },
): CapabilityRuntimeQualificationAttempt {
  if (current.phase === "prepared") {
    throw integrity(
      "Qualification case submission cannot precede a durable runtime start.",
    );
  }
  const submitted = submission(input, current.caseFingerprint, "$submittedCase");
  if (current.phase === "active") {
    return freeze({
      ...base(current, current.preparedAt),
      phase: "case-submitted",
      ...activeOf(current),
      ...submitted,
    });
  }
  assertSubmitted(current, submitted);
  return current;
}

export function dispatchingQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  clock: { readonly claimedAt: string; readonly deadlineAt: string },
): CapabilityRuntimeQualificationDispatchingAttempt | undefined {
  if (current.phase === "dispatching") return current;
  if (current.phase !== "case-submitted") return undefined;
  return freeze({
    ...base(current, current.preparedAt),
    phase: "dispatching",
    ...activeOf(current),
    ...submittedOf(current),
    claimedAt: timestamp(clock.claimedAt, "$claimedAt"),
    deadlineAt: timestamp(clock.deadlineAt, "$deadlineAt"),
  });
}

export function recordQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  input: {
    readonly receiptSha256: string;
    readonly receiptFingerprint: ContentFingerprint;
  },
): CapabilityRuntimeQualificationAttempt {
  const receiptSha256 = sha256(input.receiptSha256, "$receiptSha256");
  const receiptFingerprint = fingerprint(
    input.receiptFingerprint,
    "$receiptFingerprint",
  );
  if (current.phase === "recorded") {
    if (current.receiptSha256 !== receiptSha256) {
      throw integrity("Qualification receipt lookup SHA conflicts with WAL.");
    }
    assertFingerprint(current.receiptFingerprint, receiptFingerprint, "receipt");
    return current;
  }
  if (
    current.phase === "outcome" || current.phase === "stopped" ||
    current.phase === "attested"
  ) {
    return current;
  }
  // A later factual readback may promote a prior uncertain quarantine.
  if (current.phase !== "dispatching" && current.phase !== "quarantined") {
    throw integrity("Qualification readback cannot precede dispatch claim.");
  }
  return freeze({
    ...base(current, current.preparedAt),
    phase: "recorded",
    ...activeOf(current),
    ...submittedOf(current),
    receiptSha256,
    receiptFingerprint,
  });
}

export function quarantineQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  input: { readonly reason: "uncertain" | "absent" | "malformed" },
): CapabilityRuntimeQualificationAttempt {
  if (current.phase === "recorded") return current;
  const reason = quarantineReason(input.reason);
  if (current.phase === "quarantined") {
    if (current.quarantineReason !== reason) {
      throw integrity("Qualification quarantine reason cannot be rewritten.");
    }
    return current;
  }
  if (current.phase !== "dispatching") {
    throw integrity("Only a dispatched qualification can be quarantined.");
  }
  return freeze({
    ...base(current, current.preparedAt),
    phase: "quarantined",
    ...activeOf(current),
    ...submittedOf(current),
    quarantineReason: reason,
    claimedAt: current.claimedAt,
    deadlineAt: current.deadlineAt,
  });
}

export async function outcomeQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  value: CapabilityRuntimeQualificationAttemptOutcome,
): Promise<CapabilityRuntimeQualificationAttempt> {
  const outcome = await validateCapabilityRuntimeQualificationAttemptOutcome(
    value,
    "$qualificationOutcome",
  );
  if (
    current.phase === "outcome" || current.phase === "stopped" ||
    current.phase === "attested"
  ) {
    assertOutcome(current.outcome, outcome);
    return current;
  }
  if (current.phase === "active" || current.phase === "case-submitted") {
    if (outcome.basis !== "pre-dispatch" || outcome.status !== "unavailable") {
      throw integrity("Pre-dispatch can only record unavailable outcome.");
    }
    assertFingerprint(
      outcome.basisFingerprint,
      await fingerprintCapabilityRuntimeQualificationAttempt(current),
      "pre-dispatch basis",
    );
    const submitted = current.phase === "case-submitted" ? submittedOf(current) : {
      caseSha256: current.caseFingerprint.digest,
      caseUri: `qualification-case:sha256:${current.caseFingerprint.digest}`,
    };
    return freeze({
      ...base(current, current.preparedAt),
      phase: "outcome",
      ...activeOf(current),
      ...submitted,
      outcome,
    });
  }
  if (current.phase === "recorded") {
    if (outcome.basis !== "recorded") {
      throw integrity("Recorded readback requires recorded outcome basis.");
    }
    assertFingerprint(
      outcome.basisFingerprint,
      current.receiptFingerprint,
      "outcome basis",
    );
  } else if (current.phase === "quarantined") {
    if (outcome.basis !== "quarantined" || outcome.status !== "unavailable") {
      throw integrity("Quarantine can only record unavailable outcome.");
    }
    assertFingerprint(
      outcome.basisFingerprint,
      await fingerprintCapabilityRuntimeQualificationAttempt(current),
      "outcome basis",
    );
  } else throw integrity("Qualification outcome cannot precede readback.");
  if (outcome.status === "qualified" && current.phase !== "recorded") {
    throw integrity("Only recorded readback can qualify a runtime.");
  }
  return freeze({
    ...base(current, current.preparedAt),
    phase: "outcome",
    ...activeOf(current),
    ...submittedOf(current),
    outcome,
  });
}

export async function stopQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  input: { readonly runtimeStopProof: CapabilityRuntimeQualificationStopProof },
): Promise<CapabilityRuntimeQualificationAttempt> {
  const runtimeStopProof = await validateCapabilityRuntimeQualificationStopProof(
    input.runtimeStopProof,
  );
  if (current.phase === "stopped" || current.phase === "attested") {
    if (
      deterministicJson(current.runtimeStopProof) !==
        deterministicJson(runtimeStopProof)
    ) {
      throw integrity("Qualification runtime stop proof cannot be rewritten.");
    }
    return current;
  }
  if (current.phase !== "outcome") {
    throw integrity("Qualification runtime stop cannot precede outcome.");
  }
  assertStopProofBindsAttempt(current, runtimeStopProof);
  return freeze({
    ...base(current, current.preparedAt),
    phase: "stopped",
    ...activeOf(current),
    ...submittedOf(current),
    outcome: current.outcome,
    runtimeStopProof,
  });
}

export function attestQualificationAttempt(
  current: CapabilityRuntimeQualificationAttempt,
  input: { readonly attestationFingerprint: ContentFingerprint },
): CapabilityRuntimeQualificationAttempt {
  const attestationFingerprint = fingerprint(
    input.attestationFingerprint,
    "$attestationFingerprint",
  );
  if (current.phase === "attested") {
    assertFingerprint(
      current.attestationFingerprint,
      attestationFingerprint,
      "attestation",
    );
    return current;
  }
  if (current.phase !== "stopped") {
    throw integrity(
      "Qualification attestation cannot precede verified runtime stop.",
    );
  }
  if (current.outcome.status !== "qualified" || current.outcome.basis !== "recorded") {
    throw integrity("Only recorded qualified outcome can be attested.");
  }
  return freeze({
    ...base(current, current.preparedAt),
    phase: "attested",
    ...activeOf(current),
    ...submittedOf(current),
    outcome: current.outcome,
    runtimeStopProof: current.runtimeStopProof,
    attestationFingerprint,
  });
}

export async function resolveQualificationAttempts(
  events: readonly CapabilityRuntimeQualificationAttempt[],
  claims: readonly CapabilityRuntimeQualificationDispatchingAttempt[],
): Promise<CapabilityRuntimeQualificationAttempt | undefined> {
  if (events.length === 0 && claims.length === 0) return undefined;
  const byPhase = new Map<string, CapabilityRuntimeQualificationAttempt>();
  for (const event of events) {
    const prior = byPhase.get(event.phase);
    if (prior && deterministicJson(prior) !== deterministicJson(event)) {
      throw integrity("Qualification WAL has conflicting phase events.");
    }
    byPhase.set(event.phase, event);
  }
  const claim = oneClaim(claims);
  const dispatch = byPhase.get("dispatching");
  if (claim) {
    if (dispatch && deterministicJson(dispatch) !== deterministicJson(claim)) {
      throw integrity("Qualification dispatch claim conflicts with event.");
    }
    byPhase.set("dispatching", claim);
  }
  const prepared = byPhase.get("prepared");
  if (!prepared || prepared.phase !== "prepared") {
    throw integrity("Qualification WAL has transitions without preparation.");
  }
  for (const attempt of [...events, ...claims]) {
    assertQualificationAttemptIdentity(attempt, prepared);
  }
  const active = byPhase.get("active") as
    | Extract<CapabilityRuntimeQualificationAttempt, { readonly phase: "active" }>
    | undefined;
  const submitted = byPhase.get("case-submitted") as
    | Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "case-submitted" }
    >
    | undefined;
  const dispatching = byPhase.get("dispatching") as
    | CapabilityRuntimeQualificationDispatchingAttempt
    | undefined;
  const recorded = byPhase.get("recorded") as
    | Extract<CapabilityRuntimeQualificationAttempt, { readonly phase: "recorded" }>
    | undefined;
  const quarantined = byPhase.get("quarantined") as
    | Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "quarantined" }
    >
    | undefined;
  const outcome = byPhase.get("outcome") as
    | Extract<CapabilityRuntimeQualificationAttempt, { readonly phase: "outcome" }>
    | undefined;
  const stopped = byPhase.get("stopped") as
    | Extract<CapabilityRuntimeQualificationAttempt, { readonly phase: "stopped" }>
    | undefined;
  const attested = byPhase.get("attested") as
    | Extract<CapabilityRuntimeQualificationAttempt, { readonly phase: "attested" }>
    | undefined;
  if (
    !active &&
    (submitted || dispatching || recorded || quarantined || outcome || stopped ||
      attested)
  ) throw integrity("Qualification WAL has a transition before activation.");
  if (
    !submitted &&
    (dispatching || recorded || quarantined ||
      (outcome && outcome.outcome.basis !== "pre-dispatch") ||
      ((stopped || attested) && outcome?.outcome.basis !== "pre-dispatch"))
  ) throw integrity("Qualification WAL has a transition before case submission.");
  if (
    !dispatching && (recorded || quarantined ||
      (outcome && outcome.outcome.basis !== "pre-dispatch") ||
      ((stopped || attested) && outcome?.outcome.basis !== "pre-dispatch"))
  ) {
    throw integrity("Qualification WAL has a result before dispatch claim.");
  }
  if (
    outcome?.outcome.basis === "pre-dispatch" &&
    (dispatching || recorded || quarantined)
  ) {
    throw integrity("Pre-dispatch outcome cannot coexist with a dispatch claim.");
  }
  if (dispatching && !claim) {
    throw integrity("Qualification dispatch event lacks its durable claim.");
  }
  if (
    !recorded && !quarantined &&
    outcome?.outcome.basis !== "pre-dispatch" &&
    (outcome || stopped || attested)
  ) {
    throw integrity("Qualification WAL has terminal action without readback.");
  }
  if (!outcome && (stopped || attested)) {
    throw integrity("Qualification WAL has stop without outcome.");
  }
  if (!stopped && attested) throw integrity("Qualification WAL attests before stop.");
  if (active && submitted) assertActive(submitted, activeOf(active));
  if (submitted && dispatching) {
    assertSubmittedContinuation(dispatching, submitted);
  }
  if (dispatching && recorded) {
    assertSubmittedContinuation(recorded, dispatching);
  }
  if (dispatching && quarantined) {
    assertSubmittedContinuation(quarantined, dispatching);
  }
  if (outcome) {
    await assertOutcomeBasis(outcome, recorded, quarantined, submitted, active);
    if (outcome.outcome.basis === "pre-dispatch") {
      if (submitted) assertSubmittedContinuation(outcome, submitted);
      else if (active) assertActive(outcome, activeOf(active));
    } else {
      const basis = outcome.outcome.basis === "recorded" ? recorded : quarantined;
      if (!basis) throw integrity("Qualification outcome basis is absent.");
      assertSubmittedContinuation(outcome, basis);
    }
  }
  if (outcome && stopped) {
    assertSubmittedContinuation(stopped, outcome);
    assertOutcome(stopped.outcome, outcome.outcome);
    assertStopProofBindsAttempt(stopped, stopped.runtimeStopProof);
  }
  if (stopped && attested) {
    assertSubmittedContinuation(attested, stopped);
    assertOutcome(attested.outcome, stopped.outcome);
    if (
      deterministicJson(attested.runtimeStopProof) !==
        deterministicJson(stopped.runtimeStopProof)
    ) {
      throw integrity("Qualification runtime stop proof cannot be rewritten.");
    }
  }
  if (
    attested &&
    (attested.outcome.status !== "qualified" || attested.outcome.basis !== "recorded")
  ) throw integrity("Qualification WAL attests unqualified outcome.");
  return attested ?? stopped ?? outcome ?? recorded ?? quarantined ?? dispatching ??
    submitted ?? active ?? prepared;
}

function fieldsFor(phase: unknown): readonly string[] {
  const base = [...IDENTITY_FIELDS, "preparedAt", "schemaVersion", "phase"];
  if (phase === "prepared") return base;
  if (phase === "active") return [...base, "runtimeStartFingerprint"];
  if (phase === "case-submitted") {
    return [...base, "runtimeStartFingerprint", "caseSha256", "caseUri"];
  }
  if (phase === "dispatching") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "claimedAt",
      "deadlineAt",
    ];
  }
  if (phase === "recorded") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "receiptSha256",
      "receiptFingerprint",
    ];
  }
  if (phase === "quarantined") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "quarantineReason",
      "claimedAt",
      "deadlineAt",
    ];
  }
  if (phase === "outcome") {
    return [...base, "runtimeStartFingerprint", "caseSha256", "caseUri", "outcome"];
  }
  if (phase === "stopped") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "outcome",
      "runtimeStopProof",
    ];
  }
  if (phase === "attested") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "outcome",
      "runtimeStopProof",
      "attestationFingerprint",
    ];
  }
  throw integrity("Qualification WAL phase is unsupported.");
}

async function identityFields(
  value: Record<string, unknown>,
  path: string,
): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
  return await validateCapabilityRuntimeQualificationAttemptIdentity(
    Object.fromEntries(
      IDENTITY_FIELDS.map((field) => [field, value[field]]),
    ),
    path,
  );
}

async function observedHost(
  value: unknown,
  path: string,
): Promise<CapabilityRuntimeObservedHost> {
  const root = exactRecord(
    value,
    ["identityFingerprint", "platform", "fingerprint"],
    path,
  );
  if (root.platform !== "linux/amd64" && root.platform !== "linux/arm64") {
    throw integrity(`${path}.platform is unsupported.`);
  }
  const identityFingerprint = fingerprint(
    root.identityFingerprint,
    `${path}.identityFingerprint`,
  );
  const expected = await fingerprintCapabilityRuntimeObservedHost(
    root.platform,
    identityFingerprint,
  );
  const valueFingerprint = fingerprint(root.fingerprint, `${path}.fingerprint`);
  if (!fingerprintsEqual(expected, valueFingerprint)) {
    throw integrity(`${path}.fingerprint is not canonical.`);
  }
  return freeze({
    identityFingerprint,
    platform: root.platform,
    fingerprint: valueFingerprint,
  });
}

function submission(
  value: { readonly caseSha256: unknown; readonly caseUri: unknown },
  caseFingerprint: ContentFingerprint,
  path: string,
): Submitted {
  const caseSha256 = sha256(value.caseSha256, `${path}.caseSha256`);
  if (caseSha256 !== caseFingerprint.digest) {
    throw integrity(`${path}.caseSha256 does not bind exact case.`);
  }
  if (
    typeof value.caseUri !== "string" ||
    !/^[a-z][a-z0-9-]*:sha256:[a-f0-9]{64}$/.test(value.caseUri) ||
    !value.caseUri.endsWith(`:sha256:${caseSha256}`)
  ) {
    throw integrity(`${path}.caseUri is not bound to exact case.`);
  }
  return freeze({ caseSha256, caseUri: value.caseUri });
}

export async function createCapabilityRuntimeQualificationAttemptOutcome(
  input: CapabilityRuntimeQualificationAttemptOutcomeInput,
): Promise<CapabilityRuntimeQualificationAttemptOutcome> {
  const body = outcomeBody(input, "$qualificationOutcome");
  return freeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeQualificationAttemptOutcome(
  value: unknown,
  path = "$capabilityRuntimeQualificationAttemptOutcome",
): Promise<CapabilityRuntimeQualificationAttemptOutcome> {
  const root = exactRecord(value, [
    "schemaVersion",
    "status",
    "basis",
    "recordedAt",
    "basisFingerprint",
    "fingerprint",
  ], path);
  const body = outcomeBody(
    {
      schemaVersion: root.schemaVersion,
      status: root.status,
      basis: root.basis,
      recordedAt: root.recordedAt,
      basisFingerprint: root.basisFingerprint,
    },
    path,
  );
  const valueFingerprint = fingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(expected, valueFingerprint)) {
    throw integrity(`${path}.fingerprint is not canonical.`);
  }
  return freeze({ ...body, fingerprint: valueFingerprint });
}

function outcomeBody(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationAttemptOutcomeInput {
  const root = exactRecord(value, [
    "schemaVersion",
    "status",
    "basis",
    "recordedAt",
    "basisFingerprint",
  ], path);
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_OUTCOME_SCHEMA,
    `${path}.schemaVersion`,
  );
  if (
    root.status !== "qualified" && root.status !== "failed" &&
    root.status !== "unavailable"
  ) throw integrity(`${path}.status is unsupported.`);
  if (
    root.basis !== "recorded" && root.basis !== "quarantined" &&
    root.basis !== "pre-dispatch"
  ) {
    throw integrity(`${path}.basis is unsupported.`);
  }
  if (
    (root.basis === "quarantined" || root.basis === "pre-dispatch") &&
    root.status !== "unavailable"
  ) {
    throw integrity(`${path}.quarantined requires unavailable.`);
  }
  return freeze({
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_OUTCOME_SCHEMA,
    status: root.status,
    basis: root.basis,
    recordedAt: timestamp(root.recordedAt, `${path}.recordedAt`),
    basisFingerprint: fingerprint(root.basisFingerprint, `${path}.basisFingerprint`),
  });
}

function base(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
  preparedAt: string,
): Base {
  return freeze({
    schemaVersion: CAPABILITY_RUNTIME_QUALIFICATION_ATTEMPT_SCHEMA,
    candidate: identity.candidate,
    observedHost: identity.observedHost,
    requestId: identity.requestId,
    reviewFingerprint: identity.reviewFingerprint,
    sourceFingerprint: identity.sourceFingerprint,
    loweringFingerprint: identity.loweringFingerprint,
    caseFingerprint: identity.caseFingerprint,
    runRequestFingerprint: identity.runRequestFingerprint,
    qualificationSpecFingerprint: identity.qualificationSpecFingerprint,
    preparedAt,
  });
}
function activeOf(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" }
  >,
): Active {
  return { runtimeStartFingerprint: attempt.runtimeStartFingerprint };
}
function submittedOf(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" | "active" }
  >,
): Submitted {
  return { caseSha256: attempt.caseSha256, caseUri: attempt.caseUri };
}
function identityBody(value: CapabilityRuntimeQualificationAttemptIdentity) {
  return {
    candidate: value.candidate,
    observedHost: value.observedHost,
    reviewFingerprint: value.reviewFingerprint,
    requestId: value.requestId,
    sourceFingerprint: value.sourceFingerprint,
    loweringFingerprint: value.loweringFingerprint,
    caseFingerprint: value.caseFingerprint,
    runRequestFingerprint: value.runRequestFingerprint,
    qualificationSpecFingerprint: value.qualificationSpecFingerprint,
  };
}
/** Refuse a same-key attempt whose closed identity differs from the caller. */
export function assertQualificationAttemptIdentity(
  attempt: CapabilityRuntimeQualificationAttempt,
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): void {
  const left = identityBody(attempt);
  const right = identityBody(identity);
  if (deterministicJson(left) !== deterministicJson(right)) {
    throw integrity("Qualification WAL identity conflicts with resumed work.");
  }
}
function assertActive(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" }
  >,
  value: Active,
): void {
  assertFingerprint(
    attempt.runtimeStartFingerprint,
    value.runtimeStartFingerprint,
    "runtime start",
  );
}
function assertSubmitted(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" | "active" }
  >,
  value: Submitted,
): void {
  if (attempt.caseSha256 !== value.caseSha256 || attempt.caseUri !== value.caseUri) {
    throw integrity("Qualification submitted case conflicts with WAL.");
  }
}
function assertSubmittedContinuation(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" | "active" }
  >,
  prior: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" | "active" }
  >,
): void {
  assertActive(attempt, activeOf(prior));
  assertSubmitted(attempt, submittedOf(prior));
}
function assertFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
  label: string,
): void {
  if (!fingerprintsEqual(left, right)) {
    throw integrity(`Qualification ${label} conflicts with WAL.`);
  }
}

/**
 * Host stop proofs retain their own journal/lease authority.  An isolated
 * destruction proof instead owns one concrete microVM run, so it cannot be
 * transplanted from a sibling qualification attempt or receipt.
 */
function assertStopProofBindsAttempt(
  attempt: Extract<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "outcome" | "stopped" | "attested" }
  >,
  proof: CapabilityRuntimeQualificationStopProof,
): void {
  if (
    proof.schemaVersion !==
      CAPABILITY_RUNTIME_QUALIFICATION_ISOLATED_DESTRUCTION_PROOF_SCHEMA
  ) return;
  if (proof.runId !== attempt.requestId) {
    throw integrity("Qualification isolated stop proof run ID conflicts with WAL.");
  }
  if (
    attempt.outcome.status === "qualified" ||
    attempt.outcome.basis === "recorded"
  ) {
    if (!proof.receiptFingerprint) {
      throw integrity(
        "Qualification isolated stop proof lacks the recorded receipt fingerprint.",
      );
    }
    assertFingerprint(
      proof.receiptFingerprint,
      attempt.outcome.basisFingerprint,
      "isolated stop proof receipt",
    );
  }
}
function assertOutcome(
  left: CapabilityRuntimeQualificationAttemptOutcome,
  right: CapabilityRuntimeQualificationAttemptOutcome,
): void {
  if (deterministicJson(left) !== deterministicJson(right)) {
    throw integrity("Qualification outcome cannot be rewritten.");
  }
}
async function assertOutcomeBasis(
  outcome: Extract<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "outcome" }
  >,
  recorded: CapabilityRuntimeQualificationAttempt | undefined,
  quarantined: CapabilityRuntimeQualificationAttempt | undefined,
  submitted: CapabilityRuntimeQualificationAttempt | undefined,
  active: CapabilityRuntimeQualificationAttempt | undefined,
): Promise<void> {
  if (outcome.outcome.basis === "pre-dispatch") {
    const basis = submitted ?? active;
    if (!basis || (basis.phase !== "active" && basis.phase !== "case-submitted")) {
      throw integrity("Pre-dispatch outcome claims missing prior event.");
    }
    assertFingerprint(
      outcome.outcome.basisFingerprint,
      await fingerprintCapabilityRuntimeQualificationAttempt(basis),
      "pre-dispatch basis",
    );
    return;
  }
  if (outcome.outcome.basis === "recorded") {
    if (!recorded || recorded.phase !== "recorded") {
      throw integrity("Qualification outcome claims missing recorded readback.");
    }
    assertFingerprint(
      outcome.outcome.basisFingerprint,
      recorded.receiptFingerprint,
      "outcome basis",
    );
    return;
  }
  if (recorded) {
    throw integrity(
      "Qualification outcome cannot return to quarantined basis after recorded readback.",
    );
  }
  if (!quarantined || quarantined.phase !== "quarantined") {
    throw integrity("Qualification outcome claims missing quarantine.");
  }
  assertFingerprint(
    outcome.outcome.basisFingerprint,
    await fingerprintCapabilityRuntimeQualificationAttempt(quarantined),
    "outcome basis",
  );
}
function oneClaim(
  claims: readonly CapabilityRuntimeQualificationDispatchingAttempt[],
): CapabilityRuntimeQualificationDispatchingAttempt | undefined {
  if (!claims.length) return undefined;
  const [first] = claims;
  if (
    !first ||
    claims.some((claim) => deterministicJson(claim) !== deterministicJson(first))
  ) throw integrity("Qualification WAL contains competing dispatch claims.");
  return first;
}
function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return freeze({
    algorithm: "sha256" as const,
    digest: sha256(root.digest, `${path}.digest`),
  });
}
function sha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw integrity(`${path} must be lowercase SHA-256.`);
  }
  return value;
}
function timestamp(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  const date = new Date(text);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== text) {
    throw integrity(`${path} must be exact ISO timestamp.`);
  }
  return text;
}
function quarantineReason(value: unknown): "uncertain" | "absent" | "malformed" {
  if (value === "uncertain" || value === "absent" || value === "malformed") {
    return value;
  }
  throw integrity("Qualification quarantine reason is unsupported.");
}
function freeze<T>(value: T): T {
  return deepFreeze(value);
}
function integrity(
  message: string,
): CapabilityRuntimeQualificationAttemptIntegrityError {
  return new CapabilityRuntimeQualificationAttemptIntegrityError(message);
}
