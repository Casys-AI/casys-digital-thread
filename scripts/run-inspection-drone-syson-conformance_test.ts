import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../src/adapters/http-mcp-tool-client.ts";
import {
  INSPECTION_DRONE_ARCHITECTURE_SYSML,
} from "../src/domain/inspection-drone-architecture.ts";
import {
  runInspectionDroneSysonConformance,
} from "./run-inspection-drone-syson-conformance.ts";

Deno.test("inspection-drone conformance defaults to an inert report without constructing a client", async () => {
  let factoryCalls = 0;

  const report = await runInspectionDroneSysonConformance({
    args: [],
    createClient: () => {
      factoryCalls += 1;
      throw new Error(
        "A confirmation-required invocation must not construct a client.",
      );
    },
  });

  assertEquals(factoryCalls, 0);
  assertEquals(report.status, "confirmation-required");
  assertEquals(report.engineeringEvidence, "none");
  assertEquals(report.mutation, {
    disposableProjectCreationAttempted: false,
    modelCreationAttempted: false,
    fixedRecipeInsertionAttempted: false,
    fixedRecipeInsertionAcknowledged: false,
    cleanup: "not-attempted; retain the disposable project for operator inspection",
  });
  assertEquals(report.nextStep.includes("--execute"), true);
  assertEquals(
    report.nextStep.includes("--acknowledge=CREATE_DISPOSABLE_SYSON_PROJECT"),
    true,
  );
});

Deno.test("inspection-drone conformance remains inert when any explicit acknowledgement is missing", async () => {
  let factoryCalls = 0;

  const report = await runInspectionDroneSysonConformance({
    args: [
      "--execute",
      "--acknowledge=CREATE_DISPOSABLE_SYSON_PROJECT",
      "--disposable-project-prefix=disposable-r3-conformance",
    ],
    createClient: () => {
      factoryCalls += 1;
      throw new Error("A partial acknowledgement must not construct a client.");
    },
  });

  assertEquals(factoryCalls, 0);
  assertEquals(report.status, "confirmation-required");
  assertEquals(report.nextStep.includes("--mcp-url=http(s)://.../mcp"), true);
});

Deno.test("inspection-drone conformance rejects a remote endpoint before constructing a client", async () => {
  let factoryCalls = 0;

  await assertRejects(
    () =>
      runInspectionDroneSysonConformance({
        args: [
          "--execute",
          "--acknowledge=CREATE_DISPOSABLE_SYSON_PROJECT",
          "--disposable-project-prefix=disposable-r3-conformance",
          "--mcp-url=https://syson.example/mcp",
        ],
        createClient: () => {
          factoryCalls += 1;
          throw new Error("A rejected endpoint must not construct a client.");
        },
      }),
    TypeError,
    "cannot target a remote provider",
  );

  assertEquals(factoryCalls, 0);
});

Deno.test("inspection-drone conformance uses only the fixed disposable SysON sequence", async () => {
  const client = new FixtureSysonClient();
  const report = await runInspectionDroneSysonConformance({
    args: confirmedArgs(),
    client,
    now: () => new Date("2026-08-03T12:34:56.000Z"),
    uniqueSuffix: () => "cafefeed",
  });

  assertEquals(report.status, "passed");
  assertEquals(report.engineeringEvidence, "none");
  assertEquals(report.project, {
    id: "project-r3-fixture",
    name: "disposable-r3-conformance-20260803123456000-cafefeed",
  });
  assertEquals(report.mutation, {
    disposableProjectCreationAttempted: true,
    modelCreationAttempted: true,
    fixedRecipeInsertionAttempted: true,
    fixedRecipeInsertionAcknowledged: true,
    cleanup: "not-attempted; retain the disposable project for operator inspection",
  });
  assertEquals(client.calls.map((call) => call.name), [
    "syson_project_create",
    "syson_model_create",
    "syson_element_children",
    "syson_element_insert_sysml",
    "syson_element_children",
    "syson_element_children",
    "syson_element_children",
    "syson_element_children",
  ]);
  assertEquals(client.calls[3]?.arguments, {
    editing_context_id: "editing-context-r3-fixture",
    parent_id: "root-r3-fixture",
    sysml_text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
  });
  assertEquals(
    client.calls.some((call) => call.name === "syson_project_delete"),
    false,
  );
  assertEquals(
    report.nextStep.includes("not engineering evidence"),
    false,
  );
  assertEquals(report.statement.includes("not engineering evidence"), true);
});

