/** Git provenance, source-archive construction, and generator-source attestation. */

import {
  assertRendererCoverage,
  canonicalJson,
  fileUrlPath,
  GENERATOR_PATH,
  parseSourceAlphaScope,
  parseSourceAlphaToolsLock,
  REPOSITORY_ROOT,
  repositoryUrl,
  SCOPE_PATH,
  sha256,
  sha256Text,
  SOURCE_ALPHA_GENERATOR_VERSION,
  type SourceAlphaInputDigest,
  type SourceAlphaReleaseContext,
  type SourceAlphaScope,
  type SourceAlphaToolsLock,
  TOOLS_LOCK_PATH,
} from "./contract.ts";

async function git(
  args: readonly string[],
  repositoryRoot = REPOSITORY_ROOT,
): Promise<Uint8Array> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd: fileUrlPath(repositoryRoot),
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return output.stdout;
}

async function gitText(
  args: readonly string[],
  repositoryRoot = REPOSITORY_ROOT,
): Promise<string> {
  return new TextDecoder().decode(await git(args, repositoryRoot)).trim();
}

async function assertCleanCheckout(repositoryRoot: URL): Promise<void> {
  const status = await gitText(
    ["status", "--porcelain", "--untracked-files=normal"],
    repositoryRoot,
  );
  if (status !== "") {
    throw new Error(
      "Source-alpha release generation requires a clean checkout. Commit or isolate the pending paths before building a public candidate.",
    );
  }
}

async function assertTrackedInputs(
  scope: SourceAlphaScope,
  toolsLock: SourceAlphaToolsLock,
  repositoryRoot: URL,
): Promise<void> {
  const tracked = new Set(
    (await gitText(["ls-tree", "-r", "--name-only", "HEAD"], repositoryRoot))
      .split("\n")
      .filter(Boolean),
  );
  for (
    const path of [
      ...scope.inputs.map((input) => input.path),
      SCOPE_PATH,
      TOOLS_LOCK_PATH,
      ...toolsLock.generator.sourceModules,
    ]
  ) {
    if (!tracked.has(path)) {
      throw new Error(
        `Source-alpha release input is not tracked at HEAD: ${path}. Generate only from a committed candidate.`,
      );
    }
  }
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const compressed = new Blob([copy.buffer]).stream().pipeThrough(
    new CompressionStream("gzip"),
  );
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function sourceInputDigests(
  scope: SourceAlphaScope,
  repositoryRoot: URL,
): Promise<readonly SourceAlphaInputDigest[]> {
  return await Promise.all(scope.inputs.map(async (input) => {
    const bytes = await Deno.readFile(repositoryUrl(input.path, repositoryRoot));
    return {
      path: input.path,
      role: input.role,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
    };
  })).then((inputs) =>
    inputs.sort((left, right) => left.path.localeCompare(right.path))
  );
}

async function generatorSourceDigest(
  sourceModules: readonly string[],
  repositoryRoot: URL,
): Promise<string> {
  const modules = await Promise.all(
    [...sourceModules].sort().map(async (path) => {
      const bytes = await Deno.readFile(repositoryUrl(path, repositoryRoot));
      return { path, sha256: await sha256(bytes) };
    }),
  );
  return await sha256Text(canonicalJson({
    schemaVersion: "casys-source-alpha-generator-source-set/1.0",
    modules,
  }));
}

function assertTooling(toolsLock: SourceAlphaToolsLock): void {
  if (toolsLock.generator.version !== SOURCE_ALPHA_GENERATOR_VERSION) {
    throw new Error(
      `Tool lock pins generator ${toolsLock.generator.version}; this renderer is ${SOURCE_ALPHA_GENERATOR_VERSION}.`,
    );
  }
  if (toolsLock.generator.sourcePath !== GENERATOR_PATH) {
    throw new Error(`${TOOLS_LOCK_PATH} must point to ${GENERATOR_PATH}.`);
  }
  const denoTool = toolsLock.requiredTools.find((tool) => tool.id === "deno");
  if (
    !denoTool || denoTool.enforcement !== "exact" ||
    denoTool.version !== Deno.version.deno
  ) {
    throw new Error(
      `Source-alpha tooling requires Deno ${
        denoTool?.version ?? "(missing)"
      }; running ${Deno.version.deno}.`,
    );
  }
  const gitTool = toolsLock.requiredTools.find((tool) => tool.id === "git");
  if (!gitTool || gitTool.enforcement !== "record-only") {
    throw new Error(`${TOOLS_LOCK_PATH} must retain Git as a record-at-build tool.`);
  }
  if (
    !toolsLock.notExecutedTools.some((tool) =>
      tool.id === "syft" && tool.status === "not-executed"
    )
  ) {
    throw new Error(`${TOOLS_LOCK_PATH} must retain Syft as explicitly not executed.`);
  }
}

export async function resolveSourceAlphaReleaseContext(
  tag: string,
  repositoryRoot = REPOSITORY_ROOT,
  allowUncommittedForTest = false,
): Promise<SourceAlphaReleaseContext> {
  const [scopeText, toolsLockText] = await Promise.all([
    Deno.readTextFile(repositoryUrl(SCOPE_PATH, repositoryRoot)),
    Deno.readTextFile(repositoryUrl(TOOLS_LOCK_PATH, repositoryRoot)),
  ]);
  const scope = parseSourceAlphaScope(JSON.parse(scopeText));
  const toolsLock = parseSourceAlphaToolsLock(JSON.parse(toolsLockText));
  assertRendererCoverage(scope);
  assertTooling(toolsLock);
  if (!allowUncommittedForTest) {
    await assertCleanCheckout(repositoryRoot);
    await assertTrackedInputs(scope, toolsLock, repositoryRoot);
  }

  const [
    commit,
    tree,
    commitTimestamp,
    gitVersion,
    generatorSha256,
    inputs,
    archiveTar,
  ] = await Promise.all([
    gitText(["rev-parse", "HEAD"], repositoryRoot),
    gitText(["rev-parse", "HEAD^{tree}"], repositoryRoot),
    gitText(["show", "-s", "--format=%cI", "HEAD"], repositoryRoot),
    gitText(["--version"], repositoryRoot),
    generatorSourceDigest(toolsLock.generator.sourceModules, repositoryRoot),
    sourceInputDigests(scope, repositoryRoot),
    git([
      "archive",
      "--format=tar",
      `--prefix=casys-digital-thread-${tag}/`,
      "HEAD",
    ], repositoryRoot),
  ]);
  const sourceArchive = await gzip(archiveTar);
  return {
    tag,
    commit,
    tree,
    commitTimestamp,
    gitVersion,
    scope,
    scopeSha256: await sha256Text(scopeText),
    toolsLock,
    toolsLockSha256: await sha256Text(toolsLockText),
    generatorSha256,
    inputs,
    sourceArchive,
    sourceArchiveSha256: await sha256(sourceArchive),
  };
}
