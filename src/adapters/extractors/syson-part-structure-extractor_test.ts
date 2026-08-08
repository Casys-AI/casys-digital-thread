import { assertEquals, assertRejects } from "@std/assert";
import {
  COFFEE_MACHINE_PART_LABEL,
  DRIP_TRAY_PART_LABEL,
  DRIP_TRAY_USAGE_LABEL,
  extractPartDefinitions,
  PartStructureExtractionError,
} from "./syson-part-structure-extractor.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ARCH_PACKAGE_ID = "pkg-arch-001";
const CTX_ID = "ctx-001";
const CM_ID = "cm-element-001";
const DT_ID = "dt-element-001";

/**
 * Minimal valid syson_part_structure response for CoffeeMachine.
 * partCount must equal tree.length.
 */
function validCmStructurePayload(extraRootKeys?: Record<string, unknown>) {
  return {
    root: {
      id: CM_ID,
      label: COFFEE_MACHINE_PART_LABEL,
      kind: "PartDef",
      ...extraRootKeys,
    },
    tree: [
      {
        id: "usage-dt-001",
        label: DRIP_TRAY_USAGE_LABEL,
        kind: "PartUsage",
        quantity: 1,
        quantitySource: "explicit",
        children: [],
      },
    ],
    partCount: 1,
    maxDepthReached: false,
  };
}

function validDtStructurePayload(extraRootKeys?: Record<string, unknown>) {
  return {
    root: { id: DT_ID, label: DRIP_TRAY_PART_LABEL, kind: "PartDef", ...extraRootKeys },
    tree: [],
    partCount: 0,
    maxDepthReached: false,
  };
}

/**
 * Minimal valid syson_element_children response for an architecture package.
 */
