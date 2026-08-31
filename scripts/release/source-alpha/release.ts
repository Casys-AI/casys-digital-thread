/** Source-alpha build, notice rendering, verification, and CLI argument handling. */

import {
  deterministicBomUuid,
  renderNotices,
  repositoryLicenseName,
  sourceLockComponents,
} from "./components.ts";
import {
  type BuildSourceAlphaReleaseOptions,
  canonicalJson,
  GENERATOR_PATH,
  isRecord,
  type JsonRecord,
  RELEASE_FILE_NAMES,
  type RenderedRelease,
  REPOSITORY_ROOT,
  SCOPE_PATH,
  sha256,
  sha256Text,
  SOURCE_ALPHA_GENERATOR_VERSION,
  toHex,
  TOOLS_LOCK_PATH,
} from "./contract.ts";
import {
  readSourceAlphaCommitFile,
  resolveSourceAlphaReleaseContext,
} from "./source-archive.ts";

const DEFAULT_OUTPUT_ROOT = new URL("dist/release/", REPOSITORY_ROOT);

function outputDirectoryForTag(tag: string, outputRoot = DEFAULT_OUTPUT_ROOT): URL {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(tag)) {
    throw new TypeError(
      "--tag must contain only letters, numbers, '.', '_' or '-' and cannot start with punctuation.",
    );
  }
  return new URL(`${tag}/`, outputRoot);
}

async function renderRelease(
  tag: string,
  allowUncommittedForTest: boolean,
): Promise<RenderedRelease> {
  const context = await resolveSourceAlphaReleaseContext(
    tag,
    REPOSITORY_ROOT,
    allowUncommittedForTest,
  );
  const [denoLockBytes, uiPackageLockBytes, licenseBytes] = await Promise.all([
    readSourceAlphaCommitFile(context.commit, "deno.lock"),
    readSourceAlphaCommitFile(context.commit, "src/ui/package-lock.json"),
    readSourceAlphaCommitFile(context.commit, "LICENSE"),
  ]);
  const decoder = new TextDecoder();
  const denoLock = JSON.parse(decoder.decode(denoLockBytes));
  const uiPackageLock = JSON.parse(decoder.decode(uiPackageLockBytes));
  const licenseText = decoder.decode(licenseBytes);
  const components = sourceLockComponents(denoLock, uiPackageLock);
  const bomUuid = await deterministicBomUuid([
    context.commit,
    context.tree,
    context.tag,
    context.scopeSha256,
    context.toolsLockSha256,
  ].join("\n"));
  const productPurl = "pkg:generic/" + context.scope.package.name + "@" +
    encodeURIComponent(context.tag);
  const bom: JsonRecord = {
    "$schema": "https://cyclonedx.org/schema/bom-1.6.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: bomUuid,
    version: 1,
    metadata: {
      timestamp: context.commitTimestamp,
      tools: {
        components: [
          { type: "application", name: "deno", version: Deno.version.deno },
          {
            type: "application",
            name: "git",
            version: context.gitVersion.replace(/^git version\s+/u, ""),
          },
        ],
      },
      component: {
        type: "application",
        "bom-ref": productPurl,
        name: context.scope.package.name,
        version: context.tag,
        purl: productPurl,
        licenses: [{ license: { name: repositoryLicenseName(licenseText) } }],
        properties: [
          { name: "casys:release-boundary", value: "source-alpha" },
          { name: "casys:source-commit", value: context.commit },
          { name: "casys:source-tree", value: context.tree },
          { name: "casys:source-archive-sha256", value: context.sourceArchiveSha256 },
          { name: "casys:scope-sha256", value: context.scopeSha256 },
          { name: "casys:tools-lock-sha256", value: context.toolsLockSha256 },
        ],
      },
      properties: [
        { name: "casys:generator-version", value: SOURCE_ALPHA_GENERATOR_VERSION },
        { name: "casys:generator-sha256", value: context.generatorSha256 },
        {
          name: "casys:excluded-artifacts",
          value: context.scope.exclusions.map((exclusion) => exclusion.id).join(","),
        },
      ],
    },
    components,
  };
  const bomText = canonicalJson(bom);
  const manifest: JsonRecord = {
    schemaVersion: "casys-source-release-manifest/1.0",
    release: {
      tag: context.tag,
      boundary: "source-alpha",
      claim: "source inventory only",
    },
    source: {
      commit: context.commit,
      tree: context.tree,
      commitTimestamp: context.commitTimestamp,
      archive: {
        path: "source.tar.gz",
        mediaType: "application/gzip",
        bytes: context.sourceArchive.byteLength,
        sha256: context.sourceArchiveSha256,
      },
    },
    inputs: context.inputs,
    scope: {
      path: SCOPE_PATH,
      sha256: context.scopeSha256,
      componentInventories: context.scope.componentInventories,
      exclusions: context.scope.exclusions,
    },
    tooling: {
      lock: {
        path: TOOLS_LOCK_PATH,
        sha256: context.toolsLockSha256,
      },
      generator: {
        id: context.toolsLock.generator.id,
        version: SOURCE_ALPHA_GENERATOR_VERSION,
        path: GENERATOR_PATH,
        sha256: context.generatorSha256,
      },
      executed: [
        { id: "deno", version: Deno.version.deno },
        { id: "git", version: context.gitVersion },
      ],
      notExecuted: context.toolsLock.notExecutedTools,
    },
    artifacts: [
      {
        path: "source.sbom.cdx.json",
        mediaType: "application/vnd.cyclonedx+json",
        sha256: await sha256Text(bomText),
      },
    ],
  };
  const manifestText = canonicalJson(manifest);
  return {
    context,
    bom,
    bomText,
    manifest,
    manifestText,
    noticesText: renderNotices(bom),
  };
}

