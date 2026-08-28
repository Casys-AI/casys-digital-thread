import { assertEquals, assertRejects } from "@std/assert";
import type { JsonValue } from "../../../domain/compile/rop/resolved-operation-plan.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  fingerprintResourceBytes,
  immutableBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import type { SensitivityStaticStructuralMethod } from "../../../domain/sensitivity/study/sensitivity-study.ts";
import {
  CALCULIX_RECORDED_RESOURCE_ORDER,
  McpCalculixSensitivitySolver,
  type RecordedCalculixSensitivityProvider,
} from "./mcp-calculix-sensitivity-solver.ts";
import type { SensitivityRecordedProviderResource } from "../../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import { SensitivityRecordedSolveOutcomeUnknownError } from "../../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";

const RUN_ID = "r-11111111-1111-1111-1111-111111111111";
const MANIFEST_FINGERPRINT = { algorithm: "sha256" as const, digest: "c".repeat(64) };
const EXECUTION_IDENTITY = {
  schema_version: "1.0",
  server: { package: "@casys/mcp-calculix", version: "0.8.2" },
  method: { id: "calculix_solve_static_recorded", version: "1.0" },
  lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
  engines: {
    gmsh: { command: "gmsh", version: "4.11.1" },
    ccx: { command: "ccx", version: "CalculiX 2.21" },
  },
  image: { status: "unattested" },
} as const;
const METHOD: SensitivityStaticStructuralMethod = {
  mesh: { kind: "tetrahedral-volume", targetSizeMm: 2 },
  material: {
    model: "isotropic-linear-elastic",
    eMpa: 70_000,
    nu: 0.33,
    basis: "fixture",
  },
  supports: [{
    id: "support",
    kind: "fixed",
    selection: {
      name: "fixed-base",
      box: { min: [0, 0, 0], max: [1, 1, 1], unit: "mm" },
    },
  }],
  loads: [{
    id: "load",
    kind: "force",
    selection: {
      name: "loaded-tip",
      box: { min: [9, 0, 0], max: [10, 1, 1], unit: "mm" },
    },
    force: { value: [0, 0, -10], unit: "N" },
  }],
};

Deno.test("recorded CalculiX sensitivity uses one stable request and preserves ordered nine-resource proof", async () => {
  const step = new TextEncoder().encode("ISO-10303-21;END-ISO-10303-21;");
  const stepSha256 = await fingerprintResourceBytes(step);
  const result = resultJson(stepSha256, step.byteLength);
  const resultBytes = new TextEncoder().encode(JSON.stringify(result));
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  const provider = new FixtureProvider();
  const captured = new Map<string, Uint8Array>();
  const solver = solverFor(provider, captured);

  const plan = await solver.resolve({
    method: METHOD,
    inputArtifact: {
      fingerprint: { algorithm: "sha256", digest: stepSha256 },
      byteCount: step.byteLength,
      stagedAsset: { location: `/inputs/fea-${stepSha256}.step` },
    },
    execution: {
      projectId: "project",
      runId: "run",
      phase: "base",
      planDigest: "d".repeat(64),
    },
  });
  assertEquals(plan.requestId.length, 64);
  assertEquals(plan.exactRequest.element_order, 2);
  assertEquals(plan.exactRequest.timeout_ms, 120_000);
  const requestBytes = effectiveRequestBytes(plan);
  const requestSha256 = await fingerprintResourceBytes(requestBytes);
  const resources = resourcesFor({
    stepSha256,
    stepBytes: step.byteLength,
    requestSha256,
    requestBytes: requestBytes.byteLength,
    resultSha256,
    resultBytes: resultBytes.byteLength,
  });
  provider.setCompletedRun({ resources, requestSha256 });
  captured.set(requestSha256, requestBytes);
  captured.set(resultSha256, resultBytes);
  const dispatch = await solver.dispatch(plan);
  assertEquals(provider.recordedCalls.length, 1);
  assertEquals(provider.recordedCalls[0]?.request_id, plan.requestId);
  assertEquals(dispatch, {
    requestId: plan.requestId,
    runId: RUN_ID,
    requestSha256,
  });

  const readback = await solver.readback(plan, dispatch);
  assertEquals(readback.resources.map((resource) => resource.role), [
    ...CALCULIX_RECORDED_RESOURCE_ORDER,
  ]);
  const capture = await solver.capture(readback, METHOD);
  assertEquals(capture.readback.requestId, plan.requestId);
  assertEquals(capture.result.observations.maximumDisplacement.magnitude.unit, "mm");
  assertEquals(capture.result.observations.maximumVonMisesStress.magnitude.unit, "MPa");
  assertEquals(capture.providerCapture.manifestFingerprint, MANIFEST_FINGERPRINT);
  assertEquals(
    capture.providerCapture.requestBinding.requestResourceFingerprint.digest,
    requestSha256,
  );
  assertEquals(
    (
      await solver.reopenCapture(capture.canonicalText)
    ).providerCapture.requestBinding.loweredRequestFingerprint,
    capture.providerCapture.requestBinding.loweredRequestFingerprint,
  );
});

