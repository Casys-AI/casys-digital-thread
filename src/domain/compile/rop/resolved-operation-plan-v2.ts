/**
 * A sealed, inspectable authorization for exactly one registered recorded run.
 *
 * It is intentionally not a workflow language.  The plan has one closed action
 * arm; provider dispatch, recovery transitions and output publication remain in
 * the registered executor selected by the server.  This lets an agent author
 * native artefacts while the authority boundary remains exact and reviewable.
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
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { canonicalCalculixStepPlanCasUri } from "../../fea/isolated-v3/calculix-step-asset-uri.ts";

export const RESOLVED_OPERATION_PLAN_V2_SCHEMA = "resolved-operation-plan/2.0" as const;
export const RESOLVED_OPERATION_PLAN_REF_SCHEMA =
  "resolved-operation-plan-ref/1.0" as const;
export const RESOLVED_OPERATION_PLAN_URI_NAMESPACE = "resolved-operation-plan" as const;

export const CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE = deepFreeze(
  {
    id: "mcp-calculix.recorded-static-artifacts",
    version: "1.0",
    resources: [
      { role: "input.step", mediaType: "model/step" },
      { role: "request.json", mediaType: "application/json" },
      { role: "mesh.geo", mediaType: "text/plain" },
      { role: "mesh.inp", mediaType: "text/plain" },
      { role: "gmsh.log", mediaType: "text/plain" },
      { role: "job.inp", mediaType: "text/plain" },
      { role: "ccx.log", mediaType: "text/plain" },
      { role: "job.dat", mediaType: "text/plain" },
      { role: "result.json", mediaType: "application/json" },
    ],
  } as const,
);

/** Closed output profile for the provider-free local Microsandbox route. */
export const CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE = deepFreeze(
  {
    id: "calculix-isolated.static-artifacts",
    version: "1.0",
    resources: CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.resources,
  } as const,
);

export interface ResolvedOperationPlanRef {
  readonly schemaVersion: typeof RESOLVED_OPERATION_PLAN_REF_SCHEMA;
  readonly planId: string;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
  readonly casUri: string;
}

export interface ResolvedOperationPlanV2 {
  readonly schemaVersion: typeof RESOLVED_OPERATION_PLAN_V2_SCHEMA;
  /** Deterministically derived from run.runId; it is never caller-chosen. */
  readonly id: string;
  readonly run: {
    readonly projectId: string;
    readonly runId: string;
    readonly workItemId: string;
    readonly inputFingerprint: ContentFingerprint;
    /** Immutable project revision from which the queue candidate was derived. */
    readonly queueBasisProject: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly fingerprint: ContentFingerprint;
    };
  };
  readonly workItem: {
    readonly id: string;
    readonly operation: { readonly id: string; readonly version: string };
    /** Canonical fingerprint of the complete server-reviewed operation binding. */
    readonly operationFingerprint: ContentFingerprint;
  };
  /** Exact human decision/approval and the qualified execution method. */
  readonly authorization: {
    readonly kind: "human-mrtr-and-qualified-method";
    readonly mrtr: {
      readonly decisionId: string;
      /** Exact execution-input fingerprint carried by the approved decision. */
      readonly decisionInputFingerprint: ContentFingerprint;
      readonly approvalId: string;
      readonly approvalFingerprint: ContentFingerprint;
    };
    /** Server-qualified method profile, distinct from a provider manifest's inner hash. */
    readonly methodQualification: {
      readonly id: string;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
    };
  };
  /** Recorded verticals consume an exact technical state, never `latest`. */
  readonly basis: {
    readonly kind: "thread-snapshot";
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
    readonly fingerprint: ContentFingerprint;
  };
  /** Exact captured artefacts consumed by the closed action. */
  readonly sources: readonly ResolvedOperationPlanSource[];
  readonly action:
    | ResolvedCalculixStaticStructuralAction
    | ResolvedCalculixIsolatedStaticStructuralAction;
  /** Resource roles expected from the provider ledger/capture boundary. */
  readonly expectedProviderResources: ResolvedOperationPlanExpectedResources;
  /** Names a code-owned recovery policy; it does not define a state machine. */
  readonly recovery: ResolvedOperationPlanRecovery;
}

