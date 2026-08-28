import { assertEquals, assertRejects } from "@std/assert";
import type { JsonValue } from "../../../domain/compile/rop/resolved-operation-plan.ts";
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
const REQUEST_SHA256 = "b".repeat(64);
const MANIFEST_FINGERPRINT = { algorithm: "sha256" as const, digest: "c".repeat(64) };
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
  const resources = resourcesFor({
    stepSha256,
    stepBytes: step.byteLength,
    resultSha256,
    resultBytes: resultBytes.byteLength,
  });
  const provider = new FixtureProvider({ resources });
  const solver = solverFor(provider, resultBytes, resultSha256);

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
  const dispatch = await solver.dispatch(plan);
  assertEquals(provider.recordedCalls.length, 1);
  assertEquals(provider.recordedCalls[0]?.request_id, plan.requestId);
  assertEquals(dispatch, {
    requestId: plan.requestId,
    runId: RUN_ID,
    requestSha256: REQUEST_SHA256,
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
    resultSha256,
    resultBytes: resultBytes.byteLength,
  });
  const provider = new FixtureProvider({
    resources,
    listedResources: [...resources].reverse(),
  });
  const solver = solverFor(provider, resultBytes, resultSha256);
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
  resultBytes: Uint8Array,
  resultSha256: string,
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
          fingerprint.digest === resultSha256 ? immutableBytes(resultBytes) : undefined,
        ),
    },
  });
}

class FixtureProvider implements RecordedCalculixSensitivityProvider {
  readonly recordedCalls: Readonly<Record<string, JsonValue>>[] = [];
  readonly #resources: readonly SensitivityRecordedProviderResource[];
  readonly #listedResources: readonly SensitivityRecordedProviderResource[];

  constructor(input: {
    readonly resources: readonly SensitivityRecordedProviderResource[];
    readonly listedResources?: readonly SensitivityRecordedProviderResource[];
  }) {
    this.#resources = input.resources;
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
      requestSha256: REQUEST_SHA256,
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
      : role === "result.json"
      ? input.resultBytes
      : 0,
    sha256: role === "input.step"
      ? input.stepSha256
      : role === "result.json"
      ? input.resultSha256
      : `${index}`.repeat(64),
  }));
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