Deno.test("recorded CalculiX sensitivity rejects a run ledger whose request.json digest differs from requestSha256", async () => {
  const stepSha256 = "a".repeat(64);
  const resultBytes = new TextEncoder().encode(
    JSON.stringify(resultJson(stepSha256, 8)),
  );
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  const provider = new FixtureProvider();
  const solver = solverFor(provider, new Map([[resultSha256, resultBytes]]));
  const resources = resourcesFor({
    stepSha256,
    stepBytes: 8,
    requestSha256: "b".repeat(64),
    requestBytes: 16,
    resultSha256,
    resultBytes: resultBytes.byteLength,
  });
  provider.setCompletedRun({ resources, requestSha256: "c".repeat(64) });
  const plan = await solver.resolve({
    method: METHOD,
    inputArtifact: {
      fingerprint: { algorithm: "sha256", digest: stepSha256 },
      byteCount: 8,
      stagedAsset: { location: `/inputs/fea-${stepSha256}.step` },
    },
    execution: {
      projectId: "project",
      runId: "run",
      phase: "base",
      planDigest: "d".repeat(64),
    },
  });

  await assertRejects(
    () => solver.dispatch(plan),
    SensitivityRecordedSolveOutcomeUnknownError,
    "requestSha256 does not match",
  );
  assertEquals(provider.recordedCalls.length, 1);
});

Deno.test("recorded CalculiX sensitivity rejects an effective request that diverges from the server-lowered method without redispatch", async () => {
  const step = new TextEncoder().encode("ISO-10303-21;END-ISO-10303-21;");
  const stepSha256 = await fingerprintResourceBytes(step);
  const result = resultJson(stepSha256, step.byteLength);
  const resultBytes = new TextEncoder().encode(JSON.stringify(result));
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  const provider = new FixtureProvider();
  const captured = new Map<string, Uint8Array>();
  const solver = solverFor(provider, captured);
  const plan = await solver.resolve({
    method: METHOD,
    inputArtifact: {
      fingerprint: { algorithm: "sha256", digest: stepSha256 },
      byteCount: step.byteLength,
      stagedAsset: { location: `/inputs/fea-${stepSha256}.step` },
    },
    execution: {
      projectId: "project",
      runId: "run",
      phase: "base",
      planDigest: "d".repeat(64),
    },
  });
  const requestBytes = effectiveRequestBytes(plan, {
    material: { e_mpa: 70_001, nu: 0.33 },
  });
  const requestSha256 = await fingerprintResourceBytes(requestBytes);
  const resources = resourcesFor({
    stepSha256,
    stepBytes: step.byteLength,
    requestSha256,
    requestBytes: requestBytes.byteLength,
    resultSha256,
    resultBytes: resultBytes.byteLength,
  });
  provider.setCompletedRun({ resources, requestSha256 });
  captured.set(requestSha256, requestBytes);
  captured.set(resultSha256, resultBytes);

  const dispatch = await solver.dispatch(plan);
  const readback = await solver.readback(plan, dispatch);
  await assertRejects(
    () => solver.capture(readback, METHOD),
    SensitivityRecordedSolveOutcomeUnknownError,
    "differs from the server-lowered request",
  );
  assertEquals(provider.recordedCalls.length, 1);
});