function validChildrenPayload() {
  return {
    parentId: ARCH_PACKAGE_ID,
    count: 2,
    children: [
      { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
      { id: DT_ID, label: DRIP_TRAY_PART_LABEL, kind: "PartDef" },
    ],
  };
}

interface MockCall {
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/**
 * Build a mock McpToolClient from a table of responses.
 *
 * `callTool` returns `structuredContent` from the provided map.
 * `callToolTextResult` returns the JSON-parsed object directly (simulating the
 * text-content path used by syson_part_structure).
 */
function buildMock(responses: {
  children?: unknown;
  cmStructure?: unknown;
  dtStructure?: unknown;
}): McpToolClient & { calls: MockCall[] } {
  const calls: MockCall[] = [];
  return {
    calls,
    callTool: (call) => {
      calls.push(call as MockCall);
      if (call.name === "syson_element_children") {
        return Promise.resolve({
          structuredContent: (responses.children ?? validChildrenPayload()) as Record<
            string,
            unknown
          >,
          text: "",
        });
      }
      return Promise.reject(new Error(`Unexpected callTool: ${call.name}`));
    },
    callToolTextResult: (call) => {
      calls.push(call as MockCall);
      if (call.name === "syson_part_structure") {
        const args = call.arguments as Record<string, unknown>;
        if (args.root_element_id === CM_ID) {
          return Promise.resolve(
            (responses.cmStructure ?? validCmStructurePayload()) as Record<
              string,
              unknown
            >,
          );
        }
        if (args.root_element_id === DT_ID) {
          return Promise.resolve(
            (responses.dtStructure ?? validDtStructurePayload()) as Record<
              string,
              unknown
            >,
          );
        }
      }
      return Promise.reject(
        new Error(
          `Unexpected callToolTextResult: ${call.name} root_element_id=${
            String((call.arguments as Record<string, unknown>).root_element_id)
          }`,
        ),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("extractPartDefinitions returns correct records for a valid SysON payload", async () => {
  const mock = buildMock({});
  const result = await extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID);

  assertEquals(result.coffeeMachine.elementId, CM_ID);
  assertEquals(result.coffeeMachine.label, COFFEE_MACHINE_PART_LABEL);
  assertEquals(result.coffeeMachine.structure!.root.label, COFFEE_MACHINE_PART_LABEL);
  assertEquals(result.coffeeMachine.structure!.partCount, 1);

  assertEquals(result.dripTray.elementId, DT_ID);
  assertEquals(result.dripTray.label, DRIP_TRAY_PART_LABEL);
  assertEquals(result.dripTray.structure!.root.label, DRIP_TRAY_PART_LABEL);
  assertEquals(result.dripTray.structure!.partCount, 0);
});

Deno.test("extractPartDefinitions throws part_definition_not_found when CoffeeMachine is absent", async () => {
  const mock = buildMock({
    children: {
      parentId: ARCH_PACKAGE_ID,
      count: 1,
      children: [{ id: DT_ID, label: DRIP_TRAY_PART_LABEL, kind: "PartDef" }],
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_definition_not_found");
  assertEquals(error.context.label, COFFEE_MACHINE_PART_LABEL);
});

Deno.test("extractPartDefinitions throws part_definition_ambiguous when two CoffeeMachine elements exist", async () => {
  const mock = buildMock({
    children: {
      parentId: ARCH_PACKAGE_ID,
      count: 3,
      children: [
        { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
        { id: "cm-dup", label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
        { id: DT_ID, label: DRIP_TRAY_PART_LABEL, kind: "PartDef" },
      ],
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_definition_ambiguous");
  assertEquals(error.context.label, COFFEE_MACHINE_PART_LABEL);
});

Deno.test("extractPartDefinitions throws part_definition_not_found when DripTray is absent", async () => {
  const mock = buildMock({
    children: {
      parentId: ARCH_PACKAGE_ID,
      count: 1,
      children: [{ id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" }],
    },
    cmStructure: validCmStructurePayload(),
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_definition_not_found");
  assertEquals(error.context.label, DRIP_TRAY_PART_LABEL);
});

Deno.test("extractPartDefinitions throws part_definition_ambiguous when two DripTray elements exist", async () => {
  const mock = buildMock({
    children: {
      parentId: ARCH_PACKAGE_ID,
      count: 3,
      children: [
        { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
        { id: DT_ID, label: DRIP_TRAY_PART_LABEL, kind: "PartDef" },
        { id: "dt-dup", label: DRIP_TRAY_PART_LABEL, kind: "PartDef" },
      ],
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_definition_ambiguous");
  assertEquals(error.context.label, DRIP_TRAY_PART_LABEL);
});

Deno.test("extractPartDefinitions throws part_structure_extraction_failed when root has an extra key", async () => {
  const mock = buildMock({
    cmStructure: validCmStructurePayload({ unexpected: "key" }),
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_structure_extraction_failed");
});

Deno.test("extractPartDefinitions throws part_structure_extraction_failed when a tree node has an extra key", async () => {
  const mock = buildMock({
    cmStructure: {
      root: { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
      tree: [
        {
          id: "usage-dt-001",
          label: DRIP_TRAY_PART_LABEL,
          kind: "PartUsage",
          quantity: 1,
          quantitySource: "explicit",
          children: [],
          extraField: "not allowed",
        },
      ],
      partCount: 1,
      maxDepthReached: false,
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_structure_extraction_failed");
});

Deno.test("extractPartDefinitions throws part_structure_extraction_failed when a tree node is missing a key", async () => {
  const mock = buildMock({
    cmStructure: {
      root: { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
      tree: [
        {
          id: "usage-dt-001",
          label: DRIP_TRAY_PART_LABEL,
          kind: "PartUsage",
          // quantity missing
          quantitySource: "explicit",
          children: [],
        },
      ],
      partCount: 1,
      maxDepthReached: false,
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_structure_extraction_failed");
});

Deno.test("extractPartDefinitions throws part_structure_root_mismatch when root.label does not match", async () => {
  const mock = buildMock({
    cmStructure: {
      root: { id: CM_ID, label: "WrongLabel", kind: "PartDef" },
      tree: [],
      partCount: 0,
      maxDepthReached: false,
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_structure_root_mismatch");
  assertEquals(error.context.expected, COFFEE_MACHINE_PART_LABEL);
  assertEquals(error.context.actual, "WrongLabel");
});

Deno.test("extractPartDefinitions throws part_count_mismatch when partCount differs from tree length", async () => {
  const mock = buildMock({
    cmStructure: {
      root: { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
      tree: [
        {
          id: "usage-dt-001",
          label: DRIP_TRAY_PART_LABEL,
          kind: "PartUsage",
          quantity: 1,
          quantitySource: "explicit",
          children: [],
        },
      ],
      partCount: 5, // wrong
      maxDepthReached: false,
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_count_mismatch");
});

Deno.test("extractPartDefinitions accepts the provider recursive partCount and requests no attributes", async () => {
  const nested = {
    root: { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
    tree: [{
      id: "usage-dt-001",
      label: DRIP_TRAY_USAGE_LABEL,
      kind: "PartUsage",
      quantity: 1,
      quantitySource: "explicit",
      children: [{
        id: "usage-nested-001",
        label: "nestedPart",
        kind: "PartUsage",
        quantity: 1,
        quantitySource: "explicit",
        children: [],
      }],
    }],
    partCount: 2,
    maxDepthReached: false,
  };
  const mock = buildMock({ cmStructure: nested });
  await extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID);
  const structureCalls = mock.calls.filter((call) =>
    call.name === "syson_part_structure"
  );
  assertEquals(
    structureCalls.every((call) => call.arguments.include_attributes === false),
    true,
  );
});

Deno.test("extractPartDefinitions rejects a truncated provider traversal", async () => {
  const mock = buildMock({
    cmStructure: { ...validCmStructurePayload(), maxDepthReached: true },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "part_structure_truncated");
});

Deno.test("extractPartDefinitions throws drip_tray_usage_absent when CoffeeMachine tree has no DripTray node", async () => {
  const mock = buildMock({
    cmStructure: {
      root: { id: CM_ID, label: COFFEE_MACHINE_PART_LABEL, kind: "PartDef" },
      tree: [
        {
          id: "usage-other-001",
          label: "SomethingElse",
          kind: "PartUsage",
          quantity: 1,
          quantitySource: "explicit",
          children: [],
        },
      ],
      partCount: 1,
      maxDepthReached: false,
    },
  });
  const error = await assertRejects(
    () => extractPartDefinitions(mock, CTX_ID, ARCH_PACKAGE_ID),
    PartStructureExtractionError,
  );
  assertEquals(error.code, "drip_tray_usage_absent");
});
