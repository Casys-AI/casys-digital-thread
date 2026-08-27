/** Strict private MCP adapter for the mcp-calculix recorded-static contract. */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../src/domain/kernel/case-validation.ts";
import type {
  CalculixRecordedStaticCapturedEvidence,
  CalculixRecordedStaticCapturedResource,
  CalculixRecordedStaticCompleted,
  CalculixRecordedStaticEvidenceVerifier,
  CalculixRecordedStaticExecutionIdentity,
  CalculixRecordedStaticInput,
  CalculixRecordedStaticPlan,
  CalculixRecordedStaticReader,
  CalculixRecordedStaticRecovery,
  CalculixRecordedStaticResult,
  CalculixRecordedStaticSolver,
} from "./calculix-recorded-capabilities.ts";
import {
  type ExpectedProviderResource,
  fingerprintResourceBytes,
  validateExpectedProviderResource,
} from "../../src/domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../src/domain/kernel/deterministic-json.ts";
import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";

const SOLVE_RECORDED = "calculix_solve_static_recorded";
const RUN_GET = "calculix_run_get";
const SHA256 = /^[a-f0-9]{64}$/;
const RUN_ID = /^r-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+ -]{0,127}$/;

const PROFILE = [
  ["input.step", "model/step"],
  ["request.json", "application/json"],
  ["mesh.geo", "text/plain"],
  ["mesh.inp", "text/plain"],
  ["gmsh.log", "text/plain"],
  ["job.inp", "text/plain"],
  ["ccx.log", "text/plain"],
  ["job.dat", "text/plain"],
  ["result.json", "application/json"],
] as const;

type RecordedRequest = Readonly<Record<string, unknown>>;

export class McpCalculixRecordedStaticResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpCalculixRecordedStaticResponseError";
  }
}

/** Only solve-recorded and run-get are reachable through this adapter. */
export class McpCalculixRecordedStaticAdapter
  implements
    CalculixRecordedStaticSolver,
    CalculixRecordedStaticReader,
    CalculixRecordedStaticEvidenceVerifier {
  readonly #plans = new WeakMap<
    CalculixRecordedStaticPlan,
    CalculixRecordedStaticInput
  >();

  constructor(private readonly client: McpToolClient) {}

  resolve(input: CalculixRecordedStaticInput): CalculixRecordedStaticPlan {
    const plan = lowerCalculixRecordedStatic(input);
    this.#plans.set(plan, input);
    return plan;
  }

  async solve(
    plan: CalculixRecordedStaticPlan,
  ): Promise<CalculixRecordedStaticCompleted> {
    const input = this.#plans.get(plan);
    if (!input) {
      throw new TypeError(
        "Recorded CalculiX plan was not resolved by this adapter instance.",
      );
    }
    const result = await this.client.callTool({
      name: SOLVE_RECORDED,
      arguments: plan.exactDispatchRecord,
    });
    return parseSolveEnvelope(result.structuredContent, plan, input);
  }

  async getByRequestId(requestId: string): Promise<CalculixRecordedStaticRecovery> {
    const id = requestIdValue(requestId, "requestId");
    const result = await this.client.callTool({
      name: RUN_GET,
      arguments: { request_id: id },
    });
    return parseRunGetEnvelope(result.structuredContent, id);
  }

  async verifyCapturedEvidence(
    plan: CalculixRecordedStaticPlan,
    completed: CalculixRecordedStaticCompleted,
    resources: readonly CalculixRecordedStaticCapturedResource[],
  ): Promise<CalculixRecordedStaticCapturedEvidence> {
    return await verifyCapturedCalculixRecordedEvidence(plan, completed, resources);
  }
}

