import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  CalculixRecordedStaticCapturedEvidence,
  CalculixRecordedStaticCapturedResource,
  CalculixRecordedStaticCompleted,
  CalculixRecordedStaticInput,
  CalculixRecordedStaticPlan,
  CalculixRecordedStaticRecovery,
} from "./calculix-recorded-capabilities.ts";
import {
  createProviderResourceRead,
  type ExpectedProviderResource,
  type ProviderResourceReader,
} from "../../src/domain/compile/source/provider-resource-reader.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  acquireAndVerifyCalculixEvidence,
  anchoredMechanicalProofCase,
  assertExactCalculixResourceProfile,
  DockerComposeNativeAssetBridge,
  dryRunSummary,
  type NativeAssetBridge,
  type NativeCalculixAdapter,
  type NativeStepExport,
  type NativeSysmlMechanicalAnchor,
  parseBuild123dStepExport,
  parseSysonProjectList,
  runNativeMechanicalSmoke,
  type StagedNativeStep,
} from "./native-smoke.ts";

const EXPORT_NAME = "native-smoke-support-block-0123456789abcdef0123456789abcdef";
const DIGEST = "a".repeat(64);
const RESOURCE_ROLES = [
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

const STEP_BYTES = new Uint8Array([83, 84, 69, 80, 10]);

const SYSML_ANCHOR: NativeSysmlMechanicalAnchor = Object.freeze({
  editingContextId: "editing-context-real",
  supportBlockPartDefinitionId: "part-def-support",
  supportBlockPartUsageId: "part-usage-support",
  supportBlockPartUsageTargetId: "part-def-support",
  requirementUsageId: "requirement-usage-support",
  subjectReferenceUsageId: "subject-reference-support",
  subjectTargetPartDefinitionId: "part-def-support",
  criteria: Object.freeze([
    Object.freeze({
      constraintUsageId: "constraint-displacement",
      requirementId: "support_block_max_displacement",
      metric: "support_block_max_displacement",
      operator: "<=",
      limitValue: 2,
      unit: "mm",
    }),
    Object.freeze({
      constraintUsageId: "constraint-von-mises",
      requirementId: "support_block_max_von_mises",
      metric: "support_block_max_von_mises",
      operator: "<=",
      limitValue: 100_000_000,
      unit: "Pa",
    }),
  ]),
});

Deno.test("native smoke accepts only the exact generated build123d STEP tuple", () => {
  assertEquals(
    parseBuild123dStepExport({
      schemaVersion: "1.0",
      kind: "export",
      metrics: {},
      files: [{
        format: "step",
        path: `/exports/${EXPORT_NAME}.step`,
        bytes: 1234,
        sha256: DIGEST,
      }],
    }, EXPORT_NAME),
    {
      exportName: EXPORT_NAME,
      containerPath: `/exports/${EXPORT_NAME}.step`,
      byteCount: 1234,
      sha256: DIGEST,
    },
  );

  assertThrows(
    () =>
      parseBuild123dStepExport({
        schemaVersion: "1.0",
        kind: "export",
        metrics: {},
        files: [{
          format: "step",
          path: "/exports/caller-selected.step",
          bytes: 1234,
          sha256: DIGEST,
        }],
      }, EXPORT_NAME),
    TypeError,
    "path must equal",
  );
});

Deno.test("native smoke requires CalculiX's exact ordered nine-role ledger", () => {
  const completed = completedWithRoles(RESOURCE_ROLES);
  assertExactCalculixResourceProfile(completed);
  assertThrows(
    () =>
      assertExactCalculixResourceProfile(completedWithRoles(RESOURCE_ROLES.slice(1))),
    TypeError,
    "exact nine roles",
  );
});

Deno.test("native smoke mechanical case maps exact SysON identities and criteria", () => {
  const proof = anchoredMechanicalProofCase(
    SYSML_ANCHOR,
    DIGEST,
    101,
    DIGEST,
    1234,
  );
  assertEquals(proof.project.id, "spike-only-non-authoritative-project");
  assertEquals(proof.target.id, SYSML_ANCHOR.supportBlockPartUsageId);
  assertEquals(
    proof.target.modelElementId,
    SYSML_ANCHOR.supportBlockPartDefinitionId,
  );
  assertEquals(proof.requirementsSource, {
    provider: "syson",
    editingContextId: SYSML_ANCHOR.editingContextId,
    elementId: SYSML_ANCHOR.requirementUsageId,
  });
  assertEquals(
    proof.requirements.map((requirement) => ({
      id: requirement.id,
      limit: requirement.limit,
    })),
    [{
      id: SYSML_ANCHOR.criteria[0].constraintUsageId,
      limit: { value: 2, unit: "mm" },
    }, {
      id: SYSML_ANCHOR.criteria[1].constraintUsageId,
      limit: { value: 100_000_000, unit: "Pa" },
    }],
  );
  assertEquals(proof.analysis.material.youngModulus.value, 70000);
  assertEquals(proof.analysis.material.poissonRatio.value, 0.33);
  assertEquals(proof.analysis.loads[0].force.value, [0, 0, -10]);
  assertEquals(proof.expectedCadArtifact, {
    format: "step",
    sha256: DIGEST,
    bytes: 1234,
  });
});

Deno.test("native smoke accepts the live SysON pageInfo null cursor without widening fields", () => {
  assertEquals(
    parseSysonProjectList({
      projects: [],
      pageInfo: {
        count: 0,
        hasNextPage: false,
        endCursor: null,
        startCursor: null,
        hasPreviousPage: false,
      },
    }),
    { projectCount: 0 },
  );
  assertThrows(
    () =>
      parseSysonProjectList({
        projects: [],
        pageInfo: { count: 0, hasNextPage: false, providerHint: "ignore-me" },
      }),
    TypeError,
    "unsupported field providerHint",
  );
});

Deno.test("anchored native mechanical fake E2E executes once, recovers by GET only and verifies nine exact resources", async () => {
  const stepSha256 = await sha256Hex(STEP_BYTES);
  const resources = await recordedResources(STEP_BYTES);
  const reader = new FakeResourceReader(resources);
  const calculix = new FakeCalculixAdapter(resources);
  const bridge = new FakeNativeAssetBridge(STEP_BYTES);
  const build123d = new FakeToolClient((call) => {
    const exportName = String(call.arguments?.name);
    return {
      structuredContent: {
        schemaVersion: "1.0",
        kind: "export",
        metrics: {},
        files: [{
          format: "step",
          path: `/exports/${exportName}.step`,
          bytes: STEP_BYTES.byteLength,
          sha256: stepSha256,
        }],
      },
      text: "",
    };
  });
  const unused = new FakeToolClient(() => {
    throw new Error("override should prevent this MCP client call");
  });

  const summary = await runNativeMechanicalSmoke(
    {
      build123dSandbox: build123d,
      calculix: unused,
      calculixResources: reader,
    },
    bridge,
    SYSML_ANCHOR,
    {
      calculix,
      pollDelay: () => Promise.resolve(),
    },
  );

  assertEquals(build123d.calls.map((call) => call.name), ["build123d_export"]);
  assertEquals(calculix.resolveCalls, 1);
  assertEquals(calculix.solveCalls, 1);
  assertEquals(calculix.getCalls, 1);
  assertEquals(calculix.verifyCalls, 1);
  assertEquals(
    reader.reads.map((resource) => resource.uri),
    resources.map((r) => r.uri),
  );
  assertEquals(reader.reads.length, 9);
  assertEquals(bridge.cleanupCalls, 1);
  assertEquals(summary.calculix.resourceBytesVerified, true);
  assertEquals(summary.calculix.inputStepBytesMatched, true);
  assertEquals(summary.calculix.resourceProfile, RESOURCE_ROLES);
  const proof = calculix.lastInput?.proof;
  if (!proof) throw new Error("Fake CalculiX did not capture the proof input");
  assertEquals(proof.target.modelElementId, "part-def-support");
  assertEquals(proof.requirementsSource.elementId, "requirement-usage-support");
  assertEquals(proof.requirements.map((requirement) => requirement.id), [
    "constraint-displacement",
    "constraint-von-mises",
  ]);
  assertEquals(proof.requirements.map((requirement) => requirement.limit), [
    { value: 2, unit: "mm" },
    { value: 100_000_000, unit: "Pa" },
  ]);
  assertEquals(summary.sysmlAnchor.supportBlockPartDefinitionId, "part-def-support");
});

Deno.test("native mechanical smoke rejects foreign targets, units and cardinality before providers", async () => {
  const invalidAnchors: NativeSysmlMechanicalAnchor[] = [
    {
      ...SYSML_ANCHOR,
      supportBlockPartUsageTargetId: "foreign-part-definition",
    },
    {
      ...SYSML_ANCHOR,
      subjectTargetPartDefinitionId: "foreign-part-definition",
    },
    {
      ...SYSML_ANCHOR,
      criteria: [{ ...SYSML_ANCHOR.criteria[0], unit: "Pa" }, SYSML_ANCHOR.criteria[1]],
    } as NativeSysmlMechanicalAnchor,
    {
      ...SYSML_ANCHOR,
      criteria: [SYSML_ANCHOR.criteria[0]],
    },
  ];
  for (const anchor of invalidAnchors) {
    const provider = new FakeToolClient(() => {
      throw new Error("invalid anchor must stop before provider dispatch");
    });
    const bridge = new FakeNativeAssetBridge(STEP_BYTES);
    await assertRejects(
      () =>
        runNativeMechanicalSmoke(
          {
            build123dSandbox: provider,
            calculix: provider,
            calculixResources: new FakeResourceReader([]),
          },
          bridge,
          anchor,
        ),
      TypeError,
    );
    assertEquals(provider.calls, []);
    assertEquals(bridge.cleanupCalls, 0);
  }
});

Deno.test("CalculiX acquisition rejects one hash-tampered resource before evidence verification", async () => {
  const resources = await recordedResources(STEP_BYTES);
  const completed = completedWithResources(resources);
  const adapter = new FakeCalculixAdapter(resources);
  const plan = adapter.resolve(fakeCalculixInput(await sha256Hex(STEP_BYTES)));
  const reader: ProviderResourceReader = {
    read: (expected) => {
      const bytes = expected.uri.endsWith("/ccx.log")
        ? new Uint8Array([0, 1, 2, 3])
        : resourceBytes(expected.uri, resources);
      // Forge a content-match attestation around tampered bytes. The harness
      // must independently rehash instead of trusting the port declaration.
      return Promise.resolve({
        bytes: {
          byteLength: bytes.byteLength,
          copy: () => Uint8Array.from(bytes),
        },
        attestation: {
          schemaVersion: "provider-resource-read-attestation/1.0",
          verification: "exact-content-match",
          ...expected,
        },
      });
    },
  };
  await assertRejects(
    () =>
      acquireAndVerifyCalculixEvidence(adapter, reader, plan, completed, {
        containerPath: `/inputs/fea-${resources[0].sha256}.step`,
        byteCount: STEP_BYTES.byteLength,
        sha256: resources[0].sha256,
        bytes: STEP_BYTES,
      }),
    TypeError,
    "did not exactly re-attest ccx.log",
  );
  assertEquals(adapter.verifyCalls, 0);
});

Deno.test("CalculiX acquisition rejects input.step bytes different from staged readback", async () => {
  const resources = await recordedResources(STEP_BYTES);
  const completed = completedWithResources(resources);
  const adapter = new FakeCalculixAdapter(resources);
  const plan = adapter.resolve(fakeCalculixInput(await sha256Hex(STEP_BYTES)));
  const differentStagedBytes = Uint8Array.from(STEP_BYTES);
  differentStagedBytes[0] = differentStagedBytes[0] ^ 0xff;
  await assertRejects(
    () =>
      acquireAndVerifyCalculixEvidence(
        adapter,
        new FakeResourceReader(resources),
        plan,
        completed,
        {
          containerPath: `/inputs/fea-${resources[0].sha256}.step`,
          byteCount: STEP_BYTES.byteLength,
          sha256: resources[0].sha256,
          bytes: differentStagedBytes,
        },
      ),
    TypeError,
    "does not equal the exact staged STEP bytes",
  );
  assertEquals(adapter.verifyCalls, 0);
});

Deno.test("Docker bridge cleans its generated source on malformed ACK and both paths on callback failure", async () => {
  const malformedLabels: string[] = [];
  const malformedBridge = new DockerComposeNativeAssetBridge({
    cwd: () => "/repo",
    makeTempDir: () => Promise.reject(new Error("must not allocate")),
    readFile: () => Promise.reject(new Error("must not read")),
    removeDirectory: () => Promise.reject(new Error("must not remove host dir")),
    runDocker: (_args, label) => {
      malformedLabels.push(label);
      return Promise.resolve(new Uint8Array());
    },
  });
  await assertRejects(
    () =>
      malformedBridge.withStagedStep(
        EXPORT_NAME,
        () =>
          Promise.resolve(parseBuild123dStepExport({
            schemaVersion: "1.0",
            kind: "export",
            metrics: {},
            files: [],
          }, EXPORT_NAME)),
        () => Promise.resolve("unreachable"),
      ),
    AggregateError,
    "handoff failed",
  );
  assertEquals(malformedLabels, ["remove build123d sandbox STEP"]);

  const stepSha256 = await sha256Hex(STEP_BYTES);
  const callbackLabels: string[] = [];
  const removedDirectories: string[] = [];
  const callbackBridge = new DockerComposeNativeAssetBridge({
    cwd: () => "/repo",
    makeTempDir: () => Promise.resolve("/tmp/native-smoke-test"),
    readFile: () => Promise.resolve(Uint8Array.from(STEP_BYTES)),
    removeDirectory: (path) => {
      removedDirectories.push(path);
      return Promise.resolve();
    },
    runDocker: (_args, label) => {
      callbackLabels.push(label);
      return Promise.resolve(
        label === "read back staged CalculiX STEP"
          ? Uint8Array.from(STEP_BYTES)
          : new Uint8Array(),
      );
    },
  });
  await assertRejects(
    () =>
      callbackBridge.withStagedStep(
        EXPORT_NAME,
        () => Promise.resolve(stepExport(stepSha256)),
        () => Promise.reject(new Error("callback failed")),
      ),
    AggregateError,
    "handoff failed",
  );
  assertEquals(callbackLabels.slice(-2), [
    "remove CalculiX staged STEP",
    "remove build123d sandbox STEP",
  ]);
  assertEquals(removedDirectories, ["/tmp/native-smoke-test"]);
});

Deno.test("native smoke dry-run declares no project, Thread or SysON writes", () => {
  const summary = dryRunSummary() as {
    executes: boolean;
    writes: { projectState: boolean; threadState: boolean; syson: boolean };
    providerSelectionAcceptedFromCaller: boolean;
  };
  assertEquals(summary.executes, false);
  assertEquals(summary.writes.projectState, false);
  assertEquals(summary.writes.threadState, false);
  assertEquals(summary.writes.syson, false);
  assertEquals(summary.providerSelectionAcceptedFromCaller, false);
});

function completedWithRoles(
  roles: readonly string[],
): CalculixRecordedStaticCompleted {
  return {
    status: "completed",
    requestId: "native-smoke-calculix-request",
    requestSha256: DIGEST,
    runId: "r-01234567-89ab-4cde-8fab-0123456789ab",
    resources: roles.map((role) => ({
      role,
      uri: `casys://calculix/test/${role}`,
      mediaType: "application/octet-stream",
      byteCount: 1,
      sha256: DIGEST,
    })),
  };
}

class FakeToolClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  textResultCalls = 0;

  constructor(
    private readonly handler: (call: McpToolCall) => McpToolResult,
  ) {}

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return Promise.resolve(this.handler(call));
  }

  callToolTextResult(): Promise<Record<string, unknown>> {
    this.textResultCalls += 1;
    return Promise.reject(new Error("text-result path is forbidden in native smoke"));
  }
}

