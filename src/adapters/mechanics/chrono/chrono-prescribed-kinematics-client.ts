import type {
  PrescribedKinematicsBodyObservation,
  PrescribedKinematicsCaseSubmissionRequest,
  PrescribedKinematicsJointObservation,
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
  PrescribedKinematicsPreDispatchRejectionCode,
  PrescribedKinematicsReceipt,
  PrescribedKinematicsRunReadback,
  PrescribedKinematicsRunRequest,
  PrescribedKinematicsSample,
  PrescribedKinematicsSamplePage,
  PrescribedKinematicsSamplePageRequest,
  SubmittedPrescribedKinematicsCase,
} from "../../../application/ports/out/mechanics/prescribed-kinematics-observer.ts";
import type {
  CapabilityRuntimeSecretSnapshot,
} from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import { sha256Hex } from "../../../domain/kernel/deterministic-json.ts";
import { parseChronoPrescribedKinematicsReceipt } from "./chrono-prescribed-kinematics-receipt.ts";
import {
  type InternalMcpBearerCredential,
  StatelessMcpHttpTransport,
  StatelessMcpTransportError,
  type StatelessMcpTransportErrorKind,
} from "../../shared/mcp/stateless-mcp-http-transport.ts";

const CHRONO_CASE_SUBMIT = "chrono_case_submit";
const CHRONO_RUN = "chrono_run_prescribed_kinematics";
const CHRONO_RUN_GET = "chrono_run_get";
const CHRONO_RECEIPT_GET = "chrono_run_receipt_get";
// This adapter is a fixed, host-local binding.  Provider routing is never a
// caller input: a capability launch group exposes this one loopback endpoint.
const CHRONO_MCP_URL = "http://127.0.0.1:3025/mcp";
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const CHRONO_PROVIDER_ERROR_CODES = new Set([
  "case_invalid",
  "case_not_found",
  "case_sha256_mismatch",
  "case_uri_mismatch",
  "invalid_case_json",
  "invalid_request_id",
  "invalid_sample_offset",
  "invalid_sample_limit",
  "invalid_timeout",
  "persisted_ledger_invalid",
  "receipt_invalid",
  "receipt_not_found",
  "request_conflict",
  "run_uncertain",
  "runner_timeout",
  "store_corrupt",
  "worker_failed",
  "worker_invalid_output",
  "internal_error",
]);
const PRE_DISPATCH_RUN_REJECTIONS = new Set<
  PrescribedKinematicsPreDispatchRejectionCode
