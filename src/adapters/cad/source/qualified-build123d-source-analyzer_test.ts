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
    assertEquals(bundle.analyzer.version, QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION);
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
  const bundle = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Polygon
result = Polygon([(0, 0), (1, 0), (0, 1)])
`,
  });
  assertEquals(bundle.policy.status, "passed");
  const kinds = new Set(
    bundle.unresolvedConstructs.map((construct) => construct.kind),
  );
  assert(kinds.has("build123d-call-not-qualified"));
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
    assertEquals(bundle.analyzer.version, QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION);
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
    const methodForm = sourceText.includes("base.chamfer(");
    assertEquals(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-chamfer-argument-not-qualified"
      ),
      !methodForm,
      `${sourceText} must ${methodForm ? "not " : ""}label chamfer arguments`,
    );
  }
});

Deno.test("fillet method, 1-arg, extra kwargs, or Scale stay unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const expectFilletArgument = [
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges())
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
  ];
  const noFilletArgument = [
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = base.fillet(2)
`,
    `from build123d import Box
base = Box(10, 10, 10)
result = base.edges()
`,
    `from build123d import Box, Scale
result = Scale(2) * Box(10, 20, 30)
`,
  ];
  for (const sourceText of [...expectFilletArgument, ...noFilletArgument]) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
  }
  for (const sourceText of expectFilletArgument) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-fillet-argument-not-qualified"
      ),
      `${sourceText} must label fillet arguments`,
    );
  }
  for (const sourceText of noFilletArgument) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-fillet-argument-not-qualified"
      ),
      false,
      `${sourceText} must not label fillet arguments`,
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
    assertEquals(bundle.analyzer.version, QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION);
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
    if (sourceText.includes("from build123d import Box, Scale")) {
      assert(
        bundle.unresolvedConstructs.some((item) =>
          item.kind === "build123d-placement-not-qualified"
        ),
        `${sourceText} must also label the unqualified Scale placement`,
      );
    }
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

Deno.test("qualified finite decimal spellings share one parser grammar", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  for (const literal of ["1_000", ".5", "+1", "1e-3"]) {
    const bundle = await analyzer.analyze({
      ...INPUT,
      sourceText: `from build123d import Box
candidate = ${literal}
result = Box(1, 2, candidate)
`,
    });
    assertEquals(bundle.policy.status, "passed", literal);
    assertEquals(bundle.unresolvedConstructs, [], literal);
    assert(
      bundle.symbols.some((symbol) =>
        symbol.kind === "parameter" && symbol.name === "candidate"
      ),
      `${literal} must remain a parser-reported parameter`,
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

function identityView(bundle: {
  readonly symbols: readonly {
    readonly id: string;
    readonly kind: string;
    readonly name: string;
  }[];
  readonly dependencies: readonly {
    readonly id: string;
    readonly kind: string;
    readonly fromSymbolId: string;
    readonly toSymbolId: string;
  }[];
  readonly unresolvedConstructs: readonly unknown[];
}) {
  return {
    unresolved: bundle.unresolvedConstructs,
    symbols: bundle.symbols
      .map((symbol) => ({ id: symbol.id, kind: symbol.kind, name: symbol.name }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    dependencies: bundle.dependencies
      .map((dependency) => ({
        id: dependency.id,
        kind: dependency.kind,
        from: bundle.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
          ?.name,
        to: bundle.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
          ?.name,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function mismatchMessages(
  bundle: { readonly unresolvedConstructs: readonly { readonly message: string }[] },
): string[] {
  return bundle.unresolvedConstructs
    .filter((item) => item.message.includes("expects a"))
    .map((item) => item.message);
}

Deno.test("a sketch is never a valid result", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Rectangle
result = Rectangle(10, 20)
`,
    `from build123d import Circle
result = Circle(3)
`,
    `from build123d import Rectangle
face = Rectangle(10, 20)
result = face
`,
    `from build123d import Ellipse
result = Ellipse(4, 2)
`,
    `from build123d import RegularPolygon
result = RegularPolygon(10, 6)
`,
    `from build123d import Circle, Plane
result = Plane.XY * Circle(3)
`,
    `from build123d import Pos, Rectangle
p = Pos(1, 2, 3)
result = p * Rectangle(10, 20)
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
    assert(
      mismatchMessages(bundle).some((message) =>
        message === "result expects a solid, received a sketch."
      ),
      `${sourceText} must label the sketch result`,
    );
  }
});

Deno.test("extrude accepts amount= or a positional amount on a qualified sketch", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5)
`,
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), 5)
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

Deno.test("a solid can never be extruded", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, extrude
result = extrude(Box(10, 20, 30), amount=5)
`,
  });
  assertEquals(bundle.policy.status, "passed");
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assert(
    mismatchMessages(bundle).includes(
      "extrude expects a sketch, received a solid.",
    ),
  );
});

Deno.test("a sketch can never be filleted, chamfered, scaled, or compounded", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const cases = [
    {
      sourceText: `from build123d import Rectangle, fillet
result = fillet(Rectangle(10, 20).edges(), radius=1)
`,
      message: "fillet expects a solid, received a sketch.",
    },
    {
      sourceText: `from build123d import Rectangle, chamfer
result = chamfer(Rectangle(10, 20).edges(), 1)
`,
      message: "chamfer expects a solid, received a sketch.",
    },
    {
      sourceText: `from build123d import Rectangle, scale
result = scale(Rectangle(10, 20), 2)
`,
      message: "scale expects a solid, received a sketch.",
    },
    {
      sourceText: `from build123d import Compound, Rectangle
face = Rectangle(10, 20)
result = Compound(children=[face])
`,
      message: "Compound expects a solid, received a sketch.",
    },
  ];
  for (const { sourceText, message } of cases) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
    assert(
      mismatchMessages(bundle).includes(message),
      `${sourceText} must label ${message}`,
    );
  }
});

Deno.test("sketch plus or minus sketch stays a sketch and sketch plus solid is unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const sameKind = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Circle, Rectangle, extrude
face = Rectangle(20, 20) - Circle(4)
union = Rectangle(10, 10) + Circle(2)
result = extrude(face, amount=5)
`,
  });
  assertEquals(sameKind.unresolvedConstructs, []);
  assertEquals(sameKind.policy.status, "passed");
  assertEquals(
    new Map(sameKind.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["face", "variable"],
      ["union", "variable"],
      ["result", "artifact"],
    ]),
  );

  const mixed = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Rectangle
mixed = Rectangle(20, 20) + Box(10, 10, 10)
result = Box(1, 2, 3)
`,
  });
  assertEquals(mixed.policy.status, "passed");
  assert(
    mismatchMessages(mixed).includes(
      "+ expects a sketch, received a solid.",
    ),
  );
  assert(
    mixed.unresolvedConstructs.some((item) =>
      item.kind === "python-parameter-expression-not-qualified"
    ),
  );
  assertEquals(
    mixed.symbols.some((symbol) => symbol.name === "mixed"),
    false,
  );
});