class FakeNativeAssetBridge implements NativeAssetBridge {
  cleanupCalls = 0;

  constructor(private readonly bytes: Uint8Array) {}

  async withStagedStep<T>(
    exportName: string,
    resolveExport: () => Promise<NativeStepExport>,
    use: (asset: StagedNativeStep) => Promise<T>,
  ): Promise<T> {
    try {
      const exported = await resolveExport();
      assertEquals(exported.exportName, exportName);
      return await use({
        containerPath: `/inputs/fea-${exported.sha256}.step`,
        byteCount: exported.byteCount,
        sha256: exported.sha256,
        bytes: Uint8Array.from(this.bytes),
      });
    } finally {
      this.cleanupCalls += 1;
    }
  }
}

class FakeResourceReader implements ProviderResourceReader {
  readonly reads: ExpectedProviderResource[] = [];

  constructor(
    private readonly resources: readonly (ExpectedProviderResource & {
      readonly role: string;
    })[],
  ) {}

  read(expected: ExpectedProviderResource) {
    this.reads.push(structuredClone(expected));
    return createProviderResourceRead(
      expected,
      resourceBytes(expected.uri, this.resources),
    );
  }
}

class FakeCalculixAdapter implements NativeCalculixAdapter {
  resolveCalls = 0;
  solveCalls = 0;
  getCalls = 0;
  verifyCalls = 0;
  lastInput: CalculixRecordedStaticInput | undefined;
  #completed: CalculixRecordedStaticCompleted | undefined;

