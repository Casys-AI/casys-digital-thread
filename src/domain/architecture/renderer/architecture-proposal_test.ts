import { assertEquals, assertThrows } from "@std/assert";
import {
  ArchitectureInsertionAmbiguityError,
  ArchitecturePackageScopeError,
  ArchitectureProposalParseError,
  assertArchitecturePackageScope,
  type ExistingArchitectureStructure,
  parseArchitectureProposalParameters,
  planArchitectureInsertion,
  renderArchitectureSysml,
  renderArchitectureSysmlWithManifest,
  validateRenderedArchitectureSysml,
} from "./architecture-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";

// ── Parser invariants ────────────────────────────────────────────────────────

Deno.test("parseArchitectureProposalParameters: empty parameter list is rejected as empty_proposal", () => {
  assertThrows(
    () => parseArchitectureProposalParameters([]),
    ArchitectureProposalParseError,
    "no parameters",
  );
});

Deno.test("parseArchitectureProposalParameters: missing architecture.package is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "missing_package");
});

Deno.test("parseArchitectureProposalParameters: missing system.name is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "missing_system");
});

Deno.test("architecture package scope stays fixed after a predecessor capture", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
  ]);
  assertArchitecturePackageScope({
    packageName: "DroneV4",
    scopeRootId: "pkg-drone-v4",
  }, proposal);
});

Deno.test("architecture package scope refuses a successor package change", () => {
  const proposal = parseArchitectureProposalParameters([
    {
      key: "architecture.package",
      label: "Package",
      value: "DroneV4Mechanism",
    },
    { key: "system.name", label: "System", value: "DroneSystem" },
  ]);
  const error = assertThrows(
    () =>
      assertArchitecturePackageScope({
        packageName: "DroneV4",
        scopeRootId: "pkg-drone-v4",
      }, proposal),
    ArchitecturePackageScopeError,
  );
  assertEquals(error.code, "predecessor_package_name_changed");
  assertEquals(error.context, {
    predecessorPackageName: "DroneV4",
    predecessorScopeRootId: "pkg-drone-v4",
    proposalPackageName: "DroneV4Mechanism",
  });
});

Deno.test("parseArchitectureProposalParameters: a system-only proposal is the unique PartDefinition", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "Cantilever" },
    { key: "system.name", label: "System", value: "CantileverArm" },
    { key: "attribute.thickness.name", label: "Thickness", value: "thickness" },
    {
      key: "attribute.thickness.parent",
      label: "Thickness parent",
      value: "CantileverArm",
    },
  ]);
  assertEquals(proposal.components, []);
  assertEquals(proposal.attributes, [{
    name: "thickness",
    parentName: "CantileverArm",
  }]);
  const sysml = renderArchitectureSysml(proposal);
  assertEquals(sysml.includes("  part def CantileverArm {"), true);
  assertEquals(sysml.includes("    attribute thickness;"), true);
  assertEquals(sysml.includes("part def "), true);
  assertEquals([...sysml.matchAll(/part def /g)].length, 1);
});

