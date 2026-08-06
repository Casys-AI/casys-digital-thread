import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../src/adapters/mcp/http-mcp-tool-client.ts";
import { LiveThreadUpdateStore } from "../src/adapters/stores/live-thread-update-store.ts";
import {
  EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../src/domain/engineering-project-command-service.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
} from "../src/domain/engineering-project.ts";
import { deterministicJson } from "../src/domain/deterministic-json.ts";
import {
  COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID,
  COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID,
} from "../src/adapters/historical/coffee-machine-mechanical-run-extension.ts";
import {
  extractApprovedProofCase,
  type MechanicalCaptureStore,
  runCoffeeMachineMechanical,
} from "./run-coffee-machine-mechanical.ts";

const CONFIG = new URL(
  "../config/projects/coffee-machine-cm01.project.json",
  import.meta.url,
);
const CANONICAL_WORKFLOW = new URL(
  "../config/thread-workflows/coffee-machine-mechanical-v1.yaml",
  import.meta.url,
);
const RUN_ID = "run:mechanical-test-v1";
const HUMAN = { kind: "human" as const, actorId: "erwan" };
const AGENT = {
  kind: "agent" as const,
  actorId: "mcp:casys-digital-thread-orchestrator@0.1.0",
};
const STEP_SHA = "a".repeat(64);

Deno.test("mechanical runner uses only an approved running run and pipes the exact generated STEP", async () => {
  const project = await authorizedProject();
  const constraints = approvedConstraints();
  const syson = new FakeSyson(constraints);
  const build = fakeBuildClient();
  const calculix = new FakeCalculix();
  const updates = new LiveThreadUpdateStore();
  const captures = new MemoryCaptureStore();

  const result = await runCoffeeMachineMechanical({
    runId: RUN_ID,
    projectSnapshot: project,
    sysonClient: syson,
    build123dClient: build.client,
    calculixClient: calculix,
    liveUpdates: updates,
    captureStore: captures,
    now: fixedNow,
    monotonicNow: incrementingClock(),
  });

  assertEquals(result.capture.workflow.status, "succeeded");
  assertEquals(result.capture.project.revision, project.revision);
  assertEquals(result.capture.authorization.queuedBy, "erwan");
  assertEquals(result.capture.authorization.claimedBy, AGENT.actorId);
  assertEquals(result.capture.sysml.inserted, false);
  assertEquals(result.capture.cad.artifact.sha256, STEP_SHA);
  assertEquals(
    syson.calls.at(-1)?.arguments?.constraints,
    result.capture.sysml.constraints,
  );
  assertEquals(
    result.capture.cad.script,
    "from build123d import Align, Box\n\n" +
      "result = Box(190, 135, 28, align=(Align.CENTER, Align.CENTER, Align.CENTER))",
  );
  assertEquals(build.calls.length, 1);
  assertEquals(calculix.calls.length, 1);
  assertEquals(calculix.calls[0].arguments?.expected_step_sha256, STEP_SHA);
  assertEquals(calculix.calls[0].arguments?.step_path, "/exports/cm01-drip-tray.step");
  assertEquals(calculix.calls[0].arguments?.material, { e_mpa: 2200, nu: 0.35 });
  assertEquals(calculix.calls[0].arguments?.loads, [{
    selection: "LOADED",
    force_n: [0, 0, -100],
  }]);
  assertEquals(calculix.calls[0].arguments?.selections, [
    { name: "FIXED", box: { min: [-96, 66.5, -15], max: [96, 68.5, 15] } },
    { name: "LOADED", box: { min: [-96, -68.5, -15], max: [96, -66.5, 15] } },
  ]);
  assertEquals(
    syson.calls.map((call) => call.name),
    [
      "syson_constraint_extract",
      "syson_constraint_extract",
      "syson_constraint_evaluate",
    ],
  );
  assertEquals(captures.paths, [
    `state/local/coffee-machine-mechanical-runs/${RUN_ID}.json`,
  ]);
  assertEquals(captures.preparedPaths, captures.paths);
  assertEquals(captures.releasedPaths, captures.paths);
  assertEquals(
    captures.contents[0],
    `${deterministicJson(result.capture)}\n`,
  );
  const journal = await updates.list("coffee-machine-cm01");
  assertEquals(journal.length, 12);
  assertEquals(journal.every((entry) => entry.runId === RUN_ID), true);
  assertEquals(
    journal.filter((entry) => entry.state === "running").length,
    6,
  );
  assertEquals(journal.filter((entry) => entry.state === "fresh").length, 6);
});

