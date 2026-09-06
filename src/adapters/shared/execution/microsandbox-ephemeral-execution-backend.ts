/**
 * Local Microsandbox implementation of the disposable execution port.
 *
 * The adapter deliberately exposes a much smaller surface than the upstream
 * SDK. Images, commands, paths, limits, networking and lifecycle are selected
 * by server composition. The inward request contributes only the already
 * admitted input bytes and their server-issued run identity.
 */

import type {
  EphemeralExecutionBackend,
  EphemeralExecutionBackendRequest,
  EphemeralExecutionDestruction,
  EphemeralExecutionLog,
  EphemeralExecutionReport,
  EphemeralOutputInventoryEntry,
  EphemeralOutputKind,
} from "../../../application/ports/out/compile/isolation/ephemeral-execution-backend.ts";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  copyObservedUint8Array,
  type IsolatedCodeOutputDeclaration,
  isolatedCodeOutputManifestsEqual,
  type IsolatedCodePolicyRef,
  isolatedCodeRefsEqual,
  type IsolatedCodeRuntimeAttestation,
  runtimeAttestationsEqual,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
  validateIsolatedOutputProducerGeneration,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  pinnedOciImageReference,
} from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  exactRecord,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";

const MEBIBYTE = 1_048_576;
const RUN_LABEL = "io.casys.execution-run";
const PROFILE_LABEL = "io.casys.execution-profile";
const PRODUCER_GENERATION_LABEL = "io.casys.producer-generation";
const MAXIMUM_SANDBOX_NAME_BYTES = 128;
const DESTRUCTION_TIMEOUT_MS = 5_000;
const EXECUTION_DRAIN_GRACE_MS = 1_000;
const FILE_OPERATION_TIMEOUT_MS = 5_000;
const SDK_OPERATION_TIMEOUT_MS = 5_000;
const MAXIMUM_SANDBOX_LIST_PAGES = 32;
const MAXIMUM_SANDBOX_LIST_MATCHES = 256;
const MAXIMUM_PINNED_RUNTIME_ARTIFACT_BYTES = 64 * MEBIBYTE;
const FORBIDDEN_NATIVE_OVERRIDES = Object.freeze(
  [
    "NAPI_RS_NATIVE_LIBRARY_PATH",
    "NAPI_RS_FORCE_WASI",
    "NAPI_RS_WASI_FLAVOR",
    "MSB_PATH",
    "MSB_LIBKRUNFW_PATH",
    "MSB_CONFIG_PATH",
    "MSB_HOME",
    "MSB_BACKEND",
    "MSB_API_URL",
    "MSB_API_KEY",
    "MSB_PROFILE",
  ] as const,
);

type MicrosandboxModule = typeof import("npm:microsandbox@0.6.8");
type NativeSandboxBuilder = ReturnType<MicrosandboxModule["Sandbox"]["builder"]>;
type NativeSandbox = Awaited<ReturnType<NativeSandboxBuilder["create"]>>;
type NativeSandboxHandle = Awaited<
  ReturnType<MicrosandboxModule["Sandbox"]["get"]>
>;
type NativeExecHandle = Awaited<ReturnType<NativeSandbox["execStream"]>>;
type NativeFileSystem = ReturnType<NativeSandbox["fs"]>;

interface PinnedMicrosandboxPlatformArtifacts {
  readonly packageName: string;
  readonly nativeFilename: string;
  readonly nativeSha256: string;
  readonly executableFilename: string;
  readonly executableSha256: string;
  readonly libkrunFilename: string;
  readonly libkrunPattern: RegExp;
  readonly libkrunSha256: string;
}

const PINNED_MICROSANDBOX_PLATFORM_ARTIFACTS: Readonly<
  Record<string, PinnedMicrosandboxPlatformArtifacts>
> = Object.freeze(
  {
    "darwin-aarch64": Object.freeze({
      packageName: "@superradcompany/microsandbox-darwin-arm64",
      nativeFilename: "microsandbox.darwin-arm64.node",
      nativeSha256: "724d8c40f8430514c0212f430a13395ea0a735385febaafd7cf1489e7a212bef",
      executableFilename: "bin/msb",
      executableSha256:
        "799c8d50bf8281582fee5aa75613a79101ad7631310dc08b6c4045ae57985c02",
      libkrunFilename: "lib/libkrunfw.5.dylib",
      libkrunPattern: /^libkrunfw\.[0-9]+\.dylib$/,
      libkrunSha256: "f6080a4c487aad2fc5e07f09987f337589e9f0d5cf255855078457d97e97f480",
    }),
    "linux-aarch64": Object.freeze({
      packageName: "@superradcompany/microsandbox-linux-arm64-gnu",
      nativeFilename: "microsandbox.linux-arm64-gnu.node",
      nativeSha256: "208c33990c3d4f314a281cb63fc4afe191c4715e90e8c35eed02b6ce0e7c847c",
      executableFilename: "bin/msb",
      executableSha256:
        "81ed688c52db9a366975003ea06a0abf18f3855fb4eec98bd9e244afdeecb9ae",
      libkrunFilename: "lib/libkrunfw.so.5.6.1",
      libkrunPattern: /^libkrunfw\.so\.[0-9.]+$/,
      libkrunSha256: "967e6e3abbdc29d276b9d26bec44a8a11dc9736ad891e920750d442ef30f8c38",
    }),
    "linux-x86_64": Object.freeze({
      packageName: "@superradcompany/microsandbox-linux-x64-gnu",
      nativeFilename: "microsandbox.linux-x64-gnu.node",
      nativeSha256: "0d127a671eee157f8e4d597a64f1aaccf372cab6364d9ea43e000952e9bd78d8",
      executableFilename: "bin/msb",
      executableSha256:
        "3b82e4719c768f282e2104c84d4ea0b50985bccaeb86491b3ad1aa7029356a59",
      libkrunFilename: "lib/libkrunfw.so.5.6.1",
      libkrunPattern: /^libkrunfw\.so\.[0-9.]+$/,
      libkrunSha256: "3ffb112702d450b38186214c42190a2775bd0a8ec209a5af048fea290dbf5380",
    }),
  },
);

export interface MicrosandboxImageInspection {
  readonly reference: string;
  readonly manifestDigest: string;
  readonly architecture: string;
  readonly os: string;
  readonly user: string | null;
  readonly entrypoint: readonly string[] | null;
  readonly command: readonly string[] | null;
  readonly environment: Readonly<Record<string, string>>;
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * Factual result of one `Image.load` reference. This deliberately exposes
 * only immutable, immediately returned handle fields; callers still inspect
 * a requested reference before treating an import as usable.
 */
export interface MicrosandboxImageImportHandle {
  readonly reference: string;
  readonly manifestDigest: string | null;
  readonly architecture: string | null;
  readonly os: string | null;
}

/**
 * Server-owned OCI image contract reused before a JIT lease and by the
 * execution backend itself. It attests only fields observable from an OCI
 * inspection; execution-profile provenance is a separate cache attestation.
 */
export interface ExactMicrosandboxImageExpectation {
  readonly reference: string;
  readonly manifestDigest: string;
  readonly os: "linux";
  readonly architecture: string;
  readonly user: string;
  readonly entrypoint: readonly string[];
}

export function assertExactMicrosandboxImageInspection(
  image: MicrosandboxImageInspection,
  expected: ExactMicrosandboxImageExpectation,
): MicrosandboxImageInspection {
  if (
    image.reference !== expected.reference ||
    image.manifestDigest !== expected.manifestDigest ||
    image.os !== expected.os ||
    image.architecture !== expected.architecture ||
    image.user !== expected.user ||
    !stringArraysEqual(image.entrypoint, expected.entrypoint)
  ) {
    throw new Error("The cached local OCI image does not match the reviewed image.");
  }
  return image;
}

export interface MicrosandboxFsEntry {
  readonly path: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  readonly size: number;
  readonly mode: number;
}

export type MicrosandboxExecEvent =
  | { readonly kind: "started"; readonly pid: number }
  | { readonly kind: "stdout" | "stderr"; readonly data: Uint8Array }
  | { readonly kind: "exited"; readonly code: number };

export interface MicrosandboxExecHandle extends AsyncDisposable {
  receive(): Promise<MicrosandboxExecEvent | null | undefined>;
  kill(): Promise<void>;
  wait(): Promise<{ readonly code: number; readonly success: boolean }>;
}

export interface MicrosandboxFileSystem {
  write(path: string, bytes: Uint8Array): Promise<void>;
  list(path: string): Promise<readonly MicrosandboxFsEntry[]>;
  readChunks(path: string): AsyncIterable<Uint8Array>;
}

export interface MicrosandboxSession {
  readonly name: string;
  readonly ownsLifecycle: boolean;
  config(): Promise<unknown>;
  fileSystem(): MicrosandboxFileSystem;
  executeStream(value: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly user: string;
    readonly maxProcesses: number;
    readonly maxOpenFiles: number;
  }): Promise<MicrosandboxExecHandle>;
  killWithTimeout(timeoutMs: number): Promise<void>;
  waitUntilStopped(): Promise<void>;
  remove(): Promise<void>;
}

