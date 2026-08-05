import { verifyCoffeeMachineBuildPlan } from "../../domain/coffee-machine-build-plan.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadProvenanceLink,
} from "../../domain/thread-snapshot.ts";
import type { ThreadSnapshotExtension } from "../../domain/thread-snapshot-extension.ts";
import {
  COFFEE_MACHINE_BUILD_RUN_SCHEMA,
  type CoffeeMachineBuildExportFile,
  type CoffeeMachineBuildExportResult,
  type CoffeeMachineBuildRunCapture,
} from "./coffee-machine-build-orchestrator.ts";
import {
  SYSON_COFFEE_MACHINE_BUILD_SOURCE_SCHEMA,
  type SysonCoffeeMachineBuildSourceCapture,
  type SysonCoffeeMachineBuildSourcePayload,
  type SysonCoffeeMachineValueRead,
  type SysonNumericLiteralKind,
} from "./syson-coffee-machine-build-observer.ts";

export const COFFEE_MACHINE_BUILD_SUBJECT_ID = "coffee-machine-cm01" as const;

export interface CoffeeMachineBuildRunExtensionOptions {
  /** Stable orchestration identity shared by live and canonical projections. */
  runId: string;
  /** Optional URI of the persisted capture containing source, plan and script. */
  sourceUri?: string;
}

