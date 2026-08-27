import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertBuild123dWorkspaceClosureLoweringManifestsEqual,
  BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
  Build123dWorkspaceClosureLoweringError,
  type Build123dWorkspaceClosureLoweringInput,
  type Build123dWorkspaceClosureLoweringManifest,
  build123dWorkspaceClosureLoweringManifestsEqual,
  fingerprintBuild123dWorkspaceClosureLoweringManifestBody,
  lowerBuild123dWorkspaceClosure,
  validateBuild123dWorkspaceClosureLoweringManifest,
} from "./build123d-workspace-closure-lowering.ts";
import {
  PROJECT_SOURCE_CLOSURE_KIND,
  PROJECT_SOURCE_CLOSURE_SCHEMA,
  type ProjectSourceClosureFile,
  sealProjectSourceClosure,
} from "../../project-source-workspace/closure.ts";
import { sha256Fingerprint, sha256Hex } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

const ROOT_IMPORT = workspaceModule("dep-dimensions");

Deno.test(
  "build123d workspace lowering v1 lowers exact direct static data dependencies with source map and digests",
  async () => {
    const input = await fixture();
    const lowered = await lowerBuild123dWorkspaceClosure(input);

    assertEquals(
      lowered.script,
      [
        "width = 20",
        "depth = width * 2",
        "",
        "from build123d import Box",
        "height = 5",
        "result = Box(width, depth, height)",
        "",
      ].join("\n"),
    );
    assertEquals(
      lowered.schemaVersion,
      BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    );
    assertEquals(lowered.scriptFingerprint, lowered.manifest.script.fingerprint);
    assertEquals(lowered.manifest.sources.map((source) => source.role), [
      "dependency",
      "root",
    ]);
    assertEquals(lowered.manifest.imports[0]?.module, ROOT_IMPORT);
    assertEquals(lowered.manifest.imports[0]?.names, ["width", "depth"]);
    assertEquals(lowered.manifest.imports[0]?.dependency.fileId, "dep-dimensions");
    assertEquals(lowered.manifest.imports[0]?.dependency.fileRevision, 1);
    assertEquals(
      lowered.manifest.sources.map((source) => source.virtualModule),
      [workspaceModule("dep-dimensions"), workspaceModule("root-part")],
    );
    assertEquals(lowered.manifest.sources[0]?.fileRevision, 1);
    assertEquals(
      lowered.manifest.sources[0]?.sourceFingerprint,
      input.closure.files.find((file) => file.fileId === "dep-dimensions")
        ?.resourceRef.fingerprint,
    );
    assertEquals(lowered.manifest.sourceMap.length, 3);
    assertEquals(
      lowered.manifest.sourceMap.map((segment) => segment.source.fileId),
      ["dep-dimensions", "dep-dimensions", "root-part"],
    );
    assertEquals(
      lowered.manifest.sourceMap[2]?.source.span.start,
      input.root.sourceText.indexOf("\n") + 1,
    );
    assert(/^[a-f0-9]{64}$/.test(lowered.manifest.fingerprint.digest));
  },
);

Deno.test(
  "build123d workspace lowering v1 validates its generated closed manifest",
  async () => {
    const manifest = (await lowerBuild123dWorkspaceClosure(await fixture())).manifest;
    const reread = await validateBuild123dWorkspaceClosureLoweringManifest(manifest);

    assertEquals(reread, manifest);
    assertEquals(Object.isFrozen(reread), true);
    assertEquals(Object.isFrozen(reread.sources), true);
  },
);

