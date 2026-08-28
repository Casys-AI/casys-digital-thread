/** Durable monotone L3 WAL for Chrono prescribed-kinematics observations. */

import type {
  PrescribedKinematicsDispatchingAttempt,
  PrescribedKinematicsObservationAttempt,
  PrescribedKinematicsObservationAttemptIdentity,
  PrescribedKinematicsObservationAttemptKey,
  PrescribedKinematicsObservationAttemptStore,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-observation-attempt-store.ts";
import type { PrescribedKinematicsPreDispatchRejectionCode } from "../../../application/ports/out/mechanics/prescribed-kinematics-observer.ts";
import { exactRecord, safeId } from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Hex,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

const SCHEMA = "prescribed-kinematics-observation-attempt/1.0" as const;
const DISPATCH_CLAIM_SCHEMA =
  "prescribed-kinematics-observation-dispatch-claim/1.0" as const;
type SubmittedAttempt = PrescribedKinematicsObservationAttemptIdentity & {
  readonly schemaVersion: typeof SCHEMA;
  readonly phase: "case-submitted";
  readonly caseSha256: string;
  readonly caseUri: string;
};

export class PrescribedKinematicsObservationAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrescribedKinematicsObservationAttemptIntegrityError";
  }
}

export class FilePrescribedKinematicsObservationAttemptStore
  implements PrescribedKinematicsObservationAttemptStore {
  readonly #directory: string;

  constructor(
    directory = "state/local/mechanics/prescribed-kinematics/observation-attempts",
  ) {
    if (!directory || directory.includes("\0") || directory === "/") {
      throw new TypeError("Prescribed-kinematics attempt directory is invalid.");
    }
    this.#directory = directory.replace(/\/+$/, "");
  }

  async read(
    key: PrescribedKinematicsObservationAttemptKey,
  ): Promise<PrescribedKinematicsObservationAttempt | undefined> {
    const parsed = keyOf(key);
    const path = await this.#path(parsed);
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new PrescribedKinematicsObservationAttemptIntegrityError(
        "The prescribed-kinematics observation WAL is not JSON.",
      );
    }
    const attempt = parseAttempt(value);
    assertKey(attempt, parsed);
    if (`${deterministicJson(attempt)}\n` !== text) {
      throw new PrescribedKinematicsObservationAttemptIntegrityError(
        "The prescribed-kinematics observation WAL is not canonical.",
      );
    }
    return attempt;
  }

  async prepare(
    identityValue: PrescribedKinematicsObservationAttemptIdentity,
  ): Promise<PrescribedKinematicsObservationAttempt> {
    const identity = parseIdentity(identityValue);
    const existing = await this.read(identity);
    if (existing) {
      assertSameIdentity(existing, identity);
      return existing;
    }
    const fresh: PrescribedKinematicsObservationAttempt = Object.freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: "prepared",
    });
    return await this.#writeIfCurrent(identity, undefined, fresh);
  }

  async markCaseSubmitted(
    identityValue: PrescribedKinematicsObservationAttemptIdentity,
    submitted: { readonly caseSha256: string; readonly caseUri: string },
  ): Promise<PrescribedKinematicsObservationAttempt> {
    return await this.#transition(identityValue, (current) => {
      if (current.phase !== "prepared" && current.phase !== "case-submitted") {
        if (
          current.phase === "dispatching" || current.phase === "quarantined" ||
          current.phase === "rejected" || current.phase === "recorded"
        ) {
          assertSubmitted(current, submitted);
          return current;
        }
      }
      if (current.phase === "case-submitted") {
        assertSubmitted(current, submitted);
        return current;
      }
      return freeze({
        ...base(current),
        phase: "case-submitted",
        ...parseSubmitted(submitted),
      });
    });
  }

  async markDispatching(
    identityValue: PrescribedKinematicsObservationAttemptIdentity,
  ): Promise<
    | {
      readonly attempt: PrescribedKinematicsDispatchingAttempt;
      readonly dispatchNow: true;
    }
    | {
      readonly attempt: PrescribedKinematicsObservationAttempt;
      readonly dispatchNow: false;
    }
  > {
    const identity = parseIdentity(identityValue);
    const current = await this.read(identity);
    if (!current) {
      throw integrity("A run cannot dispatch before its durable L3 WAL preparation.");
    }
    assertSameIdentity(current, identity);
    if (
      current.phase === "dispatching" || current.phase === "quarantined" ||
      current.phase === "rejected" || current.phase === "recorded"
    ) {
      return { attempt: current, dispatchNow: false };
    }
    if (current.phase !== "case-submitted") {
      throw integrity(
        "A run cannot dispatch before the exact case submission is durably recorded.",
      );
    }
    // A create-new sidecar is the inter-process intent boundary.  Replacing
    // the WAL file alone is not a compare-and-swap operation: two processes
    // could otherwise both observe `case-submitted` and both call Chrono.
    // The immutable claim carries the complete run identity and exact case
    // binding, so a crash after claiming is still recoverable readback only.
    const submitted = submittedAttempt(current);
    const ownsClaim = await this.#claimDispatch(identity, submitted);
    const next = dispatching(submitted);
    const written = await this.#writeIfCurrent(identity, current, next);
    if (written.phase !== "dispatching") {
      return { attempt: written, dispatchNow: false };
    }
    if (!ownsClaim) return { attempt: written, dispatchNow: false };
    return {
      attempt: written as PrescribedKinematicsDispatchingAttempt,
      dispatchNow: true,
    };
  }

  async markRecorded(
    identityValue: PrescribedKinematicsObservationAttemptIdentity,
    receiptSha256: string,
  ): Promise<PrescribedKinematicsObservationAttempt> {
    return await this.#transition(identityValue, (current) => {
      if (current.phase === "recorded") {
        if (current.receiptSha256 !== receiptSha256) {
          throw integrity(
            "The provider receipt identity conflicts with the recorded L3 WAL.",
          );
        }
        return current;
      }
      if (current.phase !== "dispatching" && current.phase !== "quarantined") {
        throw integrity(
          "A provider record cannot precede the durable dispatch intent.",
        );
      }
      return freeze({
        ...base(current),
        phase: "recorded",
        caseSha256: current.caseSha256,
        caseUri: current.caseUri,
        receiptSha256: sha(receiptSha256),
      });
    });
  }

  async markQuarantined(
    identityValue: PrescribedKinematicsObservationAttemptIdentity,
    reason: "uncertain" | "absent" | "malformed",
  ): Promise<
    | Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "quarantined" }>
    | Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "recorded" }>
  > {
    return await this.#transition(identityValue, (current) => {
      if (current.phase === "recorded") return current;
      if (current.phase === "quarantined") {
        if (current.quarantineReason !== reason) {
          throw integrity("The L3 quarantine reason cannot be rewritten.");
        }
        return current;
      }
      if (current.phase !== "dispatching") {
        throw integrity("Only a dispatched L3 request can be quarantined.");
      }
      return freeze({
        ...base(current),
        phase: "quarantined",
        caseSha256: current.caseSha256,
        caseUri: current.caseUri,
        quarantineReason: reason,
      });
    }) as
      | Extract<
        PrescribedKinematicsObservationAttempt,
        { readonly phase: "quarantined" }
      >
      | Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "recorded" }>;
  }

  async markRejected(
    identityValue: PrescribedKinematicsObservationAttemptIdentity,
    code: PrescribedKinematicsPreDispatchRejectionCode,
  ): Promise<
    Extract<PrescribedKinematicsObservationAttempt, { readonly phase: "rejected" }>
  > {
    return await this.#transition(identityValue, (current) => {
      if (current.phase === "rejected") {
        if (current.rejectionCode !== code) {
          throw integrity("The definite L3 rejection code cannot be rewritten.");
        }
        return current;
      }
      if (current.phase !== "dispatching") {
        throw integrity(
          "Only the durable dispatch boundary can record a definite pre-dispatch rejection.",
        );
      }
      return freeze({
        ...base(current),
        phase: "rejected",
        caseSha256: current.caseSha256,
        caseUri: current.caseUri,
        rejectionCode: parseRejectionCode(code),
      });
    }) as Extract<
      PrescribedKinematicsObservationAttempt,
      { readonly phase: "rejected" }
    >;
  }

  async #transition(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    transition: (
      current: PrescribedKinematicsObservationAttempt,
    ) => PrescribedKinematicsObservationAttempt,
  ): Promise<PrescribedKinematicsObservationAttempt> {
    const parsed = parseIdentity(identity);
    const current = await this.read(parsed);
    if (!current) throw integrity("The prescribed-kinematics L3 WAL is absent.");
    assertSameIdentity(current, parsed);
    const next = transition(current);
    if (next === current) return current;
    return await this.#writeIfCurrent(parsed, current, next);
  }

  async #writeIfCurrent(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    expected: PrescribedKinematicsObservationAttempt | undefined,
    next: PrescribedKinematicsObservationAttempt,
  ): Promise<PrescribedKinematicsObservationAttempt> {
    await Deno.mkdir(this.#directory, { recursive: true });
    const path = await this.#path(identity);
    const observed = await this.read(identity);
    if (
      expected === undefined
        ? observed !== undefined
        : deterministicJson(observed) !== deterministicJson(expected)
    ) {
      if (observed) return observed;
      throw integrity(
        "The prescribed-kinematics L3 WAL changed before its transition could be recorded.",
      );
    }
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(temporary, `${deterministicJson(next)}\n`, {
      createNew: true,
    });
    await Deno.rename(temporary, path);
    return next;
  }

  async #path(identity: PrescribedKinematicsObservationAttemptKey): Promise<string> {
    const key =
      `${identity.projectId}\u0000${identity.agentRunId}\u0000${identity.requestId}`;
    return `${this.#directory}/${await sha256Hex(new TextEncoder().encode(key))}.json`;
  }

  async #claimDispatch(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    submitted: SubmittedAttempt,
  ): Promise<boolean> {
    await Deno.mkdir(this.#directory, { recursive: true });
    const path = await this.#dispatchClaimPath(identity, submitted);
    try {
      // The complete identity/case attestation is in the deterministic file
      // name. A zero-byte createNew claim has no partial payload state after a
      // crash; any visible file is therefore already a no-redispatch claim.
      await Deno.writeTextFile(path, "", { createNew: true });
      return true;
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    return false;
  }

  async #dispatchClaimPath(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    submitted: SubmittedAttempt,
  ): Promise<string> {
    const attestation = deterministicJson({
      schemaVersion: DISPATCH_CLAIM_SCHEMA,
      ...identity,
      caseSha256: submitted.caseSha256,
      caseUri: submitted.caseUri,
    });
    const digest = await sha256Hex(new TextEncoder().encode(attestation));
    return `${await this.#path(identity)}.${digest}.dispatch-claim`;
  }
}

