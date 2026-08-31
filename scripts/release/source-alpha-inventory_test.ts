import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  buildSourceAlphaRelease,
  renderThirdPartyNotices,
  sourceAlphaTagFromArgs,
  verifySourceAlphaRelease,
} from "./source-alpha-inventory.ts";
import { sourceLockComponents } from "./source-alpha/components.ts";
import { parseSourceAlphaScope } from "./source-alpha/contract.ts";

const TAG = "source-alpha-test";

function temporaryOutputRoot(path: string): URL {
  return new URL(`file://${path}/`);
}

async function artifactBytes(root: URL, file: string): Promise<Uint8Array> {
  return await Deno.readFile(new URL(`${TAG}/${file}`, root));
}

Deno.test("source-alpha inventory renders byte-identical source artifacts from one commit", async () => {
  const first = await Deno.makeTempDir({ prefix: "casys-source-alpha-first-" });
  const second = await Deno.makeTempDir({ prefix: "casys-source-alpha-second-" });
  const firstRoot = temporaryOutputRoot(first);
  const secondRoot = temporaryOutputRoot(second);

  try {
    await buildSourceAlphaRelease({
      tag: TAG,
      outputRoot: firstRoot,
      allowUncommittedForTest: true,
    });
    await buildSourceAlphaRelease({
      tag: TAG,
      outputRoot: secondRoot,
      allowUncommittedForTest: true,
    });

    for (
      const file of [
        "source.tar.gz",
        "source.sbom.cdx.json",
        "source-release-manifest.json",
        "THIRD_PARTY_NOTICES.md",
        "SHA256SUMS",
      ]
    ) {
      assertEquals(
        await artifactBytes(firstRoot, file),
        await artifactBytes(secondRoot, file),
        `${file} must be byte-identical across two renderings of the same commit.`,
      );
    }

    const noticesBefore = await artifactBytes(firstRoot, "THIRD_PARTY_NOTICES.md");
    await renderThirdPartyNotices({ tag: TAG, outputRoot: firstRoot });
    assertEquals(
      await artifactBytes(firstRoot, "THIRD_PARTY_NOTICES.md"),
      noticesBefore,
    );

    const verification = await verifySourceAlphaRelease({
      tag: TAG,
      outputRoot: firstRoot,
      allowUncommittedForTest: true,
    });
    assertEquals(verification.checkedFiles, [
      "source-release-manifest.json",
      "source.sbom.cdx.json",
      "source.tar.gz",
      "THIRD_PARTY_NOTICES.md",
      "SHA256SUMS",
    ]);

    const bom = JSON.parse(
      new TextDecoder().decode(await artifactBytes(firstRoot, "source.sbom.cdx.json")),
    );
    assertEquals(bom.bomFormat, "CycloneDX");
    assertEquals(bom.specVersion, "1.6");
    assertMatch(bom.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/u);
    assertEquals(
      bom.metadata.component.licenses[0]?.license.name,
      "AGPL-3.0-only",
    );
    assert(
      bom.metadata.tools.components.every((tool: { name: string }) =>
        tool.name !== "syft"
      ),
      "Syft is explicitly not executed and must not appear as an executed generator tool.",
    );
    assert(
      bom.components.some((
        component: { licenses: Array<{ license: { name: string } }> },
      ) => component.licenses[0]?.license.name === "NOASSERTION"),
      "A lockfile with no licence field must remain NOASSERTION rather than guessed.",
    );
    assert(
      bom.components.every((component: { purl: string }) =>
        !component.purl.includes("$")
      ),
      "Generated PURLs must not contain renderer syntax markers.",
    );

    const manifest = JSON.parse(
      new TextDecoder().decode(
        await artifactBytes(firstRoot, "source-release-manifest.json"),
      ),
    );
    assertEquals(manifest.release.boundary, "source-alpha");
    assert(
      manifest.inputs.some((input: { path: string }) =>
        input.path === "desktop/chat-runtime/pins.json"
      ),
      "Desktop source pins are hashes in the source manifest, not a Desktop artifact claim.",
    );
    assert(
      manifest.inputs.some((input: { path: string; role: string }) =>
        input.path === ".gitattributes" && input.role === "public-export-policy"
      ),
      "The source manifest must hash the committed export policy that shapes its archive.",
    );
    assert(
      manifest.inputs.some((input: { path: string }) =>
        input.path === "images/build123d-microsandbox-worker/requirements.lock"
      ),
      "Worker lockfiles remain source provenance even though worker artifacts are excluded.",
    );
    assert(
      manifest.scope.exclusions.some((exclusion: { id: string }) =>
        exclusion.id === "oci-and-provider-artifacts"
      ),
    );
    const privateAgentOrchestration = manifest.scope.exclusions.find(
      (exclusion: { id: string }) => exclusion.id === "private-agent-orchestration",
    ) as { literal: string } | undefined;
    assert(
      privateAgentOrchestration !== undefined &&
        privateAgentOrchestration.literal.includes(".grok/**") &&
        privateAgentOrchestration.literal.includes(".claude/**") &&
        privateAgentOrchestration.literal.includes(".cursor/**") &&
        privateAgentOrchestration.literal.includes(".codex/**") &&
        privateAgentOrchestration.literal.includes("CLAUDE.md") &&
        privateAgentOrchestration.literal.includes("AGENTS.md") &&
        privateAgentOrchestration.literal.includes(".agents/skills/**") &&
        privateAgentOrchestration.literal.includes(".github/**"),
      "The source-alpha scope must declare both private agent exclusions and the retained public agent and CI surfaces.",
    );
    assert(
      manifest.scope.componentInventories.some(
        (inventory: { id: string; coverage: string }) =>
          inventory.id === "desktop-source" && inventory.coverage === "provenance-only",
      ),
    );
    assertEquals(manifest.tooling.notExecuted[0].status, "not-executed");
  } finally {
    await Deno.remove(first, { recursive: true });
    await Deno.remove(second, { recursive: true });
  }
});

