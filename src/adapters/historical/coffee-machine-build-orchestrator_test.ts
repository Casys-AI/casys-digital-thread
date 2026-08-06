import {
  assertEquals,
  assertMatch,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../mcp/http-mcp-tool-client.ts";
import {
  type CoffeeMachineBuildDeclaration,
  CoffeeMachineBuildOrchestrator,
} from "./coffee-machine-build-orchestrator.ts";
import type {
  CoffeeMachineBuildTemplateId,
  CoffeeMachineSourceUnitBinding,
} from "../../domain/cm01/coffee-machine-build-plan.ts";

const NOW = "2026-08-01T09:10:11.000Z";
const EDITING_CONTEXT_ID = uuid(1);
const ROOT_PART_DEFINITION_ID = uuid(2);

Deno.test("CoffeeMachine orchestrator is deterministic and performs the exact ordered calls", async () => {
  const fixture = buildFixture();
  const firstSyson = sysonClient(fixture.values);
  const firstBuild = exportClient(["stl", "step", "gltf"]);
  const first = await orchestrator(firstSyson, firstBuild).run(
    fixture.declaration,
  );

  const reordered = structuredClone(fixture.declaration);
  reordered.partUsageIds.reverse();
  reordered.sourceBindings.reverse();
  reordered.components.reverse();
  reordered.components.forEach((component) => component.bindings.reverse());
  const secondSyson = sysonClient(fixture.values);
  const secondBuild = exportClient(["gltf", "stl", "step"]);
  const second = await orchestrator(secondSyson, secondBuild).run(reordered);

  assertEquals(second, first);
  assertEquals(first.schemaVersion, "coffee-machine-build-run/1.0");
  assertEquals(first.capturedAt, NOW);
  const expectedAttributeIds = fixture.declaration.sourceBindings.map((binding) =>
    binding.id
  ).sort();
  assertEquals(
    firstSyson.calls.map((call) => call.arguments?.element_id),
    expectedAttributeIds,
  );
  assertEquals(first.sourceCapture.source.exactAttributeIds, expectedAttributeIds);
  assertEquals(firstBuild.calls.length, 1);
  assertEquals(firstBuild.calls[0], first.toolCall);
  assertEquals(first.toolCall.name, "build123d_export");
  assertEquals(first.toolCall.arguments.formats, ["step", "gltf", "stl"]);
  assertEquals(first.toolCall.arguments.timeout_ms, 120000);
  assertEquals(first.toolCall.arguments.script, first.compiledPlan.script);
  assertEquals(
    first.toolCall.arguments.name,
    `coffee-machine-${first.compiledPlan.plan.fingerprints.plan.digest.slice(0, 16)}`,
  );
  assertMatch(first.toolCall.arguments.name, /^coffee-machine-[a-f0-9]{16}$/);
  assertStringIncludes(
    first.compiledPlan.script,
    'result = Compound(label="coffee-machine-cm01-build-v1", children=components)',
  );
  assertEquals(
    first.result.files.map((file) => file.format),
    ["step", "gltf", "stl"],
  );
  assertEquals(JSON.parse(JSON.stringify(first)), first);
});

Deno.test("CoffeeMachine orchestrator has no persistence input and never retries build123d", async () => {
  const fixture = buildFixture();
  const syson = sysonClient(fixture.values);
  const build = new RecordedClient(() => Promise.reject(new Error("build failed")));
  await assertRejects(
    () => orchestrator(syson, build).run(fixture.declaration),
    Error,
    "build failed",
  );
  assertEquals(build.calls.length, 1);
});

Deno.test("CoffeeMachine declaration rejects caller script, output path, bad UUIDs and duplicates before I/O", async () => {
  const fixture = buildFixture();
  for (
    const invalid of [
      { ...fixture.declaration, script: "import os" },
      { ...fixture.declaration, outputPath: "/tmp/result.step" },
      { ...fixture.declaration, name: "caller-controlled" },
    ]
  ) {
    const syson = sysonClient(fixture.values);
    const build = exportClient();
    await assertRejects(
      () => orchestrator(syson, build).run(invalid),
      TypeError,
      "unsupported field",
    );
    assertEquals(syson.calls, []);
    assertEquals(build.calls, []);
  }

  const badUuid = structuredClone(fixture.declaration);
  badUuid.partUsageIds[0] = "part-by-label";
  const duplicate = structuredClone(fixture.declaration);
  duplicate.sourceBindings[1].id = duplicate.sourceBindings[0].id;
  for (const invalid of [badUuid, duplicate]) {
    const syson = sysonClient(fixture.values);
    const build = exportClient();
    await assertRejects(() => orchestrator(syson, build).run(invalid));
    assertEquals(syson.calls, []);
    assertEquals(build.calls, []);
  }
});

Deno.test("CoffeeMachine orchestrator stops before build123d on an exact SysON identity mismatch", async () => {
  const fixture = buildFixture();
  const expectedFirstId =
    fixture.declaration.sourceBindings.map((binding) => binding.id).sort()[0];
  const syson = new RecordedClient((call) => {
    const requestedId = String(call.arguments?.element_id);
    const returnedId = requestedId === expectedFirstId ? uuid(999_999) : requestedId;
    const value = fixture.values.get(requestedId)!;
    return Promise.resolve(valueRead(returnedId, value));
  });
  const build = exportClient();
  await assertRejects(
    () => orchestrator(syson, build).run(fixture.declaration),
    Error,
    "element_id must exactly match requested attribute",
  );
  assertEquals(build.calls, []);
});

Deno.test("CoffeeMachine orchestrator rejects an export that is not fully attested", async () => {
  const fixture = buildFixture();
  const cases: Array<Record<string, unknown>> = [
    exportPayload(["step", "gltf"]),
    {
      ...exportPayload(),
      files: [
        ...exportPayload().files.slice(0, 2),
        {
          ...exportPayload().files[2],
          sha256: "ABCDEF",
        },
      ],
    },
    {
      ...exportPayload(),
      files: [
        { ...exportPayload().files[0], path: "/exports/../escape.step" },
        ...exportPayload().files.slice(1),
      ],
    },
    {
      ...exportPayload(),
      files: [
        ...exportPayload().files,
        { ...exportPayload().files[0] },
      ],
    },
    {
      ...exportPayload(),
      metrics: { volume_mm3: Number.NaN },
    },
  ];

  for (const payload of cases) {
    const syson = sysonClient(fixture.values);
    const build = new RecordedClient(() =>
      Promise.resolve({ text: "bad export", structuredContent: payload })
    );
    await assertRejects(
      () => orchestrator(syson, build).run(fixture.declaration),
    );
    assertEquals(build.calls.length, 1);
  }
});

class RecordedClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(
    private readonly handler: (call: McpToolCall) => Promise<McpToolResult>,
  ) {}

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return this.handler(call);
  }
}

