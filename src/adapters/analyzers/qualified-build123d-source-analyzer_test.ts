import { assert, assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
  QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  QualifiedBuild123dSourceAnalyzer,
} from "./qualified-build123d-source-analyzer.ts";

const INPUT = {
  sourceId: "cad:qualified-part",
  role: "cad-script" as const,
  language: "python" as const,
};

Deno.test("qualified build123d frontend proves a simple Box without executing it", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
width = 10
height = width * 2
depth = 3
labels = [1, 2 + 3, -4]
result = Box(width, height, depth)
`,
  });

  assertEquals(bundle.analyzer, {
    id: QUALIFIED_BUILD123D_SOURCE_ANALYZER_ID,
    version: QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION,
  });
  assertEquals(bundle.policy, {
    profile: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
    status: "passed",
    findings: [],
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    new Map(bundle.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["width", "parameter"],
      ["height", "parameter"],
      ["depth", "parameter"],
      ["labels", "parameter"],
      ["result", "artifact"],
    ]),
  );
  for (const symbol of bundle.symbols) {
    assert(
      /^(artifact|parameter):[a-f0-9]{64}$/.test(symbol.id),
      `${symbol.id} must be derived from the parsed AST`,
    );
    assertNotEquals(symbol.id, `${symbol.kind}:${symbol.name}`);
  }

  const byName = new Map(bundle.symbols.map((symbol) => [symbol.name, symbol]));
  assertEquals(
    bundle.dependencies.map((dependency) => ({
      kind: dependency.kind,
      from: bundle.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name,
      to: bundle.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
        ?.name,
    })).sort((left, right) =>
      `${left.kind}:${left.from}:${left.to}`.localeCompare(
        `${right.kind}:${right.from}:${right.to}`,
      )
    ),
    [
      { kind: "static-value-flow" as const, from: "width", to: "height" },
      { kind: "structural-incidence" as const, from: "depth", to: "result" },
      { kind: "structural-incidence" as const, from: "height", to: "result" },
      { kind: "structural-incidence" as const, from: "width", to: "result" },
    ].sort((left, right) =>
      `${left.kind}:${left.from}:${left.to}`.localeCompare(
        `${right.kind}:${right.from}:${right.to}`,
      )
    ),
  );
  assert(byName.get("result")?.id.startsWith("artifact:"));
});

Deno.test("qualified build123d frontend accepts an explicit Box alias and parsed flat lists", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box as Cuboid
dimensions = [10, 20, 30]
length = 10
width = 20
height = 30
result = Cuboid(length, width, height)
`,
  });

  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "dimensions")?.kind,
    "parameter",
  );
});

Deno.test("multiple local bindings for Box are ambiguous rather than fully qualified", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box as X, Box as Y
result = Y(1, 2, 3)
`,
  });

  assertEquals(bundle.policy.status, "passed");
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-import-ambiguous"
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("qualified build123d frontend turns forbidden imports and calls into rejected analysis", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  for (
    const sourceText of [
      "import os\nresult = Box(1, 2, 3)\n",
      "from build123d import Box\nresult = eval('Box(1, 2, 3)')\n",
      "from build123d import export_step\nresult = Box(1, 2, 3)\n",
    ]
  ) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "rejected");
    assertEquals(bundle.policy.findings[0]?.severity, "error");
    assertEquals(bundle.symbols, []);
    assertEquals(bundle.dependencies, []);
    assertEquals(bundle.unresolvedConstructs, []);
  }
});

Deno.test("qualified build123d frontend accepts Cone, Sphere, and Rot", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Cone
bottom = 10
top = 0
height = 20
result = Cone(bottom, top, height)
`,
    `from build123d import Sphere
radius = 5
result = Sphere(radius)
`,
    `from build123d import Box, Rot
result = Rot(0, 0, 45) * Box(10, 20, 30)
`,
    `from build123d import Cone, Rot, Sphere
bottom = 10
top = 0
height = 20
radius = 5
cone = Cone(bottom, top, height)
sphere = Rot(90, 0, 0) * Sphere(radius)
result = cone + sphere
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }
});

Deno.test("qualified build123d frontend proves Torus, Ellipsoid and Wedge solids", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Torus
result = Torus(10, 2)
`,
    `from build123d import Ellipsoid, Pos
result = Pos(20, 0, 0) * Ellipsoid(4, 3, 2)
`,
    `from build123d import Wedge
result = Wedge(10, 10, 10, 2, 2, 8, 8)
`,
    `from build123d import Compound, Ellipsoid, Pos, Rot, Torus, Wedge
ring = Rot(0, 90, 0) * Torus(10, 2)
blob = Pos(20, 0, 0) * Ellipsoid(4, 3, 2)
key = Wedge(10, 10, 10, 2, 2, 8, 8)
result = Compound(children=[ring, blob, key])
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }
});

Deno.test("qualified build123d frontend proves solid minus solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Cylinder, Pos
block = Box(20, 20, 10)
bore = Pos(0, 0, 0) * Cylinder(4, 12)
result = block - bore
`,
  });

  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("solid division stays explicitly unresolved", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Cylinder
result = Box(20, 20, 10) / Cylinder(4, 12)
`,
  });

  assertEquals(bundle.policy.status, "passed");
  const kinds = new Set(
    bundle.unresolvedConstructs.map((construct) => construct.kind),
  );
  assert(kinds.has("build123d-result-not-qualified"));
});

Deno.test("Wedge with fewer than seven positional arguments stays unresolved", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Wedge
result = Wedge(10, 10, 10)
`,
  });

  assertEquals(bundle.policy.status, "passed");
  const kinds = new Set(
    bundle.unresolvedConstructs.map((construct) => construct.kind),
  );
  assert(kinds.has("python-dynamic-call"));
  assert(kinds.has("build123d-result-not-qualified"));
});