export interface MicrosandboxKnownSandbox {
  readonly name: string;
  config(): unknown;
  killWithTimeout(timeoutMs: number): Promise<void>;
  waitUntilStopped(): Promise<void>;
  remove(): Promise<void>;
}

export interface MicrosandboxCreateRequest {
  readonly name: string;
  readonly imageReference: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly cpus: number;
  readonly memoryMiB: number;
  readonly rootDiskMiB: number;
  readonly workdir: string;
  readonly user: string;
  readonly maxDurationSeconds: number;
  readonly maxProcesses: number;
  readonly maxOpenFiles: number;
}

/** Narrow SDK seam. Tests never need to load the native npm package. */
export interface MicrosandboxSdk {
  assertLocalBackend(): void;
  inspectImage(reference: string): Promise<MicrosandboxImageInspection>;
  /**
   * Internal exact cached-image removal. Callers cannot pass force, prune,
   * or any other option; the native path is `Image.remove(ref, { force: false })`.
   */
  removeExactCachedImage(reference: string): Promise<void>;
  /** Absence is only the SDK's recognized image-not-found condition. */
  isImageNotFound(error: unknown): boolean;
  create(request: MicrosandboxCreateRequest): Promise<MicrosandboxSession>;
  listByLabels(
    labels: Readonly<Record<string, string>>,
  ): Promise<readonly MicrosandboxKnownSandbox[]>;
  getByName(name: string): Promise<MicrosandboxKnownSandbox | undefined>;
}

export interface MicrosandboxControlFiles {
  readonly quiescencePath: string;
  readonly quiescenceBytes: Uint8Array;
  readonly stdoutPath: string;
  readonly stderrPath: string;
}

export interface MicrosandboxEphemeralExecutionBackendOptions {
  readonly sdk: MicrosandboxSdk;
  readonly imageReference: string;
  readonly expectedImageUser: string;
  /**
   * Exact OCI ENTRYPOINT committed by the image. Omission keeps the common
   * case where the image entrypoint is also the command executed by this
   * backend; shared images may select another reviewed executable explicitly.
   */
  readonly expectedImageEntrypoint?: readonly string[];
  readonly executable: string;
  readonly args: readonly string[];
  readonly workdir: string;
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly controlFiles: MicrosandboxControlFiles;
  readonly profile: { readonly id: string; readonly version: string };
  readonly policy: IsolatedCodePolicyRef;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly cpus: number;
  readonly rootDiskMiB: number;
  readonly maxDurationMs: number;
  readonly maxOpenFiles: number;
  readonly supervisorUser?: string;
}

interface NormalizedBackendOptions {
  readonly sdk: MicrosandboxSdk;
  readonly imageReference: string;
  readonly imageDigest: string;
  readonly expectedImageUser: string;
  readonly expectedImageEntrypoint: readonly string[];
  readonly executable: string;
  readonly args: readonly string[];
  readonly workdir: string;
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly controlFiles: MicrosandboxControlFiles;
  readonly profile: { readonly id: string; readonly version: string };
  readonly policy: IsolatedCodePolicyRef;
  readonly runtime: IsolatedCodeRuntimeAttestation;
  readonly outputManifest: readonly IsolatedCodeOutputDeclaration[];
  readonly cpus: number;
  readonly rootDiskMiB: number;
  readonly maxDurationMs: number;
  readonly maxOpenFiles: number;
  readonly supervisorUser: string;
}

type LeaseState = "ready" | "executing" | "executed" | "inventoried" | "destroyed";

export interface MicrosandboxLease {
  readonly runId: string;
  readonly session: MicrosandboxSession;
  readonly labels: Readonly<Record<string, string>>;
  readonly request: EphemeralExecutionBackendRequest;
  state: LeaseState;
  quiesced: boolean;
  report?: EphemeralExecutionReport;
  inventory?: readonly EphemeralOutputInventoryEntry<string>[];
}

/**
 * Refuse native-loader and runtime-binary overrides before importing the npm
 * package. A caller that has already attested the code-owned configuration may
 * admit that one exact absolute path; every ambient alternative stays rejected.
 */
export function assertMicrosandboxNativeEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  codeOwnedConfigurationPath?: string,
): void {
  for (const name of FORBIDDEN_NATIVE_OVERRIDES) {
    const value = environment[name];
    if (
      value !== undefined &&
      !(
        name === "MSB_CONFIG_PATH" &&
        codeOwnedConfigurationPath !== undefined &&
        isAbsolute(codeOwnedConfigurationPath) &&
        value === codeOwnedConfigurationPath
      )
    ) {
      throw new Error(`Microsandbox native override ${name} is forbidden.`);
    }
  }
  const versionCheck = environment.NAPI_RS_ENFORCE_VERSION_CHECK;
  if (versionCheck !== undefined && versionCheck !== "1") {
    throw new Error("NAPI_RS_ENFORCE_VERSION_CHECK must equal 1.");
  }
}

/** Load the real SDK only after the native environment is pinned fail-closed. */
let localMicrosandboxSdk: Promise<MicrosandboxSdk> | undefined;
let localMicrosandboxModule: MicrosandboxModule | undefined;

export function createLocalMicrosandboxSdk(): Promise<MicrosandboxSdk> {
  localMicrosandboxSdk ??= createPinnedLocalMicrosandboxSdk();
  return localMicrosandboxSdk;
}

/**
 * Import a local `docker save` archive into the pinned Microsandbox cache.
 * `tag` is the exact cache key later inspected with pullPolicy never.
 */
export async function loadLocalMicrosandboxImageFromArchive(
  archivePath: string,
  tag: string,
): Promise<void> {
  await loadLocalMicrosandboxImageImportHandlesFromArchive(archivePath, tag);
}

/**
 * Lower-level archive import for maintainer workflows which must prove that
 * Microsandbox applied their requested reference. The ordinary loader above
 * intentionally preserves its existing void contract for runtime callers.
 */
export async function loadLocalMicrosandboxImageImportHandlesFromArchive(
  archivePath: string,
  tag: string,
): Promise<readonly MicrosandboxImageImportHandle[]> {
  const sdk = await createLocalMicrosandboxSdk();
  sdk.assertLocalBackend();
  const module = localMicrosandboxModule;
  if (module === undefined) {
    throw new Error("The code-owned local Microsandbox backend is unavailable.");
  }
  if (module.defaultBackendKind() !== "local") {
    throw new Error("Microsandbox backend drifted away from local.");
  }
  const handles = await module.Image.load(archivePath, { tag });
  if (handles.length === 0) {
    throw new Error(
      "Microsandbox imported no image from the docker save archive.",
    );
  }
  return Object.freeze(
    handles.map((handle) =>
      Object.freeze({
        reference: handle.reference,
        manifestDigest: handle.manifestDigest,
        architecture: handle.architecture,
        os: handle.os,
      })
    ),
  );
}

/** Guest architecture string Microsandbox inspectImage attests on this host. */
export function microsandboxHostArchitecture(): string {
  if (Deno.build.arch === "aarch64") return "arm64";
  if (Deno.build.arch === "x86_64") return "amd64";
  throw new Error(
    `Unsupported Microsandbox host architecture ${Deno.build.arch}.`,
  );
}

async function createPinnedLocalMicrosandboxSdk(): Promise<MicrosandboxSdk> {
  const codeOwnedConfigurationPath = await resolveCodeOwnedMicrosandboxConfiguration();
  const environment = readNativeEnvironment();
  assertMicrosandboxNativeEnvironment(environment, codeOwnedConfigurationPath);
  if (environment.NAPI_RS_ENFORCE_VERSION_CHECK === undefined) {
    Deno.env.set("NAPI_RS_ENFORCE_VERSION_CHECK", "1");
  }
  Deno.env.set("MSB_CONFIG_PATH", codeOwnedConfigurationPath);
  const artifacts = await resolvePinnedMicrosandboxPlatformArtifacts();
  const module = await import("npm:microsandbox@0.6.8");
  // The SDK's explicit setter has higher precedence than the user's local
  // Microsandbox config. Every non-code-owned environment override remains forbidden.
  module.setRuntimeLibkrunfwPath(artifacts.libkrunPath);
  module.setDefaultBackend("local");
  if (module.defaultBackendKind() !== "local") {
    throw new Error("Microsandbox refused the code-owned local backend.");
  }
  localMicrosandboxModule = module;
  return createNativeMicrosandboxSdk(module);
}

/** Host-local SDK wrapper over an already pinned native module. */
export function createNativeMicrosandboxSdk(
  module: MicrosandboxModule,
): MicrosandboxSdk {
  return new NativeMicrosandboxSdk(module);
}

