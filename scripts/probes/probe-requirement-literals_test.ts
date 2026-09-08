import { assert, assertEquals, assertMatch } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  DEFAULT_REQUIREMENT_LITERALS_ENDPOINT,
  PROBE_REQUIREMENT_LITERAL_PART_DEF,
  probeRequirementLiterals,
  renderProbeRequirementLiteralSysml,
  REQUIREMENT_LITERAL_FORMS,
  requirementLiteralProbeQualifies,
} from "./probe-requirement-literals.ts";

const SANDBOX_NAME =
  /^probe-requirement-literals-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const SUCCESS_NAMES = [
  "syson_project_create",
  "syson_model_create",
  "syson_element_insert_sysml",
  "syson_element_children",
  "syson_constraint_extract",
  "syson_project_delete",
] as const;

Deno.test(
  "decimal form inserts 0.2 mm and is ok only on an exact literal extract",
  async () => {
    const client = new FakeSyson();
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "ok");
    assertEquals(result.probe, "requirement-literals");
    assertEquals(result.form, "decimal");
    assertEquals(result.endpoint, DEFAULT_REQUIREMENT_LITERALS_ENDPOINT);
    assertEquals(
      result.insertedSysml,
      renderProbeRequirementLiteralSysml("decimal"),
    );
    assertMatch(result.sandboxProjectName ?? "", SANDBOX_NAME);
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(result.insertedElementId, "part-1");
    assertEquals(result.expected, {
      rightKind: "literal",
      value: 0.2,
      unit: "mm",
      operator: "<=",
      featurePath: ["probeValue"],
    });
    assertEquals(result.observed, {
      expressionKind: "binary",
      leftKind: "ref",
      operator: "<=",
      featurePath: ["probeValue"],
      rightKind: "literal",
      value: 0.2,
      unit: "mm",
    });
    assertEquals(requirementLiteralProbeQualifies(result), true);
    assertEquals(client.names, [...SUCCESS_NAMES]);
    assertEquals(client.calls[0]?.arguments, {
      name: result.sandboxProjectName,
    });
    assertEquals(client.calls[1]?.arguments, {
      editing_context_id: "ctx-1",
      name: "ProbeModel",
      create_root_package: true,
    });
    assertEquals(client.calls[2]?.arguments, {
      editing_context_id: "ctx-1",
      parent_id: "pkg-1",
      sysml_text: renderProbeRequirementLiteralSysml("decimal"),
    });
    assertEquals(client.calls[3]?.arguments, {
      editing_context_id: "ctx-1",
      element_id: "pkg-1",
    });
    assertEquals(client.calls[4]?.arguments, {
      editing_context_id: "ctx-1",
      element_id: "part-1",
    });
    assertEquals(client.calls[5]?.arguments, { project_id: "project-1" });
    assertNoProductProject(client);
    assertNoEvaluateOrSolve(client);
  },
);

Deno.test(
  "fraction and scientific presets render the closed 0.2 mm spellings",
  () => {
    assertEquals(
      REQUIREMENT_LITERAL_FORMS.fraction.literalText,
      "1 / 5",
    );
    assertEquals(
      REQUIREMENT_LITERAL_FORMS.scientific.literalText,
      "2e-1",
    );
    assertEquals(
      renderProbeRequirementLiteralSysml("fraction"),
      [
        `part def ${PROBE_REQUIREMENT_LITERAL_PART_DEF} {`,
        "  private import SI::*;",
        "  attribute probeValue : LengthValue;",
        "  constraint probe_limit { probeValue <= 1 / 5 [mm] }",
        "}",
      ].join("\n"),
    );
    assertEquals(
      renderProbeRequirementLiteralSysml("scientific"),
      [
        `part def ${PROBE_REQUIREMENT_LITERAL_PART_DEF} {`,
        "  private import SI::*;",
        "  attribute probeValue : LengthValue;",
        "  constraint probe_limit { probeValue <= 2e-1 [mm] }",
        "}",
      ].join("\n"),
    );
  },
);

