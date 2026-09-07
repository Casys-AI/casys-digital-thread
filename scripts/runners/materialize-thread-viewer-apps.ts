/**
 * Trusted local registrar for exact whole-App viewer bindings.
 *
 * This runner is deliberately outside the read-only Workbench. It consumes a
 * complete explicit catalogue file, then delegates materialization to the
 * reusable adapter. The adapter derives every byte identity, publishes the
 * immutable CAS objects, validates the resulting registry through the same
 * reader used by the BFF, then atomically replaces the registry document.
 */

import { parseArgs } from "../lib/cli.ts";
import {
  DEFAULT_THREAD_VIEWER_APP_OBJECT_DIRECTORY,
  DEFAULT_THREAD_VIEWER_APP_REGISTRY_PATH,
  materializeThreadViewerAppsCatalog,
  type MaterializeThreadViewerAppsResult,
} from "../../src/adapters/thread/thread-viewer-app-materializer.ts";

export {
  DEFAULT_THREAD_VIEWER_APP_OBJECT_DIRECTORY,
  DEFAULT_THREAD_VIEWER_APP_REGISTRY_PATH,
  materializeThreadViewerAppsCatalog,
  THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA,
  ThreadViewerAppRegistryWriteConflictError,
} from "../../src/adapters/thread/thread-viewer-app-materializer.ts";
export type {
  MaterializeThreadViewerAppsCatalogRequest,
  MaterializeThreadViewerAppsResult,
  ThreadViewerAppMaterializationCatalog,
  ThreadViewerAppRegistryPredecessorIdentity,
} from "../../src/adapters/thread/thread-viewer-app-materializer.ts";

export interface MaterializeThreadViewerAppsRequest {
  readonly catalogPath: string;
  readonly registryPath?: string;
  readonly objectDirectory?: string;
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
  let value: unknown;
  try {
    value = JSON.parse(await Deno.readTextFile(catalogPath));
  } catch (error) {
    throw new TypeError(
      `Viewer App materialization catalogue is unavailable or invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return await materializeThreadViewerAppsCatalog({
    catalog: value,
    registryPath,
    objectDirectory,
  });
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
