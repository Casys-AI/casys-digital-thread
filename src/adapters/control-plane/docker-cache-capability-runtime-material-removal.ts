/** Exact Docker cache-image inspection and non-forced removal. */

import {
  CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OBSERVATION_SCHEMA,
  type CapabilityRuntimeNonpersistentMaterialRemovalObservation,
  type CapabilityRuntimeNonpersistentMaterialRemovalOutcome,
  type CapabilityRuntimeNonpersistentMaterialRemovalPlan,
  createCapabilityRuntimeNonpersistentMaterialRemovalOutcome,
} from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";
import type {
  AuthorizedNonpersistentMaterialRemoval,
} from "../../application/ports/out/capability/capability-runtime-nonpersistent-material-removal.ts";
import { consumeAuthorizedNonpersistentMaterialRemoval } from "../../application/control-plane/capability-runtime-nonpersistent-material-removal-authorization.ts";
import {
  type CommandResult,
  type CommandRunner,
  DenoCommandRunner,
} from "../shared/docker-observer.ts";
import {
  dockerInspectReportsImageAbsent,
  samePinnedRepositoryDigest,
} from "../shared/docker-pinned-repository-digest.ts";

export interface DockerCacheCapabilityRuntimeMaterialRemovalOptions {
  readonly runner?: CommandRunner;
  readonly dockerEnvironment?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly clock?: () => string;
}

export class DockerCacheCapabilityRuntimeMaterialRemovalHost {
  readonly #runner: CommandRunner;
  readonly #cwd: string;
  readonly #environment: Readonly<Record<string, string>>;
  readonly #clock: () => string;

  constructor(options: DockerCacheCapabilityRuntimeMaterialRemovalOptions = {}) {
    this.#runner = options.runner ?? new DenoCommandRunner(360_000);
    this.#cwd = nonBlank(options.cwd ?? ".");
    this.#environment = dockerEnvironment(options.dockerEnvironment);
    this.#clock = options.clock ?? (() => new Date().toISOString());
  }

  async inspect(input: {
    readonly material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"];
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalObservation> {
    return await this.#observe(input.material);
  }

  async mutate(input: {
    readonly authorization: AuthorizedNonpersistentMaterialRemoval;
    readonly plan: CapabilityRuntimeNonpersistentMaterialRemovalPlan;
  }): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
    const intent = consumeAuthorizedNonpersistentMaterialRemoval(input.authorization);
    if (!intent) {
      throw new Error(
        "Non-persistent material removal authorization is absent or consumed.",
      );
    }
    if (input.plan.backend !== "docker-cache") {
      return await this.#outcome(
        intent,
        "failed",
        null,
        "Docker cache removal received a non-docker-cache plan.",
      );
    }
    const before = await this.#observe(input.plan.material);
    if (before.safety !== "exact") {
      return await this.#outcome(
        intent,
        before.safety === "unknown" ? "uncertain" : "failed",
        null,
        before.safety === "unknown"
          ? "Docker cache image ownership cannot be observed exactly."
          : "Docker cache image is foreign or has additional tags, digests, or containers.",
      );
    }
    if (before.state === "absent") {
      return await this.#outcome(intent, "succeeded", "absent", null);
    }
    const removed = await this.#docker([
      "image",
      "rm",
      input.plan.material.imageReference,
    ]);
    const after = await this.#observe(input.plan.material);
    if (after.safety !== "exact") {
      return await this.#outcome(
        intent,
        after.safety === "unknown" ? "uncertain" : "failed",
        null,
        after.safety === "unknown"
          ? "Docker cache image post-state cannot be observed exactly."
          : "Docker cache image became foreign after removal.",
      );
    }
    if (after.state === "absent") {
      return await this.#outcome(intent, "succeeded", "absent", null);
    }
    return await this.#outcome(
      intent,
      "failed",
      after.state,
      compactFailure(removed) ||
        "Docker cache image remained after a non-forced removal.",
    );
  }

  async #observe(
    material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"],
  ): Promise<CapabilityRuntimeNonpersistentMaterialRemovalObservation> {
    const inspected = await this.#docker(["image", "inspect", material.imageReference]);
    if (isDockerImageNotFound(inspected)) {
      return observation(material, "absent", "exact");
    }
    if (!inspected.success) return observation(material, "owned", "unknown");
    const ownership = parseExactImageOwnership(
      inspected.stdout,
      material.imageReference,
    );
    if (ownership !== "owned") {
      return observation(
        material,
        "owned",
        ownership === "unknown" ? "unknown" : "foreign",
      );
    }
    const containers = await this.#docker([
      "ps",
      "-aq",
      "--filter",
      `ancestor=${material.imageReference}`,
    ]);
    if (!containers.success) return observation(material, "owned", "unknown");
    if (containers.stdout.trim() !== "") {
      return observation(material, "owned", "foreign");
    }
    return observation(material, "owned", "exact");
  }

  async #docker(args: readonly string[]): Promise<CommandResult> {
    return await this.#runner.run("docker", [...args], this.#cwd, {
      clearEnv: true,
      env: this.#environment,
    });
  }

  async #outcome(
    intent: {
      readonly id: string;
      readonly fingerprint:
        CapabilityRuntimeNonpersistentMaterialRemovalPlan["fingerprint"];
    },
    status: CapabilityRuntimeNonpersistentMaterialRemovalOutcome["status"],
    observedState:
      CapabilityRuntimeNonpersistentMaterialRemovalOutcome["observedState"],
    detail: string | null,
  ): Promise<CapabilityRuntimeNonpersistentMaterialRemovalOutcome> {
    return await createCapabilityRuntimeNonpersistentMaterialRemovalOutcome({
      intentId: intent.id,
      intentFingerprint: intent.fingerprint,
      recordedAt: this.#clock(),
      status,
      observedState,
      detail,
    });
  }
}

