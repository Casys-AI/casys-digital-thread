/** Durable, append-only local WAL for one runtime qualification candidate. */

import type {
  CapabilityRuntimeQualificationAttempt,
  CapabilityRuntimeQualificationAttemptIdentity,
  CapabilityRuntimeQualificationAttemptKey,
  CapabilityRuntimeQualificationAttemptOutcome,
  CapabilityRuntimeQualificationAttemptStore,
  CapabilityRuntimeQualificationDispatchingAttempt,
} from "../../application/ports/out/capability/capability-runtime-qualification-attempt-store.ts";
import {
  type CapabilityRuntimeObservedHost,
  fingerprintCapabilityRuntimeObservedHost,
} from "../../domain/capability/runtime/capability-runtime-binding-qualification-attestation.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  isDurableAttemptTemporaryFileName,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";

const SCHEMA = "capability-runtime-qualification-attempt/1.0" as const;
const DEFAULT_DIRECTORY = "state/local/capability-runtime-host/qualification-attempts";

type AttemptBase = CapabilityRuntimeQualificationAttemptIdentity & {
  readonly schemaVersion: typeof SCHEMA;
};

const IDENTITY_FIELDS = [
  "candidate",
  "observedHost",
  "requestId",
  "sourceFingerprint",
  "loweringFingerprint",
  "caseFingerprint",
  "requestFingerprint",
  "preparedAt",
] as const;

export class CapabilityRuntimeQualificationAttemptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeQualificationAttemptIntegrityError";
  }
}

/**
 * A state is a content-addressed event, never a mutable row. The separate
 * dispatch-claim is deliberately written first: if the process stops between
 * claim and event publication, `read` reconstructs dispatching from the claim
 * and no continuation can call Chrono a second time.
 */
