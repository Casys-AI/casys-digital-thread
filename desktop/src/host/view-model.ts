import type {
  ComponentDiagnostic,
  ComponentState,
  DesktopShellViewModel,
} from "../contracts/diagnostics.ts";
import { classifyShellStatus } from "./classify.ts";
import type { ApplicationSupportLayout, DesktopPlatform } from "./layout.ts";
import type { ComponentManifest, ManifestComponent } from "./manifest.ts";
import type { HostResult } from "./result.ts";

export interface DesktopShellObservations {
  readonly manifest: HostResult<ComponentManifest>;
  readonly actualDenoVersion: string;
  readonly actualDesktopRuntimeVersion: string;
  readonly actualProductVersion: string | null;
  readonly platform: DesktopPlatform;
  readonly layout: HostResult<ApplicationSupportLayout>;
}

const FALLBACK_PRODUCT_NAME = "Casys Digital Thread";
const KNOWN_DEFERRED_COMPONENTS = [
  {
    id: "casys-control-plane",
    label: "Casys control plane",
    summary: "The local Casys control plane is unavailable in this Desktop build.",
    evidence: "Desktop 0.1.0 does not start or health-check the local control plane.",
    recovery:
      "Use the existing supervised local workflow until Desktop lifecycle support is installed.",
  },
  {
    id: "engineering-providers",
    label: "Engineering providers",
    summary: "Engineering provider health is unavailable in this Desktop build.",
    evidence:
      "Desktop 0.1.0 does not yet observe the pinned published provider image fleet.",
    recovery:
      "Do not infer provider readiness from this window; use the existing supervised local runtime.",
  },
  {
    id: "workbench-projection",
    label: "Workbench projection",
    summary: "The Workbench projection is unavailable in this Desktop build.",
    evidence: "No read-only Workbench GET + SSE projection is embedded yet.",
    recovery:
      "Open the existing read-only Workbench separately; this window exposes no command route.",
  },
  {
    id: "chat-host",
    label: "Chat host",
    summary: "Embedded chat is unavailable in this Desktop build.",
    evidence: "Desktop 0.1.0 starts no acpx runtime, agent, or chat sidecar.",
    recovery:
      "Use a supported native agent through the bridge until the pinned Chat Host is installed.",
  },
] as const;

const LABELS: Record<string, string> = {
  manifest: "Component manifest",
  runtime: "Deno runtime",
  layout: "Application-support layout",
  "desktop-shell": "Desktop shell",
};

const STATE_ORDER: readonly ComponentState[] = [
  "error",
  "unresolved",
  "unavailable",
  "ready",
];

export function deriveDesktopShellViewModel(
  observations: DesktopShellObservations,
): DesktopShellViewModel {
  const manifestDiagnostic = diagnoseManifest(observations.manifest);
  const runtimeDiagnostic = diagnoseRuntime(observations);
  const layoutDiagnostic = diagnoseLayout(observations.platform, observations.layout);
  const shellDiagnostic = diagnoseShell(
    observations.manifest,
    manifestDiagnostic,
    runtimeDiagnostic,
    layoutDiagnostic,
  );
  const components = [
    manifestDiagnostic,
    runtimeDiagnostic,
    layoutDiagnostic,
    shellDiagnostic,
    ...deferredComponents(observations.manifest),
  ];

  const status = classifyShellStatus(components);
  const product = productIdentity(observations.manifest);
  return sanitizeViewModel({
    productName: product.name,
    productVersion: product.version,
    status,
    title: `Desktop shell is ${status}`,
    summary: summarize(components),
    platform: observations.platform,
    components,
  });
}

function diagnoseManifest(
  manifest: HostResult<ComponentManifest>,
): ComponentDiagnostic {
  if (!manifest.ok) {
    return {
      id: "manifest",
      label: LABELS.manifest,
      state: "error",
      summary: `The component manifest is error: ${manifest.error.message}`,
      evidence: `${manifest.error.code}: ${manifest.error.message}`,
      recovery: manifest.error.recovery,
    };
  }
  return {
    id: "manifest",
    label: LABELS.manifest,
    state: "ready",
    summary: "The embedded component manifest is ready.",
    evidence:
      `Validated ${manifest.value.schemaVersion} for ${manifest.value.product.identifier}.`,
    version: manifest.value.product.version,
  };
}