Deno.test(
  "parseArchitectureProposalParameters: five occurrences and bare attributes stay inside the current grammar",
  () => {
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DemoPackage" },
      { key: "system.name", label: "System", value: "DemoSystem" },
      { key: "component.a.name", label: "A name", value: "PartA" },
      { key: "component.a.usage", label: "A usage", value: "partA" },
      { key: "component.a.parent", label: "A parent", value: "DemoSystem" },
      { key: "component.b.name", label: "B name", value: "PartB" },
      { key: "component.b.usage", label: "B usage", value: "partB" },
      { key: "component.b.parent", label: "B parent", value: "DemoSystem" },
      { key: "component.c.name", label: "C name", value: "PartC" },
      { key: "component.c.usage", label: "C usage", value: "partC" },
      { key: "component.c.parent", label: "C parent", value: "DemoSystem" },
      { key: "component.d.name", label: "D name", value: "PartD" },
      { key: "component.d.usage", label: "D usage", value: "partD" },
      { key: "component.d.parent", label: "D parent", value: "DemoSystem" },
      { key: "component.e.name", label: "E name", value: "PartE" },
      { key: "component.e.usage", label: "E usage", value: "partE" },
      { key: "component.e.parent", label: "E parent", value: "DemoSystem" },
      { key: "attribute.handle.name", label: "Handle", value: "handle" },
      {
        key: "attribute.handle.parent",
        label: "Handle parent",
        value: "PartB",
      },
    ]);
    assertEquals(proposal.components.length, 5);
    assertEquals(proposal.attributes, [{
      name: "handle",
      parentName: "PartB",
    }]);
    const sysml = renderArchitectureSysml(proposal);
    assertEquals([...sysml.matchAll(/part def /g)].length, 6);
    assertEquals(sysml.includes("    attribute handle;"), true);
    assertEquals(sysml.includes("attribute handle ="), false);
  },
);

Deno.test("parseArchitectureProposalParameters: a hyphenated grouping slug is not a SysML identifier and is accepted", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "StagePackage" },
    { key: "system.name", label: "System", value: "StageSystem" },
    {
      key: "component.heated-stage-plate.name",
      label: "Plate name",
      value: "HeatedStagePlate",
    },
    {
      key: "component.heated-stage-plate.usage",
      label: "Plate usage",
      value: "heatedStagePlate",
    },
    {
      key: "attribute.plate-thickness.name",
      label: "Thickness",
      value: "thickness",
    },
    {
      key: "attribute.plate-thickness.parent",
      label: "Thickness parent",
      value: "HeatedStagePlate",
    },
  ]);
  assertEquals(proposal.components, [{
    name: "HeatedStagePlate",
    usageName: "heatedStagePlate",
    parentName: "StageSystem",
  }]);
  assertEquals(proposal.attributes, [{
    name: "thickness",
    parentName: "HeatedStagePlate",
  }]);
});

Deno.test("parseArchitectureProposalParameters: a dotted slug is refused as invalid_slug, not unknown_key", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "StagePackage" },
        { key: "system.name", label: "System", value: "StageSystem" },
        {
          key: "component.heated.stage.name",
          label: "Plate name",
          value: "HeatedStagePlate",
        },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "invalid_slug");
  assertEquals(error.context.key, "component.heated.stage.name");
  assertEquals(error.context.slug, "heated.stage");
});

Deno.test("parseArchitectureProposalParameters: unknown key is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
        { key: "component.wing.color", label: "Wing color", value: "red" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "unknown_key");
});

Deno.test("parseArchitectureProposalParameters: top-level unknown key is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
        { key: "category.foo", label: "Cat", value: "bar" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "unknown_key");
});

Deno.test("parseArchitectureProposalParameters: invalid SysML identifier in package name is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "drone-v4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "invalid_identifier");
});

Deno.test("parseArchitectureProposalParameters: non-string parameter value is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        {
          key: "component.wing.name",
          label: "Wing count",
          value: 4 as unknown as string,
        },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "non_string_value");
});

Deno.test("parseArchitectureProposalParameters: one PartDefinition may type several occurrences", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.leftMotor.name", label: "Left motor type", value: "Motor" },
    { key: "component.leftMotor.usage", label: "Left motor", value: "leftMotor" },
    { key: "component.rightMotor.name", label: "Right motor type", value: "Motor" },
    { key: "component.rightMotor.usage", label: "Right motor", value: "rightMotor" },
  ]);

  assertEquals(proposal.components.map((component) => component.name), [
    "Motor",
    "Motor",
  ]);
  assertEquals(
    renderArchitectureSysml(proposal).match(/part def Motor/g)?.length,
    1,
  );
  assertEquals(
    renderArchitectureSysml(proposal).includes("part leftMotor : Motor;"),
    true,
  );
  assertEquals(
    renderArchitectureSysml(proposal).includes("part rightMotor : Motor;"),
    true,
  );
});

