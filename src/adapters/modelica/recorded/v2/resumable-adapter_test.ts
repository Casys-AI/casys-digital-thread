import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../../../domain/analysis/provider-resource-reader.ts";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  canonicalModelicaResumableProviderJson,
  expectedModelicaResumableResources,
  fingerprintModelicaResumableProviderJson,
  MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION,
  type ModelicaResumableSubmission,
  validateModelicaQualifiedManifestDocument,
} from "../../../../domain/modelica/recorded/resumable-capabilities.ts";
import type { McpToolClient } from "../../../../application/ports/out/mcp-tool-client.ts";
import {
  lowerSubmission,
  McpModelicaResumableAdapter,
  McpModelicaResumableResponseError,
  normalizeCapturedModelicaResumableEvidence,
  parseManifestEnvelope,
  parseRequestEnvelope,
  verifyCapturedModelicaResumableEvidence,
} from "./resumable-adapter.ts";

const SELECTION = {
  modelId: "thermal-kit",
  modelVersion: "1.0.0",
  scenarioId: "heat-up",
};

Deno.test("resumable Modelica adapter lowers only the three exact capability calls", async () => {
  const manifest = await fixtureManifest();
  const submission = await fixtureSubmission(manifest);
  const request = await completedEnvelope(submission, manifest);
  const calls: unknown[] = [];
  const responses = [
    { schemaVersion: "2.1", kind: "simulation-manifest", manifest },
    request,
    request,
  ];
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({ structuredContent: responses.shift()!, text: "" });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  const adapter = new McpModelicaResumableAdapter(client);
  const receivedManifest = await adapter.getManifest(SELECTION);
  const effectiveSubmission = { ...submission, manifest: receivedManifest };
  const submitted = await adapter.submit(effectiveSubmission);
  const readback = await adapter.getRequest(effectiveSubmission);

  assertEquals(
    receivedManifest.schemaVersion,
    MODELICA_QUALIFIED_MANIFEST_SCHEMA_VERSION,
  );
  assertEquals(receivedManifest.contractVersion, "2.1");
  assertEquals(receivedManifest.model, {
    uri: "casys://modelica/kits/thermal-kit/1.0.0/model.mo",
    mediaType: "text/x-modelica",
    byteCount: 1,
    sha256: "a".repeat(64),
    qualification: "qualified-kit",
  });
  assertEquals(receivedManifest.scenarioPublic, {
    id: "heat-up",
    description: "Heat up",
    startTimeS: 0,
    stopTimeS: 10,
    numberOfIntervals: 10,
    solver: "dassl",
    targetTemperature: { value: 90, unit: "degC" },
  });
  assertEquals(receivedManifest.parameters[0]?.conversion, {
    from: "W",
    to: "W",
    factor: 1,
    offset: 0,
  });
  assertEquals(receivedManifest.resultNormalizer, { id: "csv", version: "1.0" });
  assertEquals(receivedManifest.engine, {
    name: "OpenModelica",
    version: "1.23",
    mslVersion: "4.0",
  });
  assertEquals(calls, [
    {
      name: "modelica_simulation_manifest_get",
      arguments: {
        model_id: "thermal-kit",
        model_version: "1.0.0",
        scenario_id: "heat-up",
      },
    },
    {
      name: "modelica_simulation_submit",
      arguments: lowerSubmission(effectiveSubmission),
    },
    {
      name: "modelica_simulation_request_get",
      arguments: { request_id: "request.modelica.1" },
    },
  ]);
  assertEquals(submitted.status, "completed");
  assertEquals(readback.status, "completed");
  assertEquals(
    expectedModelicaResumableResources(readback).map((resource) => resource.role),
    [
      "request",
      "resolved_parameters",
      "model",
      "scenario",
      "script",
      "diagnostics",
      "result",
      "evidence",
      "run.json",
    ],
  );
});

Deno.test("resumable Modelica adapter re-attests the mcp-modelica 2.1 pretty wire bytes", async () => {
  const manifest = await fixtureManifest();
  const { fingerprint, manifest_sha256, ...unsigned } = manifest;
  assertEquals(fingerprint, manifest_sha256);
  assertEquals(
    await fingerprintModelicaResumableProviderJson(unsigned),
    fingerprint,
  );
  assertNotEquals(
    (await sha256Fingerprint(unsigned)).digest,
    fingerprint,
    "mcp-modelica 2.1 seals sorted two-space JSON with a final newline, not compact CAS JSON",
  );
  assertEquals(
    canonicalModelicaResumableProviderJson(unsigned).endsWith("\n"),
    true,
  );
  await parseManifestEnvelope(
    { schemaVersion: "2.1", kind: "simulation-manifest", manifest },
    SELECTION,
  );
});