Deno.test("Pos times a sketch then extrude stays a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Pos, Rectangle, extrude
result = extrude(Pos(1, 2, 3) * Rectangle(10, 20), amount=5)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("Rot times a sketch then extrude is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Rot, Rectangle, extrude
result = extrude(Rot(0, 0, 45) * Rectangle(10, 20), amount=5)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("a left-associative Pos times Rot times solid is qualified", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Pos, Rot
result = Pos(1, 2, 3) * Rot(0, 0, 45) * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("a parenthesized Pos times Rot product times a solid is qualified", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Pos, Rot
result = (Pos(1, 2, 3) * Rot(0, 0, 45)) * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("a longer Pos and Rot placement chain times a solid is qualified", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Cylinder, Pos, Rot
result = Rot(0, 90, 0) * Pos(0, 0, 10) * Rot(0, 0, 45) * Cylinder(4, 12)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test(
  "a left-associative placement chain times a sketch then extrude is a qualified solid",
  async () => {
    const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
      ...INPUT,
      sourceText: `from build123d import Circle, Pos, Rot, extrude
result = extrude(Pos(1, 2, 3) * Rot(0, 0, 45) * Circle(3), amount=5)
`,
    });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  },
);

Deno.test("Rot times a sketch is still not a valid result", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Rectangle, Rot
result = Rot(0, 0, 45) * Rectangle(10, 20)
`,
  });
  assertEquals(bundle.policy.status, "passed");
  assert(
    mismatchMessages(bundle).includes(
      "result expects a solid, received a sketch.",
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.message.includes("Rot * expects a solid")
    ),
    false,
  );
});

const PLACEMENT_LEFT_OPERAND_SENTENCE =
  "The left operand of * must be a Pos or Rot call, a product of those placements, a name bound to one of those placements, or Plane.XY|XZ|YZ|YX|ZX|ZY.";

Deno.test("a named Pos applied to a solid is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Pos
p = Pos(1, 2, 3)
result = p * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "p")?.kind,
    "variable",
  );
  assertEquals(
    bundle.symbols.some((symbol) => symbol.name === "Pos"),
    false,
  );
  assert(
    bundle.dependencies.some((dependency) => {
      const from = bundle.symbols.find((symbol) =>
        symbol.id === dependency.fromSymbolId
      );
      const to = bundle.symbols.find((symbol) => symbol.id === dependency.toSymbolId);
      return dependency.kind === "structural-incidence" &&
        from?.name === "p" &&
        to?.name === "result";
    }),
  );
});

Deno.test("Location or Scale times a solid stays an explicit placement gap", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, Location
result = Location(1, 2, 3) * Box(10, 20, 30)
`,
    `from build123d import Box, Scale
result = Scale(2) * Box(10, 20, 30)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-placement-not-qualified" &&
        item.message === PLACEMENT_LEFT_OPERAND_SENTENCE
      ),
      `${sourceText} must label the left operand as an unqualified placement`,
    );
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-call-not-qualified"
      ),
      `${sourceText} must keep the D4-admitted import unresolved`,
    );
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
  }
});

Deno.test("a solid times a solid is not a placement product", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Cylinder
result = Box(10, 20, 30) * Cylinder(4, 12)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-placement-not-qualified"
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("a bare Pos times Rot product is not a solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Pos, Rot
result = Pos(1, 2, 3) * Rot(0, 0, 45)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-placement-not-qualified"
    ),
    false,
  );
});

Deno.test("Rectangle and Circle reject extra, keyword, or splat arguments", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20, 30), amount=5)
`,
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(width=10, height=20), amount=5)
`,
    `from build123d import Rectangle, extrude
dims = [10, 20]
result = extrude(Rectangle(*dims), amount=5)
`,
    `from build123d import Circle, extrude
result = extrude(Circle(3, 4), amount=5)
`,
    `from build123d import Circle, extrude
result = extrude(Circle(radius=3), amount=5)
`,
    `from build123d import Circle, extrude
radii = [3]
result = extrude(Circle(*radii), amount=5)
`,
    `from build123d import Ellipse, extrude
result = extrude(Ellipse(4, 2, 1), 5)
`,
    `from build123d import Ellipse, extrude
result = extrude(Ellipse(x_radius=4, y_radius=2), 5)
`,
    `from build123d import RegularPolygon, extrude
result = extrude(RegularPolygon(10), 5)
`,
    `from build123d import RegularPolygon, extrude
result = extrude(RegularPolygon(radius=10, side_count=6), 5)
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

Deno.test("extrude rejects both, dir, and until", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const frontendRejected = [
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5, both=1)
`,
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5, until=1)
`,
  ];
  for (const sourceText of frontendRejected) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "passed");
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-result-not-qualified"
      ),
      `${sourceText} must not qualify result`,
    );
    assert(
      bundle.unresolvedConstructs.some((item) =>
        item.kind === "build123d-extrude-argument-not-qualified" &&
        item.message.includes("only amount= and taper= are reviewed.")
      ),
      `${sourceText} must label the unreviewed extrude keyword`,
    );
  }

  // `dir` is a D4-forbidden builtin identifier, so `dir=` never reaches the
  // frontend as an unresolved construct.  The call is still not qualified.
  const dirKwarg = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5, dir=1)