Deno.test("mechanical runner refuses a mutated workflow before project, capture, journal, or provider I/O", async () => {
  const source = await Deno.readTextFile(CANONICAL_WORKFLOW);
  const mutated = source.replace(
    "tool: calculix_solve_static",
    "tool: calculix_solve_dynamic",
  );
  assertEquals(mutated === source, false);

  await assertWorkflowRejectedBeforeIo(
    () => Promise.resolve(mutated),
    "does not match its exact executable contract",
  );
});

Deno.test("mechanical runner refuses a missing canonical workflow before project, capture, journal, or provider I/O", async () => {
  await assertWorkflowRejectedBeforeIo(
    () => Promise.reject(new Deno.errors.NotFound("missing canonical workflow")),
    "Unable to read thread workflow",
  );
});

Deno.test("mechanical runner refuses invalid canonical YAML before project, capture, journal, or provider I/O", async () => {
  await assertWorkflowRejectedBeforeIo(
    () => Promise.resolve("schemaVersion: [\n"),
    "Invalid YAML in thread workflow",
  );
});

Deno.test("mechanical runner inserts proposal-derived model constraints only after empty preflight", async () => {
  const project = await authorizedProject();
  const syson = new FakeSyson([], []);
  const build = fakeBuildClient();
  const captures = new MemoryCaptureStore();

  const result = await runCoffeeMachineMechanical({
    runId: RUN_ID,
    projectSnapshot: project,
    sysonClient: syson,
    build123dClient: build.client,
    calculixClient: new FakeCalculix(),
    liveUpdates: new LiveThreadUpdateStore(),
    captureStore: captures,
    now: fixedNow,
    monotonicNow: incrementingClock(),
  });

  assertEquals(result.capture.sysml.inserted, true);
  assertEquals(
    syson.calls.map((call) => call.name),
    [
      "syson_constraint_extract",
      "syson_element_children",
      "syson_element_insert_sysml",
      "syson_constraint_extract",
      "syson_constraint_extract",
      "syson_constraint_evaluate",
    ],
  );
  const insertion = syson.calls.find((call) =>
    call.name === "syson_element_insert_sysml"
  )!;
  assertEquals(
    insertion.arguments?.editing_context_id,
    COFFEE_MACHINE_MECHANICAL_SYSON_EDITING_CONTEXT_ID,
  );
  assertEquals(
    insertion.arguments?.parent_id,
    COFFEE_MACHINE_MECHANICAL_SYSON_REQUIREMENTS_ELEMENT_ID,
  );
  const text = String(insertion.arguments?.sysml_text);
  assertEquals(text.includes("private import SI::*;"), true);
  assertEquals(text.includes("assembly_max_displacement <= 1 [mm]"), true);
  assertEquals(
    text.includes("assembly_max_von_mises <= 20000000 [Pa]"),
    true,
  );
  assertEquals(text.includes("density"), false);
});

