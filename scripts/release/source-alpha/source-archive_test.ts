import { assert, assertEquals } from "@std/assert";
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

async function gitArchive(cwd: string): Promise<Uint8Array> {
  const output = await new Deno.Command("git", {
    args: ["archive", "--format=tar", "HEAD"],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git archive failed: ${new TextDecoder().decode(output.stderr).trim()}`,
    );
  }
  return output.stdout;
}

function tarString(bytes: Uint8Array, start: number, width: number): string {
  const end = start + width;
  const terminator = bytes.subarray(start, end).indexOf(0);
  return new TextDecoder().decode(
    bytes.subarray(start, terminator < 0 ? end : start + terminator),
  );
}

function tarEntryPaths(tar: Uint8Array): readonly string[] {
  const blockSize = 512;
  const paths: string[] = [];
  for (let offset = 0; offset + blockSize <= tar.byteLength;) {
    const header = tar.subarray(offset, offset + blockSize);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const sizeText = tarString(header, 124, 12).trim();
    const size = Number.parseInt(sizeText || "0", 8);
    assert(Number.isSafeInteger(size) && size >= 0, "Invalid tar entry size.");
    paths.push(prefix === "" ? name : `${prefix}/${name}`);
    offset += blockSize + Math.ceil(size / blockSize) * blockSize;
  }
  return paths;
}

Deno.test("public archives omit private development aides while retaining portable guidance", async () => {
  const temporaryRoot = await Deno.makeTempDir({
    prefix: "casys-public-export-boundary-",
  });
  try {
    await Deno.copyFile(
      new URL("../../../.gitattributes", import.meta.url),
      new URL(".gitattributes", `file://${temporaryRoot}/`),
    );
    const fixtures = [
      {
        path: ".grok/workflows/private.rhai",
        public: false,
      },
      {
        path: ".claude/settings.json",
        public: false,
      },
      {
        path: ".cursor/rules/private.md",
        public: false,
      },
      {
        path: ".codex/config.toml",
        public: false,
      },
      {
        path: "CLAUDE.md",
        public: false,
      },
      {
        path: "docs/assets/workbench-dashboard-mockups/dashboard.html",
        public: false,
      },
      {
        path: "docs/assets/calculix-component-surface.png",
        public: false,
      },
      {
        path: "docs/rfcs/private-session-brief.md",
        public: false,
      },
      {
        path: "AGENTS.md",
        public: true,
      },
      {
        path: ".agents/skills/README.md",
        public: true,
      },
      {
        path: ".github/workflows/quality.yml",
        public: true,
      },
      {
        path: "docs/media/workbench-project-dl04.png",
        public: true,
      },
    ] as const;
    for (const fixture of fixtures) {
      const destination = new URL(fixture.path, `file://${temporaryRoot}/`);
      await Deno.mkdir(new URL(".", destination), { recursive: true });
      await Deno.writeTextFile(destination, fixture.path);
    }
    await runGit(["init"], temporaryRoot);
    await runGit(["add", "."], temporaryRoot);
    await runGit(
      [
        "-c",
        "user.name=Source Alpha Test",
        "-c",
        "user.email=source-alpha-test@invalid.example",
        "commit",
        "-m",
        "test public archive boundary",
      ],
      temporaryRoot,
    );

    const archivePaths = tarEntryPaths(await gitArchive(temporaryRoot));
    assert(
      !archivePaths.includes("docs/assets/"),
      "The private asset workspace directory must not enter the public archive.",
    );
    assert(
      !archivePaths.includes("docs/rfcs/"),
      "The private planning-history directory must not enter the public archive.",
    );
    for (const fixture of fixtures) {
      if (fixture.public) {
        assert(
          archivePaths.includes(fixture.path),
          `${fixture.path} must remain in the public archive.`,
        );
      } else {
        assert(
          !archivePaths.includes(fixture.path),
          `${fixture.path} must not enter the public archive.`,
        );
      }
    }
  } finally {
    await Deno.remove(temporaryRoot, { recursive: true });
  }
});

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
