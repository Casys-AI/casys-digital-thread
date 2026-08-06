import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../mcp/http-mcp-tool-client.ts";
import {
  type CoffeeMachineBuildDeclaration,
  CoffeeMachineBuildOrchestrator,
  type CoffeeMachineBuildRunCapture,
} from "./coffee-machine-build-orchestrator.ts";
import { materializeCoffeeMachineBuildRunExtension } from "./coffee-machine-build-run-extension.ts";

const NOW = "2026-08-01T09:10:11.000Z";
const RUN_ID = "cm01-run-42";
const SOURCE_URI = "state/local/coffee-machine-build-run.json";
const DECLARATION_URL = new URL(
  "../../../config/thread-subjects/coffee-machine-cm01.build.json",
  import.meta.url,
);

Deno.test("CoffeeMachine build capture projects the complete hash-exact causal chain with stable run IDs and no verdict", async () => {
  const capture = await buildCapture();
  const extension = await materializeCoffeeMachineBuildRunExtension(capture, {
    runId: RUN_ID,
    sourceUri: SOURCE_URI,
  });
  const repeated = await materializeCoffeeMachineBuildRunExtension(capture, {
    runId: RUN_ID,
    sourceUri: SOURCE_URI,
  });

  assertEquals(extension, repeated);
  assertEquals(extension.id, "coffee-machine-build-cm01-run-42-extension");
  assertEquals(extension.subjectId, "coffee-machine-cm01");
  assertEquals(extension.capturedAt, NOW);
  assertEquals(extension.artifacts.map((item) => item.id), [
    "coffee-machine-build-cm01-run-42-syson-source",
    "coffee-machine-build-cm01-run-42-plan",
    "coffee-machine-build-cm01-run-42-script",
    "coffee-machine-build-cm01-run-42-step",
    "coffee-machine-build-cm01-run-42-gltf",
    "coffee-machine-build-cm01-run-42-stl",
  ]);
  assertEquals(
    extension.artifacts.map((item) => item.inputArtifactIds),
    [
      [],
      ["coffee-machine-build-cm01-run-42-syson-source"],
      ["coffee-machine-build-cm01-run-42-plan"],
      ["coffee-machine-build-cm01-run-42-script"],
      ["coffee-machine-build-cm01-run-42-script"],
      ["coffee-machine-build-cm01-run-42-script"],
    ],
  );
  assertEquals(
    extension.artifacts.map((item) => item.producer),
    [
      { serverId: "syson", tool: "syson_value_read", runId: RUN_ID },
      {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_build_plan",
        runId: RUN_ID,
      },
      {
        serverId: "digital-thread",
        tool: "compile_coffee_machine_build_plan",
        runId: RUN_ID,
      },
      { serverId: "build123d", tool: "build123d_export", runId: RUN_ID },
      { serverId: "build123d", tool: "build123d_export", runId: RUN_ID },
      { serverId: "build123d", tool: "build123d_export", runId: RUN_ID },
    ],
  );

  const expectedDigests = [
    capture.sourceCapture.sourceFingerprint.digest,
    capture.compiledPlan.plan.fingerprints.plan.digest,
    capture.compiledPlan.plan.fingerprints.script.digest,
    ...capture.result.files.map((file) => file.sha256),
  ];
  assertEquals(
    extension.artifacts.map((item) => item.fingerprint.digest),
    expectedDigests,
  );
  assertEquals(
    extension.artifacts.map((item) => item.version),
    expectedDigests,
  );
  assertEquals(
    extension.provenance.filter((link) => link.relation === "derived_from")
      .map((link) => [link.from.id, link.to.id]),
    [
      [
        "coffee-machine-build-cm01-run-42-plan",
        "coffee-machine-build-cm01-run-42-syson-source",
      ],
      [
        "coffee-machine-build-cm01-run-42-script",
        "coffee-machine-build-cm01-run-42-plan",
      ],
      [
        "coffee-machine-build-cm01-run-42-step",
        "coffee-machine-build-cm01-run-42-script",
      ],
      [
        "coffee-machine-build-cm01-run-42-gltf",
        "coffee-machine-build-cm01-run-42-script",
      ],
      [
        "coffee-machine-build-cm01-run-42-stl",
        "coffee-machine-build-cm01-run-42-script",
      ],
    ],
  );
  assertEquals(
    extension.consumptions.map((item) => [
      item.artifactId,
      item.consumer.serverId,
      item.observedFingerprint.digest,
      item.status,
    ]),
    [
      [
        "coffee-machine-build-cm01-run-42-syson-source",
        "digital-thread",
        capture.sourceCapture.sourceFingerprint.digest,
        "verified",
      ],
      [
        "coffee-machine-build-cm01-run-42-plan",
        "digital-thread",
        capture.compiledPlan.plan.fingerprints.plan.digest,
        "verified",
      ],
      [
        "coffee-machine-build-cm01-run-42-script",
        "build123d",
        capture.compiledPlan.plan.fingerprints.script.digest,
        "verified",
      ],
    ],
  );
  assertEquals(extension.observations, []);
  assertEquals(extension.requirements, []);
  assertEquals(extension.evaluations, []);
  assertEquals(extension.violations, []);
  assertEquals(extension.proposedActions, []);
});

