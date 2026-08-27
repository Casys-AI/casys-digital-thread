import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  type OracleRequirement,
  renderTargetedOracleRequirementsSysml,
} from "../../src/domain/kernel/proof-case.ts";
import {
  type ArchitectureProposal,
  renderArchitectureSysmlWithManifest,
} from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import {
  runSysonSmoke,
  type SysonSmokeCompiledInput,
  withEphemeralSysonAnchor,
} from "./syson-smoke.ts";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const PROJECT_ID = "223e4567-e89b-42d3-a456-426614174001";
const EDITING_CONTEXT_ID = "editing-context-smoke";
const PROJECT_NAME = `admission-syson-smoke-${UUID}`;
const COMPILED_INPUT = compiledInput();

function compiledInput(options: {
  readonly packageName?: string;
  readonly displacementMetric?: string;
  readonly displacementLimit?: number;
  readonly displacementName?: string;
  readonly displacementUnit?: string;
  readonly reverseRequirements?: boolean;
} = {}): SysonSmokeCompiledInput {
  const architecture: ArchitectureProposal = {
    packageName: options.packageName ?? "GenericSupport",
    system: { name: "GenericSupportSystem" },
    components: [{
      name: "SupportBlock",
      usageName: "supportBlock",
      parentName: "GenericSupportSystem",
    }],
  };
  const displacementMetric = options.displacementMetric ??
    "support_block_max_displacement";
  const displacement: OracleRequirement = {
    id: displacementMetric,
    name: options.displacementName ?? "SupportBlock maximum displacement limit",
    metric: displacementMetric,
    operator: "<=",
    limit: {
      value: options.displacementLimit ?? 2,
      unit: options.displacementUnit ?? "mm",
    },
  };
  const vonMises: OracleRequirement = {
    id: "support_block_max_von_mises",
    name: "SupportBlock maximum von Mises stress limit",
    metric: "support_block_max_von_mises",
    operator: "<=",
    limit: { value: 100_000_000, unit: "Pa" },
  };
  return {
    architecture,
    requirements: options.reverseRequirements
      ? [vonMises, displacement]
      : [displacement, vonMises],
  };
}

Deno.test("SysON smoke anchors an exact mechanical requirement to SupportBlock before one delete", async () => {
  const client = new FakeSyson();

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "passed");
  assertEquals(result.endpoint, "http://127.0.0.1:3009/mcp");
  assertEquals(result.architecture, {
    documentId: "document-1",
    documentName: "AdmissionSmokeModel.sysml",
    rootPackageId: "root-1",
    rootPackageLabel: "Package1",
    architecturePackageId: "package-1",
    systemPartDefinitionId: "part-def-system",
    supportBlockPartDefinitionId: "part-def-support",
    supportBlockPartUsageId: "part-usage-support",
    supportBlockPartUsageTargetId: "part-def-support",
  });
  assertEquals(result.requirement, {
    requirementUsageId: "requirement-usage-support",
    subjectReferenceUsageId: "requirement-subject-support",
    subjectTargetPartDefinitionId: "part-def-support",
    criteria: [{
      constraintUsageId: "constraint-usage-displacement",
      requirementId: "support_block_max_displacement",
      metric: "support_block_max_displacement",
      operator: "<=",
      limitValue: 2,
      unit: "mm",
    }, {
      constraintUsageId: "constraint-usage-von-mises",
      requirementId: "support_block_max_von_mises",
      metric: "support_block_max_von_mises",
      operator: "<=",
      limitValue: 100_000_000,
      unit: "Pa",
    }],
  });
  assertEquals(result.cleanup, {
    status: "deleted-and-absent",
    deleteAttempts: 1,
    preReadVerified: true,
    postconditionVerified: true,
  });
  assertEquals(client.calls.map((call) => call.name), [
    "syson_project_create",
    "syson_project_get",
    "syson_model_create",
    "syson_element_get",
    "syson_element_insert_sysml",
    "syson_element_children",
    "syson_element_children",
    "syson_element_children",
    "syson_query_aql",
    "syson_element_children",
    "syson_element_insert_sysml",
    "syson_element_children",
    "syson_element_get",
    "syson_element_children",
    "syson_query_aql",
    "syson_constraint_extract",
    "syson_project_get",
    "syson_project_delete",
    "syson_project_list",
  ]);
  assertEquals(client.calls[0]!.arguments, { name: PROJECT_NAME });
  assertEquals(client.calls[2]!.arguments, {
    editing_context_id: EDITING_CONTEXT_ID,
    name: "AdmissionSmokeModel",
    create_root_package: true,
  });
  const insertedSource = client.calls[4]!.arguments?.sysml_text;
  assertEquals(typeof insertedSource, "string");
  assertStringIncludes(insertedSource as string, "part def GenericSupportSystem");
  assertStringIncludes(insertedSource as string, "part supportBlock : SupportBlock;");
  assertEquals(client.calls[10]!.arguments?.parent_id, "part-def-support");
  const requirementSource = client.calls[10]!.arguments?.sysml_text;
  assertEquals(typeof requirementSource, "string");
  assertStringIncludes(
    requirementSource as string,
    "requirement SupportBlockRequirements",
  );
  assertStringIncludes(requirementSource as string, "subject target : SupportBlock;");
  assertStringIncludes(
    requirementSource as string,
    "support_block_max_displacement <= 2 [mm]",
  );
  assertStringIncludes(
    requirementSource as string,
    "support_block_max_von_mises <= 100000000 [Pa]",
  );
  assertEquals(client.calls[16]!.arguments, { project_id: PROJECT_ID });
  assertEquals(client.calls[18]!.arguments, { filter: PROJECT_NAME, first: 5 });
});

