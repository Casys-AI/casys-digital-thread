import {
  parseViewAppManifestJson,
  VIEWER_SESSION_APPLY_ACTION,
} from "@casys/mcp-view-contracts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";

export const THREAD_VIEWER_APP_PACKAGES_SCHEMA =
  "thread-viewer-app-packages/1.0" as const;
export const DEFAULT_THREAD_VIEWER_APP_PACKAGES_PATH =
  "state/local/thread-viewer-apps/packages.json" as const;

const SHA256 = /^sha256:([a-f0-9]{64})$/;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_HTML_BYTES = 32 * 1024 * 1024;
const MAX_CATALOG_BYTES = 1024 * 1024;
const MAX_PACKAGES = 64;
const MAX_RESOURCES_PER_PACKAGE = 64;
const MAX_SCHEMA_ENTRIES = 64;
const EXACT_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface InstalledThreadViewerAppResource {
  readonly uri: string;
  readonly path: string;
  readonly fingerprint: string;
  readonly resultSchemas: readonly string[];
  readonly sessionSchemas: readonly string[];
  readonly acceptedActions: readonly string[];
}

export interface InstalledThreadViewerAppPackage {
  readonly app: { readonly id: string; readonly version: string };
  readonly manifest: {
    readonly uri: string;
    readonly path: string;
    readonly fingerprint: string;
  };
  readonly resources: readonly InstalledThreadViewerAppResource[];
}

/**
 * Reopens the immutable display-byte installation catalogue.  This is a
 * package receipt only: it neither reads project evidence nor selects a
 * package from an alias or mutable provider checkout.
 */
export async function readThreadViewerAppPackages(
  catalogPath: string,
  objectDirectory: string,
): Promise<readonly InstalledThreadViewerAppPackage[] | undefined> {
  boundedPath(catalogPath, "catalogue path");
  boundedPath(objectDirectory, "object directory");
  let raw: unknown;
  try {
    const stat = await Deno.stat(catalogPath);
    if (!stat.isFile || stat.size > MAX_CATALOG_BYTES) {
      throw new TypeError("Viewer App package catalogue is too large.");
    }
    raw = JSON.parse(await Deno.readTextFile(catalogPath));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    if (error instanceof TypeError) throw error;
    throw new TypeError("Viewer App package catalogue is not valid JSON.");
  }
  if (
    !exactKeys(raw, ["schemaVersion", "packages"]) ||
    raw.schemaVersion !== THREAD_VIEWER_APP_PACKAGES_SCHEMA ||
    !boundedArray(raw.packages, MAX_PACKAGES)
  ) {
    throw new TypeError("Viewer App package catalogue has an unsupported contract.");
  }
  const objects = new FileByteStore({
    kind: "thread-viewer-app-object",
    directory: objectDirectory,
    uriNamespace: "thread-viewer-apps",
    label: "Thread viewer App package object",
  });
  const appIds = new Set<string>();
  const packages: InstalledThreadViewerAppPackage[] = [];
  for (const candidate of raw.packages) {
    const declared = parsePackage(candidate);
    if (appIds.has(declared.app.id)) {
      throw new TypeError("Viewer App package catalogue names an App more than once.");
    }
    appIds.add(declared.app.id);
    const manifestBytes = await readObject(
      objects,
      objectDirectory,
      declared.manifest.fingerprint,
      MAX_MANIFEST_BYTES,
      "manifest",
    );
    let manifest;
    try {
      manifest = parseViewAppManifestJson(
        new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
      );
    } catch {
      throw new TypeError("Installed Viewer App manifest is invalid.");
    }
    if (
      manifest.app.id !== declared.app.id ||
      manifest.app.version !== declared.app.version
    ) {
      throw new TypeError(
        "Installed Viewer App manifest identity does not match catalogue.",
      );
    }
    const resources: InstalledThreadViewerAppResource[] = [];
    const seenUris = new Set<string>();
    for (const resource of declared.resources) {
      if (seenUris.has(resource.uri)) {
        throw new TypeError("Viewer App package contains a duplicate resource URI.");
      }
      seenUris.add(resource.uri);
      await readObject(
        objects,
        objectDirectory,
        resource.fingerprint,
        MAX_HTML_BYTES,
        "whole-App resource",
      );
      const manifestResource = manifest.resources.find((item) =>
        item.uri === resource.uri
      );
      if (
        !manifestResource || manifestResource.ownership !== "whole-view" ||
        manifestResource.acceptedActions?.includes(VIEWER_SESSION_APPLY_ACTION) !==
          true ||
        !boundedStrings(manifestResource.resultSchemas) ||
        !boundedStrings(manifestResource.sessionSchemas)
      ) {
        throw new TypeError(
          "Installed Viewer App resource is not an admitted whole App.",
        );
      }
      resources.push(Object.freeze({
        uri: resource.uri,
        path: objectPath(objectDirectory, resource.fingerprint),
        fingerprint: resource.fingerprint,
        resultSchemas: Object.freeze([...manifestResource.resultSchemas]),
        sessionSchemas: Object.freeze([...manifestResource.sessionSchemas]),
        acceptedActions: Object.freeze([...manifestResource.acceptedActions]),
      }));
    }
    packages.push(Object.freeze({
      app: Object.freeze({ ...declared.app }),
      manifest: Object.freeze({
        uri: declared.manifest.uri,
        path: objectPath(objectDirectory, declared.manifest.fingerprint),
        fingerprint: declared.manifest.fingerprint,
      }),
      resources: Object.freeze(resources),
    }));
  }
  return Object.freeze(packages);
}

