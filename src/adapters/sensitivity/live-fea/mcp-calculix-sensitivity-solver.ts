/**
 * Fixed mcp-calculix 0.8.2 adapter for the sensitivity vertical.
 *
 * The application port never exposes an endpoint, tool name, volume, service
 * name, provider picker or argument envelope. This adapter owns the exact
 * recorded-run protocol: one stable request id, `calculix_run_get` recovery,
 * an ordered nine-resource ledger check, then independent byte capture in
 * CAS. A completed provider run is an L3 observation source only, never a
 * verdict or a runtime qualification claim.
 */

import type {
  SensitivityRecordedDispatch,
  SensitivityRecordedProviderResource,
  SensitivityRecordedSolveCapture,
  SensitivityRecordedSolvePlan,
  SensitivityRecordedSolveReadback,
  SensitivitySolveInput,
  SensitivityStaticStructuralSolver,
} from "../../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import {
  SensitivityRecordedSolveOutcomeUnknownError,
  SensitivityRecordedSolveRejectedError,
} from "../../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import type { JsonValue } from "../../../domain/compile/rop/resolved-operation-plan.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import type {
  StaticStructuralLoad,
  StaticStructuralSolveResult,
  StaticStructuralSupport,
} from "../../../domain/sensitivity/live-fea/static-structural-solver.ts";
import type { SensitivityStaticStructuralMethod } from "../../../domain/sensitivity/study/sensitivity-study.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  type ProviderResourceCaptureResult,
  ProviderResourceCaptureService,
} from "../../shared/cas/provider-resource-capture-service.ts";
import { HttpMcpResourceReader } from "../../shared/mcp/http-mcp-resource-reader.ts";
import {
  StatelessMcpHttpTransport,
  StatelessMcpTransportError,
} from "../../shared/mcp/stateless-mcp-http-transport.ts";

export const MCP_CALCULIX_SENSITIVITY_ENDPOINT = "http://127.0.0.1:3015/mcp" as const;
export const MCP_CALCULIX_RECORDED_STATIC_TOOL =
  "calculix_solve_static_recorded" as const;
export const MCP_CALCULIX_RUN_GET_TOOL = "calculix_run_get" as const;

export const CALCULIX_RECORDED_RESOURCE_ORDER = [
  "input.step",
  "request.json",
  "mesh.geo",
  "mesh.inp",
  "gmsh.log",
  "job.inp",
  "ccx.log",
  "job.dat",
  "result.json",
] as const;

const RESOURCE_MEDIA_TYPES = {
  "input.step": "model/step",
  "request.json": "application/json",
  "mesh.geo": "text/plain",
  "mesh.inp": "text/plain",
  "gmsh.log": "text/plain",
  "job.inp": "text/plain",
  "ccx.log": "text/plain",
  "job.dat": "text/plain",
  "result.json": "application/json",
} as const;

const READBACK_SCHEMA = "mcp-calculix-sensitivity-readback/1.0" as const;
const CAPTURE_SCHEMA = "mcp-calculix-sensitivity-capture/1.0" as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RUN_ID = /^r-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fixed adapter protocol seam used by contract tests; it is not agent-facing. */
export interface RecordedCalculixSensitivityProvider {
  callRecorded(request: Readonly<Record<string, JsonValue>>): Promise<unknown>;
  getRun(requestId: string): Promise<unknown>;
  listResources(): Promise<unknown>;
}

type ResourceCapture = ProviderResourceCaptureService<
  "calculix-sensitivity-provider-artifact",
  "calculix-sensitivity-provider-ledger",
  "calculix-sensitivity-provider-manifest"
>;

export interface McpCalculixSensitivitySolverDependencies {
  readonly provider: RecordedCalculixSensitivityProvider;
  readonly capture: ResourceCapture;
  readonly artifacts: Pick<
    FileByteStore<"calculix-sensitivity-provider-artifact">,
    "read"
  >;
}

export class McpCalculixSensitivitySolver implements SensitivityStaticStructuralSolver {
  constructor(
    private readonly dependencies: McpCalculixSensitivitySolverDependencies,
  ) {}