Deno.test("inspection-drone conformance never reports a pass when the fixed insertion acknowledgement drifts", async () => {
  const client = new FixtureSysonClient({
    insertion: {
      inserted: true,
      parentId: "root-r3-fixture",
      text: "package tampered;",
    },
  });

  const report = await runInspectionDroneSysonConformance({
    args: confirmedArgs(),
    client,
    uniqueSuffix: () => "cafefeed",
  });

  assertEquals(report.status, "inconclusive");
  assertEquals(report.engineeringEvidence, "none");
  assertEquals(report.mutation.fixedRecipeInsertionAttempted, true);
  assertEquals(report.mutation.fixedRecipeInsertionAcknowledged, false);
  assertEquals(
    report.assertions.includes(
      "SysON acknowledged the exact fixed r3 SysML recipe once.",
    ),
    false,
  );
  assertEquals(
    report.failure?.includes("exactly match the reviewed SysML recipe"),
    true,
  );
});

function confirmedArgs(): string[] {
  return [
    "--execute",
    "--acknowledge=CREATE_DISPOSABLE_SYSON_PROJECT",
    "--disposable-project-prefix=disposable-r3-conformance",
    "--mcp-url=http://127.0.0.1:3009/mcp",
  ];
}

class FixtureSysonClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #insertion: Readonly<Record<string, unknown>>;

  constructor(options: { insertion?: Readonly<Record<string, unknown>> } = {}) {
    this.#insertion = options.insertion ?? {
      inserted: true,
      parentId: "root-r3-fixture",
      text: INSPECTION_DRONE_ARCHITECTURE_SYSML,
    };
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const response = this.response(call);
    return Promise.resolve({ text: "fixture", structuredContent: response });
  }

  private response(call: McpToolCall): Readonly<Record<string, unknown>> {
    switch (this.calls.length) {
      case 1:
        assertEquals(call.name, "syson_project_create");
        return {
          id: "project-r3-fixture",
          name: call.arguments?.name,
          editingContextId: "editing-context-r3-fixture",
        } as Readonly<Record<string, unknown>>;
      case 2:
        assertEquals(call.name, "syson_model_create");
        return {
          documentId: "document-r3-fixture",
          documentName: "InspectionDroneArchitectureConformance",
          documentKind: "sysml",
          rootPackageId: "root-r3-fixture",
          rootPackageLabel: "InspectionDroneArchitectureConformanceRoot",
        };
      case 3:
        assertEquals(call.name, "syson_element_children");
        return children("root-r3-fixture", []);
      case 4:
        assertEquals(call.name, "syson_element_insert_sysml");
        return this.#insertion;
      case 5:
        assertEquals(call.name, "syson_element_children");
        return children("root-r3-fixture", [{
          id: "architecture-r3-fixture",
          kind: "sysml::Package",
          label: "InspectionDroneArchitecture",
        }]);
      case 6:
        assertEquals(call.name, "syson_element_children");
        return children("architecture-r3-fixture", [
          {
            id: "inspection-drone-r3-fixture",
            kind: "sysml::PartDefinition",
            label: "InspectionDrone",
          },
          {
            id: "airframe-r3-fixture",
            kind: "sysml::PartDefinition",
            label: "Airframe",
          },
          {
            id: "energy-r3-fixture",
            kind: "sysml::PartDefinition",
            label: "EnergySystem",
          },
          {
            id: "propulsion-r3-fixture",
            kind: "sysml::PartDefinition",
            label: "PropulsionSystem",
          },
          {
            id: "avionics-r3-fixture",
            kind: "sysml::PartDefinition",
            label: "AvionicsAndFlightControl",
          },
          {
            id: "camera-r3-fixture",
            kind: "sysml::PartDefinition",
            label: "InspectionCameraPayload",
          },
          {
            id: "requirements-r3-fixture",
            kind: "sysml::Package",
            label: "Requirements",
          },
        ]);
      case 7:
        assertEquals(call.name, "syson_element_children");
        return children("inspection-drone-r3-fixture", [
          partUsage("airframe-r3-usage", "airframe"),
          partUsage("energy-r3-usage", "energy"),
          partUsage("propulsion-r3-usage", "propulsion"),
          partUsage("avionics-r3-usage", "avionicsAndFlightControl"),
          partUsage("camera-r3-usage", "cameraPayload"),
        ]);
      case 8:
        assertEquals(call.name, "syson_element_children");
        return children("requirements-r3-fixture", [
          requirementUsage("controlled-r3-requirement", "controlledVisualInspection"),
          requirementUsage("camera-r3-requirement", "cameraPayloadProvision"),
          requirementUsage("modifiable-r3-requirement", "modifiableArchitecture"),
          requirementUsage("evidence-r3-requirement", "evidenceDrivenVerification"),
        ]);
      default:
        throw new Error(`Unexpected fixture call ${this.calls.length}: ${call.name}`);
    }
  }
}

function children(
  parentId: string,
  children: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
  return { parentId, children, count: children.length };
}

function partUsage(id: string, label: string): Readonly<Record<string, unknown>> {
  return {
    id,
    kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
    label,
  };
}

function requirementUsage(
  id: string,
  label: string,
): Readonly<Record<string, unknown>> {
  return { id, kind: "sysml::RequirementUsage", label };
}