Deno.test("qualified build123d frontend proves fillet of all edges by a radius", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges(), radius=2)
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
radius = 2
result = fillet(base.edges(), radius=radius)
`,
    `from build123d import Box, fillet as round_edges
result = round_edges(Box(10, 10, 10).edges(), radius=2)
`,
    `from build123d import Box, Cylinder, fillet
block = Box(20, 20, 10)
bore = Cylinder(4, 12)
result = fillet((block - bore).edges(), radius=1)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(bundle.analyzer.version, "1.2.0");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }

  const named = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, fillet
base = Box(10, 10, 10)
radius = 2
result = fillet(base.edges(), radius=radius)
`,
  });
  assertEquals(
    new Map(named.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["base", "variable"],
      ["radius", "parameter"],
      ["result", "artifact"],
    ]),
  );
  assertEquals(
    named.dependencies.map((dependency) => ({
      kind: dependency.kind,
      from: named.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name,
      to: named.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
        ?.name,
    })).sort((left, right) =>
      `${left.kind}:${left.from}:${left.to}`.localeCompare(
        `${right.kind}:${right.from}:${right.to}`,
      )
    ),
    [
      { kind: "structural-incidence" as const, from: "base", to: "result" },
      { kind: "structural-incidence" as const, from: "radius", to: "result" },
    ],
  );
});

Deno.test("D4-admitted but unqualified build123d calls remain explicitly unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  // fillet with positional radius (not keyword) stays unresolved.
  const bundle = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base, 2)
`,
  });
  assertEquals(bundle.policy.status, "passed");
  const kinds = new Set(
    bundle.unresolvedConstructs.map((construct) => construct.kind),
  );
  assert(kinds.has("build123d-result-not-qualified"));
  assert(kinds.has("python-dynamic-call"));
});

Deno.test("qualified build123d frontend proves chamfer of all edges by a length", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
result = chamfer(base.edges(), 2)
`,
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
length = 2
result = chamfer(base.edges(), length)
`,
    `from build123d import Box, chamfer as bevel
result = bevel(Box(10, 10, 10).edges(), 1)
`,
    `from build123d import Box, Cylinder, chamfer
block = Box(20, 20, 10)
bore = Cylinder(4, 12)
result = chamfer((block - bore).edges(), 1)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(bundle.analyzer.version, "1.2.0");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }

  // Dependency graph for chamfer with a named length parameter.
  const named = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, chamfer
base = Box(10, 10, 10)
length = 2
result = chamfer(base.edges(), length)
`,
  });
  assertEquals(
    new Map(named.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["base", "variable"],
      ["length", "parameter"],
      ["result", "artifact"],
    ]),
  );
  assertEquals(
    named.dependencies.map((dependency) => ({
      kind: dependency.kind,
      from: named.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name,
      to: named.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
        ?.name,
    })).sort((left, right) =>
      `${left.kind}:${left.from}:${left.to}`.localeCompare(
        `${right.kind}:${right.from}:${right.to}`,
      )
    ),
    [
      { kind: "structural-incidence" as const, from: "base", to: "result" },
      { kind: "structural-incidence" as const, from: "length", to: "result" },
    ],
  );
});