  async resolve(input: SensitivitySolveInput): Promise<SensitivityRecordedSolvePlan> {
    if (input.inputArtifact.fingerprint.algorithm !== "sha256") {
      throw new TypeError("Sensitivity STEP fingerprint must use sha256.");
    }
    const stepSha256 = sha256(input.inputArtifact.fingerprint.digest, "STEP digest");
    const stagedPath = requireStagedLocation(
      input.inputArtifact.stagedAsset.location,
      stepSha256,
    );
    const requestId = await sensitivityRecordedRequestId({
      ...input.execution,
      stepSha256,
    });
    const method = input.method;
    const exactRequest: Readonly<Record<string, JsonValue>> = {
      request_id: requestId,
      step_path: stagedPath,
      expected_step_sha256: stepSha256,
      mesh_size_mm: method.mesh.targetSizeMm,
      material: { e_mpa: method.material.eMpa, nu: method.material.nu },
      selections: [
        ...method.supports.map((support) => ({
          name: support.selection.name,
          box: { min: support.selection.box.min, max: support.selection.box.max },
        })),
        ...method.loads.map((load) => ({
          name: load.selection.name,
          box: { min: load.selection.box.min, max: load.selection.box.max },
        })),
      ],
      fixed: method.supports.map((support) => support.selection.name),
      loads: method.loads.map((load) => ({
        selection: load.selection.name,
        force_n: load.force.value,
      })),
    };
    return {
      requestId,
      phase: input.execution.phase,
      inputArtifact: {
        fingerprint: { algorithm: "sha256", digest: stepSha256 },
        byteCount: input.inputArtifact.byteCount,
      },
      exactRequest,
    };
  }

  async dispatch(
    plan: SensitivityRecordedSolvePlan,
  ): Promise<SensitivityRecordedDispatch> {
    let value: unknown;
    try {
      value = await this.dependencies.provider.callRecorded(plan.exactRequest);
    } catch (error) {
      throw providerError(error, MCP_CALCULIX_RECORDED_STATIC_TOOL);
    }
    try {
      const root = exactRecord(value, [
        "schemaVersion",
        "kind",
        "inputArtifact",
        "mesh",
        "constraints",
        "metrics",
        "run",
      ], "$calculixRecordedDispatch");
      literalValue(
        root.schemaVersion,
        "2.0",
        "$calculixRecordedDispatch.schemaVersion",
      );
      literalValue(
        root.kind,
        "static-solve-recorded",
        "$calculixRecordedDispatch.kind",
      );
      const run = parseCompletedRun(root.run, "$calculixRecordedDispatch.run");
      assertRunMatchesPlan(run, plan);
      return {
        requestId: run.requestId,
        runId: run.runId,
        requestSha256: run.requestSha256,
      };
    } catch (error) {
      throw providerError(error, MCP_CALCULIX_RECORDED_STATIC_TOOL);
    }
  }

  async readback(
    plan: SensitivityRecordedSolvePlan,
    expected?: SensitivityRecordedDispatch,
  ): Promise<SensitivityRecordedSolveReadback> {
    let value: unknown;
    try {
      value = await this.dependencies.provider.getRun(plan.requestId);
    } catch (error) {
      throw providerError(error, MCP_CALCULIX_RUN_GET_TOOL);
    }
    try {
      const run = parseRunLookup(value, plan, expected);
      // parseRunLookup already validated the published nine-resource order.
      // Re-parsing its normalized resources would mistake their internal
      // `role` field for a provider field and lose the exact sequence proof.
      const resources = run.artifacts;
      const body = {
        schemaVersion: READBACK_SCHEMA,
        phase: plan.phase,
        stepSha256: plan.inputArtifact.fingerprint.digest,
        stepBytes: plan.inputArtifact.byteCount,
        requestId: run.requestId,
        runId: run.runId,
        requestSha256: run.requestSha256,
        resources,
      };
      return {
        ...body,
        canonicalText: deterministicJson(body),
        fingerprint: await sha256Fingerprint(body),
      };
    } catch (error) {
      throw providerError(error, MCP_CALCULIX_RUN_GET_TOOL);
    }
  }

