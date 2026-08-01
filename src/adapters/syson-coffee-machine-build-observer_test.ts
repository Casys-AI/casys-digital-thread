import { assertEquals, assertMatch, assertRejects, assertThrows } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "./http-mcp-tool-client.ts";
import { SysonCoffeeMachineBuildObserver } from "./syson-coffee-machine-build-observer.ts";

const EDITING_CONTEXT_ID = "01942665-6cce-35fa-a7de-94588419c4a8";
const ROOT_PART_DEFINITION_ID = "11111111-1111-4111-8111-111111111111";
const ATTRIBUTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ATTRIBUTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LITERAL_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LITERAL_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

Deno.test("SysON build observer preserves requested order and a stable canonical fingerprint", async () => {
  const firstClient = new RecordedClient((call) => {
    const id = String(call.arguments?.element_id);
    return id === ATTRIBUTE_A
      ? delayedResult(valueResult(ATTRIBUTE_A, LITERAL_A, -12, true), 10)
      : delayedResult(valueResult(ATTRIBUTE_B, LITERAL_B, 0, false), 0);
  });
  const first = await observer(firstClient, "2026-08-01T05:00:00.000Z")
    .observe();

  const secondClient = new RecordedClient((call) => {
    const id = String(call.arguments?.element_id);
    return Promise.resolve(
      id === ATTRIBUTE_A
        ? valueResultWithReorderedKeys(ATTRIBUTE_A, LITERAL_A, -12, true)
        : valueResultWithReorderedKeys(ATTRIBUTE_B, LITERAL_B, 0, false),
    );
  });
  const second = await observer(secondClient, "2027-01-01T00:00:00.000Z")
    .observe();

  assertEquals(first.source.reads.map((read) => read.arguments.element_id), [
    ATTRIBUTE_A,
    ATTRIBUTE_B,
  ]);
  assertEquals(firstClient.calls, [
    {
      name: "syson_value_read",
      arguments: {
        editing_context_id: EDITING_CONTEXT_ID,
        element_id: ATTRIBUTE_A,
      },
    },
    {
      name: "syson_value_read",
      arguments: {
        editing_context_id: EDITING_CONTEXT_ID,
        element_id: ATTRIBUTE_B,
      },
    },
  ]);
  assertEquals(first.schemaVersion, "syson-coffee-machine-build-source/1.0");
  assertEquals(first.source, second.source);
  assertEquals(first.sourceFingerprint, second.sourceFingerprint);
  assertMatch(first.sourceFingerprint.digest, /^[a-f0-9]{64}$/);
  assertEquals(
    first.sourceFingerprint.digest,
    "3159d3ca89523429cc1e5aa491fe614fbe33f9209d04a659bac6081332c35676",
  );
});

Deno.test("SysON build observer rejects an element_id mismatch", async () => {
  const client = new RecordedClient(() =>
    Promise.resolve(valueResult(ATTRIBUTE_B, LITERAL_A, 12, false))
  );
  await assertRejects(
    () => observer(client, undefined, [ATTRIBUTE_A]).observe(),
    Error,
    "element_id must exactly match requested attribute",
  );
  assertEquals(client.calls.length, 1);
});

Deno.test("SysON build observer rejects a non-finite value", async () => {
  const client = new RecordedClient(() =>
    Promise.resolve(valueResult(ATTRIBUTE_A, LITERAL_A, Number.NaN, false))
  );
  await assertRejects(
    () => observer(client, undefined, [ATTRIBUTE_A]).observe(),
    Error,
    "must be a finite number",
  );
  assertEquals(client.calls.length, 1);
});

Deno.test("SysON build observer propagates an MCP error without retry", async () => {
  const client = new RecordedClient(() => Promise.reject(new Error("MCP unavailable")));
  await assertRejects(
    () => observer(client, undefined, [ATTRIBUTE_A]).observe(),
    Error,
    "MCP unavailable",
  );
  assertEquals(client.calls.length, 1);
});

