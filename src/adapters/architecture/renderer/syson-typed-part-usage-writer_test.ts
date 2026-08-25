import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";
import { ARCHITECTURE_FEATURE_TYPING_AQL } from "./architecture-structure-extractor.ts";
import { writeSysonTypedPartUsage } from "./syson-typed-part-usage-writer.ts";

const IDS = {
  editingContext: "editing-context",
  parent: "system-provider-id",
  target: "wing-provider-id",
  semanticTarget: "wing-semantic-id",
  usage: "wing-usage-provider-id",
  typing: "wing-typing-provider-id",
} as const;

class TypedUsageSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];

  constructor(private readonly readbackTargetId: string = IDS.target) {}

  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("Unexpected text-result call."));
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    if (
      call.name === "syson_query_aql" &&
      call.arguments?.object_id === IDS.target &&
      call.arguments?.expression === "aql:self.elementId"
    ) {
      return Promise.resolve({
        text: "semantic id",
        structuredContent: {
          objectId: IDS.target,
          expression: "aql:self.elementId",
          type: "string",
          result: IDS.semanticTarget,
        },
      });
    }
    if (
      call.name === "syson_element_create" &&
      call.arguments?.parent_id === IDS.parent
    ) {
      return Promise.resolve({
        text: "usage",
        structuredContent: {
          id: IDS.usage,
          kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
          label: "wing",
        },
      });
    }
    if (
      call.name === "syson_element_create" &&
      call.arguments?.parent_id === IDS.usage
    ) {
      return Promise.resolve({
        text: "typing",
        structuredContent: {
          id: IDS.typing,
          kind: "siriusComponents://semantic?domain=sysml&entity=FeatureTyping",
          label: "Wing",
        },
      });
    }
    if (
      call.name === "syson_query_aql" &&
      call.arguments?.object_id === IDS.typing
    ) {
      return Promise.resolve({
        text: "linked",
        structuredContent: {
          objectId: IDS.typing,
          expression: call.arguments.expression,
          type: "void",
          result: null,
        },
      });
    }
    if (
      call.name === "syson_query_aql" &&
      call.arguments?.object_id === IDS.usage &&
      call.arguments?.expression === ARCHITECTURE_FEATURE_TYPING_AQL
    ) {
      return Promise.resolve({
        text: "readback",
        structuredContent: {
          objectId: IDS.usage,
          expression: ARCHITECTURE_FEATURE_TYPING_AQL,
          type: "objects",
          results: [{
            id: this.readbackTargetId,
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "Wing",
          }],
          count: 1,
        },
      });
    }
    return Promise.reject(new Error(`Unexpected tool ${call.name}`));
  }
}

Deno.test("typed PartUsage lowering creates, links and proves the exact target", async () => {
  const syson = new TypedUsageSyson();
  let acknowledgements = 0;
  const written = await writeSysonTypedPartUsage({
    syson,
    editingContextId: IDS.editingContext,
    parentPartDefinitionId: IDS.parent,
    targetPartDefinitionId: IDS.target,
    targetPartDefinitionLabel: "Wing",
    usageName: "wing",
    onAcknowledged: () => acknowledgements++,
  });

  assertEquals(written, {
    usageId: IDS.usage,
    featureTypingId: IDS.typing,
  });
  assertEquals(acknowledgements, 3);
  assertEquals(syson.calls.map((call) => call.name), [
    "syson_query_aql",
    "syson_element_create",
    "syson_element_create",
    "syson_query_aql",
    "syson_query_aql",
  ]);
  assertEquals(syson.calls[1]?.arguments?.child_type, "SysMLv2EditService-PartUsage");
  assertEquals(
    syson.calls[2]?.arguments?.child_type,
    "SysMLv2EditService-FeatureTyping",
  );
  assertEquals(
    syson.calls[3]?.arguments?.expression,
    "aql:let target = self.eResource().getContents()->first().eAllContents()" +
      "->select(e | e.elementId = 'wing-semantic-id')->first() " +
      "in self.eSet('type', target)",
  );
});

Deno.test("typed PartUsage lowering refuses a different readback target", async () => {
  let acknowledgements = 0;
  await assertRejects(
    () =>
      writeSysonTypedPartUsage({
        syson: new TypedUsageSyson("motor-provider-id"),
        editingContextId: IDS.editingContext,
        parentPartDefinitionId: IDS.parent,
        targetPartDefinitionId: IDS.target,
        targetPartDefinitionLabel: "Wing",
        usageName: "wing",
        onAcknowledged: () => acknowledgements++,
      }),
    Error,
    "did not resolve exact PartDefinition",
  );
  assertEquals(acknowledgements, 3);
});