Deno.test("source-alpha inventory accepts only an explicit safe tag", () => {
  assertEquals(sourceAlphaTagFromArgs(["--tag", "v0.1.0-alpha.1"]), "v0.1.0-alpha.1");
  assertEquals(
    sourceAlphaTagFromArgs(["--", "--tag", "v0.1.0-alpha.1"]),
    "v0.1.0-alpha.1",
  );
  assertEquals(sourceAlphaTagFromArgs(["--tag=v0_1"]), "v0_1");
  let message = "";
  try {
    sourceAlphaTagFromArgs(["--tag", "../escape"]);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assertMatch(message, /tag/u);
});

Deno.test("source-alpha scope declares private design history while retaining public media", async () => {
  const scope = parseSourceAlphaScope(
    JSON.parse(
      await Deno.readTextFile(
        new URL("../../release/sbom/source-alpha-scope.json", import.meta.url),
      ),
    ),
  );
  const privateDesignHistory = scope.exclusions.find(
    (exclusion) => exclusion.id === "private-design-history",
  );
  assert(
    privateDesignHistory !== undefined &&
      privateDesignHistory.literal.includes("docs/assets/**") &&
      privateDesignHistory.literal.includes("docs/rfcs/**") &&
      privateDesignHistory.literal.includes("docs/media/**"),
    "The source-alpha scope must declare private design-history exclusions while retaining public contributor media.",
  );
});

Deno.test("source-alpha inventory preserves primary Deno npm identities before peer suffixes", () => {
  const components = sourceLockComponents(
    {
      npm: {
        "@modelcontextprotocol/sdk@1.30.0_zod@4.4.3": {},
        "graphology@0.26.0_graphology-types@0.24.8": {},
        "@modelcontextprotocol/ext-apps@1.7.5_@modelcontextprotocol+sdk@1.30.0__zod@4.4.3":
          {},
      },
    },
    { packages: {} },
  );

  assertEquals(
    components.map(({ name, version }) => ({ name, version })).sort((left, right) =>
      left.name.localeCompare(right.name)
    ),
    [
      { name: "@modelcontextprotocol/ext-apps", version: "1.7.5" },
      { name: "@modelcontextprotocol/sdk", version: "1.30.0" },
      { name: "graphology", version: "0.26.0" },
    ],
  );
});