Deno.test("parseArchitectureProposalParameters: a usage name is unique within its parent", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.left.name", label: "Left type", value: "LeftMotor" },
        { key: "component.left.usage", label: "Motor", value: "motor" },
        { key: "component.right.name", label: "Right type", value: "RightMotor" },
        { key: "component.right.usage", label: "Motor", value: "motor" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "duplicate_usage");
});

Deno.test("parseArchitectureProposalParameters: missing parent reference is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
        { key: "component.wing.parent", label: "Wing parent", value: "Fuselage" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "missing_parent");
});

Deno.test("parseArchitectureProposalParameters: cycle in component hierarchy is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.a.name", label: "A", value: "CompA" },
        { key: "component.a.usage", label: "A usage", value: "compA" },
        { key: "component.a.parent", label: "A parent", value: "CompB" },
        { key: "component.b.name", label: "B", value: "CompB" },
        { key: "component.b.usage", label: "B usage", value: "compB" },
        { key: "component.b.parent", label: "B parent", value: "CompA" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "cycle_detected");
});

Deno.test("parseArchitectureProposalParameters: usage same as name is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "usage_same_as_name");
});

Deno.test("parseArchitectureProposalParameters: valid nominal proposal produces exact hierarchy", () => {
  const params: EngineeringDecisionProposalParameter[] = [
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    { key: "component.motor.name", label: "Motor", value: "Motor" },
    { key: "component.motor.usage", label: "Motor usage", value: "motor" },
    { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
  ];
  const proposal = parseArchitectureProposalParameters(params);
  assertEquals(proposal.packageName, "DroneV4");
  assertEquals(proposal.system.name, "DroneSystem");
  assertEquals(proposal.components.length, 2);

  const wing = proposal.components.find((c) => c.name === "Wing");
  const motor = proposal.components.find((c) => c.name === "Motor");
  assertEquals(wing?.usageName, "wing");
  assertEquals(wing?.parentName, "DroneSystem");
  assertEquals(motor?.usageName, "motor");
  assertEquals(motor?.parentName, "Wing");
});

Deno.test("parseArchitectureProposalParameters: unique attribute is owned by its parent PartDefinition", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "Lamp" },
    { key: "system.name", label: "System", value: "LampSystem" },
    { key: "component.arm.name", label: "Arm", value: "Arm" },
    { key: "component.arm.usage", label: "Arm usage", value: "arm" },
    { key: "attribute.thickness.name", label: "Thickness", value: "thickness" },
    { key: "attribute.thickness.parent", label: "Thickness parent", value: "Arm" },
  ]);
  assertEquals(proposal.attributes, [{ name: "thickness", parentName: "Arm" }]);
  const sysml = renderArchitectureSysml(proposal);
  assertEquals(
    sysml.includes("    attribute thickness;"),
    true,
  );
  assertEquals(sysml.includes("  part def Arm {"), true);
});

Deno.test("parseArchitectureProposalParameters: duplicate attribute name is rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "Lamp" },
        { key: "system.name", label: "System", value: "LampSystem" },
        { key: "component.arm.name", label: "Arm", value: "Arm" },
        { key: "component.arm.usage", label: "Arm usage", value: "arm" },
        { key: "attribute.a.name", label: "A", value: "thickness" },
        { key: "attribute.a.parent", label: "A parent", value: "Arm" },
        { key: "attribute.b.name", label: "B", value: "thickness" },
        { key: "attribute.b.parent", label: "B parent", value: "LampSystem" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "duplicate_attribute");
});