`,
  });
  assertEquals(dirKwarg.policy.status, "rejected");
  assertEquals(dirKwarg.unresolvedConstructs, []);
  assertEquals(dirKwarg.symbols, []);
  assert(
    dirKwarg.policy.findings.some((finding) =>
      finding.code === "geometry-script-forbidden-name"
    ),
  );
});

Deno.test("an extruded sketch composes with fillet and boolean solids", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Circle, Rectangle, extrude, fillet
plate = extrude(Rectangle(20, 20) - Circle(4), amount=5)
block = Box(10, 10, 10)
result = fillet((plate + block).edges(), radius=1)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.analyzer.version, QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION);
  assertEquals(
    new Map(bundle.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["plate", "variable"],
      ["block", "variable"],
      ["result", "artifact"],
    ]),
  );
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
      { kind: "structural-incidence" as const, from: "block", to: "result" },
      { kind: "structural-incidence" as const, from: "plate", to: "result" },
    ],
  );
});

Deno.test("Ellipse and RegularPolygon extrude to a qualified solid", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Ellipse, extrude
result = extrude(Ellipse(4, 2), amount=5)
`,
    `from build123d import RegularPolygon, extrude
result = extrude(RegularPolygon(10, 6), 5)
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

Deno.test(
  "a left-associative placement chain times an Ellipse then extrude is a qualified solid",
  async () => {
    const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
      ...INPUT,
      sourceText: `from build123d import Ellipse, Pos, Rot, extrude
result = extrude(Pos(1, 2, 3) * Rot(0, 0, 45) * Ellipse(4, 2), 5)
`,
    });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  },
);

Deno.test("fillet of a solid by a positional radius is qualified", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, fillet
result = fillet(Box(10, 10, 10), 2)
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
radius = 2
result = fillet(base, radius)
`,
    `from build123d import Box, fillet
base = Box(10, 10, 10)
result = fillet(base.edges(), 2)
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

  const named = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, fillet
base = Box(10, 10, 10)
radius = 2
result = fillet(base, radius)
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

Deno.test("chamfer of a solid by a positional length is qualified", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, chamfer
result = chamfer(Box(10, 10, 10), 2)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("ampersand intersection is rejected by D4 before the frontend", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, Cylinder
result = Box(10, 20, 30) & Cylinder(4, 12)
`,
    `from build123d import Circle, Rectangle, extrude
result = extrude(Rectangle(20, 20) & Circle(4), 5)
`,
    `from build123d import Box, Rectangle
mixed = Rectangle(20, 20) & Box(10, 10, 10)
result = Box(1, 2, 3)
`,
    `from build123d import Circle, Rectangle
result = Rectangle(20, 20) & Circle(4)
`,
  ];
  for (const sourceText of scripts) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.policy.status, "rejected");
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.symbols, []);
    assert(
      bundle.policy.findings.some((finding) =>
        finding.code === "geometry-script-unrecognized-token"
      ),
      `${sourceText} must stay a D4 unrecognized-token rejection`,
    );
  }
});