Deno.test(
  "fraction form still inserts the fraction spelling against a new sandbox",
  async () => {
    const client = new FakeSyson();
    const result = await probeRequirementLiterals({
      client,
      form: "fraction",
    });
    assertEquals(result.status, "ok");
    assertEquals(
      client.calls[2]?.arguments?.sysml_text,
      renderProbeRequirementLiteralSysml("fraction"),
    );
    assertMatch(result.sandboxProjectName ?? "", SANDBOX_NAME);
    assertEquals(client.calls[0]?.arguments, {
      name: result.sandboxProjectName,
    });
    assertNoProductProject(client);
  },
);

Deno.test(
  "a non-literal operator or rational right-hand side is refused with evidence",
  async () => {
    const client = new FakeSyson({ extractShape: "operator" });
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "not_literal");
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(result.observed?.rightKind, "operator");
    assertEquals(result.extractedConstraints.length, 1);
    assertEquals(result.extractErrors, []);
    assertEquals(
      (result.matchingConstraint as { expression: { right: unknown } })
        .expression.right,
      {
        kind: "operator",
        op: "/",
        left: { kind: "literal", value: 1 },
        right: { kind: "literal", value: 5 },
        unit: "mm",
      },
    );
    assertEquals(requirementLiteralProbeQualifies(result), false);
    assertEquals(client.names.at(-1), "syson_project_delete");
  },
);

Deno.test(
  "an otherwise exact extract with errors is never ok",
  async () => {
    const client = new FakeSyson({ extractShape: "extract-errors" });
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "extract_errors");
    assertEquals(result.extractErrors, [{ code: "literal-rational" }]);
    assertEquals(result.extractedConstraints.length, 1);
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(requirementLiteralProbeQualifies(result), false);
  },
);

Deno.test("an extra extracted constraint is never ok", async () => {
  const client = new FakeSyson({ extractShape: "extra-constraint" });
  const result = await probeRequirementLiterals({
    client,
    form: "decimal",
  });
  assertEquals(result.status, "extra_constraints");
  assertEquals(result.extractedConstraints.length, 2);
  assertEquals(result.extractErrors, []);
  assertEquals(result.sandboxProjectDeleted, true);
  assertEquals(requirementLiteralProbeQualifies(result), false);
});

Deno.test("a non-binary expression is a shape mismatch", async () => {
  const client = new FakeSyson({ extractShape: "shape-mismatch" });
  const result = await probeRequirementLiterals({
    client,
    form: "decimal",
  });
  assertEquals(result.status, "shape_mismatch");
  assertEquals(result.observed?.expressionKind, "unary");
  assertEquals(result.sandboxProjectDeleted, true);
  assertEquals(requirementLiteralProbeQualifies(result), false);
});

Deno.test("a literal value other than 0.2 is a value mismatch", async () => {
  const client = new FakeSyson({ extractShape: "value-mismatch" });
  const result = await probeRequirementLiterals({
    client,
    form: "decimal",
  });
  assertEquals(result.status, "value_mismatch");
  assertEquals(result.observed?.value, 0.3);
  assertEquals(result.observed?.unit, "mm");
  assertEquals(result.sandboxProjectDeleted, true);
  assert(result.extractedConstraints.length === 1);
});

Deno.test("a literal unit other than mm is a unit mismatch", async () => {
  const client = new FakeSyson({ extractShape: "unit-mismatch" });
  const result = await probeRequirementLiterals({
    client,
    form: "decimal",
  });
  assertEquals(result.status, "unit_mismatch");
  assertEquals(result.observed?.value, 0.2);
  assertEquals(result.observed?.unit, "m");
  assertEquals(result.sandboxProjectDeleted, true);
});

Deno.test(
  "insertion failure still deletes the successfully created sandbox",
  async () => {
    const client = new FakeSyson({ fail: "insert" });
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "insertion_failed");
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(result.extractedConstraints, []);
    assertEquals(client.names, [
      "syson_project_create",
      "syson_model_create",
      "syson_element_insert_sysml",
      "syson_project_delete",
    ]);
    assertEquals(client.calls[0]?.arguments, {
      name: result.sandboxProjectName,
    });
    assertEquals(client.calls.at(-1)?.arguments, { project_id: "project-1" });
    assertNoProductProject(client);
  },
);