function orchestrator(
  sysonClient: McpToolClient,
  build123dClient: McpToolClient,
): CoffeeMachineBuildOrchestrator {
  return new CoffeeMachineBuildOrchestrator({
    sysonClient,
    build123dClient,
    now: () => new Date(NOW),
  });
}

function sysonClient(values: ReadonlyMap<string, number>): RecordedClient {
  return new RecordedClient((call) => {
    const id = String(call.arguments?.element_id);
    const value = values.get(id);
    if (value === undefined) return Promise.reject(new Error(`unknown ${id}`));
    return Promise.resolve(valueRead(id, value));
  });
}

function valueRead(id: string, value: number): McpToolResult {
  return {
    text: `read ${id}`,
    structuredContent: {
      element_id: id,
      value,
      literal_id: literalUuid(id),
      literal_kind: "LiteralInteger",
      negated: value < 0,
    },
  };
}

function exportClient(
  order: Array<"step" | "gltf" | "stl"> = ["step", "gltf", "stl"],
): RecordedClient {
  return new RecordedClient(() =>
    Promise.resolve({
      text: "exported",
      structuredContent: exportPayload(order),
    })
  );
}

function exportPayload(
  order: Array<"step" | "gltf" | "stl"> = ["step", "gltf", "stl"],
): Record<string, unknown> & { files: Array<Record<string, unknown>> } {
  const files = {
    step: {
      format: "step",
      path: "/exports/coffee-machine.step",
      bytes: 12345,
      sha256: "1".repeat(64),
      viewer: { ignored: true },
    },
    gltf: {
      format: "gltf",
      path: "/exports/coffee-machine.glb",
      bytes: 6789,
      sha256: "2".repeat(64),
    },
    stl: {
      format: "stl",
      path: "/exports/coffee-machine.stl",
      bytes: 4567,
      sha256: "3".repeat(64),
    },
  };
  return {
    schemaVersion: "1.0",
    kind: "export",
    metrics: {
      volume_mm3: 42,
      bounds: { min: [-1, -2, -3], max: [1, 2, 3] },
    },
    files: order.map((format) => files[format]),
  };
}