  async reopenReadback(text: string): Promise<SensitivityRecordedSolveReadback> {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new TypeError("Recorded CalculiX readback is not valid JSON.");
    }
    const root = exactRecord(value, [
      "schemaVersion",
      "phase",
      "stepSha256",
      "stepBytes",
      "requestId",
      "runId",
      "requestSha256",
      "resources",
    ], "$calculixSensitivityReadback");
    literalValue(
      root.schemaVersion,
      READBACK_SCHEMA,
      "$calculixSensitivityReadback.schemaVersion",
    );
    const parsedPhase = parsePhase(root.phase, "$calculixSensitivityReadback.phase");
    const stepSha256 = sha256(
      root.stepSha256,
      "$calculixSensitivityReadback.stepSha256",
    );
    const stepBytes = positiveInteger(
      root.stepBytes,
      "$calculixSensitivityReadback.stepBytes",
    );
    const parsedRequestId = parseRequestId(
      root.requestId,
      "$calculixSensitivityReadback.requestId",
    );
    const parsedRunId = parseRunId(root.runId, "$calculixSensitivityReadback.runId");
    const requestSha256 = sha256(
      root.requestSha256,
      "$calculixSensitivityReadback.requestSha256",
    );
    const resources = parseRecordedResources(parsedRunId, root.resources);
    const body = {
      schemaVersion: READBACK_SCHEMA,
      phase: parsedPhase,
      stepSha256,
      stepBytes,
      requestId: parsedRequestId,
      runId: parsedRunId,
      requestSha256,
      resources,
    };
    if (text !== deterministicJson(body)) {
      throw new TypeError("Recorded CalculiX readback is not canonical.");
    }
    return {
      ...body,
      canonicalText: text,
      fingerprint: await sha256Fingerprint(body),
    };
  }

  async capture(
    readback: SensitivityRecordedSolveReadback,
    method: SensitivityStaticStructuralMethod,
  ): Promise<SensitivityRecordedSolveCapture> {
    // Generic provider capture sorts roles for its own canonical ledger. Keep
    // the provider's published sequence proof first, before that sorting can
    // erase ordering information.
    let listed: unknown;
    try {
      listed = await this.dependencies.provider.listResources();
    } catch (error) {
      throw unknown(
        `CalculiX resources/list failed after recorded run ${readback.runId}: ${
          message(error)
        }`,
      );
    }
    validateListedResourceBijection(listed, readback);
    let captured: ProviderResourceCaptureResult<
      "calculix-sensitivity-provider-manifest"
    >;
    try {
      captured = await this.dependencies.capture.capture({
        provider: { id: "mcp-calculix", runId: readback.runId },
        resources: readback.resources,
      });
    } catch (error) {
      throw unknown(
        `CalculiX recorded resources could not be captured into CAS: ${message(error)}`,
      );
    }
    const resultResource = readback.resources.at(-1)!;
    const stored = await this.dependencies.artifacts.read({
      algorithm: "sha256",
      digest: resultResource.sha256,
    });
    if (!stored) {
      throw unknown("CalculiX result.json disappeared after verified CAS capture.");
    }
    const bytes = stored.copy();
    if (
      bytes.byteLength !== resultResource.byteCount ||
      await fingerprintResourceBytes(bytes) !== resultResource.sha256
    ) {
      throw unknown("CalculiX result.json CAS bytes diverge from the provider ledger.");
    }
    let result: StaticStructuralSolveResult;
    try {
      result = parseRecordedResult(bytes, readback, method);
    } catch (error) {
      throw providerError(error, "result.json");
    }
    const providerCapture = {
      manifestFingerprint: captured.storedManifest.fingerprint,
      manifestUri: captured.storedManifest.uri,
      artifactSequenceFingerprint: await sha256Fingerprint(readback.resources),
    };
    const body = {
      schemaVersion: CAPTURE_SCHEMA,
      readback: JSON.parse(readback.canonicalText),
      providerCapture,
      result,
    };
    return {
      result,
      readback,
      providerCapture,
      canonicalText: deterministicJson(body),
      fingerprint: await sha256Fingerprint(body),
    };
  }

  async reopenCapture(text: string): Promise<SensitivityRecordedSolveCapture> {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      throw new TypeError("Recorded CalculiX capture is not valid JSON.");
    }
    const root = exactRecord(value, [
      "schemaVersion",
      "readback",
      "providerCapture",
      "result",
    ], "$calculixSensitivityCapture");
    literalValue(
      root.schemaVersion,
      CAPTURE_SCHEMA,
      "$calculixSensitivityCapture.schemaVersion",
    );
    const readback = await this.reopenReadback(deterministicJson(root.readback));
    const providerCapture = parseProviderCapture(root.providerCapture);
    const result = parseStaticStructuralResult(root.result, readback, undefined);
    const body = {
      schemaVersion: CAPTURE_SCHEMA,
      readback: JSON.parse(readback.canonicalText),
      providerCapture,
      result,
    };
    if (text !== deterministicJson(body)) {
      throw new TypeError("Recorded CalculiX capture is not canonical.");
    }
    return {
      result,
      readback,
      providerCapture,
      canonicalText: text,
      fingerprint: await sha256Fingerprint(body),
    };
  }
}

