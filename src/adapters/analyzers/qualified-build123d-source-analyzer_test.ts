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

Deno.test("D4-admitted but unqualified build123d calls remain explicitly unresolved", async () => {
  const bundle = await new QualifiedBuild123dSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box, Cone
radius = 2
height = 10
result = Cone(radius, height)
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

Deno.test("a bare Pos or Compound without named children stays unresolved", async () => {
  const analyzer = new QualifiedBuild123dSourceAnalyzer();
  const barePos = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Pos
result = Pos(0, 0, 10)
`,
  });
  const emptyCompound = await analyzer.analyze({
    ...INPUT,
    sourceText: `from build123d import Compound
result = Compound(children=[])
`,
  });
  assert(
    barePos.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
  assert(
    emptyCompound.unresolvedConstructs.some((item) =>
      item.kind === "build123d-result-not-qualified"
    ),
  );
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
