import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  type MechanicalProofCase,
  validateMechanicalProofCase,
} from "../../../domain/analysis/mechanical-proof-case.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  lowerCalculixRecordedStatic,
  McpCalculixRecordedStaticAdapter,
  parseRunGetEnvelope,
  verifyCapturedCalculixRecordedEvidence,
} from "./mcp-calculix-recorded-static-adapter.ts";

const RUN_ID = "r-12345678-1234-1234-1234-123456789abc";
const REQUEST_ID = "recorded-static-test-01";
const encoder = new TextEncoder();

Deno.test("recorded CalculiX adapter owns the exact solve and readback tool calls", async () => {
  const fixture = await buildFixture();
  const calls: unknown[] = [];
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({
        structuredContent: call.name === "calculix_solve_static_recorded"
          ? fixture.solve
          : fixture.get,
        text: "",
      });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  const adapter = new McpCalculixRecordedStaticAdapter(client);
  const plan = adapter.resolve(fixture.input);
  const solved = await adapter.solve(plan);
  const recovered = await adapter.getByRequestId(REQUEST_ID);

  assertEquals(calls, [
    { name: "calculix_solve_static_recorded", arguments: plan.exactDispatchRecord },
    { name: "calculix_run_get", arguments: { request_id: REQUEST_ID } },
  ]);
  assertEquals(solved.status, "completed");
  assertEquals(solved.runId, RUN_ID);
  assertEquals(
    solved.resources.map((resource) => [resource.role, resource.mediaType]),
    [
      ["input.step", "model/step"],
      ["request.json", "application/json"],
      ["mesh.geo", "text/plain"],
      ["mesh.inp", "text/plain"],
      ["gmsh.log", "text/plain"],
      ["job.inp", "text/plain"],
      ["ccx.log", "text/plain"],
      ["job.dat", "text/plain"],
      ["result.json", "application/json"],
    ],
  );
  assertEquals(recovered.status, "completed");
  if (recovered.status === "completed") {
    assertEquals(recovered.result, undefined);
    assertEquals(recovered.resources, solved.resources);
  }
});

Deno.test("recorded CalculiX parser closes all run_get recovery states and rejects cross-identity drift", async () => {
  const fixture = await buildFixture();
  for (const status of ["dispatched", "quarantined", "evicted"] as const) {
    assertEquals(
      parseRunGetEnvelope({
        schemaVersion: "1.0",
        status,
        lookup: { kind: "request_id", value: REQUEST_ID },
        requestId: REQUEST_ID,
        runId: RUN_ID,
        reason: status === "dispatched" ? null : "native execution failed",
      }, REQUEST_ID).status,
      status,
    );
  }
  assertEquals(
    parseRunGetEnvelope({
      schemaVersion: "1.0",
      status: "outcome_unknown",
      lookup: { kind: "request_id", value: REQUEST_ID },
      requestId: REQUEST_ID,
      reason: "legacy owner",
    }, REQUEST_ID).status,
    "outcome_unknown",
  );
  assertEquals(
    parseRunGetEnvelope({
      schemaVersion: "1.0",
      status: "not_found",
      lookup: { kind: "request_id", value: REQUEST_ID },
    }, REQUEST_ID).status,
    "not_found",
  );
  assertThrows(
    () => parseRunGetEnvelope({ ...fixture.get, requestId: "other" }, REQUEST_ID),
    Error,
    "cross-attest",
  );
});