Deno.test("planArchitectureInsertion: missing attribute is an enrichment write", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "Lamp" },
    { key: "system.name", label: "System", value: "LampSystem" },
    { key: "component.arm.name", label: "Arm", value: "Arm" },
    { key: "component.arm.usage", label: "Arm usage", value: "arm" },
    { key: "attribute.thickness.name", label: "Thickness", value: "thickness" },
    { key: "attribute.thickness.parent", label: "Thickness parent", value: "Arm" },
  ]);
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg",
    packageLabel: "Lamp",
    partDefs: [{
      id: "pd-system",
      label: "LampSystem",
      usages: [{ label: "arm", targetLabel: "Arm" }],
    }, {
      id: "pd-arm",
      label: "Arm",
      usages: [],
      attributes: [],
    }],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.toInsert, [{
    kind: "attribute",
    attributeName: "thickness",
    parentName: "Arm",
  }]);
});

Deno.test("parseArchitectureProposalParameters: component without explicit parent defaults to system", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  ]);
  assertEquals(proposal.components[0]?.parentName, "DroneSystem");
});

// ── Renderer invariants ──────────────────────────────────────────────────────

Deno.test("renderArchitectureSysml: golden deterministic output for a simple proposal", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    { key: "component.motor.name", label: "Motor", value: "Motor" },
    { key: "component.motor.usage", label: "Motor usage", value: "motor" },
    { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
  ]);
  const sysml = renderArchitectureSysml(proposal);
  const expected = [
    "package DroneV4 {",
    "  part def DroneSystem {",
    "    part wing : Wing;",
    "  }",
    "  part def Wing {",
    "    part motor : Motor;",
    "  }",
    "  part def Motor {}",
    "}",
  ].join("\n");
  assertEquals(sysml, expected);
});

Deno.test("renderArchitectureSysml: same input always produces same output", () => {
  const params: EngineeringDecisionProposalParameter[] = [
    { key: "architecture.package", label: "Package", value: "MyPkg" },
    { key: "system.name", label: "System", value: "Sys" },
    { key: "component.a.name", label: "A", value: "CompA" },
    { key: "component.a.usage", label: "A usage", value: "compA" },
  ];
  const proposal = parseArchitectureProposalParameters(params);
  assertEquals(renderArchitectureSysml(proposal), renderArchitectureSysml(proposal));
});

Deno.test("renderArchitectureSysml: usages appear inside the correct part def", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "Pkg" },
    { key: "system.name", label: "System", value: "Sys" },
    { key: "component.sub.name", label: "Sub", value: "Sub" },
    { key: "component.sub.usage", label: "Sub usage", value: "sub" },
  ]);
  const sysml = renderArchitectureSysml(proposal);
  // Usage 'sub : Sub' must appear inside 'part def Sys' block, not elsewhere.
  const lines = sysml.split("\n");
  const sysDefLine = lines.findIndex((l) => l.includes("part def Sys {"));
  const subUsageLine = lines.findIndex((l) => l.includes("part sub : Sub;"));
  const subDefLine = lines.findIndex((l) => l.includes("part def Sub {}"));
  // usage must come AFTER the system part def opening line
  assertEquals(subUsageLine > sysDefLine, true);
  // usage must come BEFORE the Sub part def declaration
  assertEquals(subUsageLine < subDefLine, true);
});

Deno.test("renderArchitectureSysml: usage names are scoped by their parent PartDefinition", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.left.name", label: "Left", value: "LeftWing" },
    { key: "component.left.usage", label: "Left", value: "leftWing" },
    { key: "component.right.name", label: "Right", value: "RightWing" },
    { key: "component.right.usage", label: "Right", value: "rightWing" },
    { key: "component.leftMotor.name", label: "Left motor", value: "LeftMotor" },
    { key: "component.leftMotor.usage", label: "Motor", value: "motor" },
    { key: "component.leftMotor.parent", label: "Parent", value: "LeftWing" },
    { key: "component.rightMotor.name", label: "Right motor", value: "RightMotor" },
    { key: "component.rightMotor.usage", label: "Motor", value: "motor" },
    { key: "component.rightMotor.parent", label: "Parent", value: "RightWing" },
  ]);

  const sysml = renderArchitectureSysml(proposal);
  assertEquals(sysml.match(/part motor :/g)?.length, 2);
  assertEquals(sysml.includes("part motor : LeftMotor;"), true);
  assertEquals(sysml.includes("part motor : RightMotor;"), true);
});

