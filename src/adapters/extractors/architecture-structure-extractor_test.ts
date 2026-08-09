import { assertEquals, assertRejects } from "@std/assert";
import {
  ARCHITECTURE_FEATURE_TYPING_AQL,
  ArchitectureStructureExtractionError,
  extractArchitectureStructure,
} from "./architecture-structure-extractor.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../mcp/http-mcp-tool-client.ts";

// ── Minimal MCP stub ─────────────────────────────────────────────────────────

/**
 * Two-tool stub: handles both syson_element_children and syson_query_aql.
 *
 * children: Map<elementId, structuredContent>
 * aql: Map<objectId, label of the typed PartDef returned by FeatureTyping AQL>
 *
 * WHY TWO MAPS — Phase 3b uses syson_query_aql (not syson_element_children) to
 * resolve FeatureTyping targets. The AQL response returns the typed PartDefinition
 * element directly; syson_element_children on a PartUsage returns a FeatureTyping
 * node with label "FeatureTyping" — not the target PartDef name.
 */
function makeStub(
  children: Map<string, unknown>,
  aql: Map<string, string> = new Map(),
  aqlObjectIdOverrides: Map<string, string> = new Map(),
): McpToolClient {
  return {
    callTool: (call: McpToolCall): Promise<McpToolResult> => {
      if (call.name === "syson_element_children") {
        const id = (call.arguments as Record<string, unknown>).element_id as string;
        const content = children.get(id);
        if (!content) {
          return Promise.reject(new Error(`No children stub for element_id "${id}"`));
        }
        return Promise.resolve({
          text: "children",
          structuredContent: content as Record<string, unknown>,
        });
      }
      if (call.name === "syson_query_aql") {
        const objectId = (call.arguments as Record<string, unknown>)
          .object_id as string;
        const expression = (call.arguments as Record<string, unknown>)
          .expression as string;
        if (expression !== ARCHITECTURE_FEATURE_TYPING_AQL) {
          return Promise.reject(
            new Error(`Unexpected AQL expression: ${expression}`),
          );
        }
        const targetLabel = aql.get(objectId);
        const responseObjectId = aqlObjectIdOverrides.get(objectId) ?? objectId;
        if (targetLabel === undefined) {
          // No entry → zero results (missing FeatureTyping).
          return Promise.resolve({
            text: "aql-empty",
            structuredContent: {
              objectId: responseObjectId,
              expression,
              type: "objects",
              results: [],
              count: 0,
            },
          });
        }
        return Promise.resolve({
          text: "aql-result",
          structuredContent: {
            objectId: responseObjectId,
            expression,
            type: "objects",
            results: [{
              id: `def-${targetLabel}`,
              kind: "sysml::PartDefinition",
              label: targetLabel,
            }],
            count: 1,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected tool call: ${call.name}`));
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

// ── Tests ────────────────────────────────────────────────────────────────────

Deno.test("extractArchitectureStructure: returns undefined when package is absent", async () => {
  const syson = makeStub(
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
  const syson = makeStub(
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
    // Phase 3b: syson_query_aql resolves the FeatureTyping target for "wing"
    // usage → "Wing". syson_element_children alone cannot provide this because
    // it labels FeatureTyping nodes "FeatureTyping", not the target PartDef name.
    const children = new Map([
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
      ["wing-1", makeChildren("wing-1", [])],
    ]);
    // AQL map: usage-1 types "Wing"
    const aql = new Map([["usage-1", "Wing"]]);
    const syson = makeStub(children, aql);

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
    assertEquals(sys?.usages, [{
      id: "usage-1",
      kind: PART_USAGE_KIND,
      label: "wing",
      targetId: "def-Wing",
      targetKind: "sysml::PartDefinition",
      targetLabel: "Wing",
    }]);

    const wing = result!.partDefs.find((pd) => pd.label === "Wing");
    assertEquals(wing?.usages, []);
  },
);

Deno.test(
  "extractArchitectureStructure: throws missing_feature_typing when AQL returns zero results",
  async () => {
    // A PartUsage with no FeatureTyping is a malformed model — syson_query_aql
    // returns count: 0. The extractor must reject it fail-closed.
    const children = new Map([
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
    ]);
    // aql map has no entry for usage-1 → stub returns count: 0
    const syson = makeStub(children);
    const error = await assertRejects(
      () => extractArchitectureStructure(syson, "ctx-1", "root-1", "DroneV4"),
      ArchitectureStructureExtractionError,
    ) as ArchitectureStructureExtractionError;
    assertEquals(error.code, "missing_feature_typing");
  },
);

Deno.test(
  "extractArchitectureStructure: rejects a FeatureTyping response for another PartUsage",
  async () => {
    const children = new Map([
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
    ]);
    const syson = makeStub(
      children,
      new Map([["usage-1", "Wing"]]),
      new Map([["usage-1", "usage-from-another-query"]]),
    );

    const error = await assertRejects(
      () => extractArchitectureStructure(syson, "ctx-1", "root-1", "DroneV4"),
      ArchitectureStructureExtractionError,
    ) as ArchitectureStructureExtractionError;

    assertEquals(error.code, "invalid_aql_response");
    assertEquals(error.context, {
      elementId: "usage-1",
      field: "structuredContent",
    });
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
  const syson = makeStub(
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
  const syson = makeStub(
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
