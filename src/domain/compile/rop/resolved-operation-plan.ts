/**
 * Inspectable, sealed translation from an engineering intent to provider work.
 *
 * This is a pure domain contract, never an MCP wire envelope. It has no
 * first-class endpoint, header, credential, transport, or filesystem-path
 * fields. The code-owned resolver defines the meaning of semantic arguments;
 * an adapter creates the ephemeral provider envelope only after loading and
 * revalidating this immutable plan.
 */

import {
  deepFreeze,
  exactRecord,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const RESOLVED_OPERATION_PLAN_SCHEMA = "resolved-operation-plan/1.0" as const;

export interface ResolvedOperationPlan {
  readonly schemaVersion: typeof RESOLVED_OPERATION_PLAN_SCHEMA;
  readonly planId: string;
  readonly operation: { readonly id: string; readonly version: string };
  /** Exact reviewed basis; aliases such as `latest` are not representable. */
  readonly basis: ResolvedOperationPlanBasis;
  /** Canonical ASCII order by id. Same role is intentionally allowed. */
  readonly sourceRefs: readonly ResolvedOperationPlanSourceRef[];
  /** Canonical ASCII order by id. */
  readonly analysisRefs: readonly ResolvedOperationPlanAnalysisRef[];
  /** Canonical ASCII order by assertionId. */
  readonly admissionRefs: readonly ResolvedOperationPlanAdmissionRef[];
  readonly policy: ResolvedOperationPlanPolicy;
  /** Preserves the executable ordinal order; it is not an unordered set. */
  readonly dispatches: readonly ResolvedOperationPlanDispatch[];
}

export interface ResolvedOperationPlanApprovedBriefBasis {
  readonly kind: "approved-brief";
  readonly projectId: string;
  readonly projectSnapshotId: string;
  readonly projectRevision: number;
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly fingerprint: ContentFingerprint;
}

export interface ResolvedOperationPlanThreadSnapshotBasis {
  readonly kind: "thread-snapshot";
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
  readonly fingerprint: ContentFingerprint;
}

export type ResolvedOperationPlanBasis =
  | ResolvedOperationPlanApprovedBriefBasis
  | ResolvedOperationPlanThreadSnapshotBasis;

export interface ResolvedOperationPlanSourceRef {
  readonly id: string;
  readonly role: string;
  readonly fingerprint: ContentFingerprint;
}

/** An analysis must name the exact sealed source identity and bytes from which it was made. */
export interface ResolvedOperationPlanAnalysisRef {
  readonly id: string;
  readonly sourceRefId: string;
  readonly sourceFingerprint: ContentFingerprint;
  readonly fingerprint: ContentFingerprint;
}

/** Assertion bytes and the separate authority-admission record are both sealed. */
export interface ResolvedOperationPlanAdmissionRef {
  readonly assertionId: string;
  readonly assertionFingerprint: ContentFingerprint;
  readonly admissionFingerprint: ContentFingerprint;
}

export interface ResolvedOperationPlanPolicy {
  readonly profile: string;
  readonly status: "passed";
  /** Version 1.0 permits execution only with a clean report. */
  readonly findings: readonly [];
}

export interface ResolvedOperationPlanDispatch {
  readonly ordinal: number;
  readonly provider: { readonly id: string; readonly contractVersion: string };
  /** Versioned, code-owned lowering from semantic arguments to an MCP call. */
  readonly lowering: { readonly id: string; readonly version: string };
  readonly tool: string;
  /** Canonical ASCII order; all references resolve against already-known facts. */
  readonly inputRefs: readonly ResolvedOperationPlanInputRef[];
  readonly semanticArguments: Readonly<Record<string, JsonValue>>;
  /** Canonical ASCII order by kind then name. */
  readonly expectedOutputs: readonly ResolvedOperationPlanExpectedOutput[];
}

export type ResolvedOperationPlanInputRef =
  | { readonly kind: "source"; readonly id: string }
  | { readonly kind: "analysis"; readonly id: string }
  | { readonly kind: "admission"; readonly assertionId: string }
  | {
    readonly kind: "dispatch-output";
    readonly dispatchOrdinal: number;
    readonly outputName: string;
  };

export interface ResolvedOperationPlanExpectedOutput {
  readonly kind: string;
  readonly name: string;
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

const SHA256_HEX = /^[a-f0-9]{64}$/;
const ROOT_KEYS = [
  "schemaVersion",
  "planId",
  "operation",
  "basis",
  "sourceRefs",
  "analysisRefs",
  "admissionRefs",
  "policy",
  "dispatches",
] as const;

/**
 * Decode untrusted data into a deeply frozen plan. Structural validation is
 * fail-closed, and causal references are validated before the plan exists.
 */
export function validateResolvedOperationPlan(value: unknown): ResolvedOperationPlan {
  const root = strictRecord(value, ROOT_KEYS, "$plan");
  literal(root.schemaVersion, RESOLVED_OPERATION_PLAN_SCHEMA, "$plan.schemaVersion");
  const operationInput = strictRecord(
    root.operation,
    ["id", "version"],
    "$plan.operation",
  );

  const sourceRefs = nonEmptyStrictArray(root.sourceRefs, "$plan.sourceRefs").map(
    (item, index) => sourceRef(item, `$plan.sourceRefs[${index}]`),
  ).sort(compareSourceRefs);
  rejectDuplicates(sourceRefs.map((ref) => ref.id), "$plan.sourceRefs ids");
  const sourceRefsById = new Map(sourceRefs.map((ref) => [ref.id, ref]));

  const analysisRefs = strictArray(root.analysisRefs, "$plan.analysisRefs").map(
    (item, index) => analysisRef(item, `$plan.analysisRefs[${index}]`),
  ).sort((left, right) => asciiCompare(left.id, right.id));
  rejectDuplicates(analysisRefs.map((ref) => ref.id), "$plan.analysisRefs ids");
  for (const [index, analysis] of analysisRefs.entries()) {
    const source = sourceRefsById.get(analysis.sourceRefId);
    if (!source) {
      throw new TypeError(
        `$plan.analysisRefs[${index}].sourceRefId must name an existing sourceRefs id.`,
      );
    }
    if (
      fingerprintKey(source.fingerprint) !== fingerprintKey(analysis.sourceFingerprint)
    ) {
      throw new TypeError(
        `$plan.analysisRefs[${index}].sourceFingerprint must match the sourceRefs fingerprint for sourceRefId ${analysis.sourceRefId}.`,
      );
    }
  }

  const admissionRefs = strictArray(root.admissionRefs, "$plan.admissionRefs").map(
    (item, index) => admissionRef(item, `$plan.admissionRefs[${index}]`),
  ).sort((left, right) => asciiCompare(left.assertionId, right.assertionId));
  rejectDuplicates(
    admissionRefs.map((ref) => ref.assertionId),
    "$plan.admissionRefs assertionIds",
  );

  const dispatches = nonEmptyStrictArray(root.dispatches, "$plan.dispatches").map(
    (item, index) => dispatch(item, `$plan.dispatches[${index}]`),
  );
  const sourceIds = new Set(sourceRefs.map((ref) => ref.id));
  const analysisIds = new Set(analysisRefs.map((ref) => ref.id));
  const admissionIds = new Set(admissionRefs.map((ref) => ref.assertionId));
  dispatches.forEach((candidate, index) => {
    const ordinal = index + 1;
    if (candidate.ordinal !== ordinal) {
      throw new TypeError(
        `$plan.dispatches[${index}].ordinal must be ${ordinal} for a contiguous preserved execution order.`,
      );
    }
    validateDispatchInputs(
      candidate,
      sourceIds,
      analysisIds,
      admissionIds,
      dispatches.slice(0, index),
      `$plan.dispatches[${index}].inputRefs`,
    );
  });

  return deepFreeze({
    schemaVersion: RESOLVED_OPERATION_PLAN_SCHEMA,
    planId: safeId(root.planId, "$plan.planId"),
    operation: {
      id: safeId(operationInput.id, "$plan.operation.id"),
      version: nonEmptyText(operationInput.version, "$plan.operation.version"),
    },
    basis: basis(root.basis, "$plan.basis"),
    sourceRefs,
    analysisRefs,
    admissionRefs,
    policy: policy(root.policy, "$plan.policy"),
    dispatches,
  });
}

/** Revalidates unknown input before producing canonical text. */
export function canonicalResolvedOperationPlanText(value: unknown): string {
  return deterministicJson(validateResolvedOperationPlan(value));
}

/** Revalidates unknown input before calculating its SHA-256 content address. */
export async function fingerprintResolvedOperationPlan(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateResolvedOperationPlan(value));
}

function basis(value: unknown, path: string): ResolvedOperationPlanBasis {
  const kind = dataRecord(value, path).kind;
  if (kind === "approved-brief") {
    const input = strictRecord(
      value,
      [
        "kind",
        "projectId",
        "projectSnapshotId",
        "projectRevision",
        "briefId",
        "briefSnapshotId",
        "briefRevision",
        "fingerprint",
      ],
      path,
    );
    return {
      kind: "approved-brief",
      projectId: safeId(input.projectId, `${path}.projectId`),
      projectSnapshotId: safeId(input.projectSnapshotId, `${path}.projectSnapshotId`),
      projectRevision: positiveInteger(
        input.projectRevision,
        `${path}.projectRevision`,
      ),
      briefId: safeId(input.briefId, `${path}.briefId`),
      briefSnapshotId: safeId(input.briefSnapshotId, `${path}.briefSnapshotId`),
      briefRevision: positiveInteger(input.briefRevision, `${path}.briefRevision`),
      fingerprint: fingerprint(input.fingerprint, `${path}.fingerprint`),
    };
  }
  if (kind === "thread-snapshot") {
    const input = strictRecord(
      value,
      ["kind", "snapshotId", "revision", "subjectId", "fingerprint"],
      path,
    );
    return {
      kind: "thread-snapshot",
      snapshotId: safeId(input.snapshotId, `${path}.snapshotId`),
      revision: positiveInteger(input.revision, `${path}.revision`),
      subjectId: safeId(input.subjectId, `${path}.subjectId`),
      fingerprint: fingerprint(input.fingerprint, `${path}.fingerprint`),
    };
  }
  throw new TypeError(`${path}.kind must be approved-brief or thread-snapshot.`);
}

function sourceRef(value: unknown, path: string): ResolvedOperationPlanSourceRef {
  const input = strictRecord(value, ["id", "role", "fingerprint"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    role: safeId(input.role, `${path}.role`),
    fingerprint: fingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function analysisRef(value: unknown, path: string): ResolvedOperationPlanAnalysisRef {
  const input = strictRecord(
    value,
    ["id", "sourceRefId", "sourceFingerprint", "fingerprint"],
    path,
  );
  return {
    id: safeId(input.id, `${path}.id`),
    sourceRefId: safeId(input.sourceRefId, `${path}.sourceRefId`),
    sourceFingerprint: fingerprint(
      input.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    fingerprint: fingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function admissionRef(value: unknown, path: string): ResolvedOperationPlanAdmissionRef {
  const input = strictRecord(
    value,
    ["assertionId", "assertionFingerprint", "admissionFingerprint"],
    path,
  );
  return {
    assertionId: safeId(input.assertionId, `${path}.assertionId`),
    assertionFingerprint: fingerprint(
      input.assertionFingerprint,
      `${path}.assertionFingerprint`,
    ),
    admissionFingerprint: fingerprint(
      input.admissionFingerprint,
      `${path}.admissionFingerprint`,
    ),
  };
}

function policy(value: unknown, path: string): ResolvedOperationPlanPolicy {
  const input = strictRecord(value, ["profile", "status", "findings"], path);
  if (input.status !== "passed") {
    throw new TypeError(`${path}.status must equal "passed".`);
  }
  if (strictArray(input.findings, `${path}.findings`).length !== 0) {
    throw new TypeError(`${path}.findings must be empty when status is passed.`);
  }
  return {
    profile: safeId(input.profile, `${path}.profile`),
    status: "passed",
    findings: [],
  };
}

function dispatch(value: unknown, path: string): ResolvedOperationPlanDispatch {
  const input = strictRecord(
    value,
    [
      "ordinal",
      "provider",
      "lowering",
      "tool",
      "inputRefs",
      "semanticArguments",
      "expectedOutputs",
    ],
    path,
  );
  const provider = strictRecord(
    input.provider,
    ["id", "contractVersion"],
    `${path}.provider`,
  );
  const lowering = strictRecord(input.lowering, ["id", "version"], `${path}.lowering`);
  const inputRefs = nonEmptyStrictArray(input.inputRefs, `${path}.inputRefs`).map(
    (item, index) => inputRef(item, `${path}.inputRefs[${index}]`),
  ).sort((left, right) => asciiCompare(inputRefKey(left), inputRefKey(right)));
  rejectDuplicates(inputRefs.map(inputRefKey), `${path}.inputRefs`);
  const expectedOutputs = nonEmptyStrictArray(
    input.expectedOutputs,
    `${path}.expectedOutputs`,
  ).map(
    (item, index) => expectedOutput(item, `${path}.expectedOutputs[${index}]`),
  ).sort(compareExpectedOutputs);
  rejectDuplicates(
    expectedOutputs.map((output) => output.name),
    `${path}.expectedOutputs names`,
  );
  return {
    ordinal: positiveInteger(input.ordinal, `${path}.ordinal`),
    provider: {
      id: safeId(provider.id, `${path}.provider.id`),
      contractVersion: nonEmptyText(
        provider.contractVersion,
        `${path}.provider.contractVersion`,
      ),
    },
    lowering: {
      id: safeId(lowering.id, `${path}.lowering.id`),
      version: nonEmptyText(lowering.version, `${path}.lowering.version`),
    },
    tool: safeId(input.tool, `${path}.tool`),
    inputRefs,
    semanticArguments: jsonObject(input.semanticArguments, `${path}.semanticArguments`),
    expectedOutputs,
  };
}

function inputRef(value: unknown, path: string): ResolvedOperationPlanInputRef {
  const kind = dataRecord(value, path).kind;
  if (kind === "source" || kind === "analysis") {
    const input = strictRecord(value, ["kind", "id"], path);
    return { kind, id: safeId(input.id, `${path}.id`) };
  }
  if (kind === "admission") {
    const input = strictRecord(value, ["kind", "assertionId"], path);
    return { kind, assertionId: safeId(input.assertionId, `${path}.assertionId`) };
  }
  if (kind === "dispatch-output") {
    const input = strictRecord(value, ["kind", "dispatchOrdinal", "outputName"], path);
    return {
      kind,
      dispatchOrdinal: positiveInteger(
        input.dispatchOrdinal,
        `${path}.dispatchOrdinal`,
      ),
      outputName: safeId(input.outputName, `${path}.outputName`),
    };
  }
  throw new TypeError(`${path}.kind is unsupported.`);
}

function expectedOutput(
  value: unknown,
  path: string,
): ResolvedOperationPlanExpectedOutput {
  const input = strictRecord(value, ["kind", "name"], path);
  return {
    kind: safeId(input.kind, `${path}.kind`),
    name: safeId(input.name, `${path}.name`),
  };
}

function validateDispatchInputs(
  dispatch: ResolvedOperationPlanDispatch,
  sourceIds: ReadonlySet<string>,
  analysisIds: ReadonlySet<string>,
  admissionIds: ReadonlySet<string>,
  earlierDispatches: readonly ResolvedOperationPlanDispatch[],
  path: string,
): void {
  dispatch.inputRefs.forEach((ref, index) => {
    const refPath = `${path}[${index}]`;
    if (ref.kind === "source" && !sourceIds.has(ref.id)) {
      throw new TypeError(`${refPath}.id must name an existing sourceRefs id.`);
    }
    if (ref.kind === "analysis" && !analysisIds.has(ref.id)) {
      throw new TypeError(`${refPath}.id must name an existing analysisRefs id.`);
    }
    if (ref.kind === "admission" && !admissionIds.has(ref.assertionId)) {
      throw new TypeError(
        `${refPath}.assertionId must name an existing admissionRefs assertionId.`,
      );
    }
    if (ref.kind === "dispatch-output") {
      const producer = earlierDispatches.find((candidate) =>
        candidate.ordinal === ref.dispatchOrdinal
      );
      if (!producer) {
        throw new TypeError(
          `${refPath}.dispatchOrdinal must name an earlier existing dispatch.`,
        );
      }
      if (!producer.expectedOutputs.some((output) => output.name === ref.outputName)) {
        throw new TypeError(
          `${refPath}.outputName must name an output of dispatch ${ref.dispatchOrdinal}.`,
        );
      }
    }
  });
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const input = strictRecord(value, ["algorithm", "digest"], path);
  if (input.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must equal "sha256".`);
  }
  const digest = nonEmptyText(input.digest, `${path}.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}

function strictRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  return exactRecord(dataRecord(value, path), keys, path);
}

function dataRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${path} must not contain symbol fields.`);
  }
  for (const name of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${path}.${name} must be an enumerable data field.`);
    }
  }
  return value as Record<string, unknown>;
}

function strictArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be a plain array.`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${path} must not contain symbol fields.`);
  }
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== value.length + 1 ||
    names.some((name) => name !== "length" && !/^(0|[1-9][0-9]*)$/.test(name))
  ) {
    throw new TypeError(`${path} must not have holes or non-index fields.`);
  }
  for (const name of names) {
    if (name === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${path}[${name}] must be an enumerable data field.`);
    }
  }
  return value;
}

function nonEmptyStrictArray(value: unknown, path: string): unknown[] {
  const result = strictArray(value, path);
  if (result.length === 0) throw new TypeError(`${path} must not be empty.`);
  return result;
}

function jsonObject(value: unknown, path: string): Readonly<Record<string, JsonValue>> {
  const result = jsonValue(value, path, new Set());
  if (result === null || Array.isArray(result) || typeof result !== "object") {
    throw new TypeError(`${path} must be a JSON object.`);
  }
  return result as Readonly<Record<string, JsonValue>>;
}

function jsonValue(
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>,
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be a finite JSON number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new TypeError(`${path} must not contain a cycle.`);
    const values = strictArray(value, path);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(value);
    return values.map((item, index) =>
      jsonValue(item, `${path}[${index}]`, nextAncestors)
    );
  }
  if (value === null || typeof value !== "object") {
    throw new TypeError(`${path} must be a JSON value.`);
  }
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain a cycle.`);
  const input = strictJsonObject(value, path);
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  const copy: Record<string, JsonValue> = Object.create(null);
  for (const key of Object.keys(input)) {
    // The descriptor was checked before this read; no getter can run here.
    copy[key] = jsonValue(input[key], `${path}.${key}`, nextAncestors);
  }
  return copy;
}

function strictJsonObject(value: object, path: string): Record<string, unknown> {
  return dataRecord(value, path);
}

function compareSourceRefs(
  left: ResolvedOperationPlanSourceRef,
  right: ResolvedOperationPlanSourceRef,
): number {
  return asciiCompare(left.id, right.id) || asciiCompare(left.role, right.role);
}

function compareExpectedOutputs(
  left: ResolvedOperationPlanExpectedOutput,
  right: ResolvedOperationPlanExpectedOutput,
): number {
  return asciiCompare(left.kind, right.kind) || asciiCompare(left.name, right.name);
}

function inputRefKey(ref: ResolvedOperationPlanInputRef): string {
  switch (ref.kind) {
    case "source":
    case "analysis":
      return `${ref.kind}:${ref.id}`;
    case "admission":
      return `${ref.kind}:${ref.assertionId}`;
    case "dispatch-output":
      return `${ref.kind}:${ref.dispatchOrdinal}:${ref.outputName}`;
  }
}

function fingerprintKey(value: ContentFingerprint): string {
  return `${value.algorithm}:${value.digest}`;
}

function asciiCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new TypeError(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}
