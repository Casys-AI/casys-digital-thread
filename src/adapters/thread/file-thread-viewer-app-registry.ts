import {
  parseViewAppManifestJson,
  type ViewAppManifest,
  VIEWER_SESSION_APPLY_ACTION,
} from "@casys/mcp-view-contracts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import type {
  ThreadViewerAppLaunchRequest,
  ThreadViewerAppLaunchResolver,
} from "./thread-viewer-sessions-projector.ts";
import {
  isDenseUnadornedArray,
  isThreadViewerAppBinding,
  MCP_APP_HOST_MAX_RESOURCE_BYTES,
  type ThreadViewerAppBinding,
  type ThreadViewerVerifiedAppLaunch,
} from "../../presentation/workbench/thread/viewer-sessions.ts";

export const THREAD_VIEWER_APP_REGISTRY_SCHEMA =
  "thread-viewer-app-registry/1.0" as const;
export const THREAD_VIEWER_APP_LAUNCH_PREFIX =
  "/api/thread/viewer-apps/launch/" as const;
export const THREAD_VIEWER_APP_RESOURCE_PREFIX =
  "/api/thread/viewer-apps/resources/" as const;

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MIME =
  /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:;[A-Za-z0-9=._+-]+)*$/;

export type ThreadViewerAppObjectRole =
  | "manifest"
  | "whole-view"
  | "read-resource";

export interface ThreadViewerAppRegistryObject {
  readonly role: ThreadViewerAppObjectRole;
  readonly mimeType: string;
  readonly bytes: number;
  readonly fingerprint: string;
}

export interface ThreadViewerAppRegistryDocument {
  readonly schemaVersion: typeof THREAD_VIEWER_APP_REGISTRY_SCHEMA;
  readonly bindings: readonly ThreadViewerAppBinding[];
  readonly objects: readonly ThreadViewerAppRegistryObject[];
}

export interface ThreadViewerAppRegistrySnapshot {
  readonly bindings: readonly ThreadViewerAppBinding[];
  readonly launchResolver: ThreadViewerAppLaunchResolver;
}

export interface ThreadViewerAppRegistryReader {
  read(): Promise<ThreadViewerAppRegistrySnapshot | undefined>;
  serve(pathname: string): Promise<Response>;
}

/**
 * Server-owned, file-declared whole-App registry backed by an immutable CAS.
 *
 * Another trusted registrar writes the JSON document and CAS objects. The
 * Workbench only rereads and attests them; it never discovers an App, accepts
 * a launch URL, calls an MCP provider or constructs an App-owned payload.
 */
export class FileThreadViewerAppRegistry implements ThreadViewerAppRegistryReader {
  readonly #registryPath: string;
  readonly #objects: FileByteStore<"thread-viewer-app-object">;