Deno.test("solid bitwise or is rejected by D4 before the frontend", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Cylinder
result = Box(10, 20, 30) | Cylinder(4, 12)
`,
  });
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.symbols, []);
  assert(
    bundle.policy.findings.some((finding) =>
      finding.code === "geometry-script-unrecognized-token"
    ),
  );
});

Deno.test("from math import pi qualifies a Circle radius", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Circle, extrude
from math import pi
result = extrude(Circle(pi), 5)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
  assertEquals(
    bundle.symbols.some((symbol) => symbol.name === "pi"),
    false,
  );
  assertEquals(
    bundle.dependencies.some((dependency) =>
      bundle.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name === "pi"
    ),
    false,
  );
});

Deno.test("from math import e and tau are closed scalars", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
from math import e, tau
result = Box(e, tau, 1)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.some((symbol) => symbol.name === "e" || symbol.name === "tau"),
    false,
  );
});

Deno.test("from math import pi as P qualifies an aliased scalar", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Circle, extrude
from math import pi as P
result = extrude(Circle(P), amount=5)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.some((symbol) => symbol.name === "P" || symbol.name === "pi"),
    false,
  );
});

Deno.test("a math scalar assigned to a parameter carries no math symbol", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Sphere
from math import pi
radius = pi * 2
result = Sphere(radius)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    new Map(bundle.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["radius", "parameter"],
      ["result", "artifact"],
    ]),
  );
  assertEquals(
    bundle.dependencies.map((dependency) => ({
      kind: dependency.kind,
      from: bundle.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
        ?.name,
      to: bundle.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
        ?.name,
    })),
    [
      { kind: "structural-incidence" as const, from: "radius", to: "result" },
    ],
  );
});

Deno.test("Circle of pi and Circle of e do not share an artifact identity", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const pi = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Circle, extrude
from math import pi
result = extrude(Circle(pi), 5)
`,
  });
  const e = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Circle, extrude
from math import e
result = extrude(Circle(e), 5)
`,
  });
  assertNotEquals(
    pi.symbols.find((symbol) => symbol.name === "result")?.id,
    e.symbols.find((symbol) => symbol.name === "result")?.id,
  );
});

Deno.test("from math import sin stays an explicit math gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
from math import sin
result = Box(1, 2, 3)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "math-name-not-qualified" &&
      item.message ===
        "math name sin is admitted by D4 but not qualified by this frontend version."
    ),
  );
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
    false,
  );
});

Deno.test("from math import sqrt stays an explicit math gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
from math import sqrt
result = Box(1, 2, 3)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "math-name-not-qualified" &&
      item.message ===
        "math name sqrt is admitted by D4 but not qualified by this frontend version."
    ),
  );
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("a parenthesized math import stays unqualified", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
from math import (
pi
)
result = Box(1, 2, 3)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "python-import-not-qualified" &&
      item.message ===
        "Only an explicit named import from build123d, or from math of pi, e, or tau, is qualified in v1."
    ),
  );
});

Deno.test("assignment of pi after importing it is shadowing", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Sphere
from math import pi
pi = 3
result = Sphere(pi)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "python-import-shadowing" &&
      item.message === "Assignment pi shadows a qualified math import."
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("fillet keyword on a solid stays an explicit fillet gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, fillet
result = fillet(Box(10, 10, 10), radius=2)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-fillet-argument-not-qualified" &&
      item.message ===
        "fillet keyword radius= is not qualified; reviewed forms are fillet(solid, scalar), fillet(solid.edges(), scalar), and fillet(solid.edges(), radius=scalar)."
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("a named Rot applied to a solid is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Rot
p = Rot(0, 0, 45)
result = p * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "p")?.kind,
    "variable",
  );
});

Deno.test("a named Pos times Rot product applied to a solid is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Cylinder, Pos, Rot
p = Pos(1, 2, 3) * Rot(0, 0, 45)
result = p * Cylinder(4, 12)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "p")?.kind,
    "variable",
  );
});

Deno.test("a placement name can be rebound as another placement name", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Pos
p = Pos(1, 2, 3)
q = p
result = q * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    new Map(bundle.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["p", "variable"],
      ["q", "variable"],
      ["result", "artifact"],
    ]),
  );
  const edges = bundle.dependencies.map((dependency) => ({
    kind: dependency.kind,
    from: bundle.symbols.find((symbol) => symbol.id === dependency.fromSymbolId)
      ?.name,
    to: bundle.symbols.find((symbol) => symbol.id === dependency.toSymbolId)
      ?.name,
  }));
  assert(
    edges.some((edge) =>
      edge.kind === "structural-incidence" &&
      edge.from === "p" &&
      edge.to === "q"
    ),
  );
  assert(
    edges.some((edge) =>
      edge.kind === "structural-incidence" &&
      edge.from === "q" &&
      edge.to === "result"
    ),
  );
});

Deno.test("a named Pos times a sketch then extrude is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Pos, Rectangle, extrude
p = Pos(1, 2, 3)
result = extrude(p * Rectangle(10, 20), 5)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
});

Deno.test("Plane.XY times a solid is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Plane
result = Plane.XY * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
    "artifact",
  );
  assertEquals(
    bundle.symbols.some((symbol) => symbol.name === "Plane" || symbol.name === "XY"),
    false,
  );
});

Deno.test("each named Plane times a Circle then extrude is a qualified solid", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  for (const plane of ["XY", "XZ", "YZ", "YX", "ZX", "ZY"]) {
    const bundle = await analyzer.analyze({
      ...INPUT,
      sourceText: `from build123d import Circle, Plane, extrude