export interface ResolvedOperationPlanSource {
  readonly bindingName: string;
  readonly role: string;
  readonly threadRef: {
    readonly snapshotId: string;
    readonly snapshotRevision: number;
    readonly kind: "artifact";
    readonly id: string;
  };
  readonly artifact: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    readonly mediaType: string;
    readonly casUri: string;
  };
}

export type ResolvedOperationPlanExpectedResources =
  | {
    readonly ledgerSchema: "provider-resource-acquisition-ledger/1.0";
    readonly captureManifestSchema: "provider-artifact-capture-manifest/1.0";
    readonly resourceProfile: {
      readonly id: "mcp-calculix.recorded-static-artifacts";
      readonly version: "1.0";
    };
  }
  | {
    readonly receiptSchema: "isolated-code-execution-receipt-record/1.0";
    readonly evidenceSchema: "calculix-isolated-static-evidence/1.0";
    readonly resourceProfile: {
      readonly id: "calculix-isolated.static-artifacts";
      readonly version: "1.0";
    };
  };

export type ResolvedOperationPlanRecovery =
  & {
    readonly requestId: string;
    readonly mode: "same-request-readback-no-blind-redispatch";
    readonly ambiguousOutcome: "quarantine-for-human-review";
    readonly capturedOutcome: "cas-only-recovery";
  }
  & (
    | { readonly policy: "mcp-calculix.recorded-static-recovery@1.0" }
    | { readonly policy: "calculix-isolated-generation-recovery@1.0" }
  );

export interface ResolvedCalculixStaticStructuralAction {
  readonly kind: "static-structural-analysis";
  readonly provider: {
    readonly id: "mcp-calculix";
    readonly contract: {
      readonly id: "calculix_solve_static_recorded";
      readonly version: "1.0";
    };
    readonly executionIdentitySchema: "1.0";
    readonly runSchema: "2.0";
    readonly resultSchema: "2.0";
  };
  readonly lowering: {
    readonly id: "calculix.static.abaqus-deck";
    readonly version: "1.0";
  };
  readonly requestId: string;
  readonly input: {
    readonly proofCase: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
      readonly sourceBinding: string;
    };
    readonly geometrySourceBinding: string;
    readonly effectiveElementOrder: 1 | 2;
    readonly effectiveTimeoutMs: number;
  };
}

/**
 * Local execution authority. It deliberately has no provider/tool identity:
 * the exact server-owned profile, OCI digest and isolation policy are bound by
 * profileFingerprint and re-opened by the registered @3 executor.
 */
