/** Durable monotone L3 WAL for Chrono prescribed-kinematics observations. */

import type {
  PrescribedKinematicsDispatchingAttempt,
  PrescribedKinematicsObservationAttempt,
  PrescribedKinematicsObservationAttemptIdentity,
  PrescribedKinematicsObservationAttemptKey,
  PrescribedKinematicsObservationAttemptStore,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-observation-attempt-store.ts";
import type { PrescribedKinematicsPreDispatchRejectionCode } from "../../../application/ports/out/mechanics/prescribed-kinematics-observer.ts";
import {
  closedRecord,
  exactRecord,
  exactVersionToken,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Hex,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  validateCapabilityRuntimeLaunchGroupReference,
} from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type {
  PrescribedKinematicsRuntimeProvenance,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";

const SCHEMA = "prescribed-kinematics-observation-attempt/4.0" as const;
const DISPATCH_CLAIM_SCHEMA =
  "prescribed-kinematics-observation-dispatch-claim/4.0" as const;
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
    const base = await this.#basePath(parsed);
    const basename = base.slice(base.lastIndexOf("/") + 1);
    const prefix = `${basename}.event-`;
    const attempts: PrescribedKinematicsObservationAttempt[] = [];
    try {
      for await (const entry of Deno.readDir(this.#directory)) {
        if (
          !entry.isFile || !entry.name.startsWith(prefix) ||
          !entry.name.endsWith(".json")
        ) {
          continue;
        }
        const text = await Deno.readTextFile(`${this.#directory}/${entry.name}`);
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          throw new PrescribedKinematicsObservationAttemptIntegrityError(
            "The prescribed-kinematics observation WAL event is not JSON.",
          );
        }
        const attempt = parseAttempt(value);
        assertKey(attempt, parsed);
        if (`${deterministicJson(attempt)}\n` !== text) {
          throw new PrescribedKinematicsObservationAttemptIntegrityError(
            "The prescribed-kinematics observation WAL event is not canonical.",
          );
        }
        attempts.push(attempt);
      }
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
    return resolveMonotoneAttempts(attempts);
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
    return await this.#append(identity, fresh);
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
    const written = await this.#append(identity, next);
    if (written.phase !== "dispatching") {
      return { attempt: written, dispatchNow: false };
    }
    if (!ownsClaim) return { attempt: written, dispatchNow: false };
    return {
      attempt: written,
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
    return await this.#append(parsed, next);
  }

  async #append(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    next: PrescribedKinematicsObservationAttempt,
  ): Promise<PrescribedKinematicsObservationAttempt> {
    await Deno.mkdir(this.#directory, { recursive: true });
    const path = await this.#eventPath(identity, next);
    // Each state is published under a different, content-addressed event name.
    // Unlike read-compare-rename of one mutable file, concurrent terminal
    // transitions cannot overwrite each other. `read` resolves the monotone
    // event set with recorded taking precedence over quarantine.
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Deno.writeTextFile(temporary, `${deterministicJson(next)}\n`, {
      createNew: true,
    });
    try {
      await Deno.rename(temporary, path);
    } catch (error) {
      try {
        await Deno.remove(temporary);
      } catch {
        // A dead temp file is deliberately ignored: it is never an event.
      }
      throw error;
    }
    const observed = await this.read(identity);
    if (!observed) throw integrity("The newly appended L3 WAL event is absent.");
    return observed;
  }

  async #basePath(
    identity: PrescribedKinematicsObservationAttemptKey,
  ): Promise<string> {
    const key =
      `${identity.projectId}\u0000${identity.agentRunId}\u0000${identity.requestId}`;
    return `${this.#directory}/${await sha256Hex(new TextEncoder().encode(key))}`;
  }

  async #eventPath(
    identity: PrescribedKinematicsObservationAttemptIdentity,
    attempt: PrescribedKinematicsObservationAttempt,
  ): Promise<string> {
    const digest = await sha256Hex(
      new TextEncoder().encode(deterministicJson(attempt)),
    );
    return `${await this.#basePath(identity)}.event-${attempt.phase}-${digest}.json`;
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
    return `${await this.#basePath(identity)}.${digest}.dispatch-claim`;
  }
}

/**
 * Resolve immutable transition events. A recorded receipt is a factual
 * promotion over a prior recoverable quarantine; no event can make it appear
 * quarantined again. Any competing non-promotable terminal state is integrity
 * failure, rather than an arbitrary last-writer-wins choice.
 */
