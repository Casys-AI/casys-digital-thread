export { classifyShellStatus, HOST_CRITICAL_COMPONENT_IDS } from "./classify.ts";
export {
  type ApplicationSupportLayout,
  type DesktopPlatform,
  type EnvironmentReader,
  type LayoutEnvironmentName,
  resolveApplicationSupportLayout,
  type ResolveApplicationSupportLayoutInput,
} from "./layout.ts";
export {
  COMPONENT_MANIFEST_SCHEMA_VERSION,
  type ComponentDelivery,
  type ComponentLifecycle,
  type ComponentManifest,
  DESKTOP_SHELL_COMPONENT_ID,
  type ManifestComponent,
  type ManifestProduct,
  type ManifestRuntime,
  validateComponentManifest,
} from "./manifest.ts";
export { fail, type HostFailure, type HostResult, ok } from "./result.ts";
export {
  deriveDesktopShellViewModel,
  type DesktopShellObservations,
} from "./view-model.ts";