function parseAttempt(value: unknown): PrescribedKinematicsObservationAttempt {
  const root = exactRecord(
    value,
    Object.keys(value as object),
    "$prescribedKinematicsAttempt",
  );
  const identity = parseIdentity(root);
  if (root.schemaVersion !== SCHEMA) {
    throw integrity("The prescribed-kinematics WAL schema is unsupported.");
  }
  if (root.phase === "prepared") {
    exactRecord(
      value,
      [...identityKeys, "schemaVersion", "phase"],
      "$prescribedKinematicsAttempt",
    );
    return freeze({ schemaVersion: SCHEMA, ...identity, phase: "prepared" });
  }
  if (root.phase === "case-submitted" || root.phase === "dispatching") {
    const basic = exactRecord(
      value,
      [...identityKeys, "schemaVersion", "phase", "caseSha256", "caseUri"],
      "$prescribedKinematicsAttempt",
    );
    const submitted = parseSubmitted(basic);
    return freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: basic.phase as "case-submitted" | "dispatching",
      ...submitted,
    });
  }
  if (root.phase === "recorded") {
    const basic = exactRecord(
      value,
      [
        ...identityKeys,
        "schemaVersion",
        "phase",
        "caseSha256",
        "caseUri",
        "receiptSha256",
      ],
      "$prescribedKinematicsAttempt",
    );
    const submitted = parseSubmitted(basic);
    return freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: "recorded",
      ...submitted,
      receiptSha256: sha(basic.receiptSha256),
    });
  }
  if (root.phase === "quarantined") {
    const basic = exactRecord(
      value,
      [
        ...identityKeys,
        "schemaVersion",
        "phase",
        "caseSha256",
        "caseUri",
        "quarantineReason",
      ],
      "$prescribedKinematicsAttempt",
    );
    const submitted = parseSubmitted(basic);
    if (
      basic.quarantineReason !== "uncertain" && basic.quarantineReason !== "absent" &&
      basic.quarantineReason !== "malformed"
    ) throw integrity("A quarantined L3 WAL is malformed.");
    return freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: "quarantined",
      ...submitted,
      quarantineReason: basic.quarantineReason,
    });
  }
  if (root.phase === "rejected") {
    const basic = exactRecord(
      value,
      [
        ...identityKeys,
        "schemaVersion",
        "phase",
        "caseSha256",
        "caseUri",
        "rejectionCode",
      ],
      "$prescribedKinematicsAttempt",
    );
    const submitted = parseSubmitted(basic);
    return freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: "rejected",
      ...submitted,
      rejectionCode: parseRejectionCode(basic.rejectionCode),
    });
  }
  throw integrity("The prescribed-kinematics WAL phase is unsupported.");
}