/** Exact lowering; only the code-owned staged asset supplies a provider path. */
export function lowerCalculixRecordedStatic(
  input: CalculixRecordedStaticInput,
): CalculixRecordedStaticPlan {
  const proof = input.proof;
  const digest = input.inputArtifact.fingerprint.digest;
  if (input.inputArtifact.fingerprint.algorithm !== "sha256" || !SHA256.test(digest)) {
    throw new TypeError("Recorded CalculiX input fingerprint must be sha256.");
  }
  if (
    digest !== proof.expectedCadArtifact.sha256 ||
    input.inputArtifact.byteCount !== proof.expectedCadArtifact.bytes
  ) {
    throw new TypeError(
      "Recorded CalculiX input must match the sealed proof STEP identity.",
    );
  }
  const requestId = requestIdValue(input.requestId, "input.requestId");
  const stepPath = codeOwnedStepPath(input.inputArtifact.stagedAsset.location, digest);
  const timeoutMs = positiveInteger(input.timeoutMs, "input.timeoutMs");
  if (input.elementOrder !== 1 && input.elementOrder !== 2) {
    throw new TypeError("input.elementOrder must be 1 or 2.");
  }
  const request: RecordedRequest = deepFreeze({
    request_id: requestId,
    step_path: stepPath,
    expected_step_sha256: digest,
    mesh_size_mm: positiveFinite(
      proof.analysis.mesh.targetSize.value,
      "proof.analysis.mesh.targetSize.value",
    ),
    element_order: input.elementOrder,
    material: {
      e_mpa: positiveFinite(
        proof.analysis.material.youngModulus.value,
        "proof.analysis.material.youngModulus.value",
      ),
      nu: poissonRatio(proof.analysis.material.poissonRatio.value),
    },
    selections: [
      ...proof.analysis.supports.map((support) => ({
        name: support.selection.name,
        box: { min: support.selection.box.min, max: support.selection.box.max },
      })),
      ...proof.analysis.loads.map((load) => ({
        name: load.selection.name,
        box: { min: load.selection.box.min, max: load.selection.box.max },
      })),
    ],
    fixed: proof.analysis.supports.map((support) => support.selection.name),
    loads: proof.analysis.loads.map((load) => ({
      selection: load.selection.name,
      force_n: load.force.value,
    })),
    timeout_ms: timeoutMs,
  });
  return Object.freeze({
    requestId,
    exactDispatchRecord: request,
    expectedInput: {
      fingerprint: input.inputArtifact.fingerprint,
      byteCount: input.inputArtifact.byteCount,
    },
  });
}

export function parseSolveEnvelope(
  value: unknown,
  plan: CalculixRecordedStaticPlan,
  input: CalculixRecordedStaticInput,
): CalculixRecordedStaticCompleted {
  try {
    const root = exactRecord(value, [
      "schemaVersion",
      "kind",
      "inputArtifact",
      "mesh",
      "constraints",
      "metrics",
      "run",
    ], "recorded solve response");
    literalValue(root.schemaVersion, "2.0", "recorded solve response.schemaVersion");
    literalValue(root.kind, "static-solve-recorded", "recorded solve response.kind");
    const run = parseCompletedRun(root.run, "recorded solve response.run");
    if (run.requestId !== plan.requestId) {
      throw new TypeError(
        "Recorded solve response requestId does not match the submitted request.",
      );
    }
    const result = parseResult(
      {
        inputArtifact: root.inputArtifact,
        mesh: root.mesh,
        constraints: root.constraints,
        metrics: root.metrics,
      },
      "recorded solve response",
      input,
      run.runId,
    );
    assertInputMatchesRun(result.inputArtifact, run, "recorded solve response");
    assertResourcesMatchRun(result.inputArtifact, run.resources, run.runId);
    return deepFreeze({
      status: "completed",
      requestId: run.requestId,
      requestSha256: run.requestSha256,
      runId: run.runId,
      result,
      resources: run.resources,
    });
  } catch (error) {
    throw responseError(error);
  }
}

export function parseRunGetEnvelope(
  value: unknown,
  expectedRequestId: string,
): CalculixRecordedStaticRecovery {
  try {
    const root = exactRecord(value, runGetKeys(value), "recorded run_get response");
    literalValue(root.schemaVersion, "1.0", "recorded run_get response.schemaVersion");
    const lookup = parseRequestLookup(root.lookup, "recorded run_get response.lookup");
    if (lookup.kind !== "request_id" || lookup.value !== expectedRequestId) {
      throw new TypeError(
        "recorded run_get lookup must echo the requested request_id.",
      );
    }
    const status = root.status;
    if (status === "completed") {
      const run = parseCompletedRun(root.run, "recorded run_get response.run");
      const requestId = requestIdValue(
        root.requestId,
        "recorded run_get response.requestId",
      );
      const runId = runIdValue(root.runId, "recorded run_get response.runId");
      if (
        requestId !== expectedRequestId || run.requestId !== requestId ||
        run.runId !== runId
      ) {
        throw new TypeError(
          "recorded run_get completed identity does not cross-attest.",
        );
      }
      return deepFreeze({
        status: "completed",
        requestId: run.requestId,
        requestSha256: run.requestSha256,
        runId: run.runId,
        resources: run.resources,
      });
    }
    if (status === "not_found") return deepFreeze({ status });
    if (status === "outcome_unknown") {
      const requestId = requestIdValue(
        root.requestId,
        "recorded run_get response.requestId",
      );
      if (requestId !== expectedRequestId) {
        throw new TypeError("outcome_unknown request id differs from lookup.");
      }
      return deepFreeze({
        status,
        requestId,
        reason: nonEmptyText(root.reason, "recorded run_get response.reason"),
      });
    }
    if (status === "dispatched" || status === "quarantined" || status === "evicted") {
      const requestId = requestIdValue(
        root.requestId,
        "recorded run_get response.requestId",
      );
      if (requestId !== expectedRequestId) {
        throw new TypeError("recorded unavailable request id differs from lookup.");
      }
      return deepFreeze({
        status,
        requestId,
        runId: runIdValue(root.runId, "recorded run_get response.runId"),
        reason: root.reason === null
          ? null
          : nonEmptyText(root.reason, "recorded run_get response.reason"),
      });
    }
    throw new TypeError("recorded run_get response has an unsupported status.");
  } catch (error) {
    throw responseError(error);
  }
}