Deno.test("resumable Modelica adapter rejects malformed envelopes and artifact extras", async () => {
  const manifest = await fixtureManifest();
  await assertRejects(
    () =>
      parseManifestEnvelope({
        schemaVersion: "2.1",
        kind: "simulation-manifest",
        manifest,
        extra: true,
      }, SELECTION),
    McpModelicaResumableResponseError,
    "unsupported field extra",
  );

  const projectionMismatch: Record<string, unknown> = structuredClone(manifest);
  (projectionMismatch.scenario as { projection_sha256: string }).projection_sha256 = "c"
    .repeat(64);
  const {
    fingerprint: _fingerprint,
    manifest_sha256: _manifestSha256,
    ...unsigned
  } = projectionMismatch;
  const resealed = await fingerprintModelicaResumableProviderJson(unsigned);
  projectionMismatch.fingerprint = resealed;
  projectionMismatch.manifest_sha256 = resealed;
  await assertRejects(
    () =>
      parseManifestEnvelope({
        schemaVersion: "2.1",
        kind: "simulation-manifest",
        manifest: projectionMismatch,
      }, SELECTION),
    McpModelicaResumableResponseError,
    "projection_sha256 does not match",
  );

  const submission = await fixtureSubmission(manifest);
  const malformed = await completedEnvelope(submission, manifest);
  (malformed.request as { run: { artifacts: Array<Record<string, unknown>> } }).run
    .artifacts[1].extra = true;
  await assertRejects(
    () => parseRequestEnvelope(malformed, submission),
    McpModelicaResumableResponseError,
    "unsupported field extra",
  );
});

Deno.test("resumable Modelica adapter rejects retry readback that attests different request bytes", async () => {
  const manifest = await fixtureManifest();
  const submission = await fixtureSubmission(manifest);
  const mismatch = await completedEnvelope(submission, manifest);
  (mismatch.request as { request_sha256: string }).request_sha256 = "f".repeat(64);
  await assertRejects(
    () => parseRequestEnvelope(mismatch, submission),
    McpModelicaResumableResponseError,
    "does not attest the exact submitted request bytes",
  );
});

Deno.test("qualified Modelica manifest document round-trips from canonical CAS bytes and rejects tampering", async () => {
  const providerManifest = await fixtureManifest();
  const manifest = await parseManifestEnvelope(
    { schemaVersion: "2.1", kind: "simulation-manifest", manifest: providerManifest },
    SELECTION,
  );
  const canonicalText = await canonicalModelicaQualifiedManifestDocumentText(manifest);
  assertEquals(
    await validateModelicaQualifiedManifestDocument(JSON.parse(canonicalText)),
    manifest,
  );

  const tampered = structuredClone(manifest);
  (tampered.lowering as { id: string }).id = "different-lowering";
  await assertRejects(
    () => validateModelicaQualifiedManifestDocument(tampered),
    TypeError,
    "fingerprint does not match the reconstructed provider 2.1 manifest payload",
  );
});

Deno.test("resumable Modelica captured evidence re-attests request, lowering, run ledger and observations", async () => {
  const fixture = await capturedFixture();
  const request = await parseRequestEnvelope(fixture.envelope, fixture.submission);
  const completed = request.completedRun!;
  const verified = await verifyCapturedModelicaResumableEvidence(
    fixture.submission,
    completed,
    fixture.resources,
  );
  assertEquals(verified, {
    runId: completed.runId,
    status: "succeeded",
    startedAt: "2026-08-12T00:00:00.000Z",
    completedAt: "2026-08-12T00:00:01.000Z",
    resolvedParameters: { power: { value: 250, unit: "W" } },
    metrics: { temperature: { value: 91, unit: "degC" } },
    warnings: [],
  });

  const forged = await capturedFixture("// forged but self-hashed\n");
  const forgedRequest = await parseRequestEnvelope(
    forged.envelope,
    forged.submission,
  );
  await assertRejects(
    () =>
      verifyCapturedModelicaResumableEvidence(
        forged.submission,
        forgedRequest.completedRun!,
        forged.resources,
      ),
    TypeError,
    "does not equal the sealed lowering",
  );
});