result = extrude(Plane.${plane} * Circle(3), 5)
`,
    });
    assertEquals(bundle.unresolvedConstructs, []);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      bundle.symbols.find((symbol) => symbol.name === "result")?.kind,
      "artifact",
    );
  }
});

Deno.test("an aliased Plane times a solid is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Plane as P
result = P.XY * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    bundle.symbols.some((symbol) => symbol.name === "P" || symbol.name === "XY"),
    false,
  );
});

Deno.test("a Plane binding applied to a solid is a qualified solid", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Plane
p = Plane.XY
result = p * Box(10, 20, 30)
`,
  });
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    bundle.symbols.find((symbol) => symbol.name === "p")?.kind,
    "variable",
  );
  assert(
    bundle.dependencies.some((dependency) => {
      const from = bundle.symbols.find((symbol) =>
        symbol.id === dependency.fromSymbolId
      );
      const to = bundle.symbols.find((symbol) => symbol.id === dependency.toSymbolId);
      return dependency.kind === "structural-incidence" &&
        from?.name === "p" &&
        to?.name === "result";
    }),
  );
});

Deno.test("Plane.XY and Plane.XZ do not share an artifact identity", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const xy = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Plane
result = Plane.XY * Box(10, 20, 30)
`,
  });
  const xz = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Plane
result = Plane.XZ * Box(10, 20, 30)
`,
  });
  assertNotEquals(
    xy.symbols.find((symbol) => symbol.name === "result")?.id,
    xz.symbols.find((symbol) => symbol.name === "result")?.id,
  );
});

Deno.test("offset of a solid by a positional amount is qualified", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Box, offset
result = offset(Box(10, 10, 10), 2)
`,
    `from build123d import Box, offset
base = Box(10, 10, 10)
wall = 2
result = offset(base, wall)
`,
    `from build123d import Box, offset
result = offset(Box(10, 10, 10), amount=2)
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

  const named = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, offset
base = Box(10, 10, 10)
wall = 2
result = offset(base, wall)
`,
  });
  assertEquals(
    new Map(named.symbols.map((symbol) => [symbol.name, symbol.kind])),
    new Map([
      ["base", "variable"],
      ["wall", "parameter"],
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
      { kind: "structural-incidence" as const, from: "wall", to: "result" },
    ],
  );
});

Deno.test("revolve of a sketch about Axis.Z is a qualified solid", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Axis, Circle, revolve
result = revolve(Circle(3), Axis.Z)
`,
    `from build123d import Axis, Circle, revolve
result = revolve(Circle(3), axis=Axis.X)
`,
    `from build123d import Axis, Circle, Plane, revolve
result = revolve(Plane.XZ * Circle(3), Axis.Y)
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
    assertEquals(
      bundle.symbols.some((symbol) =>
        symbol.name === "Axis" || symbol.name === "X" || symbol.name === "Y" ||
        symbol.name === "Z"
      ),
      false,
    );
  }
});

Deno.test("extrude accepts taper= on a qualified sketch", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = [
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), amount=5, taper=1)
`,
    `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), 5, taper=1)
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

Deno.test("a named Vector applied to a solid stays an explicit placement gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Vector
v = Vector(1, 0, 0)
result = v * Box(10, 20, 30)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-call-not-qualified"
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-placement-not-qualified" &&
      item.message === PLACEMENT_LEFT_OPERAND_SENTENCE
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("an unreviewed Plane member times a solid stays an explicit plane gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Plane
result = Plane.X * Box(10, 20, 30)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-plane-not-qualified" &&
      item.message ===
        "Plane.X is not a reviewed plane; reviewed planes are Plane.XY, Plane.XZ, Plane.YZ, Plane.YX, Plane.ZX, and Plane.ZY."
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-placement-not-qualified" &&
      item.message === PLACEMENT_LEFT_OPERAND_SENTENCE
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("Axis times a solid is not a placement product", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Axis, Box
result = Axis.Z * Box(10, 20, 30)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-placement-not-qualified" &&
      item.message === PLACEMENT_LEFT_OPERAND_SENTENCE
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-plane-not-qualified" ||
      item.kind === "build123d-axis-not-qualified"
    ),
    false,
  );
});

Deno.test("shell stays an explicit call gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, shell
result = shell(Box(10, 10, 10), 2)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-call-not-qualified" &&
      item.message ===
        "build123d name shell is admitted by D4 but not qualified by this frontend version."
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) => item.kind === "python-dynamic-call"),
  );
});

Deno.test("offset of a sketch stays an explicit kind mismatch", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Rectangle, offset
result = offset(Rectangle(10, 20), 2)
`,
  });
  assert(
    mismatchMessages(bundle).includes(
      "offset expects a solid, received a sketch.",
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("offset openings or missing amount stays an explicit offset gap", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const openings = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, offset
result = offset(Box(10, 10, 10), 2, openings=1)
`,
  });
  assert(
    openings.unresolvedConstructs.some((item) =>
      item.kind === "build123d-offset-argument-not-qualified" &&
      item.message ===
        "offset keyword openings= is not qualified; reviewed forms are offset(solid, scalar) and offset(solid, amount=scalar)."
    ),
  );
  assert(
    openings.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );

  const missing = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Box, offset
result = offset(Box(10, 10, 10))
`,
  });
  assert(
    missing.unresolvedConstructs.some((item) =>
      item.kind === "build123d-offset-argument-not-qualified" &&
      item.message ===
        "offset arguments are not a reviewed form; reviewed forms are offset(solid, scalar) and offset(solid, amount=scalar)."
    ),
  );
  assert(
    missing.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("revolve of a solid or without an Axis stays an explicit revolve gap", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const solid = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Axis, Box, revolve
result = revolve(Box(10, 10, 10), Axis.Z)
`,
  });
  assert(
    mismatchMessages(solid).includes(
      "revolve expects a sketch, received a solid.",
    ),
  );
  assert(
    solid.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );

  const missing = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Circle, revolve
result = revolve(Circle(3))
`,
  });
  assert(
    missing.unresolvedConstructs.some((item) =>
      item.kind === "build123d-revolve-argument-not-qualified" &&
      item.message ===
        "revolve arguments are not a reviewed form; reviewed forms are revolve(sketch, Axis.X|Y|Z) and revolve(sketch, axis=Axis.X|Y|Z)."
    ),
  );
  assert(
    missing.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );

  const badAxis = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Axis, Circle, revolve
result = revolve(Circle(3), Axis.W)
`,
  });
  assert(
    badAxis.unresolvedConstructs.some((item) =>
      item.kind === "build123d-axis-not-qualified" &&
      item.message ===
        "Axis.W is not a reviewed axis; reviewed axes are Axis.X, Axis.Y, and Axis.Z."
    ),
  );
  assert(
    badAxis.unresolvedConstructs.some((item) =>
      item.kind === "build123d-revolve-argument-not-qualified"
    ),
  );
  assert(
    badAxis.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("a named Axis applied to revolve stays an explicit revolve gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Axis, Circle, revolve
a = Axis.Z
result = revolve(Circle(3), a)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-revolve-argument-not-qualified" &&
      item.message ===
        "revolve arguments are not a reviewed form; reviewed forms are revolve(sketch, Axis.X|Y|Z) and revolve(sketch, axis=Axis.X|Y|Z)."
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "python-dynamic-attribute"
    ),
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "python-parameter-expression-not-qualified" &&
      item.message ===
        "Assignment a is not a closed qualified numeric expression, solid, sketch, or placement."
    ),
  );
});

Deno.test("extrude taper without amount stays an explicit extrude gap", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Rectangle, extrude
result = extrude(Rectangle(10, 20), taper=1)
`,
  });
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-extrude-argument-not-qualified" &&
      item.message === "extrude requires amount= or a positional amount."
    ),
  );
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.message.includes("extrude keyword taper=")
    ),
    false,
  );
  assert(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
});