/** Only production constructor: all wire/runtime details stay server-owned. */
export function createFixedMcpCalculixSensitivitySolver(): McpCalculixSensitivitySolver {
  const endpoint = MCP_CALCULIX_SENSITIVITY_ENDPOINT;
  const provider = new HttpRecordedCalculixSensitivityProvider(
    new StatelessMcpHttpTransport({ mcpUrl: endpoint, timeoutMs: 180_000 }),
  );
  const artifacts = new FileByteStore({
    kind: "calculix-sensitivity-provider-artifact",
    directory: "state/local/calculix-sensitivity-provider-artifacts",
    uriNamespace: "calculix-sensitivity-provider-artifact",
    label: "CalculiX sensitivity provider artifact",
  });
  return new McpCalculixSensitivitySolver({
    provider,
    capture: new ProviderResourceCaptureService({
      reader: new HttpMcpResourceReader({ mcpUrl: endpoint, timeoutMs: 180_000 }),
      artifactStore: artifacts,
      ledgerStore: new FileByteStore({
        kind: "calculix-sensitivity-provider-ledger",
        directory: "state/local/calculix-sensitivity-provider-ledgers",
        uriNamespace: "calculix-sensitivity-provider-ledger",
        label: "CalculiX sensitivity provider ledger",
      }),
      manifestStore: new FileByteStore({
        kind: "calculix-sensitivity-provider-manifest",
        directory: "state/local/calculix-sensitivity-provider-manifests",
        uriNamespace: "calculix-sensitivity-provider-manifest",
        label: "CalculiX sensitivity provider manifest",
      }),
    }),
    artifacts,
  });
}

/** Stable code-derived request id: sha256(projectId,runId,phase,planDigest,stepSha256). */
export async function sensitivityRecordedRequestId(input: {
  readonly projectId: string;
  readonly runId: string;
  readonly phase: "base" | "stepped";
  readonly planDigest: string;
  readonly stepSha256: string;
}): Promise<string> {
  return (await sha256Fingerprint([
    safeId(input.projectId, "$sensitivityRequest.projectId"),
    safeId(input.runId, "$sensitivityRequest.runId"),
    parsePhase(input.phase, "$sensitivityRequest.phase"),
    sha256(input.planDigest, "$sensitivityRequest.planDigest"),
    sha256(input.stepSha256, "$sensitivityRequest.stepSha256"),
  ])).digest;
}

class HttpRecordedCalculixSensitivityProvider
  implements RecordedCalculixSensitivityProvider {
  constructor(private readonly http: StatelessMcpHttpTransport) {}

  async callRecorded(request: Readonly<Record<string, JsonValue>>): Promise<unknown> {
    return await this.#tool(MCP_CALCULIX_RECORDED_STATIC_TOOL, request);
  }

  async getRun(requestValue: string): Promise<unknown> {
    return await this.#tool(MCP_CALCULIX_RUN_GET_TOOL, { request_id: requestValue });
  }

  async listResources(): Promise<unknown> {
    try {
      return await this.http.request({
        method: "resources/list",
        label: "resources/list",
        params: {},
      });
    } catch (error) {
      throw providerError(error, "resources/list");
    }
  }

  async #tool(
    name: string,
    argumentsValue: Readonly<Record<string, JsonValue>>,
  ): Promise<unknown> {
    let result: Record<string, unknown>;
    try {
      result = await this.http.request({
        method: "tools/call",
        label: name,
        name,
        params: { name, arguments: argumentsValue },
      });
    } catch (error) {
      throw providerError(error, name);
    }
    if (result.resultType !== "complete") {
      throw unknown(`${name}: expected a complete MCP result.`);
    }
    if (result.isError === true) {
      throw new SensitivityRecordedSolveRejectedError(
        `${name}: ${toolText(result) || "provider rejected the request"}`,
      );
    }
    if (isRecord(result.structuredContent)) {
      return structuredClone(result.structuredContent);
    }
    const text = firstText(result);
    if (text !== undefined) {
      try {
        const parsed = JSON.parse(text);
        if (isRecord(parsed)) return parsed;
      } catch {
        // The exact contract failure follows below.
      }
    }
    throw unknown(`${name}: provider returned no structured recorded-run object.`);
  }
}