Deno.test("chamfer keyword length, extra args, method form, or faces stay unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    // keyword length= is not the reviewed positional form
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
result = chamfer(base.edges(), length=2)
`,
    // two lengths (length2=) are not qualified
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
result = chamfer(base.edges(), 1, 2)
`,
    // method form is not qualified
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
result = base.chamfer(2)
`,
    // .faces() selector is not qualified
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
result = chamfer(base.faces(), 1)
`,
    // no length argument
    `from build123d import Box, chamfer
base = Box(10, 10, 10)
result = chamfer(base.edges())
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
  }
});

Deno.test("fillet method, 1-arg, extra kwargs, or Scale stay unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges())
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = base.fillet(2)
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges(), radius=2, extra=1)
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges(), length=2)
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.faces(), radius=2)
`,
    `from build123d import Axis, Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges().filter_by(Axis.Z), radius=2)
`,
    `from build123d import Box
base = Box(10, 10, 10)
result = base.edges()
`,
    `from build123d import Box, Scale
result = Scale(2) * Box(10, 20, 30)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
  }
});

Deno.test("qualified build123d frontend proves scale of a solid by a scalar", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, scale
result = scale(Box(10, 20, 30), 2)
`,
    `from build123d import Box, scale
block = Box(10, 20, 30)
factor = 2
result = scale(block, factor)
`,
    `from build123d import Cylinder, Pos, scale
bore = Pos(0, 0, 0) * Cylinder(4, 12)
result = scale(bore, 0.5)
`,
    `from build123d import Box, Cylinder, scale
block = Box(20, 20, 10)
bore = Cylinder(4, 12)
result = scale(block - bore, 2)
`,
    `from build123d import Box, scale as enlarge
result = enlarge(Box(10, 10, 10), 3)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(bundle.analyzer.version, "1.2.0");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }

  const named = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, scale
block = Box(10, 20, 30)
factor = 2
result = scale(block, factor)
`,
  });
  assertEquals(
    new Map(named.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["block", "variable"],
      ["factor", "parameter"],
      ["result", "artifact"],
    ]),
  );
  assertEquals(
    named.dependencies.map((dependency) => ({
      kind: dependency.kind,
      from: named.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name,
      to: named.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
        ?.name,
    })).sort((left, right) =>
      `${left.kind}:${left.from}:${left.to}`.localeCompare(
        `${right.kind}:${right.from}:${right.to}`,
      )
    ),
    [
      { kind: "structural-incidence" as const, from: "block", to: "result" },
      { kind: "structural-incidence" as const, from: "factor", to: "result" },
    ],
  );
});

Deno.test("scale kwargs, one-arg, or non-uniform factors stay unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, scale
result = scale(Box(10, 20, 30))
`,
    `from build123d import Box, scale
result = scale(Box(10, 20, 30), by=2)
`,
    `from build123d import Box, scale
result = scale(Box(10, 20, 30), 2, about=0)
`,
    `from build123d import Box, scale
result = scale(Box(10, 20, 30), mode=1)
`,
    `from build123d import Box, scale
result = scale(Box(10, 20, 30), [2, 2, 2])
`,
    `from build123d import Box, scale
result = scale(Box(10, 20, 30), (2, 2, 2))
`,
    `from build123d import Box, Scale
result = Scale(2) * Box(10, 20, 30)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
  }
});

Deno.test("qualified build123d frontend proves the DL-04 part and assembly solids", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Cylinder, Pos
result = Pos(0, 0, 10) * Cylinder(90, 20)
`,
    `from build123d import Box, Pos
column = Pos(0, 0, 190) * Box(28, 28, 340)
arm = Pos(180, 0, 346) * Box(360, 28, 28)
result = column + arm
`,
    `from build123d import Box, Compound, Cylinder, Pos
base = Pos(0, 0, 10) * Cylinder(90, 20)
column = Pos(0, 0, 190) * Box(28, 28, 340)
arm = Pos(180, 0, 346) * Box(360, 28, 28)
articulated_arm = column + arm
head = Pos(360, 0, 346) * Cylinder(34, 40)
bulb_holder = Pos(360, 0, 318) * Cylinder(14, 16)
result = Compound(children=[base, articulated_arm, head, bulb_holder])
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }

  const fused = await analyzer.analyze({
    ...INPUT,
    sourceText: scripts[1]!,
  });
  assertEquals(
    new Map(fused.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["column", "variable"],
      ["arm", "variable"],
      ["result", "artifact"],
    ]),
  );
  assertEquals(
    fused.dependencies.map((dependency) => ({
      kind: dependency.kind,
      from: fused.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name,
      to: fused.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
        ?.name,
    })).sort((left, right) =>
      `${left.kind}:${left.from}:${left.to}`.localeCompare(
        `${right.kind}:${right.from}:${right.to}`,
      )
    ),
    [
      { kind: "structural-incidence" as const, from: "arm", to: "result" },
      { kind: "structural-incidence" as const, from: "column", to: "result" },
    ],
  );
});

Deno.test("a bare Pos, Rot, or Compound without named children stays unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const barePos = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Pos
result = Pos(0, 0, 10)
`,
  });
  const bareRot = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Rot
result = Rot(0, 0, 45)
`,
  });
  const emptyCompound = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Compound