export class FileCapabilityRuntimeQualificationAttemptStore
  implements CapabilityRuntimeQualificationAttemptStore {
  readonly #directory: string;

  constructor(directory = DEFAULT_DIRECTORY) {
    if (!directory || directory === "/" || directory.includes("\0")) {
      throw new TypeError(
        "Capability runtime qualification attempt directory is invalid.",
      );
    }
    this.#directory = directory.replace(/\/+$/, "");
  }

  async read(
    keyValue: CapabilityRuntimeQualificationAttemptKey,
  ): Promise<CapabilityRuntimeQualificationAttempt | undefined> {
    const key = parseKey(keyValue);
    const base = await this.#basePath(key);
    const basename = base.slice(base.lastIndexOf("/") + 1);
    const eventPrefix = `${basename}.event-`;
    const claimPrefix = `${basename}.dispatch-claim-`;
    const events: CapabilityRuntimeQualificationAttempt[] = [];
    const claims: CapabilityRuntimeQualificationDispatchingAttempt[] = [];
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(this.#directory));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    for (
      const entry of entries.toSorted((left, right) =>
        left.name.localeCompare(right.name)
      )
    ) {
      if (entry.isFile && isDurableAttemptTemporaryFileName(entry.name)) continue;
      const isEvent = entry.name.startsWith(eventPrefix) &&
        entry.name.endsWith(".json");
      const isClaim = entry.name.startsWith(claimPrefix) &&
        entry.name.endsWith(".json");
      if (!entry.isFile || (!isEvent && !isClaim)) {
        throw integrity(
          `Capability runtime qualification WAL contains unsupported entry ${entry.name}.`,
        );
      }
      const attempt = await parseCanonicalAttempt(
        await Deno.readTextFile(`${this.#directory}/${entry.name}`),
        `Capability runtime qualification WAL entry ${entry.name}`,
      );
      assertKey(attempt, key);
      const expected = isEvent
        ? await this.#eventName(base, attempt)
        : await this.#claimName(base, dispatchingAttempt(attempt));
      if (entry.name !== expected) {
        throw integrity(
          `Capability runtime qualification WAL entry ${entry.name} has a noncanonical name.`,
        );
      }
      if (isClaim) {
        claims.push(dispatchingAttempt(attempt));
      } else {
        events.push(attempt);
      }
    }
    return resolveMonotoneAttempts(events, claims);
  }

  async prepare(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const existing = await this.read(keyFor(identity));
    if (existing) {
      assertSameIdentity(existing, identity);
      return existing;
    }
    return await this.#append(freeze({ ...base(identity), phase: "prepared" }));
  }

  async markActive(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly runtimeStartFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const runtimeStartFingerprint = parseFingerprint(
      input.runtimeStartFingerprint,
      "$runtimeStartFingerprint",
    );
    return await this.#transition(identity, (current) => {
      if (current.phase === "prepared") {
        return freeze({ ...base(current), phase: "active", runtimeStartFingerprint });
      }
      assertActive(current, runtimeStartFingerprint);
      return current;
    });
  }

  async markCaseSubmitted(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly caseSha256: string; readonly caseUri: string },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    return await this.#transition(identity, (current) => {
      if (current.phase === "active") {
        const submitted = parseSubmission(
          input,
          identity.caseFingerprint,
          "$submittedCase",
        );
        return freeze({
          ...base(current),
          phase: "case-submitted",
          ...activeFields(current),
          ...submitted,
        });
      }
      if (current.phase === "prepared") {
        throw integrity(
          "Qualification case submission cannot precede a durable runtime start.",
        );
      }
      assertSubmitted(current, input, identity.caseFingerprint);
      return current;
    });
  }

  async claimDispatching(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
  ): Promise<
    | {
      readonly attempt: CapabilityRuntimeQualificationDispatchingAttempt;
      readonly dispatchNow: true;
    }
    | {
      readonly attempt: CapabilityRuntimeQualificationAttempt;
      readonly dispatchNow: false;
    }
  > {
    const identity = await parseIdentity(identityValue);
    const current = await this.read(keyFor(identity));
    if (!current) {
      throw integrity("Qualification dispatch cannot precede durable preparation.");
    }
    assertSameIdentity(current, identity);
    if (current.phase !== "case-submitted") {
      return { attempt: current, dispatchNow: false };
    }
    const dispatching = freeze({
      ...base(current),
      phase: "dispatching" as const,
      ...activeFields(current),
      ...submittedFields(current),
    });
    const claimedNow = await this.#claim(dispatching);
    // This event is a readable mirror of the durable claim. If its publication
    // fails, recovery still sees the claim and therefore refuses redispatch.
    await this.#append(dispatching);
    const observed = await this.read(keyFor(identity));
    if (!observed || observed.phase !== "dispatching") {
      throw integrity("Qualification dispatch claim did not become recoverable.");
    }
    return claimedNow
      ? { attempt: observed, dispatchNow: true }
      : { attempt: observed, dispatchNow: false };
  }

  async markRecorded(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly receiptFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const receiptFingerprint = parseFingerprint(
      input.receiptFingerprint,
      "$receiptFingerprint",
    );
    return await this.#transition(identity, (current) => {
      if (current.phase === "recorded") {
        assertFingerprint(current.receiptFingerprint, receiptFingerprint, "receipt");
        return current;
      }
      if (current.phase !== "dispatching" && current.phase !== "quarantined") {
        throw integrity(
          "Qualification readback cannot precede the durable dispatch claim.",
        );
      }
      return freeze({
        ...base(current),
        phase: "recorded",
        ...activeFields(current),
        ...submittedFields(current),
        receiptFingerprint,
      });
    });
  }

  async markQuarantined(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly reason: "uncertain" | "absent" | "malformed" },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const quarantineReason = quarantineReasonOf(input.reason);
    return await this.#transition(identity, (current) => {
      if (current.phase === "recorded") return current;
      if (current.phase === "quarantined") {
        if (current.quarantineReason !== quarantineReason) {
          throw integrity("Qualification quarantine reason cannot be rewritten.");
        }
        return current;
      }
      if (current.phase !== "dispatching") {
        throw integrity("Only a claimed qualification request can be quarantined.");
      }
      return freeze({
        ...base(current),
        phase: "quarantined",
        ...activeFields(current),
        ...submittedFields(current),
        quarantineReason,
      });
    });
  }

  async markOutcome(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    value: CapabilityRuntimeQualificationAttemptOutcome,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const outcome = parseOutcome(value, "$qualificationOutcome");
    return await this.#transition(identity, (current) => {
      if (
        current.phase === "outcome" || current.phase === "stopped" ||
        current.phase === "attested"
      ) {
        assertOutcome(current.outcome, outcome);
        return current;
      }
      if (current.phase === "recorded") {
        if (outcome.basis !== "recorded") {
          throw integrity(
            "Recorded qualification readback requires a recorded outcome basis.",
          );
        }
      } else if (current.phase === "quarantined") {
        if (outcome.basis !== "quarantined" || outcome.status !== "unavailable") {
          throw integrity(
            "A quarantined qualification can only record an unavailable outcome.",
          );
        }
      } else {
        throw integrity(
          "Qualification outcome cannot precede recorded or quarantined readback.",
        );
      }
      if (outcome.status === "qualified" && current.phase !== "recorded") {
        throw integrity("Only full recorded readback can qualify a runtime.");
      }
      return freeze({
        ...base(current),
        phase: "outcome",
        ...activeFields(current),
        ...submittedFields(current),
        outcome,
      });
    });
  }

  async markStopped(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly runtimeStopFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const runtimeStopFingerprint = parseFingerprint(
      input.runtimeStopFingerprint,
      "$runtimeStopFingerprint",
    );
    return await this.#transition(identity, (current) => {
      if (current.phase === "stopped" || current.phase === "attested") {
        assertFingerprint(
          current.runtimeStopFingerprint,
          runtimeStopFingerprint,
          "runtime stop",
        );
        return current;
      }
      if (current.phase !== "outcome") {
        throw integrity(
          "Qualification runtime stop cannot precede its operational outcome.",
        );
      }
      return freeze({
        ...base(current),
        phase: "stopped",
        ...activeFields(current),
        ...submittedFields(current),
        outcome: current.outcome,
        runtimeStopFingerprint,
      });
    });
  }

  async markAttested(
    identityValue: CapabilityRuntimeQualificationAttemptIdentity,
    input: { readonly attestationFingerprint: ContentFingerprint },
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await parseIdentity(identityValue);
    const attestationFingerprint = parseFingerprint(
      input.attestationFingerprint,
      "$attestationFingerprint",
    );
    return await this.#transition(identity, (current) => {
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
      if (
        current.outcome.status !== "qualified" || current.outcome.basis !== "recorded"
      ) {
        throw integrity("Only a recorded qualified outcome can create an attestation.");
      }
      return freeze({
        ...base(current),
        phase: "attested",
        ...activeFields(current),
        ...submittedFields(current),
        outcome: current.outcome,
        runtimeStopFingerprint: current.runtimeStopFingerprint,
        attestationFingerprint,
      });
    });
  }

  async #transition(
    identity: CapabilityRuntimeQualificationAttemptIdentity,
    transition: (
      current: CapabilityRuntimeQualificationAttempt,
    ) => CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const current = await this.read(keyFor(identity));
    if (!current) throw integrity("Capability runtime qualification WAL is absent.");
    assertSameIdentity(current, identity);
    const next = transition(current);
    if (deterministicJson(next) === deterministicJson(current)) return current;
    return await this.#append(next);
  }

  async #append(
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<CapabilityRuntimeQualificationAttempt> {
    const identity = await identityFromAttempt(attempt);
    const base = await this.#basePath(keyFor(identity));
    const path = `${this.#directory}/${await this.#eventName(base, attempt)}`;
    const text = `${deterministicJson(attempt)}\n`;
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        this.#directory,
        "Capability runtime qualification WAL write made no progress.",
      );
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await Deno.readTextFile(path);
      if (existing !== text) {
        throw integrity(
          "Capability runtime qualification WAL event collides with divergent content.",
        );
      }
    }
    const observed = await this.read(keyFor(identity));
    if (!observed) {
      throw integrity("Capability runtime qualification WAL append was not readable.");
    }
    return observed;
  }

  async #claim(
    attempt: CapabilityRuntimeQualificationDispatchingAttempt,
  ): Promise<boolean> {
    const identity = await identityFromAttempt(attempt);
    const base = await this.#basePath(keyFor(identity));
    const path = `${this.#directory}/${await this.#claimName(base, attempt)}`;
    const text = `${deterministicJson(attempt)}\n`;
    await Deno.mkdir(this.#directory, { recursive: true, mode: 0o700 });
    try {
      await writeNewAttemptFileDurably(
        path,
        text,
        this.#directory,
        "Capability runtime qualification dispatch claim made no progress.",
      );
      return true;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw integrity(
          "Capability runtime qualification dispatch claim conflicts with existing intent.",
        );
      }
      return false;
    }
  }

  async #basePath(key: CapabilityRuntimeQualificationAttemptKey): Promise<string> {
    const digest = await sha256Hex(new TextEncoder().encode(deterministicJson({
      candidateId: key.candidateId,
      candidateFingerprint: key.candidateFingerprint,
      observedHostFingerprint: key.observedHostFingerprint,
    })));
    return `${this.#directory}/${digest}`;
  }

  async #eventName(
    base: string,
    attempt: CapabilityRuntimeQualificationAttempt,
  ): Promise<string> {
    const digest = await sha256Hex(
      new TextEncoder().encode(deterministicJson(attempt)),
    );
    return `${
      base.slice(base.lastIndexOf("/") + 1)
    }.event-${attempt.phase}-${digest}.json`;
  }

  async #claimName(
    base: string,
    attempt: CapabilityRuntimeQualificationDispatchingAttempt,
  ): Promise<string> {
    const digest = await sha256Hex(
      new TextEncoder().encode(deterministicJson(attempt)),
    );
    return `${base.slice(base.lastIndexOf("/") + 1)}.dispatch-claim-${digest}.json`;
  }
}