Deno.test("recorded CalculiX evidence cross-attests raw request hash, execution identity and result", async () => {
  const fixture = await buildFixture();
  const plan = lowerCalculixRecordedStatic(fixture.input);
  const client: McpToolClient = {
    callTool: () => Promise.resolve({ structuredContent: fixture.solve, text: "" }),
    callToolTextResult: () => Promise.reject(new Error("unused")),
  };
  const adapter = new McpCalculixRecordedStaticAdapter(client);
  const boundPlan = adapter.resolve(fixture.input);
  const completed = await adapter.solve(boundPlan);
  const evidence = await verifyCapturedCalculixRecordedEvidence(
    plan,
    completed,
    fixture.captured,
  );

  assertEquals(evidence.executionIdentity.server.version, "0.7.0");
  assertEquals(evidence.executionIdentity.engines.ccx.version, "CalculiX 2.21");
  assertEquals(evidence.result, completed.result);
  await assertRejects(
    () =>
      verifyCapturedCalculixRecordedEvidence(
        plan,
        completed,
        fixture.captured.map((resource) =>
          resource.role === "request.json"
            ? { ...resource, bytes: encoder.encode("{}") }
            : resource
        ),
      ),
    TypeError,
    "SHA-256",
  );
});

Deno.test("recorded CalculiX ACK binds run requestSha256 to its request.json artifact before capture", async () => {
  const fixture = await buildFixture();
  const client: McpToolClient = {
    callTool: () =>
      Promise.resolve({
        structuredContent: {
          ...fixture.solve,
          run: { ...fixture.solve.run, requestSha256: "f".repeat(64) },
        },
        text: "",
      }),
    callToolTextResult: () => Promise.reject(new Error("unused")),
  };
  const adapter = new McpCalculixRecordedStaticAdapter(client);

  await assertRejects(
    () => adapter.solve(adapter.resolve(fixture.input)),
    Error,
    "requestSha256 does not match the acknowledged request.json artifact tuple",
  );
});

Deno.test("recorded CalculiX evidence requires the provider-canonical request bytes after observing execution identity", async () => {
  const fixture = await buildFixture();
  const adapter = new McpCalculixRecordedStaticAdapter({
    callTool: () => Promise.resolve({ structuredContent: fixture.solve, text: "" }),
    callToolTextResult: () => Promise.reject(new Error("unused")),
  });
  const plan = adapter.resolve(fixture.input);
  const completed = await adapter.solve(plan);
  const parsedRequest = JSON.parse(
    new TextDecoder().decode(
      fixture.captured.find((resource) => resource.role === "request.json")!.bytes,
    ),
  );
  const nonCanonicalBytes = encoder.encode(
    `${JSON.stringify(parsedRequest, null, 2)}\n`,
  );
  const nonCanonicalSha256 = await sha(nonCanonicalBytes);
  const forgedCompleted = {
    ...completed,
    requestSha256: nonCanonicalSha256,
    resources: completed.resources.map((resource) =>
      resource.role === "request.json"
        ? {
          ...resource,
          byteCount: nonCanonicalBytes.byteLength,
          sha256: nonCanonicalSha256,
        }
        : resource
    ),
  };

  await assertRejects(
    () =>
      verifyCapturedCalculixRecordedEvidence(
        plan,
        forgedCompleted,
        fixture.captured.map((resource) =>
          resource.role === "request.json"
            ? { ...resource, bytes: nonCanonicalBytes }
            : resource
        ),
      ),
    TypeError,
    "provider-canonical sealed request bytes",
  );
});

Deno.test("recorded CalculiX lowering rejects a caller-selected provider path and malformed ACK extras", async () => {
  const fixture = await buildFixture();
  assertThrows(
    () =>
      lowerCalculixRecordedStatic({
        ...fixture.input,
        elementOrder: 3 as 1,
      }),
    TypeError,
    "elementOrder must be 1 or 2",
  );
  assertThrows(
    () =>
      lowerCalculixRecordedStatic({
        ...fixture.input,
        inputArtifact: {
          ...fixture.input.inputArtifact,
          stagedAsset: { location: "/exports/agent-selected.step" },
        },
      }),
    TypeError,
    "staged location",
  );
  const client: McpToolClient = {
    callTool: () =>
      Promise.resolve({
        structuredContent: { ...fixture.solve, injected: true },
        text: "",
      }),
    callToolTextResult: () => Promise.reject(new Error("unused")),
  };
  const adapter = new McpCalculixRecordedStaticAdapter(client);
  const plan = adapter.resolve(fixture.input);
  await assertRejects(
    () => adapter.solve(plan),
    Error,
    "unsupported field injected",
  );
});