Deno.test(
  "build123d workspace lowering v1 rejects tampered or noncanonical manifests",
  async () => {
    const manifest = (await lowerBuild123dWorkspaceClosure(await fixture())).manifest;
    const cases: readonly [string, unknown][] = [
      [
        "nested source revision",
        mutateManifest(manifest, (copy) => {
          manifestSources(copy)[0]!.fileRevision = 2;
        }),
      ],
      [
        "nested source fingerprint",
        mutateManifest(manifest, (copy) => {
          manifestSources(copy)[0]!.sourceFingerprint = sha256("b");
        }),
      ],
      [
        "import names",
        mutateManifest(manifest, (copy) => {
          manifestImports(copy)[0]!.names = ["width", "width"];
        }),
      ],
      [
        "import removal",
        mutateManifest(manifest, (copy) => {
          manifestImports(copy)[0]!.source.removal.start = 1;
        }),
      ],
      [
        "source map",
        mutateManifest(manifest, (copy) => {
          manifestSourceMap(copy)[1]!.output.start = 0;
        }),
      ],
      [
        "script byte count",
        mutateManifest(manifest, (copy) => {
          manifestScript(copy).byteCount = 0;
        }),
      ],
      [
        "script fingerprint",
        mutateManifest(manifest, (copy) => {
          manifestScript(copy).fingerprint = sha256("c");
        }),
      ],
      [
        "self fingerprint",
        mutateManifest(manifest, (copy) => {
          copy.fingerprint = sha256("d");
        }),
      ],
      [
        "schema",
        mutateManifest(manifest, (copy) => {
          copy.schemaVersion = "build123d-workspace-closure-lowering/0.9";
        }),
      ],
      [
        "kind",
        mutateManifest(manifest, (copy) => {
          copy.kind = "other-lowering";
        }),
      ],
      [
        "source order",
        mutateManifest(manifest, (copy) => {
          manifestSources(copy).reverse();
        }),
      ],
      [
        "extra field",
        mutateManifest(manifest, (copy) => {
          copy.unreviewed = true;
        }),
      ],
      [
        "missing field",
        mutateManifest(manifest, (copy) => {
          delete (copy as Record<string, unknown>).script;
        }),
      ],
    ];

    for (const [, value] of cases) {
      await assertRejects(
        () => validateBuild123dWorkspaceClosureLoweringManifest(value),
        TypeError,
      );
    }
  },
);