Deno.test("recorded CalculiX sensitivity accepts only the exact private input destination", async () => {
  const solver = solverFor(new FixtureProvider(), new Map());
  const stepSha256 = "a".repeat(64);
  await assertRejects(
    () =>
      solver.resolve({
        method: METHOD,
        inputArtifact: {
          fingerprint: { algorithm: "sha256", digest: stepSha256 },
          byteCount: 8,
          stagedAsset: { location: `/other/fea-${stepSha256}.step` },
        },
        execution: {
          projectId: "project",
          runId: "run",
          phase: "base",
          planDigest: "d".repeat(64),
        },
      }),
    TypeError,
    "/inputs/fea-",
  );
});

Deno.test("recorded CalculiX sensitivity refuses a reordered resources/list before generic CAS capture", async () => {
  const stepSha256 = "a".repeat(64);
  const resultBytes = new TextEncoder().encode(
    JSON.stringify(resultJson(stepSha256, 8)),
  );
  const resultSha256 = await fingerprintResourceBytes(resultBytes);
  const resources = resourcesFor({
    stepSha256,
    stepBytes: 8,
    requestSha256: "b".repeat(64),
    requestBytes: 2,
    resultSha256,
    resultBytes: resultBytes.byteLength,
  });
  const provider = new FixtureProvider();
  provider.setCompletedRun({
    resources,
    requestSha256: "b".repeat(64),
    listedResources: [...resources].reverse(),
  });
  const solver = solverFor(provider, new Map([[resultSha256, resultBytes]]));
  const plan = await solver.resolve({
    method: METHOD,
    inputArtifact: {
      fingerprint: { algorithm: "sha256", digest: stepSha256 },
      byteCount: 8,
      stagedAsset: { location: `/inputs/fea-${stepSha256}.step` },
    },
    execution: {
      projectId: "project",
      runId: "run",
      phase: "base",
      planDigest: "d".repeat(64),
    },
  });
  const readback = await solver.readback(plan);
  await assertRejects(
    () => solver.capture(readback, METHOD),
    SensitivityRecordedSolveOutcomeUnknownError,
    "reordered",
  );
});

function solverFor(
  provider: FixtureProvider,
  captured: ReadonlyMap<string, Uint8Array>,
): McpCalculixSensitivitySolver {
  return new McpCalculixSensitivitySolver({
    provider,
    capture: {
      capture: () =>
        Promise.resolve({
          storedManifest: {
            fingerprint: MANIFEST_FINGERPRINT,
            uri: `casys://fixture/sha256/${MANIFEST_FINGERPRINT.digest}`,
          },
        }),
    } as never,
    artifacts: {
      read: (fingerprint) =>
        Promise.resolve(
          captured.has(fingerprint.digest)
            ? immutableBytes(captured.get(fingerprint.digest)!)
            : undefined,
        ),
    },
  });
}

class FixtureProvider implements RecordedCalculixSensitivityProvider {
  readonly recordedCalls: Readonly<Record<string, JsonValue>>[] = [];
  #resources: readonly SensitivityRecordedProviderResource[] = [];
  #listedResources: readonly SensitivityRecordedProviderResource[] = [];
  #requestSha256 = "b".repeat(64);

  setCompletedRun(input: {
    readonly resources: readonly SensitivityRecordedProviderResource[];
    readonly requestSha256: string;
    readonly listedResources?: readonly SensitivityRecordedProviderResource[];
  }): void {
    this.#resources = input.resources;
    this.#requestSha256 = input.requestSha256;
    this.#listedResources = input.listedResources ?? input.resources;
  }

