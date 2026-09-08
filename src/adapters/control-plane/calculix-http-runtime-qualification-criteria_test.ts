import { assertRejects } from "@std/assert";
import {
  assertCalculixHttpQualificationEvidence,
} from "./calculix-http-runtime-qualification-criteria.ts";
import {
  createFirstPartyCalculixHttpRuntimeQualificationCandidates,
} from "./first-party-calculix-http-runtime-qualification-candidates.ts";
import {
  lowerRecordedCalculixStaticRequest,
} from "../sensitivity/live-fea/mcp-calculix-sensitivity-solver.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";

const RUN_ID = "r-11111111-1111-1111-1111-111111111111";

Deno.test("CalculiX HTTP qualification criteria accept only a completed exact recorded solve/readback", async () => {
  const [candidate] =
    await createFirstPartyCalculixHttpRuntimeQualificationCandidates();
  if (!candidate) throw new Error("candidate absent");
  await assertCalculixHttpQualificationEvidence(candidate, await evidence(candidate));
});

Deno.test("CalculiX HTTP qualification criteria fail closed on status, request bytes, units, bounds, and ledger order", async () => {
  const [candidate] =
    await createFirstPartyCalculixHttpRuntimeQualificationCandidates();
  if (!candidate) throw new Error("candidate absent");
  const passing = await evidence(candidate);
  const variants = [
    {
      ...passing,
      recordedReadback: {
        ...(passing.recordedReadback as Record<string, unknown>),
        status: "dispatched",
      },
    },
    { ...passing, requestJsonBytes: new TextEncoder().encode("{}") },
    await evidence(candidate, { displacementUnit: "m" }),
    await evidence(candidate, { displacement: 51 }),
    { ...passing, recordedReadback: reorderedReadback(passing.recordedReadback) },
  ];
  for (const value of variants) {
    await assertRejects(
      () => assertCalculixHttpQualificationEvidence(candidate, value),
      TypeError,
    );
  }
});

async function evidence(
  candidate: Awaited<
    ReturnType<typeof createFirstPartyCalculixHttpRuntimeQualificationCandidates>
  >[number],
  override: { readonly displacement?: number; readonly displacementUnit?: string } = {},
) {
  const request = lowerRecordedCalculixStaticRequest({
    requestId: candidate.fixture.case.requestId,
    stepSha256: candidate.fixture.step.sha256,
    stagedPath: `/inputs/fea-${candidate.fixture.step.sha256}.step`,
    method: candidate.fixture.method,
  });
  const requestJsonBytes = new TextEncoder().encode(`${
    deterministicJson({
      ...request,
      execution_identity: {
        schema_version: "1.0",
        server: { package: "@casys/mcp-calculix", version: "0.8.2" },
        method: { id: "calculix_solve_static_recorded", version: "1.0" },
        lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
        engines: {
          gmsh: { command: "gmsh", version: "4.11.1" },
          ccx: { command: "ccx", version: "CalculiX 2.21" },
        },
        image: { status: "unattested" },
      },
    })
  }\n`);
  const resultJsonBytes = new TextEncoder().encode(JSON.stringify({
    schemaVersion: "2.0",
    kind: "static-solve-recorded",
    inputArtifact: {
      uri: `casys://calculix/runs/${RUN_ID}/input.step`,
      mimeType: "model/step",
      sha256: candidate.fixture.step.sha256,
      bytes: candidate.fixture.step.byteCount,
    },
    mesh: { nodes: 4, elements: 1, nodesPerSelection: {} },
    constraints: {
      fixedSelections: ["FIXED"],
      loads: [{ selection: "LOADED", forceN: [0, 0, -500] }],
    },
    metrics: {
      maxDisplacement: {
        value: override.displacement ?? 0.1,
        unit: override.displacementUnit ?? "mm",
        nodeId: 1,
        vectorMm: [0, 0, -0.1],
      },
      maxVonMises: { value: 12, unit: "MPa", elementId: 1 },
    },
  }));
  const requestSha256 = await fingerprintResourceBytes(requestJsonBytes);
  const resultSha256 = await fingerprintResourceBytes(resultJsonBytes);
  const artifacts = [
    resource(
      "input.step",
      "model/step",
      candidate.fixture.step.byteCount,
      candidate.fixture.step.sha256,
    ),
    resource(
      "request.json",
      "application/json",
      requestJsonBytes.byteLength,
      requestSha256,
    ),
    resource("mesh.geo", "text/plain", 0, "a".repeat(64)),
    resource("mesh.inp", "text/plain", 0, "b".repeat(64)),
    resource("gmsh.log", "text/plain", 0, "c".repeat(64)),
    resource("job.inp", "text/plain", 0, "d".repeat(64)),
    resource("ccx.log", "text/plain", 0, "e".repeat(64)),
    resource("job.dat", "text/plain", 0, "f".repeat(64)),
    resource(
      "result.json",
      "application/json",
      resultJsonBytes.byteLength,
      resultSha256,
    ),
  ];
  const run = {
    schemaVersion: "2.0",
    state: "completed",
    runId: RUN_ID,
    requestId: candidate.fixture.case.requestId,
    requestSha256,
    inputArtifact: {
      uri: artifacts[0]!.uri,
      mimeType: "model/step",
      sha256: candidate.fixture.step.sha256,
      bytes: candidate.fixture.step.byteCount,
    },
    createdAt: "2026-09-08T00:00:00.000Z",
    artifacts,
  };
  return {
    recordedDispatch: {
      schemaVersion: "2.0",
      kind: "static-solve-recorded",
      inputArtifact: {},
      mesh: {},
      constraints: {},
      metrics: {},
      run,
    },
    recordedReadback: {
      schemaVersion: "1.0",
      status: "completed",
      lookup: { kind: "request_id", value: candidate.fixture.case.requestId },
      requestId: candidate.fixture.case.requestId,
      runId: RUN_ID,
      run,
    },
    requestJsonBytes,
    resultJsonBytes,
  };
}

function resource(name: string, mimeType: string, bytes: number, sha256: string) {
  return {
    name,
    uri: `casys://calculix/runs/${RUN_ID}/${name}`,
    mimeType,
    bytes,
    sha256,
  };
}

function reorderedReadback(value: unknown): unknown {
  const root = structuredClone(value) as { run: { artifacts: unknown[] } };
  root.run.artifacts.reverse();
  return root;
}