Deno.test("rendered architecture SysML keeps legacy full-package bytes and exact source spans", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  ]);
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  assertEquals(rendered.sourceText, renderArchitectureSysml(proposal));
  assertEquals(rendered.manifest.entries.map((entry) => entry.span), [
    { start: { line: 1, column: 0 }, end: { line: 1, column: 17 } },
    { start: { line: 2, column: 0 }, end: { line: 2, column: 24 } },
    { start: { line: 3, column: 0 }, end: { line: 3, column: 21 } },
    { start: { line: 5, column: 0 }, end: { line: 5, column: 18 } },
  ]);
  assertEquals(validateRenderedArchitectureSysml(rendered), rendered);
});

Deno.test("rendered architecture SysML supports exactly the registered enrichment forms", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    {
      key: "attribute.span.name",
      label: "Span",
      value: "span",
    },
    {
      key: "attribute.span.parent",
      label: "Span parent",
      value: "Wing",
    },
  ]);
  const partDef = renderArchitectureSysmlWithManifest(proposal, {
    kind: "part-def",
    packageName: "DroneV4",
    componentName: "Wing",
  });
  const usage = renderArchitectureSysmlWithManifest(proposal, {
    kind: "usage",
    packageName: "DroneV4",
    componentName: "Wing",
    usageName: "wing",
    parentName: "DroneSystem",
  });
  const attribute = renderArchitectureSysmlWithManifest(proposal, {
    kind: "attribute",
    packageName: "DroneV4",
    parentName: "Wing",
    attributeName: "span",
  });
  assertEquals(partDef.sourceText, "part def Wing {}");
  assertEquals(usage.sourceText, "part wing : Wing;");
  assertEquals(attribute.sourceText, "attribute span;");
  assertEquals(validateRenderedArchitectureSysml(partDef), partDef);
  assertEquals(validateRenderedArchitectureSysml(usage), usage);
  assertEquals(validateRenderedArchitectureSysml(attribute), attribute);
});

Deno.test("rendered architecture SysML rejects tampered source or manifest spans", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  ]);
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  assertThrows(() =>
    validateRenderedArchitectureSysml({
      ...rendered,
      sourceText: "package arbitrary {}",
    })
  );
  assertThrows(() =>
    validateRenderedArchitectureSysml({
      ...rendered,
      manifest: {
        ...rendered.manifest,
        entries: rendered.manifest.entries.map((entry, index) =>
          index === 0
            ? { ...entry, span: { ...entry.span, end: { line: 1, column: 1 } } }
            : entry
        ),
      },
    })
  );
});

Deno.test("rendered architecture SysML retains scoped repeated usage bytes through manifest validation", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.left.name", label: "Left", value: "LeftWing" },
    { key: "component.left.usage", label: "Left use", value: "leftWing" },
    { key: "component.right.name", label: "Right", value: "RightWing" },
    { key: "component.right.usage", label: "Right use", value: "rightWing" },
    { key: "component.leftMotor.name", label: "Left motor", value: "Motor" },
    { key: "component.leftMotor.usage", label: "Motor", value: "motor" },
    { key: "component.leftMotor.parent", label: "Parent", value: "LeftWing" },
    { key: "component.rightMotor.name", label: "Right motor", value: "Motor" },
    { key: "component.rightMotor.usage", label: "Motor", value: "motor" },
    { key: "component.rightMotor.parent", label: "Parent", value: "RightWing" },
  ]);
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  assertEquals(validateRenderedArchitectureSysml(rendered), rendered);
});