function resolveMonotoneAttempts(
  events: readonly CapabilityRuntimeQualificationAttempt[],
  claims: readonly CapabilityRuntimeQualificationDispatchingAttempt[],
): CapabilityRuntimeQualificationAttempt | undefined {
  if (events.length === 0 && claims.length === 0) return undefined;
  const byPhase = new Map<
    CapabilityRuntimeQualificationAttempt["phase"],
    CapabilityRuntimeQualificationAttempt
  >();
  for (const event of events) {
    const prior = byPhase.get(event.phase);
    if (prior && deterministicJson(prior) !== deterministicJson(event)) {
      throw integrity(
        "Capability runtime qualification WAL has conflicting phase events.",
      );
    }
    byPhase.set(event.phase, event);
  }
  const claim = exactlyOneClaim(claims);
  const dispatchEvent = byPhase.get("dispatching");
  if (claim) {
    if (
      dispatchEvent && deterministicJson(claim) !== deterministicJson(dispatchEvent)
    ) {
      throw integrity(
        "Capability runtime qualification dispatch claim conflicts with its event.",
      );
    }
    byPhase.set("dispatching", claim);
  }
  const prepared = byPhase.get("prepared");
  if (!prepared || prepared.phase !== "prepared") {
    throw integrity(
      "Capability runtime qualification WAL has transitions without preparation.",
    );
  }
  for (const attempt of [...events, ...claims]) {
    assertSameIdentity(attempt, prepared);
  }
  const active = byPhase.get("active");
  const submitted = byPhase.get("case-submitted");
  const dispatching = byPhase.get("dispatching");
  const recorded = byPhase.get("recorded");
  const quarantined = byPhase.get("quarantined");
  const outcome = byPhase.get("outcome") as
    | Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "outcome" }
    >
    | undefined;
  const stopped = byPhase.get("stopped") as
    | Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "stopped" }
    >
    | undefined;
  const attested = byPhase.get("attested") as
    | Extract<
      CapabilityRuntimeQualificationAttempt,
      { readonly phase: "attested" }
    >
    | undefined;
  if (
    !active &&
    (submitted || dispatching || recorded || quarantined || outcome || stopped ||
      attested)
  ) {
    throw integrity(
      "Capability runtime qualification WAL has a transition before runtime activation.",
    );
  }
  if (
    !submitted &&
    (dispatching || recorded || quarantined || outcome || stopped || attested)
  ) {
    throw integrity(
      "Capability runtime qualification WAL has a transition before case submission.",
    );
  }
  if (!dispatching && (recorded || quarantined || outcome || stopped || attested)) {
    throw integrity(
      "Capability runtime qualification WAL has a result before dispatch claim.",
    );
  }
  if (dispatching && !claim) {
    throw integrity(
      "Capability runtime qualification dispatch event lacks its durable claim.",
    );
  }
  if (!recorded && !quarantined && (outcome || stopped || attested)) {
    throw integrity(
      "Capability runtime qualification WAL has a terminal action without readback.",
    );
  }
  if (!outcome && (stopped || attested)) {
    throw integrity("Capability runtime qualification WAL has a stop without outcome.");
  }
  if (!stopped && attested) {
    throw integrity(
      "Capability runtime qualification WAL attests before runtime stop.",
    );
  }
  if (outcome) assertOutcomeBasis(outcome, recorded, quarantined);
  if (attested) {
    if (
      attested.outcome.status !== "qualified" || attested.outcome.basis !== "recorded"
    ) {
      throw integrity(
        "Capability runtime qualification WAL attests an unqualified outcome.",
      );
    }
  }
  return attested ?? stopped ?? outcome ?? recorded ?? quarantined ?? dispatching ??
    submitted ?? active ?? prepared;
}