  constructor(
    private readonly resources: readonly (ExpectedProviderResource & {
      readonly role: string;
    })[],
  ) {}

  resolve(input: CalculixRecordedStaticInput): CalculixRecordedStaticPlan {
    this.resolveCalls += 1;
    this.lastInput = structuredClone(input);
    this.#completed = completedWithResources(this.resources, input.requestId);
    return {
      requestId: input.requestId,
      exactDispatchRecord: { request_id: input.requestId },
      expectedInput: {
        fingerprint: input.inputArtifact.fingerprint,
        byteCount: input.inputArtifact.byteCount,
      },
    };
  }

  solve(_plan: CalculixRecordedStaticPlan): Promise<CalculixRecordedStaticCompleted> {
    this.solveCalls += 1;
    return Promise.resolve(this.requiredCompleted());
  }

  getByRequestId(_requestId: string): Promise<CalculixRecordedStaticRecovery> {
    this.getCalls += 1;
    return Promise.resolve(this.requiredCompleted());
  }

  verifyCapturedEvidence(
    _plan: CalculixRecordedStaticPlan,
    _completed: CalculixRecordedStaticCompleted,
    captured: readonly CalculixRecordedStaticCapturedResource[],
  ): Promise<CalculixRecordedStaticCapturedEvidence> {
    this.verifyCalls += 1;
    assertEquals(captured.map((resource) => resource.role), [...RESOURCE_ROLES]);
    const input = this.resources[0];
    return Promise.resolve({
      executionIdentity: {
        schemaVersion: "1.0",
        server: { package: "@casys/mcp-calculix", version: "test" },
        method: { id: "calculix_solve_static_recorded", version: "1.0" },
        lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
        engines: {
          gmsh: { command: "gmsh", version: "test" },
          ccx: { command: "ccx", version: "test" },
        },
        image: { status: "unattested" },
      },
      result: {
        inputArtifact: input,
        mesh: {
          nodes: 8,
          elements: 5,
          nodesPerSelection: {
            SUPPORT_BLOCK_BOTTOM: 4,
            SUPPORT_BLOCK_TOP: 4,
          },
        },
        constraints: {
          fixedSelections: ["SUPPORT_BLOCK_BOTTOM"],
          loads: [{
            selection: "SUPPORT_BLOCK_TOP",
            forceN: [0, 0, -10],
          }],
        },
        metrics: {
          maximumDisplacement: {
            value: 0.001,
            unit: "mm",
            nodeId: 1,
            vectorMm: [0, 0, -0.001],
          },
          maximumVonMises: { value: 0.1, unit: "MPa", elementId: 1 },
        },
      },
    });
  }