export interface ResolvedCalculixIsolatedStaticStructuralAction {
  readonly kind: "isolated-static-structural-analysis";
  readonly executor: {
    readonly id: "casys-local-microsandbox";
    readonly contract: {
      readonly id: "calculix-static-proof-v1";
      readonly version: "1.0.0";
    };
    readonly profileFingerprint: ContentFingerprint;
  };
  readonly lowering: {
    readonly id: "calculix.static.abaqus-deck";
    readonly version: "1.0";
  };
  readonly requestId: string;
  readonly input: ResolvedCalculixStaticStructuralAction["input"];
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const CALCULIX_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MEDIA_TYPE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:; [a-z0-9!#$&^_.+-]+=(?:[a-z0-9!#$&^_.+-]+|"[^"\r\n]*"))*$/;
const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "run",
  "workItem",
  "authorization",
  "basis",
  "sources",
  "action",
  "expectedProviderResources",
  "recovery",
] as const;

/** Stable plan identity; prevents adoption of one run's plan by another run. */
export function resolvedOperationPlanIdForRun(runId: string): string {
  return safeId(runId, "$runId");
}

/** Decode untrusted JSON into a deeply frozen, canonicalized closed plan. */
export function validateResolvedOperationPlanV2(
  value: unknown,
): ResolvedOperationPlanV2 {
  const root = strictRecord(value, ROOT_KEYS, "$plan");
  literal(root.schemaVersion, RESOLVED_OPERATION_PLAN_V2_SCHEMA, "$plan.schemaVersion");
  const run = parseRun(root.run, "$plan.run");
  const id = safeId(root.id, "$plan.id");
  if (id !== resolvedOperationPlanIdForRun(run.runId)) {
    throw new TypeError(
      "$plan.id must be deterministically derived from $plan.run.runId.",
    );
  }
  const workItem = parseWorkItem(root.workItem, "$plan.workItem");
  if (workItem.id !== run.workItemId) {
    throw new TypeError("$plan.workItem.id must equal $plan.run.workItemId.");
  }
  const authorization = parseAuthorization(root.authorization, "$plan.authorization");
  const basis = parseBasis(root.basis, "$plan.basis");
  const sources = strictArray(root.sources, "$plan.sources")
    .map((item, index) => parseSource(item, `$plan.sources[${index}]`))
    .sort((left, right) => asciiCompare(left.bindingName, right.bindingName));
  if (sources.length === 0) throw new TypeError("$plan.sources must not be empty.");
  rejectDuplicates(
    sources.map((source) => source.bindingName),
    "$plan.sources bindingNames",
  );
  rejectDuplicates(
    sources.map((source) => source.threadRef.id),
    "$plan.sources thread artifact ids",
  );
  rejectDuplicates(
    sources.map((source) => source.artifact.casUri),
    "$plan.sources CAS URIs",
  );
  for (const source of sources) {
    if (
      source.threadRef.snapshotId !== basis.snapshotId ||
      source.threadRef.snapshotRevision !== basis.revision
    ) {
      throw new TypeError(
        `$plan.sources.${source.bindingName} must belong to the exact $plan.basis ThreadSnapshot.`,
      );
    }
  }
  const action = parseAction(root.action, "$plan.action");
  assertActionMatchesOperation(action, workItem, "$plan.action");
  assertActionCaseMatchesSource(action, sources, "$plan.action");
  const expectedProviderResources = parseExpectedResources(
    root.expectedProviderResources,
    "$plan.expectedProviderResources",
  );
  const recovery = parseRecovery(root.recovery, "$plan.recovery");
  if (recovery.requestId !== action.requestId) {
    throw new TypeError("$plan.recovery.requestId must equal $plan.action.requestId.");
  }
  assertProviderEvidenceMatchesAction(
    action,
    authorization,
    sources,
    expectedProviderResources,
    recovery,
    "$plan",
  );
  return deepFreeze({
    schemaVersion: RESOLVED_OPERATION_PLAN_V2_SCHEMA,
    id,
    run,
    workItem,
    authorization,
    basis,
    sources,
    action,
    expectedProviderResources,
    recovery,
  });
}

/** Canonical UTF-8 payload that is saved and reread from the CAS. */
export function canonicalResolvedOperationPlanV2Text(value: unknown): string {
  return deterministicJson(validateResolvedOperationPlanV2(value));
}

export async function fingerprintResolvedOperationPlanV2(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateResolvedOperationPlanV2(value));
}

export function validateResolvedOperationPlanRef(
  value: unknown,
): ResolvedOperationPlanRef {
  const input = strictRecord(
    value,
    ["schemaVersion", "planId", "fingerprint", "byteCount", "casUri"],
    "$planRef",
  );
  literal(
    input.schemaVersion,
    RESOLVED_OPERATION_PLAN_REF_SCHEMA,
    "$planRef.schemaVersion",
  );
  const planId = safeId(input.planId, "$planRef.planId");
  const fingerprint = parseFingerprint(input.fingerprint, "$planRef.fingerprint");
  const byteCount = positiveInteger(input.byteCount, "$planRef.byteCount");
  const casUri = casUriForFingerprint(
    input.casUri,
    fingerprint,
    "$planRef.casUri",
  );
  return deepFreeze({
    schemaVersion: RESOLVED_OPERATION_PLAN_REF_SCHEMA,
    planId,
    fingerprint,
    byteCount,
    casUri,
  });
}

export function sameResolvedOperationPlanRef(
  left: ResolvedOperationPlanRef | undefined,
  right: ResolvedOperationPlanRef | undefined,
): boolean {
  return left !== undefined && right !== undefined &&
    left.schemaVersion === right.schemaVersion &&
    left.planId === right.planId &&
    left.byteCount === right.byteCount &&
    left.casUri === right.casUri &&
    fingerprintsEqual(left.fingerprint, right.fingerprint);
}

