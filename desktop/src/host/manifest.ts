import { fail, type HostResult, ok } from "./result.ts";

export const COMPONENT_MANIFEST_SCHEMA_VERSION = "casys-desktop-components/1.0";
export const DESKTOP_SHELL_COMPONENT_ID = "desktop-shell";

const ROOT_KEYS = ["schemaVersion", "product", "runtime", "components"] as const;
const PRODUCT_KEYS = ["identifier", "name", "version"] as const;
const RUNTIME_KEYS = [
  "denoVersion",
  "desktopRuntimeVersion",
  "backend",
  "backendVersionAuthority",
] as const;
const COMPONENT_KEYS = ["id", "version", "delivery", "lifecycle"] as const;
const DELIVERIES = ["bundled", "local", "sidecar"] as const;
const DEFERRED_LIFECYCLES = [
  "deferred-lot-2",
  "deferred-lot-3",
  "deferred-lot-4",
] as const;
const VERSION_ALIASES = ["latest", "canary", "nightly"] as const;
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PRODUCT_IDENTIFIER = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9-]*)+$/;
const COMPONENT_ID = /^[a-z][a-z0-9-]*$/;
const MANIFEST_RECOVERY =
  "Replace the embedded component manifest with the exact casys-desktop-components/1.0 document. Pin exact versions and keep deferred components unpinned. Do not use latest, canary, nightly, or another alias.";

export type ComponentDelivery = typeof DELIVERIES[number];
export type ComponentLifecycle = "active" | typeof DEFERRED_LIFECYCLES[number];

export interface ManifestProduct {
  readonly identifier: string;
  readonly name: string;
  readonly version: string;
}

export interface ManifestRuntime {
  readonly denoVersion: string;
  readonly desktopRuntimeVersion: string;
  readonly backend: "webview";
  readonly backendVersionAuthority: "operating-system";
}

export interface ManifestComponent {
  readonly id: string;
  readonly version: string | null;
  readonly delivery: ComponentDelivery;
  readonly lifecycle: ComponentLifecycle;
}

export interface ComponentManifest {
  readonly schemaVersion: typeof COMPONENT_MANIFEST_SCHEMA_VERSION;
  readonly product: ManifestProduct;
  readonly runtime: ManifestRuntime;
  readonly components: readonly ManifestComponent[];
}

export function validateComponentManifest(
  value: unknown,
): HostResult<ComponentManifest> {
  const root = exactRecord(value, ROOT_KEYS, "manifest");
  if (!root.ok) return root;

  if (root.value.schemaVersion !== COMPONENT_MANIFEST_SCHEMA_VERSION) {
    return fail(
      "manifest.schema-invalid",
      `manifest.schemaVersion must be ${COMPONENT_MANIFEST_SCHEMA_VERSION}`,
      MANIFEST_RECOVERY,
    );
  }

  const product = readProduct(root.value.product);
  if (!product.ok) return product;

  const runtime = readRuntime(root.value.runtime);
  if (!runtime.ok) return runtime;

  if (!Array.isArray(root.value.components)) {
    return fail(
      "manifest.schema-invalid",
      "manifest.components must be an array",
      MANIFEST_RECOVERY,
    );
  }

  const components: ManifestComponent[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of root.value.components.entries()) {
    const component = readComponent(entry, `manifest.components[${index}]`);
    if (!component.ok) return component;
    if (seen.has(component.value.id)) {
      return fail(
        "manifest.duplicate-id",
        `manifest.components must not contain duplicate id ${component.value.id}`,
        MANIFEST_RECOVERY,
      );
    }
    seen.add(component.value.id);
    components.push(component.value);
  }

  const shell = components.find((component) =>
    component.id === DESKTOP_SHELL_COMPONENT_ID
  );
  if (
    shell === undefined ||
    shell.lifecycle !== "active" ||
    shell.delivery !== "bundled"
  ) {
    return fail(
      "manifest.lifecycle-inconsistent",
      "manifest.components must include an active bundled desktop-shell",
      MANIFEST_RECOVERY,
    );
  }
  if (shell.version !== product.value.version) {
    return fail(
      "manifest.lifecycle-inconsistent",
      "the active desktop-shell version must equal manifest.product.version",
      MANIFEST_RECOVERY,
    );
  }

  return ok(deepFreeze({
    schemaVersion: COMPONENT_MANIFEST_SCHEMA_VERSION,
    product: product.value,
    runtime: runtime.value,
    components,
  }));
}

function readProduct(value: unknown): HostResult<ManifestProduct> {
  const record = exactRecord(value, PRODUCT_KEYS, "manifest.product");
  if (!record.ok) {
    return fail("manifest.product-invalid", record.error.message, MANIFEST_RECOVERY);
  }

  const identifier = text(record.value.identifier, "manifest.product.identifier");
  if (!identifier.ok) {
    return fail(
      "manifest.product-invalid",
      identifier.error.message,
      MANIFEST_RECOVERY,
    );
  }
  if (!PRODUCT_IDENTIFIER.test(identifier.value)) {
    return fail(
      "manifest.product-invalid",
      "manifest.product.identifier must be a reverse-DNS product id",
      MANIFEST_RECOVERY,
    );
  }

  const name = text(record.value.name, "manifest.product.name");
  if (!name.ok) {
    return fail("manifest.product-invalid", name.error.message, MANIFEST_RECOVERY);
  }

  const version = exactVersion(record.value.version, "manifest.product.version");
  if (!version.ok) return version;

  return ok({
    identifier: identifier.value,
    name: name.value,
    version: version.value,
  });
}

