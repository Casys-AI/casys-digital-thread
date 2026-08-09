import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  assertSimulateMatchesRunGet,
  buildExecutionReceiptEnvelope,
  buildProviderRunRecordEnvelope,
  canonicalizeSimulateEnvelope,
  MODELICA_SCENARIO_EXECUTION_RECEIPT_SCHEMA,
  MODELICA_SCENARIO_RUN_CAPTURE_SCHEMA,
  ModelicaScenarioRunCaptureError,
  parseModelicaRunRecord,
  parseSimulateEnvelopeMinimal,
  type SimulationCaseIdentity,
} from "./modelica-scenario-run-capture.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CASE: SimulationCaseIdentity = {
  expectedMetrics: [
    { id: "temperature_max", unit: "degC" },
    { id: "time_to_steady", unit: "s" },
  ],
  kit: {
    modelId: "test-model-v1",
    modelSha256: "a".repeat(64),
    modelVersion: "1.0.0",
  },
  parameters: [
    { id: "param_a", unit: "K", value: 10 },
    { id: "param_b", unit: "kg", value: 0.5 },
  ],
  scenario: { id: "nominal-scenario", sha256: "b".repeat(64) },
};

const RUN_ID = "run_test-00000000-0000-4000-8000-000000000001";
const ROOT = `casys://modelica/runs/${RUN_ID}`;

/** Build a valid provider run object matching CASE. Caller may mutate the result. */
function providerRun(): Record<string, unknown> {
  return {
    artifacts: [
      {
        bytes: 1024,
        kind: "model",
        sha256: "a".repeat(64),
        uri: `${ROOT}/model.mo`,
      },
      {
        bytes: 2048,
        kind: "result",
        sha256: "d".repeat(64),
        uri: `${ROOT}/result.csv`,
      },
      {
        bytes: 512,
        kind: "evidence",
        sha256: "e".repeat(64),
        uri: `${ROOT}/evidence.json`,
      },
    ],
    completed_at: "2026-08-10T10:00:05.000Z",
    engine: { msl_version: "4.1.0", name: "OpenModelica", version: "1.27.0" },
    fingerprint: "c".repeat(64),
    metrics: {
      temperature_max: { unit: "degC", value: 85.3 },
      time_to_steady: { unit: "s", value: 42.0 },
    },
    model: {
      id: "test-model-v1",
      sha256: "a".repeat(64),
      version: "1.0.0",
    },
    resolved_parameters: {
      param_a: { unit: "K", value: 10 },
      param_b: { unit: "kg", value: 0.5 },
    },
    run_id: RUN_ID,
    scenario: { id: "nominal-scenario", sha256: "b".repeat(64) },
    started_at: "2026-08-10T10:00:00.000Z",
    status: "succeeded",
    warnings: [],
  };
}

/** Wrap a provider run in the envelope schema. */
function envelope(run: Record<string, unknown>): Record<string, unknown> {
  return { kind: "run", run, schemaVersion: "1.0" };
}

// ── parseSimulateEnvelopeMinimal ─────────────────────────────────────────────

Deno.test(
  "parseSimulateEnvelopeMinimal extracts the four WAL-transition fields and ignores extras",
  () => {
    const input = {
      kind: "run",
      run: { extra: "ignored", run_id: RUN_ID, status: "succeeded" },
      schemaVersion: "1.0",
      someExtraField: "value",
    };
    const minimal = parseSimulateEnvelopeMinimal(input);
    assertEquals(minimal.schemaVersion, "1.0");
    assertEquals(minimal.kind, "run");
    assertEquals(minimal.runId, RUN_ID);
    assertEquals(minimal.status, "succeeded");
  },
);

Deno.test(
  "parseSimulateEnvelopeMinimal fails closed when run_id is missing",
  () => {
    const input = { kind: "run", run: { status: "succeeded" }, schemaVersion: "1.0" };
    assertThrows(
      () => parseSimulateEnvelopeMinimal(input),
      ModelicaScenarioRunCaptureError,
      "modelica_simulate.run.run_id",
    );
  },
);

Deno.test(
  "parseSimulateEnvelopeMinimal fails closed when status is absent",
  () => {
    const input = {
      kind: "run",
      run: { run_id: RUN_ID },
      schemaVersion: "1.0",
    };
    assertThrows(
      () => parseSimulateEnvelopeMinimal(input),
      ModelicaScenarioRunCaptureError,
      "modelica_simulate.run.status",
    );
  },
);

