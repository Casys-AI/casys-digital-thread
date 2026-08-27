import { assertEquals, assertThrows } from "@std/assert";
import {
  ArchitectureSysmlLexicalError,
  tokenizeArchitectureSysml,
} from "./architecture-sysml-lexical.ts";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../renderer/architecture-proposal.ts";

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  { key: "component.motor.name", label: "Motor", value: "Motor" },
  { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
]);

Deno.test("architecture SysML lexical guard tokenizes the three renderer forms", () => {
  const packageTokens = tokenizeArchitectureSysml(
    renderArchitectureSysmlWithManifest(proposal).sourceText,
  );
  assertEquals(packageTokens[0], {
    kind: "keyword",
    text: "package",
    from: 0,
    to: 7,
    span: { start: { line: 1, column: 0 }, end: { line: 1, column: 7 } },
  });
  const partDef = tokenizeArchitectureSysml(
    renderArchitectureSysmlWithManifest(proposal, {
      kind: "part-def",
      packageName: "DroneV4",
      componentName: "Motor",
    }).sourceText,
  );
  assertEquals(partDef.map((token) => token.text), ["part", "def", "Motor", "{", "}"]);
  const usage = tokenizeArchitectureSysml(
    renderArchitectureSysmlWithManifest(proposal, {
      kind: "usage",
      packageName: "DroneV4",
      componentName: "Wing",
      usageName: "wing",
      parentName: "DroneSystem",
    }).sourceText,
  );
  assertEquals(usage.map((token) => token.text), ["part", "wing", ":", "Wing", ";"]);
});

Deno.test("architecture SysML lexical guard rejects comments, strings, numbers, and attributes", () => {
  const cases: Array<[string, ArchitectureSysmlLexicalError["code"]]> = [
    ["package P { // x }", "comment_not_qualified"],
    ["package P { /* x */ }", "comment_not_qualified"],
    ["package P { -- x }", "comment_not_qualified"],
    ["# package P {}", "comment_not_qualified"],
    ['package "P" {}', "string_not_qualified"],
    ["part def Motor { 1 }", "number_not_qualified"],
    ["package P { @attribute }", "attribute_not_qualified"],
    ["package P { ! }", "unrecognized_token"],
  ];
  for (const [source, code] of cases) {
    const error = assertThrows(
      () => tokenizeArchitectureSysml(source),
      ArchitectureSysmlLexicalError,
    );
    assertEquals(error.code, code);
  }
});

Deno.test("architecture SysML lexical guard rejects empty and oversized sources", () => {
  const empty = assertThrows(
    () => tokenizeArchitectureSysml("   \n"),
    ArchitectureSysmlLexicalError,
  );
  assertEquals(empty.code, "empty_source");
});