Deno.test("resumable Modelica CAS-only normalization rebuilds evidence from run.json and exact tuples without MCP I/O", async () => {
  const fixture = await capturedFixture();
  const request = await parseRequestEnvelope(fixture.envelope, fixture.submission);
  const expected = expectedModelicaResumableResources(request);
  const resources = fixture.resources.map(({ role, bytes }) => {
    const resource = expected.find((item) => item.role === role);
    if (!resource) throw new Error(`Fixture lacks tuple ${role}.`);
    return {
      role,
      resource: {
        uri: resource.uri,
        mediaType: resource.mediaType,
        byteCount: resource.byteCount,
        sha256: resource.sha256,
      },
      bytes,
    };
  });
  let mcpCalls = 0;
  const adapter = new McpModelicaResumableAdapter({
    callTool() {
      mcpCalls += 1;
      return Promise.reject(new Error("CAS-only normalization contacted MCP."));
    },
    callToolTextResult() {
      mcpCalls += 1;
      return Promise.reject(new Error("CAS-only normalization contacted MCP."));
    },
  });

  const normalized = await adapter.normalizeCapturedEvidence(
    fixture.submission,
    resources,
  );
  assertEquals(normalized.metrics, {
    temperature: { value: 91, unit: "degC" },
  });
  assertEquals(mcpCalls, 0);
  assertEquals(
    normalized,
    await normalizeCapturedModelicaResumableEvidence(
      fixture.submission,
      resources,
    ),
  );
});

async function capturedFixture(scriptOverride?: string) {
  const modelText = "model ThermalKit\n  Real power;\nend ThermalKit;\n";
  const scenarioPublic = {
    id: SELECTION.scenarioId,
    description: "Heat up",
    start_time_s: 0,
    stop_time_s: 10,
    number_of_intervals: 10,
    solver: "dassl",
    target_temperature: { value: 90, unit: "degC" },
  };
  const scenarioText = deterministicJson({
    ...scenarioPublic,
    qualification_note: "fixture native scenario",
  });
  const modelSource = await wireResourceFromText(
    "casys://modelica/kits/thermal-kit/1.0.0/model.mo",
    "text/x-modelica",
    modelText,
  );
  const scenarioSource = await wireResourceFromText(
    "casys://modelica/kits/thermal-kit/1.0.0/scenarios/heat-up.json",
    "application/json",
    scenarioText,
  );
  const unsignedManifest = {
    schemaVersion: "2.1",
    model: {
      id: SELECTION.modelId,
      version: SELECTION.modelVersion,
      name: "ThermalKit",
      source: modelSource,
    },
    scenario: {
      id: SELECTION.scenarioId,
      source: scenarioSource,
      public: scenarioPublic,
      projection_sha256: await fingerprintModelicaResumableProviderJson(scenarioPublic),
    },
    parameters: [{
      id: "power",
      modelica_name: "power",
      modelica_type: "Real",
      description: "Heater power",
      unit: "W",
      minimum: 0,
      maximum: 1000,
      conversion: { from: "W", to: "W", factor: 1, offset: 0 },
    }],
    produced_metrics: [{
      id: "temperature",
      unit: "degC",
      description: "Maximum temperature",
      required: true,
    }],
    result_normalizer: { id: "csv", version: "1.0" },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", msl_version: "4.0" },
  };
  const manifestFingerprint = await fingerprintModelicaResumableProviderJson(
    unsignedManifest,
  );
  const manifest = {
    ...unsignedManifest,
    fingerprint: manifestFingerprint,
    manifest_sha256: manifestFingerprint,
  };
  const submission = await fixtureSubmission(manifest);
  const runId = "run_12345678-1234-4234-8234-123456789abc";
  const resolvedParameters = { power: { value: 250, unit: "W" } };
  const metrics = { temperature: { value: 91, unit: "degC" } };
  const warnings: string[] = [];
  const requestText = canonicalModelicaResumableProviderJson(
    lowerSubmission(submission),
  );
  const requestSha256 = await fingerprintResourceBytes(
    new TextEncoder().encode(requestText),
  );
  const script = scriptOverride ?? [
    "// Generated by mcp-modelica 2.1. Do not edit: the server owns this script.",
    "loadModel(Modelica);",
    'loadFile("ThermalKit.mo");',
    'simulate(ThermalKit, startTime=0, stopTime=10, numberOfIntervals=10, method="dassl", outputFormat="csv", fileNamePrefix="result", simflags="-override=power=250");',
    "getErrorString();",
    "",
  ].join("\n");
  const contents = {
    request: requestText,
    resolved_parameters: canonicalModelicaResumableProviderJson(resolvedParameters),
    model: modelText,
    scenario: scenarioText,
    script,
    diagnostics: "OpenModelica fixture diagnostics\n",
    result: "time,temperature\n0,20\n10,91\n",
    evidence: canonicalModelicaResumableProviderJson({
      producer: "mcp-modelica",
      status: "succeeded",
      request_id: submission.requestId,
      manifest_sha256: submission.manifest.fingerprint,
      metrics,
      warnings,
      note:
        "This is computed evidence only. Requirement pass/fail belongs to mcp-syson and @casys/constraint-solver.",
    }),
  };
  const profile = [
    ["request", "request.json", "application/json"],
    ["resolved_parameters", "resolved-parameters.json", "application/json"],
    ["model", "ThermalKit.mo", "text/x-modelica"],
    ["scenario", "scenario.json", "application/json"],
    ["script", "run.mos", "text/plain"],
    ["diagnostics", "omc.log", "text/plain"],
    ["result", "result.csv", "text/csv"],
    ["evidence", "evidence.json", "application/json"],
  ] as const;
  const artifacts = await Promise.all(
    profile.map(async ([role, fileName, mediaType]) => {
      const text = contents[role];
      const bytes = new TextEncoder().encode(text);
      const base = {
        kind: role,
        file_name: fileName,
        ...(role === "request" ? {} : { run_id: runId }),
        uri: role === "request"
          ? `casys://modelica/requests/${submission.requestId}/request.json`
          : `casys://modelica/requests/${submission.requestId}/artifacts/${fileName}`,
        mediaType,
        sha256: await fingerprintResourceBytes(bytes),
        bytes: bytes.byteLength,
      };
      return role === "model"
        ? { ...base, qualification: "qualified-kit", source_resource: modelSource }
        : role === "scenario"
        ? { ...base, qualification: "qualified-kit", source_resource: scenarioSource }
        : base;
    }),
  );
  const run = {
    schemaVersion: "2.1",
    kind: "simulation-run",
    request_id: submission.requestId,
    request_sha256: requestSha256,
    manifest,
    run_id: runId,
    status: "succeeded",
    started_at: "2026-08-12T00:00:00.000Z",
    completed_at: "2026-08-12T00:00:01.000Z",
    resolved_parameters: resolvedParameters,
    metrics,
    artifacts,
    warnings,
  };
  const runText = canonicalModelicaResumableProviderJson(run);
  const runBytes = new TextEncoder().encode(runText);
  const runJson = {
    uri: `casys://modelica/requests/${submission.requestId}/run.json`,
    mediaType: "application/json",
    sha256: await fingerprintResourceBytes(runBytes),
    bytes: runBytes.byteLength,
  };
  return {
    submission,
    envelope: {
      schemaVersion: "2.1",
      kind: "simulation-request",
      request: {
        request_id: submission.requestId,
        request_sha256: requestSha256,
        manifest_sha256: submission.manifest.fingerprint,
        status: "completed",
        run: { ...run, run_json: runJson },
      },
    },
    resources: [
      ...profile.map(([role]) => ({
        role,
        bytes: new TextEncoder().encode(contents[role]),
      })),
      { role: "run.json", bytes: runBytes },
    ],
  };
}