function resolveMonotoneAttempts(
  attempts: readonly PrescribedKinematicsObservationAttempt[],
): PrescribedKinematicsObservationAttempt | undefined {
  if (attempts.length === 0) return undefined;
  const byPhase = new Map<
    PrescribedKinematicsObservationAttempt["phase"],
    PrescribedKinematicsObservationAttempt
  >();
  for (const attempt of attempts) {
    const prior = byPhase.get(attempt.phase);
    if (
      prior !== undefined && deterministicJson(prior) !== deterministicJson(attempt)
    ) {
      throw integrity(
        "The L3 WAL contains conflicting immutable events for one phase.",
      );
    }
    byPhase.set(attempt.phase, attempt);
  }
  const prepared = byPhase.get("prepared");
  if (!prepared) {
    throw integrity("The L3 WAL has transitions without a prepared event.");
  }
  const submitted = byPhase.get("case-submitted");
  const dispatching = byPhase.get("dispatching");
  const quarantined = byPhase.get("quarantined");
  const rejected = byPhase.get("rejected");
  const recorded = byPhase.get("recorded");
  if (!submitted && (dispatching || quarantined || rejected || recorded)) {
    throw integrity("The L3 WAL has a transition before case submission.");
  }
  if (!dispatching && (quarantined || rejected || recorded)) {
    throw integrity("The L3 WAL has a terminal transition before dispatch intent.");
  }
  if (recorded) {
    if (rejected) {
      throw integrity("The L3 WAL cannot be both recorded and definitely rejected.");
    }
    return recorded;
  }
  if (rejected) {
    if (quarantined) {
      throw integrity("The L3 WAL cannot be both quarantined and definitely rejected.");
    }
    return rejected;
  }
  return quarantined ?? dispatching ?? submitted ?? prepared;
}

