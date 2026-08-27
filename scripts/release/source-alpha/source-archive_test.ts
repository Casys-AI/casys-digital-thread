import { assertEquals } from "@std/assert";
import { fileUrlPath, REPOSITORY_ROOT } from "./contract.ts";
import { resolveSourceAlphaReleaseContext } from "./source-archive.ts";

const TAG = "source-alpha-commit-snapshot";

async function runGit(args: readonly string[]): Promise<void> {
  const output = await new Deno.Command("git", {
    args: [...args],
    cwd: fileUrlPath(REPOSITORY_ROOT),
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
  const worktreePath = `${temporaryRoot}/checkout`;
  const worktreeRoot = new URL(`file://${worktreePath}/`);
  let worktreeAdded = false;

  try {
    await runGit(["worktree", "add", "--detach", worktreePath, "HEAD"]);
    worktreeAdded = true;

    const first = await resolveSourceAlphaReleaseContext(TAG, worktreeRoot, true);
    await Deno.writeTextFile(
      new URL("LICENSE", worktreeRoot),
      "\nuncommitted test mutation must not enter the selected source snapshot\n",
      { append: true },
    );
    const second = await resolveSourceAlphaReleaseContext(TAG, worktreeRoot, true);

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
    if (worktreeAdded) {
      await runGit(["worktree", "remove", "--force", worktreePath]);
    }
    await Deno.remove(temporaryRoot, { recursive: true });
  }
});
