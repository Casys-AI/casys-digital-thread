/**
 * Lease-owned Compose container staging: unique labelled target, exact image
 * digest, independent SHA-256 and byte-count readback. Authority-specific
 * mount topology and filenames stay with the caller.
 */

import { fingerprintResourceBytes } from "../../domain/compile/source/provider-resource-reader.ts";
import type {
  CapabilityRuntimeLaunchGroup,
  CapabilityRuntimeLaunchGroupMaterial,
} from "../../domain/capability/runtime/capability-runtime-launch-group.ts";
import {
  type ContainerAssetStager,
  ContainerAssetStagingError,
  type ContainerCommandRunner,
  type HostFileReader,
  type StagedContainerAsset,
} from "./container-asset-stager.ts";

const CONTAINER_ID = /^[a-f0-9]{12,64}$/;

export type OwnedContainerPreexistingPolicy = "reuse-or-copy" | "reuse-or-reject";

export interface OwnedLaunchGroupContainerAssetStagerOptions {
  readonly group: CapabilityRuntimeLaunchGroup;
  readonly member: CapabilityRuntimeLaunchGroupMaterial;
  readonly containerDirectory: string;
  readonly assertFileName: (fileName: string, expectedDigest?: string) => void;
  readonly mountsAreExact: (
    mounts: unknown,
    group: CapabilityRuntimeLaunchGroup,
  ) => boolean;
  readonly preexisting: OwnedContainerPreexistingPolicy;
  readonly authority: string;
  readonly run: ContainerCommandRunner;
  readonly readHost: HostFileReader;
}

export class OwnedLaunchGroupContainerAssetStager implements ContainerAssetStager {
  constructor(
    private readonly options: OwnedLaunchGroupContainerAssetStagerOptions,
  ) {
    requireSafeContainerDirectory(
      options.containerDirectory,
      options.authority,
    );
  }

  resolveTarget(input: { readonly containerFileName: string }): StagedContainerAsset {
    this.options.assertFileName(input.containerFileName);
    return Object.freeze({
      containerPath: `${this.options.containerDirectory}/${input.containerFileName}`,
    });
  }

  async stage(input: {
    readonly sourcePath: string;
    readonly expectedDigest: string;
    readonly expectedBytes: number;
    readonly containerFileName: string;
  }): Promise<StagedContainerAsset> {
    requireDigest(input.expectedDigest, this.options.authority);
    this.options.assertFileName(input.containerFileName, input.expectedDigest);
    if (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes <= 0) {
      throw new TypeError(
        `${this.options.authority} staged input byte count must be a positive safe integer.`,
      );
    }
    const target = this.resolveTarget(input);
    const source = await this.options.readHost(input.sourcePath);
    if (
      !source || source.byteLength !== input.expectedBytes ||
      await fingerprintResourceBytes(source) !== input.expectedDigest
    ) {
      throw new ContainerAssetStagingError(
        "pre_verify_failed",
        { sourcePath: input.sourcePath, containerFileName: input.containerFileName },
        `Server-owned ${this.options.authority} staging cache bytes do not match the exact STEP identity.`,
      );
    }
    const containerId = await this.#ownedRunningContainer();
    const preexisting = await this.#readExactBytes(
      containerId,
      target.containerPath,
      input.expectedDigest,
      input.expectedBytes,
    );
    if (preexisting === "exact") return target;
    if (preexisting === "divergent") {
      if (this.options.preexisting === "reuse-or-reject") {
        throw new ContainerAssetStagingError(
          "sha256_mismatch",
          {
            containerFileName: input.containerFileName,
            expected: input.expectedDigest,
          },
          `Launch-group-owned ${this.options.authority} target already holds a divergent file.`,
        );
      }
    }
    const copy = await this.options.run("docker", [
      "cp",
      input.sourcePath,
      `${containerId}:${target.containerPath}`,
    ]);
    if (!copy.success) {
      throw stagingError(
        "copy_failed",
        copy,
        input.containerFileName,
        this.options.authority,
      );
    }
    const readback = await this.options.run("docker", [
      "exec",
      containerId,
      "cat",
      target.containerPath,
    ]);
    if (!readback.success) {
      throw stagingError(
        "post_read_failed",
        readback,
        input.containerFileName,
        this.options.authority,
      );
    }
    if (
      readback.stdout.byteLength !== input.expectedBytes ||
      await fingerprintResourceBytes(readback.stdout) !== input.expectedDigest
    ) {
      throw new ContainerAssetStagingError(
        "sha256_mismatch",
        {
          containerFileName: input.containerFileName,
          expected: input.expectedDigest,
          expectedBytes: String(input.expectedBytes),
          actualBytes: String(readback.stdout.byteLength),
        },
        `Launch-group-owned ${this.options.authority} input readback has a different SHA-256 or byte count.`,
      );
    }
    return target;
  }

  async #readExactBytes(
    containerId: string,
    path: string,
    expectedDigest: string,
    expectedBytes: number,
  ): Promise<"absent" | "exact" | "divergent"> {
    const result = await this.options.run("docker", ["exec", containerId, "cat", path]);
    if (!result.success) return "absent";
    const digest = await fingerprintResourceBytes(result.stdout);
    if (
      digest === expectedDigest && result.stdout.byteLength === expectedBytes
    ) {
      return "exact";
    }
    return "divergent";
  }

  async #ownedRunningContainer(): Promise<string> {
    const labels = this.options.member.ownership;
    const args = [
      "container",
      "ls",
      "--all",
      ...labels.flatMap((label) => ["--filter", `label=${label.key}=${label.value}`]),
      "--format",
      "{{.ID}}",
    ];
    const listed = await this.options.run("docker", args);
    if (!listed.success) {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName },
        `Cannot inspect the exact owned ${this.options.authority} launch-group container.`,
      );
    }
    const ids = new TextDecoder().decode(listed.stdout).split(/\r?\n/)
      .map((value) => value.trim()).filter((value) => value.length > 0);
    if (ids.length !== 1 || !CONTAINER_ID.test(ids[0]!)) {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName, count: String(ids.length) },
        `Exact ${this.options.authority} launch-group ownership is absent or ambiguous.`,
      );
    }
    const id = ids[0]!;
    const inspected = await this.options.run("docker", ["inspect", id]);
    const actual = parseOwnedContainer(
      inspected.stdout,
      id,
      this.options.member,
      this.options.group,
      this.options.mountsAreExact,
    );
    if (!inspected.success || !actual || actual.status !== "running") {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName, containerId: id },
        `Exact ${this.options.authority} launch-group container is not a running owned digest-pinned service with its sealed volume mounts.`,
      );
    }
    const image = await this.options.run("docker", ["image", "inspect", actual.image]);
    if (
      !image.success || !hasExactImage(image.stdout, this.options.member.imageReference)
    ) {
      throw new ContainerAssetStagingError(
        "post_read_failed",
        { service: this.options.member.serviceName, containerId: id },
        `Exact ${this.options.authority} launch-group container image does not match the sealed digest.`,
      );
    }
    return id;
  }
}