async function wireResourceFromText(
  uri: string,
  mediaType: string,
  text: string,
) {
  const bytes = new TextEncoder().encode(text);
  return {
    uri,
    mediaType,
    bytes: bytes.byteLength,
    sha256: await fingerprintResourceBytes(bytes),
    qualification: "qualified-kit" as const,
  };
}

async function fixtureManifest(): Promise<
  Record<string, unknown> & { readonly manifest_sha256: string }
> {
  const publicScenario = {
    id: SELECTION.scenarioId,
    description: "Heat up",
    start_time_s: 0,
    stop_time_s: 10,
    number_of_intervals: 10,
    solver: "dassl",
    target_temperature: { value: 90, unit: "degC" },
  };
  const unsigned = {
    schemaVersion: "2.1",
    model: {
      id: SELECTION.modelId,
      version: SELECTION.modelVersion,
      name: "ThermalKit",
      source: resource(
        "casys://modelica/kits/thermal-kit/1.0.0/model.mo",
        "text/x-modelica",
        "a",
      ),
    },
    scenario: {
      id: SELECTION.scenarioId,
      source: resource(
        "casys://modelica/kits/thermal-kit/1.0.0/scenarios/heat-up.json",
        "application/json",
        "b",
      ),
      public: publicScenario,
      projection_sha256: await fingerprintModelicaResumableProviderJson(publicScenario),
    },
    parameters: [{
      id: "power",
      modelica_name: "power",
      modelica_type: "Real",
      description: "Heater power",
      unit: "W",
      minimum: 0,
      maximum: 1000,
      conversion: { from: "W", to: "W", factor: 1, offset: 0 },
    }],
    produced_metrics: [{
      id: "temperature",
      unit: "degC",
      description: "Maximum temperature",
      required: true,
    }],
    result_normalizer: { id: "csv", version: "1.0" },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", msl_version: "4.0" },
  };
  const fingerprint = await fingerprintModelicaResumableProviderJson(unsigned);
  return { ...unsigned, fingerprint, manifest_sha256: fingerprint };
}