/**
 * Cross-attest the exact nine resource bytes after provider-resource capture.
 *
 * CalculiX creates `execution_identity` only after its durable preflight
 * claim, when the winning process has observed its local engines.  Therefore
 * an ACK cannot truthfully be prevalidated against a request hash generated
 * solely from `plan.exactDispatchRecord`.  The ACK *can* already bind its
 * `run.requestSha256` to the `request.json` tuple; after capture we rebuild
 * the provider-canonical bytes from that sealed dispatch plus the observed,
 * validated execution identity and require the exact SHA-256.
 */
export async function verifyCapturedCalculixRecordedEvidence(
  plan: CalculixRecordedStaticPlan,
  completed: CalculixRecordedStaticCompleted,
  captured: readonly CalculixRecordedStaticCapturedResource[],
): Promise<CalculixRecordedStaticCapturedEvidence> {
  const resources = requiredCapturedResources(completed, captured);
  for (const [role, expected] of resources) {
    const actual = await fingerprintResourceBytes(requiredCaptured(captured, role));
    if (actual !== expected.sha256) {
      throw new TypeError(
        `Captured ${role} does not match its provider resource SHA-256.`,
      );
    }
  }
  const requestBytes = requiredCaptured(captured, "request.json");
  if (await fingerprintResourceBytes(requestBytes) !== completed.requestSha256) {
    throw new TypeError("Captured request.json does not match the run requestSha256.");
  }
  const request = parseJsonObject(requestBytes, "captured request.json");
  const identity = parseSealedRequest(request, plan, completed);
  await assertCanonicalSealedRequestAttestation(
    requestBytes,
    request,
    plan,
    completed,
  );
  const result = parseJsonObject(
    requiredCaptured(captured, "result.json"),
    "captured result.json",
  );
  const fromEvidence = parseResult(
    result,
    "captured result.json",
    undefined,
    completed.runId,
  );
  if (completed.result) assertResultsEqual(fromEvidence, completed.result);
  return deepFreeze({ executionIdentity: identity, result: fromEvidence });
}

function parseCompletedRun(value: unknown, path: string): {
  readonly requestId: string;
  readonly requestSha256: string;
  readonly runId: string;
  readonly inputArtifact: ExpectedProviderResource;
  readonly resources: readonly (ExpectedProviderResource & { readonly role: string })[];
} {
  const run = exactRecord(value, [
    "schemaVersion",
    "state",
    "runId",
    "requestId",
    "requestSha256",
    "inputArtifact",
    "createdAt",
    "artifacts",
  ], path);
  literalValue(run.schemaVersion, "2.0", `${path}.schemaVersion`);
  literalValue(run.state, "completed", `${path}.state`);
  const runId = runIdValue(run.runId, `${path}.runId`);
  const requestId = requestIdValue(run.requestId, `${path}.requestId`);
  const requestSha256 = digest(run.requestSha256, `${path}.requestSha256`);
  isoTimestamp(run.createdAt, `${path}.createdAt`);
  const inputArtifact = parseInputArtifact(run.inputArtifact, `${path}.inputArtifact`);
  const resources = parseResources(run.artifacts, runId, `${path}.artifacts`);
  assertResourcesMatchRun(inputArtifact, resources, runId);
  const request = resources.find((resource) => resource.role === "request.json");
  if (!request || request.sha256 !== requestSha256) {
    throw new TypeError(
      `${path}.requestSha256 does not match the acknowledged request.json artifact tuple.`,
    );
  }
  return deepFreeze({ requestId, requestSha256, runId, inputArtifact, resources });
}