>([
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
const NOT_EVALUATED = [
  "collision",
  "clearance",
  "contact",
  "forces",
  "torques",
  "dynamics",
  "strength",
  "safety",
  "product fitness",
] as const;

export interface ChronoPrescribedKinematicsClientOptions {
  /** Closed host-only credential resolver; never an MCP/agent parameter. */
  readonly secretResolver: ChronoMcpBearerCredentialResolver;
  /** Same opaque generation used by the matching Compose launch overlay. */
  readonly secretSnapshot: CapabilityRuntimeSecretSnapshot;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Fixed Chrono binding credential seam.  The implementation owns the token
 * value in a private WeakMap; this adapter receives only an opaque snapshot.
 */
export interface ChronoMcpBearerCredentialResolver {
  bearerCredentialFor(
    snapshot: CapabilityRuntimeSecretSnapshot,
  ): InternalMcpBearerCredential;
}

export class ChronoPrescribedKinematicsProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChronoPrescribedKinematicsProtocolError";
  }
}

/** A provider returned an explicit structured error before this adapter retried. */
export class ChronoPrescribedKinematicsProviderError extends Error {
  readonly code: string;

  constructor(tool: string, code: string) {
    super(`${tool}: provider rejected the request with ${code}`);
    this.name = "ChronoPrescribedKinematicsProviderError";
    this.code = code;
  }
}

/**
 * The run request might have reached Chrono.  Callers must use readRun with
 * the same request identity; this adapter never retries dispatch itself.
 */
export class ChronoPrescribedKinematicsDispatchUncertainError extends Error {
  readonly requestId: string;
  readonly caseSha256: string;

  constructor(requestId: string, caseSha256: string) {
    super(
      `Chrono prescribed-kinematics dispatch is uncertain for request ${requestId}; read the same request identity instead of retrying.`,
    );
    this.name = "ChronoPrescribedKinematicsDispatchUncertainError";
    this.requestId = requestId;
    this.caseSha256 = caseSha256;
  }
}

/**
 * A request was rejected or its response violated the MCP transport contract.
 * `transport` and `protocol-invalid` mean a dispatched run may be uncertain.
 */
export class ChronoPrescribedKinematicsRequestError extends Error {
  readonly kind: StatelessMcpTransportErrorKind;
  readonly httpStatus: number | undefined;

  constructor(
    tool: string,
    kind: StatelessMcpTransportErrorKind,
    httpStatus: number | undefined,
  ) {
    super(
      `${tool}: Chrono request did not produce a valid response (${kind}${
        httpStatus === undefined ? "" : ` HTTP ${httpStatus}`
      })`,
    );
    this.name = "ChronoPrescribedKinematicsRequestError";
    this.kind = kind;
    this.httpStatus = httpStatus;
  }
}

/**
 * Fixed mcp-chrono 0.3.2 adapter.  It exposes no provider, tool, endpoint, or
 * argument selection surface to a caller.  The only side-effecting call is
 * dispatched once; all subsequent inspection is identity readback.
 */
export class ChronoPrescribedKinematicsClient implements PrescribedKinematicsObserver {
  readonly #http: StatelessMcpHttpTransport;

  private constructor(options: {
    readonly bearerCredential: InternalMcpBearerCredential;
    readonly fetch?: typeof fetch;
    readonly timeoutMs?: number;
  }) {
    this.#http = new StatelessMcpHttpTransport({
      mcpUrl: CHRONO_MCP_URL,
      bearerCredential: options.bearerCredential,
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Builds the fixed local client from the exact runtime session snapshot.
   * Neither URL, token, provider, MCP tool nor arbitrary headers are caller
   * configurable through this factory.
   */
  static fromTrustedRuntime(
    options: ChronoPrescribedKinematicsClientOptions,
  ): ChronoPrescribedKinematicsClient {
    return new ChronoPrescribedKinematicsClient({
      bearerCredential: options.secretResolver.bearerCredentialFor(
        options.secretSnapshot,
      ),
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    });
  }

  async submitCase(
    request: PrescribedKinematicsCaseSubmissionRequest,
  ): Promise<SubmittedPrescribedKinematicsCase> {
    if (
      typeof request.exactCaseText !== "string" || request.exactCaseText.length === 0
    ) {
      throw new TypeError("Chrono exactCaseText must be a non-empty exact JSON string");
    }
    if (
      request.requestFingerprint.algorithm !== "sha256" ||
      !SHA256.test(request.requestFingerprint.digest)
    ) {
      throw new TypeError("Chrono requestFingerprint must be lower-case SHA-256");
    }
    if (
      (await sha256Hex(new TextEncoder().encode(request.exactCaseText))) !==
        request.requestFingerprint.digest
    ) {
      throw new TypeError(
        "Chrono requestFingerprint does not bind the exact case submission bytes.",
      );
    }
    const content = await this.#call(CHRONO_CASE_SUBMIT, {
      case_json: request.exactCaseText,
      case_sha256: request.requestFingerprint.digest,
    });
    const root = exact(content, ["ok", "case_sha256", "case_uri"], CHRONO_CASE_SUBMIT);
    literal(root.ok, true, `${CHRONO_CASE_SUBMIT}.ok`);
    const caseSha256 = sha256(root.case_sha256, `${CHRONO_CASE_SUBMIT}.case_sha256`);
    if (
      caseSha256 !== request.requestFingerprint.digest
    ) {
      throw protocol(
        `${CHRONO_CASE_SUBMIT}.case_sha256 does not match the expected exact case SHA-256`,
      );
    }
    const caseUri = caseUriFor(
      caseSha256,
      root.case_uri,
      `${CHRONO_CASE_SUBMIT}.case_uri`,
    );
    return { caseSha256, caseUri };
  }

  async run(
    request: PrescribedKinematicsRunRequest,
  ): Promise<PrescribedKinematicsRunReadback> {
    const valid = validateRunRequest(request, "run request");
    try {
      const content = await this.#call(CHRONO_RUN, {
        request_id: valid.requestId,
        case_sha256: valid.caseSha256,
        case_uri: valid.caseUri,
        ...(valid.timeoutMs === undefined ? {} : { timeout_ms: valid.timeoutMs }),
        ...pageArguments(valid),
      });
      const root = exact(content, ["ok", "replayed", "record"], CHRONO_RUN);
      literal(root.ok, true, `${CHRONO_RUN}.ok`);
      boolean(root.replayed, `${CHRONO_RUN}.replayed`);
      return {
        state: "recorded",
        record: parseRecord(root.record, CHRONO_RUN, valid),
      };
    } catch (error) {
      if (
        error instanceof ChronoPrescribedKinematicsProviderError &&
        isPostIntentRunError(error.code)
      ) {
        return uncertain(valid);
      }
      if (
        error instanceof ChronoPrescribedKinematicsProviderError &&
        PRE_DISPATCH_RUN_REJECTIONS.has(
          error.code as PrescribedKinematicsPreDispatchRejectionCode,
        )
      ) {
        return {
          state: "rejected",
          code: error.code as PrescribedKinematicsPreDispatchRejectionCode,
        };
      }
      if (
        error instanceof ChronoPrescribedKinematicsRequestError &&
        (error.kind === "transport" || error.kind === "protocol-invalid")
      ) {
        throw new ChronoPrescribedKinematicsDispatchUncertainError(
          valid.requestId,
          valid.caseSha256,
        );
      }
      if (error instanceof ChronoPrescribedKinematicsProtocolError) {
        throw new ChronoPrescribedKinematicsDispatchUncertainError(
          valid.requestId,
          valid.caseSha256,
        );
      }
      throw error;
    }
  }

  async readRun(
    expected: Pick<
      PrescribedKinematicsRunRequest,
      "requestId" | "caseSha256" | "caseUri"
    >,
    page: PrescribedKinematicsSamplePageRequest = {},
  ): Promise<PrescribedKinematicsRunReadback> {
    const expectedRequest = validateRunRequest(
      expected,
      "chrono run readback expected request",
    );
    const content = await this.#call(CHRONO_RUN_GET, {
      request_id: expectedRequest.requestId,
      ...pageArguments(page),
    });
    const root = closed(
      content,
      ["ok", "state", "record", "intent"],
      ["ok", "state"],
      CHRONO_RUN_GET,
    );
    literal(root.ok, true, `${CHRONO_RUN_GET}.ok`);
    if (root.state === "absent") {
      exact(root, ["ok", "state"], CHRONO_RUN_GET);
      return { state: "absent" };
    }
    if (root.state === "uncertain") {
      const intent = exact(
        root.intent,
        ["request", "case_uri", "intent_recorded_at"],
        `${CHRONO_RUN_GET}.intent`,
      );
      const request = canonicalizeProviderRequest(
        parseProviderRequest(
          intent.request,
          `${CHRONO_RUN_GET}.intent.request`,
        ),
        intent.case_uri,
        `${CHRONO_RUN_GET}.intent.case_uri`,
      );
      isoTimestamp(
        intent.intent_recorded_at,
        `${CHRONO_RUN_GET}.intent.intent_recorded_at`,
      );
      assertReadbackRequestMatches(
        request,
        expectedRequest,
        `${CHRONO_RUN_GET}.intent.request`,
      );
      return {
        state: "uncertain",
        requestId: request.requestId,
        caseSha256: request.caseSha256,
        caseUri: request.caseUri,
      };
    }
    if (root.state === "recorded") {
      const parsed = parseRecord(root.record, CHRONO_RUN_GET);
      assertReadbackRequestMatches(
        parsed.request,
        expectedRequest,
        `${CHRONO_RUN_GET}.record request`,
      );
      return { state: "recorded", record: parsed };
    }
    throw protocol(`${CHRONO_RUN_GET}.state must be recorded, uncertain, or absent`);
  }

  async readReceipt(
    receiptSha256: string,
    page: PrescribedKinematicsSamplePageRequest = {},
  ): Promise<PrescribedKinematicsObservationRecord> {
    sha256(receiptSha256, "chrono receiptSha256");
    const content = await this.#call(CHRONO_RECEIPT_GET, {
      receipt_sha256: receiptSha256,
      ...pageArguments(page),
    });
    const root = exact(content, ["ok", "record"], CHRONO_RECEIPT_GET);
    literal(root.ok, true, `${CHRONO_RECEIPT_GET}.ok`);
    const record = parseRecord(root.record, CHRONO_RECEIPT_GET);
    if (record.receipt.receiptSha256 !== receiptSha256) {
      throw protocol(
        `${CHRONO_RECEIPT_GET}.record receipt identity does not match readback`,
      );
    }
    return record;
  }

  async #call(
    tool: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Record<string, unknown>> {
    let result: Record<string, unknown>;
    try {
      result = await this.#http.request({
        method: "tools/call",
        label: tool,
        name: tool,
        params: { name: tool, arguments: args },
      });
    } catch (error) {
      if (error instanceof StatelessMcpTransportError) {
        throw new ChronoPrescribedKinematicsRequestError(
          tool,
          error.kind,
          error.httpStatus,
        );
      }
      throw error;
    }
    if (result.resultType !== "complete") {
      throw protocol(`${tool}: expected resultType \"complete\"`);
    }
    const structured = record(result.structuredContent, `${tool}.structuredContent`);
    if (result.isError === true) {
      const failure = exact(structured, ["ok", "error"], `${tool}.failure`);
      literal(failure.ok, false, `${tool}.failure.ok`);
      const error = closed(
        failure.error,
        ["code", "message", "details"],
        ["code", "message"],
        `${tool}.failure.error`,
      );
      const code = providerErrorCode(error.code, `${tool}.failure.error.code`);
      providerErrorMessage(error.message, `${tool}.failure.error.message`);
      if (error.details !== undefined) {
        providerErrorDetails(error.details, `${tool}.failure.error.details`);
      }
      throw new ChronoPrescribedKinematicsProviderError(tool, code);
    }
    return structured;
  }
}