Deno.test("rendered architecture SysML rejects incoherent full-package manifest structure", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  ]);
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  assertThrows(() =>
    validateRenderedArchitectureSysml({
      ...rendered,
      manifest: {
        ...rendered.manifest,
        entries: rendered.manifest.entries.map((entry) =>
          entry.kind === "part-definition" && entry.definitionName === "DroneSystem"
            ? { ...entry, bodyStyle: "empty" }
            : entry
        ),
      },
    })
  );
  assertThrows(() =>
    validateRenderedArchitectureSysml({
      ...rendered,
      manifest: {
        ...rendered.manifest,
        entries: rendered.manifest.entries.filter((entry) =>
          entry.kind !== "part-definition" || entry.definitionName !== "Wing"
        ),
      },
    })
  );
});

// ── Insertion plan invariants ────────────────────────────────────────────────

Deno.test("planArchitectureInsertion: absent existing structure yields initial mode", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  ]);
  const plan = planArchitectureInsertion(undefined, proposal);
  assertEquals(plan.mode, "initial");
  assertEquals(plan.toInsert.length, 1);
  assertEquals(plan.toInsert[0]?.kind, "full-package");
  assertEquals(plan.adopted.length, 0);
  assertEquals(plan.conflicts.length, 0);
});

Deno.test("planArchitectureInsertion: all existing conformant components are adopted", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  ]);
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg-1",
    packageLabel: "DroneV4",
    partDefs: [
      {
        id: "sys-1",
        label: "DroneSystem",
        usages: [{ label: "wing", targetLabel: "Wing" }],
      },
      { id: "wing-1", label: "Wing", usages: [] },
    ],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.toInsert.length, 0);
  assertEquals(plan.adopted.length, 1);
  assertEquals(plan.adopted[0]?.componentName, "Wing");
  assertEquals(plan.conflicts.length, 0);
});

Deno.test("planArchitectureInsertion: new component in existing package generates part-def and usage items", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    { key: "component.motor.name", label: "Motor", value: "Motor" },
    { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  ]);
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg-1",
    packageLabel: "DroneV4",
    partDefs: [
      {
        id: "sys-1",
        label: "DroneSystem",
        usages: [{ label: "wing", targetLabel: "Wing" }],
      },
      { id: "wing-1", label: "Wing", usages: [] },
    ],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.conflicts.length, 0);
  assertEquals(plan.adopted.length, 1); // Wing is adopted

  const partDefItem = plan.toInsert.find((i) => i.kind === "part-def");
  assertEquals(
    partDefItem as { kind: "part-def"; componentName: string } | undefined,
    { kind: "part-def", componentName: "Motor" },
  );
  const usageItem = plan.toInsert.find(
    (i) =>
      i.kind === "usage" && (i as { componentName: string }).componentName === "Motor",
  );
  assertEquals(usageItem !== undefined, true);
});

Deno.test("planArchitectureInsertion: a shared PartDefinition is inserted once for two usages", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.left.name", label: "Left motor", value: "Motor" },
    { key: "component.left.usage", label: "Left motor", value: "leftMotor" },
    { key: "component.right.name", label: "Right motor", value: "Motor" },
    { key: "component.right.usage", label: "Right motor", value: "rightMotor" },
  ]);
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg-1",
    packageLabel: "DroneV4",
    partDefs: [{ id: "sys-1", label: "DroneSystem", usages: [] }],
  };

  const plan = planArchitectureInsertion(existing, proposal);

  assertEquals(plan.conflicts, []);
  assertEquals(
    plan.toInsert.filter((item) =>
      item.kind === "part-def" && item.componentName === "Motor"
    ).length,
    1,
  );
  assertEquals(
    plan.toInsert.filter((item) => item.kind === "usage").map((item) =>
      item.kind === "usage" ? item.usageName : ""
    ),
    ["leftMotor", "rightMotor"],
  );
});

