import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { sampleAgentResourceReference } from "../../testing/agent-resource-test-support.ts";
import { registerProjectLedDriverSourceTools } from "./led-driver-source-tools.ts";

Deno.test("LED-driver source tools register capture and review independently", () => {
  const absent = new CapturingApp();
  registerProjectLedDriverSourceTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_led_driver_source_capture"), false);
  assertEquals(absent.hasTool("project_led_driver_source_review"), false);

  const captureOnly = new CapturingApp();
  registerProjectLedDriverSourceTools(captureOnly as unknown as McpApp, {
    ledDriverSourceCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(captureOnly.toolNames(), ["project_led_driver_source_capture"]);

  const reviewOnly = new CapturingApp();
  registerProjectLedDriverSourceTools(reviewOnly as unknown as McpApp, {
    ledDriverSourceReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(reviewOnly.toolNames(), ["project_led_driver_source_review"]);

  const both = new CapturingApp();
  registerProjectLedDriverSourceTools(both as unknown as McpApp, {
    ledDriverSourceCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
    ledDriverSourceReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(both.toolNames(), [
    "project_led_driver_source_capture",
    "project_led_driver_source_review",
  ]);
});

Deno.test("project_led_driver_source_capture is a draft CAS write and stays reference-only downstream", async () => {
  const app = new CapturingApp();
  const calls: unknown[] = [];
  const review = Object.freeze({
    schemaVersion: "led-driver-source-capture-review/1.0",
    status: "unresolved",
    reference: Object.freeze({
      schemaVersion: "led-driver-source-capture/1.0",
      kind: "led-driver-source",
      identity: Object.freeze({ id: "fiche.led-driver.desk-lamp", revision: 1 }),
    }),
    circuit: Object.freeze({ id: "circuit.led-driver", name: "led-driver" }),
    testCondition: Object.freeze({
      id: "condition.reviewed-supply",
      name: "reviewed-supply",
    }),
    unknowns: Object.freeze({
      status: "unresolved",
      items: Object.freeze([]),
    }),
    grants: "none",
  });
  registerProjectLedDriverSourceTools(app as unknown as McpApp, {
    ledDriverSourceCapture: {
      capture(command) {
        calls.push(command);
        return Promise.resolve(review as never);
      },
    },
  });

  const resourceRef = sampleAgentResourceReference({
    name: "led-driver.json",
    mimeType: "application/json",
  });
  const result = await app.handler("project_led_driver_source_capture")({
    resourceRef,
  }) as Record<string, unknown>;
  assert(result.structuredContent === review);
  assertEquals(calls, [{ resourceRef }]);
  assertStringIncludes(result.content as string, "result.reference");
  assertStringIncludes(result.content as string, "project_led_driver_source_review");
  assertStringIncludes(
    result.content as string,
    "no EngineeringProject or Thread state",
  );
  assertStringIncludes(result.content as string, "no MRTR decision");
  assertStringIncludes(result.content as string, "no execution authority");

  const tool = app.tool("project_led_driver_source_capture");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assertStringIncludes(tool.description, "led-driver-human-source/1.0");
  assertStringIncludes(tool.description, "draft CAS");
  assertStringIncludes(tool.description, "Pass result.reference");
  assertStringIncludes(tool.description, "project_led_driver_source_review");
  assertStringIncludes(tool.description, "no EngineeringProject or Thread state");
  assertStringIncludes(tool.description, "no MRTR decision");
  assertStringIncludes(tool.description, "no technical execution");
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>), [
    "resourceRef",
  ]);
  assertEquals(schema.additionalProperties, false);
  assertEquals("sourceText" in (schema.properties as Record<string, unknown>), false);
  assertEquals(
    Object.keys(
      (tool.outputSchema as { properties: Record<string, unknown> }).properties,
    ).sort(),
    [
      "circuit",
      "grants",
      "reference",
      "schemaVersion",
      "status",
      "testCondition",
      "unknowns",
    ],
  );

  await assertRejects(
    () =>
      app.handler("project_led_driver_source_capture")({
        resourceRef,
        provider: "ngspice",
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): provider",
  );
  await assertRejects(
    () =>
      app.handler("project_led_driver_source_capture")({
        resourceRef,
        supplyVoltage: 12,
      }) as Promise<unknown>,
    TypeError,
    "unsupported field(s): supplyVoltage",
  );
  assertEquals(calls.length, 1);
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected ${name} handler to be registered.`);
    return handler;
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    assert(tool, `Expected ${name} tool to be registered.`);
    return tool;
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  toolNames(): string[] {
    return [...this.#tools.keys()];
  }
}
