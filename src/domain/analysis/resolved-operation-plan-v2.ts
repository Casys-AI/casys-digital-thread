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
  finite,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/types.ts";

export const RESOLVED_OPERATION_PLAN_V2_SCHEMA = "resolved-operation-plan/2.0" as const;
export const RESOLVED_OPERATION_PLAN_REF_SCHEMA =
  "resolved-operation-plan-ref/1.0" as const;
export const RESOLVED_OPERATION_PLAN_URI_NAMESPACE = "resolved-operation-plan" as const;

export const MODELICA_RESUMABLE_RESOURCE_PROFILE = deepFreeze(
  {
    id: "mcp-modelica.resumable-artifacts",
    version: "2.1",
    always: [
      { role: "request", mediaType: "application/json" },
      { role: "resolved_parameters", mediaType: "application/json" },
      { role: "model", mediaType: "text/x-modelica" },
      { role: "scenario", mediaType: "application/json" },
      { role: "script", mediaType: "text/plain" },
      { role: "diagnostics", mediaType: "text/plain" },
      { role: "evidence", mediaType: "application/json" },
    ],
    whenParameterSchemaRequired: {
      role: "parameter_schema",
      mediaType: "application/json",
    },
    whenRunSucceeded: { role: "result", mediaType: "text/csv" },
  } as const,
);

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
    | ResolvedModelicaSimulationAction
    | ResolvedCalculixStaticStructuralAction;
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
      readonly id: "mcp-modelica.resumable-artifacts";
      readonly version: "2.1";
    };
    /** Derived from the exact sealed provider manifest, never caller-selected. */
    readonly parameterSchema: "required" | "absent";
  }
  | {
    readonly ledgerSchema: "provider-resource-acquisition-ledger/1.0";
    readonly captureManifestSchema: "provider-artifact-capture-manifest/1.0";
    readonly resourceProfile: {
      readonly id: "mcp-calculix.recorded-static-artifacts";
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
    | { readonly policy: "mcp-modelica.resumable-recovery@2.1" }
    | { readonly policy: "mcp-calculix.recorded-static-recovery@1.0" }
  );

export interface ResolvedModelicaSimulationAction {
  readonly kind: "dynamic-system-simulation";
  readonly provider: {
    readonly id: "mcp-modelica";
    readonly contract: { readonly id: "resumable"; readonly version: "2.1" };
  };
  readonly lowering: {
    readonly id: "modelica-omc-lowering";
    readonly version: "1.0.0";
  };
  /** Bounded kit identity which an executor must recross with the exact manifest bytes. */
  readonly normalizer: {
    readonly id: string;
    readonly version: string;
    readonly authority: "exact-provider-manifest";
  };
  readonly requestId: string;
  readonly input: {
    readonly simulationCase: {
      readonly id: string;
      readonly fingerprint: ContentFingerprint;
      readonly sourceBinding: string;
    };
    /**
     * Semantic fingerprint declared inside the exact provider manifest bytes.
     * It is intentionally distinct from the CAS full-byte artifact fingerprint.
     */
    readonly providerManifestFingerprint: ContentFingerprint;
    readonly methodManifestSourceBinding: string;
    readonly scenarioStartTimeSeconds: number;
    readonly effectiveTimeoutMs: number;
  };
}

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

const SHA256_HEX = /^[a-f0-9]{64}$/;
const MODELICA_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CALCULIX_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MODELICA_MAX_TIMEOUT_MS = 120_000;
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
  if (root.kind === "dynamic-system-simulation") {
    const input = strictRecord(
      value,
      ["kind", "provider", "lowering", "normalizer", "requestId", "input"],
      path,
    );
    const provider = strictRecord(
      input.provider,
      ["id", "contract"],
      `${path}.provider`,
    );
    literal(provider.id, "mcp-modelica", `${path}.provider.id`);
    const contract = strictRecord(
      provider.contract,
      ["id", "version"],
      `${path}.provider.contract`,
    );
    literal(contract.id, "resumable", `${path}.provider.contract.id`);
    literal(contract.version, "2.1", `${path}.provider.contract.version`);
    const lowering = strictRecord(
      input.lowering,
      ["id", "version"],
      `${path}.lowering`,
    );
    literal(lowering.id, "modelica-omc-lowering", `${path}.lowering.id`);
    literal(lowering.version, "1.0.0", `${path}.lowering.version`);
    const normalizer = boundedNormalizerIdentity(
      input.normalizer,
      `${path}.normalizer`,
    );
    const actionInput = strictRecord(
      input.input,
      [
        "simulationCase",
        "providerManifestFingerprint",
        "methodManifestSourceBinding",
        "scenarioStartTimeSeconds",
        "effectiveTimeoutMs",
      ],
      `${path}.input`,
    );
    return {
      kind: "dynamic-system-simulation",
      provider: {
        id: "mcp-modelica",
        contract: { id: "resumable", version: "2.1" },
      },
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      normalizer,
      requestId: providerRequestId(
        input.requestId,
        MODELICA_REQUEST_ID,
        `${path}.requestId`,
        "mcp-modelica 2.1",
      ),
      input: {
        simulationCase: sourceBoundCaseIdentity(
          actionInput.simulationCase,
          `${path}.input.simulationCase`,
        ),
        providerManifestFingerprint: parseFingerprint(
          actionInput.providerManifestFingerprint,
          `${path}.input.providerManifestFingerprint`,
        ),
        methodManifestSourceBinding: safeId(
          actionInput.methodManifestSourceBinding,
          `${path}.input.methodManifestSourceBinding`,
        ),
        scenarioStartTimeSeconds: nonNegativeFinite(
          actionInput.scenarioStartTimeSeconds,
          `${path}.input.scenarioStartTimeSeconds`,
        ),
        effectiveTimeoutMs: boundedPositiveInteger(
          actionInput.effectiveTimeoutMs,
          MODELICA_MAX_TIMEOUT_MS,
          `${path}.input.effectiveTimeoutMs`,
          "mcp-modelica 2.1",
        ),
      },
    };
  }
  if (root.kind === "static-structural-analysis") {
    const input = strictRecord(
      value,
      ["kind", "provider", "lowering", "requestId", "input"],
      path,
    );
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
    return {
      kind: "static-structural-analysis",
      provider: {
        id: "mcp-calculix",
        contract: { id: "calculix_solve_static_recorded", version: "1.0" },
        executionIdentitySchema: "1.0",
        runSchema: "2.0",
        resultSchema: "2.0",
      },
      lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
      requestId: providerRequestId(
        input.requestId,
        CALCULIX_REQUEST_ID,
        `${path}.requestId`,
        "mcp-calculix",
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
    };
  }
  throw new TypeError(
    `${path}.kind must be dynamic-system-simulation or static-structural-analysis.`,
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
  if (profile.id === MODELICA_RESUMABLE_RESOURCE_PROFILE.id) {
    const input = strictRecord(
      value,
      [
        "ledgerSchema",
        "captureManifestSchema",
        "resourceProfile",
        "parameterSchema",
      ],
      path,
    );
    parseProviderEvidenceSchemas(input, path);
    literal(
      profile.version,
      MODELICA_RESUMABLE_RESOURCE_PROFILE.version,
      `${path}.resourceProfile.version`,
    );
    if (input.parameterSchema !== "required" && input.parameterSchema !== "absent") {
      throw new TypeError(`${path}.parameterSchema must equal "required" or "absent".`);
    }
    return {
      ledgerSchema: "provider-resource-acquisition-ledger/1.0",
      captureManifestSchema: "provider-artifact-capture-manifest/1.0",
      resourceProfile: {
        id: "mcp-modelica.resumable-artifacts",
        version: "2.1",
      },
      parameterSchema: input.parameterSchema,
    };
  }
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
    input.policy !== "mcp-modelica.resumable-recovery@2.1" &&
    input.policy !== "mcp-calculix.recorded-static-recovery@1.0"
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
    action.kind === "dynamic-system-simulation" &&
    (operation.id !== "simulate.run-modelica-scenario" || operation.version !== "2")
  ) {
    throw new TypeError(
      `${path}.kind dynamic-system-simulation requires simulate.run-modelica-scenario@2.`,
    );
  }
  if (
    action.kind === "static-structural-analysis" &&
    (operation.id !== "verify.run-fea-static-proof" || operation.version !== "2")
  ) {
    throw new TypeError(
      `${path}.kind static-structural-analysis requires verify.run-fea-static-proof@2.`,
    );
  }
}

function assertActionCaseMatchesSource(
  action: ResolvedOperationPlanV2["action"],
  sources: readonly ResolvedOperationPlanSource[],
  path: string,
): void {
  const caseIdentity = action.kind === "dynamic-system-simulation"
    ? action.input.simulationCase
    : action.input.proofCase;
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
  if (action.kind === "dynamic-system-simulation") {
    assertSourceRoleAndMedia(
      source,
      "simulation-case",
      "application/json",
      `${path}.input.simulationCase.sourceBinding`,
    );
    const manifest = sources.find((candidate) =>
      candidate.bindingName === action.input.methodManifestSourceBinding
    );
    if (!manifest) {
      throw new TypeError(
        `${path} methodManifestSourceBinding must name an exact $plan.sources binding.`,
      );
    }
    assertDistinctSourceEvidence(
      source,
      manifest,
      path,
      "simulation case",
      "method manifest",
    );
    assertSourceRoleAndMedia(
      manifest,
      "provider-manifest",
      "application/json",
      `${path}.input.methodManifestSourceBinding`,
    );
    // The manifest's inner providerManifestFingerprint is deliberately not
    // compared with the CAS byte digest: provider manifests self-describe the
    // digest of their unsigned semantic payload. The future @2 resolver and
    // executor must parse these exact captured bytes and verify that relation.
    return;
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
  expected: ResolvedOperationPlanExpectedResources,
  recovery: ResolvedOperationPlanRecovery,
  path: string,
): void {
  if (action.kind === "dynamic-system-simulation") {
    if (
      expected.resourceProfile.id !== MODELICA_RESUMABLE_RESOURCE_PROFILE.id ||
      recovery.policy !== "mcp-modelica.resumable-recovery@2.1"
    ) {
      throw new TypeError(
        `${path} Modelica action requires its exact resource and recovery profiles.`,
      );
    }
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

function boundedNormalizerIdentity(
  value: unknown,
  path: string,
): ResolvedModelicaSimulationAction["normalizer"] {
  const input = strictRecord(value, ["id", "version", "authority"], path);
  literal(input.authority, "exact-provider-manifest", `${path}.authority`);
  return {
    id: boundedToken(input.id, 128, `${path}.id`),
    version: boundedToken(input.version, 64, `${path}.version`),
    authority: "exact-provider-manifest",
  };
}

function boundedToken(value: unknown, maximumLength: number, path: string): string {
  const result = safeId(value, path);
  if (result.length > maximumLength) {
    throw new TypeError(`${path} must not exceed ${maximumLength} characters.`);
  }
  return result;
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

function boundedPositiveInteger(
  value: unknown,
  maximum: number,
  path: string,
  provider: string,
): number {
  const result = positiveInteger(value, path);
  if (result > maximum) {
    throw new TypeError(`${path} must not exceed ${maximum} for ${provider}.`);
  }
  return result;
}

function nonNegativeFinite(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) throw new TypeError(`${path} must be greater than or equal to zero.`);
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