Deno.test("planArchitectureInsertion: a scoped homonym under another parent is independent", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    { key: "component.motor.name", label: "Motor", value: "Motor" },
    { key: "component.motor.usage", label: "Motor usage", value: "motor" },
    { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
  ]);
  // Another `motor` occurrence already exists under DroneSystem. The proposal's
  // occurrence is scoped to Wing and must be inserted independently.
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg-1",
    packageLabel: "DroneV4",
    partDefs: [
      {
        id: "sys-1",
        label: "DroneSystem",
        usages: [
          { label: "wing", targetLabel: "Wing" },
          { label: "motor", targetLabel: "Motor" },
        ],
      },
      { id: "wing-1", label: "Wing", usages: [] },
      { id: "motor-1", label: "Motor", usages: [] },
    ],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.conflicts.length, 0);
  assertEquals(
    plan.toInsert.some((item) =>
      item.kind === "usage" && item.parentName === "Wing" && item.usageName === "motor"
    ),
    true,
  );
});

Deno.test("planArchitectureInsertion: pure enrichment has no full-package item", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    { key: "component.motor.name", label: "Motor", value: "Motor" },
    { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  ]);
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg-1",
    packageLabel: "DroneV4",
    partDefs: [
      { id: "sys-1", label: "DroneSystem", usages: [] },
    ],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.toInsert.some((i) => i.kind === "full-package"), false);
});

// ── Finding 2: adoption requires correct target type ─────────────────────────

Deno.test(
  "planArchitectureInsertion: adoption is refused when usage exists but types the wrong PartDef",
  () => {
    // Proposal: Wing under DroneSystem with usage "wing".
    // Model: usage "wing" exists under DroneSystem but types "Motor" — not Wing.
    // The usage must NOT be adopted; a "usage" insertion item must be planned
    // to fix the wrong type.
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        {
          id: "sys-1",
          label: "DroneSystem",
          // "wing" usage exists but types "Motor" — semantically wrong.
          usages: [{ label: "wing", targetLabel: "Motor" }],
        },
        { id: "wing-1", label: "Wing", usages: [] },
        { id: "motor-1", label: "Motor", usages: [] },
      ],
    };
    const plan = planArchitectureInsertion(existing, proposal);
    assertEquals(
      plan.adopted.length,
      0,
      "Wing must not be adopted — wrong target type",
    );
    // BLOQUANT B: the usage exists under the correct parent but types the wrong
    // PartDef. Insertion would create a second homonymous usage; that is wrong.
    // The plan must report a mistyped_usage conflict, not schedule an insertion.
    assertEquals(plan.conflicts.length, 1, "must report exactly one conflict");
    assertEquals(plan.conflicts[0]?.code, "mistyped_usage");
    assertEquals(
      plan.conflicts[0]?.code === "mistyped_usage"
        ? plan.conflicts[0].componentName
        : undefined,
      "Wing",
    );
    assertEquals(
      plan.toInsert.some((i) => i.kind === "usage"),
      false,
      "no usage insert when the existing usage has the wrong type",
    );
  },
);

Deno.test(
  "planArchitectureInsertion: duplicate same-parent usages are an ambiguity even when one is conformant",
  () => {
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        {
          id: "sys-1",
          label: "DroneSystem",
          usages: [
            { label: "wing", targetLabel: "Wing" },
            { label: "wing", targetLabel: "Motor" },
          ],
        },
        { id: "wing-1", label: "Wing", usages: [] },
        { id: "motor-1", label: "Motor", usages: [] },
      ],
    };

    const plan = planArchitectureInsertion(existing, proposal);

    assertEquals(plan.adopted.length, 0);
    assertEquals(plan.toInsert.length, 0);
    assertEquals(plan.conflicts.length, 1);
    assertEquals(plan.conflicts[0]?.code, "ambiguous_usage");
    assertEquals(
      plan.conflicts[0]?.code === "ambiguous_usage"
        ? plan.conflicts[0].componentName
        : undefined,
      "Wing",
    );
  },
);

Deno.test(
  "planArchitectureInsertion: exact duplicate same-parent usage rows are an ambiguity",
  () => {
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        {
          id: "sys-1",
          label: "DroneSystem",
          usages: [
            { label: "wing", targetLabel: "Wing" },
            { label: "wing", targetLabel: "Wing" },
          ],
        },
        { id: "wing-1", label: "Wing", usages: [] },
      ],
    };

    const plan = planArchitectureInsertion(existing, proposal);

    assertEquals(plan.conflicts.length, 1);
    assertEquals(plan.conflicts[0]?.code, "ambiguous_usage");
  },
);