Deno.test(
  "parseSimulateEnvelopeMinimal does not enforce status value — executor owns that check",
  () => {
    const input = {
      kind: "run",
      run: { run_id: RUN_ID, status: "failed" },
      schemaVersion: "1.0",
    };
    // No throw — status validation is the executor's responsibility.
    const minimal = parseSimulateEnvelopeMinimal(input);
    assertEquals(minimal.status, "failed");
  },
);

// ── canonicalizeSimulateEnvelope ─────────────────────────────────────────────

Deno.test(
  "canonicalizeSimulateEnvelope produces the deterministicJson of the full raw envelope",
  () => {
    const raw = envelope(providerRun());
    assertEquals(canonicalizeSimulateEnvelope(raw), deterministicJson(raw));
  },
);

Deno.test(
  "canonicalizeSimulateEnvelope normalizes key order deterministically",
  () => {
    const runA = envelope({ kind: "run", run: { b: 2, a: 1 }, schemaVersion: "1.0" });
    const runB = envelope({ kind: "run", run: { a: 1, b: 2 }, schemaVersion: "1.0" });
    assertEquals(
      canonicalizeSimulateEnvelope(runA),
      canonicalizeSimulateEnvelope(runB),
    );
  },
);

// ── parseModelicaRunRecord — happy path ──────────────────────────────────────

Deno.test(
  "parseModelicaRunRecord accepts a fully valid run and surfaces all expected fields",
  () => {
    const raw = envelope(providerRun());
    const parsed = parseModelicaRunRecord(raw, CASE);

    assertEquals(parsed.runId, RUN_ID);
    assertEquals(parsed.startedAt, "2026-08-10T10:00:00.000Z");
    assertEquals(parsed.completedAt, "2026-08-10T10:00:05.000Z");
    assertEquals(parsed.fingerprint, { algorithm: "sha256", digest: "c".repeat(64) });
    assertEquals(parsed.model, {
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      id: "test-model-v1",
      version: "1.0.0",
    });
    assertEquals(parsed.scenario, {
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      id: "nominal-scenario",
    });
    assertEquals(parsed.engine, {
      mslVersion: "4.1.0",
      name: "OpenModelica",
      version: "1.27.0",
    });
    assertEquals(parsed.resolvedParameters, [
      { id: "param_a", unit: "K", value: 10 },
      { id: "param_b", unit: "kg", value: 0.5 },
    ]);
    assertEquals(
      parsed.metrics.map(({ id, unit }) => ({ id, unit })),
      [
        { id: "temperature_max", unit: "degC" },
        { id: "time_to_steady", unit: "s" },
      ],
    );
    assertEquals(parsed.warnings, []);
    assertEquals(parsed.canonicalEnvelopeText, deterministicJson(raw));
  },
);

Deno.test(
  "parseModelicaRunRecord result is deeply frozen",
  () => {
    const parsed = parseModelicaRunRecord(envelope(providerRun()), CASE);
    assertEquals(Object.isFrozen(parsed), true);
    assertEquals(Object.isFrozen(parsed.model), true);
    assertEquals(Object.isFrozen(parsed.artifacts), true);
    assertEquals(Object.isFrozen(parsed.artifacts[0]), true);
  },
);

// ── parseModelicaRunRecord — anti-verdict lock ────────────────────────────────

Deno.test(
  'parseModelicaRunRecord rejects "verdict" artifact kind with a hard error',
  () => {
    const run = providerRun();
    (run.artifacts as Array<Record<string, unknown>>).push({
      bytes: 64,
      kind: "verdict",
      sha256: "f".repeat(64),
      uri: `${ROOT}/verdict.json`,
    });
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      '"verdict" is not permitted',
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects an unknown artifact kind",
  () => {
    const run = providerRun();
    (run.artifacts as Array<Record<string, unknown>>).push({
      bytes: 100,
      kind: "summary",
      sha256: "f".repeat(64),
      uri: `${ROOT}/summary.json`,
    });
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      '"summary" is not a known Modelica artifact kind',
    );
  },
);

// ── parseModelicaRunRecord — artifact uniqueness ──────────────────────────────