function parseRun(value: unknown, path: string): ResolvedOperationPlanV2["run"] {
  const input = strictRecord(
    value,
    [
      "projectId",
      "runId",
      "workItemId",
      "inputFingerprint",
      "queueBasisProject",
    ],
    path,
  );
  const queueBasisProject = strictRecord(
    input.queueBasisProject,
    ["snapshotId", "revision", "fingerprint"],
    `${path}.queueBasisProject`,
  );
  return {
    projectId: safeId(input.projectId, `${path}.projectId`),
    runId: safeId(input.runId, `${path}.runId`),
    workItemId: safeId(input.workItemId, `${path}.workItemId`),
    inputFingerprint: parseFingerprint(
      input.inputFingerprint,
      `${path}.inputFingerprint`,
    ),
    queueBasisProject: {
      snapshotId: safeId(
        queueBasisProject.snapshotId,
        `${path}.queueBasisProject.snapshotId`,
      ),
      revision: positiveInteger(
        queueBasisProject.revision,
        `${path}.queueBasisProject.revision`,
      ),
      fingerprint: parseFingerprint(
        queueBasisProject.fingerprint,
        `${path}.queueBasisProject.fingerprint`,
      ),
    },
  };
}

function parseWorkItem(
  value: unknown,
  path: string,
): ResolvedOperationPlanV2["workItem"] {
  const input = strictRecord(value, ["id", "operation", "operationFingerprint"], path);
  const operation = strictRecord(
    input.operation,
    ["id", "version"],
    `${path}.operation`,
  );
  return {
    id: safeId(input.id, `${path}.id`),
    operation: {
      id: safeId(operation.id, `${path}.operation.id`),
      version: nonEmptyText(operation.version, `${path}.operation.version`),
    },
    operationFingerprint: parseFingerprint(
      input.operationFingerprint,
      `${path}.operationFingerprint`,
    ),
  };
}

function parseAuthorization(
  value: unknown,
  path: string,
): ResolvedOperationPlanV2["authorization"] {
  const input = strictRecord(value, ["kind", "mrtr", "methodQualification"], path);
  literal(input.kind, "human-mrtr-and-qualified-method", `${path}.kind`);
  const mrtr = strictRecord(
    input.mrtr,
    [
      "decisionId",
      "decisionInputFingerprint",
      "approvalId",
      "approvalFingerprint",
    ],
    `${path}.mrtr`,
  );
  const method = strictRecord(
    input.methodQualification,
    ["id", "version", "fingerprint"],
    `${path}.methodQualification`,
  );
  return {
    kind: "human-mrtr-and-qualified-method",
    mrtr: {
      decisionId: safeId(mrtr.decisionId, `${path}.mrtr.decisionId`),
      decisionInputFingerprint: parseFingerprint(
        mrtr.decisionInputFingerprint,
        `${path}.mrtr.decisionInputFingerprint`,
      ),
      approvalId: safeId(mrtr.approvalId, `${path}.mrtr.approvalId`),
      approvalFingerprint: parseFingerprint(
        mrtr.approvalFingerprint,
        `${path}.mrtr.approvalFingerprint`,
      ),
    },
    methodQualification: {
      id: safeId(method.id, `${path}.methodQualification.id`),
      version: nonEmptyText(method.version, `${path}.methodQualification.version`),
      fingerprint: parseFingerprint(
        method.fingerprint,
        `${path}.methodQualification.fingerprint`,
      ),
    },
  };
}

function parseBasis(value: unknown, path: string): ResolvedOperationPlanV2["basis"] {
  const input = strictRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId", "fingerprint"],
    path,
  );
  literal(input.kind, "thread-snapshot", `${path}.kind`);
  return {
    kind: "thread-snapshot",
    snapshotId: safeId(input.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
  };
}

function parseSource(value: unknown, path: string): ResolvedOperationPlanSource {
  const input = strictRecord(
    value,
    ["bindingName", "role", "threadRef", "artifact"],
    path,
  );
  const threadRef = strictRecord(
    input.threadRef,
    ["snapshotId", "snapshotRevision", "kind", "id"],
    `${path}.threadRef`,
  );
  literal(threadRef.kind, "artifact", `${path}.threadRef.kind`);
  const artifact = strictRecord(
    input.artifact,
    ["fingerprint", "byteCount", "mediaType", "casUri"],
    `${path}.artifact`,
  );
  const fingerprint = parseFingerprint(
    artifact.fingerprint,
    `${path}.artifact.fingerprint`,
  );
  return {
    bindingName: safeId(input.bindingName, `${path}.bindingName`),
    role: safeId(input.role, `${path}.role`),
    threadRef: {
      snapshotId: safeId(threadRef.snapshotId, `${path}.threadRef.snapshotId`),
      snapshotRevision: positiveInteger(
        threadRef.snapshotRevision,
        `${path}.threadRef.snapshotRevision`,
      ),
      kind: "artifact",
      id: safeId(threadRef.id, `${path}.threadRef.id`),
    },
    artifact: {
      fingerprint,
      byteCount: positiveInteger(artifact.byteCount, `${path}.artifact.byteCount`),
      mediaType: mediaType(artifact.mediaType, `${path}.artifact.mediaType`),
      casUri: artifactCasUriForFingerprint(
        artifact.casUri,
        fingerprint,
        `${path}.artifact.casUri`,
      ),
    },
  };
}