Deno.test(
  "extraction failure still deletes the successfully created sandbox",
  async () => {
    const client = new FakeSyson({ fail: "extract" });
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "extraction_failed");
    assertEquals(result.sandboxProjectDeleted, true);
    assertEquals(result.insertedElementId, "part-1");
    assertEquals(client.names, [...SUCCESS_NAMES]);
    assertEquals(client.calls.at(-1)?.arguments, { project_id: "project-1" });
  },
);

Deno.test("cleanup failure is surfaced without dropping extract evidence", async () => {
  const client = new FakeSyson({ fail: "delete" });
  const result = await probeRequirementLiterals({
    client,
    form: "decimal",
  });
  assertEquals(result.status, "ok");
  assertEquals(result.sandboxProjectDeleted, false);
  assertEquals(result.observed?.value, 0.2);
  assertEquals(requirementLiteralProbeQualifies(result), false);
  assertEquals(client.names.at(-1), "syson_project_delete");
  assertMatch(result.sandboxProjectName ?? "", SANDBOX_NAME);
});

Deno.test("an unconfirmed cleanup response never qualifies the probe", async () => {
  const client = new FakeSyson({ fail: "delete-not-confirmed" });
  const result = await probeRequirementLiterals({
    client,
    form: "decimal",
  });
  assertEquals(result.status, "ok");
  assertEquals(result.sandboxProjectDeleted, false);
  assertEquals(requirementLiteralProbeQualifies(result), false);
  assertEquals(client.names.at(-1), "syson_project_delete");
});

Deno.test(
  "create failure preserves the sandbox name and never fakes cleanup",
  async () => {
    const client = new FakeSyson({ fail: "create" });
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "syson_unavailable");
    assertEquals(result.sandboxProjectDeleted, undefined);
    assertMatch(result.sandboxProjectName ?? "", SANDBOX_NAME);
    assertEquals(client.names, ["syson_project_create"]);
    assertEquals(client.calls[0]?.arguments, {
      name: result.sandboxProjectName,
    });
    assert(
      result.message.includes("Project creation outcome is unknown"),
    );
    assertNoProductProject(client);
  },
);

Deno.test(
  "an incomplete create leaves the sandbox name and does not delete",
  async () => {
    const client = new FakeSyson({ fail: "create-incomplete" });
    const result = await probeRequirementLiterals({
      client,
      form: "decimal",
    });
    assertEquals(result.status, "probe_error");
    assertEquals(result.sandboxProjectDeleted, undefined);
    assertMatch(result.sandboxProjectName ?? "", SANDBOX_NAME);
    assertEquals(client.names, ["syson_project_create"]);
    assert(result.message.includes("unknown"));
  },
);

Deno.test("invalid form is rejected before any provider I/O", async () => {
  const client = new FakeSyson();
  const result = await probeRequirementLiterals({
    client,
    form: "probeValue <= 0.2 [mm]",
  });
  assertEquals(result.status, "invalid_form");
  assertEquals(result.form, "probeValue <= 0.2 [mm]");
  assertEquals(result.sandboxProjectName, undefined);
  assertEquals(result.sandboxProjectDeleted, undefined);
  assertEquals(result.insertedSysml, undefined);
  assertEquals(client.calls, []);
  assert(
    result.message.includes("decimal|fraction|scientific"),
  );
});

Deno.test("omitted form is rejected before any provider I/O", async () => {
  const client = new FakeSyson();
  const result = await probeRequirementLiterals({ client });
  assertEquals(result.status, "invalid_form");
  assertEquals(client.calls, []);
});

type ExtractShape =
  | "exact-literal"
  | "operator"
  | "value-mismatch"
  | "unit-mismatch"
  | "extract-errors"
  | "extra-constraint"
  | "shape-mismatch";

type FailMode =
  | "create"
  | "create-incomplete"
  | "insert"
  | "extract"
  | "delete"
  | "delete-not-confirmed";

