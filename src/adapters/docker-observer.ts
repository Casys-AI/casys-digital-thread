import type { DesiredServer, ObservedContainer } from "../domain/types.ts";

export interface CommandResult {
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], cwd: string): Promise<CommandResult>;
}

export interface DockerObserver {
  observe(servers: DesiredServer[]): Promise<Map<string, ObservedContainer>>;
}

export interface DockerComposeObserverOptions {
  cwd?: string;
  runner?: CommandRunner;
}

export class DenoCommandRunner implements CommandRunner {
  constructor(private readonly timeoutMs = 2_000) {}

  async run(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<CommandResult> {
    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command(command, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (error) {
      return {
        success: false,
        code: -1,
        stdout: "",
        stderr: errorMessage(error),
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const output = await Promise.race([
        child.output(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Command timed out")),
            this.timeoutMs,
          );
        }),
      ]);
      return {
        success: output.success,
        code: output.code,
        stdout: new TextDecoder().decode(output.stdout),
        stderr: new TextDecoder().decode(output.stderr),
      };
    } catch (error) {
      try {
        child.kill("SIGKILL");
      } catch {
        // The process may already have exited.
      }
      return {
        success: false,
        code: -1,
        stdout: "",
        stderr: errorMessage(error),
      };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * Observes Compose/container/image state through read-only CLI commands only.
 * No start, stop, pull, restart, remove, or volume command is ever issued.
 */
export class DockerComposeObserver implements DockerObserver {
  readonly #cwd: string;
  readonly #runner: CommandRunner;

  constructor(options: DockerComposeObserverOptions = {}) {
    this.#cwd = options.cwd ?? Deno.cwd();
    this.#runner = options.runner ?? new DenoCommandRunner();
  }

  async observe(
    servers: DesiredServer[],
  ): Promise<Map<string, ObservedContainer>> {
    const result = new Map<string, ObservedContainer>();
    const ps = await this.#runner.run(
      "docker",
      ["compose", "ps", "--all", "--format", "json"],
      this.#cwd,
    );
    if (!ps.success) {
      const message = compactStderr(ps.stderr) ||
        `docker compose ps exited with code ${ps.code}`;
      for (const server of servers) {
        result.set(server.id, unavailableContainer(message));
      }
      return result;
    }

    let containers: ComposeContainer[];
    try {
      containers = parseComposePs(ps.stdout);
    } catch (error) {
      const message = `Unable to parse docker compose ps: ${errorMessage(error)}`;
      for (const server of servers) {
        result.set(server.id, unavailableContainer(message));
      }
      return result;
    }

    const byService = new Map(
      containers.map((container) => [container.service, container]),
    );
    const images = unique(
      containers.flatMap((container) => container.image ? [container.image] : []),
    );
    const imageInfo = new Map<string, DockerImage>();
    await Promise.all(images.map(async (image) => {
      const inspected = await this.#runner.run(
        "docker",
        ["image", "inspect", image],
        this.#cwd,
      );
      if (!inspected.success) return;
      try {
        const parsed = JSON.parse(inspected.stdout);
        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        if (isRecord(first)) {
          imageInfo.set(image, {
            id: stringValue(first.Id),
            repoDigests: Array.isArray(first.RepoDigests)
              ? first.RepoDigests.filter((item): item is string =>
                typeof item === "string"
              )
              : [],
          });
        }
      } catch {
        // Image metadata is optional; Compose state remains valid.
      }
    }));

    for (const server of servers) {
      const container = byService.get(server.serviceName);
      if (!container) {
        result.set(server.id, {
          runtimeAvailable: true,
          present: false,
        });
        continue;
      }
      const info = container.image ? imageInfo.get(container.image) : undefined;
      result.set(server.id, {
        runtimeAvailable: true,
        present: true,
        name: container.name,
        id: container.id,
        state: container.state,
        health: container.health,
        image: container.image,
        imageId: info?.id,
        repoDigests: info?.repoDigests,
      });
    }
    return result;
  }
}

interface ComposeContainer {
  service: string;
  name?: string;
  id?: string;
  state?: string;
  health?: string;
  image?: string;
}

interface DockerImage {
  id?: string;
  repoDigests: string[];
}

export function parseComposePs(stdout: string): ComposeContainer[] {
  const trimmed = stdout.trim();
  if (trimmed === "") return [];
  const values: unknown[] = trimmed.startsWith("[")
    ? JSON.parse(trimmed)
    : trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const service = stringValue(value.Service) ?? stringValue(value.service);
    if (!service) return [];
    return [{
      service,
      name: stringValue(value.Name) ?? stringValue(value.name),
      id: stringValue(value.ID) ?? stringValue(value.Id) ??
        stringValue(value.id),
      state: stringValue(value.State) ?? stringValue(value.state),
      health: stringValue(value.Health) ?? stringValue(value.health),
      image: stringValue(value.Image) ?? stringValue(value.image),
    }];
  });
}

function unavailableContainer(message: string): ObservedContainer {
  return {
    runtimeAvailable: false,
    present: false,
    error: message,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function compactStderr(value: string): string {
  return value.trim().split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