function exactlyOneClaim(
  claims: readonly CapabilityRuntimeQualificationDispatchingAttempt[],
): CapabilityRuntimeQualificationDispatchingAttempt | undefined {
  if (claims.length === 0) return undefined;
  const [first] = claims;
  if (!first) return undefined;
  if (claims.some((claim) => deterministicJson(claim) !== deterministicJson(first))) {
    throw integrity(
      "Capability runtime qualification WAL contains competing dispatch claims.",
    );
  }
  return first;
}

async function parseCanonicalAttempt(
  text: string,
  label: string,
): Promise<CapabilityRuntimeQualificationAttempt> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw integrity(`${label} is not JSON.`);
  }
  const attempt = await parseAttempt(parsed, label);
  if (`${deterministicJson(attempt)}\n` !== text) {
    throw integrity(`${label} is not canonical JSON.`);
  }
  return attempt;
}

async function parseAttempt(
  value: unknown,
  path: string,
): Promise<CapabilityRuntimeQualificationAttempt> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw integrity(`${path} must be an object.`);
  }
  const phase = (value as Record<string, unknown>).phase;
  const root = exactRecord(value, fieldsForPhase(phase), path);
  literalValue(root.schemaVersion, SCHEMA, `${path}.schemaVersion`);
  const identity = await parseIdentityFields(root, path);
  if (phase === "prepared") return freeze({ ...base(identity), phase: "prepared" });
  const runtimeStartFingerprint = parseFingerprint(
    root.runtimeStartFingerprint,
    `${path}.runtimeStartFingerprint`,
  );
  if (phase === "active") {
    return freeze({ ...base(identity), phase: "active", runtimeStartFingerprint });
  }
  const submitted = parseSubmission(
    { caseSha256: root.caseSha256, caseUri: root.caseUri },
    identity.caseFingerprint,
    path,
  );
  if (phase === "case-submitted" || phase === "dispatching") {
    return freeze({
      ...base(identity),
      phase: phase === "case-submitted" ? "case-submitted" : "dispatching",
      runtimeStartFingerprint,
      ...submitted,
    });
  }
  if (phase === "recorded") {
    return freeze({
      ...base(identity),
      phase: "recorded",
      runtimeStartFingerprint,
      ...submitted,
      receiptFingerprint: parseFingerprint(
        root.receiptFingerprint,
        `${path}.receiptFingerprint`,
      ),
    });
  }
  if (phase === "quarantined") {
    return freeze({
      ...base(identity),
      phase: "quarantined",
      runtimeStartFingerprint,
      ...submitted,
      quarantineReason: quarantineReasonOf(root.quarantineReason),
    });
  }
  const outcome = parseOutcome(root.outcome, `${path}.outcome`);
  if (phase === "outcome") {
    return freeze({
      ...base(identity),
      phase: "outcome",
      runtimeStartFingerprint,
      ...submitted,
      outcome,
    });
  }
  const runtimeStopFingerprint = parseFingerprint(
    root.runtimeStopFingerprint,
    `${path}.runtimeStopFingerprint`,
  );
  if (phase === "stopped") {
    return freeze({
      ...base(identity),
      phase: "stopped",
      runtimeStartFingerprint,
      ...submitted,
      outcome,
      runtimeStopFingerprint,
    });
  }
  if (phase === "attested") {
    return freeze({
      ...base(identity),
      phase: "attested",
      runtimeStartFingerprint,
      ...submitted,
      outcome,
      runtimeStopFingerprint,
      attestationFingerprint: parseFingerprint(
        root.attestationFingerprint,
        `${path}.attestationFingerprint`,
      ),
    });
  }
  throw integrity(`${path}.phase is unsupported.`);
}