function parseResources(
  value: unknown,
  runId: string,
  path: string,
): readonly (ExpectedProviderResource & { readonly role: string })[] {
  const artifacts = arrayOf(value, path);
  if (artifacts.length !== PROFILE.length) {
    throw new TypeError(`${path} must contain exactly nine artifacts.`);
  }
  const parsed = artifacts.map((artifact, index) => {
    const [role, mediaType] = PROFILE[index];
    const record = exactRecord(
      artifact,
      ["name", "uri", "mimeType", "bytes", "sha256"],
      `${path}[${index}]`,
    );
    literalValue(record.name, role, `${path}[${index}].name`);
    literalValue(record.mimeType, mediaType, `${path}[${index}].mimeType`);
    const expectedUri = `casys://calculix/runs/${runId}/${role}`;
    literalValue(record.uri, expectedUri, `${path}[${index}].uri`);
    const expected = parseExpected({
      uri: record.uri,
      mediaType: record.mimeType,
      byteCount: record.bytes,
      sha256: record.sha256,
    }, `${path}[${index}]`);
    return deepFreeze({ role, ...expected });
  });
  rejectDuplicates(parsed.map((artifact) => artifact.role), `${path} roles`);
  rejectDuplicates(parsed.map((artifact) => artifact.uri), `${path} URIs`);
  return deepFreeze(parsed);
}

function parseResult(
  value: unknown,
  path: string,
  input?: CalculixRecordedStaticInput,
  runId?: string,
): CalculixRecordedStaticResult {
  const rootValue = plainRecord(value, path);
  const hasEnvelopeIdentity = Object.hasOwn(rootValue, "schemaVersion") ||
    Object.hasOwn(rootValue, "kind");
  const root = exactRecord(
    rootValue,
    hasEnvelopeIdentity
      ? ["schemaVersion", "kind", "inputArtifact", "mesh", "constraints", "metrics"]
      : ["inputArtifact", "mesh", "constraints", "metrics"],
    path,
  );
  if (hasEnvelopeIdentity) {
    literalValue(root.schemaVersion, "2.0", `${path}.schemaVersion`);
    literalValue(root.kind, "static-solve-recorded", `${path}.kind`);
  }
  const inputArtifact = parseInputArtifact(root.inputArtifact, `${path}.inputArtifact`);
  if (runId) {
    literalValue(
      inputArtifact.uri,
      `casys://calculix/runs/${runId}/input.step`,
      `${path}.inputArtifact.uri`,
    );
  }
  if (input) {
    if (
      inputArtifact.sha256 !== input.inputArtifact.fingerprint.digest ||
      inputArtifact.byteCount !== input.inputArtifact.byteCount ||
      inputArtifact.mediaType !== "model/step"
    ) {
      throw new TypeError(
        `${path} input STEP does not match the sealed staged artifact.`,
      );
    }
  }
  const mesh = exactRecord(
    root.mesh,
    ["nodes", "elements", "nodesPerSelection"],
    `${path}.mesh`,
  );
  const nodes = positiveInteger(mesh.nodes, `${path}.mesh.nodes`);
  const elements = positiveInteger(mesh.elements, `${path}.mesh.elements`);
  const nodesPerSelectionRecord = plainRecord(
    mesh.nodesPerSelection,
    `${path}.mesh.nodesPerSelection`,
  );
  if (Object.keys(nodesPerSelectionRecord).length === 0) {
    throw new TypeError(`${path}.mesh.nodesPerSelection must not be empty.`);
  }
  const nodesPerSelection: Record<string, number> = {};
  for (const key of Object.keys(nodesPerSelectionRecord).sort()) {
    safeSelection(key, `${path}.mesh.nodesPerSelection key`);
    nodesPerSelection[key] = positiveInteger(
      nodesPerSelectionRecord[key],
      `${path}.mesh.nodesPerSelection.${key}`,
    );
  }
  const constraints = parseConstraints(root.constraints, `${path}.constraints`);
  for (
    const selection of [
      ...constraints.fixedSelections,
      ...constraints.loads.map((load) => load.selection),
    ]
  ) {
    if (!Object.hasOwn(nodesPerSelection, selection)) {
      throw new TypeError(
        `${path} constraint ${selection} has no positive mesh count.`,
      );
    }
  }
  if (input) assertConstraintsMatchProof(constraints, input.proof, path);
  const metrics = parseMetrics(root.metrics, `${path}.metrics`);
  return deepFreeze({
    inputArtifact,
    mesh: { nodes, elements, nodesPerSelection: deepFreeze(nodesPerSelection) },
    constraints,
    metrics,
  });
}