function parseAction(value: unknown, path: string): ResolvedOperationPlanV2["action"] {
  const root = dataRecord(value, path);
  if (
    root.kind === "static-structural-analysis" ||
    root.kind === "isolated-static-structural-analysis"
  ) {
    const isolated = root.kind === "isolated-static-structural-analysis";
    const input = strictRecord(
      value,
      isolated
        ? ["kind", "executor", "lowering", "requestId", "input"]
        : ["kind", "provider", "lowering", "requestId", "input"],
      path,
    );
    let localExecutor:
      | ResolvedCalculixIsolatedStaticStructuralAction["executor"]
      | undefined;
    if (isolated) {
      const executor = strictRecord(
        input.executor,
        ["id", "contract", "profileFingerprint"],
        `${path}.executor`,
      );
      literal(
        executor.id,
        "casys-local-microsandbox",
        `${path}.executor.id`,
      );
      const contract = strictRecord(
        executor.contract,
        ["id", "version"],
        `${path}.executor.contract`,
      );
      literal(
        contract.id,
        "calculix-static-proof-v1",
        `${path}.executor.contract.id`,
      );
      literal(contract.version, "1.0.0", `${path}.executor.contract.version`);
      localExecutor = {
        id: "casys-local-microsandbox",
        contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
        profileFingerprint: parseFingerprint(
          executor.profileFingerprint,
          `${path}.executor.profileFingerprint`,
        ),
      };
    } else {
      const provider = strictRecord(
        input.provider,
        [
          "id",
          "contract",
          "executionIdentitySchema",
          "runSchema",
          "resultSchema",
        ],
        `${path}.provider`,
      );
      literal(provider.id, "mcp-calculix", `${path}.provider.id`);
      const contract = strictRecord(
        provider.contract,
        ["id", "version"],
        `${path}.provider.contract`,
      );
      literal(
        contract.id,
        "calculix_solve_static_recorded",
        `${path}.provider.contract.id`,
      );
      literal(contract.version, "1.0", `${path}.provider.contract.version`);
      literal(
        provider.executionIdentitySchema,
        "1.0",
        `${path}.provider.executionIdentitySchema`,
      );
      literal(provider.runSchema, "2.0", `${path}.provider.runSchema`);
      literal(provider.resultSchema, "2.0", `${path}.provider.resultSchema`);
    }
    const lowering = strictRecord(
      input.lowering,
      ["id", "version"],
      `${path}.lowering`,
    );
    literal(
      lowering.id,
      "calculix.static.abaqus-deck",
      `${path}.lowering.id`,
    );
    literal(lowering.version, "1.0", `${path}.lowering.version`);
    const actionInput = strictRecord(
      input.input,
      [
        "proofCase",
        "geometrySourceBinding",
        "effectiveElementOrder",
        "effectiveTimeoutMs",
      ],
      `${path}.input`,
    );
    if (
      actionInput.effectiveElementOrder !== 1 && actionInput.effectiveElementOrder !== 2
    ) {
      throw new TypeError(`${path}.input.effectiveElementOrder must equal 1 or 2.`);
    }
    const common = {
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      requestId: providerRequestId(
        input.requestId,
        CALCULIX_REQUEST_ID,
        `${path}.requestId`,
        isolated ? "local CalculiX" : "mcp-calculix",
      ),
      input: {
        proofCase: sourceBoundCaseIdentity(
          actionInput.proofCase,
          `${path}.input.proofCase`,
        ),
        geometrySourceBinding: safeId(
          actionInput.geometrySourceBinding,
          `${path}.input.geometrySourceBinding`,
        ),
        effectiveElementOrder: actionInput.effectiveElementOrder,
        effectiveTimeoutMs: positiveInteger(
          actionInput.effectiveTimeoutMs,
          `${path}.input.effectiveTimeoutMs`,
        ),
      },
    } as const;
    return isolated
      ? {
        kind: "isolated-static-structural-analysis",
        executor: localExecutor!,
        ...common,
      }
      : {
        kind: "static-structural-analysis",
        provider: {
          id: "mcp-calculix",
          contract: { id: "calculix_solve_static_recorded", version: "1.0" },
          executionIdentitySchema: "1.0",
          runSchema: "2.0",
          resultSchema: "2.0",
        },
        ...common,
      };
  }
  throw new TypeError(
    `${path}.kind is not a registered resolved action.`,
  );
}