function fieldsForPhase(value: unknown): readonly string[] {
  const base = [...IDENTITY_FIELDS, "schemaVersion", "phase"] as string[];
  if (value === "prepared") return base;
  if (value === "active") return [...base, "runtimeStartFingerprint"];
  if (value === "case-submitted" || value === "dispatching") {
    return [...base, "runtimeStartFingerprint", "caseSha256", "caseUri"];
  }
  if (value === "recorded") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "receiptFingerprint",
    ];
  }
  if (value === "quarantined") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "quarantineReason",
    ];
  }
  if (value === "outcome") {
    return [...base, "runtimeStartFingerprint", "caseSha256", "caseUri", "outcome"];
  }
  if (value === "stopped") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "outcome",
      "runtimeStopFingerprint",
    ];
  }
  if (value === "attested") {
    return [
      ...base,
      "runtimeStartFingerprint",
      "caseSha256",
      "caseUri",
      "outcome",
      "runtimeStopFingerprint",
      "attestationFingerprint",
    ];
  }
  throw integrity("Capability runtime qualification WAL phase is unsupported.");
}

async function parseIdentity(
  value: CapabilityRuntimeQualificationAttemptIdentity,
): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
  const root = exactRecord(
    value,
    IDENTITY_FIELDS,
    "$capabilityRuntimeQualificationAttemptIdentity",
  );
  return await parseIdentityFields(
    root,
    "$capabilityRuntimeQualificationAttemptIdentity",
  );
}