Deno.test(
  "build123d workspace lowering v1 equality compares nested facts even when the outer digest is copied",
  async () => {
    const manifest = await validateBuild123dWorkspaceClosureLoweringManifest(
      (await lowerBuild123dWorkspaceClosure(await fixture())).manifest,
    );
    const divergent = mutateManifest(manifest, (copy) => {
      manifestImports(copy)[0]!.source.removal.end += 1;
    }) as unknown as Build123dWorkspaceClosureLoweringManifest;

    assertEquals(divergent.fingerprint, manifest.fingerprint);
    assert(!build123dWorkspaceClosureLoweringManifestsEqual(manifest, divergent));
    assertThrows(
      () =>
        assertBuild123dWorkspaceClosureLoweringManifestsEqual(
          manifest,
          divergent,
          "$test.manifest",
        ),
      TypeError,
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 rejects a self-hashed source-map width divergence and accepts Unicode offsets",
  async () => {
    const manifest = (await lowerBuild123dWorkspaceClosure(await fixture())).manifest;
    const malformed = mutateManifest(manifest, (copy) => {
      manifestSourceMap(copy)[0]!.source.span.end += 1;
    });
    const selfHashed = await rehashManifest(malformed);
    await assertRejects(
      () => validateBuild123dWorkspaceClosureLoweringManifest(selfHashed),
      TypeError,
    );

    const unicode = await lowerBuild123dWorkspaceClosure(
      await fixture({
        rootText: [
          `from ${ROOT_IMPORT} import width, depth`,
          "# μm values remain source-mapped",
          "from build123d import Box",
          "height = 5",
          "result = Box(width, depth, height)",
          "",
        ].join("\n"),
      }),
    );
    assert(unicode.manifest.script.byteCount !== unicode.manifest.script.utf16Length);
    assertEquals(unicode.manifest.script.utf16Length, unicode.script.length);
    await validateBuild123dWorkspaceClosureLoweringManifest(unicode.manifest);
  },
);

Deno.test(
  "build123d workspace lowering v1 emits dependencies in canonical module order, not descriptor order",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${workspaceModule("dep-zeta")} import zeta`,
        `from ${workspaceModule("dep-alpha")} import alpha`,
        "from build123d import Box",
        "result = Box(alpha, zeta, 1)",
        "",
      ].join("\n"),
      dependencies: [
        dependency("dep-zeta", "zeta.py", "zeta = 30\n"),
        dependency("dep-alpha", "alpha.py", "alpha = 10\n"),
      ],
    });
    const reordered = {
      ...input,
      dependencies: [...input.dependencies].reverse(),
    };

    const first = await lowerBuild123dWorkspaceClosure(input);
    const second = await lowerBuild123dWorkspaceClosure(reordered);

    await validateBuild123dWorkspaceClosureLoweringManifest(first.manifest);
    await validateBuild123dWorkspaceClosureLoweringManifest(second.manifest);
    const permutedImports = await rehashManifest(
      mutateManifest(first.manifest, (copy) => {
        manifestImports(copy).reverse();
      }),
    );
    await assertRejects(
      () => validateBuild123dWorkspaceClosureLoweringManifest(permutedImports),
      TypeError,
    );
    assertEquals(first.script, second.script);
    assertEquals(first.manifest.fingerprint, second.manifest.fingerprint);
    assertEquals(
      first.script,
      [
        "alpha = 10",
        "",
        "zeta = 30",
        "",
        "from build123d import Box",
        "result = Box(alpha, zeta, 1)",
        "",
      ].join("\n"),
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 emits only imported dependency bindings and prerequisites",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          ["base = 10", "width = base * 2", "private_depth = 40", ""].join("\n"),
        ),
      ],
    });
    const lowered = await lowerBuild123dWorkspaceClosure(input);

    assertEquals(
      lowered.script,
      [
        "base = 10",
        "width = base * 2",
        "",
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    );
    assert(!lowered.script.includes("private_depth"));
  },
);

Deno.test(
  "build123d workspace lowering v1 rejects a root access to an unimported dependency binding",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import width`,
        "from build123d import Box",
        "result = Box(width, private_depth, 1)",
        "",
      ].join("\n"),
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          ["width = 20", "private_depth = 40", ""].join("\n"),
        ),
      ],
    });
    await assertLoweringCode(input, "root_unimported_dependency_binding");
  },
);

Deno.test(
  "build123d workspace lowering v1 refuses a workspace import after root code can read it",
  async () => {
    const input = await fixture({
      rootText: [
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        `from ${ROOT_IMPORT} import width`,
        "",
      ].join("\n"),
    });
    await assertLoweringCode(input, "workspace_import_not_prelude");
  },
);

Deno.test(
  "build123d workspace lowering v1 accepts non-semantic leading and trailing dependency comments",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          ["# all values are millimetres", "width = 20", "# end of data", ""].join(
            "\n",
          ),
        ),
      ],
    });
    const lowered = await lowerBuild123dWorkspaceClosure(input);

    assertEquals(
      lowered.script,
      [
        "width = 20",
        "",
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    );
    assert(!lowered.script.includes("millimetres"));
  },
);

Deno.test(
  "build123d workspace lowering v1 rejects root module-level bindings that collide with dependency data",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import width`,
        "from build123d import Box",
        "width = 5",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(input, "root_binding_collision");

    const tupleTarget = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import width`,
        "(width, local_value) = (5, 1)",
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(tupleTarget, "root_binding_collision");
  },
);

