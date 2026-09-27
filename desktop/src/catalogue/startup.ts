import { CONTROL_PLANE_PRODUCT_IDENTIFIER } from "../control-plane/contracts.ts";
import {
  type DesktopPlatform,
  type EnvironmentReader,
  resolveApplicationSupportLayout,
} from "../host/mod.ts";
import { ToolRuntimeHost } from "../tool-runtime/backend.ts";
import { CatalogueService } from "./service.ts";

export interface CatalogueStartupInput {
  readonly platform: DesktopPlatform;
  readonly env: EnvironmentReader;
}

/**
 * Starts the catalogue service against the product support directory.
 * Returns undefined on any failure: Desktop boots without the catalogue
 * and the bindings report it unavailable, never blocking chat.
 */
export async function startCatalogueService(
  input: CatalogueStartupInput,
): Promise<CatalogueService | undefined> {
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
    return new CatalogueService({
      backend: new ToolRuntimeHost({ dataDirectory }),
      defaultsPath: `${dataDirectory}${separator}catalogue-defaults.json`,
    });
  } catch {
    return undefined;
  }
}