result = Compound(children=[])
`,
  });
  for (const bundle of [barePos, bareRot, emptyCompound]) {
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
    );
  }
});

Deno.test("Lezer-recovered non-decimal or malformed numbers never qualify silently", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  for (const literal of ["0x10", "01", "1_", "1__0", ".1_"]) {
    const bundle = await analyzer.analyze({
      ...INPUT,
      sourceText: `from build123d import Box
candidate = ${literal}
result = Box(1, 2, 3)
`,
    });
    assert(
      bundle.policy.status === "rejected" ||
        bundle.unresolvedConstructs.length > 0,
      `${literal} must not produce passed plus empty unresolved`,
    );
    assertEquals(
      bundle.symbols.some((symbol) => symbol.name === "candidate"),
      false,
    );
  }
});

Deno.test("branches and dynamic attribute or starred calls cannot look fully qualified", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const sources = [
    `from build123d import Box
enabled = 1
if enabled:
    branch_value = 2
result = Box(enabled, 2, 3)
`,
    `from build123d import Box
result = Box.factory(1, 2, 3)
`,
    `from build123d import Box
dimensions = [1, 2, 3]
result = Box(*dimensions)
`,
  ];

  const bundles = await Promise.all(
    sources.map((sourceText) => analyzer.analyze({ ...INPUT, sourceText })),
  );
  for (const bundle of bundles) {
    assertEquals(bundle.policy.status, "passed");
    assert(bundle.unresolvedConstructs.length > 0);
  }
  assert(
    bundles[0]!.unresolvedConstructs.some((item) => item.kind === "python-branch"),
  );
  assert(
    bundles[1]!.unresolvedConstructs.some((item) =>
      item.kind === "python-dynamic-attribute"
    ),
  );
  assert(
    bundles[2]!.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("imports and parameters declared after result cannot qualify forward references", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const lateImport = await analyzer.analyze({
    ...INPUT,
    sourceText: `result = Box(1, 2, 3)
from build123d import Box
`,
  });
  const lateParameter = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box
result = Box(width, 2, 3)
width = 10
`,
  });

  for (const bundle of [lateImport, lateParameter]) {
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
    );
  }
});

Deno.test("repeated identical unresolved constructs keep distinct stable identities", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
if 1:
    branch = 2
if 1:
    branch = 2
result = Box(1, 2, 3)
`,
  });
  const branches = bundle.unresolvedConstructs.filter((item) =>
    item.kind === "python-branch"
  );
  assertEquals(branches.length, 2);
  assertNotEquals(branches[0]!.id, branches[1]!.id);
});

Deno.test("an unrelated unresolved statement does not renumber a branch identity", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const base = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box
if 1:
    branch = 2
result = Box(1, 2, 3)
`,
  });
  const withPass = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box
pass
if 1:
    branch = 2
result = Box(1, 2, 3)
`,
  });
  assertEquals(
    base.unresolvedConstructs.find((item) => item.kind === "python-branch")?.id,
    withPass.unresolvedConstructs.find((item) => item.kind === "python-branch")
      ?.id,
  );
});

Deno.test("exact source bytes are fingerprinted while AST symbol identities ignore whitespace", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const compact = `from build123d import Box
width=10
height=20
depth=30
result=Box(width,height,depth)
`;
  const spaced = `from build123d import Box
width = 10
height = 20
depth = 30
result = Box(width, height, depth)  # same parsed construction
`;
  const first = await analyzer.analyze({ ...INPUT, sourceText: compact });
  const replay = await analyzer.analyze({ ...INPUT, sourceText: compact });
  const reformatted = await analyzer.analyze({ ...INPUT, sourceText: spaced });

  assertEquals(first, replay);
  assertNotEquals(first.source.fingerprint, reformatted.source.fingerprint);
  assertEquals(
    first.symbols.map(({ id, kind, name }) => ({ id, kind, name })),
    reformatted.symbols.map(({ id, kind, name }) => ({ id, kind, name })),
  );
  const independentDigest = [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(compact),
      ),
    ),
  ].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  assertEquals(first.source.fingerprint.digest, independentDigest);
});

Deno.test("qualified build123d frontend performs no network fetch", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = (..._arguments: Parameters<typeof fetch>) => {
    fetchCount++;
    throw new Error("fetch is forbidden in source analysis");
  };
  try {
    const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
      ...INPUT,
      sourceText: "from build123d import Box\nresult = Box(1, 2, 3)\n",
    });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("qualified build123d frontend refuses a role or language substitution", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  await assertRejects(
    () =>
      analyzer.analyze({
        sourceId: INPUT.sourceId,
        role: "modelica-model",
        language: "modelica",
        sourceText: "from build123d import Box\nresult = Box(1, 2, 3)\n",
      }),
    TypeError,
    "only accepts cad-script/python",
  );
});