function parseExpectedResources(
  value: unknown,
  path: string,
): ResolvedOperationPlanV2["expectedProviderResources"] {
  const root = dataRecord(value, path);
  const profile = strictRecord(
    root.resourceProfile,
    ["id", "version"],
    `${path}.resourceProfile`,
  );
  if (profile.id === CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.id) {
    const input = strictRecord(
      value,
      ["ledgerSchema", "captureManifestSchema", "resourceProfile"],
      path,
    );
    parseProviderEvidenceSchemas(input, path);
    literal(
      profile.version,
      CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.version,
      `${path}.resourceProfile.version`,
    );
    return {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-calculix.recorded-static-artifacts",
        version: "1.0",
      },
    };
  }
  if (profile.id === CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.id) {
    const input = strictRecord(
      value,
      ["receiptSchema", "evidenceSchema", "resourceProfile"],
      path,
    );
    literal(
      input.receiptSchema,
      "isolated-code-execution-receipt-record/1.0",
      `${path}.receiptSchema`,
    );
    literal(
      input.evidenceSchema,
      "calculix-isolated-static-evidence/1.0",
      `${path}.evidenceSchema`,
    );
    literal(
      profile.version,
      CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.version,
      `${path}.resourceProfile.version`,
    );
    return {
      receiptSchema: "isolated-code-execution-receipt-record/1.0",
      evidenceSchema: "calculix-isolated-static-evidence/1.0",
      resourceProfile: {
        id: "calculix-isolated.static-artifacts",
        version: "1.0",
      },
    };
  }
  throw new TypeError(`${path}.resourceProfile.id is not a code-owned profile.`);
}

function parseProviderEvidenceSchemas(
  input: Record<string, unknown>,
  path: string,
): void {
  literal(
    input.ledgerSchema,
    "provider-resource-acquisition-ledger/1.0",
    `${path}.ledgerSchema`,
  );
  literal(
    input.captureManifestSchema,
    "provider-artifact-capture-manifest/1.0",
    `${path}.captureManifestSchema`,
  );
}

function parseRecovery(
  value: unknown,
  path: string,
): ResolvedOperationPlanV2["recovery"] {
  const input = strictRecord(
    value,
    ["policy", "requestId", "mode", "ambiguousOutcome", "capturedOutcome"],
    path,
  );
  if (
    input.policy !== "mcp-calculix.recorded-static-recovery@1.0" &&
    input.policy !== "calculix-isolated-generation-recovery@1.0"
  ) {
    throw new TypeError(`${path}.policy is not a code-owned recovery policy.`);
  }
  literal(input.mode, "same-request-readback-no-blind-redispatch", `${path}.mode`);
  literal(
    input.ambiguousOutcome,
    "quarantine-for-human-review",
    `${path}.ambiguousOutcome`,
  );
  literal(input.capturedOutcome, "cas-only-recovery", `${path}.capturedOutcome`);
  return {
    policy: input.policy,
    requestId: safeId(input.requestId, `${path}.requestId`),
    mode: "same-request-readback-no-blind-redispatch",
    ambiguousOutcome: "quarantine-for-human-review",
    capturedOutcome: "cas-only-recovery",
  };
}