function providerError(error: unknown, operation: string): Error {
  if (
    error instanceof SensitivityRecordedSolveRejectedError ||
    error instanceof SensitivityRecordedSolveOutcomeUnknownError
  ) return error;
  if (error instanceof StatelessMcpTransportError) {
    if (error.kind === "http-rejection" || error.kind === "rpc-rejection") {
      return new SensitivityRecordedSolveRejectedError(error.message);
    }
    return unknown(error.message);
  }
  return unknown(`${operation}: ${message(error)}`);
}

function parseRunLookup(
  value: unknown,
  plan: SensitivityRecordedSolvePlan,
  expected?: SensitivityRecordedDispatch,
): ParsedCompletedRun {
  const root = record(value, "$calculixRunGet");
  if (root.schemaVersion !== "1.0") {
    throw unknown("calculix_run_get returned an unsupported schema version.");
  }
  if (root.status === "completed") {
    const completed = exactRecord(root, [
      "schemaVersion",
      "status",
      "lookup",
      "requestId",
      "runId",
      "run",
    ], "$calculixRunGet");
    parseRequestLookup(completed.lookup, plan.requestId, "$calculixRunGet.lookup");
    const run = parseCompletedRun(completed.run, "$calculixRunGet.run");
    if (
      parseRequestId(completed.requestId, "$calculixRunGet.requestId") !==
        run.requestId ||
      parseRunId(completed.runId, "$calculixRunGet.runId") !== run.runId
    ) {
      throw unknown("calculix_run_get envelope disagrees with its recorded run.");
    }
    assertRunMatchesPlan(run, plan);
    if (
      expected && (expected.requestId !== run.requestId ||
        expected.runId !== run.runId ||
        expected.requestSha256 !== run.requestSha256)
    ) {
      throw unknown("calculix_run_get changed the acknowledged recorded-run identity.");
    }
    return run;
  }
  if (root.status === "quarantined" || root.status === "evicted") {
    const terminal = exactRecord(root, [
      "schemaVersion",
      "status",
      "lookup",
      "requestId",
      "runId",
      "reason",
    ], "$calculixRunGet");
    parseRequestLookup(terminal.lookup, plan.requestId, "$calculixRunGet.lookup");
    if (
      parseRequestId(terminal.requestId, "$calculixRunGet.requestId") !== plan.requestId
    ) {
      throw unknown("calculix_run_get terminal state names another request id.");
    }
    throw new SensitivityRecordedSolveRejectedError(
      `Recorded CalculiX request ${plan.requestId} is ${root.status}: ${
        terminal.reason === null
          ? "no provider reason"
          : nonEmptyText(terminal.reason, "$calculixRunGet.reason")
      }`,
    );
  }
  if (
    root.status === "dispatched" || root.status === "not_found" ||
    root.status === "outcome_unknown"
  ) {
    throw unknown(
      `Recorded CalculiX request ${plan.requestId} remains ${root.status}; no redispatch is permitted.`,
    );
  }
  throw unknown("calculix_run_get returned an unknown status.");
}

interface ParsedCompletedRun extends SensitivityRecordedDispatch {
  readonly artifacts: readonly SensitivityRecordedProviderResource[];
}

function parseCompletedRun(value: unknown, path: string): ParsedCompletedRun {
  const root = exactRecord(value, [
    "schemaVersion",
    "state",
    "runId",
    "requestId",
    "requestSha256",
    "inputArtifact",
    "createdAt",
    "artifacts",
  ], path);
  literalValue(root.schemaVersion, "2.0", `${path}.schemaVersion`);
  literalValue(root.state, "completed", `${path}.state`);
  const parsedRunId = parseRunId(root.runId, `${path}.runId`);
  const artifacts = parseRecordedResources(parsedRunId, root.artifacts);
  const input = exactRecord(
    root.inputArtifact,
    ["uri", "mimeType", "sha256", "bytes"],
    `${path}.inputArtifact`,
  );
  const first = artifacts[0]!;
  if (
    input.uri !== first.uri || input.mimeType !== first.mediaType ||
    sha256(input.sha256, `${path}.inputArtifact.sha256`) !== first.sha256 ||
    positiveInteger(input.bytes, `${path}.inputArtifact.bytes`) !== first.byteCount
  ) {
    throw unknown("Recorded CalculiX inputArtifact does not match input.step.");
  }
  return {
    requestId: parseRequestId(root.requestId, `${path}.requestId`),
    runId: parsedRunId,
    requestSha256: sha256(root.requestSha256, `${path}.requestSha256`),
    artifacts,
  };
}

