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
const RECORDED_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,127}$/;
const RECORDED_ELEMENT_ORDER = 2 as const;
const RECORDED_TIMEOUT_MS = 120_000 as const;
const RECORDED_REQUEST_FIELDS = [
  "execution_identity",
  "element_order",
  "expected_step_sha256",
  "fixed",
  "loads",
  "material",
  "mesh_size_mm",
  "request_id",
  "selections",
  "step_path",
  "timeout_ms",
] as const;

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
    const exactRequest = lowerRecordedStaticRequest({
      requestId,
      stepSha256,
      stagedPath,
      method: input.method,
    });
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
    const resources = parseReadbackResources(parsedRunId, root.resources);
    const input = resources[0]!;
    const request = resources[1]!;
    if (
      input.sha256 !== stepSha256 || input.byteCount !== stepBytes ||
      request.role !== "request.json" || request.sha256 !== requestSha256
    ) {
      throw new TypeError(
        "Recorded CalculiX readback resource identities do not match its STEP or request ledger fields.",
      );
    }
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
    const requestBytes = await this.#readCapturedResource(readback, "request.json");
    let requestBinding:
      SensitivityRecordedSolveCapture["providerCapture"]["requestBinding"];
    try {
      requestBinding = await verifyCapturedRecordedRequest({
        bytes: requestBytes,
        readback,
        method,
      });
    } catch (error) {
      throw providerError(error, "request.json");
    }
    const bytes = await this.#readCapturedResource(readback, "result.json");
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
      requestBinding,
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
    const result = parseCapturedStaticStructuralResult(root.result, readback);
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

  async #readCapturedResource(
    readback: SensitivityRecordedSolveReadback,
    role: (typeof CALCULIX_RECORDED_RESOURCE_ORDER)[number],
  ): Promise<Uint8Array> {
    const resource = readback.resources.find((candidate) => candidate.role === role);
    if (!resource) {
      throw unknown(`Recorded CalculiX readback lacks ${role}.`);
    }
    const stored = await this.dependencies.artifacts.read({
      algorithm: "sha256",
      digest: resource.sha256,
    });
    if (!stored) {
      throw unknown(`CalculiX ${role} disappeared after verified CAS capture.`);
    }
    const bytes = stored.copy();
    if (
      bytes.byteLength !== resource.byteCount ||
      await fingerprintResourceBytes(bytes) !== resource.sha256
    ) {
      throw unknown(`CalculiX ${role} CAS bytes diverge from the provider ledger.`);
    }
    return bytes;
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
  const requestSha256 = sha256(root.requestSha256, `${path}.requestSha256`);
  const request = artifacts[1]!;
  if (request.role !== "request.json" || request.sha256 !== requestSha256) {
    throw unknown(
      "Recorded CalculiX requestSha256 does not match the request.json artifact ledger tuple.",
    );
  }
  return {
    requestId: parseRequestId(root.requestId, `${path}.requestId`),
    runId: parsedRunId,
    requestSha256,
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

/** Parse the normalized provider ledger persisted in this adapter's WAL. */
function parseReadbackResources(
  recordedRunId: string,
  value: unknown,
): readonly SensitivityRecordedProviderResource[] {
  if (
    !Array.isArray(value) || value.length !== CALCULIX_RECORDED_RESOURCE_ORDER.length
  ) {
    throw new TypeError(
      "Recorded CalculiX readback must contain exactly nine ordered resources.",
    );
  }
  return value.map((entry, index) => {
    const role = CALCULIX_RECORDED_RESOURCE_ORDER[index]!;
    const root = exactRecord(
      entry,
      ["role", "uri", "mediaType", "byteCount", "sha256"],
      `$calculixSensitivityReadback.resources[${index}]`,
    );
    literalValue(
      root.role,
      role,
      `$calculixSensitivityReadback.resources[${index}].role`,
    );
    const uri = nonEmptyText(
      root.uri,
      `$calculixSensitivityReadback.resources[${index}].uri`,
    );
    if (uri !== `casys://calculix/runs/${recordedRunId}/${role}`) {
      throw new TypeError(`Recorded CalculiX resource ${role} has a noncanonical URI.`);
    }
    const mediaType = nonEmptyText(
      root.mediaType,
      `$calculixSensitivityReadback.resources[${index}].mediaType`,
    );
    if (mediaType !== RESOURCE_MEDIA_TYPES[role]) {
      throw new TypeError(
        `Recorded CalculiX resource ${role} has an unexpected media type.`,
      );
    }
    return {
      role,
      uri,
      mediaType,
      byteCount: role === "input.step"
        ? positiveInteger(
          root.byteCount,
          `$calculixSensitivityReadback.resources[${index}].byteCount`,
        )
        : nonNegativeInteger(
          root.byteCount,
          `$calculixSensitivityReadback.resources[${index}].byteCount`,
        ),
      sha256: sha256(
        root.sha256,
        `$calculixSensitivityReadback.resources[${index}].sha256`,
      ),
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

/**
 * The provider seals execution identity only after its durable request claim.
 * We therefore bind it after independent CAS capture, while re-lowering every
 * server-owned physical input from the sealed sensitivity method. Provider
 * completion remains an observation source, never a qualification or verdict.
 */
async function verifyCapturedRecordedRequest(input: {
  readonly bytes: Uint8Array;
  readonly readback: SensitivityRecordedSolveReadback;
  readonly method: SensitivityStaticStructuralMethod;
}): Promise<SensitivityRecordedSolveCapture["providerCapture"]["requestBinding"]> {
  const requestResource = input.readback.resources.find((resource) =>
    resource.role === "request.json"
  );
  if (!requestResource) {
    throw unknown("Recorded CalculiX readback lacks request.json.");
  }
  if (requestResource.sha256 !== input.readback.requestSha256) {
    throw unknown(
      "Recorded CalculiX request.json resource digest does not match ledger requestSha256.",
    );
  }
  if (await fingerprintResourceBytes(input.bytes) !== input.readback.requestSha256) {
    throw unknown(
      "Captured CalculiX request.json bytes do not match ledger requestSha256.",
    );
  }
  const request = parseCapturedRecordedRequest(input.bytes);
  const expected = lowerRecordedStaticRequest({
    requestId: input.readback.requestId,
    stepSha256: input.readback.stepSha256,
    stagedPath: exactStagedPath(input.readback.stepSha256),
    method: input.method,
  });
  const actualLowered = Object.fromEntries(
    Object.entries(expected).map(([key]) => [key, request[key]!]),
  ) as Readonly<Record<string, JsonValue>>;
  if (deterministicJson(actualLowered) !== deterministicJson(expected)) {
    throw unknown(
      "Captured CalculiX request.json differs from the server-lowered request.",
    );
  }
  const executionIdentity = parseRecordedExecutionIdentity(
    request.execution_identity,
  );
  const expectedBytes = new TextEncoder().encode(
    `${deterministicJson({ ...expected, execution_identity: executionIdentity })}\n`,
  );
  if (!sameBytes(input.bytes, expectedBytes)) {
    throw unknown(
      "Captured CalculiX request.json is not the canonical sealed effective request.",
    );
  }
  return {
    requestResourceFingerprint: {
      algorithm: "sha256",
      digest: input.readback.requestSha256,
    },
    loweredRequestFingerprint: await sha256Fingerprint(expected),
    executionIdentityFingerprint: await sha256Fingerprint(executionIdentity),
  };
}

function parseCapturedRecordedRequest(
  bytes: Uint8Array,
): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw unknown("Captured CalculiX request.json is not valid UTF-8 JSON.");
  }
  return exactRecord(value, RECORDED_REQUEST_FIELDS, "$calculixCapturedRequest");
}

function parseRecordedExecutionIdentity(
  value: unknown,
): Readonly<Record<string, JsonValue>> {
  const identity = exactRecord(value, [
    "schema_version",
    "server",
    "method",
    "lowering",
    "engines",
    "image",
  ], "$calculixCapturedRequest.execution_identity");
  literalValue(
    identity.schema_version,
    "1.0",
    "$calculixCapturedRequest.execution_identity.schema_version",
  );
  const server = exactRecord(
    identity.server,
    ["package", "version"],
    "$calculixCapturedRequest.execution_identity.server",
  );
  literalValue(
    server.package,
    "@casys/mcp-calculix",
    "$calculixCapturedRequest.execution_identity.server.package",
  );
  literalValue(
    server.version,
    "0.8.2",
    "$calculixCapturedRequest.execution_identity.server.version",
  );
  const method = exactRecord(
    identity.method,
    ["id", "version"],
    "$calculixCapturedRequest.execution_identity.method",
  );
  literalValue(
    method.id,
    MCP_CALCULIX_RECORDED_STATIC_TOOL,
    "$calculixCapturedRequest.execution_identity.method.id",
  );
  literalValue(
    method.version,
    "1.0",
    "$calculixCapturedRequest.execution_identity.method.version",
  );
  const lowering = exactRecord(
    identity.lowering,
    ["id", "version"],
    "$calculixCapturedRequest.execution_identity.lowering",
  );
  literalValue(
    lowering.id,
    "calculix.static.abaqus-deck",
    "$calculixCapturedRequest.execution_identity.lowering.id",
  );
  literalValue(
    lowering.version,
    "1.0",
    "$calculixCapturedRequest.execution_identity.lowering.version",
  );
  const engines = exactRecord(
    identity.engines,
    ["gmsh", "ccx"],
    "$calculixCapturedRequest.execution_identity.engines",
  );
  const gmsh = parseRecordedEngineIdentity(
    engines.gmsh,
    "gmsh",
    "$calculixCapturedRequest.execution_identity.engines.gmsh",
  );
  const ccx = parseRecordedEngineIdentity(
    engines.ccx,
    "ccx",
    "$calculixCapturedRequest.execution_identity.engines.ccx",
  );
  const image = exactRecord(
    identity.image,
    ["status"],
    "$calculixCapturedRequest.execution_identity.image",
  );
  literalValue(
    image.status,
    "unattested",
    "$calculixCapturedRequest.execution_identity.image.status",
  );
  return {
    schema_version: "1.0",
    server: { package: "@casys/mcp-calculix", version: "0.8.2" },
    method: { id: MCP_CALCULIX_RECORDED_STATIC_TOOL, version: "1.0" },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    engines: { gmsh, ccx },
    image: { status: "unattested" },
  };
}

function parseRecordedEngineIdentity(
  value: unknown,
  command: "gmsh" | "ccx",
  path: string,
): { readonly command: "gmsh" | "ccx"; readonly version: string } {
  const engine = exactRecord(value, ["command", "version"], path);
  literalValue(engine.command, command, `${path}.command`);
  const version = nonEmptyText(engine.version, `${path}.version`);
  if (!RECORDED_VERSION.test(version)) {
    throw new TypeError(`${path}.version is not a published recorded version token.`);
  }
  return { command, version };
}

function lowerRecordedStaticRequest(input: {
  readonly requestId: string;
  readonly stepSha256: string;
  readonly stagedPath: string;
  readonly method: SensitivityStaticStructuralMethod;
}): Readonly<Record<string, JsonValue>> {
  return {
    request_id: input.requestId,
    step_path: input.stagedPath,
    expected_step_sha256: input.stepSha256,
    mesh_size_mm: input.method.mesh.targetSizeMm,
    element_order: RECORDED_ELEMENT_ORDER,
    material: {
      e_mpa: input.method.material.eMpa,
      nu: input.method.material.nu,
    },
    selections: [
      ...input.method.supports.map((support) => ({
        name: support.selection.name,
        box: { min: support.selection.box.min, max: support.selection.box.max },
      })),
      ...input.method.loads.map((load) => ({
        name: load.selection.name,
        box: { min: load.selection.box.min, max: load.selection.box.max },
      })),
    ],
    fixed: input.method.supports.map((support) => support.selection.name),
    loads: input.method.loads.map((load) => ({
      selection: load.selection.name,
      force_n: load.force.value,
    })),
    timeout_ms: RECORDED_TIMEOUT_MS,
  };
}

function exactStagedPath(digest: string): string {
  return `/inputs/fea-${digest}.step`;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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

/** Reopen the normalized result that this adapter, not the provider, persisted. */
function parseCapturedStaticStructuralResult(
  value: unknown,
  readback: SensitivityRecordedSolveReadback,
): StaticStructuralSolveResult {
  const root = exactRecord(value, [
    "inputAttestation",
    "boundaryConditions",
    "mesh",
    "observations",
  ], "$calculixSensitivityCapture.result");
  const input = exactRecord(
    root.inputAttestation,
    ["fingerprint", "byteCount"],
    "$calculixSensitivityCapture.result.inputAttestation",
  );
  const inputFingerprint = fingerprint(
    input.fingerprint,
    "$calculixSensitivityCapture.result.inputAttestation.fingerprint",
  );
  const inputByteCount = positiveInteger(
    input.byteCount,
    "$calculixSensitivityCapture.result.inputAttestation.byteCount",
  );
  if (
    inputFingerprint.digest !== readback.stepSha256 ||
    inputByteCount !== readback.stepBytes
  ) {
    throw new TypeError(
      "Recorded CalculiX captured result input differs from its readback STEP identity.",
    );
  }
  const boundaryConditions = exactRecord(
    root.boundaryConditions,
    ["supports", "loads"],
    "$calculixSensitivityCapture.result.boundaryConditions",
  );
  if (
    !Array.isArray(boundaryConditions.supports) ||
    !Array.isArray(boundaryConditions.loads)
  ) {
    throw new TypeError(
      "Recorded CalculiX captured result boundary conditions must be arrays.",
    );
  }
  const supports: readonly StaticStructuralSupport[] = boundaryConditions.supports.map(
    (value, index) => {
      const support = exactRecord(
        value,
        ["selectionId"],
        `$calculixSensitivityCapture.result.boundaryConditions.supports[${index}]`,
      );
      return {
        selectionId: safeId(
          support.selectionId,
          `$calculixSensitivityCapture.result.boundaryConditions.supports[${index}].selectionId`,
        ),
      };
    },
  );
  const loads: readonly StaticStructuralLoad[] = boundaryConditions.loads.map(
    (value, index) => {
      const load = exactRecord(
        value,
        ["selectionId", "force"],
        `$calculixSensitivityCapture.result.boundaryConditions.loads[${index}]`,
      );
      const force = exactRecord(
        load.force,
        ["value", "unit"],
        `$calculixSensitivityCapture.result.boundaryConditions.loads[${index}].force`,
      );
      literalValue(
        force.unit,
        "N",
        `$calculixSensitivityCapture.result.boundaryConditions.loads[${index}].force.unit`,
      );
      return {
        selectionId: safeId(
          load.selectionId,
          `$calculixSensitivityCapture.result.boundaryConditions.loads[${index}].selectionId`,
        ),
        force: {
          value: vector3(
            force.value,
            `$calculixSensitivityCapture.result.boundaryConditions.loads[${index}].force.value`,
          ),
          unit: "N",
        },
      };
    },
  );
  const mesh = exactRecord(
    root.mesh,
    ["nodeCount", "elementCount"],
    "$calculixSensitivityCapture.result.mesh",
  );
  const observations = exactRecord(
    root.observations,
    ["maximumDisplacement", "maximumVonMisesStress"],
    "$calculixSensitivityCapture.result.observations",
  );
  const displacement = exactRecord(
    observations.maximumDisplacement,
    ["magnitude", "vector"],
    "$calculixSensitivityCapture.result.observations.maximumDisplacement",
  );
  const displacementMagnitude = exactRecord(
    displacement.magnitude,
    ["value", "unit"],
    "$calculixSensitivityCapture.result.observations.maximumDisplacement.magnitude",
  );
  literalValue(
    displacementMagnitude.unit,
    "mm",
    "$calculixSensitivityCapture.result.observations.maximumDisplacement.magnitude.unit",
  );
  const displacementVector = exactRecord(
    displacement.vector,
    ["value", "unit"],
    "$calculixSensitivityCapture.result.observations.maximumDisplacement.vector",
  );
  literalValue(
    displacementVector.unit,
    "mm",
    "$calculixSensitivityCapture.result.observations.maximumDisplacement.vector.unit",
  );
  const stress = exactRecord(
    observations.maximumVonMisesStress,
    ["magnitude"],
    "$calculixSensitivityCapture.result.observations.maximumVonMisesStress",
  );
  const stressMagnitude = exactRecord(
    stress.magnitude,
    ["value", "unit"],
    "$calculixSensitivityCapture.result.observations.maximumVonMisesStress.magnitude",
  );
  literalValue(
    stressMagnitude.unit,
    "MPa",
    "$calculixSensitivityCapture.result.observations.maximumVonMisesStress.magnitude.unit",
  );
  return {
    inputAttestation: {
      fingerprint: inputFingerprint,
      byteCount: inputByteCount,
    },
    boundaryConditions: { supports, loads },
    mesh: {
      nodeCount: positiveInteger(
        mesh.nodeCount,
        "$calculixSensitivityCapture.result.mesh.nodeCount",
      ),
      elementCount: positiveInteger(
        mesh.elementCount,
        "$calculixSensitivityCapture.result.mesh.elementCount",
      ),
    },
    observations: {
      maximumDisplacement: {
        magnitude: {
          value: nonNegativeFinite(
            displacementMagnitude.value,
            "$calculixSensitivityCapture.result.observations.maximumDisplacement.magnitude.value",
          ),
          unit: "mm",
        },
        vector: {
          value: vector3(
            displacementVector.value,
            "$calculixSensitivityCapture.result.observations.maximumDisplacement.vector.value",
          ),
          unit: "mm",
        },
      },
      maximumVonMisesStress: {
        magnitude: {
          value: nonNegativeFinite(
            stressMagnitude.value,
            "$calculixSensitivityCapture.result.observations.maximumVonMisesStress.magnitude.value",
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
    "requestBinding",
  ], "$calculixSensitivityCapture.providerCapture");
  const requestBinding = exactRecord(
    root.requestBinding,
    [
      "requestResourceFingerprint",
      "loweredRequestFingerprint",
      "executionIdentityFingerprint",
    ],
    "$calculixSensitivityCapture.providerCapture.requestBinding",
  );
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
    requestBinding: {
      requestResourceFingerprint: fingerprint(
        requestBinding.requestResourceFingerprint,
        "$calculixSensitivityCapture.providerCapture.requestBinding.requestResourceFingerprint",
      ),
      loweredRequestFingerprint: fingerprint(
        requestBinding.loweredRequestFingerprint,
        "$calculixSensitivityCapture.providerCapture.requestBinding.loweredRequestFingerprint",
      ),
      executionIdentityFingerprint: fingerprint(
        requestBinding.executionIdentityFingerprint,
        "$calculixSensitivityCapture.providerCapture.requestBinding.executionIdentityFingerprint",
      ),
    },
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
  const expected = exactStagedPath(digest);
  if (location !== expected) {
    throw new TypeError(
      `Sensitivity staged STEP location must equal the code-owned ${expected} path.`,
    );
  }
  return expected;
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