interface Fixture {
  declaration: CoffeeMachineBuildDeclaration;
  values: Map<string, number>;
}

function buildFixture(): Fixture {
  const sourceBindings: CoffeeMachineBuildDeclaration["sourceBindings"] = [];
  const values = new Map<string, number>();
  let nextAttribute = 100;
  const addAttribute = (
    value: number,
    unitBinding: CoffeeMachineSourceUnitBinding,
  ): string => {
    const id = uuid(nextAttribute++);
    sourceBindings.push({ id, unitBinding });
    values.set(id, value);
    return id;
  };
  const components = COMPONENTS.map((definition, index) => ({
    id: `component-${index}`,
    partUsageId: uuid(10 + index),
    templateId: definition.templateId,
    bindings: Object.entries(definition.values).map(([parameter, value]) => ({
      parameter,
      attributeId: addAttribute(value, MM),
    })),
    placement: {
      translationAttributeIds: definition.translationMm.map((value) =>
        addAttribute(value, MM)
      ) as [string, string, string],
      rotationAttributeIds: (definition.rotationDeg ?? [0, 0, 0]).map((value) =>
        addAttribute(value, DEG)
      ) as [string, string, string],
    },
  }));
  return {
    declaration: {
      schemaVersion: "coffee-machine-build-declaration/1.0",
      id: "coffee-machine-cm01-build-v1",
      editingContextId: EDITING_CONTEXT_ID,
      rootPartDefinitionId: ROOT_PART_DEFINITION_ID,
      partUsageIds: components.map((component) => component.partUsageId),
      sourceBindings,
      envelopeMm: { min: [-500, -500, -500], max: [500, 500, 500] },
      components,
    },
    values,
  };
}

const MM = {
  sourceUnit: "mm",
  targetUnit: "mm",
  scaleToTarget: 1,
} as const;
const DEG = {
  sourceUnit: "deg",
  targetUnit: "deg",
  scaleToTarget: 1,
} as const;

const COMPONENTS: Array<{
  templateId: CoffeeMachineBuildTemplateId;
  values: Record<string, number>;
  translationMm: [number, number, number];
  rotationDeg?: [number, number, number];
}> = [
  {
    templateId: "enclosure-shell-v1",
    values: { size_x: 300, size_y: 250, size_z: 400, wall_thickness: 3 },
    translationMm: [0, 0, 0],
  },
  {
    templateId: "hollow-box-v1",
    values: { size_x: 100, size_y: 80, size_z: 90, wall_thickness: 2 },
    translationMm: [-180, -150, -120],
  },
  {
    templateId: "solid-box-v1",
    values: { size_x: 60, size_y: 50, size_z: 40 },
    translationMm: [180, -150, -120],
  },
  {
    templateId: "cylinder-v1",
    values: { diameter: 80, height: 100 },
    translationMm: [-180, 150, -120],
  },
  {
    templateId: "thin-panel-v1",
    values: { size_x: 100, size_y: 70, thickness: 2 },
    translationMm: [180, 150, -120],
    rotationDeg: [-90, 0, 0],
  },
  {
    templateId: "tray-v1",
    values: { size_x: 120, size_y: 90, size_z: 24, wall_thickness: 2 },
    translationMm: [-180, -150, 140],
  },
  {
    templateId: "solid-box-v1",
    values: { size_x: 80, size_y: 40, size_z: 25 },
    translationMm: [180, -150, 140],
  },
  {
    templateId: "cylinder-v1",
    values: { diameter: 50, height: 70 },
    translationMm: [-180, 150, 140],
    rotationDeg: [0, 90, 0],
  },
  {
    templateId: "thin-panel-v1",
    values: { size_x: 90, size_y: 50, thickness: 3 },
    translationMm: [180, 150, 140],
  },
  {
    templateId: "hollow-box-v1",
    values: { size_x: 70, size_y: 60, size_z: 80, wall_thickness: 2 },
    translationMm: [0, 0, 250],
  },
];

function uuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString(16).padStart(12, "0")}`;
}

function literalUuid(attributeId: string): string {
  const tail = attributeId.slice(-12);
  return `10000000-0000-4000-8000-${tail}`;
}