async function identityFromAttempt(
  value: CapabilityRuntimeQualificationAttempt,
): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
  return await parseIdentityFields(
    value as unknown as Record<string, unknown>,
    "$capabilityRuntimeQualificationAttempt",
  );
}

async function parseIdentityFields(
  value: Record<string, unknown>,
  path: string,
): Promise<CapabilityRuntimeQualificationAttemptIdentity> {
  const candidate = exactRecord(
    value.candidate,
    ["id", "fingerprint"],
    `${path}.candidate`,
  );
  const observedHost = await parseObservedHost(
    value.observedHost,
    `${path}.observedHost`,
  );
  return freeze({
    candidate: {
      id: safeId(candidate.id, `${path}.candidate.id`),
      fingerprint: parseFingerprint(
        candidate.fingerprint,
        `${path}.candidate.fingerprint`,
      ),
    },
    observedHost,
    requestId: safeId(value.requestId, `${path}.requestId`),
    sourceFingerprint: parseFingerprint(
      value.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    loweringFingerprint: parseFingerprint(
      value.loweringFingerprint,
      `${path}.loweringFingerprint`,
    ),
    caseFingerprint: parseFingerprint(value.caseFingerprint, `${path}.caseFingerprint`),
    requestFingerprint: parseFingerprint(
      value.requestFingerprint,
      `${path}.requestFingerprint`,
    ),
    preparedAt: timestamp(value.preparedAt, `${path}.preparedAt`),
  });
}

async function parseObservedHost(
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
  const identityFingerprint = parseFingerprint(
    root.identityFingerprint,
    `${path}.identityFingerprint`,
  );
  const fingerprint = parseFingerprint(root.fingerprint, `${path}.fingerprint`);
  const expected = await fingerprintCapabilityRuntimeObservedHost(
    root.platform,
    identityFingerprint,
  );
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw integrity(`${path}.fingerprint is not canonical.`);
  }
  return freeze({ identityFingerprint, platform: root.platform, fingerprint });
}

