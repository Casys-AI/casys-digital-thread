import { CONTROL_PLANE_PRODUCT_IDENTIFIER } from "../control-plane/contracts.ts";
import {
  type DesktopPlatform,
  type EnvironmentReader,
  resolveApplicationSupportLayout,
} from "../host/mod.ts";
import { ToolRuntimeHost } from "../tool-runtime/backend.ts";
import { ToolRuntimeLifecycle } from "../tool-runtime/lifecycle.ts";
import { CatalogueService } from "./service.ts";

export interface CatalogueStartupInput {
  readonly platform: DesktopPlatform;
  readonly env: EnvironmentReader;
  /** Fired after a provider stops (idle, explicit, or drain). Best-effort. */
  readonly onProviderStopped?: (toolId: string) => void;
}

export interface CatalogueStartup {
  readonly service: CatalogueService;
  readonly lifecycle: ToolRuntimeLifecycle;
}

/**
 * Starts the catalogue service and its provider lifecycle against the
 * product support directory. Returns undefined on any failure: Desktop
 * boots without the catalogue and the bindings report it unavailable,
 * never blocking chat.
 */
export async function startCatalogueService(
  input: CatalogueStartupInput,
): Promise<CatalogueStartup | undefined> {
  try {
    const layout = resolveApplicationSupportLayout({
      platform: input.platform,
      productIdentifier: CONTROL_PLANE_PRODUCT_IDENTIFIER,
      env: input.env,
    });
    if (!layout.ok) return undefined;
    const separator = input.platform === "Windows" ? "\\" : "/";
    const dataDirectory = `${layout.value.root}${separator}tool-runtime`;
    await Deno.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const lifecycle = new ToolRuntimeLifecycle({
      backend: new ToolRuntimeHost({ dataDirectory }),
      dataDirectory,
      ...(input.onProviderStopped === undefined
        ? {}
        : { onProviderStopped: input.onProviderStopped }),
    });
    return {
      service: new CatalogueService({
        backend: lifecycle,
        defaultsPath: `${dataDirectory}${separator}catalogue-defaults.json`,
      }),
      lifecycle,
    };
  } catch {
    return undefined;
  }
}
