import type {
  ComponentDiagnostic,
  ComponentState,
  DesktopControlPlaneProjection,
  DesktopShellViewModel,
  DesktopWorkbenchProjection,
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
  readonly controlPlane?: DesktopControlPlaneProjection;
  readonly workbench?: DesktopWorkbenchProjection;
}

const FALLBACK_PRODUCT_NAME = "Casys Digital Thread";
const KNOWN_DEFERRED_COMPONENTS = [
  {
    id: "casys-control-plane",
    label: "Casys control plane",
    summary: "The local Casys control plane is unavailable in this Desktop build.",
    evidence: "No exact control-plane lifecycle observation reached the shell.",
    recovery:
      "Use the existing supervised local workflow until Desktop lifecycle support is installed.",
  },
  {
    id: "engineering-providers",
    label: "Engineering providers",
    summary: "Engineering provider health is unavailable in this Desktop build.",
    evidence: "No exact console_snapshot provider observation reached the shell.",
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
    evidence: "Desktop 0.3.0 starts no acpx runtime, agent, or chat sidecar.",
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
  const controlPlaneDiagnostics = observations.controlPlane === undefined
    ? []
    : diagnoseControlPlane(
      observations.manifest,
      observations.controlPlane,
    );
  const workbenchDiagnostics = observations.workbench === undefined
    ? []
    : [diagnoseWorkbench(observations.manifest, observations.workbench)];
  const projectedIds = new Set(
    [...controlPlaneDiagnostics, ...workbenchDiagnostics].map((component) =>
      component.id
    ),
  );
  const components = [
    manifestDiagnostic,
    runtimeDiagnostic,
    layoutDiagnostic,
    shellDiagnostic,
    ...controlPlaneDiagnostics,
    ...workbenchDiagnostics,
    ...deferredComponents(observations.manifest, projectedIds),
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

function diagnoseWorkbench(
  manifest: HostResult<ComponentManifest>,
  projection: DesktopWorkbenchProjection,
): ComponentDiagnostic {
  const declared = manifest.ok
    ? manifest.value.components.find((component) =>
      component.id === "workbench-projection"
    )
    : undefined;
  if (
    declared === undefined || declared.lifecycle !== "active" ||
    declared.delivery !== "sidecar" || declared.version === null
  ) {
    return {
      id: "workbench-projection",
      label: "Workbench projection",
      state: "error",
      summary: "The Workbench projection manifest declaration is error.",
      evidence:
        "Desktop requires one active, exact-version, sidecar Workbench projection.",
      recovery: "Restore the exact packaged Workbench component declaration.",
    };
  }
  if (
    (projection.lifecycle === "owned-ready" ||
      projection.lifecycle === "reconnected-ready") &&
    projection.version === declared.version
  ) {
    return {
      id: "workbench-projection",
      label: "Workbench projection",
      state: "ready",
      summary: "The read-only Workbench projection is ready.",
      evidence: projection.lifecycle === "owned-ready"
        ? "Desktop owns the exact GET and SSE Workbench helper lifecycle."
        : "Desktop reconnected to the exact read-only Workbench helper lifecycle.",
      version: declared.version,
    };
  }
  if (
    projection.lifecycle === "owned-ready" ||
    projection.lifecycle === "reconnected-ready"
  ) {
    return {
      id: "workbench-projection",
      label: "Workbench projection",
      state: "error",
      summary: "The Workbench projection version is error.",
      evidence: "The observed helper version does not match the manifest pin.",
      recovery: "Restore the exact packaged Workbench helper.",
    };
  }
  if (projection.lifecycle === "unavailable") {
    return {
      id: "workbench-projection",
      label: "Workbench projection",
      state: "unavailable",
      summary: "The read-only Workbench projection is unavailable.",
      evidence: workbenchRecoveryEvidence(projection.recoveryCode),
      recovery:
        "Restore the persisted workspace or packaged helper; do not seed a fallback project.",
    };
  }
  return {
    id: "workbench-projection",
    label: "Workbench projection",
    state: "error",
    summary: "The Workbench projection requires lifecycle recovery.",
    evidence: workbenchRecoveryEvidence(projection.recoveryCode),
    recovery:
      "Resolve the exact helper conflict. Desktop will not adopt or stop an unowned process.",
  };
}

function workbenchRecoveryEvidence(
  code: DesktopWorkbenchProjection["recoveryCode"],
): string {
  switch (code) {
    case "configuration-unavailable":
      return "The persisted control-plane workspace is literally unavailable.";
    case "helper-unavailable":
      return "The pinned packaged Workbench helper is unavailable.";
    case "listener-conflict":
      return "The private Workbench loopback listener is occupied without exact ownership.";
    case "manifest-mismatch":
      return "The packaged Workbench declaration does not match the exact installed pin.";
    case "marker-invalid":
      return "The Workbench marker, token, and held lock do not agree.";
    case "permission-denied":
      return "The selected layout is outside the current packaged helper filesystem grant.";
    case "probe-failed":
      return "The private Workbench listener state is ambiguous; absence was not proven.";
    case "startup-failed":
      return "The owned Workbench helper failed before exact readiness.";
    case "termination-unresolved":
      return "The owned Workbench helper has not produced terminal process status after bounded shutdown escalation.";
    default:
      return "No exact Workbench lifecycle observation is available.";
  }
}

function diagnoseControlPlane(
  manifest: HostResult<ComponentManifest>,
  projection: DesktopControlPlaneProjection,
): ComponentDiagnostic[] {
  const declared = manifest.ok
    ? manifest.value.components.find((component) =>
      component.id === "casys-control-plane"
    )
    : undefined;
  const configuration = diagnoseDesktopConfiguration(projection);
  const lifecycle = diagnoseControlPlaneLifecycle(projection, declared);
  return [
    configuration,
    lifecycle,
    diagnoseProviders(projection),
    diagnosePersistedEvidence(projection),
  ];
}

function diagnoseDesktopConfiguration(
  projection: DesktopControlPlaneProjection,
): ComponentDiagnostic {
  switch (projection.configuration) {
    case "verified":
      return {
        id: "desktop-configuration",
        label: "Desktop configuration",
        state: "ready",
        summary: "The local Desktop configuration is ready.",
        evidence:
          "The embedded inputs and materialized configuration have the same exact digest.",
      };
    case "missing":
      return configurationFailure(
        "unavailable",
        "The local Desktop configuration is unavailable.",
        "No materialized configuration was observed.",
      );
    case "mismatch":
      return configurationFailure(
        "error",
        "The local Desktop configuration is error: its digest does not match.",
        "The materialized configuration differs from the pinned embedded inputs.",
      );
    case "error":
      return configurationFailure(
        "error",
        "The local Desktop configuration is error.",
        "Configuration materialization or verification failed.",
      );
  }
}

function configurationFailure(
  state: "unavailable" | "error",
  summary: string,
  evidence: string,
): ComponentDiagnostic {
  return {
    id: "desktop-configuration",
    label: "Desktop configuration",
    state,
    summary,
    evidence,
    recovery:
      "Restore the pinned Desktop configuration. Do not replace it with checkout state or an unverified file.",
  };
}

function diagnoseControlPlaneLifecycle(
  projection: DesktopControlPlaneProjection,
  declared: ManifestComponent | undefined,
): ComponentDiagnostic {
  if (
    declared === undefined || declared.lifecycle !== "active" ||
    declared.version === null
  ) {
    return {
      id: "casys-control-plane",
      label: "Casys control plane",
      state: "error",
      summary:
        "The local Casys control plane is error: its active manifest pin is missing.",
      evidence:
        "A runtime observation exists without an active exact-version component declaration.",
      recovery:
        "Restore the exact active casys-control-plane component manifest entry.",
    };
  }
  const version = projection.controlPlaneVersion;
  const requiresObservedVersion = projection.lifecycle === "owned-ready" ||
    projection.lifecycle === "reconnected-ready";
  if (requiresObservedVersion && version !== declared.version) {
    return {
      id: "casys-control-plane",
      label: "Casys control plane",
      state: "error",
      summary:
        "The local Casys control plane is error: its observed version does not match the pin.",
      evidence: `The observed version does not match manifest pin ${declared.version}.`,
      recovery:
        "Install and start only the exact control-plane helper pinned by this Desktop release.",
    };
  }

  switch (projection.lifecycle) {
    case "owned-ready":
      return readyControlPlane(
        declared.version,
        "The exact Desktop-owned control plane is ready.",
      );
    case "reconnected-ready":
      return readyControlPlane(
        declared.version,
        "The exact control plane owned by the running Desktop installation is ready.",
      );
    case "starting":
      return {
        id: "casys-control-plane",
        label: "Casys control plane",
        state: "unresolved",
        summary: "The local Casys control plane is unresolved while it starts.",
        evidence: "Lifecycle ownership is established; exact MCP readiness is pending.",
        recovery: "Wait for the bounded readiness check to complete.",
      };
    case "unavailable":
      return {
        id: "casys-control-plane",
        label: "Casys control plane",
        state: "unavailable",
        summary: "The local Casys control plane is unavailable.",
        evidence: "No exact owned or reconnectable control plane was observed.",
        recovery: "Restore the pinned packaged helper, then reopen Desktop.",
      };
    case "recovery-required":
      return {
        id: "casys-control-plane",
        label: "Casys control plane",
        state: "error",
        summary: "The local Casys control plane is error and requires recovery.",
        evidence: recoveryEvidence(projection.recoveryCode),
        recovery:
          "Resolve the exact lifecycle conflict. Desktop will not adopt, replace, or stop an unowned process.",
      };
  }
}

function readyControlPlane(
  version: string,
  evidence: string,
): ComponentDiagnostic {
  return {
    id: "casys-control-plane",
    label: "Casys control plane",
    state: "ready",
    summary: "The local Casys control plane is ready.",
    evidence,
    version,
  };
}

function recoveryEvidence(
  code: DesktopControlPlaneProjection["recoveryCode"],
): string {
  const evidence: Record<
    NonNullable<DesktopControlPlaneProjection["recoveryCode"]>,
    string
  > = {
    "config-mismatch": "The materialized configuration digest does not match.",
    "foreign-listener":
      "The canonical loopback endpoint is occupied without exact Desktop ownership.",
    "helper-unavailable": "The pinned packaged helper could not be executed.",
    "manifest-mismatch":
      "The product or control-plane component does not match the exact installed pin.",
    "marker-invalid": "The lifecycle ownership marker is invalid or ambiguous.",
    "permission-denied": "A required scoped Deno permission was denied.",
    "probe-failed": "Exact MCP identity or readiness verification failed.",
    "startup-failed": "The owned helper failed before exact readiness.",
  };
  return code === undefined
    ? "The lifecycle controller reported a fail-closed recovery state."
    : evidence[code];
}

function diagnoseProviders(
  projection: DesktopControlPlaneProjection,
): ComponentDiagnostic {
  if (!validProviderCounts(projection.providers)) {
    return {
      id: "engineering-providers",
      label: "Engineering providers",
      state: "error",
      summary: "Engineering provider observation is error.",
      evidence: "The fleet observation contains invalid or inconsistent counts.",
      recovery: "Repair the read-only fleet projection; do not infer readiness.",
    };
  }
  const counts = providerCounts(projection.providers);
  switch (projection.providers.state) {
    case "healthy":
      return {
        id: "engineering-providers",
        label: "Engineering providers",
        state: "ready",
        summary: "The pinned engineering provider fleet is ready.",
        evidence: `${counts} Exact loopback MCP observations are healthy.`,
      };
    case "degraded":
      return {
        id: "engineering-providers",
        label: "Engineering providers",
        state: "unresolved",
        summary: "The pinned engineering provider fleet is degraded.",
        evidence: `${counts} One or more exact provider observations are not healthy.`,
        recovery: "Restore the missing pinned provider images or their local services.",
      };
    case "unavailable":
      return {
        id: "engineering-providers",
        label: "Engineering providers",
        state: "unavailable",
        summary: "The pinned engineering provider fleet is unavailable.",
        evidence: `${counts} No required provider readiness was observed.`,
        recovery:
          "Start the required pinned local providers. The control plane remains available for offline inspection.",
      };
    case "unknown":
      return {
        id: "engineering-providers",
        label: "Engineering providers",
        state: "unresolved",
        summary: "The pinned engineering provider fleet is unresolved.",
        evidence: `${counts} Provider readiness could not be classified exactly.`,
        recovery: "Retry the read-only provider observations.",
      };
    case "error":
      return {
        id: "engineering-providers",
        label: "Engineering providers",
        state: "error",
        summary: "Engineering provider observation is error.",
        evidence: "The read-only fleet observation failed structurally.",
        recovery: "Repair the exact provider observation path; do not infer readiness.",
      };
  }
}

function providerCounts(
  providers: DesktopControlPlaneProjection["providers"],
): string {
  const total = safeCount(providers.total);
  const healthy = safeCount(providers.healthy);
  const drift = safeCount(providers.drift);
  return total === undefined || healthy === undefined || drift === undefined
    ? "Counts are unresolved."
    : `${healthy}/${total} healthy; ${drift} drift.`;
}

function safeCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function validProviderCounts(
  providers: DesktopControlPlaneProjection["providers"],
): boolean {
  const values = [providers.total, providers.healthy, providers.drift];
  if (values.every((value) => value === undefined)) {
    return providers.state === "unavailable" || providers.state === "unknown" ||
      providers.state === "error";
  }
  const [total, healthy, drift] = values.map(safeCount);
  if (total === undefined || healthy === undefined || drift === undefined) {
    return false;
  }
  if (healthy > total) return false;
  if (providers.state === "healthy") return total > 0 && healthy === total;
  if (providers.state === "unavailable") return healthy === 0;
  return true;
}

function diagnosePersistedEvidence(
  projection: DesktopControlPlaneProjection,
): ComponentDiagnostic {
  switch (projection.persistedEvidence) {
    case "verified":
      if (
        projection.lifecycle !== "owned-ready" &&
        projection.lifecycle !== "reconnected-ready"
      ) {
        return {
          id: "persisted-project-evidence",
          label: "Persisted project evidence",
          state: "error",
          summary: "Persisted project evidence observation is error.",
          evidence:
            "Verified evidence was claimed without an exact ready control-plane identity.",
          recovery:
            "Reopen and validate the exact durable record through an owned control plane.",
        };
      }
      return {
        id: "persisted-project-evidence",
        label: "Persisted project evidence",
        state: "ready",
        summary: "Persisted project evidence is ready.",
        evidence: "An exact durable project record was reopened and validated.",
      };
    case "candidate-unverified":
      return {
        id: "persisted-project-evidence",
        label: "Persisted project evidence",
        state: "unresolved",
        summary: "Persisted project evidence is unresolved.",
        evidence:
          "Candidate local records exist, but this projection has not validated exact Thread evidence.",
        recovery: "Open an exact project through the read-only Workbench projection.",
      };
    case "unavailable":
      return {
        id: "persisted-project-evidence",
        label: "Persisted project evidence",
        state: "unavailable",
        summary: "Persisted project evidence is unavailable.",
        evidence: "No exact validated local project evidence was observed.",
        recovery:
          "Create or open a project; directory existence alone is not evidence.",
      };
    case "error":
      return {
        id: "persisted-project-evidence",
        label: "Persisted project evidence",
        state: "error",
        summary: "Persisted project evidence observation is error.",
        evidence: "A candidate durable record could not be validated exactly.",
        recovery: "Repair the durable record; do not fall back to another file.",
      };
  }
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
  skippedIds: ReadonlySet<string> = new Set(),
): ComponentDiagnostic[] {
  const fromManifest = manifest.ok
    ? manifest.value.components.filter((component) => component.id !== "desktop-shell")
    : [];
  const seen = new Set<string>();
  const diagnostics: ComponentDiagnostic[] = [];

  for (const spec of KNOWN_DEFERRED_COMPONENTS) {
    if (skippedIds.has(spec.id)) continue;
    seen.add(spec.id);
    const declared = fromManifest.find((component) => component.id === spec.id);
    diagnostics.push(unavailableComponent(spec, declared));
  }

  for (const component of fromManifest) {
    if (seen.has(component.id) || skippedIds.has(component.id)) continue;
    seen.add(component.id);
    if (component.lifecycle === "active") {
      diagnostics.push({
        id: component.id,
        label: labelFor(component.id),
        state: "unresolved",
        summary: `${component.id} is unresolved because Desktop does not observe it.`,
        evidence:
          `${component.id} is active in the manifest but has no runtime observation.`,
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
  if (declared?.lifecycle === "active") {
    return {
      id: spec.id,
      label: spec.label,
      state: "unavailable",
      summary: `${spec.label} is unavailable.`,
      evidence:
        `${declared.id} is an active ${declared.delivery} component, but no exact runtime observation reached the shell.`,
      recovery:
        "Restore the exact packaged component. Do not infer its version or readiness from the manifest pin alone.",
    };
  }
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