Deno.test("mechanical runner resumes after a bounded SysON insertion response failure", async () => {
  const project = await authorizedProject();
  const updates = new LiveThreadUpdateStore();
  const baseRevision = project.agentRuns[0].baseSnapshot!.revision;
  await updates.append({
    subjectId: project.project.subjectId,
    runId: RUN_ID,
    operationId: "cm01-mechanical:syson_element_insert_sysml:03",
    baseRevision,
    state: "running",
    recordedAt: fixedNow().toISOString(),
    graph: preflightGraph("Model-owned mechanical limits"),
  });
  await updates.append({
    subjectId: project.project.subjectId,
    runId: RUN_ID,
    operationId: "cm01-mechanical:syson_element_insert_sysml:03",
    baseRevision,
    state: "failed",
    recordedAt: fixedNow().toISOString(),
    graph: preflightGraph("Model-owned mechanical limits"),
  });
  const syson = new FakeSyson(approvedConstraints());
  const build = fakeBuildClient();

  const result = await runCoffeeMachineMechanical({
    runId: RUN_ID,
    projectSnapshot: project,
    sysonClient: syson,
    build123dClient: build.client,
    calculixClient: new FakeCalculix(),
    liveUpdates: updates,
    captureStore: new MemoryCaptureStore(),
    now: fixedNow,
    monotonicNow: incrementingClock(),
  });

  assertEquals(result.capture.workflow.status, "succeeded");
  assertEquals(result.capture.sysml.inserted, false);
  assertEquals(build.calls.length, 1);
  assertEquals(
    syson.calls.map((call) => call.name),
    [
      "syson_constraint_extract",
      "syson_constraint_extract",
      "syson_constraint_evaluate",
    ],
  );
});

Deno.test("mechanical capture records the exact constraints consumed by the workflow", async () => {
  const project = await authorizedProject();
  const preflight = approvedConstraints().map((constraint, index) => ({
    ...constraint as object,
    id: `preflight-${index}`,
  }));
  const consumed = approvedConstraints().map((constraint, index) => ({
    ...constraint as object,
    id: `consumed-${index}`,
  }));

  const result = await runCoffeeMachineMechanical({
    runId: RUN_ID,
    projectSnapshot: project,
    sysonClient: new SequencedConstraintSyson([preflight, consumed]),
    build123dClient: fakeBuildClient().client,
    calculixClient: new FakeCalculix(),
    liveUpdates: new LiveThreadUpdateStore(),
    captureStore: new MemoryCaptureStore(),
    now: fixedNow,
    monotonicNow: incrementingClock(),
  });

  assertEquals(result.capture.sysml.constraints, consumed);
});

Deno.test("mechanical runner blocks CalculiX when workflow constraints disappear after preflight", async () => {
  const project = await authorizedProject();
  const syson = new SequencedConstraintSyson([approvedConstraints(), []]);
  const build = fakeBuildClient();
  const calculix = new FakeCalculix();
  const captures = new MemoryCaptureStore();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: syson,
        build123dClient: build.client,
        calculixClient: calculix,
        liveUpdates: new LiveThreadUpdateStore(),
        captureStore: captures,
      }),
    Error,
    "did not attest its requirements",
  );

  assertEquals(syson.calls.map((call) => call.name), [
    "syson_constraint_extract",
    "syson_constraint_extract",
  ]);
  assertEquals(build.calls.length, 1);
  assertEquals(calculix.calls.length, 0);
  assertEquals(captures.contents, []);
  assertEquals(captures.releasedPaths, captures.preparedPaths);
});

Deno.test("mechanical runner blocks CalculiX when workflow constraints drift after preflight", async () => {
  const project = await authorizedProject();
  const drifted = approvedConstraints();
  (drifted[1] as { expression: { right: { value: number } } }).expression.right.value =
    21_000_000;
  const syson = new SequencedConstraintSyson([approvedConstraints(), drifted]);
  const calculix = new FakeCalculix();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: syson,
        build123dClient: fakeBuildClient().client,
        calculixClient: calculix,
        liveUpdates: new LiveThreadUpdateStore(),
        captureStore: new MemoryCaptureStore(),
      }),
    Error,
    "did not attest its requirements",
  );

  assertEquals(calculix.calls.length, 0);
});

