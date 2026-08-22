import type { DesktopShellViewModel } from "../contracts/diagnostics.ts";
import {
  deriveDesktopShellViewModel,
  type DesktopPlatform,
  type EnvironmentReader,
  resolveApplicationSupportLayout,
  validateComponentManifest,
} from "../host/mod.ts";

const PACKAGED_PRODUCT_IDENTIFIER = "ai.casys.digital-thread";

export interface DesktopBootstrapInput {
  readonly manifest: unknown;
  readonly actualDenoVersion: string;
  /** Deno Desktop is shipped by the same pinned Deno runtime binary. */
  readonly actualDesktopRuntimeVersion: string;
  /** Product release baked by `deno desktop` and exposed as Deno.desktopVersion. */
  readonly actualProductVersion: string | null;
  readonly platform: DesktopPlatform;
  readonly env: EnvironmentReader;
}

/** Builds the only renderer input from host-owned, observed bootstrap facts. */
export function bootstrapDesktopShell(
  input: DesktopBootstrapInput,
): DesktopShellViewModel {
  const manifest = validateComponentManifest(input.manifest);
  const productIdentifier = manifest.ok
    ? manifest.value.product.identifier
    : PACKAGED_PRODUCT_IDENTIFIER;
  const layout = resolveApplicationSupportLayout({
    platform: input.platform,
    productIdentifier,
    env: input.env,
  });

  return deriveDesktopShellViewModel({
    manifest,
    actualDenoVersion: input.actualDenoVersion,
    actualDesktopRuntimeVersion: input.actualDesktopRuntimeVersion,
    actualProductVersion: input.actualProductVersion,
    platform: input.platform,
    layout,
  });
}