function assertRunMatchesPlan(
  run: ParsedCompletedRun,
  plan: SensitivityRecordedSolvePlan,
): void {
  if (run.requestId !== plan.requestId) {
    throw unknown("Recorded CalculiX run does not match the stable request id.");
  }
  const input = run.artifacts[0]!;
  if (
    input.sha256 !== plan.inputArtifact.fingerprint.digest ||
    input.byteCount !== plan.inputArtifact.byteCount
  ) {
    throw unknown("Recorded CalculiX run input does not match staged STEP identity.");
  }
}

function parseRecordedResources(
  recordedRunId: string,
  value: unknown,
): readonly SensitivityRecordedProviderResource[] {
  if (
    !Array.isArray(value) || value.length !== CALCULIX_RECORDED_RESOURCE_ORDER.length
  ) {
    throw unknown("Recorded CalculiX run must declare exactly nine ordered resources.");
  }
  return value.map((entry, index) => {
    const role = CALCULIX_RECORDED_RESOURCE_ORDER[index]!;
    const root = exactRecord(
      entry,
      ["name", "uri", "mimeType", "bytes", "sha256"],
      `$calculixRun.artifacts[${index}]`,
    );
    literalValue(root.name, role, `$calculixRun.artifacts[${index}].name`);
    const uri = nonEmptyText(root.uri, `$calculixRun.artifacts[${index}].uri`);
    if (uri !== `casys://calculix/runs/${recordedRunId}/${role}`) {
      throw unknown(`Recorded CalculiX resource ${role} has a noncanonical URI.`);
    }
    const mediaType = nonEmptyText(
      root.mimeType,
      `$calculixRun.artifacts[${index}].mimeType`,
    );
    if (mediaType !== RESOURCE_MEDIA_TYPES[role]) {
      throw unknown(`Recorded CalculiX resource ${role} has an unexpected media type.`);
    }
    const byteCount = role === "input.step"
      ? positiveInteger(root.bytes, `$calculixRun.artifacts[${index}].bytes`)
      : nonNegativeInteger(root.bytes, `$calculixRun.artifacts[${index}].bytes`);
    return {
      role,
      uri,
      mediaType,
      byteCount,
      sha256: sha256(root.sha256, `$calculixRun.artifacts[${index}].sha256`),
    };
  });
}

function validateListedResourceBijection(
  value: unknown,
  readback: SensitivityRecordedSolveReadback,
): void {
  const root = record(value, "$calculixResourcesList");
  if (!Array.isArray(root.resources)) {
    throw unknown("resources/list did not return a resources array.");
  }
  const prefix = `casys://calculix/runs/${readback.runId}/`;
  const selected = root.resources.filter((candidate) =>
    isRecord(candidate) &&
    typeof candidate.uri === "string" && candidate.uri.startsWith(prefix)
  );
  if (selected.length !== readback.resources.length) {
    throw unknown("resources/list does not expose exactly the recorded run resources.");
  }
  for (const [index, expected] of readback.resources.entries()) {
    const actual = record(
      selected[index],
      `$calculixResourcesList.resources[${index}]`,
    );
    if (
      actual.uri !== expected.uri || actual.mimeType !== expected.mediaType ||
      actual.size !== expected.byteCount
    ) {
      throw unknown(
        `resources/list reordered or changed recorded CalculiX resource ${expected.role}.`,
      );
    }
  }
}

function parseRecordedResult(
  bytes: Uint8Array,
  readback: SensitivityRecordedSolveReadback,
  method: SensitivityStaticStructuralMethod,
): StaticStructuralSolveResult {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw unknown("Captured CalculiX result.json is not valid UTF-8 JSON.");
  }
  return parseStaticStructuralResult(value, readback, method);
}