Deno.test(
  "planArchitectureInsertion: an unrelated homonym does not block a new PartDef occurrence",
  () => {
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        { id: "sys-1", label: "DroneSystem", usages: [] },
        {
          id: "other-1",
          label: "OtherSystem",
          usages: [{ label: "wing", targetLabel: "LegacyWing" }],
        },
      ],
    };

    const plan = planArchitectureInsertion(existing, proposal);

    assertEquals(plan.conflicts.length, 0);
    assertEquals(
      plan.toInsert.some((item) =>
        item.kind === "part-def" && item.componentName === "Wing"
      ),
      true,
    );
    assertEquals(
      plan.toInsert.some((item) =>
        item.kind === "usage" && item.parentName === "DroneSystem" &&
        item.usageName === "wing"
      ),
      true,
    );
  },
);

Deno.test(
  "planArchitectureInsertion: a conformant local usage is adopted despite a scoped homonym",
  () => {
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        {
          id: "sys-1",
          label: "DroneSystem",
          usages: [{ label: "wing", targetLabel: "Wing" }],
        },
        { id: "wing-1", label: "Wing", usages: [] },
        {
          id: "other-1",
          label: "OtherSystem",
          usages: [{ label: "wing", targetLabel: "Wing" }],
        },
      ],
    };

    const plan = planArchitectureInsertion(existing, proposal);

    assertEquals(plan.adopted.length, 1);
    assertEquals(plan.conflicts.length, 0);
  },
);

Deno.test(
  "planArchitectureInsertion: a usage outside the proposal does not claim the local name",
  () => {
    // Proposal: Wing under DroneSystem. A separate owner outside the proposal
    // already has its own scoped `wing` occurrence.
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        { id: "sys-1", label: "DroneSystem", usages: [] },
        { id: "wing-1", label: "Wing", usages: [] },
        // "OtherSystem" is NOT in the proposal but has the "wing" usage.
        {
          id: "other-1",
          label: "OtherSystem",
          usages: [{ label: "wing", targetLabel: "Wing" }],
        },
      ],
    };
    const plan = planArchitectureInsertion(existing, proposal);
    assertEquals(plan.conflicts.length, 0);
    assertEquals(
      plan.toInsert,
      [{
        kind: "usage",
        componentName: "Wing",
        usageName: "wing",
        parentName: "DroneSystem",
      }],
    );
  },
);

// ── Finding 5: ambiguity error on duplicate PartDef labels ───────────────────

Deno.test(
  "planArchitectureInsertion: throws ArchitectureInsertionAmbiguityError on duplicate PartDef labels",
  () => {
    const proposal = parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "DroneV4" },
      { key: "system.name", label: "System", value: "DroneSystem" },
      { key: "component.wing.name", label: "Wing", value: "Wing" },
      { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    ]);
    // Two PartDefs share the label "Wing" — ambiguous.
    const existing: ExistingArchitectureStructure = {
      packageId: "pkg-1",
      packageLabel: "DroneV4",
      partDefs: [
        { id: "sys-1", label: "DroneSystem", usages: [] },
        { id: "wing-1", label: "Wing", usages: [] },
        { id: "wing-2", label: "Wing", usages: [] }, // duplicate
      ],
    };
    let threw = false;
    try {
      planArchitectureInsertion(existing, proposal);
    } catch (e) {
      threw = true;
      assertEquals(e instanceof ArchitectureInsertionAmbiguityError, true);
      const err = e as ArchitectureInsertionAmbiguityError;
      assertEquals(err.code, "ambiguous_part_def_labels");
      assertEquals(err.duplicateLabels.includes("Wing"), true);
    }
    assertEquals(threw, true, "must throw ArchitectureInsertionAmbiguityError");
  },
);