  constructor(options: {
    readonly registryPath: string;
    readonly objectDirectory: string;
  }) {
    if (
      !isBoundedPath(options.registryPath) ||
      !isBoundedPath(options.objectDirectory)
    ) {
      throw new TypeError(
        "Viewer App registry paths must be explicit bounded paths.",
      );
    }
    this.#registryPath = options.registryPath;
    this.#objects = new FileByteStore({
      kind: "thread-viewer-app-object",
      directory: options.objectDirectory,
      uriNamespace: "thread-viewer-apps",
      label: "Thread viewer App object",
    });
  }

  async read(): Promise<ThreadViewerAppRegistrySnapshot | undefined> {
    const admitted = await this.#readAdmitted();
    if (!admitted) return undefined;
    return {
      bindings: admitted.document.bindings.map((binding) => structuredClone(binding)),
      launchResolver: {
        resolve: async (request) => await this.#resolveFromAdmitted(admitted, request),
      },
    };
  }

  async serve(pathname: string): Promise<Response> {
    const admitted = await this.#readAdmitted();
    if (!admitted) return notFound();
    if (pathname.startsWith(THREAD_VIEWER_APP_LAUNCH_PREFIX)) {
      return await this.#serveLaunch(admitted, pathname);
    }
    if (pathname.startsWith(THREAD_VIEWER_APP_RESOURCE_PREFIX)) {
      return await this.#serveReadResource(admitted, pathname);
    }
    return notFound();
  }

  async #readAdmitted(): Promise<AdmittedRegistry | undefined> {
    let text: string;
    try {
      text = await Deno.readTextFile(this.#registryPath);
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      return undefined;
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return undefined;
    }
    const document = parseRegistryDocument(value);
    if (!document) return undefined;
    const objects = new Map(
      document.objects.map((object) => [object.fingerprint, object]),
    );
    const manifests = new Map<string, AdmittedViewAppManifest>();
    try {
      for (const object of objects.values()) {
        const stored = await this.#objects.read(
          contentFingerprint(object.fingerprint),
        );
        if (!stored || stored.byteLength !== object.bytes) return undefined;
        if (object.role === "manifest") {
          const manifest = parseViewAppManifest(stored.copy());
          if (!manifest) return undefined;
          manifests.set(object.fingerprint, manifest);
        }
      }
    } catch {
      return undefined;
    }
    for (const binding of document.bindings) {
      const manifest = manifests.get(binding.manifest.fingerprint);
      if (!manifest || !manifestAdmitsBinding(manifest, binding)) {
        return undefined;
      }
    }
    return { document, objects };
  }

  async #resolveFromAdmitted(
    admitted: AdmittedRegistry,
    request: ThreadViewerAppLaunchRequest,
  ): Promise<ThreadViewerVerifiedAppLaunch | undefined> {
    const binding = admitted.document.bindings.find((candidate) =>
      sameLaunchRequest(candidate, request)
    );
    if (!binding) return undefined;
    if (!await this.#reopenReferencedObjects(admitted, binding)) {
      return undefined;
    }
    return {
      app: { ...request.app },
      manifest: { ...request.manifest },
      resource: { ...request.resource },
      readResources: request.readResources.map((resource) => ({ ...resource })),
      launchUri: launchUri(request),
    };
  }

  async #reopenReferencedObjects(
    admitted: AdmittedRegistry,
    binding: ThreadViewerAppBinding,
  ): Promise<boolean> {
    const fingerprints = [
      binding.manifest.fingerprint,
      binding.resource.fingerprint,
      ...binding.readResources.map((resource) => resource.fingerprint),
    ];
    try {
      for (const fingerprint of fingerprints) {
        const expected = admitted.objects.get(fingerprint);
        if (!expected) return false;
        const stored = await this.#objects.read(
          contentFingerprint(fingerprint),
        );
        if (!stored || stored.byteLength !== expected.bytes) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async #serveLaunch(
    admitted: AdmittedRegistry,
    pathname: string,
  ): Promise<Response> {
    const suffix = pathname.slice(THREAD_VIEWER_APP_LAUNCH_PREFIX.length);
    const match = /^([a-f0-9]{64})\/([a-f0-9]{64})$/.exec(suffix);
    if (!match) return notFound();
    const manifestFingerprint = `sha256:${match[1]}`;
    const resourceFingerprint = `sha256:${match[2]}`;
    const binding = admitted.document.bindings.find((candidate) =>
      candidate.manifest.fingerprint === manifestFingerprint &&
      candidate.resource.fingerprint === resourceFingerprint
    );
    if (!binding || !await this.#reopenReferencedObjects(admitted, binding)) {
      return notFound();
    }
    const resourceObject = admitted.objects.get(resourceFingerprint);
    const bytes = await this.#objects.read(
      contentFingerprint(resourceFingerprint),
    );
    if (
      !resourceObject || !bytes || bytes.byteLength !== resourceObject.bytes
    ) {
      return notFound();
    }
    return new Response(Uint8Array.from(bytes.copy()).buffer, {
      headers: readOnlyHeaders({
        "Content-Type": "text/html;profile=mcp-app",
        "Content-Security-Policy": [
          "default-src 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
          "img-src data: blob:",
          "connect-src 'none'",
          "font-src 'none'",
          "media-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'self'",
        ].join("; "),
      }),
    });
  }

  async #serveReadResource(
    admitted: AdmittedRegistry,
    pathname: string,
  ): Promise<Response> {
    const digest = pathname.slice(THREAD_VIEWER_APP_RESOURCE_PREFIX.length);
    if (!/^[a-f0-9]{64}$/.test(digest)) return notFound();
    const fingerprint = `sha256:${digest}`;
    const object = admitted.objects.get(fingerprint);
    if (!object || object.role !== "read-resource") return notFound();
    const registered = admitted.document.bindings.some((binding) =>
      binding.readResources.some((resource) =>
        resource.fingerprint === fingerprint &&
        resource.uri === readResourceUri(fingerprint) &&
        resource.mimeType === object.mimeType && resource.bytes === object.bytes
      )
    );
    if (!registered) return notFound();
    let bytes;
    try {
      bytes = await this.#objects.read(contentFingerprint(fingerprint));
    } catch {
      return notFound();
    }
    if (!bytes || bytes.byteLength !== object.bytes) return notFound();
    return new Response(Uint8Array.from(bytes.copy()).buffer, {
      headers: readOnlyHeaders({ "Content-Type": object.mimeType }),
    });
  }
}

