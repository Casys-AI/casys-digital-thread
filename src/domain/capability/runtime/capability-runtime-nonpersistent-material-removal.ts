/**
 * Sibling administrative lifecycle for one exact non-persistent cache image.
 *
 * This is not Compose launch-group removal. `launchGroup` is literally null.
 * It never deletes Thread, CAS, WAL, project state, retained volumes, or
 * Microsandbox itself.
 */

import {
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import {
  isoDateTime,
  oneOf,
  parseMaterial,
  pinnedImageReference,
} from "./capability-runtime-cache-preparation-validation.ts";
import type { CapabilityRuntimeMaterialIdentity } from "./capability-runtime-material.ts";

export const CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_PLAN_SCHEMA =
  "capability-runtime-nonpersistent-removal-plan/1.0" as const;
export const CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_INTENT_SCHEMA =
  "capability-runtime-nonpersistent-removal-intent/1.0" as const;
export const CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OUTCOME_SCHEMA =
  "capability-runtime-nonpersistent-removal-outcome/1.0" as const;
export const CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OBSERVATION_SCHEMA =
  "capability-runtime-nonpersistent-removal-observation/1.0" as const;

export type CapabilityRuntimeNonpersistentRemovalBackend =
  | "docker-cache"
  | "microsandbox-cache";

export type CapabilityRuntimeNonpersistentRemovalObservedState = "owned" | "absent";

export interface CapabilityRuntimeNonpersistentRemovalUnit {
  readonly id: string;
  readonly version: string;
  readonly manifestFingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeNonpersistentRemovalMaterial {
  readonly unitId: string;
  readonly materialId: string;
  readonly imageReference: string;
  readonly imageDigest: string;
  readonly launchGroup: null;
}

export interface CapabilityRuntimeNonpersistentMaterialRemovalPlan {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_PLAN_SCHEMA;
  readonly unit: CapabilityRuntimeNonpersistentRemovalUnit;
  readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
  readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  readonly observedState: CapabilityRuntimeNonpersistentRemovalObservedState;
  readonly preserveThread: true;
  readonly preserveCas: true;
  readonly preserveWal: true;
  readonly preserveProjectState: true;
  readonly preserveRetainedVolumes: true;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeNonpersistentMaterialRemovalObservation {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OBSERVATION_SCHEMA;
  readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
  readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  readonly state: CapabilityRuntimeNonpersistentRemovalObservedState;
  readonly safety: "exact" | "foreign" | "unknown";
}

export interface CapabilityRuntimeNonpersistentMaterialRemovalIntent {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_INTENT_SCHEMA;
  readonly id: string;
  readonly action: "material-remove";
  readonly unit: CapabilityRuntimeNonpersistentRemovalUnit;
  readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
  readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  readonly generation: number;
  readonly planFingerprint: ContentFingerprint;
  readonly previousObservation: CapabilityRuntimeNonpersistentRemovalObservedState;
  readonly plannedAt: string;
  readonly preserveThread: true;
  readonly preserveCas: true;
  readonly preserveWal: true;
  readonly preserveProjectState: true;
  readonly preserveRetainedVolumes: true;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeNonpersistentMaterialRemovalOutcome {
  readonly schemaVersion:
    typeof CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OUTCOME_SCHEMA;
  readonly intentId: string;
  readonly intentFingerprint: ContentFingerprint;
  readonly recordedAt: string;
  readonly status: "succeeded" | "failed" | "uncertain";
  readonly observedState: CapabilityRuntimeNonpersistentRemovalObservedState | null;
  readonly detail: string | null;
  readonly fingerprint: ContentFingerprint;
}

export async function createCapabilityRuntimeNonpersistentMaterialRemovalPlan(
  input: {
    readonly unit: CapabilityRuntimeNonpersistentRemovalUnit;
    readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
    readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
    readonly observedState: CapabilityRuntimeNonpersistentRemovalObservedState;
  },
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalPlan> {
  const body = planBody(input);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeNonpersistentMaterialRemovalPlan(
  value: unknown,
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalPlan> {
  const root = exactRecord(value, [
    "schemaVersion",
    "unit",
    "material",
    "backend",
    "observedState",
    "preserveThread",
    "preserveCas",
    "preserveWal",
    "preserveProjectState",
    "preserveRetainedVolumes",
    "fingerprint",
  ], "$nonpersistentRemovalPlan");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_PLAN_SCHEMA,
    "$nonpersistentRemovalPlan.schemaVersion",
  );
  assertPreservationFlags(root, "$nonpersistentRemovalPlan");
  const body = planBody({
    unit: parseUnit(root.unit, "$nonpersistentRemovalPlan.unit"),
    material: parseRemovalMaterial(root.material, "$nonpersistentRemovalPlan.material"),
    backend: parseBackend(root.backend, "$nonpersistentRemovalPlan.backend"),
    observedState: parseObservedState(
      root.observedState,
      "$nonpersistentRemovalPlan.observedState",
    ),
  });
  const fingerprint = parseFingerprint(
    root.fingerprint,
    "$nonpersistentRemovalPlan.fingerprint",
  );
  await assertFingerprint(
    body,
    fingerprint,
    "$nonpersistentRemovalPlan.fingerprint",
  );
  return deepFreeze({ ...body, fingerprint });
}

export function capabilityRuntimeNonpersistentRemovalIntentId(input: {
  readonly planFingerprint: ContentFingerprint;
  readonly generation: number;
}): string {
  const generation = positiveInteger(
    input.generation,
    "$nonpersistentRemovalIntent.generation",
  );
  const digest = parseFingerprint(
    input.planFingerprint,
    "$nonpersistentRemovalIntent.planFingerprint",
  ).digest;
  return `capability-admin-remove-nonpersistent-${digest}-${generation}`;
}

export async function createCapabilityRuntimeNonpersistentMaterialRemovalIntent(
  input: {
    readonly id: string;
    readonly unit: CapabilityRuntimeNonpersistentRemovalUnit;
    readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
    readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
    readonly generation: number;
    readonly planFingerprint: ContentFingerprint;
    readonly previousObservation: CapabilityRuntimeNonpersistentRemovalObservedState;
    readonly plannedAt: string;
  },
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalIntent> {
  const body = intentBody(input);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeNonpersistentMaterialRemovalIntent(
  value: unknown,
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalIntent> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "action",
    "unit",
    "material",
    "backend",
    "generation",
    "planFingerprint",
    "previousObservation",
    "plannedAt",
    "preserveThread",
    "preserveCas",
    "preserveWal",
    "preserveProjectState",
    "preserveRetainedVolumes",
    "fingerprint",
  ], "$nonpersistentRemovalIntent");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_INTENT_SCHEMA,
    "$nonpersistentRemovalIntent.schemaVersion",
  );
  literalValue(root.action, "material-remove", "$nonpersistentRemovalIntent.action");
  assertPreservationFlags(root, "$nonpersistentRemovalIntent");
  const body = intentBody({
    id: safeId(root.id, "$nonpersistentRemovalIntent.id"),
    unit: parseUnit(root.unit, "$nonpersistentRemovalIntent.unit"),
    material: parseRemovalMaterial(
      root.material,
      "$nonpersistentRemovalIntent.material",
    ),
    backend: parseBackend(root.backend, "$nonpersistentRemovalIntent.backend"),
    generation: positiveInteger(
      root.generation,
      "$nonpersistentRemovalIntent.generation",
    ),
    planFingerprint: parseFingerprint(
      root.planFingerprint,
      "$nonpersistentRemovalIntent.planFingerprint",
    ),
    previousObservation: parseObservedState(
      root.previousObservation,
      "$nonpersistentRemovalIntent.previousObservation",
    ),
    plannedAt: isoDateTime(root.plannedAt, "$nonpersistentRemovalIntent.plannedAt"),
  });
  const fingerprint = parseFingerprint(
    root.fingerprint,
    "$nonpersistentRemovalIntent.fingerprint",
  );
  await assertFingerprint(
    body,
    fingerprint,
    "$nonpersistentRemovalIntent.fingerprint",
  );
  return deepFreeze({ ...body, fingerprint });
}

export async function createCapabilityRuntimeNonpersistentMaterialRemovalOutcome(
  input: {
    readonly intentId: string;
    readonly intentFingerprint: ContentFingerprint;
    readonly recordedAt: string;
    readonly status: "succeeded" | "failed" | "uncertain";
    readonly observedState: CapabilityRuntimeNonpersistentRemovalObservedState | null;
    readonly detail: string | null;
  },
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
  const body = outcomeBody(input);
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function validateCapabilityRuntimeNonpersistentMaterialRemovalOutcome(
  value: unknown,
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
  const root = exactRecord(value, [
    "schemaVersion",
    "intentId",
    "intentFingerprint",
    "recordedAt",
    "status",
    "observedState",
    "detail",
    "fingerprint",
  ], "$nonpersistentRemovalOutcome");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OUTCOME_SCHEMA,
    "$nonpersistentRemovalOutcome.schemaVersion",
  );
  const body = outcomeBody({
    intentId: safeId(root.intentId, "$nonpersistentRemovalOutcome.intentId"),
    intentFingerprint: parseFingerprint(
      root.intentFingerprint,
      "$nonpersistentRemovalOutcome.intentFingerprint",
    ),
    recordedAt: isoDateTime(
      root.recordedAt,
      "$nonpersistentRemovalOutcome.recordedAt",
    ),
    status: oneOf(
      root.status,
      ["succeeded", "failed", "uncertain"] as const,
      "$nonpersistentRemovalOutcome.status",
    ),
    observedState: root.observedState === null ? null : parseObservedState(
      root.observedState,
      "$nonpersistentRemovalOutcome.observedState",
    ),
    detail: parseDetail(root.detail, "$nonpersistentRemovalOutcome.detail"),
  });
  const fingerprint = parseFingerprint(
    root.fingerprint,
    "$nonpersistentRemovalOutcome.fingerprint",
  );
  await assertFingerprint(
    body,
    fingerprint,
    "$nonpersistentRemovalOutcome.fingerprint",
  );
  return deepFreeze({ ...body, fingerprint });
}

export function sameNonpersistentRemovalPlan(
  left: Pick<CapabilityRuntimeNonpersistentMaterialRemovalPlan, "fingerprint">,
  right: Pick<CapabilityRuntimeNonpersistentMaterialRemovalPlan, "fingerprint">,
): boolean {
  return fingerprintsEqual(left.fingerprint, right.fingerprint);
}

export function sameNonpersistentRemovalIdentity(
  left: Pick<
    CapabilityRuntimeNonpersistentMaterialRemovalPlan,
    "unit" | "material" | "backend"
  >,
  right: Pick<
    CapabilityRuntimeNonpersistentMaterialRemovalPlan,
    "unit" | "material" | "backend"
  >,
): boolean {
  return left.unit.id === right.unit.id &&
    left.unit.version === right.unit.version &&
    fingerprintsEqual(left.unit.manifestFingerprint, right.unit.manifestFingerprint) &&
    left.material.unitId === right.material.unitId &&
    left.material.materialId === right.material.materialId &&
    left.material.imageReference === right.material.imageReference &&
    left.material.imageDigest === right.material.imageDigest &&
    left.material.launchGroup === right.material.launchGroup &&
    left.backend === right.backend;
}

export async function reconstructCapabilityRuntimeNonpersistentMaterialRemovalPlan(
  intent: CapabilityRuntimeNonpersistentMaterialRemovalIntent,
): Promise<CapabilityRuntimeNonpersistentMaterialRemovalPlan> {
  const plan = await createCapabilityRuntimeNonpersistentMaterialRemovalPlan({
    unit: intent.unit,
    material: intent.material,
    backend: intent.backend,
    observedState: intent.previousObservation,
  });
  if (!fingerprintsEqual(plan.fingerprint, intent.planFingerprint)) {
    throw new TypeError(
      "$nonpersistentRemovalIntent.planFingerprint does not match the reconstructed plan.",
    );
  }
  return plan;
}

function planBody(input: {
  readonly unit: CapabilityRuntimeNonpersistentRemovalUnit;
  readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
  readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  readonly observedState: CapabilityRuntimeNonpersistentRemovalObservedState;
}) {
  const unit = parseUnit(input.unit, "$nonpersistentRemovalPlan.unit");
  const material = parseRemovalMaterial(
    input.material,
    "$nonpersistentRemovalPlan.material",
  );
  assertMaterialMatchesUnit(unit, material, "$nonpersistentRemovalPlan.material");
  return {
    schemaVersion: CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_PLAN_SCHEMA,
    unit,
    material,
    backend: parseBackend(input.backend, "$nonpersistentRemovalPlan.backend"),
    observedState: parseObservedState(
      input.observedState,
      "$nonpersistentRemovalPlan.observedState",
    ),
    preserveThread: true as const,
    preserveCas: true as const,
    preserveWal: true as const,
    preserveProjectState: true as const,
    preserveRetainedVolumes: true as const,
  };
}

function intentBody(input: {
  readonly id: string;
  readonly unit: CapabilityRuntimeNonpersistentRemovalUnit;
  readonly material: CapabilityRuntimeNonpersistentRemovalMaterial;
  readonly backend: CapabilityRuntimeNonpersistentRemovalBackend;
  readonly generation: number;
  readonly planFingerprint: ContentFingerprint;
  readonly previousObservation: CapabilityRuntimeNonpersistentRemovalObservedState;
  readonly plannedAt: string;
}) {
  const unit = parseUnit(input.unit, "$nonpersistentRemovalIntent.unit");
  const material = parseRemovalMaterial(
    input.material,
    "$nonpersistentRemovalIntent.material",
  );
  assertMaterialMatchesUnit(unit, material, "$nonpersistentRemovalIntent.material");
  return {
    schemaVersion: CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_INTENT_SCHEMA,
    id: safeId(input.id, "$nonpersistentRemovalIntent.id"),
    action: "material-remove" as const,
    unit,
    material,
    backend: parseBackend(input.backend, "$nonpersistentRemovalIntent.backend"),
    generation: positiveInteger(
      input.generation,
      "$nonpersistentRemovalIntent.generation",
    ),
    planFingerprint: parseFingerprint(
      input.planFingerprint,
      "$nonpersistentRemovalIntent.planFingerprint",
    ),
    previousObservation: parseObservedState(
      input.previousObservation,
      "$nonpersistentRemovalIntent.previousObservation",
    ),
    plannedAt: isoDateTime(input.plannedAt, "$nonpersistentRemovalIntent.plannedAt"),
    preserveThread: true as const,
    preserveCas: true as const,
    preserveWal: true as const,
    preserveProjectState: true as const,
    preserveRetainedVolumes: true as const,
  };
}

function outcomeBody(input: {
  readonly intentId: string;
  readonly intentFingerprint: ContentFingerprint;
  readonly recordedAt: string;
  readonly status: "succeeded" | "failed" | "uncertain";
  readonly observedState: CapabilityRuntimeNonpersistentRemovalObservedState | null;
  readonly detail: string | null;
}) {
  return {
    schemaVersion: CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OUTCOME_SCHEMA,
    intentId: safeId(input.intentId, "$nonpersistentRemovalOutcome.intentId"),
    intentFingerprint: parseFingerprint(
      input.intentFingerprint,
      "$nonpersistentRemovalOutcome.intentFingerprint",
    ),
    recordedAt: isoDateTime(
      input.recordedAt,
      "$nonpersistentRemovalOutcome.recordedAt",
    ),
    status: oneOf(
      input.status,
      ["succeeded", "failed", "uncertain"] as const,
      "$nonpersistentRemovalOutcome.status",
    ),
    observedState: input.observedState === null ? null : parseObservedState(
      input.observedState,
      "$nonpersistentRemovalOutcome.observedState",
    ),
    detail: parseDetail(input.detail, "$nonpersistentRemovalOutcome.detail"),
  };
}

function parseUnit(
  value: unknown,
  path: string,
): CapabilityRuntimeNonpersistentRemovalUnit {
  const root = exactRecord(value, ["id", "version", "manifestFingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    manifestFingerprint: parseFingerprint(
      root.manifestFingerprint,
      `${path}.manifestFingerprint`,
    ),
  });
}

function parseRemovalMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeNonpersistentRemovalMaterial {
  const root = exactRecord(value, [
    "unitId",
    "materialId",
    "imageReference",
    "imageDigest",
    "launchGroup",
  ], path);
  literalValue(root.launchGroup, null, `${path}.launchGroup`);
  const identity: CapabilityRuntimeMaterialIdentity = parseMaterial({
    unitId: root.unitId,
    materialId: root.materialId,
    imageDigest: root.imageDigest,
  }, path);
  const imageReference = pinnedImageReference(
    root.imageReference,
    `${path}.imageReference`,
  );
  if (!imageReference.endsWith(`@sha256:${identity.imageDigest}`)) {
    throw new TypeError(
      `${path}.imageReference does not attest its exact material digest.`,
    );
  }
  return deepFreeze({
    unitId: identity.unitId,
    materialId: identity.materialId,
    imageReference,
    imageDigest: identity.imageDigest,
    launchGroup: null,
  });
}

function parseBackend(
  value: unknown,
  path: string,
): CapabilityRuntimeNonpersistentRemovalBackend {
  return oneOf(value, ["docker-cache", "microsandbox-cache"] as const, path);
}

function parseObservedState(
  value: unknown,
  path: string,
): CapabilityRuntimeNonpersistentRemovalObservedState {
  return oneOf(value, ["owned", "absent"] as const, path);
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be one SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest };
}

function parseDetail(value: unknown, path: string): string | null {
  if (value === null) return null;
  const detail = nonEmptyText(value, path);
  if (detail.length > 512) {
    throw new TypeError(`${path} must be 1 to 512 characters or null.`);
  }
  return detail;
}

function assertMaterialMatchesUnit(
  unit: CapabilityRuntimeNonpersistentRemovalUnit,
  material: CapabilityRuntimeNonpersistentRemovalMaterial,
  path: string,
): void {
  if (material.unitId !== unit.id) {
    throw new TypeError(`${path}.unitId must equal the exact unit id.`);
  }
}

function assertPreservationFlags(
  root: Record<string, unknown>,
  path: string,
): void {
  literalValue(root.preserveThread, true, `${path}.preserveThread`);
  literalValue(root.preserveCas, true, `${path}.preserveCas`);
  literalValue(root.preserveWal, true, `${path}.preserveWal`);
  literalValue(root.preserveProjectState, true, `${path}.preserveProjectState`);
  literalValue(root.preserveRetainedVolumes, true, `${path}.preserveRetainedVolumes`);
}

async function assertFingerprint(
  body: unknown,
  fingerprint: ContentFingerprint,
  path: string,
): Promise<void> {
  const expected = await sha256Fingerprint(body);
  if (
    expected.algorithm !== fingerprint.algorithm ||
    expected.digest !== fingerprint.digest
  ) {
    throw new TypeError(`${path} does not match the exact body.`);
  }
}