Deno.test("mechanical runner refuses an unfinished SysON preflight before any new mutation", async () => {
  const project = await authorizedProject();
  const updates = new LiveThreadUpdateStore();
  await updates.append({
    subjectId: project.project.subjectId,
    runId: RUN_ID,
    operationId: "cm01-mechanical:syson_element_insert_sysml:03",
    baseRevision: project.agentRuns[0].baseSnapshot!.revision,
    state: "running",
    recordedAt: fixedNow().toISOString(),
    graph: preflightGraph("Model-owned mechanical limits"),
  });
  let calls = 0;
  const forbidden: McpToolClient = {
    callTool: () => {
      calls++;
      return Promise.reject(new Error("must not be called"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const captures = new MemoryCaptureStore();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: forbidden,
        build123dClient: forbidden,
        calculixClient: forbidden,
        liveUpdates: updates,
        captureStore: captures,
      }),
    Error,
    "contains an unfinished SysON preflight operation",
  );
  assertEquals(calls, 0);
  assertEquals(captures.preparedPaths, []);
  assertEquals(captures.releasedPaths, []);
});

Deno.test("mechanical runner atomically refuses a second concurrent runner before mutation", async () => {
  const project = await authorizedProject();
  const outputDirectory = await Deno.makeTempDir({
    prefix: "casys-mechanical-claim-",
  });
  const enteredProvider = Promise.withResolvers<void>();
  const releaseProvider = Promise.withResolvers<void>();
  const firstSyson = new FakeSyson(approvedConstraints());
  let firstCall = true;
  const blockingSyson: McpToolClient = {
    async callTool(call) {
      if (firstCall) {
        firstCall = false;
        enteredProvider.resolve();
        await releaseProvider.promise;
      }
      return await firstSyson.callTool(call);
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const firstRun = runCoffeeMachineMechanical({
    runId: RUN_ID,
    projectSnapshot: project,
    outputDirectory,
    sysonClient: blockingSyson,
    build123dClient: fakeBuildClient().client,
    calculixClient: new FakeCalculix(),
    liveUpdates: new LiveThreadUpdateStore(),
    now: fixedNow,
    monotonicNow: incrementingClock(),
  });

  try {
    await enteredProvider.promise;
    let secondCalls = 0;
    const forbidden: McpToolClient = {
      callTool: () => {
        secondCalls++;
        return Promise.reject(new Error("must not be called"));
      },
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    };
    const secondUpdates = new LiveThreadUpdateStore();

    await assertRejects(
      () =>
        runCoffeeMachineMechanical({
          runId: RUN_ID,
          projectSnapshot: project,
          outputDirectory,
          sysonClient: forbidden,
          build123dClient: forbidden,
          calculixClient: forbidden,
          liveUpdates: secondUpdates,
          now: fixedNow,
          monotonicNow: incrementingClock(),
        }),
      Error,
      "already claimed by another runner",
    );
    assertEquals(secondCalls, 0);
    assertEquals(await secondUpdates.list(project.project.subjectId), []);
  } finally {
    releaseProvider.resolve();
    await firstRun;
    await Deno.remove(outputDirectory, { recursive: true });
  }
});

Deno.test("mechanical runner refuses to resume after any CAD activity", async () => {
  const project = await authorizedProject();
  const updates = new LiveThreadUpdateStore();
  await updates.append({
    subjectId: project.project.subjectId,
    runId: RUN_ID,
    operationId: "cm01-mechanical:build123d_export:01",
    baseRevision: project.agentRuns[0].baseSnapshot!.revision,
    state: "failed",
    recordedAt: fixedNow().toISOString(),
    graph: {
      nodes: [{
        id: `graph:artifact:${RUN_ID}:cad`,
        ref: { kind: "artifact", id: `${RUN_ID}:cad` },
        entityKind: "artifact",
        artifactKind: "cad-model",
        label: "CM-01 drip-tray CAD",
        system: "mcp-build123d",
        freshness: "failed",
        summary: "CAD failed",
      }],
      edges: [],
    },
  });
  let calls = 0;
  const forbidden: McpToolClient = {
    callTool: () => {
      calls++;
      return Promise.reject(new Error("must not be called"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: forbidden,
        build123dClient: forbidden,
        calculixClient: forbidden,
        liveUpdates: updates,
        captureStore: new MemoryCaptureStore(),
      }),
    Error,
    "progressed beyond resumable SysON preflight",
  );
  assertEquals(calls, 0);
});

Deno.test("mechanical runner refuses a merely queued run before any tool or capture mutation", async () => {
  const project = await queuedProject();
  let calls = 0;
  const forbidden: McpToolClient = {
    callTool: () => {
      calls++;
      return Promise.reject(new Error("must not be called"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const captures = new MemoryCaptureStore();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: forbidden,
        build123dClient: forbidden,
        calculixClient: forbidden,
        liveUpdates: new LiveThreadUpdateStore(),
        captureStore: captures,
      }),
    Error,
    "must already be running",
  );
  assertEquals(calls, 0);
  assertEquals(captures.preparedPaths, []);
  assertEquals(captures.releasedPaths, []);
  assertEquals(captures.contents.length, 0);
});

Deno.test("mechanical runner rejects a run fingerprint detached from the approved proposal", async () => {
  const project = structuredClone(await authorizedProject()) as Mutable<
    EngineeringProjectSnapshot
  >;
  project.agentRuns[0].inputFingerprint!.digest = "f".repeat(64);
  let calls = 0;
  const forbidden: McpToolClient = {
    callTool: () => {
      calls++;
      return Promise.reject(new Error("must not be called"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const captures = new MemoryCaptureStore();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: forbidden,
        build123dClient: forbidden,
        calculixClient: forbidden,
        liveUpdates: new LiveThreadUpdateStore(),
        captureStore: captures,
      }),
    Error,
    "does not bind the approved decision",
  );
  assertEquals(calls, 0);
  assertEquals(captures.preparedPaths, []);
  assertEquals(captures.releasedPaths, []);
});

Deno.test("mechanical runner fails closed on reserved SysON children instead of duplicating them", async () => {
  const project = await authorizedProject();
  const syson = new FakeSyson([], [{
    id: "existing-attribute",
    kind: "AttributeUsage",
    label: "assembly_max_displacement",
  }]);
  const build = fakeBuildClient();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: syson,
        build123dClient: build.client,
        calculixClient: new FakeCalculix(),
        liveUpdates: new LiveThreadUpdateStore(),
        captureStore: new MemoryCaptureStore(),
      }),
    Error,
    "already exist",
  );
  assertEquals(
    syson.calls.map((call) => call.name),
    ["syson_constraint_extract", "syson_element_children"],
  );
  assertEquals(build.calls.length, 0);
});

Deno.test("approved proof extraction rejects an untyped or wrong-unit parameter", async () => {
  const project = structuredClone(await authorizedProject()) as Mutable<
    EngineeringProjectSnapshot
  >;
  const decision = project.decisions.find((item) =>
    item.id === "review-mechanical-proof-case"
  )!;
  decision.proposal!.parameters.find((item) => item.key === "young_modulus_mpa")!
    .unit = "Pa";
  assertThrows(
    () => extractApprovedProofCase(decision),
    TypeError,
    "must be a finite reviewed number in MPa",
  );
});

Deno.test("mechanical runner rejects an approved but unsupported proof case before capture claim", async () => {
  const parameters = proposalParameters().map((parameter) =>
    parameter.key === "fixed_region"
      ? { ...parameter, value: "Unsupported fixture" }
      : parameter
  );
  const project = await authorizedProject(parameters);
  const captures = new MemoryCaptureStore();
  let calls = 0;
  const forbidden: McpToolClient = {
    callTool: () => {
      calls++;
      return Promise.reject(new Error("must not be called"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: project,
        sysonClient: forbidden,
        build123dClient: forbidden,
        calculixClient: forbidden,
        liveUpdates: new LiveThreadUpdateStore(),
        captureStore: captures,
      }),
    TypeError,
    "fixed_region is not the supported reviewed rear-face condition",
  );

  assertEquals(calls, 0);
  assertEquals(captures.preparedPaths, []);
  assertEquals(captures.releasedPaths, []);
});

class FakeSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(
    protected constraints: unknown[],
    private readonly children: unknown[] = [],
  ) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (call.name === "syson_constraint_extract") {
      return Promise.resolve({
        text: "constraints",
        structuredContent: { constraints: structuredClone(this.constraints) },
      });
    }
    if (call.name === "syson_element_children") {
      return Promise.resolve({
        text: "children",
        structuredContent: {
          parentId: call.arguments?.element_id,
          children: structuredClone(this.children),
          count: this.children.length,
        },
      });
    }
    if (call.name === "syson_element_insert_sysml") {
      this.constraints = approvedConstraints();
      return Promise.resolve({
        text: "inserted",
        structuredContent: {
          inserted: true,
          parentId: call.arguments?.parent_id,
          text: call.arguments?.sysml_text,
        },
      });
    }
    if (call.name === "syson_constraint_evaluate") {
      return Promise.resolve({
        text: "2 pass",
        structuredContent: {
          results: this.constraints.map((constraint, index) => ({
            constraintId: (constraint as { id: string }).id,
            constraintName: (constraint as { name: string }).name,
            status: "pass",
            expression: index === 0
              ? "assembly_max_displacement <= 1 [mm]"
              : "assembly_max_von_mises <= 20000000 [Pa]",
          })),
          summary: { total: 2, pass: 2, fail: 0, error: 0, unresolved: 0 },
          resolvedValues: {
            assembly_max_displacement: { value: 0.2, unit: "mm" },
            assembly_max_von_mises: { value: 4, unit: "MPa" },
          },
        },
      });
    }
    return Promise.reject(new Error(`Unexpected SysON call: ${call.name}`));
  }
}

class SequencedConstraintSyson extends FakeSyson {
  #extractions: unknown[][];

  constructor(extractions: unknown[][]) {
    super([]);
    this.#extractions = extractions.map((constraints) => structuredClone(constraints));
  }

  override callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name !== "syson_constraint_extract") return super.callTool(call);
    this.calls.push(structuredClone(call));
    const constraints = this.#extractions.shift() ?? [];
    this.constraints = structuredClone(constraints);
    return Promise.resolve({
      text: "constraints",
      structuredContent: { constraints },
    });
  }
}

