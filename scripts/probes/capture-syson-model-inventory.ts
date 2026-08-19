import { parseArgs } from "../lib/cli.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import { parseCapturedSysonModelInventory } from "../../src/adapters/historical/syson-model-inventory-extension.ts";

const args = parseArgs(Deno.args);
const endpoint = args["endpoint"] ?? "http://127.0.0.1:3009/mcp";
const projectId = requiredArgument("project-id");
const projectName = requiredArgument("project-name");
const editingContextId = requiredArgument("editing-context-id");
const outputDirectory = args["output"] ?? "state/local/syson-inventory";
const capturedAt = new Date().toISOString();
const client = new HttpMcpToolClient({ mcpUrl: endpoint, timeoutMs: 30_000 });
const response = await client.callTool({
  name: "syson_search",
  arguments: {
    editing_context_id: editingContextId,
    text: ".*",
    use_regex: true,
  },
});
const inventory = response.structuredContent;
const capture = parseCapturedSysonModelInventory({
  schemaVersion: "captured-syson-model-inventory/1.0",
  capturedAt,
  source: "observed-live-read-only",
  project: { id: projectId, name: projectName, editingContextId },
  provider: { endpoint, tool: "syson_search" },
  inventory: {
    query: ".*",
    count: inventory.count,
    results: inventory.results,
  },
});

await Deno.mkdir(outputDirectory, { recursive: true });
const fileName = `${capturedAt.replace(/[-:.]/g, "")}.json`;
const path = `${outputDirectory.replace(/\/$/, "")}/${fileName}`;
await Deno.writeTextFile(path, `${JSON.stringify(capture, null, 2)}\n`, {
  createNew: true,
});
const kinds = capture.inventory.results.map((item) =>
  item.kind.match(/entity=([^&]+)/)?.[1] ?? ""
);
console.log(JSON.stringify(
  {
    path,
    elements: capture.inventory.count,
    requirementUsages: kinds.filter((kind) => kind === "RequirementUsage").length,
    constraintUsages: kinds.filter((kind) => kind === "ConstraintUsage").length,
    mode: "read-only",
  },
  null,
  2,
));

function requiredArgument(name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing required --${name}=... argument.`);
  return value;
}