function diagnoseRuntime(
  observations: DesktopShellObservations,
): ComponentDiagnostic {
  if (!observations.manifest.ok) {
    return {
      id: "runtime",
      label: LABELS.runtime,
      state: "unresolved",
      summary:
        "The Deno Desktop runtime is unresolved because the manifest pin is missing.",
      evidence:
        "The embedded manifest did not yield pinned Deno, Desktop runtime, and product versions.",
      recovery:
        "Restore a schema-valid exact-version component manifest, then reopen Desktop.",
    };
  }

  const pinnedDeno = observations.manifest.value.runtime.denoVersion;
  const pinnedDesktop = observations.manifest.value.runtime.desktopRuntimeVersion;
  const pinnedProduct = observations.manifest.value.product.version;
  const actualDeno = observations.actualDenoVersion.trim();
  const actualDesktop = observations.actualDesktopRuntimeVersion.trim();
  const actualProduct = observations.actualProductVersion?.trim() ?? "";
  if (
    actualDeno.length === 0 || actualDesktop.length === 0 ||
    actualProduct.length === 0
  ) {
    return {
      id: "runtime",
      label: LABELS.runtime,
      state: "error",
      summary: "The Deno Desktop runtime is error: an observed version is missing.",
      evidence:
        "Bootstrap did not supply actual Deno, Desktop runtime, and product versions.",
      recovery:
        "Reopen Desktop with the pinned Deno Desktop runtime declared in the manifest.",
    };
  }
  if (
    actualDeno !== pinnedDeno || actualDesktop !== pinnedDesktop ||
    actualProduct !== pinnedProduct
  ) {
    return {
      id: "runtime",
      label: LABELS.runtime,
      state: "error",
      summary:
        "The Deno Desktop runtime is error: observed versions do not match the exact pins.",
      evidence:
        `Observed Deno ${actualDeno}, Desktop runtime ${actualDesktop}, and product ${actualProduct}; manifest pins Deno ${pinnedDeno}, Desktop runtime ${pinnedDesktop}, and product ${pinnedProduct}.`,
      recovery:
        `Build product ${pinnedProduct} with Deno Desktop runtime ${pinnedDesktop} and Deno ${pinnedDeno}. Do not use latest, canary, or nightly.`,
    };
  }
  return {
    id: "runtime",
    label: LABELS.runtime,
    state: "ready",
    summary: "The pinned Deno Desktop runtime is ready.",
    evidence:
      `Observed Deno ${actualDeno}, Desktop runtime ${actualDesktop}, and product ${actualProduct}.`,
    version: actualDeno,
  };
}

function diagnoseLayout(
  platform: DesktopPlatform,
  layout: HostResult<ApplicationSupportLayout>,
): ComponentDiagnostic {
  if (!layout.ok) {
    return {
      id: "layout",
      label: LABELS.layout,
      state: "error",
      summary: `The application-support layout is error: ${layout.error.message}`,
      evidence: `${layout.error.code}: ${layout.error.message}`,
      recovery: layout.error.recovery,
    };
  }
  return {
    id: "layout",
    label: LABELS.layout,
    state: "ready",
    summary: `The ${platform} application-support layout is ready.`,
    evidence:
      `Resolved the ${platform} application-support layout with separate config, thread, CAS, experience, journals, logs, cache, and runtime paths.`,
  };
}

function diagnoseShell(
  manifest: HostResult<ComponentManifest>,
  manifestDiagnostic: ComponentDiagnostic,
  runtimeDiagnostic: ComponentDiagnostic,
  layoutDiagnostic: ComponentDiagnostic,
): ComponentDiagnostic {
  const hostReady = [manifestDiagnostic, runtimeDiagnostic, layoutDiagnostic].every(
    (component) => component.state === "ready",
  );
  const version = manifest.ok
    ? manifest.value.components.find((component) => component.id === "desktop-shell")
      ?.version ?? undefined
    : undefined;
  if (hostReady) {
    return {
      id: "desktop-shell",
      label: LABELS["desktop-shell"],
      state: "ready",
      summary: "The Desktop shell is ready.",
      evidence: "Manifest, runtime, and layout observations are ready.",
      version,
    };
  }
  return {
    id: "desktop-shell",
    label: LABELS["desktop-shell"],
    state: "error",
    summary: "The Desktop shell is error because a host observation is not ready.",
    evidence: "Manifest, runtime, or layout evidence is not ready.",
    recovery:
      "Restore a valid exact-version manifest, the pinned Deno Desktop runtime, and a platform application-support layout.",
    version,
  };
}