function parseKey(
  value: CapabilityRuntimeQualificationAttemptKey,
): CapabilityRuntimeQualificationAttemptKey {
  return freeze({
    candidateId: safeId(value.candidateId, "$qualificationAttemptKey.candidateId"),
    candidateFingerprint: parseFingerprint(
      value.candidateFingerprint,
      "$qualificationAttemptKey.candidateFingerprint",
    ),
    observedHostFingerprint: parseFingerprint(
      value.observedHostFingerprint,
      "$qualificationAttemptKey.observedHostFingerprint",
    ),
  });
}

function keyFor(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): CapabilityRuntimeQualificationAttemptKey {
  return freeze({
    candidateId: identity.candidate.id,
    candidateFingerprint: identity.candidate.fingerprint,
    observedHostFingerprint: identity.observedHost.fingerprint,
  });
}

function parseSubmission(
  value: { readonly caseSha256: unknown; readonly caseUri: unknown },
  caseFingerprint: ContentFingerprint,
  path: string,
): { readonly caseSha256: string; readonly caseUri: string } {
  const caseSha256 = sha256(value.caseSha256, `${path}.caseSha256`);
  if (caseSha256 !== caseFingerprint.digest) {
    throw integrity(`${path}.caseSha256 does not bind the exact lowered case.`);
  }
  const caseUri = typeof value.caseUri === "string" &&
      value.caseUri === `chrono-case:sha256:${caseSha256}`
    ? value.caseUri
    : (() => {
      throw integrity(`${path}.caseUri is not bound to its exact case SHA-256.`);
    })();
  return freeze({ caseSha256, caseUri });
}