Deno.test("SysON build observer bounds provider concurrency without changing order", async () => {
  const ids = [1, 2, 3, 4, 5].map((value) =>
    `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`
  );
  let active = 0;
  let peak = 0;
  const client = new RecordedClient(async (call) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    const id = String(call.arguments?.element_id);
    return valueResult(id, LITERAL_A, ids.indexOf(id), false);
  });
  const capture = await new SysonCoffeeMachineBuildObserver({
    client,
    editingContextId: EDITING_CONTEXT_ID,
    rootPartDefinitionId: ROOT_PART_DEFINITION_ID,
    exactAttributeIds: ids,
    maxConcurrency: 2,
  }).observe();

  assertEquals(peak, 2);
  assertEquals(
    capture.source.reads.map((read) => read.structuredContent.element_id),
    ids,
  );
});

Deno.test("SysON build observer rejects duplicate exact IDs before calling MCP", () => {
  const client = new RecordedClient(() =>
    Promise.resolve(valueResult(ATTRIBUTE_A, LITERAL_A, 12, false))
  );
  assertThrows(
    () => observer(client, undefined, [ATTRIBUTE_A, ATTRIBUTE_A]),
    TypeError,
    "must not contain duplicate IDs",
  );
  assertEquals(client.calls, []);
});

Deno.test("SysON build observer enforces literal kind and sign coherence", async () => {
  const negatedClient = new RecordedClient(() =>
    Promise.resolve(valueResult(ATTRIBUTE_A, LITERAL_A, 12, true))
  );
  await assertRejects(
    () => observer(negatedClient, undefined, [ATTRIBUTE_A]).observe(),
    Error,
    "is inconsistent with value 12",
  );

  const integerClient = new RecordedClient(() =>
    Promise.resolve(valueResult(ATTRIBUTE_A, LITERAL_A, 1.5, false))
  );
  await assertRejects(
    () => observer(integerClient, undefined, [ATTRIBUTE_A]).observe(),
    Error,
    "LiteralInteger value",
  );

  const kindClient = new RecordedClient(() =>
    Promise.resolve({
      text: "unsupported literal",
      structuredContent: {
        ...valueResult(ATTRIBUTE_A, LITERAL_A, 12, false).structuredContent,
        literal_kind: "LiteralReal",
      },
    })
  );
  await assertRejects(
    () => observer(kindClient, undefined, [ATTRIBUTE_A]).observe(),
    Error,
    "must be LiteralInteger or LiteralRational",
  );

  const literalIdClient = new RecordedClient(() =>
    Promise.resolve(valueResult(ATTRIBUTE_A, "literal-label", 12, false))
  );
  await assertRejects(
    () => observer(literalIdClient, undefined, [ATTRIBUTE_A]).observe(),
    TypeError,
    "literal_id",
  );
});

class RecordedClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(
    private readonly handler: (call: McpToolCall) => Promise<McpToolResult>,
  ) {}

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    return this.handler(call);
  }
}

function observer(
  client: McpToolClient,
  at = "2026-08-01T05:00:00.000Z",
  exactAttributeIds: readonly string[] = [ATTRIBUTE_A, ATTRIBUTE_B],
): SysonCoffeeMachineBuildObserver {
  return new SysonCoffeeMachineBuildObserver({
    client,
    editingContextId: EDITING_CONTEXT_ID,
    rootPartDefinitionId: ROOT_PART_DEFINITION_ID,
    exactAttributeIds,
    now: () => new Date(at),
  });
}

function valueResult(
  elementId: string,
  literalId: string,
  value: number,
  negated: boolean,
): McpToolResult {
  return {
    text: `Read attribute ${elementId}: ${value}.`,
    structuredContent: {
      element_id: elementId,
      value,
      literal_id: literalId,
      literal_kind: "LiteralInteger",
      negated,
    },
  };
}

function valueResultWithReorderedKeys(
  elementId: string,
  literalId: string,
  value: number,
  negated: boolean,
): McpToolResult {
  return {
    text: "same provider payload, different key insertion order",
    structuredContent: {
      negated,
      literal_kind: "LiteralInteger",
      literal_id: literalId,
      value,
      element_id: elementId,
    },
  };
}

function delayedResult(result: McpToolResult, delayMs: number): Promise<McpToolResult> {
  return new Promise((resolve) => setTimeout(() => resolve(result), delayMs));
}