function deferredComponents(
  manifest: HostResult<ComponentManifest>,
): ComponentDiagnostic[] {
  const fromManifest = manifest.ok
    ? manifest.value.components.filter((component) => component.id !== "desktop-shell")
    : [];
  const seen = new Set<string>();
  const diagnostics: ComponentDiagnostic[] = [];

  for (const spec of KNOWN_DEFERRED_COMPONENTS) {
    seen.add(spec.id);
    const declared = fromManifest.find((component) => component.id === spec.id);
    diagnostics.push(unavailableComponent(spec, declared));
  }

  for (const component of fromManifest) {
    if (seen.has(component.id)) continue;
    seen.add(component.id);
    if (component.lifecycle === "active") {
      diagnostics.push({
        id: component.id,
        label: labelFor(component.id),
        state: "unresolved",
        summary: `${component.id} is unresolved because Lot 1 does not observe it.`,
        evidence:
          `${component.id} is active in the manifest but has no Lot 1 observation.`,
        recovery: "Do not treat an unobserved active component as ready.",
        version: component.version ?? undefined,
      });
      continue;
    }
    diagnostics.push({
      id: component.id,
      label: labelFor(component.id),
      state: "unavailable",
      summary: `${component.id} is unavailable.`,
      evidence: `${component.id} is ${component.lifecycle} in the embedded manifest.`,
      recovery:
        "Wait for the declared lot. Do not start this component from the Desktop shell.",
    });
  }

  return diagnostics;
}

function unavailableComponent(
  spec: typeof KNOWN_DEFERRED_COMPONENTS[number],
  declared: ManifestComponent | undefined,
): ComponentDiagnostic {
  return {
    id: spec.id,
    label: spec.label,
    state: "unavailable",
    summary: spec.summary,
    evidence: declared
      ? `${declared.id} is ${declared.lifecycle} with delivery ${declared.delivery}.`
      : spec.evidence,
    recovery: spec.recovery,
  };
}

function productIdentity(
  manifest: HostResult<ComponentManifest>,
): { name: string; version: string } {
  if (!manifest.ok) {
    return { name: FALLBACK_PRODUCT_NAME, version: "unresolved" };
  }
  return {
    name: manifest.value.product.name,
    version: manifest.value.product.version,
  };
}

function summarize(components: readonly ComponentDiagnostic[]): string {
  const parts: string[] = [];
  for (const state of STATE_ORDER) {
    const ids = components
      .filter((component) => component.state === state)
      .map((component) => component.id);
    if (ids.length === 0) continue;
    const verb = ids.length === 1 ? "is" : "are";
    parts.push(`${ids.join(", ")} ${verb} ${state}`);
  }
  return `${parts.join(". ")}.`;
}

function labelFor(id: string): string {
  return LABELS[id] ?? id;
}

function sanitizeViewModel(model: DesktopShellViewModel): DesktopShellViewModel {
  return Object.freeze({
    productName: sanitizeText(model.productName),
    productVersion: sanitizeText(model.productVersion),
    status: model.status,
    title: sanitizeText(model.title),
    summary: sanitizeText(model.summary),
    platform: model.platform,
    components: Object.freeze(model.components.map(sanitizeComponent)),
  });
}

function sanitizeComponent(component: ComponentDiagnostic): ComponentDiagnostic {
  return Object.freeze({
    id: sanitizeText(component.id),
    label: sanitizeText(component.label),
    state: component.state,
    summary: sanitizeText(component.summary),
    evidence: sanitizeText(component.evidence),
    ...(component.recovery === undefined
      ? {}
      : { recovery: sanitizeText(component.recovery) }),
    ...(component.version === undefined
      ? {}
      : { version: sanitizeText(component.version) }),
  });
}

function sanitizeText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "[local-path]")
    .replace(
      /(^|[=\s"'`(])(\/(?:Users|home|var|private|opt|tmp|etc)\/[^\s"']+)/g,
      "$1[local-path]",
    );
}