interface DeclaredPackage {
  readonly app: { readonly id: string; readonly version: string };
  readonly manifest: { readonly uri: string; readonly fingerprint: string };
  readonly resources: readonly { readonly uri: string; readonly fingerprint: string }[];
}

function parsePackage(value: unknown): DeclaredPackage {
  if (
    !exactKeys(value, ["app", "manifest", "resources"]) ||
    !exactKeys(value.app, ["id", "version"]) ||
    !exactKeys(value.manifest, ["uri", "fingerprint"]) ||
    !boundedArray(value.resources, MAX_RESOURCES_PER_PACKAGE) ||
    !nonEmpty(value.app.id) ||
    !exactVersion(value.app.version) || !uiUri(value.manifest.uri) ||
    !fingerprint(value.manifest.fingerprint)
  ) {
    throw new TypeError("Viewer App package has an unsupported contract.");
  }
  const resources = value.resources.map((resource) => {
    if (
      !exactKeys(resource, ["uri", "fingerprint"]) || !uiUri(resource.uri) ||
      !fingerprint(resource.fingerprint)
    ) {
      throw new TypeError("Viewer App package resource has an unsupported contract.");
    }
    return { uri: resource.uri, fingerprint: resource.fingerprint };
  });
  return {
    app: { id: value.app.id, version: value.app.version },
    manifest: { uri: value.manifest.uri, fingerprint: value.manifest.fingerprint },
    resources,
  };
}

async function readObject(
  objects: FileByteStore<"thread-viewer-app-object">,
  objectDirectory: string,
  value: string,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  const match = SHA256.exec(value);
  if (!match) throw new TypeError("Viewer App object fingerprint is invalid.");
  const path = objectPath(objectDirectory, value);
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(path);
  } catch {
    throw new TypeError(`Installed Viewer App ${label} is absent or too large.`);
  }
  if (!stat.isFile || stat.size > limit) {
    throw new TypeError(`Installed Viewer App ${label} is absent or too large.`);
  }
  const stored = await objects.read({ algorithm: "sha256", digest: match[1]! });
  if (!stored || stored.byteLength > limit) {
    throw new TypeError(`Installed Viewer App ${label} is absent or too large.`);
  }
  const bytes = stored.copy();
  if (`sha256:${await sha256Hex(bytes)}` !== value) {
    throw new TypeError(`Installed Viewer App ${label} hash does not match.`);
  }
  return bytes;
}

function objectPath(directory: string, value: string): string {
  return `${directory.replace(/\/+$/, "")}/${SHA256.exec(value)![1]}`;
}
function exactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
function denseArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}
function boundedArray(value: unknown, max: number): value is unknown[] {
  return denseArray(value) && value.length <= max;
}
function boundedStrings(value: unknown): value is readonly string[] {
  return boundedArray(value, MAX_SCHEMA_ENTRIES) && value.every(nonEmpty);
}
function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
function uiUri(value: unknown): value is string {
  return nonEmpty(value) && value.startsWith("ui://");
}
function fingerprint(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}
function exactVersion(value: unknown): value is string {
  return nonEmpty(value) && EXACT_VERSION.test(value);
}
function boundedPath(value: string, label: string): void {
  if (!nonEmpty(value) || value.includes("\0")) {
    throw new TypeError(`Viewer App ${label} is invalid.`);
  }
}
