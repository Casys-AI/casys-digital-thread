/**
 * Trusted local registrar for exact whole-App viewer bindings.
 *
 * This runner is deliberately outside the read-only Workbench. It consumes a
 * complete explicit catalogue, derives every byte identity, publishes the
 * immutable CAS objects, validates the resulting registry through the same
 * reader used by the BFF, then atomically replaces the registry document.
 */

import { parseArgs } from "../lib/cli.ts";
import { FileByteStore } from "../../src/adapters/shared/cas/file-byte-store.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../src/adapters/shared/wal/durable-attempt-file-writes.ts";
import {
  FileThreadViewerAppRegistry,
  THREAD_VIEWER_APP_REGISTRY_SCHEMA,
  THREAD_VIEWER_APP_RESOURCE_PREFIX,
  type ThreadViewerAppRegistryObject,
} from "../../src/adapters/thread/file-thread-viewer-app-registry.ts";
import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";
import {
  isDenseUnadornedArray,
  isThreadViewerAppBinding,
  MCP_APP_HOST_MAX_RESOURCE_BYTES,
  type ThreadViewerAppBinding,
} from "../../src/presentation/workbench/thread/viewer-sessions.ts";

export const THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA =
  "thread-viewer-app-materialization-catalog/1.0" as const;
export const DEFAULT_THREAD_VIEWER_APP_REGISTRY_PATH =
  "state/local/thread-viewer-apps/registry.json" as const;
export const DEFAULT_THREAD_VIEWER_APP_OBJECT_DIRECTORY =
  "state/local/thread-viewer-apps/objects" as const;

interface MaterializationSource {
  readonly uri: string;
  readonly path: string;
}

interface MaterializationReadResource {
  readonly path: string;
  readonly mimeType: string;
}

interface MaterializationCatalogBinding {
  readonly basis: Readonly<Record<string, unknown>>;
  readonly anchor: Readonly<Record<string, unknown>>;
  readonly app: {
    readonly id: string;
    readonly version: string;
  };
  readonly manifest: MaterializationSource;
  readonly resource: MaterializationSource;
  readonly readResources: readonly MaterializationReadResource[];
  readonly session: {
    readonly schema: string;
    readonly payload: Readonly<Record<string, unknown>>;
  };
}

interface MaterializationCatalog {
  readonly schemaVersion: typeof THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA;
  readonly bindings: readonly MaterializationCatalogBinding[];
}

export interface MaterializeThreadViewerAppsRequest {
  readonly catalogPath: string;
  readonly registryPath?: string;
  readonly objectDirectory?: string;
}

export interface MaterializeThreadViewerAppsResult {
  readonly registryPath: string;
  readonly bindingCount: number;
  readonly objectCount: number;
}

interface MaterializedObject {
  readonly seal: ContentFingerprint;
  readonly bytes: Uint8Array;
  readonly descriptor: ThreadViewerAppRegistryObject;
}

export async function materializeThreadViewerApps(
  request: MaterializeThreadViewerAppsRequest,
): Promise<MaterializeThreadViewerAppsResult> {
  const catalogPath = boundedPath(request.catalogPath, "Catalogue path");
  const registryPath = boundedPath(
    request.registryPath ?? DEFAULT_THREAD_VIEWER_APP_REGISTRY_PATH,
    "Registry path",
  );
  const objectDirectory = boundedPath(
    request.objectDirectory ?? DEFAULT_THREAD_VIEWER_APP_OBJECT_DIRECTORY,
    "Object directory",
  );
  const registryDirectory = parentDirectory(registryPath);
  const catalog = await readCatalog(catalogPath);
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
    const manifestSeal = await rawFingerprint(manifestBytes);
    const resourceSeal = await rawFingerprint(resourceBytes);
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
      const seal = await rawFingerprint(bytes);
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
  await Deno.mkdir(registryDirectory, { recursive: true });
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
    await replaceAttemptFileDurably(
      registryPath,
      document,
      registryDirectory,
      "Viewer App registry replacement made no progress.",
    );
  } finally {
    await Deno.remove(candidatePath).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }

  return {
    registryPath,
    bindingCount: bindings.length,
    objectCount: descriptors.length,
  };
}

async function readCatalog(path: string): Promise<MaterializationCatalog> {
  let value: unknown;
  try {
    value = JSON.parse(await Deno.readTextFile(path));
  } catch (error) {
    throw new TypeError(
      `Viewer App materialization catalogue is unavailable or invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
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

function parseCatalogBinding(
  value: unknown,
  index: number,
): MaterializationCatalogBinding {
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
    app: value.app as MaterializationCatalogBinding["app"],
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

function parseSource(value: unknown, label: string): MaterializationSource {
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
): MaterializationReadResource {
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

async function rawFingerprint(bytes: Uint8Array): Promise<ContentFingerprint> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
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

export function parseMaterializeThreadViewerAppsCli(
  args: readonly string[],
): MaterializeThreadViewerAppsRequest {
  const allowed = new Set(["catalog", "registry", "object-dir"]);
  const normalized = args.filter((argument) => argument !== "--");
  for (const argument of normalized) {
    const match = /^--([^=]+)=/.exec(argument);
    if (!match || !allowed.has(match[1])) {
      throw new TypeError(
        `Unsupported viewer App registrar argument: ${argument}`,
      );
    }
  }
  const flags = parseArgs(normalized);
  if (!flags.catalog) {
    throw new TypeError("Viewer App registrar requires --catalog=<path>.");
  }
  return {
    catalogPath: flags.catalog,
    registryPath: flags.registry,
    objectDirectory: flags["object-dir"],
  };
}

if (import.meta.main) {
  const result = await materializeThreadViewerApps(
    parseMaterializeThreadViewerAppsCli(Deno.args),
  );
  console.log(JSON.stringify(result));
}