Deno.test(
  "parseModelicaRunRecord rejects duplicate artifact kinds",
  () => {
    const run = providerRun();
    (run.artifacts as Array<Record<string, unknown>>).push({
      bytes: 512,
      kind: "evidence",
      sha256: "9".repeat(64),
      uri: `${ROOT}/evidence2.json`,
    });
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "kinds must each appear at most once",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects duplicate artifact URIs",
  () => {
    const run = providerRun();
    (run.artifacts as Array<Record<string, unknown>>).push({
      bytes: 100,
      kind: "script",
      sha256: "9".repeat(64),
      uri: `${ROOT}/evidence.json`, // same URI as evidence artifact
    });
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "URIs must each appear at most once",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a ledger missing the required model artifact",
  () => {
    const run = providerRun();
    run.artifacts = (run.artifacts as Array<Record<string, unknown>>).filter(
      (a) => a.kind !== "model",
    );
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      'exactly one "model" artifact',
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a ledger missing the required result artifact",
  () => {
    const run = providerRun();
    run.artifacts = (run.artifacts as Array<Record<string, unknown>>).filter(
      (a) => a.kind !== "result",
    );
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      'exactly one "result" artifact',
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a ledger missing the required evidence artifact",
  () => {
    const run = providerRun();
    run.artifacts = (run.artifacts as Array<Record<string, unknown>>).filter(
      (a) => a.kind !== "evidence",
    );
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      'exactly one "evidence" artifact',
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a model artifact whose SHA-256 does not match the case",
  () => {
    const run = providerRun();
    (run.artifacts as Array<Record<string, unknown>>)[0].sha256 = "f".repeat(64);
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "model artifact SHA-256 does not match the simulation case",
    );
  },
);

// ── parseModelicaRunRecord — requireCaseIdentity ─────────────────────────────

Deno.test(
  "parseModelicaRunRecord rejects a run whose model.id does not match the case",
  () => {
    const run = providerRun();
    (run.model as Record<string, unknown>).id = "other-model-v2";
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.model.id",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a run whose model.version does not match the case",
  () => {
    const run = providerRun();
    (run.model as Record<string, unknown>).version = "2.0.0";
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.model.version",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a run whose model.sha256 does not match the case",
  () => {
    const run = providerRun();
    (run.model as Record<string, unknown>).sha256 = "f".repeat(64);
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.model.sha256",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a run whose scenario.id does not match the case",
  () => {
    const run = providerRun();
    (run.scenario as Record<string, unknown>).id = "different-scenario";
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.scenario.id",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a run whose scenario.sha256 does not match the case",
  () => {
    const run = providerRun();
    (run.scenario as Record<string, unknown>).sha256 = "f".repeat(64);
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.scenario.sha256",
    );
  },
);

// ── parseModelicaRunRecord — parameter exactness ──────────────────────────────

Deno.test(
  "parseModelicaRunRecord rejects resolved_parameters with a surplus id",
  () => {
    const run = providerRun();
    (run.resolved_parameters as Record<string, unknown>).param_c = {
      unit: "m",
      value: 1,
    };
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "exactly the simulation case parameter ids",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects resolved_parameters with a missing case id",
  () => {
    const run = providerRun();
    const params = run.resolved_parameters as Record<string, unknown>;
    delete params.param_b;
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "exactly the simulation case parameter ids",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects resolved_parameters with a divergent value",
  () => {
    const run = providerRun();
    (run.resolved_parameters as Record<string, unknown>).param_a = {
      unit: "K",
      value: 999,
    };
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "param_a.value",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects resolved_parameters with a divergent unit",
  () => {
    const run = providerRun();
    (run.resolved_parameters as Record<string, unknown>).param_b = {
      unit: "g",
      value: 0.5,
    };
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "param_b.unit",
    );
  },
);

// ── parseModelicaRunRecord — metric presence ──────────────────────────────────

Deno.test(
  "parseModelicaRunRecord rejects a run missing an expected metric",
  () => {
    const run = providerRun();
    delete (run.metrics as Record<string, unknown>).time_to_steady;
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      '"time_to_steady"',
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects an expected metric with the wrong unit",
  () => {
    const run = providerRun();
    (run.metrics as Record<string, unknown>).temperature_max = {
      unit: "K",
      value: 358.45,
    };
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "temperature_max.unit",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord conserves surplus metrics beyond the expected set",
  () => {
    const run = providerRun();
    (run.metrics as Record<string, unknown>).heater_energy = {
      unit: "J",
      value: 45000,
    };
    const parsed = parseModelicaRunRecord(envelope(run), CASE);
    const ids = parsed.metrics.map((m) => m.id);
    assertEquals(ids.includes("heater_energy"), true);
    assertEquals(ids.includes("temperature_max"), true);
  },
);

// ── parseModelicaRunRecord — status check ────────────────────────────────────

Deno.test(
  "parseModelicaRunRecord rejects a run with status failed",
  () => {
    const run = providerRun();
    run.status = "failed";
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.status",
    );
  },
);

Deno.test(
  "parseModelicaRunRecord rejects a run with status timed_out",
  () => {
    const run = providerRun();
    run.status = "timed_out";
    assertThrows(
      () => parseModelicaRunRecord(envelope(run), CASE),
      ModelicaScenarioRunCaptureError,
      "run_get.run.status",
    );
  },
);

// ── assertSimulateMatchesRunGet — double attestation ─────────────────────────

Deno.test(
  "assertSimulateMatchesRunGet succeeds when simulate and run_get return the same envelope",
  () => {
    const raw = envelope(providerRun());
    const parsed = parseModelicaRunRecord(raw, CASE);
    // Same envelope text as what would have been stored by canonicalizeSimulateEnvelope.
    const simulateCanonical = canonicalizeSimulateEnvelope(raw);
    // No throw expected.
    assertSimulateMatchesRunGet(simulateCanonical, parsed);
  },
);

Deno.test(
  "assertSimulateMatchesRunGet rejects when the persisted run diverges from the simulate response",
  () => {
    const simulateRaw = envelope(providerRun());
    const simulateCanonical = canonicalizeSimulateEnvelope(simulateRaw);

    // run_get returns a run with a modified metric — the provider mutated data.
    const runGetRaw = envelope(providerRun());
    (
      (runGetRaw.run as Record<string, unknown>).metrics as Record<
        string,
        unknown
      >
    ).temperature_max = { unit: "degC", value: 99.9 };
    const runGetParsed = parseModelicaRunRecord(runGetRaw, CASE);

    assertThrows(
      () => assertSimulateMatchesRunGet(simulateCanonical, runGetParsed),
      ModelicaScenarioRunCaptureError,
      "does not exactly match",
    );
  },
);

// ── buildProviderRunRecordEnvelope ────────────────────────────────────────────

Deno.test(
  "buildProviderRunRecordEnvelope produces modelica-scenario-run-capture/1.0 with both envelopes",
  async () => {
    const raw = envelope(providerRun());
    const simulateCanonical = canonicalizeSimulateEnvelope(raw);
    const parsed = parseModelicaRunRecord(raw, CASE);
    const capturedAt = "2026-08-10T10:00:10.000Z";

    const result = await buildProviderRunRecordEnvelope(parsed, {
      canonicalSimulateEnvelopeText: simulateCanonical,
      capturedAt,
      operation: "simulate.run-modelica-scenario@1",
      trustedRunId: "outer-run-abcd1234",
    });

    assertEquals(typeof result.canonicalText, "string");
    assertEquals(/^[a-f0-9]{64}$/.test(result.fingerprintDigest), true);
    const decoded = JSON.parse(result.canonicalText);
    assertEquals(decoded.schemaVersion, MODELICA_SCENARIO_RUN_CAPTURE_SCHEMA);
    assertEquals(decoded.producer, "modelica");
    assertEquals(decoded.operation, "simulate.run-modelica-scenario@1");
    assertEquals(decoded.capturedAt, capturedAt);
    assertEquals(decoded.canonicalSimulateEnvelope, simulateCanonical);
    assertEquals(decoded.canonicalRunGetEnvelope, parsed.canonicalEnvelopeText);
    assertEquals(Object.isFrozen(result), true);
  },
);

// ── buildExecutionReceiptEnvelope ─────────────────────────────────────────────

Deno.test(
  "buildExecutionReceiptEnvelope produces modelica-scenario-execution-receipt/1.0",
  async () => {
    const capturedAt = "2026-08-10T10:00:10.000Z";
    const result = await buildExecutionReceiptEnvelope({
      caseArtifact: {
        fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        id: "simulation-case-artifact-id",
        producerRunId: "seal-run-id",
      },
      caseDigest: "0".repeat(64),
      capturedAt,
      exactSimulateRequest: {
        model_id: "test-model-v1",
        scenario_id: "nominal-scenario",
      },
      policyVersion: "v1.0",
      providerRunId: RUN_ID,
    });

    assertEquals(typeof result.canonicalText, "string");
    assertEquals(/^[a-f0-9]{64}$/.test(result.fingerprintDigest), true);
    const decoded = JSON.parse(result.canonicalText);
    assertEquals(
      decoded.schemaVersion,
      MODELICA_SCENARIO_EXECUTION_RECEIPT_SCHEMA,
    );
    assertEquals(decoded.producer, "digital-thread");
    assertEquals(decoded.providerRunId, RUN_ID);
    assertEquals(decoded.caseDigest, "0".repeat(64));
    assertEquals(decoded.capturedAt, capturedAt);
    assertEquals(Object.isFrozen(result), true);
  },
);

// ── Two distinct CAS objects ──────────────────────────────────────────────────

Deno.test(
  "providerRunRecord and executionReceipt have distinct canonical texts and fingerprints",
  async () => {
    const raw = envelope(providerRun());
    const simulateCanonical = canonicalizeSimulateEnvelope(raw);
    const parsed = parseModelicaRunRecord(raw, CASE);
    const capturedAt = "2026-08-10T10:00:10.000Z";

    const record = await buildProviderRunRecordEnvelope(parsed, {
      canonicalSimulateEnvelopeText: simulateCanonical,
      capturedAt,
      operation: "simulate.run-modelica-scenario@1",
      trustedRunId: "outer-run-abcd1234",
    });
    const receipt = await buildExecutionReceiptEnvelope({
      caseArtifact: {
        fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        id: "simulation-case-artifact-id",
        producerRunId: "seal-run-id",
      },
      caseDigest: "0".repeat(64),
      capturedAt,
      exactSimulateRequest: {
        model_id: "test-model-v1",
        scenario_id: "nominal-scenario",
      },
      policyVersion: "v1.0",
      providerRunId: RUN_ID,
    });

    // Different canonical texts — distinct CAS objects, not aliased.
    assertEquals(record.canonicalText !== receipt.canonicalText, true);
    // Different fingerprint digests — content-addressed identity is separate.
    assertEquals(record.fingerprintDigest !== receipt.fingerprintDigest, true);
    // Schema versions encode which family each object belongs to.
    assertEquals(
      JSON.parse(record.canonicalText).schemaVersion,
      MODELICA_SCENARIO_RUN_CAPTURE_SCHEMA,
    );
    assertEquals(
      JSON.parse(receipt.canonicalText).schemaVersion,
      MODELICA_SCENARIO_EXECUTION_RECEIPT_SCHEMA,
    );
  },
);

// ── Optional artifact surplus ─────────────────────────────────────────────────

Deno.test(
  "parseModelicaRunRecord accepts optional surplus artifacts within the allowed kinds",
  () => {
    const run = providerRun();
    (run.artifacts as Array<Record<string, unknown>>).push(
      {
        bytes: 200,
        kind: "request",
        sha256: "8".repeat(64),
        uri: `${ROOT}/request.json`,
      },
      {
        bytes: 300,
        kind: "script",
        sha256: "9".repeat(64),
        uri: `${ROOT}/run.mos`,
      },
    );
    const parsed = parseModelicaRunRecord(envelope(run), CASE);
    assertEquals(parsed.artifacts.length, 5);
  },
);

// ── assertRejects with async variant check ────────────────────────────────────

Deno.test(
  "buildProviderRunRecordEnvelope rejects a non-ISO-8601 capturedAt",
  async () => {
    const raw = envelope(providerRun());
    const parsed = parseModelicaRunRecord(raw, CASE);
    await assertRejects(
      () =>
        buildProviderRunRecordEnvelope(parsed, {
          canonicalSimulateEnvelopeText: canonicalizeSimulateEnvelope(raw),
          capturedAt: "not-a-date",
          operation: "simulate.run-modelica-scenario@1",
          trustedRunId: "outer-run-id",
        }),
      ModelicaScenarioRunCaptureError,
      "capturedAt must be ISO-8601",
    );
  },
);

Deno.test(
  "buildExecutionReceiptEnvelope rejects a malformed caseDigest",
  async () => {
    await assertRejects(
      () =>
        buildExecutionReceiptEnvelope({
          caseArtifact: {
            fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
            id: "some-id",
            producerRunId: "run-id",
          },
          caseDigest: "not-hex-64",
          capturedAt: "2026-08-10T10:00:10.000Z",
          exactSimulateRequest: {},
          policyVersion: "v1.0",
          providerRunId: RUN_ID,
        }),
      ModelicaScenarioRunCaptureError,
      "caseDigest must be a lowercase hex-64",
    );
  },
);