const RUN_KEYS = [
  "schemaVersion",
  "capturedAt",
  "sourceCapture",
  "compiledPlan",
  "toolCall",
  "result",
] as const;
const SOURCE_CAPTURE_KEYS = [
  "schemaVersion",
  "capturedAt",
  "source",
  "sourceFingerprint",
] as const;
const SOURCE_KEYS = [
  "editingContextId",
  "rootPartDefinitionId",
  "exactAttributeIds",
  "reads",
] as const;
const READ_KEYS = ["tool", "arguments", "structuredContent"] as const;
const READ_ARGUMENT_KEYS = ["editing_context_id", "element_id"] as const;
const READ_CONTENT_KEYS = [
  "element_id",
  "value",
  "literal_id",
  "literal_kind",
  "negated",
] as const;
const COMPILED_PLAN_KEYS = ["plan", "script"] as const;
const TOOL_CALL_KEYS = ["name", "arguments"] as const;
const TOOL_ARGUMENT_KEYS = [
  "script",
  "formats",
  "name",
  "timeout_ms",
] as const;
const RESULT_KEYS = ["schemaVersion", "kind", "metrics", "files"] as const;
const FILE_KEYS = ["format", "path", "bytes", "sha256"] as const;
const FORMAT_ORDER = ["step", "gltf", "stl"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_EXPORT_PATH = /^\/exports\/[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Validate and project one complete SysON -> plan -> build123d capture.
 *
 * This is deliberately evidence-only. It does not turn export success or
 * provider metrics into requirements, observations, evaluations or verdicts.
 */
export async function materializeCoffeeMachineBuildRunExtension(
  value: unknown,
  options: CoffeeMachineBuildRunExtensionOptions,
): Promise<ThreadSnapshotExtension> {
  const runId = safeId(options?.runId, "$options.runId");
  const sourceUri = options.sourceUri === undefined
    ? undefined
    : nonEmptyString(options.sourceUri, "$options.sourceUri");
  const capture = await validateBuildRunCapture(value);
  const prefix = `coffee-machine-build-${runId}`;
  const sourceId = `${prefix}-syson-source`;
  const planId = `${prefix}-plan`;
  const scriptId = `${prefix}-script`;
  const exportIds = {
    step: `${prefix}-step`,
    gltf: `${prefix}-gltf`,
    stl: `${prefix}-stl`,
  } as const;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const sysonOperation: ThreadOperationRef = {
    serverId: "syson",
    tool: "syson_value_read",
    runId,
  };
  const compileOperation: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "compile_coffee_machine_build_plan",
    runId,
  };
  const exportOperation: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };

  const artifacts: ThreadArtifact[] = [
    artifact({
      id: sourceId,
      name: "CoffeeMachine exact SysON value-read evidence",
      kind: "evidence",
      fingerprint: capture.sourceCapture.sourceFingerprint,
      uri: sourceUri ? `${sourceUri}#sourceCapture` : undefined,
      mediaType: "application/json",
      producer: sysonOperation,
      inputArtifactIds: [],
      freshness,
    }),
    artifact({
      id: planId,
      name: "CoffeeMachine canonical build plan",
      kind: "document",
      fingerprint: capture.compiledPlan.plan.fingerprints.plan,
      uri: sourceUri ? `${sourceUri}#compiledPlan.plan` : undefined,
      mediaType: "application/json",
      producer: compileOperation,
      inputArtifactIds: [sourceId],
      freshness,
    }),
    artifact({
      id: scriptId,
      name: "CoffeeMachine deterministic build123d script",
      kind: "script",
      fingerprint: capture.compiledPlan.plan.fingerprints.script,
      uri: sourceUri ? `${sourceUri}#compiledPlan.script` : undefined,
      mediaType: "text/x-python",
      producer: compileOperation,
      inputArtifactIds: [planId],
      freshness,
    }),
    ...capture.result.files.map((file) =>
      artifact({
        id: exportIds[file.format],
        name: exportName(file.format),
        kind: exportKind(file.format),
        fingerprint: fingerprint(file.sha256),
        uri: file.path,
        mediaType: exportMediaType(file.format, file.path),
        producer: exportOperation,
        inputArtifactIds: [scriptId],
        freshness,
      })
    ),
  ];
  const provenance: ThreadProvenanceLink[] = [
    derivedFrom(
      `${prefix}-plan-derived-from-source`,
      planId,
      sourceId,
      "The canonical plan binds the exact AttributeUsage identities and values in the SysON capture.",
    ),
    derivedFrom(
      `${prefix}-script-derived-from-plan`,
      scriptId,
      planId,
      "The reviewed deterministic compiler rendered this exact script from the verified plan.",
    ),
    ...FORMAT_ORDER.map((format) =>
      derivedFrom(
        `${prefix}-${format}-derived-from-script`,
        exportIds[format],
        scriptId,
        `build123d_export produced the ${format.toUpperCase()} file from the exact captured script.`,
      )
    ),
  ];
  const consumptions: ThreadArtifactConsumption[] = [
    consumption(
      `${prefix}-consume-source-by-compiler`,
      sourceId,
      compileOperation,
      capture.sourceCapture.sourceFingerprint,
      capture.capturedAt,
    ),
    consumption(
      `${prefix}-consume-plan-by-compiler`,
      planId,
      compileOperation,
      capture.compiledPlan.plan.fingerprints.plan,
      capture.capturedAt,
    ),
    consumption(
      `${prefix}-consume-script-by-build123d`,
      scriptId,
      exportOperation,
      capture.compiledPlan.plan.fingerprints.script,
      capture.capturedAt,
    ),
  ];
  provenance.push(...consumptions.map((item) => ({
    id: `${item.id}-uses-${item.artifactId}`,
    relation: "uses" as const,
    from: { kind: "consumption" as const, id: item.id },
    to: { kind: "artifact" as const, id: item.artifactId },
    rationale:
      "The downstream operation attested the exact upstream fingerprint it consumed.",
  })));

  return {
    id: `${prefix}-extension`,
    name: "Capture the CoffeeMachine SysON-to-build123d run",
    subjectId: COFFEE_MACHINE_BUILD_SUBJECT_ID,
    capturedAt: capture.capturedAt,
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  };
}

function consumption(
  id: string,
  artifactId: string,
  consumer: ThreadOperationRef,
  observedFingerprint: ContentFingerprint,
  verifiedAt: string,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId,
    consumer,
    observedFingerprint: structuredClone(observedFingerprint),
    verifiedAt,
    status: "verified",
  };
}