function parseStaticStructuralResult(
  value: unknown,
  readback: SensitivityRecordedSolveReadback,
  method: SensitivityStaticStructuralMethod | undefined,
): StaticStructuralSolveResult {
  const root = exactRecord(value, [
    "schemaVersion",
    "kind",
    "inputArtifact",
    "mesh",
    "constraints",
    "metrics",
  ], "$calculixRecordedResult");
  literalValue(root.schemaVersion, "2.0", "$calculixRecordedResult.schemaVersion");
  literalValue(root.kind, "static-solve-recorded", "$calculixRecordedResult.kind");
  const input = exactRecord(
    root.inputArtifact,
    ["uri", "mimeType", "sha256", "bytes"],
    "$calculixRecordedResult.inputArtifact",
  );
  const expectedInput = readback.resources[0]!;
  if (
    input.uri !== expectedInput.uri || input.mimeType !== "model/step" ||
    sha256(input.sha256, "$calculixRecordedResult.inputArtifact.sha256") !==
      readback.stepSha256 ||
    positiveInteger(input.bytes, "$calculixRecordedResult.inputArtifact.bytes") !==
      readback.stepBytes
  ) {
    throw unknown("Captured CalculiX result input differs from the recorded STEP.");
  }
  const constraints = exactRecord(
    root.constraints,
    ["fixedSelections", "loads"],
    "$calculixRecordedResult.constraints",
  );
  if (
    !Array.isArray(constraints.fixedSelections) || !Array.isArray(constraints.loads)
  ) {
    throw unknown("Captured CalculiX result constraints are malformed.");
  }
  if (method) {
    const fixed = method.supports.map((support) => support.selection.name);
    const loads = method.loads.map((load) => ({
      selection: load.selection.name,
      forceN: load.force.value,
    }));
    if (
      deterministicJson(constraints.fixedSelections) !== deterministicJson(fixed) ||
      deterministicJson(constraints.loads) !== deterministicJson(loads)
    ) {
      throw unknown("Captured CalculiX constraints differ from the sealed method.");
    }
  }
  const supports: readonly StaticStructuralSupport[] = method
    ? method.supports.map((support) => ({ selectionId: support.selection.name }))
    : constraints.fixedSelections.map((item, index) => ({
      selectionId: safeId(
        item,
        `$calculixRecordedResult.constraints.fixedSelections[${index}]`,
      ),
    }));
  const loads: readonly StaticStructuralLoad[] = method
    ? method.loads.map((load) => ({
      selectionId: load.selection.name,
      force: { value: load.force.value, unit: "N" },
    }))
    : parseLoads(constraints.loads);
  const mesh = exactRecord(
    root.mesh,
    ["nodes", "elements", "nodesPerSelection"],
    "$calculixRecordedResult.mesh",
  );
  const metrics = exactRecord(
    root.metrics,
    ["maxDisplacement", "maxVonMises"],
    "$calculixRecordedResult.metrics",
  );
  const displacement = exactRecord(metrics.maxDisplacement, [
    "value",
    "unit",
    "nodeId",
    "vectorMm",
  ], "$calculixRecordedResult.metrics.maxDisplacement");
  literalValue(
    displacement.unit,
    "mm",
    "$calculixRecordedResult.metrics.maxDisplacement.unit",
  );
  const stress = exactRecord(
    metrics.maxVonMises,
    ["value", "unit", "elementId"],
    "$calculixRecordedResult.metrics.maxVonMises",
  );
  literalValue(stress.unit, "MPa", "$calculixRecordedResult.metrics.maxVonMises.unit");
  return {
    inputAttestation: {
      fingerprint: { algorithm: "sha256", digest: readback.stepSha256 },
      byteCount: readback.stepBytes,
    },
    boundaryConditions: { supports, loads },
    mesh: {
      nodeCount: positiveInteger(mesh.nodes, "$calculixRecordedResult.mesh.nodes"),
      elementCount: positiveInteger(
        mesh.elements,
        "$calculixRecordedResult.mesh.elements",
      ),
    },
    observations: {
      maximumDisplacement: {
        magnitude: {
          value: nonNegativeFinite(
            displacement.value,
            "$calculixRecordedResult.metrics.maxDisplacement.value",
          ),
          unit: "mm",
        },
        vector: {
          value: vector3(
            displacement.vectorMm,
            "$calculixRecordedResult.metrics.maxDisplacement.vectorMm",
          ),
          unit: "mm",
        },
      },
      maximumVonMisesStress: {
        magnitude: {
          value: nonNegativeFinite(
            stress.value,
            "$calculixRecordedResult.metrics.maxVonMises.value",
          ),
          unit: "MPa",
        },
      },
    },
  };
}

