import { assertEquals, assertRejects } from "@std/assert";
import {
  ArchitectureStructureExtractionError,
  extractArchitectureStructure,
} from "./architecture-structure-extractor.ts";
import type { McpToolCall, McpToolClient } from "../mcp/http-mcp-tool-client.ts";

// ── Minimal MCP stub ─────────────────────────────────────────────────────────

function childrenStub(
  responses: Map<string, unknown>,
): McpToolClient {
  return {
    callTool: (call: McpToolCall) => {
      if (call.name !== "syson_element_children") {
        return Promise.reject(new Error(`Unexpected tool call: ${call.name}`));
      }
      const id = (call.arguments as Record<string, unknown>).element_id as string;
      const content = responses.get(id);
      if (!content) {
        return Promise.reject(new Error(`No stub response for element_id "${id}"`));
      }
      return Promise.resolve({ structuredContent: content });
    },
  } as unknown as McpToolClient;
}

function makeChildren(
  parentId: string,
  children: Array<{ id: string; kind: string; label: string }>,
): unknown {
  return { parentId, children, count: children.length };
}

const PART_DEF_KIND = "siriusComponents://semantic?domain=sysml&entity=PartDefinition";
const PART_USAGE_KIND = "siriusComponents://semantic?domain=sysml&entity=PartUsage";
const PACKAGE_KIND = "siriusComponents://semantic?domain=sysml&entity=Package";
const FEATURE_TYPING_KIND =
  "siriusComponents://semantic?domain=sysml&entity=FeatureTyping";

// ── Tests ────────────────────────────────────────────────────────────────────

Deno.test("extractArchitectureStructure: returns undefined when package is absent", async () => {
  const syson = childrenStub(
    new Map([
      ["root-1", makeChildren("root-1", [])],
    ]),
  );
  const result = await extractArchitectureStructure(
    syson,
    "ctx-1",
    "root-1",
    "DroneV4",
  );
  assertEquals(result, undefined);
});

Deno.test("extractArchitectureStructure: throws ambiguous_package when two packages share a name", async () => {
  const syson = childrenStub(
    new Map([
      [
        "root-1",
        makeChildren("root-1", [
          { id: "pkg-1", kind: PACKAGE_KIND, label: "DroneV4" },
          { id: "pkg-2", kind: PACKAGE_KIND, label: "DroneV4" },
        ]),
      ],
      ["pkg-1", makeChildren("pkg-1", [])],
      ["pkg-2", makeChildren("pkg-2", [])],
    ]),
  );
  const error = await assertRejects(
    () => extractArchitectureStructure(syson, "ctx-1", "root-1", "DroneV4"),
    ArchitectureStructureExtractionError,
  ) as ArchitectureStructureExtractionError;
  assertEquals(error.code, "ambiguous_package");
});

Deno.test(
  "extractArchitectureStructure: returns part defs with usages and target types",
  async () => {
    // Phase 3b: `syson_element_children(usage-1)` returns the FeatureTyping child
    // that names the target PartDef ("Wing").
    const syson = childrenStub(
      new Map([
        [
          "root-1",
          makeChildren("root-1", [
            { id: "pkg-1", kind: PACKAGE_KIND, label: "DroneV4" },
          ]),
        ],
        [
          "pkg-1",
          makeChildren("pkg-1", [
            { id: "sys-1", kind: PART_DEF_KIND, label: "DroneSystem" },
            { id: "wing-1", kind: PART_DEF_KIND, label: "Wing" },
          ]),
        ],
        [
          "sys-1",
          makeChildren("sys-1", [
            { id: "usage-1", kind: PART_USAGE_KIND, label: "wing" },
          ]),
        ],
        // Phase 3b: FeatureTyping child of "wing" usage → target is "Wing".
        [
          "usage-1",
          makeChildren("usage-1", [
            { id: "ft-1", kind: FEATURE_TYPING_KIND, label: "Wing" },
          ]),
        ],
        ["wing-1", makeChildren("wing-1", [])],
      ]),
    );
    const result = await extractArchitectureStructure(
      syson,
      "ctx-1",
      "root-1",
      "DroneV4",
    );
    assertEquals(result !== undefined, true);
    assertEquals(result!.packageId, "pkg-1");
    assertEquals(result!.packageLabel, "DroneV4");
    assertEquals(result!.partDefs.length, 2);

    const sys = result!.partDefs.find((pd) => pd.label === "DroneSystem");
    assertEquals(sys?.usages, [{ label: "wing", targetLabel: "Wing" }]);

    const wing = result!.partDefs.find((pd) => pd.label === "Wing");
    assertEquals(wing?.usages, []);
  },
);

Deno.test(
  "extractArchitectureStructure: throws missing_feature_typing when PartUsage has no FeatureTyping child",
  async () => {
    // A PartUsage with no FeatureTyping is a malformed model — the executor
    // cannot determine the target type and must reject it fail-closed.
    const syson = childrenStub(
      new Map([
        [
          "root-1",
          makeChildren("root-1", [
            { id: "pkg-1", kind: PACKAGE_KIND, label: "DroneV4" },
          ]),
        ],
        [
          "pkg-1",
          makeChildren("pkg-1", [
            { id: "sys-1", kind: PART_DEF_KIND, label: "DroneSystem" },
          ]),
        ],
        [
          "sys-1",
          makeChildren("sys-1", [
            { id: "usage-1", kind: PART_USAGE_KIND, label: "wing" },
          ]),
        ],
        // No FeatureTyping child for the usage — malformed model.
        ["usage-1", makeChildren("usage-1", [])],
      ]),
    );
    const error = await assertRejects(
      () => extractArchitectureStructure(syson, "ctx-1", "root-1", "DroneV4"),
      ArchitectureStructureExtractionError,
    ) as ArchitectureStructureExtractionError;
    assertEquals(error.code, "missing_feature_typing");
  },
);

Deno.test("extractArchitectureStructure: throws extraction_failed when SysON call fails", async () => {
  const syson: McpToolClient = {
    callTool: () => Promise.reject(new Error("SysON unavailable")),
  } as unknown as McpToolClient;
  const error = await assertRejects(
    () => extractArchitectureStructure(syson, "ctx-1", "root-1", "DroneV4"),
    ArchitectureStructureExtractionError,
  ) as ArchitectureStructureExtractionError;
  assertEquals(error.code, "extraction_failed");
});

Deno.test("extractArchitectureStructure: throws invalid_children_response when parentId mismatches", async () => {
  const syson = childrenStub(
    new Map([
      ["root-1", { parentId: "WRONG", children: [], count: 0 }],
    ]),
  );
  const error = await assertRejects(
    () => extractArchitectureStructure(syson, "ctx-1", "root-1", "DroneV4"),
    ArchitectureStructureExtractionError,
  ) as ArchitectureStructureExtractionError;
  assertEquals(error.code, "invalid_children_response");
});

Deno.test("extractArchitectureStructure: ignores non-Package siblings of different kind", async () => {
  const syson = childrenStub(
    new Map([
      [
        "root-1",
        makeChildren("root-1", [
          // A PartDef named DroneV4 is not a Package — should be ignored.
          { id: "pd-1", kind: PART_DEF_KIND, label: "DroneV4" },
        ]),
      ],
    ]),
  );
  const result = await extractArchitectureStructure(
    syson,
    "ctx-1",
    "root-1",
    "DroneV4",
  );
  assertEquals(result, undefined);
});
