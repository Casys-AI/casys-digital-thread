import {
  CONFIG_DIGEST_PATTERN,
  CONTROL_PLANE_ENDPOINT,
  joinWorkspace,
  LAUNCH_ID_PATTERN,
  type LaunchMarker,
  MARKER_RELATIVE_PATH,
  MARKER_SCHEMA,
  PRODUCT_VERSION,
  SERVER_VERSION,
  SidecarFailure,
} from "./contracts.ts";
import { exactRecord, parseJsonObject } from "./json.ts";

const MARKER_KEYS = [
  "schema",
  "productVersion",
  "serverVersion",
  "launchId",
  "pid",
  "endpoint",
  "configDigest",
  "startedAt",
] as const;

export function workspaceMarkerPath(workspaceRoot: string): string {
  return joinWorkspace(workspaceRoot, MARKER_RELATIVE_PATH);
}

export function parseLaunchMarker(text: string): LaunchMarker {
  const parsed = parseJsonObject(text, "marker", "marker.corrupt");
  const record = exactRecord(parsed, MARKER_KEYS, "marker", "marker.corrupt");

  if (record.schema !== MARKER_SCHEMA) {
    throw new SidecarFailure(
      "marker.schema-invalid",
      `marker.schema must be ${MARKER_SCHEMA}`,
    );
  }
  if (record.productVersion !== PRODUCT_VERSION) {
    throw new SidecarFailure(
      "marker.product-invalid",
      `marker.productVersion must be ${PRODUCT_VERSION}`,
    );
  }
  if (record.serverVersion !== SERVER_VERSION) {
    throw new SidecarFailure(
      "marker.server-invalid",
      `marker.serverVersion must be ${SERVER_VERSION}`,
    );
  }
  if (typeof record.launchId !== "string" || !LAUNCH_ID_PATTERN.test(record.launchId)) {
    throw new SidecarFailure(
      "marker.launch-id-invalid",
      "marker.launchId must be a lowercase UUID",
    );
  }
  if (
    typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) ||
    record.pid <= 0
  ) {
    throw new SidecarFailure(
      "marker.pid-invalid",
      "marker.pid must be a positive integer",
    );
  }
  if (record.endpoint !== CONTROL_PLANE_ENDPOINT) {
    throw new SidecarFailure(
      "marker.endpoint-invalid",
      `marker.endpoint must be ${CONTROL_PLANE_ENDPOINT}`,
    );
  }
  if (
    typeof record.configDigest !== "string" ||
    !CONFIG_DIGEST_PATTERN.test(record.configDigest)
  ) {
    throw new SidecarFailure(
      "marker.digest-invalid",
      "marker.configDigest must be sha256:<64 lowercase hex>",
    );
  }
  if (typeof record.startedAt !== "string" || !isIsoDateTime(record.startedAt)) {
    throw new SidecarFailure(
      "marker.started-at-invalid",
      "marker.startedAt must be an exact UTC ISO-8601 timestamp",
    );
  }

  return {
    schema: MARKER_SCHEMA,
    productVersion: PRODUCT_VERSION,
    serverVersion: SERVER_VERSION,
    launchId: record.launchId,
    pid: record.pid,
    endpoint: CONTROL_PLANE_ENDPOINT,
    configDigest: record.configDigest,
    startedAt: record.startedAt,
  };
}

export function serializeLaunchMarker(marker: LaunchMarker): string {
  return `${
    JSON.stringify({
      schema: marker.schema,
      productVersion: marker.productVersion,
      serverVersion: marker.serverVersion,
      launchId: marker.launchId,
      pid: marker.pid,
      endpoint: marker.endpoint,
      configDigest: marker.configDigest,
      startedAt: marker.startedAt,
    })
  }\n`;
}

export async function writeLaunchMarker(
  path: string,
  marker: LaunchMarker,
): Promise<void> {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  const file = await Deno.open(temporary, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    const bytes = new TextEncoder().encode(serializeLaunchMarker(marker));
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset));
      if (written === 0) {
        throw new SidecarFailure(
          "marker.write-failed",
          "The atomic launch marker temporary file accepted zero bytes.",
        );
      }
      offset += written;
    }
    await file.sync();
  } finally {
    file.close();
  }

  try {
    await Deno.link(temporary, path);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) {
      throw new SidecarFailure(
        "marker.stale-existing",
        "A launch marker already exists and was not overwritten.",
      );
    }
    throw error;
  } finally {
    try {
      await Deno.remove(temporary);
    } catch {
      // The complete target is already published (or the primary error wins).
    }
  }
}

export async function assertMarkerAbsent(path: string): Promise<void> {
  try {
    await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new SidecarFailure(
    "marker.stale-existing",
    "A launch marker already exists; recovery must be reviewed before a new owner starts.",
  );
}

/** Delete the marker only when the on-disk launch id is this owner. */
export async function compareAndDeleteMarker(
  path: string,
  launchId: string,
): Promise<void> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }

  const marker = parseLaunchMarker(text);
  if (marker.launchId !== launchId) {
    throw new SidecarFailure(
      "marker.launch-id-mismatch",
      "The launch marker belongs to a different launch id and was not deleted.",
    );
  }
  await Deno.remove(path);
}

function isIsoDateTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}