async function resolvePinnedMicrosandboxPlatformArtifacts(): Promise<{
  readonly libkrunPath: string;
}> {
  const key = `${Deno.build.os}-${Deno.build.arch}`;
  const manifest = PINNED_MICROSANDBOX_PLATFORM_ARTIFACTS[key];
  if (manifest === undefined) {
    throw new Error("This host has no registered Microsandbox runtime artifact set.");
  }
  const require = createRequire(import.meta.url);
  let microsandboxEntry: string;
  let packageJsonPath: string;
  try {
    microsandboxEntry = require.resolve("microsandbox");
    packageJsonPath = createRequire(microsandboxEntry).resolve(
      `${manifest.packageName}/package.json`,
    );
  } catch {
    throw new Error(
      "The pinned Microsandbox platform package is not installed locally.",
    );
  }
  const packageRoot = await Deno.realPath(dirname(packageJsonPath));
  const packageMetadata = await readJsonRecord(
    packageJsonPath,
    "$microsandbox.platformPackage",
  );
  if (
    packageMetadata.name !== manifest.packageName ||
    packageMetadata.version !== "0.6.8" ||
    packageMetadata.main !== manifest.nativeFilename
  ) {
    throw new Error("The installed Microsandbox platform package identity drifted.");
  }

  const libraryDirectory = join(packageRoot, "lib");
  const matchingLibraries: string[] = [];
  try {
    for await (const entry of Deno.readDir(libraryDirectory)) {
      if (entry.isFile && manifest.libkrunPattern.test(entry.name)) {
        matchingLibraries.push(entry.name);
      }
    }
  } catch {
    throw new Error("The pinned Microsandbox libkrun directory is unavailable.");
  }
  if (
    matchingLibraries.length !== 1 ||
    matchingLibraries[0] !== manifest.libkrunFilename.slice("lib/".length)
  ) {
    throw new Error("The installed Microsandbox libkrun artifact set drifted.");
  }

  await assertPinnedRuntimeArtifact(
    packageRoot,
    manifest.nativeFilename,
    manifest.nativeSha256,
    false,
  );
  await assertPinnedRuntimeArtifact(
    packageRoot,
    manifest.executableFilename,
    manifest.executableSha256,
    true,
  );
  const libkrunPath = await assertPinnedRuntimeArtifact(
    packageRoot,
    manifest.libkrunFilename,
    manifest.libkrunSha256,
    false,
  );
  return Object.freeze({ libkrunPath });
}

async function resolveCodeOwnedMicrosandboxConfiguration(): Promise<string> {
  const configuredUrl = new URL(
    "../../../../config/microsandbox-local.json",
    import.meta.url,
  );
  const lexicalPath = fileURLToPath(configuredUrl);
  let realPath: string;
  try {
    const lexicalInfo = await Deno.lstat(lexicalPath);
    if (!lexicalInfo.isFile || lexicalInfo.isSymlink || lexicalInfo.nlink !== 1) {
      throw new Error();
    }
    realPath = await Deno.realPath(lexicalPath);
  } catch {
    throw new Error("The code-owned Microsandbox configuration is unavailable.");
  }
  const bytes = await readVerifiedRegularFile(realPath, false, 3);
  const expected = new TextEncoder().encode("{}\n");
  if (!bytesEqual(bytes, expected)) {
    throw new Error("The code-owned Microsandbox configuration drifted.");
  }
  return realPath;
}

async function assertPinnedRuntimeArtifact(
  packageRoot: string,
  relativeFilename: string,
  expectedSha256: string,
  executable: boolean,
): Promise<string> {
  const lexicalPath = join(packageRoot, relativeFilename);
  let realPath: string;
  try {
    const lexicalInfo = await Deno.lstat(lexicalPath);
    /**
     * Name the condition that refused the artifact. The message stays
     * path-free and provider-free, but a bare "unavailable" made an install
     * that never materialised indistinguishable from one whose layout the
     * guard rejects — the two need opposite fixes, and only the operator can
     * tell them apart from the message.
     */
    if (!lexicalInfo.isFile) throw new Error("not a regular file");
    if (lexicalInfo.isSymlink) throw new Error("a symbolic link");
    /**
     * Link count is deliberately NOT checked. Every package cache — Deno's,
     * pnpm's, npm's — materialises node_modules by hard-linking from a shared
     * store, so a warm cache yields nlink > 1 for a perfectly correct file;
     * that is what kept these compositions failing on CI while passing on a
     * cold cache. A hard link is the same inode, not a redirect, so it cannot
     * point the guard at other content: identity is established below by the
     * pinned SHA-256 over the bytes actually read, and containment by the
     * resolved real path. Rejecting a second link added no property those two
     * do not already give.
     */
    realPath = await Deno.realPath(lexicalPath);
  } catch (error) {
    const reason = error instanceof Deno.errors.NotFound
      ? "absent"
      : error instanceof Error && error.message !== ""
      ? error.message
      : "unreadable";
    throw new Error(
      `A pinned Microsandbox runtime artifact is unavailable: ${relativeFilename} is ${reason}.`,
    );
  }
  const relativePath = relative(packageRoot, realPath);
  if (
    relativePath === "" || relativePath === ".." ||
    relativePath.startsWith("../") || relativePath.startsWith("..\\") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("A Microsandbox runtime artifact escaped its package root.");
  }
  const bytes = await readVerifiedRegularFile(
    realPath,
    executable,
    MAXIMUM_PINNED_RUNTIME_ARTIFACT_BYTES,
  );
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) {
    throw new Error("A pinned Microsandbox runtime artifact digest drifted.");
  }
  return realPath;
}

async function readVerifiedRegularFile(
  path: string,
  executable: boolean,
  maximumBytes: number,
): Promise<Uint8Array> {
  const file = await Deno.open(path, { read: true });
  try {
    const info = await file.stat();
    // Link count is deliberately not checked here either — see the note in
    // assertPinnedRuntimeArtifact. The bytes read below are hashed against the
    // pinned digest, and the readback refuses truncation or growth, which is
    // what makes this file the expected one.
    if (
      !info.isFile || !Number.isSafeInteger(info.size) ||
      info.size < 0 || info.size > maximumBytes ||
      (executable && (info.mode === null || (info.mode & 0o111) === 0))
    ) {
      throw new Error("A pinned Microsandbox runtime artifact is not regular.");
    }
    const bytes = new Uint8Array(info.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const byteCount = await file.read(bytes.subarray(offset));
      if (byteCount === null) {
        throw new Error("A pinned Microsandbox runtime artifact was truncated.");
      }
      offset += byteCount;
    }
    const trailing = new Uint8Array(1);
    if (await file.read(trailing) !== null) {
      throw new Error("A pinned Microsandbox runtime artifact grew during readback.");
    }
    return bytes;
  } finally {
    file.close();
  }
}

async function readJsonRecord(
  path: string,
  description: string,
): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(await Deno.readTextFile(path));
    return record(value, description);
  } catch {
    throw new Error("The pinned Microsandbox package metadata is invalid.");
  }
}

