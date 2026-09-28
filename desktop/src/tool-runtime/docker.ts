import type {
  CommandResult,
  CommandRunner,
} from "../../../src/adapters/shared/docker-observer.ts";

/**
 * Ordered absolute Docker CLI locations, then the ambient-PATH bare name.
 * The packaged Desktop launcher controls PATH (Helpers + system dirs), so a
 * bare `docker` never resolves in production: standard installs are found by
 * absolute probe instead. The desktop permission profile pins exactly these
 * absolute paths plus the bare name (see `deno.json` + `deno-tasks_test.ts`);
 * keep both lists in sync.
 */
export const DOCKER_COMMAND_CANDIDATES: readonly string[] = Object.freeze([
  "/opt/homebrew/bin/docker",
  "/usr/local/bin/docker",
  "/usr/bin/docker",
  "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
  "docker",
]);

async function isExecutableFile(path: string): Promise<boolean> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(path);
  } catch {
    return false;
  }
  if (!info.isFile) return false;
  // Windows reports no mode bits; a present file is accepted there.
  if (info.mode === null) return true;
  return (info.mode & 0o111) !== 0;
}

/** First absolute candidate that exists, else the bare name. Never throws. */
export async function resolveDockerCommand(
  candidates: readonly string[] = DOCKER_COMMAND_CANDIDATES,
): Promise<string> {
  for (const candidate of candidates) {
    if (candidate === "docker") return candidate;
    if (await isExecutableFile(candidate)) return candidate;
  }
  return "docker";
}

/**
 * Rewrites bare `docker` spawns to the resolved absolute CLI before
 * delegating. Every other command passes through untouched. Resolution runs
 * per call (a few stats against seconds-long docker operations) so a
 * mid-session Docker install is picked up without a restart.
 */
export class DockerResolvingRunner implements CommandRunner {
  readonly #inner: CommandRunner;

  constructor(inner: CommandRunner) {
    this.#inner = inner;
  }

  async run(
    command: string,
    args: string[],
    cwd: string,
    options?: {
      readonly stdin?: Uint8Array;
      readonly env?: Readonly<Record<string, string>>;
      readonly clearEnv?: boolean;
    },
  ): Promise<CommandResult> {
    if (command !== "docker") return this.#inner.run(command, args, cwd, options);
    return this.#inner.run(await resolveDockerCommand(), args, cwd, options);
  }
}