  private requiredCompleted(): CalculixRecordedStaticCompleted {
    if (!this.#completed) throw new Error("CalculiX fake was not resolved");
    return this.#completed;
  }
}

async function recordedResources(
  stepBytes: Uint8Array,
): Promise<readonly (ExpectedProviderResource & { readonly role: string })[]> {
  return await Promise.all(RESOURCE_ROLES.map(async (role) => {
    const bytes = role === "input.step" ? stepBytes : bytesForRole(role);
    return {
      role,
      uri: `casys://calculix/native-smoke/${role}`,
      mediaType: role === "input.step"
        ? "model/step"
        : role === "request.json" || role === "result.json"
        ? "application/json"
        : "text/plain",
      byteCount: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    };
  }));
}

function resourceBytes(
  uri: string,
  resources: readonly (ExpectedProviderResource & { readonly role: string })[],
): Uint8Array {
  const resource = resources.find((candidate) => candidate.uri === uri);
  if (!resource) throw new Error(`Unknown fake resource ${uri}`);
  return resource.role === "input.step"
    ? Uint8Array.from(STEP_BYTES)
    : bytesForRole(resource.role);
}

function bytesForRole(role: string): Uint8Array {
  return new TextEncoder().encode(`native-smoke:${role}\n`);
}

function completedWithResources(
  resources: readonly (ExpectedProviderResource & { readonly role: string })[],
  requestId = "native-smoke-calculix-request",
): CalculixRecordedStaticCompleted {
  const request = resources.find((resource) => resource.role === "request.json");
  if (!request) throw new Error("Fake resources require request.json");
  return {
    status: "completed",
    requestId,
    requestSha256: request.sha256,
    runId: "r-01234567-89ab-4cde-8fab-0123456789ab",
    resources,
  };
}

function fakeCalculixInput(stepSha256: string): CalculixRecordedStaticInput {
  return {
    requestId: "native-smoke-calculix-request",
    proof: anchoredMechanicalProofCase(
      SYSML_ANCHOR,
      DIGEST,
      101,
      stepSha256,
      STEP_BYTES.byteLength,
    ),
    inputArtifact: {
      fingerprint: { algorithm: "sha256", digest: stepSha256 },
      byteCount: STEP_BYTES.byteLength,
      stagedAsset: { location: `/inputs/fea-${stepSha256}.step` },
    },
    elementOrder: 1,
    timeoutMs: 120000,
  };
}

function stepExport(sha256: string): NativeStepExport {
  return {
    exportName: EXPORT_NAME,
    containerPath: `/exports/${EXPORT_NAME}.step`,
    byteCount: STEP_BYTES.byteLength,
    sha256,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
