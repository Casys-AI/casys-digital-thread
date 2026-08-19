import { assertEquals, assertThrows } from "@std/assert";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../renderer/architecture-proposal.ts";
import {
  ArchitectureSysmlParseError,
  parseArchitectureSysmlSubset,
} from "./architecture-sysml-parse.ts";

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  { key: "component.motor.name", label: "Motor", value: "Motor" },
  { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
]);

Deno.test("renderArchitectureSysmlWithManifest output parses with unresolved=[]", () => {
  const selectors = [
    undefined,
    {
      kind: "part-def" as const,
      packageName: "DroneV4",
      componentName: "Motor",
    },
    {
      kind: "usage" as const,
      packageName: "DroneV4",
      componentName: "Wing",
      usageName: "wing",
      parentName: "DroneSystem",
    },
  ];
  for (const selector of selectors) {
    const rendered = selector === undefined
      ? renderArchitectureSysmlWithManifest(proposal)
      : renderArchitectureSysmlWithManifest(proposal, selector);
    const parsed = parseArchitectureSysmlSubset(rendered.sourceText);
    assertEquals(parsed.unresolved, []);
  }
});

Deno.test("architecture SysML parser records extra constructs as unresolved", () => {
  const parsed = parseArchitectureSysmlSubset([
    "package DroneV4 {",
    "  part def DroneSystem {",
    "    part wing : Wing;",
    "    requirement mass;",
    "  }",
    "  part def Wing {}",
    "}",
  ].join("\n"));
  assertEquals(parsed.form, "package");
  assertEquals(parsed.unresolved.map((item) => item.kind), [
    "sysml-construct-not-qualified",
  ]);
  assertEquals(parsed.package?.definitions.length, 2);
});

Deno.test("architecture SysML parser rejects a source that is not one write form", () => {
  const error = assertThrows(
    () => parseArchitectureSysmlSubset("def Motor {}"),
    ArchitectureSysmlParseError,
  );
  assertEquals(error.code, "syntax_not_recognized");
});