function parseConstraints(
  value: unknown,
  path: string,
): CalculixRecordedStaticResult["constraints"] {
  const root = exactRecord(value, ["fixedSelections", "loads"], path);
  const fixedSelections = arrayOf(root.fixedSelections, `${path}.fixedSelections`).map((
    item,
    index,
  ) => safeSelection(item, `${path}.fixedSelections[${index}]`));
  rejectDuplicates(fixedSelections, `${path}.fixedSelections`);
  const loads = arrayOf(root.loads, `${path}.loads`).map((value, index) => {
    const load = exactRecord(value, ["selection", "forceN"], `${path}.loads[${index}]`);
    return deepFreeze({
      selection: safeSelection(load.selection, `${path}.loads[${index}].selection`),
      forceN: vector(load.forceN, `${path}.loads[${index}].forceN`),
    });
  });
  if (loads.length === 0) throw new TypeError(`${path}.loads must not be empty.`);
  rejectDuplicates(loads.map((load) => load.selection), `${path}.loads selections`);
  if (
    fixedSelections.some((selection) =>
      loads.some((load) => load.selection === selection)
    )
  ) {
    throw new TypeError(`${path} cannot fix and load the same selection.`);
  }
  return deepFreeze({
    fixedSelections: deepFreeze(fixedSelections),
    loads: deepFreeze(loads),
  });
}

function parseMetrics(
  value: unknown,
  path: string,
): CalculixRecordedStaticResult["metrics"] {
  const root = exactRecord(value, ["maxDisplacement", "maxVonMises"], path);
  const displacement = exactRecord(root.maxDisplacement, [
    "value",
    "unit",
    "nodeId",
    "vectorMm",
  ], `${path}.maxDisplacement`);
  literalValue(displacement.unit, "mm", `${path}.maxDisplacement.unit`);
  const displacementValue = nonNegativeFinite(
    displacement.value,
    `${path}.maxDisplacement.value`,
  );
  const vectorMm = vector(displacement.vectorMm, `${path}.maxDisplacement.vectorMm`);
  const magnitude = Math.hypot(...vectorMm);
  if (
    Math.abs(displacementValue - magnitude) >
      8 * Number.EPSILON * Math.max(1, displacementValue, magnitude)
  ) {
    throw new TypeError(`${path}.maxDisplacement value disagrees with vectorMm.`);
  }
  const stress = exactRecord(
    root.maxVonMises,
    ["value", "unit", "elementId"],
    `${path}.maxVonMises`,
  );
  literalValue(stress.unit, "MPa", `${path}.maxVonMises.unit`);
  return deepFreeze({
    maximumDisplacement: {
      value: displacementValue,
      unit: "mm",
      nodeId: positiveInteger(displacement.nodeId, `${path}.maxDisplacement.nodeId`),
      vectorMm,
    },
    maximumVonMises: {
      value: nonNegativeFinite(stress.value, `${path}.maxVonMises.value`),
      unit: "MPa",
      elementId: positiveInteger(stress.elementId, `${path}.maxVonMises.elementId`),
    },
  });
}

function parseSealedRequest(
  value: Record<string, unknown>,
  plan: CalculixRecordedStaticPlan,
  completed: CalculixRecordedStaticCompleted,
): CalculixRecordedStaticExecutionIdentity {
  const request = exactRecord(value, [
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
  ], "captured request.json");
  for (const [key, expected] of Object.entries(plan.exactDispatchRecord)) {
    if (deterministicJson(request[key]) !== deterministicJson(expected)) {
      throw new TypeError(
        `Captured request.json.${key} differs from the sealed dispatch plan.`,
      );
    }
  }
  if (
    requestIdValue(request.request_id, "captured request.json.request_id") !==
      completed.requestId
  ) {
    throw new TypeError("Captured request.json request_id differs from completed run.");
  }
  const input = completed.resources.find((resource) => resource.role === "input.step");
  if (!input) throw new TypeError("Completed run has no input.step resource.");
  if (
    digest(
      request.expected_step_sha256,
      "captured request.json.expected_step_sha256",
    ) !== input.sha256
  ) {
    throw new TypeError(
      "Captured request.json STEP digest differs from completed run.",
    );
  }
  positiveFinite(request.mesh_size_mm, "captured request.json.mesh_size_mm");
  if (request.element_order !== 1 && request.element_order !== 2) {
    throw new TypeError("Captured request.json element_order is invalid.");
  }
  positiveInteger(request.timeout_ms, "captured request.json.timeout_ms");
  const material = exactRecord(
    request.material,
    ["e_mpa", "nu"],
    "captured request.json.material",
  );
  positiveFinite(material.e_mpa, "captured request.json.material.e_mpa");
  poissonRatio(material.nu);
  parseRequestSelections(request.selections);
  parseRequestFixedAndLoads(request.fixed, request.loads);
  return parseExecutionIdentity(request.execution_identity);
}