async function buildFixture() {
  const base = validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
    ),
  ));
  const inputBytes = encoder.encode("ISO-10303-21; recorded fixture");
  const inputDigest = await sha(inputBytes);
  const proof = {
    ...base,
    expectedCadArtifact: {
      format: "step",
      sha256: inputDigest,
      bytes: inputBytes.byteLength,
    },
  } as MechanicalProofCase;
  const input = {
    requestId: REQUEST_ID,
    proof,
    inputArtifact: {
      fingerprint: { algorithm: "sha256" as const, digest: inputDigest },
      byteCount: inputBytes.byteLength,
      stagedAsset: { location: `/inputs/fea-${inputDigest}.step` },
    },
    elementOrder: 1 as const,
    timeoutMs: 120_000,
  };
  const plan = lowerCalculixRecordedStatic(input);
  const executionIdentity = {
    schema_version: "1.0",
    server: { package: "@casys/mcp-calculix", version: "0.7.0" },
    method: { id: "calculix_solve_static_recorded", version: "1.0" },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    engines: {
      gmsh: { command: "gmsh", version: "4.12.1" },
      ccx: { command: "ccx", version: "CalculiX 2.21" },
    },
    image: { status: "unattested" },
  };
  const requestBytes = encoder.encode(`${
    deterministicJson({
      ...plan.exactDispatchRecord,
      execution_identity: executionIdentity,
    })
  }\n`);
  const result = {
    schemaVersion: "2.0",
    kind: "static-solve-recorded",
    inputArtifact: {
      uri: `casys://calculix/runs/${RUN_ID}/input.step`,
      mimeType: "model/step",
      sha256: inputDigest,
      bytes: inputBytes.byteLength,
    },
    mesh: { nodes: 8, elements: 4, nodesPerSelection: { FIXED: 4, LOADED: 4 } },
    constraints: {
      fixedSelections: ["FIXED"],
      loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
    },
    metrics: {
      maxDisplacement: { value: 0.1, unit: "mm", nodeId: 8, vectorMm: [0, 0, -0.1] },
      maxVonMises: { value: 2, unit: "MPa", elementId: 4 },
    },
  };
  const artifactBytes: Record<string, Uint8Array> = {
    "input.step": inputBytes,
    "request.json": requestBytes,
    "mesh.geo": encoder.encode("mesh geo"),
    "mesh.inp": encoder.encode("mesh inp"),
    "gmsh.log": encoder.encode("gmsh log"),
    "job.inp": encoder.encode("job inp"),
    "ccx.log": encoder.encode("ccx log"),
    "job.dat": encoder.encode("job dat"),
    "result.json": encoder.encode(JSON.stringify(result)),
  };
  const profile = [
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
  const artifacts = await Promise.all(profile.map(async ([name, mimeType]) => ({
    name,
    uri: `casys://calculix/runs/${RUN_ID}/${name}`,
    mimeType,
    bytes: artifactBytes[name].byteLength,
    sha256: await sha(artifactBytes[name]),
  })));
  const run = {
    schemaVersion: "2.0",
    state: "completed",
    runId: RUN_ID,
    requestId: REQUEST_ID,
    requestSha256: await sha(requestBytes),
    inputArtifact: result.inputArtifact,
    createdAt: "2026-08-12T00:00:00.000Z",
    artifacts,
  };
  const solve = { ...result, run };
  return {
    input,
    solve,
    get: {
      schemaVersion: "1.0",
      status: "completed",
      lookup: { kind: "request_id", value: REQUEST_ID },
      requestId: REQUEST_ID,
      runId: RUN_ID,
      run,
    },
    captured: profile.map(([role]) => ({ role, bytes: artifactBytes[role] })),
  };
}

async function sha(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