function parseProviderCapture(
  value: unknown,
): SensitivityRecordedSolveCapture["providerCapture"] {
  const root = exactRecord(value, [
    "manifestFingerprint",
    "manifestUri",
    "artifactSequenceFingerprint",
  ], "$calculixSensitivityCapture.providerCapture");
  return {
    manifestFingerprint: fingerprint(
      root.manifestFingerprint,
      "$calculixSensitivityCapture.providerCapture.manifestFingerprint",
    ),
    manifestUri: nonEmptyText(
      root.manifestUri,
      "$calculixSensitivityCapture.providerCapture.manifestUri",
    ),
    artifactSequenceFingerprint: fingerprint(
      root.artifactSequenceFingerprint,
      "$calculixSensitivityCapture.providerCapture.artifactSequenceFingerprint",
    ),
  };
}

function parseLoads(value: readonly unknown[]): readonly StaticStructuralLoad[] {
  return value.map((item, index) => {
    const root = exactRecord(
      item,
      ["selection", "forceN"],
      `$calculixRecordedResult.constraints.loads[${index}]`,
    );
    return {
      selectionId: safeId(
        root.selection,
        `$calculixRecordedResult.constraints.loads[${index}].selection`,
      ),
      force: {
        value: vector3(
          root.forceN,
          `$calculixRecordedResult.constraints.loads[${index}].forceN`,
        ),
        unit: "N",
      },
    };
  });
}

function parseRequestLookup(value: unknown, expected: string, path: string): void {
  const root = exactRecord(value, ["kind", "value"], path);
  literalValue(root.kind, "request_id", `${path}.kind`);
  if (parseRequestId(root.value, `${path}.value`) !== expected) {
    throw unknown("calculix_run_get lookup does not match the stable request id.");
  }
}

function requireStagedLocation(location: string, digest: string): string {
  const expectedFilename = `fea-${digest}.step`;
  const segments = location.split("/");
  if (
    !location.startsWith("/") || segments.length < 3 ||
    segments.at(-1) !== expectedFilename ||
    segments.slice(1).some((segment) =>
      segment === "" || segment === "." ||
      segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    throw new TypeError(
      "Sensitivity staged STEP location is not the code-owned fea-<digest>.step path.",
    );
  }
  return location;
}

function parsePhase(value: unknown, path: string): "base" | "stepped" {
  if (value === "base" || value === "stepped") return value;
  throw new TypeError(`${path} must be base or stepped.`);
}

function parseRequestId(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(parsed)) {
    throw new TypeError(`${path} is not a valid recorded request id.`);
  }
  return parsed;
}

function parseRunId(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  if (!RUN_ID.test(parsed)) {
    throw new TypeError(`${path} is not a recorded CalculiX run id.`);
  }
  return parsed;
}

function sha256(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  if (!SHA256_HEX.test(parsed)) {
    throw new TypeError(`${path} must be a lowercase sha256 digest.`);
  }
  return parsed;
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: sha256(root.digest, `${path}.digest`) };
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function nonNegativeFinite(value: unknown, path: string): number {
  const parsed = finite(value, path);
  if (parsed < 0) throw new TypeError(`${path} must be non-negative.`);
  return parsed;
}

function vector3(value: unknown, path: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be a finite vector of length three.`);
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolText(result: Record<string, unknown>): string {
  return Array.isArray(result.content)
    ? result.content.flatMap((item) =>
      isRecord(item) && item.type === "text" && typeof item.text === "string"
        ? [item.text]
        : []
    ).join(" ")
    : "";
}

function firstText(result: Record<string, unknown>): string | undefined {
  const first = Array.isArray(result.content) ? result.content[0] : undefined;
  return isRecord(first) && first.type === "text" && typeof first.text === "string"
    ? first.text
    : undefined;
}

function unknown(detail: string): SensitivityRecordedSolveOutcomeUnknownError {
  return new SensitivityRecordedSolveOutcomeUnknownError(detail);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