async function assertCanonicalSealedRequestAttestation(
  requestBytes: Uint8Array,
  request: Record<string, unknown>,
  plan: CalculixRecordedStaticPlan,
  completed: CalculixRecordedStaticCompleted,
): Promise<void> {
  // The execution identity is provider-observed, but parseSealedRequest has
  // just closed its schema.  All remaining fields must be the exact
  // code-owned dispatch record, so this reconstructs the provider's precise
  // `canonicalJson(value) + "\\n"` wire artifact rather than a lossy object
  // hash or a client-selected serialization.
  const expectedBytes = new TextEncoder().encode(
    `${
      deterministicJson({
        ...plan.exactDispatchRecord,
        execution_identity: request.execution_identity,
      })
    }\n`,
  );
  if (!sameBytes(requestBytes, expectedBytes)) {
    throw new TypeError(
      "Captured request.json is not the provider-canonical sealed request bytes.",
    );
  }
  const expectedSha256 = await fingerprintResourceBytes(expectedBytes);
  if (expectedSha256 !== completed.requestSha256) {
    throw new TypeError(
      "Provider-canonical request.json bytes do not match the acknowledged run requestSha256.",
    );
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length &&
    left.every((byte, index) => byte === right[index]);
}

function parseExecutionIdentity(
  value: unknown,
): CalculixRecordedStaticExecutionIdentity {
  const root = exactRecord(value, [
    "schema_version",
    "server",
    "method",
    "lowering",
    "engines",
    "image",
  ], "captured request.json.execution_identity");
  literalValue(
    root.schema_version,
    "1.0",
    "captured request.json.execution_identity.schema_version",
  );
  const server = exactRecord(
    root.server,
    ["package", "version"],
    "captured request.json.execution_identity.server",
  );
  literalValue(
    server.package,
    "@casys/mcp-calculix",
    "captured request.json.execution_identity.server.package",
  );
  const method = exactRecord(
    root.method,
    ["id", "version"],
    "captured request.json.execution_identity.method",
  );
  literalValue(
    method.id,
    SOLVE_RECORDED,
    "captured request.json.execution_identity.method.id",
  );
  literalValue(
    method.version,
    "1.0",
    "captured request.json.execution_identity.method.version",
  );
  const lowering = exactRecord(
    root.lowering,
    ["id", "version"],
    "captured request.json.execution_identity.lowering",
  );
  literalValue(
    lowering.id,
    "calculix.static.abaqus-deck",
    "captured request.json.execution_identity.lowering.id",
  );
  literalValue(
    lowering.version,
    "1.0",
    "captured request.json.execution_identity.lowering.version",
  );
  const engines = exactRecord(
    root.engines,
    ["gmsh", "ccx"],
    "captured request.json.execution_identity.engines",
  );
  const gmsh = parseEngine(engines.gmsh, "gmsh");
  const ccx = parseEngine(engines.ccx, "ccx");
  const image = exactRecord(
    root.image,
    ["status"],
    "captured request.json.execution_identity.image",
  );
  literalValue(
    image.status,
    "unattested",
    "captured request.json.execution_identity.image.status",
  );
  return deepFreeze({
    schemaVersion: "1.0",
    server: {
      package: "@casys/mcp-calculix",
      version: version(
        server.version,
        "captured request.json.execution_identity.server.version",
      ),
    },
    method: { id: SOLVE_RECORDED, version: "1.0" },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    engines: { gmsh, ccx },
    image: { status: "unattested" },
  });
}

function parseEngine(
  value: unknown,
  name: "gmsh",
): { readonly command: "gmsh"; readonly version: string };
function parseEngine(
  value: unknown,
  name: "ccx",
): { readonly command: "ccx"; readonly version: string };
function parseEngine(
  value: unknown,
  name: "gmsh" | "ccx",
): { readonly command: "gmsh" | "ccx"; readonly version: string } {
  const record = exactRecord(
    value,
    ["command", "version"],
    `captured request.json.execution_identity.engines.${name}`,
  );
  literalValue(
    record.command,
    name,
    `captured request.json.execution_identity.engines.${name}.command`,
  );
  return {
    command: name,
    version: version(
      record.version,
      `captured request.json.execution_identity.engines.${name}.version`,
    ),
  };
}

function parseRequestSelections(value: unknown): void {
  const selections = arrayOf(value, "captured request.json.selections");
  if (selections.length === 0) {
    throw new TypeError("Captured request.json selections must not be empty.");
  }
  const names: string[] = [];
  for (const [index, candidate] of selections.entries()) {
    const selection = exactRecord(
      candidate,
      ["name", "box"],
      `captured request.json.selections[${index}]`,
    );
    names.push(
      safeSelection(selection.name, `captured request.json.selections[${index}].name`),
    );
    const box = exactRecord(
      selection.box,
      ["min", "max"],
      `captured request.json.selections[${index}].box`,
    );
    const min = vector(box.min, `captured request.json.selections[${index}].box.min`);
    const max = vector(box.max, `captured request.json.selections[${index}].box.max`);
    if (min.some((coordinate, axis) => coordinate >= max[axis])) {
      throw new TypeError("Captured request.json selection box is empty.");
    }
  }
  rejectDuplicates(names, "captured request.json selection names");
}

function parseRequestFixedAndLoads(fixedValue: unknown, loadsValue: unknown): void {
  const fixed = arrayOf(fixedValue, "captured request.json.fixed").map((value, index) =>
    safeSelection(value, `captured request.json.fixed[${index}]`)
  );
  rejectDuplicates(fixed, "captured request.json.fixed");
  const loads = arrayOf(loadsValue, "captured request.json.loads");
  if (loads.length === 0) {
    throw new TypeError("Captured request.json loads must not be empty.");
  }
  for (const [index, candidate] of loads.entries()) {
    const load = exactRecord(
      candidate,
      ["selection", "force_n"],
      `captured request.json.loads[${index}]`,
    );
    safeSelection(load.selection, `captured request.json.loads[${index}].selection`);
    vector(load.force_n, `captured request.json.loads[${index}].force_n`);
  }
}

function assertInputMatchesRun(
  input: ExpectedProviderResource,
  run: ReturnType<typeof parseCompletedRun>,
  path: string,
): void {
  if (
    input.uri !== run.inputArtifact.uri ||
    input.mediaType !== run.inputArtifact.mediaType ||
    input.byteCount !== run.inputArtifact.byteCount ||
    input.sha256 !== run.inputArtifact.sha256
  ) throw new TypeError(`${path} inputArtifact does not match run inputArtifact.`);
}

function assertResourcesMatchRun(
  input: ExpectedProviderResource,
  resources: readonly (ExpectedProviderResource & { readonly role: string })[],
  runId: string,
): void {
  if (resources.length !== PROFILE.length) {
    throw new TypeError("Recorded run must expose exactly nine resources.");
  }
  const step = resources[0];
  if (
    step.role !== "input.step" ||
    step.uri !== `casys://calculix/runs/${runId}/input.step` ||
    step.mediaType !== input.mediaType || step.byteCount !== input.byteCount ||
    step.sha256 !== input.sha256
  ) {
    throw new TypeError("Recorded input.step resource does not match inputArtifact.");
  }
}

function assertConstraintsMatchProof(
  actual: CalculixRecordedStaticResult["constraints"],
  proof: CalculixRecordedStaticInput["proof"],
  path: string,
): void {
  const expectedFixed = proof.analysis.supports.map((support) =>
    support.selection.name
  );
  const expectedLoads = proof.analysis.loads.map((load) => ({
    selection: load.selection.name,
    forceN: load.force.value,
  }));
  if (
    JSON.stringify(actual.fixedSelections) !== JSON.stringify(expectedFixed) ||
    JSON.stringify(actual.loads) !== JSON.stringify(expectedLoads)
  ) {
    throw new TypeError(`${path} constraints do not match the sealed proof.`);
  }
}

function assertResultsEqual(
  left: CalculixRecordedStaticResult,
  right: CalculixRecordedStaticResult,
): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new TypeError(
      "Captured result.json does not reproduce the acknowledged CalculiX result.",
    );
  }
}