class FakeCalculix implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return Promise.resolve({
      text: "solved",
      structuredContent: {
        inputArtifact: {
          path: "/runs/cm01/input.step",
          sha256: STEP_SHA,
          bytes: 2048,
        },
        metrics: {
          maxDisplacement: { value: 0.2, unit: "mm" },
          maxVonMises: { value: 4, unit: "MPa" },
        },
      },
    });
  }
}

function fakeBuildClient(): { client: McpToolClient; calls: McpToolCall[] } {
  const calls: McpToolCall[] = [];
  return {
    calls,
    client: {
      callTool(call) {
        calls.push(structuredClone(call));
        return Promise.resolve({
          text: "exported",
          structuredContent: {
            schemaVersion: "2.0",
            kind: "export",
            metrics: {},
            files: [{
              format: "step",
              path: "/exports/cm01-drip-tray.step",
              bytes: 1024,
              sha256: STEP_SHA,
            }],
          },
        });
      },
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    },
  };
}

class MemoryCaptureStore implements MechanicalCaptureStore {
  readonly preparedPaths: string[] = [];
  readonly releasedPaths: string[] = [];
  readonly paths: string[] = [];
  readonly contents: string[] = [];

  prepare(path: string): Promise<void> {
    this.preparedPaths.push(path);
    return Promise.resolve();
  }