function readRuntime(value: unknown): HostResult<ManifestRuntime> {
  const record = exactRecord(value, RUNTIME_KEYS, "manifest.runtime");
  if (!record.ok) {
    return fail("manifest.runtime-invalid", record.error.message, MANIFEST_RECOVERY);
  }

  const denoVersion = exactVersion(
    record.value.denoVersion,
    "manifest.runtime.denoVersion",
  );
  if (!denoVersion.ok) return denoVersion;

  const desktopRuntimeVersion = exactVersion(
    record.value.desktopRuntimeVersion,
    "manifest.runtime.desktopRuntimeVersion",
  );
  if (!desktopRuntimeVersion.ok) return desktopRuntimeVersion;

  if (record.value.backend !== "webview") {
    return fail(
      "manifest.runtime-invalid",
      'manifest.runtime.backend must be "webview"',
      MANIFEST_RECOVERY,
    );
  }
  if (record.value.backendVersionAuthority !== "operating-system") {
    return fail(
      "manifest.runtime-invalid",
      'manifest.runtime.backendVersionAuthority must be "operating-system"',
      MANIFEST_RECOVERY,
    );
  }

  return ok({
    denoVersion: denoVersion.value,
    desktopRuntimeVersion: desktopRuntimeVersion.value,
    backend: "webview",
    backendVersionAuthority: "operating-system",
  });
}

function readComponent(
  value: unknown,
  path: string,
): HostResult<ManifestComponent> {
  const record = exactRecord(value, COMPONENT_KEYS, path);
  if (!record.ok) {
    return fail("manifest.component-invalid", record.error.message, MANIFEST_RECOVERY);
  }

  const id = text(record.value.id, `${path}.id`);
  if (!id.ok) {
    return fail("manifest.component-invalid", id.error.message, MANIFEST_RECOVERY);
  }
  if (!COMPONENT_ID.test(id.value)) {
    return fail(
      "manifest.component-invalid",
      `${path}.id must be a lowercase kebab-case identifier`,
      MANIFEST_RECOVERY,
    );
  }

  const delivery = record.value.delivery;
  if (!isDelivery(delivery)) {
    return fail(
      "manifest.component-invalid",
      `${path}.delivery must be bundled, local, or sidecar`,
      MANIFEST_RECOVERY,
    );
  }

  const lifecycle = record.value.lifecycle;
  if (lifecycle !== "active" && !isDeferredLifecycle(lifecycle)) {
    return fail(
      "manifest.lifecycle-inconsistent",
      `${path}.lifecycle must be active or a future deferred lot`,
      MANIFEST_RECOVERY,
    );
  }

  const version = readComponentVersion(
    record.value.version,
    `${path}.version`,
    id.value,
    lifecycle,
    delivery,
  );
  if (!version.ok) return version;

  return ok({
    id: id.value,
    version: version.value,
    delivery,
    lifecycle,
  });
}

function readComponentVersion(
  value: unknown,
  path: string,
  id: string,
  lifecycle: ComponentLifecycle,
  delivery: ComponentDelivery,
): HostResult<string | null> {
  if (lifecycle === "active") {
    if (value === null) {
      return fail(
        "manifest.unpinned-active",
        `${id} is an active ${delivery} executable and must pin an exact version`,
        MANIFEST_RECOVERY,
      );
    }
    return exactVersion(value, path);
  }

  if (value !== null) {
    if (typeof value === "string" && isVersionAlias(value)) {
      return fail(
        "manifest.version-alias",
        `${path} must not be the alias ${value.toLowerCase()}`,
        MANIFEST_RECOVERY,
      );
    }
    return fail(
      "manifest.lifecycle-inconsistent",
      `${id} is ${lifecycle} and must leave version null until that lot observes it`,
      MANIFEST_RECOVERY,
    );
  }

  return ok(null);
}

function exactVersion(value: unknown, path: string): HostResult<string> {
  if (typeof value === "string" && isVersionAlias(value)) {
    return fail(
      "manifest.version-alias",
      `${path} must not be the alias ${value.toLowerCase()}`,
      MANIFEST_RECOVERY,
    );
  }
  if (typeof value !== "string" || !EXACT_VERSION.test(value)) {
    return fail(
      "manifest.version-invalid",
      `${path} must be an exact MAJOR.MINOR.PATCH version`,
      MANIFEST_RECOVERY,
    );
  }
  return ok(value);
}

function isVersionAlias(value: string): boolean {
  return (VERSION_ALIASES as readonly string[]).includes(value.toLowerCase());
}

function isDelivery(value: unknown): value is ComponentDelivery {
  return (DELIVERIES as readonly unknown[]).includes(value);
}

function isDeferredLifecycle(
  value: unknown,
): value is typeof DEFERRED_LIFECYCLES[number] {
  return (DEFERRED_LIFECYCLES as readonly unknown[]).includes(value);
}

function text(value: unknown, path: string): HostResult<string> {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    return fail(
      "manifest.schema-invalid",
      `${path} must be a non-empty string without edge whitespace`,
      MANIFEST_RECOVERY,
    );
  }
  return ok(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): HostResult<Record<string, unknown>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "manifest.schema-invalid",
      `${path} must be an object`,
      MANIFEST_RECOVERY,
    );
  }
  const record = value as Record<string, unknown>;
  const expected = new Set(keys);
  for (const key of Object.keys(record)) {
    if (!expected.has(key)) {
      return fail(
        "manifest.schema-invalid",
        `${path} has unsupported field ${key}`,
        MANIFEST_RECOVERY,
      );
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) {
      return fail(
        "manifest.schema-invalid",
        `${path}.${key} is required`,
        MANIFEST_RECOVERY,
      );
    }
  }
  return ok(record);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (Array.isArray(value)) {
      for (const item of value) deepFreeze(item);
    } else {
      for (const item of Object.values(value as Record<string, unknown>)) {
        deepFreeze(item);
      }
    }
  }
  return value;
}