function requiredCapturedResources(
  completed: CalculixRecordedStaticCompleted,
  captured: readonly CalculixRecordedStaticCapturedResource[],
): Map<string, ExpectedProviderResource> {
  if (captured.length !== PROFILE.length) {
    throw new TypeError(
      "Captured CalculiX evidence must contain exactly nine resources.",
    );
  }
  rejectDuplicates(
    captured.map((resource) => resource.role),
    "captured CalculiX evidence roles",
  );
  const expected = new Map(
    completed.resources.map((resource) => [resource.role, resource]),
  );
  for (const [role] of PROFILE) {
    if (!expected.has(role) || !captured.some((resource) => resource.role === role)) {
      throw new TypeError(
        `Captured CalculiX evidence omits required resource ${role}.`,
      );
    }
  }
  return expected;
}

function requiredCaptured(
  captured: readonly CalculixRecordedStaticCapturedResource[],
  role: string,
): Uint8Array {
  const resource = captured.find((candidate) => candidate.role === role);
  if (!resource) throw new TypeError(`Captured CalculiX evidence omits ${role}.`);
  return Uint8Array.from(resource.bytes);
}

function runGetKeys(value: unknown): string[] {
  const status = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>).status
    : undefined;
  if (status === "completed") {
    return ["schemaVersion", "status", "lookup", "requestId", "runId", "run"];
  }
  if (status === "outcome_unknown") {
    return ["schemaVersion", "status", "lookup", "requestId", "reason"];
  }
  if (status === "dispatched" || status === "quarantined" || status === "evicted") {
    return ["schemaVersion", "status", "lookup", "requestId", "runId", "reason"];
  }
  return ["schemaVersion", "status", "lookup"];
}

