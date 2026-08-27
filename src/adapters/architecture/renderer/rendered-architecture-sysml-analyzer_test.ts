import { assertEquals, assertRejects } from "@std/assert";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  RenderedArchitectureSysmlAnalyzer,
  sysmlRenderedSourceIdFor,
} from "./rendered-architecture-sysml-analyzer.ts";

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  { key: "component.motor.name", label: "Motor", value: "Motor" },
  { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
]);

Deno.test("rendered SysML analyzer emits only manifest-attested usage to target incidences", async () => {
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  const sourceId = await sysmlRenderedSourceIdFor(
    rendered.manifest.selector,
    "run-1",
    { id: "model.write-architecture", version: "1" },
  );
  const bundle = await new RenderedArchitectureSysmlAnalyzer().analyzeRendered({
    sourceId,
    rendered,
  });
  assertEquals(bundle.source.role, "sysml-model");
  assertEquals(bundle.source.language, "sysml-v2");
  assertEquals(bundle.dependencies.map((relation) => relation.kind), [
    "structural-incidence",
    "structural-incidence",
  ]);
  assertEquals(bundle.dependencies.length, 2);
  assertEquals(bundle.symbols.some((symbol) => symbol.name === "DroneV4"), true);
  assertEquals(bundle.unresolvedConstructs, []);
});

Deno.test("rendered SysML analyzer rejects arbitrary text and a tampered manifest", async () => {
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  const sourceId = await sysmlRenderedSourceIdFor(
    rendered.manifest.selector,
    "run-1",
    { id: "model.write-architecture", version: "1" },
  );
  const analyzer = new RenderedArchitectureSysmlAnalyzer();
  await assertRejects(
    () =>
      analyzer.analyzeRendered({
        sourceId,
        rendered: { ...rendered, sourceText: "part def Arbitrary {}" },
      }),
    TypeError,
  );
  await assertRejects(
    () =>
      analyzer.analyzeRendered({
        sourceId,
        rendered: { ...rendered, manifest: { ...rendered.manifest, entries: [] } },
      }),
    TypeError,
  );
});

Deno.test("rendered SysML source identities hash canonical tuples without delimiter collisions", async () => {
  const left = await sysmlRenderedSourceIdFor(
    {
      kind: "part-def",
      packageName: "A",
      componentName: "BC",
    },
    "run-1",
    { id: "model.write-architecture", version: "1" },
  );
  const right = await sysmlRenderedSourceIdFor(
    {
      kind: "part-def",
      packageName: "AB",
      componentName: "C",
    },
    "run-1",
    { id: "model.write-architecture", version: "1" },
  );
  assertEquals(left === right, false);
});

Deno.test("rendered SysML analyzer represents an enrichment usage target as an attested reference", async () => {
  const rendered = renderArchitectureSysmlWithManifest(proposal, {
    kind: "usage",
    packageName: "DroneV4",
    componentName: "Wing",
    usageName: "wing",
    parentName: "DroneSystem",
  });
  const sourceId = await sysmlRenderedSourceIdFor(
    rendered.manifest.selector,
    "run-1",
    { id: "model.write-architecture", version: "1" },
  );
  const bundle = await new RenderedArchitectureSysmlAnalyzer().analyzeRendered({
    sourceId,
    rendered,
  });
  assertEquals(
    bundle.symbols.map((symbol) => ({ name: symbol.name, span: symbol.span })),
    [
      {
        name: "wing",
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 17 } },
      },
      { name: "Wing", span: undefined },
    ],
  );
  assertEquals(bundle.dependencies.length, 1);
  assertEquals(bundle.dependencies[0]?.kind, "structural-incidence");
});

Deno.test("rendered SysML analyzer names a system-only AttributeUsage", async () => {
  const rendered = renderArchitectureSysmlWithManifest(
    parseArchitectureProposalParameters([
      { key: "architecture.package", label: "Package", value: "Cantilever" },
      { key: "system.name", label: "System", value: "CantileverArm" },
      {
        key: "attribute.thickness.name",
        label: "Thickness",
        value: "thickness",
      },
      {
        key: "attribute.thickness.parent",
        label: "Thickness parent",
        value: "CantileverArm",
      },
    ]),
  );
  const sourceId = await sysmlRenderedSourceIdFor(
    rendered.manifest.selector,
    "run-1",
    { id: "model.write-architecture", version: "1" },
  );
  const bundle = await new RenderedArchitectureSysmlAnalyzer().analyzeRendered({
    sourceId,
    rendered,
  });
  assertEquals(
    bundle.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`).sort(),
    ["artifact:Cantilever", "component:CantileverArm", "parameter:thickness"],
  );
  assertEquals(bundle.unresolvedConstructs, []);
});