async function validateBuildRunCapture(
  value: unknown,
): Promise<CoffeeMachineBuildRunCapture> {
  assertJsonValue(value, "$capture", new Set());
  const root = record(value, "$capture");
  exactKeys(root, RUN_KEYS, "$capture");
  literal(
    root.schemaVersion,
    COFFEE_MACHINE_BUILD_RUN_SCHEMA,
    "$capture.schemaVersion",
  );
  const capturedAt = isoDate(root.capturedAt, "$capture.capturedAt");
  const sourceCapture = await validateSourceCapture(root.sourceCapture);
  if (sourceCapture.capturedAt !== capturedAt) {
    throw new Error(
      "$capture.sourceCapture.capturedAt must exactly match $capture.capturedAt.",
    );
  }

  const compiledRoot = record(root.compiledPlan, "$capture.compiledPlan");
  exactKeys(compiledRoot, COMPILED_PLAN_KEYS, "$capture.compiledPlan");
  const verified = await verifyCoffeeMachineBuildPlan(compiledRoot.plan);
  const script = string(compiledRoot.script, "$capture.compiledPlan.script");
  if (script !== verified.script) {
    throw new Error(
      "$capture.compiledPlan.script does not match the verified deterministic plan.",
    );
  }
  assertSourceMatchesPlan(sourceCapture, verified.plan);
  const toolCall = validateToolCall(
    root.toolCall,
    verified.script,
    verified.plan.fingerprints.plan.digest,
  );
  const result = validateExportResult(root.result);

  return {
    schemaVersion: COFFEE_MACHINE_BUILD_RUN_SCHEMA,
    capturedAt,
    sourceCapture,
    compiledPlan: { plan: verified.plan, script: verified.script },
    toolCall,
    result,
  };
}

async function validateSourceCapture(
  value: unknown,
): Promise<SysonCoffeeMachineBuildSourceCapture> {
  const root = record(value, "$capture.sourceCapture");
  exactKeys(root, SOURCE_CAPTURE_KEYS, "$capture.sourceCapture");
  literal(
    root.schemaVersion,
    SYSON_COFFEE_MACHINE_BUILD_SOURCE_SCHEMA,
    "$capture.sourceCapture.schemaVersion",
  );
  const capturedAt = isoDate(
    root.capturedAt,
    "$capture.sourceCapture.capturedAt",
  );
  const rawSource = record(root.source, "$capture.sourceCapture.source");
  exactKeys(rawSource, SOURCE_KEYS, "$capture.sourceCapture.source");
  const editingContextId = uuid(
    rawSource.editingContextId,
    "$capture.sourceCapture.source.editingContextId",
  );
  const rootPartDefinitionId = uuid(
    rawSource.rootPartDefinitionId,
    "$capture.sourceCapture.source.rootPartDefinitionId",
  );
  const exactAttributeIds = stringArray(
    rawSource.exactAttributeIds,
    "$capture.sourceCapture.source.exactAttributeIds",
  ).map((id, index) =>
    uuid(id, `$capture.sourceCapture.source.exactAttributeIds[${index}]`)
  );
  if (exactAttributeIds.length === 0) {
    throw new Error(
      "$capture.sourceCapture.source.exactAttributeIds must not be empty.",
    );
  }
  rejectDuplicates(
    exactAttributeIds,
    "$capture.sourceCapture.source.exactAttributeIds",
  );
  const reads = array(
    rawSource.reads,
    "$capture.sourceCapture.source.reads",
  ).map((read, index) =>
    validateSourceRead(
      read,
      editingContextId,
      `$capture.sourceCapture.source.reads[${index}]`,
    )
  );
  if (
    reads.length !== exactAttributeIds.length ||
    reads.some((read, index) =>
      read.structuredContent.element_id !== exactAttributeIds[index]
    )
  ) {
    throw new Error(
      "$capture.sourceCapture.source.reads must exactly match exactAttributeIds in order.",
    );
  }
  const source: SysonCoffeeMachineBuildSourcePayload = {
    editingContextId,
    rootPartDefinitionId,
    exactAttributeIds,
    reads,
  };
  const sourceFingerprint = contentFingerprint(
    root.sourceFingerprint,
    "$capture.sourceCapture.sourceFingerprint",
  );
  const actualDigest = await sha256(canonicalJson(source));
  if (sourceFingerprint.digest !== actualDigest) {
    throw new Error(
      "$capture.sourceCapture.sourceFingerprint does not match canonical source bytes.",
    );
  }
  return {
    schemaVersion: SYSON_COFFEE_MACHINE_BUILD_SOURCE_SCHEMA,
    capturedAt,
    source,
    sourceFingerprint,
  };
}

