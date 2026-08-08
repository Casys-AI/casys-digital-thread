import { assertEquals, assertThrows } from "@std/assert";
import {
  ArchitectureProposalParseError,
  type ExistingArchitectureStructure,
  parseArchitectureProposalParameters,
  planArchitectureInsertion,
  renderArchitectureSysml,
} from "./architecture-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../project/engineering-project.ts";

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

Deno.test("parseArchitectureProposalParameters: no components is rejected as empty_proposal", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "empty_proposal");
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

Deno.test("parseArchitectureProposalParameters: duplicate component names are rejected", () => {
  const error = assertThrows(
    () =>
      parseArchitectureProposalParameters([
        { key: "architecture.package", label: "Package", value: "DroneV4" },
        { key: "system.name", label: "System", value: "DroneSystem" },
        { key: "component.wing.name", label: "Wing name", value: "Wing" },
        { key: "component.wing.usage", label: "Wing usage", value: "wing" },
        { key: "component.wing2.name", label: "Wing2 name", value: "Wing" },
        { key: "component.wing2.usage", label: "Wing2 usage", value: "wing2" },
      ]),
    ArchitectureProposalParseError,
  ) as ArchitectureProposalParseError;
  assertEquals(error.code, "duplicate_component");
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
      { id: "sys-1", label: "DroneSystem", usageLabels: ["wing"] },
      { id: "wing-1", label: "Wing", usageLabels: [] },
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
      { id: "sys-1", label: "DroneSystem", usageLabels: ["wing"] },
      { id: "wing-1", label: "Wing", usageLabels: [] },
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

Deno.test("planArchitectureInsertion: same-name-different-parent is a named conflict", () => {
  const proposal = parseArchitectureProposalParameters([
    { key: "architecture.package", label: "Package", value: "DroneV4" },
    { key: "system.name", label: "System", value: "DroneSystem" },
    { key: "component.wing.name", label: "Wing", value: "Wing" },
    { key: "component.wing.usage", label: "Wing usage", value: "wing" },
    { key: "component.motor.name", label: "Motor", value: "Motor" },
    { key: "component.motor.usage", label: "Motor usage", value: "motor" },
    { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
  ]);
  // Motor's usage "motor" exists under DroneSystem (not Wing) — conflict.
  const existing: ExistingArchitectureStructure = {
    packageId: "pkg-1",
    packageLabel: "DroneV4",
    partDefs: [
      { id: "sys-1", label: "DroneSystem", usageLabels: ["wing", "motor"] },
      { id: "wing-1", label: "Wing", usageLabels: [] },
      { id: "motor-1", label: "Motor", usageLabels: [] },
    ],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.conflicts.length, 1);
  assertEquals(plan.conflicts[0]?.code, "same-name-different-parent");
  assertEquals(plan.conflicts[0]?.componentName, "Motor");
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
      { id: "sys-1", label: "DroneSystem", usageLabels: [] },
    ],
  };
  const plan = planArchitectureInsertion(existing, proposal);
  assertEquals(plan.mode, "enrichment");
  assertEquals(plan.toInsert.some((i) => i.kind === "full-package"), false);
});