export class MicrosandboxEphemeralExecutionBackend
  implements EphemeralExecutionBackend<MicrosandboxLease, string> {
  readonly #options: NormalizedBackendOptions;

  constructor(value: MicrosandboxEphemeralExecutionBackendOptions) {
    this.#options = normalizeOptions(value);
  }

  get runtime(): IsolatedCodeRuntimeAttestation {
    return this.#options.runtime;
  }

  async create(
    requestValue: EphemeralExecutionBackendRequest,
  ): Promise<MicrosandboxLease> {
    this.#assertLocalBackend();
    const request = normalizeRequest(requestValue, this.#options);
    if (
      await fingerprintResourceBytes(request.source.bytes) !== request.source.sha256
    ) {
      throw new Error("The isolated request source fingerprint is inconsistent.");
    }
    const image = await withDeadline(
      this.#inspectExactImage(),
      SDK_OPERATION_TIMEOUT_MS,
    );
    const runDigest = await sha256HexText(request.runId);
    const sandboxName = sandboxNameFor(runDigest);
    const labels = Object.freeze({
      [RUN_LABEL]: runDigest,
      [PROFILE_LABEL]: `${request.profile.id}@${request.profile.version}`,
      [PRODUCER_GENERATION_LABEL]: String(request.producerGeneration),
    });
    if (
      await withDeadline(
        this.#options.sdk.getByName(sandboxName),
        SDK_OPERATION_TIMEOUT_MS,
      ) ||
      (await withDeadline(
          this.#options.sdk.listByLabels(labels),
          SDK_OPERATION_TIMEOUT_MS,
        )).length !== 0
    ) {
      throw new Error("An environment already exists for this execution run.");
    }
    // Allocation is intentionally joined to settlement. Racing a native create
    // that cannot be cancelled would allow a late VM to appear after recovery
    // had already proved the run absent.
    const session = await this.#options.sdk.create({
      name: sandboxName,
      imageReference: image.reference,
      labels,
      cpus: this.#options.cpus,
      memoryMiB: this.#options.runtime.requestedLimits.maxMemoryBytes / MEBIBYTE,
      rootDiskMiB: this.#options.rootDiskMiB,
      workdir: this.#options.workdir,
      user: this.#options.supervisorUser,
      maxDurationSeconds: this.#options.maxDurationMs / 1_000,
      maxProcesses: this.#options.runtime.requestedLimits.maxProcesses,
      maxOpenFiles: this.#options.maxOpenFiles,
    });
    await assertSandboxConfiguration(
      await withDeadline(session.config(), SDK_OPERATION_TIMEOUT_MS),
      this.#options,
      image,
      labels,
      sandboxName,
    );
    if (!session.ownsLifecycle) {
      throw new Error("The local sandbox session does not own its lifecycle.");
    }
    await withDeadline(
      session.fileSystem().write(
        this.#options.sourcePath,
        Uint8Array.from(request.source.bytes),
      ),
      FILE_OPERATION_TIMEOUT_MS,
    );
    return {
      runId: request.runId,
      session,
      labels,
      request,
      state: "ready",
      quiesced: false,
    };
  }

  async execute(lease: MicrosandboxLease): Promise<EphemeralExecutionReport> {
    this.#assertLease(lease, ["ready"]);
    lease.state = "executing";
    const executionDeadline = performance.now() +
      this.#options.runtime.requestedLimits.maxWallTimeMs;
    let handle: MicrosandboxExecHandle;
    try {
      handle = await withDeadline(
        lease.session.executeStream({
          executable: this.#options.executable,
          args: this.#options.args,
          cwd: this.#options.workdir,
          user: this.#options.supervisorUser,
          maxProcesses: this.#options.runtime.requestedLimits.maxProcesses,
          maxOpenFiles: this.#options.maxOpenFiles,
        }),
        remainingDeadlineMs(executionDeadline),
      );
    } catch {
      lease.state = "executed";
      throw new Error("The local isolated executable could not be started.");
    }

    const supervisorStdout = new BoundedBytes(
      this.#options.runtime.requestedLimits.maxStdoutBytes,
    );
    const supervisorStderr = new BoundedBytes(
      this.#options.runtime.requestedLimits.maxStderrBytes,
    );
    let timedOut = false;
    let resourceLimited = false;
    let exitCode: number | undefined;
    try {
      const result = await receiveExecution(
        handle,
        supervisorStdout,
        supervisorStderr,
        remainingDeadlineMs(executionDeadline),
      );
      timedOut = result.timedOut;
      resourceLimited = result.resourceLimited;
      exitCode = result.exitCode;
    } finally {
      await withDeadline(
        Promise.resolve(handle[Symbol.asyncDispose]()),
        EXECUTION_DRAIN_GRACE_MS,
      ).catch(() => undefined);
    }

    let logs = Object.freeze({
      stdout: supervisorStdout.log(),
      stderr: supervisorStderr.log(),
    });
    let termination: EphemeralExecutionReport["termination"];
    if (timedOut) {
      termination = Object.freeze({
        kind: "timed-out" as const,
        exitCode: null,
        signal: null,
      });
    } else if (resourceLimited) {
      termination = Object.freeze({
        kind: "resource-limit" as const,
        exitCode: null,
        signal: null,
      });
    } else {
      termination = Object.freeze({
        kind: "exited" as const,
        exitCode: exitCode ?? 255,
        signal: null,
      });
    }

    if (termination.kind === "exited" && termination.exitCode === 0) {
      const fileSystem = lease.session.fileSystem();
      await assertExactControlFile(
        fileSystem,
        this.#options.controlFiles.quiescencePath,
        this.#options.controlFiles.quiescenceBytes,
      );
      logs = Object.freeze({
        stdout: await readExecutionLog(
          fileSystem,
          this.#options.controlFiles.stdoutPath,
          this.#options.runtime.requestedLimits.maxStdoutBytes,
        ),
        stderr: await readExecutionLog(
          fileSystem,
          this.#options.controlFiles.stderrPath,
          this.#options.runtime.requestedLimits.maxStderrBytes,
        ),
      });
      lease.quiesced = true;
    }

    const report = Object.freeze({
      runtime: this.#options.runtime,
      termination,
      logs,
    });
    lease.report = report;
    lease.state = "executed";
    return report;
  }

  async inventory(
    lease: MicrosandboxLease,
  ): Promise<readonly EphemeralOutputInventoryEntry<string>[]> {
    this.#assertLease(lease, ["executed", "inventoried"]);
    if (
      !lease.quiesced || lease.report?.termination.kind !== "exited" ||
      lease.report.termination.exitCode !== 0
    ) {
      throw new Error("Outputs cannot be inventoried before exact quiescence.");
    }
    if (lease.inventory) return lease.inventory;
    const entries = await withDeadline(
      lease.session.fileSystem().list(this.#options.outputDirectory),
      FILE_OPERATION_TIMEOUT_MS,
    );
    const byBasename = new Map<string, MicrosandboxFsEntry>();
    for (const entry of entries) {
      const basename = basenameOf(entry.path);
      if (byBasename.has(basename)) {
        throw new Error("The isolated output inventory contains duplicate names.");
      }
      byBasename.set(basename, entry);
    }
    if (byBasename.size !== this.#options.outputManifest.length) {
      throw new Error("The isolated output inventory is not exact.");
    }
    const inventory: EphemeralOutputInventoryEntry<string>[] = [];
    for (const declaration of this.#options.outputManifest) {
      const entry = byBasename.get(declaration.basename);
      if (!entry) throw new Error("A declared isolated output is missing.");
      const kind = outputKind(entry.kind);
      const path = joinGuestPath(this.#options.outputDirectory, declaration.basename);
      let claimedSha256 = "0".repeat(64);
      if (kind === "file") {
        const bytes = await readBoundedFile(
          lease.session.fileSystem(),
          path,
          this.#options.runtime.requestedLimits.maxOutputFileBytes,
        );
        claimedSha256 = await fingerprintResourceBytes(bytes);
        if (bytes.byteLength !== entry.size) {
          throw new Error("An isolated output changed during inventory.");
        }
      }
      inventory.push(Object.freeze({
        handle: path,
        basename: declaration.basename,
        kind,
        claimedByteCount: entry.size,
        claimedSha256,
      }));
    }
    lease.inventory = Object.freeze(inventory);
    lease.state = "inventoried";
    return lease.inventory;
  }

  async readOutput(
    lease: MicrosandboxLease,
    handle: string,
    maximumBytesToRead: number,
  ): Promise<Uint8Array> {
    this.#assertLease(lease, ["inventoried"]);
    if (!lease.quiesced) throw new Error("The isolated execution is not quiescent.");
    const normalizedHandle = nonEmptyText(handle, "$microsandbox.outputHandle");
    const allowed = new Set(
      this.#options.outputManifest.map((declaration) =>
        joinGuestPath(this.#options.outputDirectory, declaration.basename)
      ),
    );
    if (!allowed.has(normalizedHandle)) {
      throw new Error("The isolated output handle is not declared.");
    }
    const maximum = nonNegativeInteger(
      maximumBytesToRead,
      "$microsandbox.maximumBytesToRead",
    );
    return await readBoundedFile(lease.session.fileSystem(), normalizedHandle, maximum);
  }

  async destroy(lease: MicrosandboxLease): Promise<EphemeralExecutionDestruction> {
    this.#assertLease(lease, ["ready", "executing", "executed", "inventoried"]);
    await destroyKnownSandbox(lease.session);
    if (
      await withDeadline(
        this.#options.sdk.getByName(lease.session.name),
        SDK_OPERATION_TIMEOUT_MS,
      )
    ) {
      throw new Error("The named local isolated environment still exists.");
    }
    const remaining = await withDeadline(
      this.#options.sdk.listByLabels(lease.labels),
      SDK_OPERATION_TIMEOUT_MS,
    );
    if (remaining.length !== 0) {
      throw new Error("The local isolated environment still exists after removal.");
    }
    lease.state = "destroyed";
    return await provenDestruction(lease.runId, lease.labels);
  }

  async destroyByRunId(runIdValue: string): Promise<EphemeralExecutionDestruction> {
    this.#assertLocalBackend();
    const runId = safeId(runIdValue, "$microsandbox.runId");
    const runDigest = await sha256HexText(runId);
    const labels = Object.freeze({
      [RUN_LABEL]: runDigest,
      [PROFILE_LABEL]: `${this.#options.profile.id}@${this.#options.profile.version}`,
    });
    const name = sandboxNameFor(runDigest);
    const named = await withDeadline(
      this.#options.sdk.getByName(name),
      SDK_OPERATION_TIMEOUT_MS,
    );
    if (named) {
      assertRunOwnership(named.config(), labels, name);
      await destroyKnownSandbox(named);
    }
    const sandboxes = await withDeadline(
      this.#options.sdk.listByLabels(labels),
      SDK_OPERATION_TIMEOUT_MS,
    );
    for (const sandbox of sandboxes) {
      if (sandbox.name !== name) {
        throw new Error("A foreign sandbox carries the execution run labels.");
      }
      assertRunOwnership(sandbox.config(), labels, name);
      await destroyKnownSandbox(sandbox);
    }
    if (
      await withDeadline(
        this.#options.sdk.getByName(name),
        SDK_OPERATION_TIMEOUT_MS,
      )
    ) {
      throw new Error("Run-scoped named sandbox cleanup is incomplete.");
    }
    if (
      (await withDeadline(
        this.#options.sdk.listByLabels(labels),
        SDK_OPERATION_TIMEOUT_MS,
      )).length !== 0
    ) {
      throw new Error("Run-scoped local sandbox cleanup is incomplete.");
    }
    return await provenDestruction(runId, labels);
  }

  async #inspectExactImage(): Promise<MicrosandboxImageInspection> {
    const image = await this.#options.sdk.inspectImage(this.#options.imageReference);
    return assertExactMicrosandboxImageInspection(image, {
      reference: this.#options.imageReference,
      manifestDigest: `sha256:${this.#options.imageDigest}`,
      os: "linux",
      architecture: microsandboxHostArchitecture(),
      user: this.#options.expectedImageUser,
      entrypoint: this.#options.expectedImageEntrypoint,
    });
  }

  #assertLocalBackend(): void {
    try {
      this.#options.sdk.assertLocalBackend();
    } catch {
      throw new Error("The code-owned local Microsandbox backend is unavailable.");
    }
  }

  #assertLease(lease: MicrosandboxLease, allowed: readonly LeaseState[]): void {
    if (!allowed.includes(lease.state)) {
      throw new Error("The local isolated execution lease is in an invalid state.");
    }
  }
}