class FakeSyson implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  readonly #extractShape: ExtractShape;
  readonly #fail?: FailMode;

  constructor(
    options: {
      readonly extractShape?: ExtractShape;
      readonly fail?: FailMode;
    } = {},
  ) {
    this.#extractShape = options.extractShape ?? "exact-literal";
    this.#fail = options.fail;
  }

  get names(): string[] {
    return this.calls.map((call) => call.name);
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(call);
    if (call.name === "syson_project_create" && this.#fail === "create") {
      return Promise.reject(new Error("connection refused"));
    }
    if (call.name === "syson_element_insert_sysml" && this.#fail === "insert") {
      return Promise.reject(new Error("insert refused"));
    }
    if (call.name === "syson_constraint_extract" && this.#fail === "extract") {
      return Promise.reject(new Error("extract refused"));
    }
    if (call.name === "syson_project_delete" && this.#fail === "delete") {
      return Promise.reject(new Error("delete refused"));
    }
    return Promise.resolve({ text: "", structuredContent: this.#content(call) });
  }

  callToolTextResult(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("unused"));
  }

  #content(call: McpToolCall): Record<string, unknown> {
    switch (call.name) {
      case "syson_project_create":
        if (this.#fail === "create-incomplete") {
          return { name: "probe" };
        }
        return { id: "project-1", name: "probe", editingContextId: "ctx-1" };
      case "syson_model_create":
        return { rootPackageId: "pkg-1" };
      case "syson_element_insert_sysml":
        return { ok: true };
      case "syson_element_children":
        return {
          parentId: "pkg-1",
          count: 1,
          children: [{
            id: "part-1",
            kind: "sysml::PartDefinition",
            label: PROBE_REQUIREMENT_LITERAL_PART_DEF,
          }],
        };
      case "syson_constraint_extract":
        return this.#extract();
      case "syson_project_delete":
        return { deleted: this.#fail !== "delete-not-confirmed" };
      default:
        throw new Error(`unexpected tool ${call.name}`);
    }
  }

  #extract(): Record<string, unknown> {
    const right = this.#right();
    const constraint = {
      id: "constraint-1",
      name: "probe_limit",
      sourceId: "constraint-1",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["probeValue"] },
        right,
      },
    };
    if (this.#extractShape === "extract-errors") {
      return {
        constraints: [constraint],
        errors: [{ code: "literal-rational" }],
      };
    }
    if (this.#extractShape === "extra-constraint") {
      return {
        constraints: [
          constraint,
          { ...constraint, id: "constraint-2", name: "other_limit" },
        ],
      };
    }
    if (this.#extractShape === "shape-mismatch") {
      return {
        constraints: [{
          ...constraint,
          expression: { ...constraint.expression, kind: "unary" },
        }],
      };
    }
    return { constraints: [constraint] };
  }

  #right(): Record<string, unknown> {
    if (this.#extractShape === "operator") {
      return {
        kind: "operator",
        op: "/",
        left: { kind: "literal", value: 1 },
        right: { kind: "literal", value: 5 },
        unit: "mm",
      };
    }
    if (this.#extractShape === "value-mismatch") {
      return { kind: "literal", value: 0.3, unit: "mm" };
    }
    if (this.#extractShape === "unit-mismatch") {
      return { kind: "literal", value: 0.2, unit: "m" };
    }
    return { kind: "literal", value: 0.2, unit: "mm" };
  }
}

function assertNoProductProject(client: FakeSyson): void {
  for (const call of client.calls) {
    const args = JSON.stringify(call.arguments ?? {});
    assert(
      !args.includes("desk-lamp") &&
        !args.includes("dl05") &&
        !args.includes("ID01") &&
        !args.includes("id01"),
      `probe selected a product project via ${call.name}: ${args}`,
    );
  }
  const create = client.calls.find((call) => call.name === "syson_project_create");
  assert(create, "probe must create its own sandbox project");
  const name = create.arguments?.name;
  assert(typeof name === "string" && SANDBOX_NAME.test(name));
  assertEquals(Object.keys(create.arguments ?? {}), ["name"]);
}

function assertNoEvaluateOrSolve(client: FakeSyson): void {
  assertEquals(
    client.names.filter((name) =>
      name === "syson_constraint_evaluate" || name === "syson_constraint_solve"
    ),
    [],
  );
}