interface AdmittedRegistry {
  readonly document: ThreadViewerAppRegistryDocument;
  readonly objects: ReadonlyMap<string, ThreadViewerAppRegistryObject>;
}

interface AdmittedViewAppManifest {
  readonly app: { readonly id: string; readonly version: string };
  readonly resources: readonly AdmittedViewAppResource[];
}

interface AdmittedViewAppResource {
  readonly uri: string;
  readonly ownership: "whole-view" | "component-catalog";
  readonly acceptedActions?: readonly string[];
  readonly sessionSchemas?: readonly string[];
}

function parseViewAppManifest(
  bytes: Uint8Array,
): AdmittedViewAppManifest | undefined {
  let manifest: ViewAppManifest;
  try {
    manifest = parseViewAppManifestJson(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    return undefined;
  }
  return {
    app: { id: manifest.app.id, version: manifest.app.version },
    resources: manifest.resources.map((resource) => ({
      uri: resource.uri,
      ownership: resource.ownership,
      ...(resource.acceptedActions
        ? { acceptedActions: resource.acceptedActions }
        : {}),
      ...(resource.sessionSchemas ? { sessionSchemas: resource.sessionSchemas } : {}),
    })),
  };
}

function manifestAdmitsBinding(
  manifest: AdmittedViewAppManifest,
  binding: ThreadViewerAppBinding,
): boolean {
  if (
    manifest.app.id !== binding.app.id ||
    manifest.app.version !== binding.app.version
  ) return false;
  const resource = manifest.resources.find((candidate) =>
    candidate.uri === binding.resource.uri
  );
  return resource?.ownership === "whole-view" &&
    resource.acceptedActions?.includes(VIEWER_SESSION_APPLY_ACTION) === true &&
    resource.sessionSchemas?.includes(binding.session.schema) === true;
}

function parseRegistryDocument(
  value: unknown,
): ThreadViewerAppRegistryDocument | undefined {
  if (!isExactRecord(value, ["schemaVersion", "bindings", "objects"])) {
    return undefined;
  }
  if (value.schemaVersion !== THREAD_VIEWER_APP_REGISTRY_SCHEMA) {
    return undefined;
  }
  if (
    !isDenseUnadornedArray(value.bindings) ||
    !isDenseUnadornedArray(value.objects)
  ) {
    return undefined;
  }
  if (!value.bindings.every(isThreadViewerAppBinding)) return undefined;
  const objects: ThreadViewerAppRegistryObject[] = [];
  const fingerprints = new Set<string>();
  for (const valueObject of value.objects) {
    if (
      !isRegistryObject(valueObject) ||
      fingerprints.has(valueObject.fingerprint)
    ) {
      return undefined;
    }
    fingerprints.add(valueObject.fingerprint);
    objects.push(valueObject);
  }
  const objectByFingerprint = new Map(
    objects.map((object) => [object.fingerprint, object]),
  );
  for (const binding of value.bindings) {
    const manifest = objectByFingerprint.get(binding.manifest.fingerprint);
    const wholeView = objectByFingerprint.get(binding.resource.fingerprint);
    if (
      manifest?.role !== "manifest" ||
      manifest.mimeType !== "application/json" ||
      wholeView?.role !== "whole-view" ||
      wholeView.mimeType !== binding.resource.mimeType ||
      wholeView.bytes !== binding.resource.bytes
    ) return undefined;
    for (const resource of binding.readResources) {
      const object = objectByFingerprint.get(resource.fingerprint);
      if (
        object?.role !== "read-resource" ||
        object.mimeType !== resource.mimeType ||
        object.bytes !== resource.bytes ||
        resource.uri !== readResourceUri(resource.fingerprint)
      ) return undefined;
    }
  }
  return {
    schemaVersion: THREAD_VIEWER_APP_REGISTRY_SCHEMA,
    bindings: value.bindings,
    objects,
  };
}

function isRegistryObject(
  value: unknown,
): value is ThreadViewerAppRegistryObject {
  return isExactRecord(value, ["role", "mimeType", "bytes", "fingerprint"]) &&
    (value.role === "manifest" || value.role === "whole-view" ||
      value.role === "read-resource") &&
    typeof value.mimeType === "string" && MIME.test(value.mimeType) &&
    Number.isSafeInteger(value.bytes) && (value.bytes as number) >= 0 &&
    (value.bytes as number) <= MCP_APP_HOST_MAX_RESOURCE_BYTES &&
    typeof value.fingerprint === "string" && SHA256.test(value.fingerprint);
}

function sameLaunchRequest(
  binding: ThreadViewerAppBinding,
  request: ThreadViewerAppLaunchRequest,
): boolean {
  return binding.app.id === request.app.id &&
    binding.app.version === request.app.version &&
    binding.manifest.uri === request.manifest.uri &&
    binding.manifest.fingerprint === request.manifest.fingerprint &&
    binding.resource.uri === request.resource.uri &&
    binding.resource.fingerprint === request.resource.fingerprint &&
    binding.resource.ownership === request.resource.ownership &&
    binding.resource.mimeType === request.resource.mimeType &&
    binding.resource.bytes === request.resource.bytes &&
    JSON.stringify(binding.readResources) ===
      JSON.stringify(request.readResources);
}

function launchUri(request: ThreadViewerAppLaunchRequest): string {
  return `${THREAD_VIEWER_APP_LAUNCH_PREFIX}${digest(request.manifest.fingerprint)}/${
    digest(request.resource.fingerprint)
  }`;
}

function readResourceUri(fingerprint: string): string {
  return `${THREAD_VIEWER_APP_RESOURCE_PREFIX}${digest(fingerprint)}`;
}

function digest(fingerprint: string): string {
  return fingerprint.slice("sha256:".length);
}

function contentFingerprint(fingerprint: string) {
  return { algorithm: "sha256" as const, digest: digest(fingerprint) };
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null || typeof value === "string" || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) return true;
  if (isDenseUnadornedArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Reflect.ownKeys(value).every((key) => typeof key === "string") &&
    Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.every((key) => typeof key === "string") &&
    actual.length === keys.length && keys.every((key) => actual.includes(key));
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, keys);
}

function isBoundedPath(value: string): boolean {
  return value.length > 0 && value === value.trim() && value !== "/" &&
    !value.includes("\0");
}

function readOnlyHeaders(extra: Record<string, string>): Headers {
  return new Headers({
    ...extra,
    "Cache-Control": "no-store",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