function assertRunOwnership(
  value: unknown,
  labels: Readonly<Record<string, string>>,
  expectedName: string,
): void {
  const root = record(value, "$microsandbox.config");
  const observedLabels = record(root.labels, "$microsandbox.config.labels");
  if (root.name !== expectedName) {
    throw new Error("The named sandbox is not owned by this execution run.");
  }
  for (const [key, expected] of Object.entries(labels)) {
    if (observedLabels[key] !== expected) {
      throw new Error("Microsandbox run label ownership drifted.");
    }
  }
}

class NativeMicrosandboxSdk implements MicrosandboxSdk {
  readonly #module: MicrosandboxModule;

  constructor(module: MicrosandboxModule) {
    this.#module = module;
  }

  assertLocalBackend(): void {
    if (this.#module.defaultBackendKind() !== "local") {
      throw new Error("Microsandbox backend drifted away from local.");
    }
  }

  async removeExactCachedImage(reference: string): Promise<void> {
    this.assertLocalBackend();
    await this.#module.Image.remove(reference, { force: false });
  }

  isImageNotFound(error: unknown): boolean {
    return error instanceof this.#module.ImageNotFoundError ||
      (typeof error === "object" && error !== null &&
        "code" in error &&
        (error as { readonly code: unknown }).code === "imageNotFound");
  }

  async inspectImage(reference: string): Promise<MicrosandboxImageInspection> {
    this.assertLocalBackend();
    const [handle, detail] = await Promise.all([
      this.#module.Image.get(reference),
      this.#module.Image.inspect(reference),
    ]);
    if (!handle.manifestDigest || !handle.architecture || !handle.os) {
      throw new Error("The cached Microsandbox image is not fully identified.");
    }
    return Object.freeze({
      reference: handle.reference,
      manifestDigest: handle.manifestDigest,
      architecture: handle.architecture,
      os: handle.os,
      user: detail.config?.user ?? null,
      entrypoint: detail.config?.entrypoint === null ||
          detail.config?.entrypoint === undefined
        ? null
        : Object.freeze([...detail.config.entrypoint]),
      command: detail.config?.cmd === null || detail.config?.cmd === undefined
        ? null
        : Object.freeze([...detail.config.cmd]),
      environment: normalizeImageEnvironment(detail.config?.env),
      labels: normalizeImageLabels(detail.config?.labels),
    });
  }

  async create(request: MicrosandboxCreateRequest): Promise<MicrosandboxSession> {
    this.assertLocalBackend();
    const builder = this.#module.Sandbox.builder(request.name)
      .image(request.imageReference)
      .cpus(request.cpus)
      .maxCpus(request.cpus)
      .memory(request.memoryMiB)
      .maxMemory(request.memoryMiB)
      .rootDisk((disk) => disk.tmpfs().size(request.rootDiskMiB))
      .quietLogs()
      .detached(false)
      // Attached runs must survive a server crash so the run-scoped recovery
      // path can inspect and reap them before authorizing any redispatch.
      .ephemeral(false)
      .workdir(request.workdir)
      .user(request.user)
      .security("restricted")
      .disableNetwork()
      .pullPolicy("never")
      .labels({ ...request.labels })
      .rlimit("nproc", request.maxProcesses)
      .rlimit("nofile", request.maxOpenFiles)
      .maxDuration(request.maxDurationSeconds);
    return new NativeMicrosandboxSession(this.#module, await builder.create());
  }

  async listByLabels(
    labels: Readonly<Record<string, string>>,
  ): Promise<readonly MicrosandboxKnownSandbox[]> {
    this.assertLocalBackend();
    const result: MicrosandboxKnownSandbox[] = [];
    const seenCursors = new Set<string>();
    let pageCount = 0;
    let cursor: string | undefined;
    do {
      if (++pageCount > MAXIMUM_SANDBOX_LIST_PAGES) {
        throw new Error("Microsandbox sandbox pagination exceeded its page bound.");
      }
      const page = await this.#module.Sandbox.listWith((builder) => {
        builder.limit(100).labels({ ...labels });
        if (cursor !== undefined) builder.cursor(cursor);
        return builder;
      });
      if (
        result.length + page.sandboxes.length > MAXIMUM_SANDBOX_LIST_MATCHES
      ) {
        throw new Error("Microsandbox sandbox pagination exceeded its result bound.");
      }
      result.push(...page.sandboxes.map((handle) => new NativeKnownSandbox(handle)));
      const nextCursor = page.nextCursor;
      if (nextCursor !== undefined) {
        if (nextCursor.trim() === "" || !seenCursors.add(nextCursor)) {
          throw new Error("Microsandbox sandbox pagination cursor is invalid.");
        }
      }
      cursor = nextCursor;
    } while (cursor !== undefined);
    return Object.freeze(result);
  }

  async getByName(name: string): Promise<MicrosandboxKnownSandbox | undefined> {
    this.assertLocalBackend();
    try {
      return new NativeKnownSandbox(await this.#module.Sandbox.get(name));
    } catch (error) {
      if (error instanceof this.#module.SandboxNotFoundError) return undefined;
      throw error;
    }
  }
}

class NativeMicrosandboxSession implements MicrosandboxSession {
  readonly #module: MicrosandboxModule;
  readonly #sandbox: NativeSandbox;
  readonly name: string;
  readonly ownsLifecycle: boolean;

  constructor(module: MicrosandboxModule, sandbox: NativeSandbox) {
    this.#module = module;
    this.#sandbox = sandbox;
    this.name = sandbox.name;
    this.ownsLifecycle = sandbox.ownsLifecycle;
  }

  config(): Promise<unknown> {
    return this.#sandbox.config();
  }

  fileSystem(): MicrosandboxFileSystem {
    return new NativeMicrosandboxFileSystem(this.#sandbox.fs());
  }

  async executeStream(value: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly user: string;
    readonly maxProcesses: number;
    readonly maxOpenFiles: number;
  }): Promise<MicrosandboxExecHandle> {
    const handle = await this.#sandbox.execStreamWith(
      value.executable,
      (builder) =>
        builder.args([...value.args]).cwd(value.cwd).user(value.user).stdinNull()
          .rlimit("nproc", value.maxProcesses)
          .rlimit("nofile", value.maxOpenFiles),
    );
    return new NativeMicrosandboxExecHandle(handle);
  }

  killWithTimeout(timeoutMs: number): Promise<void> {
    return this.#sandbox.killWithTimeout(timeoutMs);
  }

  async waitUntilStopped(): Promise<void> {
    await this.#sandbox.waitUntilStopped();
  }

  remove(): Promise<void> {
    return this.#moduleRemove();
  }

  async #moduleRemove(): Promise<void> {
    await withDeadline(
      Promise.resolve(this.#sandbox[Symbol.asyncDispose]()),
      DESTRUCTION_TIMEOUT_MS,
    ).catch(() => undefined);
    await this.#module.Sandbox.remove(this.name);
  }
}

class NativeKnownSandbox implements MicrosandboxKnownSandbox {
  readonly #handle: NativeSandboxHandle;
  readonly name: string;

  constructor(handle: NativeSandboxHandle) {
    this.#handle = handle;
    this.name = handle.name;
  }

  config(): unknown {
    return this.#handle.config();
  }

  killWithTimeout(timeoutMs: number): Promise<void> {
    return this.#handle.killWithTimeout(timeoutMs);
  }

  async waitUntilStopped(): Promise<void> {
    await this.#handle.waitUntilStopped();
  }

  remove(): Promise<void> {
    return this.#handle.remove();
  }
}

class NativeMicrosandboxExecHandle implements MicrosandboxExecHandle {
  readonly #handle: NativeExecHandle;

  constructor(handle: NativeExecHandle) {
    this.#handle = handle;
  }

  receive(): Promise<MicrosandboxExecEvent | null> {
    return this.#handle.recv();
  }

  kill(): Promise<void> {
    return this.#handle.kill();
  }

  wait(): Promise<{ readonly code: number; readonly success: boolean }> {
    return this.#handle.wait();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return Promise.resolve(this.#handle[Symbol.asyncDispose]());
  }
}