Deno.test("SysON smoke rejects a requirement subject typed by a foreign PartDefinition", async () => {
  const client = new FakeSyson({ wrongRequirementTarget: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "native-smoke");
  assertStringIncludes(result.failure?.message ?? "", "exact read-back SupportBlock");
  assertEquals(result.requirement, undefined);
  assertEquals(result.cleanup.status, "deleted-and-absent");
  assertEquals(
    client.calls.filter((call) => call.name === "syson_constraint_extract").length,
    0,
  );
});

Deno.test("SysON smoke rejects a provider constraint whose unit diverges", async () => {
  const client = new FakeSyson({ tamperedConstraintUnit: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "native-smoke");
  assertStringIncludes(result.failure?.message ?? "", "unit");
  assertEquals(result.requirement, undefined);
  assertEquals(result.cleanup.status, "deleted-and-absent");
  assertEquals(
    client.calls.filter((call) => call.name === "syson_constraint_extract").length,
    1,
  );
});

Deno.test("SysON smoke rejects a RequirementUsage with only one of two constraints", async () => {
  const client = new FakeSyson({ requirementCardinalityMismatch: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "native-smoke");
  assertStringIncludes(result.failure?.message ?? "", "exactly two");
  assertEquals(result.requirement, undefined);
  assertEquals(result.cleanup.status, "deleted-and-absent");
  assertEquals(
    client.calls.filter((call) => call.name === "syson_constraint_extract").length,
    0,
  );
});

Deno.test("SysON smoke rejects extraction of only one of the two reviewed constraints", async () => {
  const client = new FakeSyson({ extractedConstraintCardinalityMismatch: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "native-smoke");
  assertStringIncludes(result.failure?.message ?? "", "expected 2 constraint(s)");
  assertEquals(result.requirement, undefined);
  assertEquals(result.cleanup.status, "deleted-and-absent");
  assertEquals(
    client.calls.filter((call) => call.name === "syson_constraint_extract").length,
    1,
  );
});

Deno.test("SysON smoke marks cleanup red and never retries an outcome-unknown delete", async () => {
  const client = new FakeSyson({ deleteFails: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "cleanup");
  assertStringIncludes(result.failure?.message ?? "", "do not retry automatically");
  assertEquals(result.cleanup.status, "failed");
  if (result.cleanup.status !== "failed") throw new Error("unreachable");
  assertEquals(result.cleanup.deleteAttempts, 1);
  assertEquals(result.cleanup.preReadVerified, true);
  assertEquals(result.cleanup.residualIdentity, {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    editingContextId: EDITING_CONTEXT_ID,
  });
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_delete").length,
    1,
  );
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_list").length,
    0,
  );
});

Deno.test("SysON smoke refuses cleanup delete when the final identity pre-read diverges", async () => {
  const client = new FakeSyson({ cleanupIdentityMismatch: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "cleanup");
  assertEquals(result.cleanup.status, "failed");
  if (result.cleanup.status !== "failed") throw new Error("unreachable");
  assertEquals(result.cleanup.deleteAttempts, 0);
  assertEquals(result.cleanup.preReadVerified, false);
  assertStringIncludes(result.cleanup.message, "no delete was dispatched");
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_delete").length,
    0,
  );
});

Deno.test("SysON smoke reports an untrusted residual after a malformed create response and never deletes", async () => {
  const client = new FakeSyson({ malformedCreate: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "cleanup");
  assertEquals(result.cleanup.status, "create-dispatched-identity-untrusted");
  if (result.cleanup.status !== "create-dispatched-identity-untrusted") {
    throw new Error("unreachable");
  }
  assertEquals(result.cleanup.outcome, "unknown");
  assertEquals(result.cleanup.deleteAttempts, 0);
  assertEquals(result.cleanup.residualIdentity, {
    expectedName: PROJECT_NAME,
    returnedId: PROJECT_ID,
    returnedName: "unexpected-project-name",
    returnedEditingContextId: EDITING_CONTEXT_ID,
  });
  assertStringIncludes(result.cleanup.message, "manual inspection is required");
  assertEquals(client.calls.map((call) => call.name), ["syson_project_create"]);
});

Deno.test("SysON smoke rejects a divergent exact root Package readback", async () => {
  const client = new FakeSyson({ rootReadbackMismatch: true });

  const result = await runSysonSmoke({ client, uuid: UUID });

  assertEquals(result.status, "failed");
  assertEquals(result.failure?.phase, "native-smoke");
  assertStringIncludes(result.failure?.message ?? "", "exact created root Package");
  assertEquals(result.cleanup.status, "deleted-and-absent");
  assertEquals(
    client.calls.filter((call) => call.name === "syson_element_insert_sysml").length,
    0,
  );
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_delete").length,
    1,
  );
});

Deno.test("SysON anchor consumer receives frozen exact IDs before cleanup", async () => {
  const client = new FakeSyson();
  let callsObservedByConsumer: readonly string[] = [];

  const run = await withEphemeralSysonAnchor(
    (anchor) => {
      callsObservedByConsumer = client.calls.map((call) => call.name);
      assert(Object.isFrozen(anchor));
      assert(Object.isFrozen(anchor.project));
      assert(Object.isFrozen(anchor.architecture));
      assert(Object.isFrozen(anchor.requirements));
      assert(Object.isFrozen(anchor.requirements.criteria));
      assert(anchor.requirements.criteria.every(Object.isFrozen));
      assertEquals(anchor.project.id, PROJECT_ID);
      assertEquals(
        anchor.architecture.supportBlockPartUsageTargetId,
        "part-def-support",
      );
      assertEquals(
        anchor.requirements.subjectTargetPartDefinitionId,
        "part-def-support",
      );
      return Object.freeze({
        boundPartId: anchor.architecture.supportBlockPartUsageTargetId,
      });
    },
    COMPILED_INPUT,
    { client, uuid: UUID },
  );

  assertEquals(run.result.status, "passed");
  assertEquals(run.useResult, { boundPartId: "part-def-support" });
  assertEquals(callsObservedByConsumer.includes("syson_project_delete"), false);
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_delete").length,
    1,
  );
});

Deno.test("SysON anchor consumer failure still performs exact cleanup", async () => {
  const client = new FakeSyson();

  const run = await withEphemeralSysonAnchor(
    () => {
      throw new Error("DOWNSTREAM_SMOKE_FAILED");
    },
    COMPILED_INPUT,
    { client, uuid: UUID },
  );

  assertEquals(run.result.status, "failed");
  assertEquals(run.result.failure?.phase, "native-smoke");
  assertStringIncludes(run.result.failure?.message ?? "", "DOWNSTREAM_SMOKE_FAILED");
  assertEquals(run.result.cleanup.status, "deleted-and-absent");
  assertEquals("useResult" in run, false);
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_delete").length,
    1,
  );
});

Deno.test("SysON anchor consumer and cleanup failures are aggregated without retry", async () => {
  const client = new FakeSyson({ deleteFails: true });

  const run = await withEphemeralSysonAnchor(
    () => {
      throw new Error("DOWNSTREAM_SMOKE_FAILED");
    },
    COMPILED_INPUT,
    { client, uuid: UUID },
  );

  assertEquals(run.result.status, "failed");
  assertEquals(run.result.failure?.phase, "cleanup");
  assertStringIncludes(run.result.failure?.message ?? "", "DOWNSTREAM_SMOKE_FAILED");
  assertStringIncludes(
    run.result.failure?.message ?? "",
    "SYSON_PROJECT_DELETE_OUTCOME_UNKNOWN",
  );
  assertEquals("useResult" in run, false);
  assertEquals(
    client.calls.filter((call) => call.name === "syson_project_delete").length,
    1,
  );
});

Deno.test("SysON insert bytes derive from the explicit compiled input", async () => {
  const client = new FakeSyson();
  const input = compiledInput();

  const run = await withEphemeralSysonAnchor(
    () => "consumed",
    input,
    { client, uuid: UUID },
  );

  assertEquals(run.result.status, "passed");
  const architectureSource = client.calls[4]!.arguments?.sysml_text;
  assertEquals(
    architectureSource,
    renderArchitectureSysmlWithManifest(input.architecture).sourceText,
  );
  const requirementsSource = client.calls[10]!.arguments?.sysml_text;
  assertEquals(
    requirementsSource,
    renderTargetedOracleRequirementsSysml(
      "SupportBlockRequirements",
      "SupportBlock",
      input.requirements,
    ),
  );
  assertEquals(
    run.result.requirement?.criteria.map((criterion) => criterion.metric),
    ["support_block_max_displacement", "support_block_max_von_mises"],
  );
});

for (
  const [label, input] of [
    ["package", compiledInput({ packageName: "ForeignPackage" })],
    ["metric", compiledInput({ displacementMetric: "foreign_metric" })],
    ["limit", compiledInput({ displacementLimit: 3 })],
    ["name", compiledInput({ displacementName: "Injected name" })],
    ["unit", compiledInput({ displacementUnit: "cm" })],
    ["order", compiledInput({ reverseRequirements: true })],
  ] as const
) {
  Deno.test(`SysON compiled input rejects divergent ${label} before project create`, async () => {
    const client = new FakeSyson();

    await assertRejects(
      () => withEphemeralSysonAnchor(() => undefined, input, { client, uuid: UUID }),
      TypeError,
      "bounded",
    );

    assertEquals(client.calls, []);
  });
}

class FakeSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #deleteFails: boolean;
  readonly #cleanupIdentityMismatch: boolean;
  readonly #malformedCreate: boolean;
  readonly #rootReadbackMismatch: boolean;
  readonly #wrongRequirementTarget: boolean;
  readonly #tamperedConstraintUnit: boolean;
  readonly #requirementCardinalityMismatch: boolean;
  readonly #extractedConstraintCardinalityMismatch: boolean;
  #projectGetCalls = 0;
  #requirementInserted = false;

  constructor(options: {
    readonly deleteFails?: boolean;
    readonly cleanupIdentityMismatch?: boolean;
    readonly malformedCreate?: boolean;
    readonly rootReadbackMismatch?: boolean;
    readonly wrongRequirementTarget?: boolean;
    readonly tamperedConstraintUnit?: boolean;
    readonly requirementCardinalityMismatch?: boolean;
    readonly extractedConstraintCardinalityMismatch?: boolean;
  } = {}) {
    this.#deleteFails = options.deleteFails ?? false;
    this.#cleanupIdentityMismatch = options.cleanupIdentityMismatch ?? false;
    this.#malformedCreate = options.malformedCreate ?? false;
    this.#rootReadbackMismatch = options.rootReadbackMismatch ?? false;
    this.#wrongRequirementTarget = options.wrongRequirementTarget ?? false;
    this.#tamperedConstraintUnit = options.tamperedConstraintUnit ?? false;
    this.#requirementCardinalityMismatch = options.requirementCardinalityMismatch ??
      false;
    this.#extractedConstraintCardinalityMismatch =
      options.extractedConstraintCardinalityMismatch ?? false;
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const args = call.arguments ?? {};

    switch (call.name) {
      case "syson_project_create":
        return result({
          id: PROJECT_ID,
          name: this.#malformedCreate ? "unexpected-project-name" : PROJECT_NAME,
          editingContextId: EDITING_CONTEXT_ID,
        });
      case "syson_project_get": {
        this.#projectGetCalls++;
        return result({
          id: PROJECT_ID,
          name: this.#cleanupIdentityMismatch && this.#projectGetCalls === 2
            ? "another-project"
            : PROJECT_NAME,
          natures: ["SysMLv2"],
          editingContextId: EDITING_CONTEXT_ID,
        });
      }
      case "syson_model_create":
        return result({
          documentId: "document-1",
          documentName: "AdmissionSmokeModel.sysml",
          documentKind: "siriusComponents://semantic?domain=sysml&entity=Document",
          rootPackageId: "root-1",
          rootPackageLabel: "Package1",
        });
      case "syson_element_get":
        if (args.element_id === "requirement-usage-support") {
          return result({
            id: "requirement-usage-support",
            kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
            label: "SupportBlockRequirements",
          });
        }
        return result({
          id: "root-1",
          kind: "siriusComponents://semantic?domain=sysml&entity=Package",
          label: this.#rootReadbackMismatch ? "Package2" : "Package1",
          iconURLs: [],
        });
      case "syson_element_insert_sysml":
        if (args.parent_id === "part-def-support") {
          this.#requirementInserted = true;
        }
        return result({
          inserted: true,
          parentId: args.parent_id,
          text: args.sysml_text,
        });
      case "syson_element_children":
        return this.children(String(args.element_id));
      case "syson_query_aql":
        if (args.object_id === "requirement-subject-support") {
          return result({
            objectId: "requirement-subject-support",
            expression: args.expression,
            type: "objects",
            results: [{
              id: this.#wrongRequirementTarget ? "part-def-system" : "part-def-support",
              kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
              label: this.#wrongRequirementTarget
                ? "GenericSupportSystem"
                : "SupportBlock",
            }],
            count: 1,
          });
        }
        return result({
          objectId: "part-usage-support",
          expression: args.expression,
          type: "objects",
          results: [{
            id: "part-def-support",
            kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
            label: "SupportBlock",
          }],
          count: 1,
        });
      case "syson_constraint_extract":
        return result({
          constraints: [{
            id: "provider-constraint-displacement",
            name: "SupportBlock maximum displacement limit",
            sourceId: "provider-constraint-displacement",
            expression: {
              kind: "binary",
              op: "<=",
              left: {
                kind: "ref",
                featurePath: ["support_block_max_displacement"],
              },
              right: {
                kind: "literal",
                value: 2,
                unit: this.#tamperedConstraintUnit ? "m" : "mm",
              },
            },
          }, {
            id: "provider-constraint-von-mises",
            name: "SupportBlock maximum von Mises stress limit",
            sourceId: "provider-constraint-von-mises",
            expression: {
              kind: "binary",
              op: "<=",
              left: {
                kind: "ref",
                featurePath: ["support_block_max_von_mises"],
              },
              right: {
                kind: "literal",
                value: 100_000_000,
                unit: "Pa",
              },
            },
          }].slice(
            0,
            this.#extractedConstraintCardinalityMismatch ? 1 : 2,
          ),
        });
      case "syson_project_delete":
        if (this.#deleteFails) {
          return Promise.reject(
            new Error("SYSON_PROJECT_DELETE_OUTCOME_UNKNOWN"),
          );
        }
        return result({ deleted: true, projectId: PROJECT_ID });
      case "syson_project_list":
        return result({
          projects: [],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
            count: 0,
          },
        });
      default:
        return Promise.reject(new Error(`Unexpected call ${call.name}`));
    }
  }

  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("Unexpected text-result call"));
  }

  private children(parentId: string): Promise<McpToolResult> {
    const byParent: Record<string, readonly Record<string, unknown>[]> = {
      "root-1": [{
        id: "package-1",
        kind: "siriusComponents://semantic?domain=sysml&entity=Package",
        label: "GenericSupport",
      }],
      "package-1": [{
        id: "part-def-system",
        kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
        label: "GenericSupportSystem",
      }, {
        id: "part-def-support",
        kind: "siriusComponents://semantic?domain=sysml&entity=PartDefinition",
        label: "SupportBlock",
      }],
      "part-def-system": [{
        id: "part-usage-support",
        kind: "siriusComponents://semantic?domain=sysml&entity=PartUsage",
        label: "supportBlock",
      }],
      "part-def-support": this.#requirementInserted
        ? [{
          id: "requirement-usage-support",
          kind: "siriusComponents://semantic?domain=sysml&entity=RequirementUsage",
          label: "SupportBlockRequirements",
        }]
        : [],
      "requirement-usage-support": [
        ...[{
          id: "requirement-subject-support",
          kind: "siriusComponents://semantic?domain=sysml&entity=ReferenceUsage",
          label: "target",
        }, {
          id: "attribute-usage-displacement",
          kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
          label: "support_block_max_displacement",
        }, {
          id: "constraint-usage-displacement",
          kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
          label: "support_block_max_displacement_limit",
        }],
        ...(this.#requirementCardinalityMismatch ? [] : [{
          id: "attribute-usage-von-mises",
          kind: "siriusComponents://semantic?domain=sysml&entity=AttributeUsage",
          label: "support_block_max_von_mises",
        }, {
          id: "constraint-usage-von-mises",
          kind: "siriusComponents://semantic?domain=sysml&entity=ConstraintUsage",
          label: "support_block_max_von_mises_limit",
        }]),
      ],
    };
    const children = byParent[parentId];
    if (!children) return Promise.reject(new Error(`Unknown parent ${parentId}`));
    return result({ parentId, children, count: children.length });
  }
}

function result(
  structuredContent: Readonly<Record<string, unknown>>,
): Promise<McpToolResult> {
  return Promise.resolve({ structuredContent, text: "" });
}
