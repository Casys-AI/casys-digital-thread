/**
 * Trusted whole-App viewer materialization.
 *
 * Consumes an explicit in-memory catalogue, publishes immutable CAS objects,
 * and atomically replaces the registry document under an exclusive sibling
 * lock. Callers may require the exact previously observed raw registry
 * identity, or its explicit absence. The Workbench remains a read-only
 * registry/CAS reader.
 */

import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../shared/wal/durable-attempt-file-writes.ts";
import {
  FileThreadViewerAppRegistry,
  THREAD_VIEWER_APP_REGISTRY_SCHEMA,
  THREAD_VIEWER_APP_RESOURCE_PREFIX,
  type ThreadViewerAppRegistryObject,
} from "./file-thread-viewer-app-registry.ts";
import {
  sha256Fingerprint,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import {
  isDenseUnadornedArray,
  isThreadViewerAppBinding,
  MCP_APP_HOST_MAX_RESOURCE_BYTES,
  type ThreadViewerAppBinding,
} from "../../presentation/workbench/thread/viewer-sessions.ts";

export const THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA =
  "thread-viewer-app-materialization-catalog/1.0" as const;
export const DEFAULT_THREAD_VIEWER_APP_REGISTRY_PATH =
  "state/local/thread-viewer-apps/registry.json" as const;
export const DEFAULT_THREAD_VIEWER_APP_OBJECT_DIRECTORY =
  "state/local/thread-viewer-apps/objects" as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REGISTRY_WRITE_CONFLICT_CODE =
  "thread-viewer-app-registry-write-conflict" as const;

export interface ThreadViewerAppMaterializationSource {
  readonly uri: string;
  readonly path: string;
}

export interface ThreadViewerAppMaterializationReadResource {
  readonly path: string;
  readonly mimeType: string;
}

export interface ThreadViewerAppMaterializationCatalogBinding {
  readonly basis: Readonly<Record<string, unknown>>;
  readonly anchor: Readonly<Record<string, unknown>>;
  readonly app: {
    readonly id: string;
    readonly version: string;
  };
  readonly manifest: ThreadViewerAppMaterializationSource;
  readonly resource: ThreadViewerAppMaterializationSource;
  readonly readResources: readonly ThreadViewerAppMaterializationReadResource[];
  readonly session: {
    readonly schema: string;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

export interface ThreadViewerAppMaterializationCatalog {
  readonly schemaVersion: typeof THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA;
  readonly bindings: readonly ThreadViewerAppMaterializationCatalogBinding[];
}

export type ThreadViewerAppRegistryPredecessorIdentity =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly sha256: `sha256:${string}` };

export interface MaterializeThreadViewerAppsCatalogRequest {
  readonly catalog: unknown;
  readonly registryPath: string;
  readonly objectDirectory: string;
  readonly predecessor?: ThreadViewerAppRegistryPredecessorIdentity;
}

export interface MaterializeThreadViewerAppsResult {
  readonly registryPath: string;
  readonly bindingCount: number;
  readonly objectCount: number;
  readonly registryFingerprint: `sha256:${string}`;
  readonly changed: boolean;
}

export class ThreadViewerAppRegistryWriteConflictError extends Error {
  readonly code = REGISTRY_WRITE_CONFLICT_CODE;
  constructor(
    readonly expected: ThreadViewerAppRegistryPredecessorIdentity,
    readonly observed: ThreadViewerAppRegistryPredecessorIdentity,
  ) {
    super(
      "Viewer App registry write conflicted with the observed predecessor identity.",
    );
    this.name = "ThreadViewerAppRegistryWriteConflictError";
  }
}

interface MaterializedObject {
  readonly seal: ContentFingerprint;
  readonly bytes: Uint8Array;
  readonly descriptor: ThreadViewerAppRegistryObject;
}

export function parseThreadViewerAppMaterializationCatalog(
  value: unknown,
): ThreadViewerAppMaterializationCatalog {
  if (
    !isExactRecord(value, ["schemaVersion", "bindings"]) ||
    value.schemaVersion !== THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA ||
    !isDenseUnadornedArray(value.bindings)
  ) {
    throw new TypeError(
      "Viewer App materialization catalogue has an unsupported contract.",
    );
  }
  const bindings = value.bindings.map((binding, index) =>
    parseCatalogBinding(binding, index)
  );
  return { schemaVersion: value.schemaVersion, bindings };
}

export async function materializeThreadViewerAppsCatalog(
  request: MaterializeThreadViewerAppsCatalogRequest,
): Promise<MaterializeThreadViewerAppsResult> {
  const registryPath = boundedPath(request.registryPath, "Registry path");
  const objectDirectory = boundedPath(
    request.objectDirectory,
    "Object directory",
  );
  const predecessor = parseOptionalPredecessor(request.predecessor);
  const catalog = parseThreadViewerAppMaterializationCatalog(request.catalog);
  const bindings: ThreadViewerAppBinding[] = [];
  const objects = new Map<string, MaterializedObject>();

  for (const [index, source] of catalog.bindings.entries()) {
    const manifestBytes = await readBoundedSource(
      source.manifest.path,
      `Binding ${index} manifest`,
    );
    const resourceBytes = await readBoundedSource(
      source.resource.path,
      `Binding ${index} whole-App resource`,
    );
    const manifestSeal = await rawSeal(manifestBytes);
    const resourceSeal = await rawSeal(resourceBytes);
    admitObject(objects, manifestSeal, manifestBytes, {
      role: "manifest",
      mimeType: "application/json",
      bytes: manifestBytes.byteLength,
      fingerprint: fingerprint(manifestSeal),
    });
    admitObject(objects, resourceSeal, resourceBytes, {
      role: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: resourceBytes.byteLength,
      fingerprint: fingerprint(resourceSeal),
    });

    const readResources = [];
    for (const [resourceIndex, readSource] of source.readResources.entries()) {
      const bytes = await readBoundedSource(
        readSource.path,
        `Binding ${index} read resource ${resourceIndex}`,
      );
      const seal = await rawSeal(bytes);
      const resource = {
        uri: `${THREAD_VIEWER_APP_RESOURCE_PREFIX}${seal.digest}`,
        mimeType: readSource.mimeType,
        bytes: bytes.byteLength,
        fingerprint: fingerprint(seal),
      };
      admitObject(objects, seal, bytes, {
        role: "read-resource",
        mimeType: resource.mimeType,
        bytes: resource.bytes,
        fingerprint: resource.fingerprint,
      });
      readResources.push(resource);
    }

    const sessionSeal = await sha256Fingerprint(source.session.payload);
    const candidate = {
      basis: structuredClone(source.basis),
      anchor: structuredClone(source.anchor),
      app: { ...source.app },
      manifest: {
        uri: source.manifest.uri,
        fingerprint: fingerprint(manifestSeal),
      },
      resource: {
        uri: source.resource.uri,
        fingerprint: fingerprint(resourceSeal),
        ownership: "whole-view",
        mimeType: "text/html;profile=mcp-app",
        bytes: resourceBytes.byteLength,
      },
      readResources,
      session: {
        action: "viewer.session.apply",
        schema: source.session.schema,
        payload: structuredClone(source.session.payload),
        fingerprint: fingerprint(sessionSeal),
      },
    };
    if (!isThreadViewerAppBinding(candidate)) {
      throw new TypeError(
        `Binding ${index} does not form an exact whole-App viewer contract.`,
      );
    }
    bindings.push(candidate);
  }

  const store = new FileByteStore({
    kind: "thread-viewer-app-object",
    directory: objectDirectory,
    uriNamespace: "thread-viewer-apps",
    label: "Thread viewer App object",
  });
  for (const object of objects.values()) {
    await store.save(object.seal, object.bytes);
  }

  const descriptors = [...objects.values()]
    .map((object) => object.descriptor)
    .toSorted((left, right) =>
      left.fingerprint.localeCompare(right.fingerprint) ||
      left.role.localeCompare(right.role)
    );
  const document = JSON.stringify({
    schemaVersion: THREAD_VIEWER_APP_REGISTRY_SCHEMA,
    bindings,
    objects: descriptors,
  });
  const registryDirectory = parentDirectory(registryPath);
  await Deno.mkdir(registryDirectory, { recursive: true });
  const registryFingerprint = await fingerprintRaw(new TextEncoder().encode(document));
  let changed = false;
  await withRegistryLock(registryPath, async () => {
    await assertPredecessor(registryPath, predecessor);
    const current = await observeRegistryPredecessor(registryPath);
    if (current.kind === "present" && current.sha256 === registryFingerprint) return;
    const candidatePath = `${registryPath}.${crypto.randomUUID()}.candidate`;
    try {
      await writeNewAttemptFileDurably(
        candidatePath,
        document,
        registryDirectory,
        "Viewer App registry candidate write made no progress.",
      );
      const admitted = await new FileThreadViewerAppRegistry({
        registryPath: candidatePath,
        objectDirectory,
      }).read();
      if (!admitted || admitted.bindings.length !== bindings.length) {
        throw new Error(
          "Materialized viewer App registry failed exact manifest and CAS admission.",
        );
      }
      await assertPredecessor(registryPath, predecessor);
      await replaceAttemptFileDurably(
        registryPath,
        document,
        registryDirectory,
        "Viewer App registry replacement made no progress.",
      );
      changed = true;
    } finally {
      await Deno.remove(candidatePath).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  });

  return {
    registryPath,
    bindingCount: bindings.length,
    objectCount: descriptors.length,
    registryFingerprint,
    changed,
  };
}

function parseOptionalPredecessor(
  value: ThreadViewerAppRegistryPredecessorIdentity | undefined,
): ThreadViewerAppRegistryPredecessorIdentity | undefined {
  if (value === undefined) return undefined;
  return parsePredecessor(value);
}

function parsePredecessor(
  value: unknown,
): ThreadViewerAppRegistryPredecessorIdentity {
  if (isExactRecord(value, ["kind"]) && value.kind === "absent") {
    return { kind: "absent" };
  }
  if (
    isExactRecord(value, ["kind", "sha256"]) &&
    value.kind === "present" &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  ) {
    return { kind: "present", sha256: value.sha256 as `sha256:${string}` };
  }
  throw new TypeError(
    "Viewer App registry predecessor has an unsupported contract.",
  );
}

async function withRegistryLock<T>(
  registryPath: string,
  operation: () => Promise<T>,
): Promise<T> {
  const file = await Deno.open(`${registryPath}.lock`, {
    create: true,
    read: true,
    write: true,
  });
  let locked = false;
  try {
    await file.lock(true);
    locked = true;
    return await operation();
  } finally {
    try {
      if (locked) await file.unlock();
    } finally {
      file.close();
    }
  }
}

async function assertPredecessor(
  registryPath: string,
  expected: ThreadViewerAppRegistryPredecessorIdentity | undefined,
): Promise<void> {
  if (expected === undefined) return;
  const observed = await observeRegistryPredecessor(registryPath);
  if (!predecessorMatches(expected, observed)) {
    throw new ThreadViewerAppRegistryWriteConflictError(expected, observed);
  }
}

async function observeRegistryPredecessor(
  registryPath: string,
): Promise<ThreadViewerAppRegistryPredecessorIdentity> {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(registryPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return { kind: "absent" };
    throw error;
  }
  return { kind: "present", sha256: await fingerprintRaw(bytes) };
}

function predecessorMatches(
  expected: ThreadViewerAppRegistryPredecessorIdentity,
  observed: ThreadViewerAppRegistryPredecessorIdentity,
): boolean {
  if (expected.kind === "absent") return observed.kind === "absent";
  return observed.kind === "present" && observed.sha256 === expected.sha256;
}

function parseCatalogBinding(
  value: unknown,
  index: number,
): ThreadViewerAppMaterializationCatalogBinding {
  if (
    !isExactRecord(value, [
      "basis",
      "anchor",
      "app",
      "manifest",
      "resource",
      "readResources",
      "session",
    ]) ||
    !isRecord(value.basis) ||
    !isRecord(value.anchor) ||
    !isExactRecord(value.app, ["id", "version"]) ||
    typeof value.app.id !== "string" ||
    typeof value.app.version !== "string" ||
    !isDenseUnadornedArray(value.readResources) ||
    !isExactRecord(value.session, ["schema", "payload"]) ||
    typeof value.session.schema !== "string" ||
    !isRecord(value.session.payload)
  ) {
    throw new TypeError(
      `Catalogue binding ${index} has an unsupported contract.`,
    );
  }
  return {
    basis: value.basis,
    anchor: value.anchor,
    app: value.app as ThreadViewerAppMaterializationCatalogBinding["app"],
    manifest: parseSource(value.manifest, `binding ${index} manifest`),
    resource: parseSource(value.resource, `binding ${index} resource`),
    readResources: value.readResources.map((resource, resourceIndex) =>
      parseReadResource(resource, index, resourceIndex)
    ),
    session: {
      schema: value.session.schema,
      payload: value.session.payload,
    },
  };
}

function parseSource(
  value: unknown,
  label: string,
): ThreadViewerAppMaterializationSource {
  if (
    !isExactRecord(value, ["uri", "path"]) ||
    typeof value.uri !== "string" ||
    typeof value.path !== "string"
  ) {
    throw new TypeError(`Catalogue ${label} has an unsupported contract.`);
  }
  return { uri: value.uri, path: boundedPath(value.path, `${label} path`) };
}

function parseReadResource(
  value: unknown,
  bindingIndex: number,
  resourceIndex: number,
): ThreadViewerAppMaterializationReadResource {
  if (
    !isExactRecord(value, ["path", "mimeType"]) ||
    typeof value.path !== "string" ||
    typeof value.mimeType !== "string"
  ) {
    throw new TypeError(
      `Catalogue binding ${bindingIndex} read resource ${resourceIndex} has an unsupported contract.`,
    );
  }
  return {
    path: boundedPath(value.path, "Read resource path"),
    mimeType: value.mimeType,
  };
}

async function readBoundedSource(
  path: string,
  label: string,
): Promise<Uint8Array> {
  const stat = await Deno.stat(path);
  if (
    !stat.isFile || !Number.isSafeInteger(stat.size) || stat.size < 0 ||
    stat.size > MCP_APP_HOST_MAX_RESOURCE_BYTES
  ) {
    throw new TypeError(`${label} must be a bounded regular file.`);
  }
  const bytes = await Deno.readFile(path);
  if (bytes.byteLength !== stat.size) {
    throw new Error(`${label} changed while it was being read.`);
  }
  return bytes;
}

function admitObject(
  objects: Map<string, MaterializedObject>,
  seal: ContentFingerprint,
  bytes: Uint8Array,
  descriptor: ThreadViewerAppRegistryObject,
): void {
  const key = fingerprint(seal);
  const current = objects.get(key);
  if (current) {
    if (
      current.descriptor.role !== descriptor.role ||
      current.descriptor.mimeType !== descriptor.mimeType ||
      current.descriptor.bytes !== descriptor.bytes ||
      !bytesEqual(current.bytes, bytes)
    ) {
      throw new TypeError(
        `Viewer App object ${key} is assigned conflicting roles or MIME types.`,
      );
    }
    return;
  }
  objects.set(key, { seal, bytes, descriptor });
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index] ^ right[index];
  }
  return different === 0;
}

async function rawSeal(bytes: Uint8Array): Promise<ContentFingerprint> {
  return { algorithm: "sha256", digest: await sha256Hex(bytes) };
}

async function fingerprintRaw(bytes: Uint8Array): Promise<`sha256:${string}`> {
  return fingerprint(await rawSeal(bytes));
}

function fingerprint(value: ContentFingerprint): `sha256:${string}` {
  return `sha256:${value.digest}`;
}

function boundedPath(value: string, label: string): string {
  if (
    value.length === 0 || value !== value.trim() || value.includes("\0") ||
    value === "/"
  ) {
    throw new TypeError(`${label} must be an explicit bounded path.`);
  }
  return value;
}

function parentDirectory(path: string): string {
  const withoutTrailingSlash = path.replace(/\/+$/, "");
  const slash = withoutTrailingSlash.lastIndexOf("/");
  if (slash < 0) return ".";
  return slash === 0 ? "/" : withoutTrailingSlash.slice(0, slash);
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length &&
    ownKeys.every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