Deno.test(
  "build123d workspace lowering v1 refuses reviewed module-scope binders that collide with dependency data",
  async () => {
    await assertLoweringCode(
      await collidingRoot([
        "async def width():",
        "    pass",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "def width():",
        "    pass",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "class width:",
        "    pass",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "def helper():",
        "    global width",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "def helper():",
        "    nonlocal width",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "match 1:",
        "    case width:",
        "        pass",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "del width",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "match 1:",
        "    case 1 as width:",
        "        pass",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "type width = int",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "if (width := 1):",
        "    pass",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "[(width := 1) for _n in [1]]",
      ]),
      "root_binding_collision",
    );
    await assertLoweringCode(
      await collidingRoot([
        "Box(width := 5)",
      ]),
      "root_binding_collision",
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 does not treat function-local names as module binders",
  async () => {
    const localScope = await collidingRoot([
      "def helper(width):",
      "    width = 5",
      "    match 1:",
      "        case width:",
      "            pass",
      "    del width",
    ]);
    const lowered = await lowerBuild123dWorkspaceClosure(localScope);
    assert(lowered.script.includes("def helper(width):"));
    assert(lowered.script.includes("width = 20"));

    const asyncLocal = await collidingRoot([
      "async def helper():",
      "    width = 5",
    ]);
    const asyncLowered = await lowerBuild123dWorkspaceClosure(asyncLocal);
    assert(asyncLowered.script.includes("async def helper():"));

    const methodLocal = await collidingRoot([
      "class Helper:",
      "    def method(self, width):",
      "        width = 5",
    ]);
    const methodLowered = await lowerBuild123dWorkspaceClosure(methodLocal);
    assert(methodLowered.script.includes("class Helper:"));

    const nestedNonlocal = await collidingRoot([
      "def outer():",
      "    def inner():",
      "        nonlocal width",
    ]);
    const nestedLowered = await lowerBuild123dWorkspaceClosure(nestedNonlocal);
    assert(nestedLowered.script.includes("nonlocal width"));

    const asPatternLocal = await collidingRoot([
      "def helper():",
      "    match 1:",
      "        case 1 as width:",
      "            pass",
    ]);
    const asPatternLowered = await lowerBuild123dWorkspaceClosure(asPatternLocal);
    assert(asPatternLowered.script.includes("case 1 as width:"));

    const classPattern = await collidingRoot([
      "match 1:",
      "    case width(1):",
      "        pass",
    ]);
    const classPatternLowered = await lowerBuild123dWorkspaceClosure(classPattern);
    assert(classPatternLowered.script.includes("case width(1):"));

    await assertNotLoweringCode(
      await collidingRoot([
        "def helper():",
        "    type width = int",
      ]),
      "root_binding_collision",
    );
    await assertNotLoweringCode(
      await collidingRoot([
        "class Helper:",
        "    type width = int",
      ]),
      "root_binding_collision",
    );
    await assertNotLoweringCode(
      await collidingRoot([
        "def helper():",
        "    if (width := 1):",
        "        pass",
      ]),
      "root_binding_collision",
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 rejects unsealed, absent, and noncanonical workspace imports",
  async () => {
    const unsealed = await fixture({
      rootText: [
        "from casys_workspace.f_67686f7374 import width",
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(unsealed, "workspace_import_unsealed_dependency");

    const absent = await fixture({
      rootText: ["from build123d import Box", "result = Box(20, 40, 5)", ""].join("\n"),
    });
    await assertLoweringCode(absent, "dependency_import_missing");

    const alias = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import width as w`,
        "from build123d import Box",
        "result = Box(w, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(alias, "unsupported_workspace_import_syntax");

    const wildcard = await fixture({
      rootText: [
        `from ${ROOT_IMPORT} import *`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(wildcard, "unsupported_workspace_import_syntax");

    const standalone = await fixture({
      rootText: [
        `import ${ROOT_IMPORT}`,
        "from build123d import Box",
        "result = Box(1, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(standalone, "unsupported_workspace_import_syntax");

    const relative = await fixture({
      rootText: [
        `from .${ROOT_IMPORT} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(relative, "unsupported_workspace_import_syntax");

    const nested = await fixture({
      rootText: [
        "if True:",
        `    from ${ROOT_IMPORT} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(nested, "workspace_import_not_module_level");

    const legacyRevisionIdentity = await fixture({
      rootText: [
        "from casys_workspace.f_6465702d64696d656e73696f6e73_r1.dimensions import width",
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    await assertLoweringCode(
      legacyRevisionIdentity,
      "workspace_import_unsealed_dependency",
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 records the entire removed import line including comment and CRLF",
  async () => {
    const importLine = `from ${ROOT_IMPORT} import width # exact import provenance\r\n`;
    const input = await fixture({
      rootText: importLine + [
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    });
    const lowered = await lowerBuild123dWorkspaceClosure(input);
    const provenance = lowered.manifest.imports[0]!.source;

    assertEquals(provenance.statement, {
      start: 0,
      end: `from ${ROOT_IMPORT} import width`.length,
    });
    assertEquals(provenance.removal, { start: 0, end: importLine.length });
    assertEquals(
      lowered.script,
      [
        "width = 20",
        "",
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 rejects executable or non-finite data modules",
  async () => {
    const imported = await fixture({
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          "from math import pi\nwidth = 20\n",
        ),
      ],
    });
    await assertLoweringCode(imported, "data_module_import_forbidden");

    const executable = await fixture({
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          "if True:\n    width = 20\n",
        ),
      ],
    });
    await assertLoweringCode(executable, "data_module_not_static");

    const resultBinding = await fixture({
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          "result = 20\n",
        ),
      ],
    });
    await assertLoweringCode(resultBinding, "data_module_result_forbidden");

    const undefinedReference = await fixture({
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          "width = missing + 20\n",
        ),
      ],
    });
    await assertLoweringCode(undefinedReference, "data_module_undefined_reference");

    const nonFinite = await fixture({
      dependencies: [
        dependency(
          "dep-dimensions",
          "dimensions.py",
          "width = 1e999\n",
        ),
      ],
    });
    await assertLoweringCode(nonFinite, "data_module_non_finite");
  },
);

Deno.test(
  "build123d workspace lowering v1 refuses mismatched exact bytes, caller-supplied module metadata, and name collisions",
  async () => {
    const input = await fixture();
    const tampered = {
      ...input,
      dependencies: [{
        ...input.dependencies[0]!,
        sourceText: "width = 999\ndepth = width * 2\n",
      }],
    };
    await assertLoweringCode(tampered, "source_fingerprint_mismatch");

    const fakeLogicalName = {
      ...input,
      dependencies: [{
        ...input.dependencies[0]!,
        logicalName: "fake.py",
      }],
    } as unknown as Build123dWorkspaceClosureLoweringInput;
    await assertLoweringCode(fakeLogicalName, "invalid_input");

    const fakeModulePath = {
      ...input,
      dependencies: [{
        ...input.dependencies[0]!,
        modulePath: ["fake"],
      }],
    } as unknown as Build123dWorkspaceClosureLoweringInput;
    await assertLoweringCode(fakeModulePath, "invalid_input");

    const collision = await fixture({
      rootText: [
        `from ${workspaceModule("dep-one")} import width`,
        `from ${workspaceModule("dep-two")} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
      dependencies: [
        dependency("dep-one", "one.py", "width = 20\n"),
        dependency("dep-two", "two.py", "width = 40\n"),
      ],
    });
    await assertLoweringCode(collision, "name_collision");
  },
);

Deno.test(
  "build123d workspace lowering v1 keeps the virtual module stable across dependency revision and logical name",
  async () => {
    const first = await fixture();
    const hyphenatedLogicalName = await fixture({
      dependencies: [
        dependency(
          "dep-dimensions",
          "shared-dimensions.py",
          "width = 20\ndepth = width * 2\n",
        ),
      ],
    });
    const hyphenated = await lowerBuild123dWorkspaceClosure(hyphenatedLogicalName);
    assertEquals(hyphenated.manifest.sources[0]?.virtualModule, ROOT_IMPORT);

    const successor = await fixture({
      dependencies: [
        {
          fileId: "dep-dimensions",
          fileRevision: 2,
          logicalName: "renamed-dimensions.py",
          sourceText: "width = 20\ndepth = width * 2\n",
        },
      ],
    });
    const firstLowered = await lowerBuild123dWorkspaceClosure(first);
    const successorLowered = await lowerBuild123dWorkspaceClosure(successor);

    assertEquals(firstLowered.manifest.imports[0]?.module, ROOT_IMPORT);
    assertEquals(successorLowered.manifest.imports[0]?.module, ROOT_IMPORT);
    assertEquals(firstLowered.manifest.sources[0]?.virtualModule, ROOT_IMPORT);
    assertEquals(successorLowered.manifest.sources[0]?.virtualModule, ROOT_IMPORT);
    assertEquals(firstLowered.manifest.sources[0]?.fileId, "dep-dimensions");
    assertEquals(firstLowered.manifest.sources[0]?.fileRevision, 1);
    assertEquals(successorLowered.manifest.sources[0]?.fileRevision, 2);
    assertEquals(
      firstLowered.manifest.imports[0]?.dependency.fileRevision,
      1,
    );
    assertEquals(
      successorLowered.manifest.imports[0]?.dependency.fileRevision,
      2,
    );
    assertEquals(
      firstLowered.manifest.sources[0]?.sourceFingerprint,
      first.closure.files.find((file) => file.fileId === "dep-dimensions")
        ?.resourceRef.fingerprint,
    );
    assertEquals(
      successorLowered.manifest.sources[0]?.sourceFingerprint,
      successor.closure.files.find((file) => file.fileId === "dep-dimensions")
        ?.resourceRef.fingerprint,
    );
  },
);

Deno.test(
  "build123d workspace lowering v1 refuses more than one revision of the same fileId",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${workspaceModule("dep-same")} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
      dependencies: [
        {
          fileId: "dep-same",
          fileRevision: 1,
          logicalName: "one.py",
          sourceText: "width = 20\n",
        },
        {
          fileId: "dep-same",
          fileRevision: 2,
          logicalName: "two.py",
          sourceText: "depth = 40\n",
        },
      ],
    });
    await assertLoweringCode(input, "ambiguous_virtual_module");
  },
);

Deno.test(
  "build123d workspace lowering v1 refuses a transitive closure even with all exact texts supplied",
  async () => {
    const input = await fixture({
      rootText: [
        `from ${workspaceModule("dep-one")} import width`,
        "from build123d import Box",
        "result = Box(width, 1, 1)",
        "",
      ].join("\n"),
      dependencies: [
        dependency("dep-one", "one.py", "width = 20\n"),
        dependency("dep-leaf", "leaf.py", "height = 5\n"),
      ],
    });
    const rootFile = input.closure.files.find((file) => file.fileId === "root-part")!;
    const oneFile = input.closure.files.find((file) => file.fileId === "dep-one")!;
    const leafFile = input.closure.files.find((file) => file.fileId === "dep-leaf")!;
    const { fingerprint: _ignored, ...facts } = input.closure;
    const closure = await sealProjectSourceClosure({
      ...facts,
      files: [
        { ...leafFile, dependencies: [] },
        {
          ...oneFile,
          dependencies: [{
            fileId: leafFile.fileId,
            fileRevision: leafFile.fileRevision,
          }],
        },
        {
          ...rootFile,
          dependencies: [{
            fileId: oneFile.fileId,
            fileRevision: oneFile.fileRevision,
          }],
        },
      ],
      edges: [
        {
          from: { fileId: oneFile.fileId, fileRevision: oneFile.fileRevision },
          to: { fileId: leafFile.fileId, fileRevision: leafFile.fileRevision },
        },
        {
          from: { fileId: rootFile.fileId, fileRevision: rootFile.fileRevision },
          to: { fileId: oneFile.fileId, fileRevision: oneFile.fileRevision },
        },
      ],
    });
    await assertLoweringCode({ ...input, closure }, "closure_not_direct");
  },
);

interface MutableManifestSource {
  fileRevision: number;
  sourceFingerprint: unknown;
}

interface MutableManifestImport {
  names: string[];
  source: { removal: { start: number; end: number } };
}

interface MutableManifestSourceMap {
  output: { start: number; end: number };
  source: { span: { start: number; end: number } };
}

interface MutableManifestScript {
  byteCount: number;
  fingerprint: unknown;
}

interface MutableManifestRecord extends Record<string, unknown> {
  sources: MutableManifestSource[];
  imports: MutableManifestImport[];
  sourceMap: MutableManifestSourceMap[];
  script: MutableManifestScript;
  fingerprint: unknown;
}

function mutateManifest(
  manifest: Build123dWorkspaceClosureLoweringManifest,
  mutate: (copy: MutableManifestRecord) => void,
): MutableManifestRecord {
  const copy = structuredClone(manifest) as unknown as MutableManifestRecord;
  mutate(copy);
  return copy;
}

function manifestSources(copy: MutableManifestRecord): MutableManifestSource[] {
  return copy.sources;
}

function manifestImports(copy: MutableManifestRecord): MutableManifestImport[] {
  return copy.imports;
}

function manifestSourceMap(copy: MutableManifestRecord): MutableManifestSourceMap[] {
  return copy.sourceMap;
}

function manifestScript(copy: MutableManifestRecord): MutableManifestScript {
  return copy.script;
}

function sha256(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest: digest.repeat(64) };
}

async function rehashManifest(copy: MutableManifestRecord): Promise<unknown> {
  const { fingerprint: _ignored, ...body } = copy;
  return {
    ...body,
    fingerprint: await fingerprintBuild123dWorkspaceClosureLoweringManifestBody(body),
  };
}

async function assertLoweringCode(
  input: Build123dWorkspaceClosureLoweringInput,
  expected: Build123dWorkspaceClosureLoweringError["code"],
): Promise<void> {
  try {
    await lowerBuild123dWorkspaceClosure(input);
  } catch (cause) {
    assert(
      cause instanceof Build123dWorkspaceClosureLoweringError,
      "expected Build123dWorkspaceClosureLoweringError",
    );
    assertEquals(cause.code, expected);
    return;
  }
  throw new Error("Expected lowerer failure " + expected + ".");
}

async function assertNotLoweringCode(
  input: Build123dWorkspaceClosureLoweringInput,
  forbidden: Build123dWorkspaceClosureLoweringError["code"],
): Promise<void> {
  try {
    await lowerBuild123dWorkspaceClosure(input);
  } catch (cause) {
    assert(
      cause instanceof Build123dWorkspaceClosureLoweringError,
      "expected Build123dWorkspaceClosureLoweringError",
    );
    assert(
      cause.code !== forbidden,
      `must not fail as ${forbidden}, got ${cause.code}`,
    );
  }
}

interface FixtureDependency {
  readonly fileId: string;
  readonly fileRevision?: number;
  readonly logicalName: string;
  readonly sourceText: string;
}

function dependency(
  fileId: string,
  logicalName: string,
  sourceText: string,
): FixtureDependency {
  return { fileId, logicalName, sourceText };
}

function collidingRoot(
  body: readonly string[],
): Promise<Build123dWorkspaceClosureLoweringInput> {
  return fixture({
    rootText: [
      `from ${ROOT_IMPORT} import width`,
      "from build123d import Box",
      ...body,
      "result = Box(width, 1, 1)",
      "",
    ].join("\n"),
  });
}

async function fixture(overrides: {
  readonly rootText?: string;
  readonly dependencies?: readonly FixtureDependency[];
} = {}): Promise<Build123dWorkspaceClosureLoweringInput> {
  const root = {
    fileId: "root-part",
    fileRevision: 1,
    logicalName: "part.py",
    sourceText: overrides.rootText ?? [
      "from " + ROOT_IMPORT + " import width, depth",
      "from build123d import Box",
      "height = 5",
      "result = Box(width, depth, height)",
      "",
    ].join("\n"),
  };
  const dependencies = overrides.dependencies ?? [
    dependency(
      "dep-dimensions",
      "dimensions.py",
      "width = 20\ndepth = width * 2\n",
    ),
  ];
  const records = await Promise.all(
    [...dependencies, root].map(makeFixtureRecord),
  );
  const rootRecord = records.find((record) => record.source.fileId === root.fileId)!;
  const dependencyRecords = records
    .filter((record) => record.source.fileId !== root.fileId)
    .sort((left, right) => {
      const id = left.source.fileId.localeCompare(right.source.fileId);
      return id !== 0 ? id : left.source.fileRevision - right.source.fileRevision;
    });
  const rootDependencies = dependencyRecords.map((record) => ({
    fileId: record.file.fileId,
    fileRevision: record.file.fileRevision,
  }));
  const rootFile: ProjectSourceClosureFile = {
    ...rootRecord.file,
    dependencies: rootDependencies,
  };
  const attachmentFingerprint = await sha256Fingerprint({
    attachment: "attachment-root",
    root: rootFile.fingerprint,
  });
  const workspaceEventFingerprint = await sha256Fingerprint({ workspaceRevision: 1 });
  const closure = await sealProjectSourceClosure({
    schemaVersion: PROJECT_SOURCE_CLOSURE_SCHEMA,
    kind: PROJECT_SOURCE_CLOSURE_KIND,
    projectId: "lowering-test-project",
    workspaceRevision: 1,
    workspaceEventFingerprint,
    attachment: {
      attachmentId: "attachment-root",
      attachmentRevision: 1,
      fingerprint: attachmentFingerprint,
      fileId: rootFile.fileId,
      role: { id: "design-source", version: 1 },
      target: { elementId: "def-root", elementKind: "PartDefinition" },
      declaredAgainst: {
        thread: {
          snapshotId: "thread:lowering-test:r1",
          revision: 1,
          subjectId: "subject:lowering-test",
        },
        architecture: {
          artifactId: "architecture-" + "a".repeat(64),
          fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
          captureSchema: "architecture-capture/4.0",
        },
      },
    },
    root: {
      fileId: rootFile.fileId,
      fileRevision: rootFile.fileRevision,
      fingerprint: rootFile.fingerprint,
      resourceRef: rootFile.resourceRef,
    },
    files: [
      ...dependencyRecords.map((record) => record.file),
      rootFile,
    ],
    edges: rootDependencies.map((dependency) => ({
      from: { fileId: rootFile.fileId, fileRevision: rootFile.fileRevision },
      to: dependency,
    })),
  });
  return {
    closure,
    root: rootRecord.source,
    dependencies: records
      .filter((record) => record.source.fileId !== root.fileId)
      .map((record) => record.source),
  };
}

async function makeFixtureRecord(source: FixtureDependency): Promise<{
  readonly source: Build123dWorkspaceClosureLoweringInput["root"];
  readonly file: ProjectSourceClosureFile;
}> {
  const fileRevision = source.fileRevision ?? 1;
  const sourceFingerprint = await fingerprintUtf8(source.sourceText);
  const resourceRef = {
    schemaVersion: "agent-resource-capture/1.0" as const,
    uri: "casys://agent-resource-capture/sha256/" + sourceFingerprint.digest,
    name: source.logicalName,
    mimeType: "text/x-python",
    representation: "text" as const,
    byteCount: new TextEncoder().encode(source.sourceText).byteLength,
    fingerprint: sourceFingerprint,
  };
  const fingerprint = await sha256Fingerprint({
    fileId: source.fileId,
    fileRevision,
    sourceFingerprint,
  });
  return {
    source: {
      fileId: source.fileId,
      fileRevision,
      sourceText: source.sourceText,
    },
    file: {
      fileId: source.fileId,
      fileRevision,
      fingerprint,
      resourceRef,
      role: "cad-script",
      dependencies: [],
    },
  };
}

async function fingerprintUtf8(text: string): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await sha256Hex(new TextEncoder().encode(text)),
  };
}

function workspaceModule(fileId: string): string {
  const encodedId = [...new TextEncoder().encode(fileId)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `casys_workspace.f_${encodedId}`;
}