const identityKeys = [
  "projectId",
  "agentRunId",
  "requestId",
  "planFingerprint",
  "caseFingerprint",
  "bindingFingerprint",
  "caseJsonFingerprint",
  "startedAt",
] as const;

function parseIdentity(value: unknown): PrescribedKinematicsObservationAttemptIdentity {
  const root = exactRecord(
    value,
    Object.keys(value as object),
    "$prescribedKinematicsAttemptIdentity",
  );
  const startedAt =
    typeof root.startedAt === "string" && !Number.isNaN(Date.parse(root.startedAt))
      ? root.startedAt
      : (() => {
        throw integrity("The L3 WAL startedAt must be an ISO timestamp.");
      })();
  return Object.freeze({
    projectId: safeId(root.projectId, "$prescribedKinematicsAttemptIdentity.projectId"),
    agentRunId: safeId(
      root.agentRunId,
      "$prescribedKinematicsAttemptIdentity.agentRunId",
    ),
    requestId: safeId(root.requestId, "$prescribedKinematicsAttemptIdentity.requestId"),
    planFingerprint: fingerprint(root.planFingerprint, "planFingerprint"),
    caseFingerprint: fingerprint(root.caseFingerprint, "caseFingerprint"),
    bindingFingerprint: fingerprint(root.bindingFingerprint, "bindingFingerprint"),
    caseJsonFingerprint: fingerprint(root.caseJsonFingerprint, "caseJsonFingerprint"),
    startedAt,
  });
}