/** Convenience only for local composition; it creates the opaque credential. */
function parseRecord(
  value: unknown,
  path: string,
  expected?: PrescribedKinematicsRunRequest,
): PrescribedKinematicsObservationRecord {
  const root = exact(
    value,
    ["request", "case_uri", "recorded_at", "receipt", "observation", "sample_page"],
    `${path}.record`,
  );
  const request = canonicalizeProviderRequest(
    parseProviderRequest(root.request, `${path}.record.request`),
    root.case_uri,
    `${path}.record.case_uri`,
  );
  const recordedAt = isoTimestamp(root.recorded_at, `${path}.record.recorded_at`);
  const observation = parseObservation(root.observation, `${path}.record.observation`);
  const receipt = parseReceipt(
    root.receipt,
    `${path}.record.receipt`,
    observation,
    request,
    recordedAt,
  );
  const samplePage = parseSamplePage(
    root.sample_page,
    `${path}.record.sample_page`,
    observation.sampleCount,
  );
  if (expected !== undefined) {
    if (
      request.requestId !== expected.requestId ||
      request.caseSha256 !== expected.caseSha256 ||
      request.caseUri !== expected.caseUri ||
      request.timeoutMs !== expected.timeoutMs
    ) {
      throw protocol(`${path}.record request does not match the dispatched identity`);
    }
  }
  return {
    request,
    recordedAt,
    receipt,
    notEvaluated: observation.notEvaluated,
    sampleCount: observation.sampleCount,
    sampleTimeRangeSeconds: observation.sampleTimeRangeSeconds,
    samplePage,
  };
}