  callRecorded(request: Readonly<Record<string, JsonValue>>): Promise<unknown> {
    this.recordedCalls.push(request);
    return Promise.resolve({
      schemaVersion: "2.0",
      kind: "static-solve-recorded",
      inputArtifact: {},
      mesh: {},
      constraints: {},
      metrics: {},
      run: this.#run(String(request.request_id)),
    });
  }

  getRun(requestId: string): Promise<unknown> {
    return Promise.resolve({
      schemaVersion: "1.0",
      status: "completed",
      lookup: { kind: "request_id", value: requestId },
      requestId,
      runId: RUN_ID,
      run: this.#run(requestId),
    });
  }

  listResources(): Promise<unknown> {
    return Promise.resolve({
      resources: this.#listedResources.map((resource) => ({
        uri: resource.uri,
        mimeType: resource.mediaType,
        size: resource.byteCount,
      })),
    });
  }

  #run(requestId: string) {
    const input = this.#resources[0]!;
    return {
      schemaVersion: "2.0",
      state: "completed",
      runId: RUN_ID,
      requestId,
      requestSha256: this.#requestSha256,
      inputArtifact: {
        uri: input.uri,
        mimeType: input.mediaType,
        sha256: input.sha256,
        bytes: input.byteCount,
      },
      createdAt: "2026-08-29T00:00:00.000Z",
      artifacts: this.#resources.map((resource) => ({
        name: resource.role,
        uri: resource.uri,
        mimeType: resource.mediaType,
        bytes: resource.byteCount,
        sha256: resource.sha256,
      })),
    };
  }
}

function resourcesFor(input: {
  readonly stepSha256: string;
  readonly stepBytes: number;
  readonly requestSha256: string;
  readonly requestBytes: number;
  readonly resultSha256: string;
  readonly resultBytes: number;
}): readonly SensitivityRecordedProviderResource[] {
  return CALCULIX_RECORDED_RESOURCE_ORDER.map((role, index) => ({
    role,
    uri: `casys://calculix/runs/${RUN_ID}/${role}`,
    mediaType: role === "input.step"
      ? "model/step"
      : role === "request.json" || role === "result.json"
      ? "application/json"
      : "text/plain",
    byteCount: role === "input.step"
      ? input.stepBytes
      : role === "request.json"
      ? input.requestBytes
      : role === "result.json"
      ? input.resultBytes
      : 0,
    sha256: role === "input.step"
      ? input.stepSha256
      : role === "request.json"
      ? input.requestSha256
      : role === "result.json"
      ? input.resultSha256
      : `${index}`.repeat(64),
  }));
}

function effectiveRequestBytes(
  plan: Awaited<ReturnType<McpCalculixSensitivitySolver["resolve"]>>,
  overrides: Readonly<Record<string, JsonValue>> = {},
): Uint8Array {
  return new TextEncoder().encode(
    `${
      deterministicJson({
        ...plan.exactRequest,
        ...overrides,
        execution_identity: EXECUTION_IDENTITY,
      })
    }\n`,
  );
}

function resultJson(stepSha256: string, stepBytes: number) {
  return {
    schemaVersion: "2.0",
    kind: "static-solve-recorded",
    inputArtifact: {
      uri: `casys://calculix/runs/${RUN_ID}/input.step`,
      mimeType: "model/step",
      sha256: stepSha256,
      bytes: stepBytes,
    },
    mesh: { nodes: 4, elements: 1, nodesPerSelection: {} },
    constraints: {
      fixedSelections: ["fixed-base"],
      loads: [{ selection: "loaded-tip", forceN: [0, 0, -10] }],
    },
    metrics: {
      maxDisplacement: { value: 0.1, unit: "mm", nodeId: 1, vectorMm: [0, 0, -0.1] },
      maxVonMises: { value: 12, unit: "MPa", elementId: 1 },
    },
  };
}
