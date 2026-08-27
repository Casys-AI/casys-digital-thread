import { assertEquals } from "@std/assert";
import { fileUrlPath, REPOSITORY_ROOT } from "./contract.ts";
import { resolveSourceAlphaReleaseContext } from "./source-archive.ts";

const TAG = "source-alpha-commit-snapshot";

async function runGit(
  args: readonly string[],
  cwd = fileUrlPath(REPOSITORY_ROOT),
): Promise<void> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git ${args.join(" ")} failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
}

Deno.test("source-alpha release context stays pinned to one commit snapshot", async () => {
  const temporaryRoot = await Deno.makeTempDir({
    prefix: "casys-source-alpha-commit-snapshot-",
  });
  const clonePath = `${temporaryRoot}/checkout`;
  const cloneRoot = new URL(`file://${clonePath}/`);

  try {
    await runGit([
      "clone",
      "--no-local",
      "--no-hardlinks",
      fileUrlPath(REPOSITORY_ROOT),
      clonePath,
    ]);
    await runGit(["checkout", "--detach", "HEAD"], clonePath);

    const first = await resolveSourceAlphaReleaseContext(TAG, cloneRoot, true);
    await Deno.writeTextFile(
      new URL("LICENSE", cloneRoot),
      "\nuncommitted test mutation must not enter the selected source snapshot\n",
      { append: true },
    );
    const second = await resolveSourceAlphaReleaseContext(TAG, cloneRoot, true);

    assertEquals(second.commit, first.commit);
    assertEquals(second.tree, first.tree);
    assertEquals(second.commitTimestamp, first.commitTimestamp);
    assertEquals(second.scopeSha256, first.scopeSha256);
    assertEquals(second.toolsLockSha256, first.toolsLockSha256);
    assertEquals(second.generatorSha256, first.generatorSha256);
    assertEquals(second.inputs, first.inputs);
    assertEquals(second.sourceArchive, first.sourceArchive);
    assertEquals(second.sourceArchiveSha256, first.sourceArchiveSha256);
  } finally {
    await Deno.remove(temporaryRoot, { recursive: true });
  }
});