interface ParsedProviderRunRequest {
  readonly requestId: string;
  readonly caseSha256: string;
  readonly caseUri?: string;
  readonly timeoutMs?: number;
}

function parseProviderRequest(
  value: unknown,
  path: string,
): ParsedProviderRunRequest {
  const root = closed(
    value,
    ["request_id", "case_sha256", "case_uri", "timeout_ms"],
    ["request_id", "case_sha256"],
    path,
  );
  const requestId = assertRequestId(root.request_id, `${path}.request_id`);
  const caseSha256 = sha256(root.case_sha256, `${path}.case_sha256`);
  const caseUri = root.case_uri === undefined
    ? undefined
    : caseUriFor(caseSha256, root.case_uri, `${path}.case_uri`);
  const timeoutMs = root.timeout_ms === undefined
    ? undefined
    : boundedInteger(root.timeout_ms, 100, 60_000, `${path}.timeout_ms`);
  return {
    requestId,
    caseSha256,
    ...(caseUri === undefined ? {} : { caseUri }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

function canonicalizeProviderRequest(
  request: ParsedProviderRunRequest,
  enclosingCaseUri: unknown,
  path: string,
): PrescribedKinematicsRunRequest {
  const caseUri = caseUriFor(request.caseSha256, enclosingCaseUri, path);
  if (request.caseUri !== undefined && request.caseUri !== caseUri) {
    throw protocol(`${path} does not match the stored request case URI`);
  }
  return { ...request, caseUri };
}

function assertReadbackRequestMatches(
  observed: Pick<
    PrescribedKinematicsRunRequest,
    "requestId" | "caseSha256" | "caseUri"
  >,
  expected: Pick<
    PrescribedKinematicsRunRequest,
    "requestId" | "caseSha256" | "caseUri"
  >,
  path: string,
): void {
  if (
    observed.requestId !== expected.requestId ||
    observed.caseSha256 !== expected.caseSha256 ||
    observed.caseUri !== expected.caseUri
  ) {
    throw protocol(
      `${path} does not match the exact request and case identity expected by readback`,
    );
  }
}

function parseObservation(value: unknown, path: string): {
  readonly engine: { readonly name: "Project Chrono"; readonly version: "10.0.0" };
  readonly runtime: { readonly binding: "pychrono"; readonly pythonVersion: string };
  readonly executionState: "completed" | "not-converged";
  readonly kinematicsExit: { readonly rawCode: number; readonly rawName: string };
  readonly notEvaluated: PrescribedKinematicsObservationRecord["notEvaluated"];
  readonly sampleCount: number;
  readonly sampleTimeRangeSeconds: { readonly first: number; readonly last: number };
} {
  const root = exact(
    value,
    [
      "engine",
      "runtime",
      "execution_state",
      "kinematics_exit",
      "not_evaluated",
      "sample_count",
      "sample_time_range_s",
    ],
    path,
  );
  const engine = exact(root.engine, ["name", "version"], `${path}.engine`);
  literal(engine.name, "Project Chrono", `${path}.engine.name`);
  literal(engine.version, "10.0.0", `${path}.engine.version`);
  const runtime = exact(root.runtime, ["binding", "python_version"], `${path}.runtime`);
  literal(runtime.binding, "pychrono", `${path}.runtime.binding`);
  const pythonVersion = version(
    runtime.python_version,
    `${path}.runtime.python_version`,
  );
  const executionState = root.execution_state === "completed"
    ? "completed"
    : root.execution_state === "not_converged"
    ? "not-converged"
    : invalid(`${path}.execution_state must be completed or not_converged`);
  const exit = exact(
    root.kinematics_exit,
    ["raw_code", "raw_name"],
    `${path}.kinematics_exit`,
  );
  const rawCode = integer(exit.raw_code, `${path}.kinematics_exit.raw_code`);
  const rawName = text(exit.raw_name, `${path}.kinematics_exit.raw_name`);
  const expectedExit = new Map([
    [0, "NOT_CONVERGED"],
    [1, "SUCCESS"],
    [2, "ABSTOL_RESIDUAL"],
    [3, "RELTOL_UPDATE"],
    [4, "ABSTOL_UPDATE"],
  ]);
  if (expectedExit.get(rawCode) !== rawName) {
    throw protocol(`${path}.kinematics_exit has an unsupported code/name pair`);
  }
  const notEvaluated = array(root.not_evaluated, `${path}.not_evaluated`);
  if (
    notEvaluated.length !== NOT_EVALUATED.length ||
    notEvaluated.some((entry, index) => entry !== NOT_EVALUATED[index])
  ) {
    throw protocol(
      `${path}.not_evaluated must preserve the provider's fixed literal boundary`,
    );
  }
  const sampleCount = boundedInteger(root.sample_count, 1, 512, `${path}.sample_count`);
  const range = exact(
    root.sample_time_range_s,
    ["first", "last"],
    `${path}.sample_time_range_s`,
  );
  return {
    engine: { name: "Project Chrono", version: "10.0.0" },
    runtime: { binding: "pychrono", pythonVersion },
    executionState,
    kinematicsExit: { rawCode, rawName },
    notEvaluated: [...NOT_EVALUATED],
    sampleCount,
    sampleTimeRangeSeconds: {
      first: finite(range.first, `${path}.sample_time_range_s.first`),
      last: finite(range.last, `${path}.sample_time_range_s.last`),
    },
  };
}

function parseReceipt(
  value: unknown,
  path: string,
  observation: ReturnType<typeof parseObservation>,
  request: PrescribedKinematicsRunRequest,
  recordedAt: string,
): PrescribedKinematicsReceipt {
  const root = exact(
    value,
    [
      "schema_id",
      "receipt_sha256",
      "case_sha256",
      "outcome_sha256",
      "request_id",
      "recorded_at",
      "package",
      "provider",
      "worker",
      "runtime",
      "server_runtime",
      "execution_state",
      "kinematics_exit",
    ],
    path,
  );
  literal(
    root.schema_id,
    "chrono-prescribed-kinematics-receipt/1.0",
    `${path}.schema_id`,
  );
  const receiptSha256 = sha256(root.receipt_sha256, `${path}.receipt_sha256`);
  const caseSha256 = sha256(root.case_sha256, `${path}.case_sha256`);
  const outcomeSha256 = sha256(root.outcome_sha256, `${path}.outcome_sha256`);
  const requestId = assertRequestId(root.request_id, `${path}.request_id`);
  const receiptRecordedAt = isoTimestamp(root.recorded_at, `${path}.recorded_at`);
  const packageIdentity = exact(root.package, ["name", "version"], `${path}.package`);
  literal(packageIdentity.name, "@casys/mcp-chrono", `${path}.package.name`);
  literal(packageIdentity.version, "0.3.2", `${path}.package.version`);
  const providerIdentity = exact(
    root.provider,
    ["name", "version"],
    `${path}.provider`,
  );
  literal(providerIdentity.name, "casys-chrono", `${path}.provider.name`);
  literal(providerIdentity.version, "0.3.2", `${path}.provider.version`);
  const worker = exact(root.worker, ["source_sha256"], `${path}.worker`);
  const runtime = exact(root.runtime, ["binding", "python_version"], `${path}.runtime`);
  literal(runtime.binding, "pychrono", `${path}.runtime.binding`);
  const serverRuntime = exact(
    root.server_runtime,
    ["deno_version"],
    `${path}.server_runtime`,
  );
  const receiptExecutionState = root.execution_state === "completed"
    ? "completed"
    : root.execution_state === "not_converged"
    ? "not-converged"
    : invalid(`${path}.execution_state must be completed or not_converged`);
  const exit = exact(
    root.kinematics_exit,
    ["raw_code", "raw_name"],
    `${path}.kinematics_exit`,
  );
  if (
    caseSha256 !== request.caseSha256 ||
    requestId !== request.requestId ||
    receiptRecordedAt !== recordedAt ||
    receiptExecutionState !== observation.executionState ||
    integer(exit.raw_code, `${path}.kinematics_exit.raw_code`) !==
      observation.kinematicsExit.rawCode ||
    text(exit.raw_name, `${path}.kinematics_exit.raw_name`) !==
      observation.kinematicsExit.rawName ||
    runtime.python_version !== observation.runtime.pythonVersion
  ) {
    throw protocol(
      `${path} does not bind the returned observation to its exact request`,
    );
  }
  return parseChronoPrescribedKinematicsReceipt({
    receiptSha256,
    caseSha256,
    outcomeSha256,
    requestId,
    recordedAt: receiptRecordedAt,
    engine: observation.engine,
    runtime: {
      binding: "pychrono",
      pythonVersion: observation.runtime.pythonVersion,
      serverDenoVersion: version(
        serverRuntime.deno_version,
        `${path}.server_runtime.deno_version`,
      ),
    },
    workerSourceSha256: sha256(worker.source_sha256, `${path}.worker.source_sha256`),
    executionState: receiptExecutionState,
    kinematicsExit: observation.kinematicsExit,
  }, path);
}

function parseSamplePage(
  value: unknown,
  path: string,
  sampleCount: number,
): PrescribedKinematicsSamplePage {
  const root = exact(
    value,
    ["offset", "limit", "total", "returned", "has_more", "samples"],
    path,
  );
  const offset = boundedInteger(root.offset, 0, 511, `${path}.offset`);
  const limit = boundedInteger(root.limit, 1, 64, `${path}.limit`);
  const total = boundedInteger(root.total, 1, 512, `${path}.total`);
  const returned = boundedInteger(root.returned, 0, 64, `${path}.returned`);
  const hasMore = boolean(root.has_more, `${path}.has_more`);
  const samples = array(root.samples, `${path}.samples`).map((sample, index) =>
    parseSample(sample, `${path}.samples[${index}]`)
  );
  if (
    total !== sampleCount ||
    returned !== samples.length ||
    returned > limit ||
    offset + returned > total ||
    hasMore !== (offset + returned < total)
  ) {
    throw protocol(`${path} has inconsistent bounded-page metadata`);
  }
  return {
    sampleOffset: offset,
    sampleLimit: limit,
    total,
    returned,
    hasMore,
    samples,
  };
}

function parseSample(value: unknown, path: string): PrescribedKinematicsSample {
  const root = exact(value, ["time_s", "bodies", "motors"], path);
  const bodies = array(root.bodies, `${path}.bodies`).map((body, index) =>
    parseBody(body, `${path}.bodies[${index}]`)
  );
  const joints = array(root.motors, `${path}.motors`).map((joint, index) =>
    parseJoint(joint, `${path}.motors[${index}]`)
  );
  unique(bodies.map((body) => body.bodyId), `${path}.bodies`);
  unique(joints.map((joint) => joint.jointId), `${path}.motors`);
  return { timeSeconds: finite(root.time_s, `${path}.time_s`), bodies, joints };
}

function parseBody(value: unknown, path: string): PrescribedKinematicsBodyObservation {
  const root = exact(value, ["id", "position_m", "rotation_wxyz"], path);
  return {
    bodyId: text(root.id, `${path}.id`),
    positionMetres: tuple(root.position_m, 3, `${path}.position_m`),
    rotationWxyz: tuple(root.rotation_wxyz, 4, `${path}.rotation_wxyz`),
  };
}

function parseJoint(
  value: unknown,
  path: string,
): PrescribedKinematicsJointObservation {
  const root = exact(
    value,
    [
      "joint_id",
      "motor_angle_rad",
      "declared_limit_observation",
      "translation_residual_m",
      "rotation_quaternion_imag_residual",
    ],
    path,
  );
  const declaredLimitObservation = root.declared_limit_observation === "below" ||
      root.declared_limit_observation === "within" ||
      root.declared_limit_observation === "above"
    ? root.declared_limit_observation
    : invalid(`${path}.declared_limit_observation is invalid`);
  return {
    jointId: text(root.joint_id, `${path}.joint_id`),
    motorAngleRadians: finite(root.motor_angle_rad, `${path}.motor_angle_rad`),
    declaredLimitObservation,
    translationResidualMetres: tuple(
      root.translation_residual_m,
      3,
      `${path}.translation_residual_m`,
    ),
    rotationQuaternionImagResidual: tuple(
      root.rotation_quaternion_imag_residual,
      3,
      `${path}.rotation_quaternion_imag_residual`,
    ),
  };
}

function validateRunRequest(
  request: PrescribedKinematicsRunRequest,
  path: string,
): PrescribedKinematicsRunRequest {
  const requestId = assertRequestId(request.requestId, `${path}.requestId`);
  const caseSha256 = sha256(request.caseSha256, `${path}.caseSha256`);
  const caseUri = caseUriFor(caseSha256, request.caseUri, `${path}.caseUri`);
  const timeoutMs = request.timeoutMs === undefined
    ? undefined
    : boundedInteger(request.timeoutMs, 100, 60_000, `${path}.timeoutMs`);
  const page = pageArguments(request);
  return {
    requestId,
    caseSha256,
    caseUri,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(page.sample_offset === undefined ? {} : { sampleOffset: page.sample_offset }),
    ...(page.sample_limit === undefined ? {} : { sampleLimit: page.sample_limit }),
  };
}

function pageArguments(
  page: PrescribedKinematicsSamplePageRequest,
): Record<string, number> {
  const result: Record<string, number> = {};
  if (page.sampleOffset !== undefined) {
    result.sample_offset = boundedInteger(page.sampleOffset, 0, 511, "sampleOffset");
  }
  if (page.sampleLimit !== undefined) {
    result.sample_limit = boundedInteger(page.sampleLimit, 1, 64, "sampleLimit");
  }
  return result;
}

function uncertain(
  request: PrescribedKinematicsRunRequest,
): PrescribedKinematicsRunReadback {
  return {
    state: "uncertain",
    requestId: request.requestId,
    caseSha256: request.caseSha256,
    caseUri: request.caseUri,
  };
}

function exact(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const root = record(value, path);
  const actual = Object.keys(root);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw protocol(`${path} has unsupported or missing fields`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(root, key)) throw protocol(`${path}.${key} is required`);
  }
  return root;
}

function closed(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): Record<string, unknown> {
  const root = record(value, path);
  if (Object.keys(root).some((key) => !allowed.includes(key))) {
    throw protocol(`${path} has unsupported fields`);
  }
  for (const key of required) {
    if (!Object.hasOwn(root, key)) throw protocol(`${path}.${key} is required`);
  }
  return root;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw protocol(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw protocol(`${path} must be an array`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw protocol(`${path} must be a non-empty trimmed string`);
  }
  return value;
}

function providerErrorCode(value: unknown, path: string): string {
  const code = text(value, path);
  if (!CHRONO_PROVIDER_ERROR_CODES.has(code)) {
    throw protocol(`${path} is not a published mcp-chrono 0.3.2 error code`);
  }
  return code;
}

/**
 * These codes arise only after mcp-chrono has either written a run intent or
 * begun the provider-side execution/persistence path.  The caller must read
 * the same request identity before assigning any outcome, never retry `run`.
 */
function isPostIntentRunError(code: string): boolean {
  return code === "run_uncertain" || code === "runner_timeout" ||
    code === "worker_failed" || code === "worker_invalid_output" ||
    code === "store_corrupt" || code === "persisted_ledger_invalid" ||
    code === "receipt_invalid" || code === "internal_error";
}

/**
 * Provider text is deliberately validated but never incorporated into an
 * error, record, or log. A provider may reflect user input or credentials.
 */
function providerErrorMessage(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 4_096) {
    throw protocol(`${path} must be a bounded non-empty string`);
  }
}

function providerErrorDetails(value: unknown, path: string): void {
  const root = closed(
    value,
    [
      "expected_case_sha256",
      "actual_case_sha256",
      "request_id",
      "code",
      "stderr",
    ],
    [],
    path,
  );
  if (root.expected_case_sha256 !== undefined) {
    sha256(root.expected_case_sha256, `${path}.expected_case_sha256`);
  }
  if (root.actual_case_sha256 !== undefined) {
    sha256(root.actual_case_sha256, `${path}.actual_case_sha256`);
  }
  if (root.request_id !== undefined) {
    assertRequestId(root.request_id, `${path}.request_id`);
  }
  if (root.code !== undefined) integer(root.code, `${path}.code`);
  if (
    root.stderr !== undefined &&
    (typeof root.stderr !== "string" || root.stderr.length > 16_384)
  ) {
    throw protocol(`${path}.stderr must be a bounded string`);
  }
}

function sha256(value: unknown, path: string): string {
  const result = text(value, path);
  if (!SHA256.test(result)) throw protocol(`${path} must be a lower-case SHA-256`);
  return result;
}

function assertRequestId(value: unknown, path: string): string {
  const result = text(value, path);
  if (!REQUEST_ID.test(result)) {
    throw protocol(`${path} is not a bounded request identity`);
  }
  return result;
}

function caseUriFor(caseSha256: string, value: unknown, path: string): string {
  const result = text(value, path);
  const expected = `chrono-case:sha256:${caseSha256}`;
  if (result !== expected) {
    throw protocol(`${path} must equal the exact submitted case URI`);
  }
  return result;
}

function version(value: unknown, path: string): string {
  const result = text(value, path);
  if (!/^\d+\.\d+\.\d+$/.test(result)) {
    throw protocol(`${path} must be an exact three-segment version`);
  }
  return result;
}

function isoTimestamp(value: unknown, path: string): string {
  const result = text(value, path);
  let canonical: string;
  try {
    canonical = new Date(result).toISOString();
  } catch {
    throw protocol(`${path} must be an ISO timestamp`);
  }
  if (canonical !== result) {
    throw protocol(`${path} must be an exact canonical ISO timestamp`);
  }
  return result;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw protocol(`${path} must be finite`);
  }
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) throw protocol(`${path} must be a safe integer`);
  return Number(value);
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number {
  const result = integer(value, path);
  if (result < min || result > max) {
    throw protocol(`${path} must be from ${min} through ${max}`);
  }
  return result;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw protocol(`${path} must be a boolean`);
  return value;
}

function tuple<T extends 3 | 4>(
  value: unknown,
  length: T,
  path: string,
): T extends 3 ? readonly [number, number, number]
  : readonly [number, number, number, number] {
  const values = array(value, path);
  if (values.length !== length) throw protocol(`${path} must contain ${length} values`);
  const parsed = values.map((entry, index) => finite(entry, `${path}[${index}]`));
  return parsed as unknown as T extends 3 ? readonly [number, number, number]
    : readonly [number, number, number, number];
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw protocol(`${path} has duplicate IDs`);
  }
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw protocol(`${path} must equal ${JSON.stringify(expected)}`);
  }
}

function invalid(message: string): never {
  throw protocol(message);
}

function protocol(message: string): ChronoPrescribedKinematicsProtocolError {
  return new ChronoPrescribedKinematicsProtocolError(message);
}