function validateSourceRead(
  value: unknown,
  editingContextId: string,
  path: string,
): SysonCoffeeMachineValueRead {
  const root = record(value, path);
  exactKeys(root, READ_KEYS, path);
  literal(root.tool, "syson_value_read", `${path}.tool`);
  const args = record(root.arguments, `${path}.arguments`);
  exactKeys(args, READ_ARGUMENT_KEYS, `${path}.arguments`);
  literal(
    args.editing_context_id,
    editingContextId,
    `${path}.arguments.editing_context_id`,
  );
  const elementId = uuid(args.element_id, `${path}.arguments.element_id`);
  const content = record(root.structuredContent, `${path}.structuredContent`);
  exactKeys(content, READ_CONTENT_KEYS, `${path}.structuredContent`);
  literal(
    content.element_id,
    elementId,
    `${path}.structuredContent.element_id`,
  );
  const valueRead = finiteNumber(
    content.value,
    `${path}.structuredContent.value`,
  );
  const literalId = uuid(
    content.literal_id,
    `${path}.structuredContent.literal_id`,
  );
  const literalKind = oneOf(
    content.literal_kind,
    ["LiteralInteger", "LiteralRational"] as const,
    `${path}.structuredContent.literal_kind`,
  ) as SysonNumericLiteralKind;
  if (literalKind === "LiteralInteger" && !Number.isInteger(valueRead)) {
    throw new Error(
      `${path}.structuredContent.value must be an integer for LiteralInteger.`,
    );
  }
  if (typeof content.negated !== "boolean") {
    throw new Error(`${path}.structuredContent.negated must be a boolean.`);
  }
  if (
    (valueRead < 0 && !content.negated) ||
    (valueRead > 0 && content.negated)
  ) {
    throw new Error(
      `${path}.structuredContent.negated is inconsistent with its value.`,
    );
  }
  return {
    tool: "syson_value_read",
    arguments: {
      editing_context_id: editingContextId,
      element_id: elementId,
    },
    structuredContent: {
      element_id: elementId,
      value: valueRead,
      literal_id: literalId,
      literal_kind: literalKind,
      negated: content.negated,
    },
  };
}

function assertSourceMatchesPlan(
  sourceCapture: SysonCoffeeMachineBuildSourceCapture,
  plan: Awaited<ReturnType<typeof verifyCoffeeMachineBuildPlan>>["plan"],
): void {
  const source = sourceCapture.source;
  if (source.editingContextId !== plan.editingContextId) {
    throw new Error("SysON editingContextId does not match the compiled plan.");
  }
  if (source.rootPartDefinitionId !== plan.rootPartDefinitionId) {
    throw new Error("SysON rootPartDefinitionId does not match the compiled plan.");
  }
  if (sourceCapture.sourceFingerprint.digest !== plan.sourceFingerprint.digest) {
    throw new Error("SysON source fingerprint does not match the compiled plan.");
  }
  if (
    plan.fingerprints.source.digest !== sourceCapture.sourceFingerprint.digest
  ) {
    throw new Error("Compiled plan source fingerprint does not match SysON evidence.");
  }
  const reads = new Map(
    source.reads.map((read) => [
      read.structuredContent.element_id,
      read.structuredContent.value,
    ]),
  );
  if (
    reads.size !== plan.sourceAttributes.length ||
    source.exactAttributeIds.length !== plan.sourceAttributes.length
  ) {
    throw new Error(
      "SysON exact reads must contain exactly the compiled plan source attributes.",
    );
  }
  for (const attribute of plan.sourceAttributes) {
    if (!reads.has(attribute.id)) {
      throw new Error(
        `SysON source capture is missing compiled attribute ${attribute.id}.`,
      );
    }
    if (!Object.is(reads.get(attribute.id), attribute.value)) {
      throw new Error(
        `SysON value for ${attribute.id} does not match the compiled plan.`,
      );
    }
  }
}