async function fixtureSubmission(
  manifest: Record<string, unknown>,
): Promise<ModelicaResumableSubmission> {
  return {
    requestId: "request.modelica.1",
    manifest: await parseManifestEnvelope(
      { schemaVersion: "2.1", kind: "simulation-manifest", manifest },
      SELECTION,
    ),
    parameters: { power: { value: 250, unit: "W" } },
    timeoutMs: 30_000,
  };
}

async function completedEnvelope(
  submission: ModelicaResumableSubmission,
  manifest: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const requestSha256 = await fingerprintModelicaResumableProviderJson(
    lowerSubmission(submission),
  );
  const runId = "run_12345678-1234-4234-8234-123456789abc";
  return {
    schemaVersion: "2.1",
    kind: "simulation-request",
    request: {
      request_id: submission.requestId,
      request_sha256: requestSha256,
      manifest_sha256: submission.manifest.fingerprint,
      status: "completed",
      run: {
        schemaVersion: "2.1",
        kind: "simulation-run",
        request_id: submission.requestId,
        request_sha256: requestSha256,
        manifest,
        run_id: runId,
        status: "succeeded",
        started_at: "2026-08-12T00:00:00.000Z",
        completed_at: "2026-08-12T00:00:01.000Z",
        resolved_parameters: { power: { value: 250, unit: "W" } },
        metrics: { temperature: { value: 91, unit: "degC" } },
        artifacts: [
          {
            kind: "request",
            file_name: "request.json",
            uri: "casys://modelica/requests/request.modelica.1/request.json",
            mediaType: "application/json",
            sha256: "d".repeat(64),
            bytes: 10,
          },
          runArtifact(
            submission.requestId,
            runId,
            "resolved_parameters",
            "resolved-parameters.json",
            "application/json",
            "c",
          ),
          {
            ...runArtifact(
              submission.requestId,
              runId,
              "model",
              "ThermalKit.mo",
              "text/x-modelica",
              "a",
              1,
            ),
            qualification: "qualified-kit",
            source_resource: (manifest.model as { source: unknown }).source,
          },
          {
            ...runArtifact(
              submission.requestId,
              runId,
              "scenario",
              "scenario.json",
              "application/json",
              "b",
              1,
            ),
            qualification: "qualified-kit",
            source_resource: (manifest.scenario as { source: unknown }).source,
          },
          runArtifact(
            submission.requestId,
            runId,
            "script",
            "run.mos",
            "text/plain",
            "4",
          ),
          runArtifact(
            submission.requestId,
            runId,
            "diagnostics",
            "omc.log",
            "text/plain",
            "5",
          ),
          runArtifact(
            submission.requestId,
            runId,
            "result",
            "result.csv",
            "text/csv",
            "6",
          ),
          {
            ...runArtifact(
              submission.requestId,
              runId,
              "evidence",
              "evidence.json",
              "application/json",
              "e",
              20,
            ),
          },
        ],
        warnings: [],
        run_json: {
          uri: "casys://modelica/requests/request.modelica.1/run.json",
          mediaType: "application/json",
          sha256: "f".repeat(64),
          bytes: 30,
        },
      },
    },
  };
}

function runArtifact(
  requestId: string,
  runId: string,
  kind: string,
  fileName: string,
  mediaType: string,
  digestPrefix: string,
  bytes = 10,
) {
  return {
    kind,
    file_name: fileName,
    run_id: runId,
    uri: `casys://modelica/requests/${requestId}/artifacts/${fileName}`,
    mediaType,
    sha256: digestPrefix.repeat(64),
    bytes,
  };
}

function resource(uri: string, mediaType: string, digestPrefix: string) {
  return {
    uri,
    mediaType,
    bytes: 1,
    sha256: digestPrefix.repeat(64),
    qualification: "qualified-kit",
  };
}