async function writeChecksums(outputDirectory: URL): Promise<string> {
  const checksums = await Promise.all(RELEASE_FILE_NAMES.map(async (fileName) => {
    const bytes = await Deno.readFile(new URL(fileName, outputDirectory));
    return { fileName, sha256: await sha256(bytes) };
  }));
  const text = checksums
    .sort((left, right) => left.fileName.localeCompare(right.fileName))
    .map(({ fileName, sha256 }) => `${sha256}  ${fileName}`)
    .join("\n") + "\n";
  await Deno.writeTextFile(new URL("SHA256SUMS", outputDirectory), text);
  return text;
}

export async function buildSourceAlphaRelease(
  options: BuildSourceAlphaReleaseOptions,
): Promise<{
  readonly outputDirectory: URL;
  readonly context: Awaited<ReturnType<typeof resolveSourceAlphaReleaseContext>>;
}> {
  const outputDirectory = outputDirectoryForTag(options.tag, options.outputRoot);
  const rendered = await renderRelease(
    options.tag,
    options.allowUncommittedForTest === true,
  );
  await Deno.mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    Deno.writeFile(
      new URL("source.tar.gz", outputDirectory),
      rendered.context.sourceArchive,
    ),
    Deno.writeTextFile(
      new URL("source.sbom.cdx.json", outputDirectory),
      rendered.bomText,
    ),
    Deno.writeTextFile(
      new URL("source-release-manifest.json", outputDirectory),
      rendered.manifestText,
    ),
    Deno.writeTextFile(
      new URL("THIRD_PARTY_NOTICES.md", outputDirectory),
      rendered.noticesText,
    ),
  ]);
  await writeChecksums(outputDirectory);
  return { outputDirectory, context: rendered.context };
}

export async function renderThirdPartyNotices(options: {
  readonly tag: string;
  readonly outputRoot?: URL;
}): Promise<{ readonly outputDirectory: URL; readonly noticesSha256: string }> {
  const outputDirectory = outputDirectoryForTag(options.tag, options.outputRoot);
  const bom = JSON.parse(
    await Deno.readTextFile(new URL("source.sbom.cdx.json", outputDirectory)),
  );
  if (!isRecord(bom) || bom.bomFormat !== "CycloneDX" || bom.specVersion !== "1.6") {
    throw new TypeError(
      "source.sbom.cdx.json must be a CycloneDX 1.6 document before notices can be rendered.",
    );
  }
  const notices = renderNotices(bom);
  await Deno.writeTextFile(new URL("THIRD_PARTY_NOTICES.md", outputDirectory), notices);
  await writeChecksums(outputDirectory);
  return { outputDirectory, noticesSha256: await sha256Text(notices) };
}

export async function verifySourceAlphaRelease(options: {
  readonly tag: string;
  readonly outputRoot?: URL;
  readonly allowUncommittedForTest?: boolean;
}): Promise<
  { readonly outputDirectory: URL; readonly checkedFiles: readonly string[] }
> {
  const outputDirectory = outputDirectoryForTag(options.tag, options.outputRoot);
  const expected = await renderRelease(
    options.tag,
    options.allowUncommittedForTest === true,
  );
  const expectedFiles: Readonly<
    Record<(typeof RELEASE_FILE_NAMES)[number], Uint8Array>
  > = {
    "source-release-manifest.json": new TextEncoder().encode(expected.manifestText),
    "source.sbom.cdx.json": new TextEncoder().encode(expected.bomText),
    "source.tar.gz": expected.context.sourceArchive,
    "THIRD_PARTY_NOTICES.md": new TextEncoder().encode(expected.noticesText),
  };
  for (const fileName of RELEASE_FILE_NAMES) {
    const actual = await Deno.readFile(new URL(fileName, outputDirectory));
    const required = expectedFiles[fileName];
    if (
      actual.byteLength !== required.byteLength || toHex(actual) !== toHex(required)
    ) {
      throw new Error(
        `${fileName} does not match a fresh deterministic source-alpha rendering for ${options.tag}.`,
      );
    }
  }
  const expectedChecksums =
    (await Promise.all(RELEASE_FILE_NAMES.map(async (fileName) => {
      return { fileName, sha256: await sha256(expectedFiles[fileName]) };
    })))
      .sort((left, right) => left.fileName.localeCompare(right.fileName))
      .map(({ fileName, sha256 }) => `${sha256}  ${fileName}`)
      .join("\n") + "\n";
  const actualChecksums = await Deno.readTextFile(
    new URL("SHA256SUMS", outputDirectory),
  );
  if (actualChecksums !== expectedChecksums) {
    throw new Error(
      "SHA256SUMS does not match the deterministic source-alpha artifacts.",
    );
  }
  return { outputDirectory, checkedFiles: [...RELEASE_FILE_NAMES, "SHA256SUMS"] };
}

export function sourceAlphaTagFromArgs(args: readonly string[]): string {
  let tag: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--tag") {
      tag = args[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--tag=")) {
      tag = argument.slice("--tag=".length);
      continue;
    }
    throw new TypeError(`Unknown argument: ${argument}. Expected --tag <tag>.`);
  }
  if (!tag) throw new TypeError("Missing --tag <tag>.");
  outputDirectoryForTag(tag);
  return tag;
}