function validateToolCall(
  value: unknown,
  script: string,
  planDigest: string,
): CoffeeMachineBuildRunCapture["toolCall"] {
  const root = record(value, "$capture.toolCall");
  exactKeys(root, TOOL_CALL_KEYS, "$capture.toolCall");
  literal(root.name, "build123d_export", "$capture.toolCall.name");
  const args = record(root.arguments, "$capture.toolCall.arguments");
  exactKeys(args, TOOL_ARGUMENT_KEYS, "$capture.toolCall.arguments");
  literal(args.script, script, "$capture.toolCall.arguments.script");
  const formats = array(args.formats, "$capture.toolCall.arguments.formats");
  if (
    formats.length !== FORMAT_ORDER.length ||
    formats.some((format, index) => format !== FORMAT_ORDER[index])
  ) {
    throw new Error(
      "$capture.toolCall.arguments.formats must exactly equal step, gltf, stl.",
    );
  }
  const expectedName = `coffee-machine-${planDigest.slice(0, 16)}`;
  literal(args.name, expectedName, "$capture.toolCall.arguments.name");
  literal(args.timeout_ms, 120000, "$capture.toolCall.arguments.timeout_ms");
  return {
    name: "build123d_export",
    arguments: {
      script,
      formats: ["step", "gltf", "stl"],
      name: expectedName,
      timeout_ms: 120000,
    },
  };
}

function validateExportResult(value: unknown): CoffeeMachineBuildExportResult {
  const root = record(value, "$capture.result");
  exactKeys(root, RESULT_KEYS, "$capture.result");
  literal(root.schemaVersion, "1.0", "$capture.result.schemaVersion");
  literal(root.kind, "export", "$capture.result.kind");
  const metrics = jsonObject(root.metrics, "$capture.result.metrics");
  const rawFiles = array(root.files, "$capture.result.files");
  if (rawFiles.length !== FORMAT_ORDER.length) {
    throw new Error("$capture.result.files must contain exactly three files.");
  }
  const files = rawFiles.map((file, index) =>
    validateExportFile(
      file,
      FORMAT_ORDER[index],
      `$capture.result.files[${index}]`,
    )
  );
  rejectDuplicates(files.map((file) => file.path), "$capture.result.files paths");
  return {
    schemaVersion: "1.0",
    kind: "export",
    metrics,
    files,
  };
}

function validateExportFile(
  value: unknown,
  expectedFormat: (typeof FORMAT_ORDER)[number],
  path: string,
): CoffeeMachineBuildExportFile {
  const root = record(value, path);
  exactKeys(root, FILE_KEYS, path);
  literal(root.format, expectedFormat, `${path}.format`);
  const exportPath = string(root.path, `${path}.path`);
  if (!SAFE_EXPORT_PATH.test(exportPath)) {
    throw new Error(`${path}.path must be a safe /exports/<filename> path.`);
  }
  if (!hasExpectedExtension(expectedFormat, exportPath)) {
    throw new Error(`${path}.path extension does not match ${expectedFormat}.`);
  }
  const bytes = positiveSafeInteger(root.bytes, `${path}.bytes`);
  const digest = shaDigest(root.sha256, `${path}.sha256`);
  return { format: expectedFormat, path: exportPath, bytes, sha256: digest };
}

function artifact(value: Omit<ThreadArtifact, "version">): ThreadArtifact {
  return {
    ...value,
    version: value.fingerprint.digest,
  };
}