function parseExactImageOwnership(
  stdout: string,
  sealedReference: string,
): "owned" | "foreign" | "unknown" {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return "unknown";
  }
  const root = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!root || typeof root !== "object" || Array.isArray(root)) return "unknown";
  const record = root as Record<string, unknown>;
  const tags = stringList(record.RepoTags);
  const digests = stringList(record.RepoDigests);
  if (tags === undefined || digests === undefined) return "unknown";
  if (tags.some((tag) => !samePinnedRepositoryDigest(tag, sealedReference))) {
    return "foreign";
  }
  if (
    digests.length === 0 ||
    digests.some((digest) => !samePinnedRepositoryDigest(digest, sealedReference))
  ) {
    return "foreign";
  }
  return "owned";
}

function stringList(value: unknown): readonly string[] | undefined {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return undefined;
  }
  return value;
}

function isDockerImageNotFound(result: CommandResult): boolean {
  return !result.success && dockerInspectReportsImageAbsent(result.stderr);
}

function observation(
  material: CapabilityRuntimeNonpersistentMaterialRemovalPlan["material"],
  state: CapabilityRuntimeNonpersistentMaterialRemovalObservation["state"],
  safety: CapabilityRuntimeNonpersistentMaterialRemovalObservation["safety"],
): CapabilityRuntimeNonpersistentMaterialRemovalObservation {
  return {
    schemaVersion: CAPABILITY_RUNTIME_NONPERSISTENT_REMOVAL_OBSERVATION_SCHEMA,
    material: structuredClone(material),
    backend: "docker-cache",
    state,
    safety,
  };
}

function compactFailure(result: CommandResult): string | null {
  const text = result.stderr.trim() ||
    (result.success ? "" : `docker exited ${result.code}`);
  if (!text) return null;
  return text.length > 512 ? `${text.slice(0, 509)}...` : text;
}

function nonBlank(value: string): string {
  if (!value.trim()) {
    throw new TypeError("Docker cache removal working directory must not be blank.");
  }
  return value;
}

function dockerEnvironment(
  supplied: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  const allowed = new Set([
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
    "DOCKER_CONFIG",
  ]);
  const result: Record<string, string> = { COMPOSE_DISABLE_ENV_FILE: "1" };
  for (const [key, value] of Object.entries(supplied ?? {})) {
    if (!allowed.has(key) || !value) {
      throw new TypeError("Capability runtime Docker environment is not allowlisted.");
    }
    result[key] = value;
  }
  return Object.freeze(result);
}