  persist(path: string, contents: string): Promise<void> {
    this.paths.push(path);
    this.contents.push(contents);
    return Promise.resolve();
  }

  release(path: string): Promise<void> {
    this.releasedPaths.push(path);
    return Promise.resolve();
  }
}

async function assertWorkflowRejectedBeforeIo(
  readCanonicalWorkflowForTest: (path: string | URL) => Promise<string>,
  message: string,
): Promise<void> {
  let providerCalls = 0;
  const forbidden: McpToolClient = {
    callTool: () => {
      providerCalls++;
      return Promise.reject(new Error("provider must not be called"));
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const updates = new LiveThreadUpdateStore();
  const captures = new MemoryCaptureStore();

  await assertRejects(
    () =>
      runCoffeeMachineMechanical({
        runId: RUN_ID,
        projectSnapshot: {} as EngineeringProjectSnapshot,
        sysonClient: forbidden,
        build123dClient: forbidden,
        calculixClient: forbidden,
        liveUpdates: updates,
        captureStore: captures,
        readCanonicalWorkflowForTest,
      }),
    Error,
    message,
  );
  assertEquals(providerCalls, 0);
  assertEquals(captures.preparedPaths, []);
  assertEquals(captures.releasedPaths, []);
  assertEquals(captures.paths, []);
  assertEquals(captures.contents, []);
  assertEquals(await updates.list("coffee-machine-cm01"), []);
}

function approvedConstraints(): unknown[] {
  return [
    constraint("constraint-displacement", "assembly_max_displacement", 1, "mm"),
    constraint("constraint-stress", "assembly_max_von_mises", 20_000_000, "Pa"),
  ];
}

function preflightGraph(label: string) {
  return {
    nodes: [{
      id: `graph:artifact:${RUN_ID}:requirements`,
      ref: { kind: "artifact" as const, id: `${RUN_ID}:requirements` },
      entityKind: "artifact" as const,
      artifactKind: "sysml-constraints",
      label,
      system: "mcp-syson",
      freshness: "failed" as const,
      summary: `${label} failed`,
    }],
    edges: [],
  };
}

function constraint(id: string, feature: string, value: number, unit: string) {
  return {
    id,
    name: id,
    sourceId: id,
    expression: {
      kind: "binary",
      op: "<=",
      left: { kind: "ref", featurePath: [feature] },
      right: { kind: "literal", value, unit },
    },
  };
}

async function authorizedProject(
  parameters = proposalParameters(),
): Promise<EngineeringProjectSnapshot> {
  const { service, store } = await projectControl();
  let project = await propose(service, store, parameters);
  const decision = project.decisions.find((item) =>
    item.id === "review-mechanical-proof-case"
  )!;
  project = await service.approveDecision(HUMAN, {
    commandId: "human-approve-proof",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:00:02.000Z",
    decisionId: decision.id,
    rationale: "Explicitly reviewed for the test.",
    inputFingerprint: decision.inputFingerprint!,
  });
  project = await service.queueRun(HUMAN, {
    commandId: "human-queue-proof",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:00:03.000Z",
    runId: RUN_ID,
    workItemId: "verify-current-mechanical-design",
    summary: "Run the reviewed proof.",
    baseSnapshot: project.threadSnapshots[0],
  });
  return await service.claimRun(AGENT, {
    commandId: "agent-claim-proof",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:00:04.000Z",
    runId: RUN_ID,
    summary: "Execute the reviewed proof.",
  });
}

async function queuedProject(): Promise<EngineeringProjectSnapshot> {
  const { service, store } = await projectControl();
  let project = await propose(service, store);
  const decision = project.decisions.find((item) =>
    item.id === "review-mechanical-proof-case"
  )!;
  project = await service.approveDecision(HUMAN, {
    commandId: "human-approve-proof",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:00:02.000Z",
    decisionId: decision.id,
    rationale: "Explicitly reviewed for the test.",
    inputFingerprint: decision.inputFingerprint!,
  });
  return await service.queueRun(HUMAN, {
    commandId: "human-queue-proof",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:00:03.000Z",
    runId: RUN_ID,
    workItemId: "verify-current-mechanical-design",
    summary: "Run the reviewed proof.",
    baseSnapshot: project.threadSnapshots[0],
  });
}

async function propose(
  service: EngineeringProjectCommandService,
  store: MemoryProjectStore,
  parameters = proposalParameters(),
): Promise<EngineeringProjectSnapshot> {
  const project = (await store.get("coffee-machine-cm01"))!;
  return await service.proposeDecision(AGENT, {
    commandId: "agent-propose-proof",
    projectId: project.project.id,
    expectedRevision: project.revision,
    issuedAt: "2026-08-01T10:00:01.000Z",
    decisionId: "review-mechanical-proof-case",
    proposal: {
      summary: "One bounded component proof.",
      parameters,
    },
    baseSnapshot: project.threadSnapshots[0],
  });
}

function proposalParameters(): EngineeringDecisionProposalParameter[] {
  return [
    {
      key: "analysis_scope",
      label: "Part and scope",
      value: "CM-01 drip tray; isolated current CAD component, 190 x 135 x 28 mm",
    },
    {
      key: "material_basis",
      label: "Material basis",
      value: "ABS-like concept model",
    },
    { key: "young_modulus_mpa", label: "Young modulus", value: 2200, unit: "MPa" },
    { key: "poisson_ratio", label: "Poisson ratio", value: 0.35, unit: "1" },
    { key: "fixed_region", label: "Support", value: "Rear vertical face fully fixed" },
    {
      key: "load_case",
      label: "Reference load",
      value:
        "100 N total downward force on the front vertical face (about 10 kg static load)",
    },
    { key: "mesh_size_mm", label: "Target mesh size", value: 5, unit: "mm" },
    {
      key: "max_von_mises_mpa",
      label: "Preliminary stress limit",
      value: 20,
      unit: "MPa",
    },
    {
      key: "max_displacement_mm",
      label: "Preliminary displacement limit",
      value: 1,
      unit: "mm",
    },
    {
      key: "evidence_boundary",
      label: "Evidence boundary",
      value: "Concept verification only",
    },
  ];
}

async function projectControl(): Promise<{
  store: MemoryProjectStore;
  service: EngineeringProjectCommandService;
}> {
  const initial = JSON.parse(await Deno.readTextFile(CONFIG));
  const store = new MemoryProjectStore(initial);
  let tick = 0;
  return {
    store,
    service: new EngineeringProjectCommandService(
      store,
      undefined,
      () => new Date(Date.UTC(2026, 7, 2, 10, 0, ++tick)).toISOString(),
    ),
  };
}

class MemoryProjectStore implements EngineeringProjectRevisionStore {
  readonly revisions = new Map<number, EngineeringProjectSnapshot>();

  constructor(initial: EngineeringProjectSnapshot) {
    this.revisions.set(initial.revision, structuredClone(initial));
  }

  get(_projectId: string): Promise<EngineeringProjectSnapshot | undefined> {
    const latest = Math.max(...this.revisions.keys());
    return Promise.resolve(structuredClone(this.revisions.get(latest)));
  }

  getRevision(
    _projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    return Promise.resolve(structuredClone(this.revisions.get(revision)));
  }

  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot> {
    if (this.revisions.size > 0) {
      return Promise.reject(new EngineeringProjectStoreConflictError("exists"));
    }
    this.revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }

  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot> {
    const current = Math.max(...this.revisions.keys());
    if (current !== expectedRevision) {
      return Promise.reject(new EngineeringProjectStoreConflictError("stale"));
    }
    this.revisions.set(snapshot.revision, structuredClone(snapshot));
    return Promise.resolve(structuredClone(snapshot));
  }
}

function fixedNow(): Date {
  return new Date("2026-08-02T06:00:00.000Z");
}

function incrementingClock(): () => number {
  let value = 0;
  return () => value++;
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
