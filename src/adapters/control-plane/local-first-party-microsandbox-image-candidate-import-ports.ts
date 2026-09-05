/**
 * Local Docker, Microsandbox, and filesystem ports for first-party
 * Microsandbox candidate import. This module never acquires under the
 * active catalogue pin, never force-deletes, and never prunes.
 */

import {
  createLocalMicrosandboxSdk,
  loadLocalMicrosandboxImageImportHandlesFromArchive,
  microsandboxHostArchitecture,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  assertAllowedFirstPartyBootstrapTempPath,
  type FirstPartyMicrosandboxTemporaryArchive,
} from "./first-party-microsandbox-image-acquisition.ts";
import type { FirstPartyMicrosandboxImageCandidateImportPorts } from "./first-party-microsandbox-image-candidate-import.ts";
import {
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_DIRECTORY,
  type FirstPartyMicrosandboxImageCandidateImportRecord,
  parseFirstPartyMicrosandboxImageCandidateImportRecord,
} from "./first-party-microsandbox-image-candidate-import-record.ts";

export async function createLocalFirstPartyMicrosandboxImageCandidateImportPorts(
  createSdk: () => Promise<MicrosandboxSdk> = createLocalMicrosandboxSdk,
): Promise<FirstPartyMicrosandboxImageCandidateImportPorts> {
  const sdk = await createSdk();
  sdk.assertLocalBackend();
  return Object.freeze({
    hostArchitecture: microsandboxHostArchitecture(),
    createStagingToken: createFirstPartyMicrosandboxImageCandidateStagingToken,
    inspectOciIndex,
    pullByDigest,
    inspectDockerImage,
    saveDockerImage,
    loadImageFromArchive: (archivePath: string, tag: string) =>
      loadLocalMicrosandboxImageImportHandlesFromArchive(archivePath, tag),
    inspectCachedImage: (reference: string) => sdk.inspectImage(reference),
    isImageNotFound: (error: unknown) => sdk.isImageNotFound(error),
    removeExactCachedImage: (reference: string) =>
      sdk.removeExactCachedImage(reference),
    createTemporaryArchiveDirectory: createAllowedCandidateArchive,
    writeImportRecord: writeFirstPartyMicrosandboxImageCandidateImportRecord,
  });
}

export async function writeFirstPartyMicrosandboxImageCandidateImportRecord(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
  root: string = FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_IMPORT_RECORD_DIRECTORY,
): Promise<void> {
  const parsed = await parseFirstPartyMicrosandboxImageCandidateImportRecord(
    JSON.parse(deterministicJson(record)),
  );
  const text = `${deterministicJson(parsed)}\n`;
  const directory = `${root}/${parsed.candidate.physicalImageId}`;
  await Deno.mkdir(directory, { recursive: true });
  const path = `${directory}/${importRecordFileName(parsed)}`;
  try {
    await Deno.writeTextFile(path, text, { createNew: true });
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      const existing = await Deno.readTextFile(path);
      if (existing === text) return;
      throw new Error(
        "An incoherent first-party candidate import record already exists.",
      );
    }
    throw error;
  }
}

function importRecordFileName(
  record: FirstPartyMicrosandboxImageCandidateImportRecord,
): string {
  return [
    hexDigest(record.identities.ociIndexDigest),
    hexDigest(record.identities.ociPlatformManifestDigest),
    hexDigest(record.identities.microsandboxManifestDigest),
  ].join("-") + ".json";
}

function hexDigest(value: string): string {
  return value.slice("sha256:".length);
}

function createFirstPartyMicrosandboxImageCandidateStagingToken(): string {
  return crypto.randomUUID();
}

async function inspectOciIndex(reference: string): Promise<string> {
  if (!reference.includes("@sha256:") || reference.endsWith(":latest")) {
    throw new TypeError(
      "OCI index inspect requires an exact digest-pinned reference.",
    );
  }
  const output = await docker([
    "buildx",
    "imagetools",
    "inspect",
    "--raw",
    reference,
  ]);
  if (!output.success) {
    throw new Error(
      `docker buildx imagetools inspect failed: ${decode(output.stderr).slice(-2_000)}`,
    );
  }
  return decode(output.stdout);
}

async function inspectDockerImage(reference: string): Promise<unknown | undefined> {
  const output = await docker([
    "image",
    "inspect",
    "--format",
    "{{json .}}",
    reference,
  ]);
  if (!output.success) return undefined;
  return JSON.parse(decode(output.stdout)) as unknown;
}

async function pullByDigest(reference: string): Promise<void> {
  if (!reference.includes("@sha256:") || reference.endsWith(":latest")) {
    throw new TypeError(
      "First-party candidate pull requires an exact digest-pinned reference.",
    );
  }
  const output = await docker(["pull", reference]);
  if (!output.success) {
    throw new Error(`docker pull failed: ${decode(output.stderr).slice(-2_000)}`);
  }
}

async function saveDockerImage(reference: string, archivePath: string): Promise<void> {
  const output = await docker(["image", "save", "-o", archivePath, reference]);
  if (!output.success) {
    throw new Error(
      `docker image save failed: ${decode(output.stderr).slice(-2_000)}`,
    );
  }
}

async function createAllowedCandidateArchive(): Promise<
  FirstPartyMicrosandboxTemporaryArchive
> {
  const directory = assertAllowedFirstPartyBootstrapTempPath(
    await Deno.makeTempDir({
      dir: "/tmp",
      prefix: "casys-first-party-microsandbox-candidate-",
    }),
  );
  return Object.freeze({
    directory,
    archivePath: `${directory}/image.tar`,
    cleanup: () => Deno.remove(directory, { recursive: true }),
  });
}

async function docker(args: readonly string[]): Promise<Deno.CommandOutput> {
  return await new Deno.Command("docker", {
    args: [...args],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