function parseOutcome(
  value: unknown,
  path: string,
): CapabilityRuntimeQualificationAttemptOutcome {
  const root = exactRecord(value, ["status", "basis", "fingerprint"], path);
  if (
    root.status !== "qualified" && root.status !== "failed" &&
    root.status !== "unavailable"
  ) throw integrity(`${path}.status is unsupported.`);
  if (root.basis !== "recorded" && root.basis !== "quarantined") {
    throw integrity(`${path}.basis is unsupported.`);
  }
  if (root.basis === "quarantined" && root.status !== "unavailable") {
    throw integrity(`${path}.quarantined basis requires unavailable status.`);
  }
  return freeze({
    status: root.status,
    basis: root.basis,
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

function base(
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): AttemptBase {
  return {
    schemaVersion: SCHEMA,
    candidate: identity.candidate,
    observedHost: identity.observedHost,
    requestId: identity.requestId,
    sourceFingerprint: identity.sourceFingerprint,
    loweringFingerprint: identity.loweringFingerprint,
    caseFingerprint: identity.caseFingerprint,
    requestFingerprint: identity.requestFingerprint,
    preparedAt: identity.preparedAt,
  };
}

function activeFields(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" }
  >,
): { readonly runtimeStartFingerprint: ContentFingerprint } {
  return { runtimeStartFingerprint: attempt.runtimeStartFingerprint };
}

function submittedFields(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" | "active" }
  >,
): { readonly caseSha256: string; readonly caseUri: string } {
  return { caseSha256: attempt.caseSha256, caseUri: attempt.caseUri };
}

function dispatchingAttempt(
  attempt: CapabilityRuntimeQualificationAttempt,
): CapabilityRuntimeQualificationDispatchingAttempt {
  if (attempt.phase !== "dispatching") {
    throw integrity(
      "Only a dispatching qualification attempt can be a dispatch claim.",
    );
  }
  return attempt;
}

function assertSameIdentity(
  attempt: CapabilityRuntimeQualificationAttempt,
  identity: CapabilityRuntimeQualificationAttemptIdentity,
): void {
  const existing = base(attempt);
  const expected = base(identity);
  if (deterministicJson(existing) !== deterministicJson(expected)) {
    throw integrity(
      "Capability runtime qualification WAL identity conflicts with resumed work.",
    );
  }
}

function assertKey(
  attempt: CapabilityRuntimeQualificationAttempt,
  key: CapabilityRuntimeQualificationAttemptKey,
): void {
  if (
    attempt.candidate.id !== key.candidateId ||
    !fingerprintsEqual(attempt.candidate.fingerprint, key.candidateFingerprint) ||
    !fingerprintsEqual(attempt.observedHost.fingerprint, key.observedHostFingerprint)
  ) {
    throw integrity(
      "Capability runtime qualification WAL key does not match its body.",
    );
  }
}

function assertActive(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" }
  >,
  expected: ContentFingerprint,
): void {
  assertFingerprint(attempt.runtimeStartFingerprint, expected, "runtime start");
}

function assertSubmitted(
  attempt: Exclude<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "prepared" | "active" }
  >,
  input: { readonly caseSha256: string; readonly caseUri: string },
  caseFingerprint: ContentFingerprint,
): void {
  const expected = parseSubmission(input, caseFingerprint, "$submittedCase");
  if (
    attempt.caseSha256 !== expected.caseSha256 || attempt.caseUri !== expected.caseUri
  ) {
    throw integrity(
      "Capability runtime qualification submitted case conflicts with WAL.",
    );
  }
}

function assertOutcome(
  left: CapabilityRuntimeQualificationAttemptOutcome,
  right: CapabilityRuntimeQualificationAttemptOutcome,
): void {
  if (deterministicJson(left) !== deterministicJson(right)) {
    throw integrity("Capability runtime qualification outcome cannot be rewritten.");
  }
}

function assertOutcomeBasis(
  outcome: Extract<
    CapabilityRuntimeQualificationAttempt,
    { readonly phase: "outcome" }
  >,
  recorded: CapabilityRuntimeQualificationAttempt | undefined,
  quarantined: CapabilityRuntimeQualificationAttempt | undefined,
): void {
  if (
    outcome.outcome.basis === "recorded" && (!recorded || recorded.phase !== "recorded")
  ) {
    throw integrity(
      "Capability runtime qualification outcome claims missing recorded readback.",
    );
  }
  if (
    outcome.outcome.basis === "quarantined" &&
    (!quarantined || quarantined.phase !== "quarantined")
  ) {
    throw integrity(
      "Capability runtime qualification outcome claims missing quarantine.",
    );
  }
}

function assertFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
  label: string,
): void {
  if (!fingerprintsEqual(left, right)) {
    throw integrity(`Capability runtime qualification ${label} conflicts with WAL.`);
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return freeze({
    algorithm: "sha256" as const,
    digest: sha256(root.digest, `${path}.digest`),
  });
}

function timestamp(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  const date = new Date(text);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== text) {
    throw integrity(`${path} must be an exact ISO timestamp.`);
  }
  return text;
}

function quarantineReasonOf(value: unknown): "uncertain" | "absent" | "malformed" {
  if (value === "uncertain" || value === "absent" || value === "malformed") {
    return value;
  }
  throw integrity("Capability runtime qualification quarantine reason is unsupported.");
}

function sha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw integrity(`${path} must be lowercase SHA-256.`);
  }
  return value;
}

function freeze<T>(value: T): T {
  return deepFreeze(value);
}

function integrity(
  message: string,
): CapabilityRuntimeQualificationAttemptIntegrityError {
  return new CapabilityRuntimeQualificationAttemptIntegrityError(message);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    (error instanceof Error && error.name === "NotFound");
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Deno.errors.AlreadyExists ||
    (error instanceof Error && /already exists/i.test(error.message));
}