class NativeMicrosandboxFileSystem implements MicrosandboxFileSystem {
  readonly #fileSystem: NativeFileSystem;

  constructor(fileSystem: NativeFileSystem) {
    this.#fileSystem = fileSystem;
  }

  write(path: string, bytes: Uint8Array): Promise<void> {
    return this.#fileSystem.write(path, Uint8Array.from(bytes));
  }

  async list(path: string): Promise<readonly MicrosandboxFsEntry[]> {
    return Object.freeze(
      (await this.#fileSystem.list(path)).map((entry) =>
        Object.freeze({
          path: entry.path,
          kind: entry.kind,
          size: entry.size,
          mode: entry.mode,
        })
      ),
    );
  }

  async *readChunks(path: string): AsyncIterable<Uint8Array> {
    const stream = await this.#fileSystem.readStream(path);
    try {
      for await (const chunk of stream) yield Uint8Array.from(chunk);
    } finally {
      await withDeadline(
        Promise.resolve(stream[Symbol.asyncDispose]()),
        FILE_OPERATION_TIMEOUT_MS,
      ).catch(() => undefined);
    }
  }
}

class BoundedBytes {
  readonly #maximum: number;
  readonly #chunks: Uint8Array[] = [];
  #byteCount = 0;
  #truncated = false;

  constructor(maximum: number) {
    this.#maximum = maximum;
  }

  observe(bytes: Uint8Array): void {
    const remaining = this.#maximum - this.#byteCount;
    if (bytes.byteLength > remaining) this.#truncated = true;
    if (remaining <= 0) return;
    const accepted = bytes.subarray(0, Math.min(remaining, bytes.byteLength));
    this.#chunks.push(Uint8Array.from(accepted));
    this.#byteCount += accepted.byteLength;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  log(): EphemeralExecutionLog {
    const result = new Uint8Array(this.#byteCount);
    let offset = 0;
    for (const chunk of this.#chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return Object.freeze({ bytes: result, truncated: this.#truncated });
  }
}

function normalizeOptions(
  value: MicrosandboxEphemeralExecutionBackendOptions,
): NormalizedBackendOptions {
  const root = exactRecord(
    {
      ...value,
      expectedImageEntrypoint: value.expectedImageEntrypoint ?? [
        value.executable,
        ...value.args,
      ],
      supervisorUser: value.supervisorUser ?? value.expectedImageUser,
    },
    [
      "sdk",
      "imageReference",
      "expectedImageUser",
      "expectedImageEntrypoint",
      "executable",
      "args",
      "workdir",
      "sourcePath",
      "outputDirectory",
      "controlFiles",
      "profile",
      "policy",
      "runtime",
      "outputManifest",
      "cpus",
      "rootDiskMiB",
      "maxDurationMs",
      "maxOpenFiles",
      "supervisorUser",
    ],
    "$microsandboxBackend",
  );
  const imageReference = pinnedOciImageReference(
    root.imageReference,
    "$microsandboxBackend.imageReference",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    root.runtime,
    "$microsandboxBackend.runtime",
  );
  if (runtime.isolationClass !== MICROSANDBOX_LOCAL_ISOLATION_CLASS) {
    throw new TypeError("The Microsandbox runtime isolation class is not registered.");
  }
  const imageDigest = imageReference.slice(imageReference.lastIndexOf("@sha256:") + 8);
  if (runtime.imageDigest.digest !== imageDigest) {
    throw new TypeError("The Microsandbox runtime names a different OCI image.");
  }
  if (runtime.requestedLimits.maxMemoryBytes % MEBIBYTE !== 0) {
    throw new TypeError("Microsandbox memory must be a whole MiB.");
  }
  if (
    positiveInteger(root.maxDurationMs, "$microsandboxBackend.maxDurationMs") %
        1_000 !== 0
  ) {
    throw new TypeError("Microsandbox max duration must be a whole second.");
  }
  const profileRoot = exactRecord(
    root.profile,
    ["id", "version"],
    "$microsandboxBackend.profile",
  );
  const profile = validateIsolatedCodeProfileRef(profileRoot);
  const control = exactRecord(root.controlFiles, [
    "quiescencePath",
    "quiescenceBytes",
    "stdoutPath",
    "stderrPath",
  ], "$microsandboxBackend.controlFiles");
  if (!(control.quiescenceBytes instanceof Uint8Array)) {
    throw new TypeError("The quiescence proof must be exact bytes.");
  }
  const args = stringArray(root.args, "$microsandboxBackend.args");
  const rawExpectedImageEntrypoint = stringArray(
    root.expectedImageEntrypoint,
    "$microsandboxBackend.expectedImageEntrypoint",
  );
  if (rawExpectedImageEntrypoint.length === 0) {
    throw new TypeError("The expected image entrypoint must not be empty.");
  }
  const expectedImageEntrypoint = Object.freeze([
    absoluteGuestPath(
      rawExpectedImageEntrypoint[0]!,
      "$microsandboxBackend.expectedImageEntrypoint.0",
    ),
    ...rawExpectedImageEntrypoint.slice(1),
  ]);
  return Object.freeze({
    sdk: requireSdk(root.sdk),
    imageReference,
    imageDigest,
    expectedImageUser: nonEmptyText(
      root.expectedImageUser,
      "$microsandboxBackend.expectedImageUser",
    ),
    expectedImageEntrypoint,
    executable: absoluteGuestPath(root.executable, "$microsandboxBackend.executable"),
    args,
    workdir: absoluteGuestPath(root.workdir, "$microsandboxBackend.workdir"),
    sourcePath: absoluteGuestPath(root.sourcePath, "$microsandboxBackend.sourcePath"),
    outputDirectory: absoluteGuestPath(
      root.outputDirectory,
      "$microsandboxBackend.outputDirectory",
    ),
    controlFiles: Object.freeze({
      quiescencePath: absoluteGuestPath(
        control.quiescencePath,
        "$microsandboxBackend.controlFiles.quiescencePath",
      ),
      quiescenceBytes: Uint8Array.from(control.quiescenceBytes),
      stdoutPath: absoluteGuestPath(
        control.stdoutPath,
        "$microsandboxBackend.controlFiles.stdoutPath",
      ),
      stderrPath: absoluteGuestPath(
        control.stderrPath,
        "$microsandboxBackend.controlFiles.stderrPath",
      ),
    }),
    profile,
    policy: validateIsolatedCodePolicyRef(root.policy, "$microsandboxBackend.policy"),
    runtime,
    outputManifest: validateIsolatedCodeOutputManifest(root.outputManifest),
    cpus: positiveInteger(root.cpus, "$microsandboxBackend.cpus"),
    rootDiskMiB: positiveInteger(
      root.rootDiskMiB,
      "$microsandboxBackend.rootDiskMiB",
    ),
    maxDurationMs: positiveInteger(
      root.maxDurationMs,
      "$microsandboxBackend.maxDurationMs",
    ),
    maxOpenFiles: positiveInteger(
      root.maxOpenFiles,
      "$microsandboxBackend.maxOpenFiles",
    ),
    supervisorUser: nonEmptyText(
      root.supervisorUser ?? root.expectedImageUser,
      "$microsandboxBackend.supervisorUser",
    ),
  });
}

function normalizeRequest(
  value: EphemeralExecutionBackendRequest,
  options: NormalizedBackendOptions,
): EphemeralExecutionBackendRequest {
  const root = exactRecord(value, [
    "runId",
    "producerGeneration",
    "profile",
    "source",
    "policy",
    "outputs",
    "runtime",
  ], "$microsandbox.request");
  const runId = safeId(root.runId, "$microsandbox.request.runId");
  const producerGeneration = validateIsolatedOutputProducerGeneration(
    root.producerGeneration,
    "$microsandbox.request.producerGeneration",
  );
  const profile = validateIsolatedCodeProfileRef(root.profile);
  const policy = validateIsolatedCodePolicyRef(root.policy);
  const runtime = validateIsolatedCodeRuntimeAttestation(root.runtime);
  const outputs = validateIsolatedCodeOutputManifest(root.outputs);
  const source = exactRecord(
    root.source,
    ["bytes", "sha256"],
    "$microsandbox.request.source",
  );
  if (!(source.bytes instanceof Uint8Array)) {
    throw new TypeError("The Microsandbox source must be Uint8Array bytes.");
  }
  const sha256 = nonEmptyText(source.sha256, "$microsandbox.request.source.sha256");
  if (
    !isolatedCodeRefsEqual(profile, options.profile) ||
    !isolatedCodeRefsEqual(policy, options.policy) ||
    !runtimeAttestationsEqual(runtime, options.runtime) ||
    !isolatedCodeOutputManifestsEqual(outputs, options.outputManifest)
  ) {
    throw new Error("The isolated request does not match this local backend.");
  }
  return Object.freeze({
    runId,
    producerGeneration,
    profile,
    source: Object.freeze({ bytes: Uint8Array.from(source.bytes), sha256 }),
    policy,
    outputs,
    runtime,
  });
}

async function receiveExecution(
  handle: MicrosandboxExecHandle,
  stdout: BoundedBytes,
  stderr: BoundedBytes,
  maximumWallTimeMs: number,
): Promise<{
  readonly timedOut: boolean;
  readonly resourceLimited: boolean;
  readonly exitCode?: number;
}> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let killRequested = false;
  const requestKill = async (): Promise<void> => {
    if (killRequested) return;
    killRequested = true;
    await withDeadline(handle.kill(), EXECUTION_DRAIN_GRACE_MS).catch(() => undefined);
  };
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, maximumWallTimeMs);
  });
  const drain = (async () => {
    let exitCode: number | undefined;
    while (true) {
      const event = await handle.receive();
      if (event === null) break;
      if (
        event === undefined || typeof event !== "object" ||
        !["started", "stdout", "stderr", "exited"].includes(event.kind)
      ) {
        throw new Error("Microsandbox emitted an invalid execution event.");
      }
      if (event.kind === "stdout") stdout.observe(event.data);
      if (event.kind === "stderr") stderr.observe(event.data);
      if (event.kind === "exited") exitCode = event.code;
      if (stdout.truncated || stderr.truncated) {
        await requestKill();
      }
    }
    if (exitCode === undefined) {
      throw new Error("Microsandbox ended without an exit event.");
    }
    return exitCode;
  })();
  const first = await Promise.race([
    drain.then((exitCode) => ({ kind: "drained" as const, exitCode })),
    timeout.then(() => ({ kind: "timeout" as const })),
  ]);
  if (timer !== undefined) clearTimeout(timer);
  if (first.kind === "timeout") {
    await requestKill();
    await withDeadline(drain, EXECUTION_DRAIN_GRACE_MS).catch(() => undefined);
    return { timedOut: true, resourceLimited: false };
  }
  return {
    timedOut,
    resourceLimited: stdout.truncated || stderr.truncated,
    exitCode: first.exitCode,
  };
}