Deno.test("CoffeeMachine build projection rejects source, plan, tool-call and file tampering", async () => {
  const sourceTamper = await buildCapture();
  sourceTamper.sourceCapture.source.reads[0].structuredContent.value += 1;

  const planTamper = await buildCapture();
  planTamper.compiledPlan.plan.fingerprints.plan.digest = "f".repeat(64);

  const toolCallTamper = await buildCapture();
  toolCallTamper.toolCall.arguments.script += "\n# injected";

  const fileTamper = await buildCapture();
  fileTamper.result.files[0].sha256 = "not-a-sha256";

  for (
    const [tampered, expected] of [
      [sourceTamper, "does not match canonical source bytes"],
      [planTamper, "does not match canonical plan bytes"],
      [toolCallTamper, "arguments.script"],
      [fileTamper, "lowercase SHA-256 digest"],
    ] as const
  ) {
    await assertRejects(
      () =>
        materializeCoffeeMachineBuildRunExtension(tampered, {
          runId: RUN_ID,
        }),
      Error,
      expected,
    );
  }
});

async function buildCapture(): Promise<CoffeeMachineBuildRunCapture> {
  const declaration = JSON.parse(
    await Deno.readTextFile(DECLARATION_URL),
  ) as CoffeeMachineBuildDeclaration;
  const values = valuesFor(declaration);
  const sysonClient = new FixtureClient((call) => {
    const elementId = String(call.arguments?.element_id);
    const value = values.get(elementId);
    if (value === undefined) {
      throw new Error(`Missing fixture value for ${elementId}.`);
    }
    return {
      text: `read ${elementId}`,
      structuredContent: {
        element_id: elementId,
        value,
        literal_id: elementId,
        literal_kind: "LiteralInteger",
        negated: value < 0,
      },
    };
  });
  const build123dClient = new FixtureClient(() => ({
    text: "exported",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "export",
      metrics: {
        volume_mm3: 123456,
        bounds: { min: [-20, -15, -10], max: [20, 15, 10] },
      },
      files: [
        {
          format: "step",
          path: "/exports/coffee-machine.step",
          bytes: 12345,
          sha256: "1".repeat(64),
        },
        {
          format: "gltf",
          path: "/exports/coffee-machine.glb",
          bytes: 6789,
          sha256: "2".repeat(64),
        },
        {
          format: "stl",
          path: "/exports/coffee-machine.stl",
          bytes: 4567,
          sha256: "3".repeat(64),
        },
      ],
    },
  }));
  return await new CoffeeMachineBuildOrchestrator({
    sysonClient,
    build123dClient,
    now: () => new Date(NOW),
  }).run(declaration);
}

function valuesFor(
  declaration: CoffeeMachineBuildDeclaration,
): Map<string, number> {
  const values = new Map<string, number>();
  for (const component of declaration.components) {
    for (const binding of component.bindings) {
      values.set(binding.attributeId, dimension(binding.parameter));
    }
    for (const id of component.placement.translationAttributeIds) {
      values.set(id, 0);
    }
    for (const id of component.placement.rotationAttributeIds) {
      values.set(id, 0);
    }
  }
  return values;
}

function dimension(parameter: string): number {
  switch (parameter) {
    case "size_x":
      return 40;
    case "size_y":
      return 30;
    case "size_z":
    case "height":
      return 20;
    case "diameter":
      return 10;
    case "wall_thickness":
    case "thickness":
      return 2;
    default:
      throw new Error(`Unknown fixture parameter ${parameter}.`);
  }
}

class FixtureClient implements McpToolClient {
  constructor(
    private readonly handler: (call: McpToolCall) => McpToolResult,
  ) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    return Promise.resolve(this.handler(call));
  }
}