function parseAttempt(value: unknown): PrescribedKinematicsObservationAttempt {
  const root = closedRecord(
    value,
    ATTEMPT_FIELDS,
    [...identityKeys, "schemaVersion", "phase"],
    "$prescribedKinematicsAttempt",
  );
  if (root.schemaVersion !== SCHEMA) {
    throw integrity("The prescribed-kinematics WAL schema is unsupported.");
  }
  if (root.phase === "prepared") {
    const basic = exactRecord(
      value,
      [...identityKeys, "schemaVersion", "phase"],
      "$prescribedKinematicsAttempt",
    );
    const identity = parseIdentityFields(basic);
    return freeze({ schemaVersion: SCHEMA, ...identity, phase: "prepared" });
  }
  if (root.phase === "case-submitted") {
    const basic = exactRecord(
      value,
      [...identityKeys, "schemaVersion", "phase", "caseSha256", "caseUri"],
      "$prescribedKinematicsAttempt",
    );
    const identity = parseIdentityFields(basic);
    const submitted = parseSubmittedFields(basic);
    return freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: "case-submitted",
      ...submitted,
    });
  }
  if (root.phase === "dispatching") {
    const basic = exactRecord(
      value,
      [...identityKeys, "schemaVersion", "phase", "caseSha256", "caseUri"],
      "$prescribedKinematicsAttempt",
    );
    const identity = parseIdentityFields(basic);
    const submitted = parseSubmittedFields(basic);
    return freeze({
      schemaVersion: SCHEMA,
      ...identity,
      phase: "dispatching",
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
    const identity = parseIdentityFields(basic);
    const submitted = parseSubmittedFields(basic);
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
    const identity = parseIdentityFields(basic);
    const submitted = parseSubmittedFields(basic);
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
    const identity = parseIdentityFields(basic);
    const submitted = parseSubmittedFields(basic);
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
  "caseFingerprint",
  "runtime",
  "sourceFingerprint",
  "loweringFingerprint",
  "requestFingerprint",
  "startedAt",
] as const;

const ATTEMPT_FIELDS = [
  ...identityKeys,
  "schemaVersion",
  "phase",
  "caseSha256",
  "caseUri",
  "receiptSha256",
  "quarantineReason",
  "rejectionCode",
] as const;

function parseIdentity(value: unknown): PrescribedKinematicsObservationAttemptIdentity {
  const root = exactRecord(
    value,
    identityKeys,
    "$prescribedKinematicsAttemptIdentity",
  );
  return parseIdentityFields(root);
}

function parseIdentityFields(
  root: Record<string, unknown>,
): PrescribedKinematicsObservationAttemptIdentity {
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
    caseFingerprint: fingerprint(root.caseFingerprint, "caseFingerprint"),
    runtime: runtime(root.runtime),
    sourceFingerprint: fingerprint(root.sourceFingerprint, "sourceFingerprint"),
    loweringFingerprint: fingerprint(root.loweringFingerprint, "loweringFingerprint"),
    requestFingerprint: fingerprint(root.requestFingerprint, "requestFingerprint"),
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
  const root = exactRecord(value, ["caseSha256", "caseUri"], "$submittedCase");
  return parseSubmittedFields(root);
}

function parseSubmittedFields(
  root: Record<string, unknown>,
): { readonly caseSha256: string; readonly caseUri: string } {
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
  if (
    current.projectId !== identity.projectId ||
    current.agentRunId !== identity.agentRunId ||
    current.requestId !== identity.requestId ||
    current.startedAt !== identity.startedAt
  ) {
    throw integrity("The L3 WAL identity conflicts with the resumed run.");
  }
  for (
    const [recorded, resumed] of [
      [current.caseFingerprint, identity.caseFingerprint],
      [current.sourceFingerprint, identity.sourceFingerprint],
      [current.loweringFingerprint, identity.loweringFingerprint],
      [current.requestFingerprint, identity.requestFingerprint],
    ] as const
  ) {
    if (!fingerprintsEqual(recorded, resumed)) {
      throw integrity("The L3 WAL identity conflicts with the resumed run.");
    }
  }
  if (deterministicJson(current.runtime) !== deterministicJson(identity.runtime)) {
    throw integrity("The L3 WAL runtime provenance conflicts with the resumed run.");
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
    caseFingerprint: current.caseFingerprint,
    runtime: current.runtime,
    sourceFingerprint: current.sourceFingerprint,
    loweringFingerprint: current.loweringFingerprint,
    requestFingerprint: current.requestFingerprint,
    startedAt: current.startedAt,
  };
}

function runtime(value: unknown): PrescribedKinematicsRuntimeProvenance {
  const root = exactRecord(value, [
    "resolvedOperationPlanFingerprint",
    "operationalCapabilityFingerprint",
    "binding",
    "adapter",
    "profile",
    "material",
    "launchGroup",
    "platformMode",
  ], "$runtime");
  const binding = exactRecord(root.binding, ["id", "version"], "$runtime.binding");
  const adapter = exactRecord(
    root.adapter,
    ["id", "version", "source"],
    "$runtime.adapter",
  );
  const profile = root.profile === null
    ? null
    : exactRecord(root.profile, ["id", "version", "fingerprint"], "$runtime.profile");
  const material = exactRecord(
    root.material,
    ["unitId", "materialId", "imageDigest"],
    "$runtime.material",
  );
  if (
    root.platformMode !== "native" && root.platformMode !== "emulated" &&
    root.platformMode !== "unavailable"
  ) {
    throw integrity("The L3 WAL runtime platform mode is unsupported.");
  }
  return Object.freeze({
    resolvedOperationPlanFingerprint: fingerprint(
      root.resolvedOperationPlanFingerprint,
      "runtime.resolvedOperationPlanFingerprint",
    ),
    operationalCapabilityFingerprint: fingerprint(
      root.operationalCapabilityFingerprint,
      "runtime.operationalCapabilityFingerprint",
    ),
    binding: {
      id: safeId(binding.id, "$runtime.binding.id"),
      version: exactVersionToken(binding.version, "$runtime.binding.version"),
    },
    adapter: {
      id: safeId(adapter.id, "$runtime.adapter.id"),
      version: exactVersionToken(adapter.version, "$runtime.adapter.version"),
      source: text(adapter.source, "$runtime.adapter.source"),
    },
    profile: profile === null ? null : {
      id: safeId(profile.id, "$runtime.profile.id"),
      version: exactVersionToken(profile.version, "$runtime.profile.version"),
      fingerprint: profile.fingerprint === null
        ? null
        : fingerprint(profile.fingerprint, "$runtime.profile.fingerprint"),
    },
    material: {
      unitId: safeId(material.unitId, "$runtime.material.unitId"),
      materialId: safeId(material.materialId, "$runtime.material.materialId"),
      imageDigest: sha(material.imageDigest),
    },
    launchGroup: validateCapabilityRuntimeLaunchGroupReference(
      root.launchGroup,
      "$runtime.launchGroup",
    ),
    platformMode: root.platformMode,
  });
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
  return current;
}
function sha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw integrity("The L3 WAL SHA-256 identity is invalid.");
  }
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw integrity(`${path} must be non-empty text.`);
  }
  return value;
}

function parseRejectionCode(
  value: unknown,
): PrescribedKinematicsPreDispatchRejectionCode {
  switch (value) {
    case "case_invalid":
    case "case_not_found":
    case "case_sha256_mismatch":
    case "case_uri_mismatch":
    case "invalid_case_json":
    case "invalid_request_id":
    case "invalid_sample_limit":
    case "invalid_sample_offset":
    case "invalid_timeout":
    case "request_conflict":
      return value;
    default:
      throw integrity(
        "The L3 rejection code is not a published definite pre-dispatch Chrono error.",
      );
  }
}
function freeze<T>(value: T): T {
  return Object.freeze(value);
}
function integrity(
  message: string,
): PrescribedKinematicsObservationAttemptIntegrityError {
  return new PrescribedKinematicsObservationAttemptIntegrityError(message);
}