async function assertExactControlFile(
  fileSystem: MicrosandboxFileSystem,
  path: string,
  expected: Uint8Array,
): Promise<void> {
  const entry = await exactListedEntry(fileSystem, path);
  if (
    entry.kind !== "file" || entry.size !== expected.byteLength ||
    (entry.mode & 0o777) !== 0o400
  ) {
    throw new Error("The execution quiescence proof is not an exact regular file.");
  }
  const observed = await readBoundedFile(fileSystem, path, expected.byteLength);
  if (!bytesEqual(observed, expected)) {
    throw new Error("The execution quiescence proof is not exact.");
  }
}

async function readExecutionLog(
  fileSystem: MicrosandboxFileSystem,
  path: string,
  maximum: number,
): Promise<EphemeralExecutionLog> {
  const entry = await exactListedEntry(fileSystem, path);
  if (entry.kind !== "file" || entry.size > maximum || (entry.mode & 0o777) !== 0o400) {
    throw new Error("An isolated log capture is invalid.");
  }
  return Object.freeze({
    bytes: await readBoundedFile(fileSystem, path, maximum),
    truncated: false,
  });
}

async function exactListedEntry(
  fileSystem: MicrosandboxFileSystem,
  path: string,
): Promise<MicrosandboxFsEntry> {
  const parent = parentGuestPath(path);
  const basename = basenameOf(path);
  const matches = (await fileSystem.list(parent)).filter((entry) =>
    basenameOf(entry.path) === basename
  );
  if (matches.length !== 1) throw new Error("A control file is missing or ambiguous.");
  return matches[0]!;
}

async function readBoundedFile(
  fileSystem: MicrosandboxFileSystem,
  path: string,
  maximum: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error("The isolated file read bound is invalid.");
  }
  return await withDeadline(
    (async () => {
      const chunks: Uint8Array[] = [];
      let byteCount = 0;
      for await (const chunkValue of fileSystem.readChunks(path)) {
        let chunk: Uint8Array;
        try {
          chunk = copyObservedUint8Array(
            chunkValue,
            "$microsandbox.fileChunk",
            maximum - byteCount,
          );
        } catch {
          throw new Error("The isolated file exceeds its read bound.");
        }
        byteCount += chunk.byteLength;
        chunks.push(chunk);
      }
      const result = new Uint8Array(byteCount);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    })(),
    FILE_OPERATION_TIMEOUT_MS,
  );
}

async function destroyKnownSandbox(
  sandbox: MicrosandboxKnownSandbox | MicrosandboxSession,
): Promise<void> {
  await withDeadline(
    sandbox.killWithTimeout(DESTRUCTION_TIMEOUT_MS),
    DESTRUCTION_TIMEOUT_MS,
  ).catch(() => undefined);
  await withDeadline(sandbox.waitUntilStopped(), DESTRUCTION_TIMEOUT_MS);
  await withDeadline(sandbox.remove(), DESTRUCTION_TIMEOUT_MS);
}

async function provenDestruction(
  runId: string,
  labels: Readonly<Record<string, string>>,
): Promise<EphemeralExecutionDestruction> {
  return Object.freeze({
    status: "proven" as const,
    runId,
    proofFingerprint: await sha256Fingerprint({
      schemaVersion: "microsandbox-local-destruction-proof/1.0",
      runId,
      labels,
      observedRemainingSandboxes: 0,
    }),
  });
}

function assertSandboxConfiguration(
  value: unknown,
  options: NormalizedBackendOptions,
  imageInspection: MicrosandboxImageInspection,
  labels: Readonly<Record<string, string>>,
  expectedName: string,
): void {
  const root = record(value, "$microsandbox.config");
  const image = record(root.image, "$microsandbox.config.image");
  const oci = record(image.Oci, "$microsandbox.config.image.Oci");
  const rootDisk = record(oci.rootDisk, "$microsandbox.config.image.Oci.rootDisk");
  const resources = record(root.resources, "$microsandbox.config.resources");
  const runtime = record(root.runtime, "$microsandbox.config.runtime");
  const network = record(root.network, "$microsandbox.config.network");
  const lifecycle = record(root.lifecycle, "$microsandbox.config.lifecycle");
  const observedLabels = record(root.labels, "$microsandbox.config.labels");
  if (
    root.name !== expectedName ||
    oci.reference !== options.imageReference ||
    rootDisk.kind !== "tmpfs" || rootDisk.sizeMib !== options.rootDiskMiB ||
    root.manifestDigest !== `sha256:${options.imageDigest}` ||
    resources.cpus !== options.cpus || resources.maxCpus !== options.cpus ||
    resources.memoryMib !== options.runtime.requestedLimits.maxMemoryBytes / MEBIBYTE ||
    resources.maxMemoryMib !==
      options.runtime.requestedLimits.maxMemoryBytes / MEBIBYTE ||
    runtime.workdir !== options.workdir || runtime.user !== options.supervisorUser ||
    !unknownStringArrayEquals(
      runtime.entrypoint,
      options.expectedImageEntrypoint,
    ) ||
    !unknownNullableStringArrayEquals(runtime.cmd, imageInspection.command) ||
    runtime.shell !== null ||
    runtime.hostname !== null || runtime.logLevel !== null ||
    runtime.metricsSampleIntervalMs !== 1_000 ||
    runtime.disableMetricsSample !== false ||
    root.pullPolicy !== "Never" || root.securityProfile !== "restricted" ||
    network.enabled !== false || lifecycle.ephemeral !== false ||
    lifecycle.maxDurationSecs !== options.maxDurationMs / 1_000 ||
    lifecycle.idleTimeoutSecs !== null || root.init !== null
  ) {
    throw new Error("Microsandbox post-create configuration drifted.");
  }
  assertExactRecord(runtime.scripts, {}, "$microsandbox.config.runtime.scripts");
  assertEnvironmentExact(
    root.env,
    imageInspection.environment,
    "$microsandbox.config.env",
  );
  // OCI labels are already committed by the exact manifest digest, but SDK
  // 0.6.8 does not expose them consistently through Image.inspect. Require
  // only the two run-owned labels here; extra labels remain image-owned.
  for (const [key, expected] of Object.entries(labels)) {
    if (observedLabels[key] !== expected) {
      throw new Error("Microsandbox run labels drifted.");
    }
  }
  assertEmptyArray(root.patches, "$microsandbox.config.patches");
  assertExactRlimits(root.rlimits, options);
  assertEmptyArray(network.ports, "$microsandbox.config.network.ports");
  assertExactRecord(network.interface, {}, "$microsandbox.config.network.interface");
  const policy = record(network.policy, "$microsandbox.config.network.policy");
  if (policy.defaultEgress !== "deny" || policy.defaultIngress !== "deny") {
    throw new Error("Microsandbox network policy is not deny-all.");
  }
  assertEmptyArray(policy.rules, "$microsandbox.config.network.policy.rules");
  const dns = record(network.dns, "$microsandbox.config.network.dns");
  if (dns.rebindProtection !== true || dns.queryTimeoutMs !== 5_000) {
    throw new Error("Microsandbox DNS configuration drifted.");
  }
  assertEmptyArray(dns.nameservers, "$microsandbox.config.network.dns.nameservers");
  const tls = record(network.tls, "$microsandbox.config.network.tls");
  if (
    tls.enabled !== false || tls.verifyUpstream !== true ||
    tls.blockQuicOnIntercept !== true
  ) {
    throw new Error("Microsandbox TLS interception configuration drifted.");
  }
  assertNumberArrayExact(
    tls.interceptedPorts,
    [443],
    "$microsandbox.config.network.tls.interceptedPorts",
  );
  for (
    const key of [
      "bypass",
      "upstreamCaCert",
      "scopedUpstreamCaCert",
      "scopedVerifyUpstream",
    ]
  ) {
    assertEmptyArray(tls[key], `$microsandbox.config.network.tls.${key}`);
  }
  const interceptCa = record(
    tls.interceptCa,
    "$microsandbox.config.network.tls.interceptCa",
  );
  if (interceptCa.certPath !== null || interceptCa.keyPath !== null) {
    throw new Error("Microsandbox TLS interception CA drifted.");
  }
  const cache = record(tls.cache, "$microsandbox.config.network.tls.cache");
  if (cache.capacity !== 1_000 || cache.validityHours !== 24) {
    throw new Error("Microsandbox TLS cache configuration drifted.");
  }
  const secrets = record(network.secrets, "$microsandbox.config.network.secrets");
  if (secrets.onViolation !== "block-and-log") {
    throw new Error("Microsandbox secret violation policy drifted.");
  }
  assertEmptyArray(secrets.secrets, "$microsandbox.config.network.secrets.secrets");
  if (network.maxConnections !== null || network.trustHostCas !== false) {
    throw new Error("Microsandbox host-network trust drifted.");
  }
  const mounts = array(root.mounts, "$microsandbox.config.mounts");
  if (mounts.length !== 1) {
    throw new Error("Microsandbox must have exactly one image-independent mount.");
  }
  const mount = record(mounts[0], "$microsandbox.config.mounts[0]");
  const mountOptions = record(
    mount.options,
    "$microsandbox.config.mounts[0].options",
  );
  if (
    mount.type !== "Tmpfs" || mount.guest !== "/tmp" ||
    mount.sizeMib !== expectedDefaultTmpfsMiB(options) ||
    mountOptions.readonly !== false || mountOptions.noexec !== false ||
    mountOptions.nosuid !== false || mountOptions.nodev !== false
  ) {
    throw new Error("Microsandbox has an unsupported mount.");
  }
}

