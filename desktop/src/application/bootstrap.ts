import type {
  DesktopControlPlaneProjection,
  DesktopShellViewModel,
  DesktopWorkbenchProjection,
} from "../contracts/diagnostics.ts";
import {
  CONTROL_PLANE_PRODUCT_IDENTIFIER,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
} from "../control-plane/contracts.ts";
import {
  type ApplicationSupportLayout,
  type ComponentManifest,
  deriveDesktopShellViewModel,
  type DesktopPlatform,
  type EnvironmentReader,
  type HostResult,
  resolveApplicationSupportLayout,
  validateComponentManifest,
} from "../host/mod.ts";
import { WORKBENCH_VERSION } from "../workbench/contracts.ts";

export interface DesktopBootstrapInput {
  readonly manifest: unknown;
  readonly actualDenoVersion: string;
  /** Deno Desktop is shipped by the same pinned Deno runtime binary. */
  readonly actualDesktopRuntimeVersion: string;
  /** Product release baked by `deno desktop` and exposed as Deno.desktopVersion. */
  readonly actualProductVersion: string | null;
  readonly platform: DesktopPlatform;
  readonly env: EnvironmentReader;
  readonly controlPlane?: DesktopControlPlaneProjection;
  readonly workbench?: DesktopWorkbenchProjection;
}

export interface DesktopBootstrapFacts {
  readonly manifest: HostResult<ComponentManifest>;
  readonly layout: HostResult<ApplicationSupportLayout>;
  readonly actualDenoVersion: string;
  readonly actualDesktopRuntimeVersion: string;
  readonly actualProductVersion: string | null;
  readonly platform: DesktopPlatform;
  /** Exact product and active control-plane declaration, independent of runtime. */
  readonly controlPlanePinValid: boolean;
  /** True only when every host pin and the packaged sidecar declaration agree. */
  readonly controlPlaneLaunchable: boolean;
  readonly workbenchPinValid: boolean;
  readonly workbenchLaunchable: boolean;
  readonly controlPlaneVersion?: string;
}

/**
 * Validates host facts once, before any subprocess is considered. A malformed
 * manifest, wrong runtime, unresolved layout, or non-sidecar declaration leaves
 * the control plane unlaunchable.
 */
export function inspectDesktopBootstrap(
  input: Omit<DesktopBootstrapInput, "controlPlane">,
): DesktopBootstrapFacts {
  const manifest = validateComponentManifest(input.manifest);
  const productIdentifier = manifest.ok
    ? manifest.value.product.identifier
    : CONTROL_PLANE_PRODUCT_IDENTIFIER;
  const layout = resolveApplicationSupportLayout({
    platform: input.platform,
    productIdentifier,
    env: input.env,
  });

  const controlPlane = manifest.ok
    ? manifest.value.components.find((component) =>
      component.id === "casys-control-plane"
    )
    : undefined;
  const workbench = manifest.ok
    ? manifest.value.components.find((component) =>
      component.id === "workbench-projection"
    )
    : undefined;
  const runtimeMatches = manifest.ok &&
    input.actualDenoVersion.trim() === manifest.value.runtime.denoVersion &&
    input.actualDesktopRuntimeVersion.trim() ===
      manifest.value.runtime.desktopRuntimeVersion &&
    (input.actualProductVersion?.trim() ?? "") === manifest.value.product.version;
  const controlPlanePinValid = manifest.ok &&
    manifest.value.product.identifier === CONTROL_PLANE_PRODUCT_IDENTIFIER &&
    manifest.value.product.version === CONTROL_PLANE_PRODUCT_VERSION &&
    controlPlane?.lifecycle === "active" &&
    controlPlane.delivery === "sidecar" &&
    controlPlane.version === CONTROL_PLANE_SERVER_VERSION;
  const controlPlaneLaunchable = runtimeMatches && layout.ok && controlPlanePinValid;
  const workbenchPinValid = manifest.ok &&
    workbench?.lifecycle === "active" && workbench.delivery === "sidecar" &&
    workbench.version === WORKBENCH_VERSION;
  const workbenchLaunchable = runtimeMatches && layout.ok && workbenchPinValid;

  return Object.freeze({
    manifest,
    layout,
    actualDenoVersion: input.actualDenoVersion,
    actualDesktopRuntimeVersion: input.actualDesktopRuntimeVersion,
    actualProductVersion: input.actualProductVersion,
    platform: input.platform,
    controlPlanePinValid,
    controlPlaneLaunchable,
    workbenchPinValid,
    workbenchLaunchable,
    ...(controlPlaneLaunchable
      ? { controlPlaneVersion: CONTROL_PLANE_SERVER_VERSION }
      : {}),
  });
}

/** Builds the only renderer input from already validated host facts. */
export function bootstrapDesktopShellFromFacts(
  facts: DesktopBootstrapFacts,
  controlPlane?: DesktopControlPlaneProjection,
  workbench?: DesktopWorkbenchProjection,
): DesktopShellViewModel {
  return deriveDesktopShellViewModel({
    manifest: facts.manifest,
    actualDenoVersion: facts.actualDenoVersion,
    actualDesktopRuntimeVersion: facts.actualDesktopRuntimeVersion,
    actualProductVersion: facts.actualProductVersion,
    platform: facts.platform,
    layout: facts.layout,
    controlPlane,
    workbench,
  });
}

/** Convenience wrapper retained for tests and callers that need no lifecycle seam. */
export function bootstrapDesktopShell(
  input: DesktopBootstrapInput,
): DesktopShellViewModel {
  const facts = inspectDesktopBootstrap(input);
  return bootstrapDesktopShellFromFacts(
    facts,
    input.controlPlane,
    input.workbench,
  );
}