function sourceBoundCaseIdentity(
  value: unknown,
  path: string,
): {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly sourceBinding: string;
} {
  const input = strictRecord(value, ["id", "fingerprint", "sourceBinding"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    fingerprint: parseFingerprint(input.fingerprint, `${path}.fingerprint`),
    sourceBinding: safeId(input.sourceBinding, `${path}.sourceBinding`),
  };
}

function assertActionMatchesOperation(
  action: ResolvedOperationPlanV2["action"],
  workItem: ResolvedOperationPlanV2["workItem"],
  path: string,
): void {
  const operation = workItem.operation;
  if (
    action.kind === "static-structural-analysis" &&
    (operation.id !== "verify.run-fea-static-proof" || operation.version !== "2")
  ) {
    throw new TypeError(
      `${path}.kind static-structural-analysis requires verify.run-fea-static-proof@2.`,
    );
  }
  if (
    action.kind === "isolated-static-structural-analysis" &&
    (operation.id !== "verify.run-fea-static-proof" || operation.version !== "3")
  ) {
    throw new TypeError(
      `${path}.kind isolated-static-structural-analysis requires verify.run-fea-static-proof@3.`,
    );
  }
}

function assertActionCaseMatchesSource(
  action: ResolvedOperationPlanV2["action"],
  sources: readonly ResolvedOperationPlanSource[],
  path: string,
): void {
  const caseIdentity = action.input.proofCase;
  const source = sources.find((candidate) =>
    candidate.bindingName === caseIdentity.sourceBinding
  );
  if (!source) {
    throw new TypeError(
      `${path} case sourceBinding must name an exact $plan.sources binding.`,
    );
  }
  if (!fingerprintsEqual(source.artifact.fingerprint, caseIdentity.fingerprint)) {
    throw new TypeError(
      `${path} case fingerprint must equal its exact source artifact fingerprint.`,
    );
  }
  assertSourceRoleAndMedia(
    source,
    "proof-case",
    "application/json",
    `${path}.input.proofCase.sourceBinding`,
  );
  const geometry = sources.find((candidate) =>
    candidate.bindingName === action.input.geometrySourceBinding
  );
  if (!geometry) {
    throw new TypeError(
      `${path}.input.geometrySourceBinding must name an exact $plan.sources binding.`,
    );
  }
  assertDistinctSourceEvidence(
    source,
    geometry,
    path,
    "proof case",
    "geometry source",
  );
  assertSourceRoleAndMedia(
    geometry,
    "geometry-source",
    "model/step",
    `${path}.input.geometrySourceBinding`,
  );
  if (
    geometry.artifact.casUri !==
      canonicalCalculixStepPlanCasUri(geometry.artifact.fingerprint)
  ) {
    throw new TypeError(
      `${path}.input.geometrySourceBinding must seal the exact thread-asset CAS URI.`,
    );
  }
}

function assertDistinctSourceEvidence(
  left: ResolvedOperationPlanSource,
  right: ResolvedOperationPlanSource,
  path: string,
  leftLabel: string,
  rightLabel: string,
): void {
  if (left.bindingName === right.bindingName) {
    throw new TypeError(
      `${path} ${leftLabel} and ${rightLabel} must use distinct source bindings.`,
    );
  }
  if (left.threadRef.id === right.threadRef.id) {
    throw new TypeError(
      `${path} ${leftLabel} and ${rightLabel} must reference distinct threadRef artifacts.`,
    );
  }
  if (fingerprintsEqual(left.artifact.fingerprint, right.artifact.fingerprint)) {
    throw new TypeError(
      `${path} ${leftLabel} and ${rightLabel} must reference distinct artifact bytes.`,
    );
  }
}

function assertProviderEvidenceMatchesAction(
  action: ResolvedOperationPlanV2["action"],
  authorization: ResolvedOperationPlanV2["authorization"],
  sources: readonly ResolvedOperationPlanSource[],
  expected: ResolvedOperationPlanExpectedResources,
  recovery: ResolvedOperationPlanRecovery,
  path: string,
): void {
  if (action.kind === "isolated-static-structural-analysis") {
    if (
      expected.resourceProfile.id !== CALCULIX_ISOLATED_STATIC_RESOURCE_PROFILE.id ||
      !("receiptSchema" in expected) ||
      recovery.policy !== "calculix-isolated-generation-recovery@1.0"
    ) {
      throw new TypeError(
        `${path} local CalculiX action requires its exact output and generation-recovery profiles.`,
      );
    }
    if (
      authorization.methodQualification.id !==
        "qualified-calculix-isolated-static-proof" ||
      authorization.methodQualification.version !== "1.0" ||
      !fingerprintsEqual(
        authorization.methodQualification.fingerprint,
        action.executor.profileFingerprint,
      )
    ) {
      throw new TypeError(
        `${path} local CalculiX action requires the exact qualified isolated profile.`,
      );
    }
    assertClosedSourceProfile(
      sources,
      [
        ["proofCase", "proof-case", "application/json"],
        ["geometry", "geometry-source", "model/step"],
      ],
      `${path}.sources`,
    );
    return;
  }
  if (
    expected.resourceProfile.id !== CALCULIX_RECORDED_STATIC_RESOURCE_PROFILE.id ||
    recovery.policy !== "mcp-calculix.recorded-static-recovery@1.0"
  ) {
    throw new TypeError(
      `${path} CalculiX action requires its exact resource and recovery profiles.`,
    );
  }
  if (
    authorization.methodQualification.id !==
      "qualified-static-structural-proof-case" ||
    authorization.methodQualification.version !== "1.0"
  ) {
    throw new TypeError(
      `${path} CalculiX action requires the qualified-static-structural-proof-case@1.0 method.`,
    );
  }
  assertClosedSourceProfile(
    sources,
    [
      ["proofCase", "proof-case", "application/json"],
      ["geometry", "geometry-source", "model/step"],
    ],
    `${path}.sources`,
  );
  const proofCase = sources.find((source) => source.bindingName === "proofCase")!;
  if (
    !fingerprintsEqual(
      proofCase.artifact.fingerprint,
      authorization.methodQualification.fingerprint,
    )
  ) {
    throw new TypeError(
      `${path}.authorization.methodQualification.fingerprint must equal the exact proof-case authority artifact.`,
    );
  }
}

function assertClosedSourceProfile(
  sources: readonly ResolvedOperationPlanSource[],
  expected: readonly (readonly [string, string, string])[],
  path: string,
): void {
  if (sources.length !== expected.length) {
    throw new TypeError(
      `${path} must contain exactly the code-owned source profile for this action.`,
    );
  }
  for (const [bindingName, role, mediaType] of expected) {
    const source = sources.find((candidate) => candidate.bindingName === bindingName);
    if (!source) {
      throw new TypeError(`${path} is missing binding ${bindingName}.`);
    }
    assertSourceRoleAndMedia(
      source,
      role,
      mediaType,
      `${path}.${bindingName}`,
    );
  }
}

function assertSourceRoleAndMedia(
  source: ResolvedOperationPlanSource,
  expectedRole: string,
  expectedMediaType: string,
  path: string,
): void {
  if (source.role !== expectedRole || source.artifact.mediaType !== expectedMediaType) {
    throw new TypeError(
      `${path} must name a ${expectedRole} source with ${expectedMediaType} media type.`,
    );
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = strictRecord(value, ["algorithm", "digest"], path);
  literal(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(input.digest, `${path}.digest`);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return { algorithm: "sha256", digest };
}

function casUriForFingerprint(
  value: unknown,
  fingerprint: ContentFingerprint,
  path: string,
): string {
  const uri = nonEmptyText(value, path);
  const expected =
    `casys://${RESOLVED_OPERATION_PLAN_URI_NAMESPACE}/sha256/${fingerprint.digest}`;
  if (uri !== expected) {
    throw new TypeError(
      `${path} must equal the canonical CAS URI for its fingerprint.`,
    );
  }
  return uri;
}

/** Source captures may live in a provider-specific CAS namespace. */
function artifactCasUriForFingerprint(
  value: unknown,
  fingerprint: ContentFingerprint,
  path: string,
): string {
  const uri = nonEmptyText(value, path);
  if (!/^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/.test(uri)) {
    throw new TypeError(`${path} must be a canonical casys SHA-256 URI.`);
  }
  if (!uri.endsWith(`/sha256/${fingerprint.digest}`)) {
    throw new TypeError(`${path} must name the exact artifact fingerprint.`);
  }
  return uri;
}

function mediaType(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (!MEDIA_TYPE.test(result)) {
    throw new TypeError(`${path} must be a canonical media type.`);
  }
  return result;
}

function providerRequestId(
  value: unknown,
  pattern: RegExp,
  path: string,
  provider: string,
): string {
  const result = nonEmptyText(value, path);
  if (!pattern.test(result)) {
    throw new TypeError(
      `${path} must match the exact ${provider} request_id contract.`,
    );
  }
  return result;
}

function asciiCompare(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
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
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError(`${path} must not contain symbol fields.`);
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${path}.${key} must be an enumerable data field.`);
    }
  }
  return value as Record<string, unknown>;
}

function strictArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${path} must be a plain array.`);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
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

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new TypeError(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}