export function defaultOwnedContainerCommandRunner(
  exe: string,
  args: string[],
): Promise<{
  readonly success: boolean;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly code: number;
}> {
  return new Deno.Command(exe, { args, stdout: "piped", stderr: "piped" })
    .output()
    .then((output) => ({
      success: output.success,
      code: output.code,
      stdout: output.stdout,
      stderr: output.stderr,
    }));
}

export async function defaultOwnedContainerHostFileReader(
  path: string,
): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function parseOwnedContainer(
  value: Uint8Array,
  requestedId: string,
  member: CapabilityRuntimeLaunchGroupMaterial,
  group: CapabilityRuntimeLaunchGroup,
  mountsAreExact: (
    mounts: unknown,
    group: CapabilityRuntimeLaunchGroup,
  ) => boolean,
): { readonly image: string; readonly status: string } | undefined {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value));
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!root || typeof root !== "object" || Array.isArray(root)) return undefined;
    const record = root as Record<string, unknown>;
    const config = record.Config;
    const state = record.State;
    if (
      !config || typeof config !== "object" || Array.isArray(config) ||
      !state || typeof state !== "object" || Array.isArray(state) ||
      typeof record.Id !== "string" || typeof record.Image !== "string"
    ) return undefined;
    if (!(record.Id as string).startsWith(requestedId)) return undefined;
    const labels = (config as Record<string, unknown>).Labels;
    if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
      return undefined;
    }
    if (
      !member.ownership.every((label) =>
        (labels as Record<string, unknown>)[label.key] === label.value
      )
    ) return undefined;
    if (!mountsAreExact(record.Mounts, group)) return undefined;
    const status = (state as Record<string, unknown>).Status;
    return typeof status === "string" ? { image: record.Image, status } : undefined;
  } catch {
    return undefined;
  }
}

function hasExactImage(value: Uint8Array, reference: string): boolean {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(value));
    const root = Array.isArray(parsed) ? parsed[0] : parsed;
    return !!root && typeof root === "object" && !Array.isArray(root) &&
      Array.isArray((root as Record<string, unknown>).RepoDigests) &&
      ((root as Record<string, unknown>).RepoDigests as unknown[]).includes(
        reference,
      );
  } catch {
    return false;
  }
}

function stagingError(
  code: "copy_failed" | "post_read_failed",
  result: Awaited<ReturnType<ContainerCommandRunner>>,
  fileName: string,
  authority: string,
): ContainerAssetStagingError {
  return new ContainerAssetStagingError(
    code,
    { containerFileName: fileName, exitCode: String(result.code) },
    `Launch-group-owned ${authority} staging ${code} for ${fileName}.`,
  );
}

function requireDigest(value: string, authority: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(
      `${authority} staging digest must be a lowercase SHA-256 hex value.`,
    );
  }
}

function requireSafeContainerDirectory(directory: string, authority: string): void {
  const normalized = directory.replace(/\/+$/, "");
  if (
    !normalized.startsWith("/") ||
    normalized === "/" ||
    normalized.split("/").slice(1).some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    throw new TypeError(
      `${authority} container directory is not a safe absolute path.`,
    );
  }
}