function parseRequestLookup(
  value: unknown,
  path: string,
): { readonly kind: "request_id" | "run_id"; readonly value: string } {
  const lookup = exactRecord(value, ["kind", "value"], path);
  if (lookup.kind !== "request_id" && lookup.kind !== "run_id") {
    throw new TypeError(`${path}.kind is invalid.`);
  }
  return {
    kind: lookup.kind,
    value: lookup.kind === "request_id"
      ? requestIdValue(lookup.value, `${path}.value`)
      : runIdValue(lookup.value, `${path}.value`),
  };
}

function parseExpected(value: unknown, path: string): ExpectedProviderResource {
  return validateExpectedProviderResource(value, path);
}

function parseInputArtifact(value: unknown, path: string): ExpectedProviderResource {
  const input = exactRecord(value, ["uri", "mimeType", "sha256", "bytes"], path);
  literalValue(input.mimeType, "model/step", `${path}.mimeType`);
  return parseExpected({
    uri: input.uri,
    mediaType: input.mimeType,
    byteCount: input.bytes,
    sha256: input.sha256,
  }, path);
}

function parseJsonObject(bytes: Uint8Array, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError(`${path} is not valid UTF-8 JSON.`);
  }
  return plainRecord(value, path);
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function codeOwnedStepPath(value: unknown, digestValue: string): string {
  const location = nonEmptyText(value, "input.inputArtifact.stagedAsset.location");
  const expected = `/inputs/fea-${digestValue}.step`;
  if (location !== expected) {
    throw new TypeError(`Recorded CalculiX staged location must equal ${expected}.`);
  }
  return location;
}

function requestIdValue(value: unknown, path: string): string {
  const id = safeId(value, path);
  if (id.length > 128) throw new TypeError(`${path} must not exceed 128 characters.`);
  return id;
}

function runIdValue(value: unknown, path: string): string {
  const id = nonEmptyText(value, path);
  if (!RUN_ID.test(id)) throw new TypeError(`${path} is not a recorded run id.`);
  return id;
}

function digest(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (!SHA256.test(result)) {
    throw new TypeError(`${path} must be lowercase SHA-256 hex.`);
  }
  return result;
}

function safeSelection(value: unknown, path: string): string {
  const name = nonEmptyText(value, path);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
    throw new TypeError(`${path} is not a valid CalculiX selection name.`);
  }
  return name;
}

function vector(value: unknown, path: string): readonly [number, number, number] {
  const values = arrayOf(value, path);
  if (values.length !== 3) {
    throw new TypeError(`${path} must contain exactly three coordinates.`);
  }
  return [
    finite(values[0], `${path}[0]`),
    finite(values[1], `${path}[1]`),
    finite(values[2], `${path}[2]`),
  ];
}

function positiveFinite(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result <= 0) throw new TypeError(`${path} must be positive.`);
  return result;
}

function nonNegativeFinite(value: unknown, path: string): number {
  const result = finite(value, path);
  if (result < 0) throw new TypeError(`${path} must be non-negative.`);
  return result;
}

function poissonRatio(value: unknown): number {
  const result = positiveFinite(value, "poissonRatio");
  if (result >= 0.5) throw new TypeError("poissonRatio must be below 0.5.");
  return result;
}

function version(value: unknown, path: string): string {
  const result = nonEmptyText(value, path);
  if (!VERSION.test(result)) {
    throw new TypeError(`${path} is not a bounded version token.`);
  }
  return result;
}

function isoTimestamp(value: unknown, path: string): void {
  const timestamp = nonEmptyText(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new TypeError(`${path} is not a canonical ISO timestamp.`);
  }
}

function responseError(error: unknown): McpCalculixRecordedStaticResponseError {
  return new McpCalculixRecordedStaticResponseError(
    error instanceof Error ? error.message : String(error),
    { cause: error },
  );
}