function keyOf(
  value: PrescribedKinematicsObservationAttemptKey,
): PrescribedKinematicsObservationAttemptKey {
  return {
    projectId: safeId(value.projectId, "$projectId"),
    agentRunId: safeId(value.agentRunId, "$agentRunId"),
    requestId: safeId(value.requestId, "$requestId"),
  };
}
function fingerprint(value: unknown, name: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], `$${name}`);
  if (root.algorithm !== "sha256") {
    throw integrity(`The L3 WAL ${name} must use sha256.`);
  }
  return Object.freeze({ algorithm: "sha256", digest: sha(root.digest) });
}
function parseSubmitted(
  value: unknown,
): { readonly caseSha256: string; readonly caseUri: string } {
  const root = exactRecord(value, Object.keys(value as object), "$submittedCase");
  const caseSha256 = sha(root.caseSha256);
  const caseUri = typeof root.caseUri === "string" &&
      root.caseUri === `chrono-case:sha256:${caseSha256}`
    ? root.caseUri
    : (() => {
      throw integrity("The L3 WAL case URI is not bound to its exact case SHA-256.");
    })();
  return { caseSha256, caseUri };
}
function assertSubmitted(
  current: Exclude<
    PrescribedKinematicsObservationAttempt,
    { readonly phase: "prepared" }
  >,
  submitted: { readonly caseSha256: string; readonly caseUri: string },
): void {
  const expected = parseSubmitted(submitted);
  if (
    current.caseSha256 !== expected.caseSha256 || current.caseUri !== expected.caseUri
  ) throw integrity("The L3 WAL case submission identity is divergent.");
}
function assertSameIdentity(
  current: PrescribedKinematicsObservationAttemptIdentity,
  identity: PrescribedKinematicsObservationAttemptIdentity,
): void {
  for (const key of identityKeys) {
    const a = current[key];
    const b = identity[key];
    if (typeof a === "object" && a !== null && typeof b === "object" && b !== null) {
      if (!fingerprintsEqual(a as ContentFingerprint, b as ContentFingerprint)) {
        throw integrity("The L3 WAL identity conflicts with the resumed run.");
      }
    } else if (a !== b) {
      throw integrity("The L3 WAL identity conflicts with the resumed run.");
    }
  }
}
function assertKey(
  current: PrescribedKinematicsObservationAttempt,
  key: PrescribedKinematicsObservationAttemptKey,
): void {
  if (
    current.projectId !== key.projectId || current.agentRunId !== key.agentRunId ||
    current.requestId !== key.requestId
  ) throw integrity("The L3 WAL key does not match its recorded identity.");
}
function base(
  current: PrescribedKinematicsObservationAttempt,
): PrescribedKinematicsObservationAttemptIdentity & {
  readonly schemaVersion: typeof SCHEMA;
} {
  return {
    schemaVersion: SCHEMA,
    projectId: current.projectId,
    agentRunId: current.agentRunId,
    requestId: current.requestId,
    planFingerprint: current.planFingerprint,
    caseFingerprint: current.caseFingerprint,
    bindingFingerprint: current.bindingFingerprint,
    caseJsonFingerprint: current.caseJsonFingerprint,
    startedAt: current.startedAt,
  };
}
function dispatching(
  current: SubmittedAttempt,
): PrescribedKinematicsDispatchingAttempt {
  return freeze({
    ...base(current),
    phase: "dispatching",
    caseSha256: current.caseSha256,
    caseUri: current.caseUri,
  });
}
function submittedAttempt(
  current: PrescribedKinematicsObservationAttempt,
): SubmittedAttempt {
  if (current.phase !== "case-submitted") {
    throw integrity("The L3 WAL has no submitted case for this dispatch claim.");
  }
  return current as SubmittedAttempt;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw integrity("The L3 WAL SHA-256 identity is invalid.");
  }
  return value;
}

function parseRejectionCode(
  value: unknown,
): PrescribedKinematicsPreDispatchRejectionCode {
  const codes = new Set<PrescribedKinematicsPreDispatchRejectionCode>([
    "case_invalid",
    "case_not_found",
    "case_sha256_mismatch",
    "case_uri_mismatch",
    "invalid_case_json",
    "invalid_request_id",
    "invalid_sample_limit",
    "invalid_sample_offset",
    "invalid_timeout",
    "request_conflict",
  ]);
  if (
    typeof value !== "string" ||
    !codes.has(value as PrescribedKinematicsPreDispatchRejectionCode)
  ) {
    throw integrity(
      "The L3 rejection code is not a published definite pre-dispatch Chrono error.",
    );
  }
  return value as PrescribedKinematicsPreDispatchRejectionCode;
}
function freeze<T>(value: T): T {
  return Object.freeze(value);
}
function integrity(
  message: string,
): PrescribedKinematicsObservationAttemptIntegrityError {
  return new PrescribedKinematicsObservationAttemptIntegrityError(message);
}