Deno.test("existing qualified bundles stay bit-identical under 1.6.0", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const scripts = {
    box: `from build123d import Box
width = 10
height = width * 2
depth = 3
labels = [1, 2 + 3, -4]
result = Box(width, height, depth)
`,
    fillet: `from build123d import Box, fillet
base = Box(10, 10, 10)
radius = 2
result = fillet(base.edges(), radius=radius)
`,
    chamfer: `from build123d import Box, chamfer
base = Box(10, 10, 10)
length = 2
result = chamfer(base.edges(), length)
`,
    scale: `from build123d import Box, scale
block = Box(10, 20, 30)
factor = 2
result = scale(block, factor)
`,
    minus: `from build123d import Box, Cylinder, Pos
block = Box(20, 20, 10)
bore = Pos(0, 0, 0) * Cylinder(4, 12)
result = block - bore
`,
    compound: `from build123d import Box, Compound, Cylinder, Pos
base = Pos(0, 0, 10) * Cylinder(90, 20)
column = Pos(0, 0, 190) * Box(28, 28, 340)
arm = Pos(180, 0, 346) * Box(360, 28, 28)
articulated_arm = column + arm
head = Pos(360, 0, 346) * Cylinder(34, 40)
bulb_holder = Pos(360, 0, 318) * Cylinder(14, 16)
result = Compound(children=[base, articulated_arm, head, bulb_holder])
`,
    rotCone: `from build123d import Cone, Rot, Sphere
bottom = 10
top = 0
height = 20
radius = 5
cone = Cone(bottom, top, height)
sphere = Rot(90, 0, 0) * Sphere(radius)
result = cone + sphere
`,
  } as const;
  const expected = {
    box: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:2b0ee0f8de6dd18a46aff61265d26cbaf8734f611a73dd5b3ee1061e312ff4c0",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "parameter:89b8bfff308aee24e6e9c3e1dcd116deee101be3e6b000e2a7b3d8c1b68b8c09",
          kind: "parameter",
          name: "width",
        },
        {
          id:
            "parameter:93fdfbdb08ceb1de8d8d74a3bf06928c573c40eb53b94c07b6e2b5eda1b75201",
          kind: "parameter",
          name: "height",
        },
        {
          id:
            "parameter:99f2a2e4e79c28e0e3d830365b8c73f00458d4d959e651cd7c1b2fa7991fdd9a",
          kind: "parameter",
          name: "labels",
        },
        {
          id:
            "parameter:be9185eb60c8511cde66371841f915d2b4b17c4fd63206e6cab0836a70fcf79c",
          kind: "parameter",
          name: "depth",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:46f774ca4845f4029e82a6dc9810962a717b73bb378fc9bcc86b99de54d2f917",
          kind: "structural-incidence",
          from: "width",
          to: "result",
        },
        {
          id:
            "dependency:7ca48cbdeb975f4776460f99d5c5c8debd8c10de05e88da7542fa1a2d43c306f",
          kind: "structural-incidence",
          from: "depth",
          to: "result",
        },
        {
          id:
            "dependency:982f72e4f78521373d7240df4b1ab8a83085f55b994d6e9c8e9a20b32ef3647a",
          kind: "static-value-flow",
          from: "width",
          to: "height",
        },
        {
          id:
            "dependency:baab08c9f0a479f082757f71f8d71cb8cdfdebc3f5bef84c82e8b26557c878e3",
          kind: "structural-incidence",
          from: "height",
          to: "result",
        },
      ],
    },
    fillet: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:a12e2e80130688d62beeb47dceb1955c2fe736ecf52365e0524bc66f1ca56b46",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "parameter:93dbe668a75d273606393a24368fc4cc5ba17dadb3eadb16ba6577eb89ed38ba",
          kind: "parameter",
          name: "radius",
        },
        {
          id:
            "variable:7979c1a95b01bc5180cd0873400665dda7aaa1771ea44b19ca3b95cfdfb501be",
          kind: "variable",
          name: "base",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:67eedff270fd9ec153d6a8f985cafe12688ea76404b1f8b0e6e1fe504ab2d172",
          kind: "structural-incidence",
          from: "radius",
          to: "result",
        },
        {
          id:
            "dependency:b7462806043ed2832ac7ac589c0d2f1c3a744d4ee17eb7cd0e61121a2ae18936",
          kind: "structural-incidence",
          from: "base",
          to: "result",
        },
      ],
    },
    chamfer: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:12928c02620878f30725ccbb2640d286408748ccf26a330a32ed9fee2f0d464c",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "parameter:e66ad04d21eeafca96557c425717ba08a7877c093e83064bd306375982ff4fcb",
          kind: "parameter",
          name: "length",
        },
        {
          id:
            "variable:7979c1a95b01bc5180cd0873400665dda7aaa1771ea44b19ca3b95cfdfb501be",
          kind: "variable",
          name: "base",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:23361f1b6054179e24d59b08012de0c3d03848fca027bb9e4f7383217b1a0c8f",
          kind: "structural-incidence",
          from: "length",
          to: "result",
        },
        {
          id:
            "dependency:8b5bfd0401293b44e8f21997c03d10f3f37c322fe47cd2c71f521ed3f6545a5d",
          kind: "structural-incidence",
          from: "base",
          to: "result",
        },
      ],
    },
    scale: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:8cdf9d454b4f953e769c5e230d21033ef682edbc221ac125d2c85564c255417a",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "parameter:a237077858f9215a5493f70a0471bb17349cd86c185f687641c0df5f2b56a859",
          kind: "parameter",
          name: "factor",
        },
        {
          id:
            "variable:61b97e3ca6d578199ec03c8fe1997da6d14ce1e7b4973d3e2ddbf946a52bc23c",
          kind: "variable",
          name: "block",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:e9faa4e218750aff53a474319f860b5cf3524c53c02ea9da9f52e47af50aafe7",
          kind: "structural-incidence",
          from: "factor",
          to: "result",
        },
        {
          id:
            "dependency:f279caad6b76cab370a8b6b8db13246d58e337a2fd904401668774b1216cd2d7",
          kind: "structural-incidence",
          from: "block",
          to: "result",
        },
      ],
    },
    minus: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:b914b95ab912fe8360421e06e6681a42ee9e3f195af631edec695ddcf8b096cc",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "variable:184ffc700ecf850acda270c788a6e86616866c1004256603041ea7adda796100",
          kind: "variable",
          name: "block",
        },
        {
          id:
            "variable:8d7f07b8bb8e308881e7f675f5a5a08d31bc886d6361cc5ef965551c23a32022",
          kind: "variable",
          name: "bore",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:0e0a2dd8cdddee25814f6197d34c2f2ceb58502ec6cd8119f6e3e0cdd22177e5",
          kind: "structural-incidence",
          from: "bore",
          to: "result",
        },
        {
          id:
            "dependency:8cde9d3d06490c61905dca6d3307a060c29e7f872b35902d42fb86ffc177ad2a",
          kind: "structural-incidence",
          from: "block",
          to: "result",
        },
      ],
    },
    compound: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:741f7b945e8057faafb9fa5e3dfae2ed381d34d63b47c8897017cbe881a8d66e",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "variable:0d9fa148ad56f08631ef80add0f77120ff249549a6f1d4fdb6430a448351e4e9",
          kind: "variable",
          name: "bulb_holder",
        },
        {
          id:
            "variable:17d089ded51d97bd00f8bb56184ff505cd09b1c6346ab01f3e7592fedcff23c0",
          kind: "variable",
          name: "head",
        },
        {
          id:
            "variable:3d6dfc206b64df3d2b47a4242d7b18c305746058b087688e43633ce86d1dbbf4",
          kind: "variable",
          name: "articulated_arm",
        },
        {
          id:
            "variable:508b5b238a3a975f1f40a8d9918d50bbb87eacc3751056729015a59bb9577475",
          kind: "variable",
          name: "column",
        },
        {
          id:
            "variable:e58d96e37abe1e4ab70f67df2d4584563306b051513559a2d29aca3a480c31fa",
          kind: "variable",
          name: "arm",
        },
        {
          id:
            "variable:e9e46f3493c4ad4c1f9c1aa287d22528f59a8f20311ec92ede6e62c853e52081",
          kind: "variable",
          name: "base",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:4cf5ac3765825662d5ac3b52b0e928574efe5091bd40dff26b1487d2616e9083",
          kind: "structural-incidence",
          from: "arm",
          to: "articulated_arm",
        },
        {
          id:
            "dependency:6ad726908edd85d4c00d0ca19b611074eb70a9807d18a469b8d32caee0d25694",
          kind: "structural-incidence",
          from: "articulated_arm",
          to: "result",
        },
        {
          id:
            "dependency:9aaf48b07205e425aeb1a0d6ad99a19b61c39a31495e5d65d8773a14c3eb535d",
          kind: "structural-incidence",
          from: "head",
          to: "result",
        },
        {
          id:
            "dependency:acfe2ccc893cd0315ac05913cb911127df72ccaac19495151dda97ab77e21786",
          kind: "structural-incidence",
          from: "column",
          to: "articulated_arm",
        },
        {
          id:
            "dependency:db3f48d94e910e7341276e1bacbc04d5e98a5a7512afc2852870105b6eb82d18",
          kind: "structural-incidence",
          from: "bulb_holder",
          to: "result",
        },
        {
          id:
            "dependency:dc265fcebd9d6c71fa987891996b9cf39421c9bfbd53d06ad89cc877f1e5103e",
          kind: "structural-incidence",
          from: "base",
          to: "result",
        },
      ],
    },
    rotCone: {
      unresolved: [],
      symbols: [
        {
          id:
            "artifact:0fe2459a719b98ad103f8ee2f9e9036f8314b0f2fd4c00bb0de87979df3c8667",
          kind: "artifact",
          name: "result",
        },
        {
          id:
            "parameter:1f53634d45b256357befca782a36b5667b466580fdd62676a1f56e8b4dd6fc5c",
          kind: "parameter",
          name: "top",
        },
        {
          id:
            "parameter:39b13cba92917d4284ef760793d4a69cc69a3a3a9a14cca916d10d2e5788ed12",
          kind: "parameter",
          name: "height",
        },
        {
          id:
            "parameter:3b9f2552ab2a511ef9042563a55efc6a0ae033a1d5f39b334f519c90ca5b249a",
          kind: "parameter",
          name: "bottom",
        },
        {
          id:
            "parameter:ddde2fb75141a09bbf83795e9a9dff4af8b27fce960125f594116e178cfd364c",
          kind: "parameter",
          name: "radius",
        },
        {
          id:
            "variable:7aa6433fb57a50c146420c5db8e56641ef6d6b96c6d1670548f5b88fb28f1590",
          kind: "variable",
          name: "sphere",
        },
        {
          id:
            "variable:cb21c696cd7b4c42435683c3bd5f3ea59078a95a399d41917419ea4a92be61f9",
          kind: "variable",
          name: "cone",
        },
      ],
      dependencies: [
        {
          id:
            "dependency:12d4aa668c8c1e507492bab4d4056cea14eff132bbc374f829a74f545b7168c1",
          kind: "structural-incidence",
          from: "sphere",
          to: "result",
        },
        {
          id:
            "dependency:50139bf0b286c15342270ed7272dc26660ac480d2138aef7f923358f6a9decce",
          kind: "static-value-flow",
          from: "height",
          to: "cone",
        },
        {
          id:
            "dependency:845701a34d07bdb8dbbcc7321e28a7c66cd312db117845bbd1d207698b749d58",
          kind: "static-value-flow",
          from: "radius",
          to: "sphere",
        },
        {
          id:
            "dependency:9ca9001a67678293aaa4fea454a8992eb2318fde4f7229a97f2d5d2b9796c495",
          kind: "structural-incidence",
          from: "cone",
          to: "result",
        },
        {
          id:
            "dependency:ae8dcfc26ebe252943335d52f3deddf62fd5772bd4438c2e96fd20f50e842f6f",
          kind: "static-value-flow",
          from: "bottom",
          to: "cone",
        },
        {
          id:
            "dependency:cbd98241582dd89a98cae806d48ead8a2ccf20a407337d5c1af4683b48430bea",
          kind: "static-value-flow",
          from: "top",
          to: "cone",
        },
      ],
    },
  };

  for (const [name, sourceText] of Object.entries(scripts)) {
    const bundle = await analyzer.analyze({ ...INPUT, sourceText });
    assertEquals(bundle.analyzer.version, QUALIFIED_BUILD123D_SOURCE_ANALYZER_VERSION);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(
      identityView(bundle),
      expected[name as keyof typeof expected],
      `${name} must keep its 1.2.0 analysis identity`,
    );
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