function readNativeEnvironment(): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const name of [...FORBIDDEN_NATIVE_OVERRIDES, "NAPI_RS_ENFORCE_VERSION_CHECK"]) {
    result[name] = Deno.env.get(name);
  }
  return result;
}

function requireSdk(value: unknown): MicrosandboxSdk {
  if (value === null || typeof value !== "object") {
    throw new TypeError("$microsandboxBackend.sdk must be an object.");
  }
  const candidate = value as Partial<MicrosandboxSdk>;
  if (
    typeof candidate.assertLocalBackend !== "function" ||
    typeof candidate.inspectImage !== "function" ||
    typeof candidate.removeExactCachedImage !== "function" ||
    typeof candidate.isImageNotFound !== "function" ||
    typeof candidate.create !== "function" ||
    typeof candidate.listByLabels !== "function" ||
    typeof candidate.getByName !== "function"
  ) {
    throw new TypeError("$microsandboxBackend.sdk is incomplete.");
  }
  return candidate as MicrosandboxSdk;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return value as number;
}

function normalizeImageLabels(
  value: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, string>> {
  if (value === null || value === undefined) return Object.freeze({});
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    result[key] = nonEmptyText(raw, `$microsandbox.image.labels.${key}`);
  }
  return Object.freeze(result);
}

function normalizeImageEnvironment(
  value: readonly string[] | null | undefined,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [index, raw] of (value ?? []).entries()) {
    const entry = nonEmptyText(raw, `$microsandbox.image.env[${index}]`);
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new Error("The OCI image environment is not canonical.");
    }
    const key = entry.slice(0, separator);
    if (Object.hasOwn(result, key)) {
      throw new Error("The OCI image environment contains duplicate keys.");
    }
    result[key] = entry.slice(separator + 1);
  }
  return Object.freeze(result);
}

function assertExactRecord(
  value: unknown,
  expected: Readonly<Record<string, unknown>>,
  path: string,
): void {
  const observed = record(value, path);
  const observedKeys = Object.keys(observed).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    observedKeys.length !== expectedKeys.length ||
    observedKeys.some((key, index) => key !== expectedKeys[index]) ||
    expectedKeys.some((key) => observed[key] !== expected[key])
  ) {
    throw new Error(`${path} is not exact.`);
  }
}

function assertEnvironmentExact(
  value: unknown,
  expected: Readonly<Record<string, string>>,
  path: string,
): void {
  if (!Array.isArray(value)) throw new Error(`${path} is not exact.`);
  const observed: Record<string, string> = {};
  for (const [index, raw] of value.entries()) {
    const entry = record(raw, `${path}[${index}]`);
    const key = nonEmptyText(entry.key, `${path}[${index}].key`);
    const environmentValue = typeof entry.value === "string" ? entry.value : undefined;
    if (environmentValue === undefined || Object.hasOwn(observed, key)) {
      throw new Error(`${path} is not exact.`);
    }
    observed[key] = environmentValue;
  }
  const observedKeys = Object.keys(observed).sort();
  const expectedKeys = Object.keys(expected).sort();
  if (
    observedKeys.length !== expectedKeys.length ||
    observedKeys.some((key, index) => key !== expectedKeys[index]) ||
    expectedKeys.some((key) => observed[key] !== expected[key])
  ) {
    throw new Error(`${path} is not exact.`);
  }
}

function assertNumberArrayExact(
  value: unknown,
  expected: readonly number[],
  path: string,
): void {
  if (
    !Array.isArray(value) || value.length !== expected.length ||
    value.some((entry, index) => entry !== expected[index])
  ) {
    throw new Error(`${path} is not exact.`);
  }
}

function assertExactRlimits(
  value: unknown,
  options: NormalizedBackendOptions,
): void {
  const entries = array(value, "$microsandbox.config.rlimits");
  if (entries.length !== 2) {
    throw new Error("Microsandbox rlimits are not exact.");
  }
  const expected = new Map([
    ["Nproc", options.runtime.requestedLimits.maxProcesses],
    ["Nofile", options.maxOpenFiles],
  ]);
  for (const [index, raw] of entries.entries()) {
    const entry = record(raw, `$microsandbox.config.rlimits[${index}]`);
    const resource = nonEmptyText(
      entry.resource,
      `$microsandbox.config.rlimits[${index}].resource`,
    );
    const limit = expected.get(resource);
    if (limit === undefined || entry.soft !== limit || entry.hard !== limit) {
      throw new Error("Microsandbox rlimits are not exact.");
    }
    expected.delete(resource);
  }
  if (expected.size !== 0) throw new Error("Microsandbox rlimits are incomplete.");
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return Object.freeze(value.map((entry, index) => {
    const text = nonEmptyText(entry, `${path}[${index}]`);
    if (text.includes("\0")) throw new TypeError(`${path}[${index}] contains NUL.`);
    return text;
  }));
}

function absoluteGuestPath(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (
    !text.startsWith("/") || text.includes("\\") || text.includes("\0") ||
    text.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError(`${path} must be a canonical absolute guest path.`);
  }
  return text.length > 1 && text.endsWith("/") ? text.slice(0, -1) : text;
}

function joinGuestPath(directory: string, basename: string): string {
  return `${directory}/${basename}`;
}

function parentGuestPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function outputKind(kind: MicrosandboxFsEntry["kind"]): EphemeralOutputKind {
  if (kind === "file" || kind === "directory" || kind === "symlink") return kind;
  return "other";
}

function sandboxNameFor(runDigest: string): string {
  const name = `casys-${runDigest.slice(0, 48)}`;
  if (new TextEncoder().encode(name).byteLength > MAXIMUM_SANDBOX_NAME_BYTES) {
    throw new Error("The derived sandbox name is too long.");
  }
  return name;
}

async function sha256HexText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  )
    .join("");
}

function stringArraysEqual(
  left: readonly string[] | null,
  right: readonly string[],
): boolean {
  return left !== null && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function unknownStringArrayEquals(
  left: unknown,
  right: readonly string[],
): boolean {
  return Array.isArray(left) && left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function unknownNullableStringArrayEquals(
  left: unknown,
  right: readonly string[] | null,
): boolean {
  if (right === null) return left === null;
  return unknownStringArrayEquals(left, right);
}

function expectedDefaultTmpfsMiB(options: NormalizedBackendOptions): number {
  const memoryMiB = options.runtime.requestedLimits.maxMemoryBytes / MEBIBYTE;
  return Math.min(512, Math.max(1, Math.floor(memoryMiB / 4)));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function assertEmptyArray(value: unknown, path: string): void {
  if (!Array.isArray(value) || value.length !== 0) {
    throw new Error(`${path} must be empty.`);
  }
}

async function withDeadline<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Operation deadline exceeded.")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function remainingDeadlineMs(deadline: number): number {
  return Math.max(1, Math.floor(deadline - performance.now()));
}