function derivedFrom(
  id: string,
  fromArtifactId: string,
  toArtifactId: string,
  rationale: string,
): ThreadProvenanceLink {
  return {
    id,
    relation: "derived_from",
    from: { kind: "artifact", id: fromArtifactId },
    to: { kind: "artifact", id: toArtifactId },
    rationale,
  };
}

function exportName(format: (typeof FORMAT_ORDER)[number]): string {
  switch (format) {
    case "step":
      return "CoffeeMachine authoritative STEP export";
    case "gltf":
      return "CoffeeMachine GLTF presentation export";
    case "stl":
      return "CoffeeMachine STL presentation export";
  }
}

function exportKind(
  format: (typeof FORMAT_ORDER)[number],
): ThreadArtifact["kind"] {
  if (format === "step") return "step";
  if (format === "stl") return "mesh";
  return "cad-model";
}

function exportMediaType(
  format: (typeof FORMAT_ORDER)[number],
  path: string,
): string {
  if (format === "step") return "model/step";
  if (format === "stl") return "model/stl";
  return path.toLowerCase().endsWith(".glb") ? "model/gltf-binary" : "model/gltf+json";
}

function hasExpectedExtension(
  format: (typeof FORMAT_ORDER)[number],
  path: string,
): boolean {
  const lower = path.toLowerCase();
  if (format === "step") {
    return lower.endsWith(".step") || lower.endsWith(".stp");
  }
  if (format === "gltf") {
    return lower.endsWith(".gltf") || lower.endsWith(".glb");
  }
  return lower.endsWith(".stl");
}

function fingerprint(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function contentFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = record(value, path);
  exactKeys(root, ["algorithm", "digest"], path);
  literal(root.algorithm, "sha256", `${path}.algorithm`);
  return fingerprint(shaDigest(root.digest, `${path}.digest`));
}

function jsonObject(
  value: unknown,
  path: string,
): CoffeeMachineBuildExportResult["metrics"] {
  const result = record(value, path);
  assertJsonValue(result, path, new Set());
  return structuredClone(result) as CoffeeMachineBuildExportResult["metrics"];
}

function assertJsonValue(
  value: unknown,
  path: string,
  seen: Set<object>,
): void {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must be finite JSON.`);
    }
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain JSON-only values.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles.`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, seen));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain plain JSON objects.`);
    }
    for (const [key, item] of Object.entries(value)) {
      assertJsonValue(item, `${path}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return `{${
      Object.keys(input).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(input[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const expectedKeys = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new TypeError(`${path}: unsupported field ${key}.`);
    }
  }
  for (const key of expected) {
    if (!(key in value)) {
      throw new TypeError(`${path}: missing field ${key}.`);
    }
  }
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value;
}

function stringArray(value: unknown, path: string): string[] {
  return array(value, path).map((item, index) => string(item, `${path}[${index}]`));
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a string.`);
  }
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const result = string(value, path);
  if (!result.trim()) throw new TypeError(`${path} must be non-empty.`);
  return result;
}

function safeId(value: unknown, path: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${path} must be a safe stable id.`);
  }
  return value;
}

function uuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${path} must be a canonical lowercase UUID.`);
  }
  return value;
}

function isoDate(value: unknown, path: string): string {
  const result = string(value, path);
  if (Number.isNaN(Date.parse(result))) {
    throw new TypeError(`${path} must be ISO-8601.`);
  }
  return result;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return value;
}

function shaDigest(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}

function literal<T extends string | number>(
  value: unknown,
  expected: T,
  path: string,
): asserts value is T {
  if (value !== expected) {
    throw new TypeError(`${path} must be ${expected}.`);
  }
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  expected: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !expected.includes(value)) {
    throw new TypeError(`${path} must be one of ${expected.join(", ")}.`);
  }
  return value as T[number];
}

function rejectDuplicates(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${path} must not contain duplicates.`);
  }
}
