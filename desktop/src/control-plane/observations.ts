import type {
  ComponentDiagnostic,
  ComponentState,
  DesktopControlPlaneProjection,
} from "../contracts/diagnostics.ts";
import {
  type ConfigurationMaterialization,
  CONTROL_PLANE_COMPONENT_IDS,
  CONTROL_PLANE_PRODUCT_VERSION,
  type ControlPlaneOwnership,
  type ControlPlaneRendererObservation,
  type ExpectedControlPlaneIdentity,
  type ProviderSnapshotObservation,
} from "./contracts.ts";
import { classifyControlPlaneAggregate } from "./classify.ts";

export interface ObservationInput {
  readonly configuration: ConfigurationMaterialization;
  readonly ownership: ControlPlaneOwnership;
  readonly providers?: ProviderSnapshotObservation;
}

export interface ProjectionInput extends ObservationInput {
  readonly expected: ExpectedControlPlaneIdentity;
}

/** Maps host-only lifecycle evidence to the renderer's deliberately narrow DTO. */
export function toDesktopControlPlaneProjection(
  input: ProjectionInput,
): DesktopControlPlaneProjection {
  const ready = input.ownership.kind === "owned" ||
    input.ownership.kind === "reconnected";
  const providers = input.providers === undefined
    ? {
      state: ready ? "unavailable" as const : "unknown" as const,
    }
    : {
      state: input.providers.fleetStatus,
      total: input.providers.total,
      healthy: input.providers.healthy,
      drift: input.providers.drift,
    };
  const persistedEvidence = !ready
    ? "unavailable" as const
    : input.providers === undefined
    ? "unavailable" as const
    : input.providers.runCount > 0
    ? "candidate-unverified" as const
    : "unavailable" as const;

  return Object.freeze({
    configuration: input.configuration.state,
    lifecycle: input.ownership.kind === "owned"
      ? "owned-ready"
      : input.ownership.kind === "reconnected"
      ? "reconnected-ready"
      : input.ownership.kind === "absent"
      ? "unavailable"
      : "recovery-required",
    ...(ready ? { controlPlaneVersion: input.expected.serverVersion } : {}),
    ...(input.ownership.recoveryCode === undefined
      ? {}
      : { recoveryCode: input.ownership.recoveryCode }),
    providers: Object.freeze(providers),
    persistedEvidence,
  });
}

export function buildRendererObservation(
  input: ObservationInput,
): ControlPlaneRendererObservation {
  const configuration = diagnoseConfiguration(input.configuration);
  const controlPlane = diagnoseControlPlane(input.ownership);
  const providers = diagnoseProviders(input.ownership.kind, input.providers);
  const projectEvidence = diagnoseProjectEvidence(
    input.ownership.kind,
    input.providers,
  );
  return sanitizeObservation({
    status: classifyControlPlaneAggregate(
      configuration.state,
      controlPlane.state,
      providers.state,
      projectEvidence.state,
    ),
    configuration,
    controlPlane,
    providers,
    projectEvidence,
  });
}

export function sanitizeObservation(
  observation: ControlPlaneRendererObservation,
): ControlPlaneRendererObservation {
  return Object.freeze({
    status: observation.status,
    configuration: sanitizeComponent(observation.configuration),
    controlPlane: sanitizeComponent(observation.controlPlane),
    providers: sanitizeComponent(observation.providers),
    projectEvidence: sanitizeComponent(observation.projectEvidence),
  });
}

function diagnoseConfiguration(
  configuration: ConfigurationMaterialization,
): ComponentDiagnostic {
  switch (configuration.state) {
    case "verified":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.configuration,
        "Packaged configuration",
        "ready",
        "Packaged control-plane configuration digest verification is ready.",
        "The packaged exact config and fixture assets match the expected digest.",
      );
    case "mismatch":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.configuration,
        "Packaged configuration",
        "error",
        "Packaged control-plane configuration digest verification is error.",
        "Existing packaged assets do not match the expected digest and were not replaced.",
        "Restore the exact packaged config and fixture assets. Do not silently overwrite mismatched files.",
      );
    case "missing":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.configuration,
        "Packaged configuration",
        "unavailable",
        "Packaged control-plane configuration is unavailable.",
        "The packaged config and fixture assets have not been materialized.",
        "Install the packaged Desktop helper so exact config assets can be copied and digest-checked.",
      );
    case "error":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.configuration,
        "Packaged configuration",
        "error",
        "Packaged control-plane configuration digest verification is error.",
        "Configuration materialization did not yield an exact result.",
        "Repair the packaged helper inspection path before retrying Desktop.",
      );
  }
}

function diagnoseControlPlane(
  ownership: ControlPlaneOwnership,
): ComponentDiagnostic {
  switch (ownership.kind) {
    case "owned":
    case "reconnected":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.controlPlane,
        "Casys control plane",
        "ready",
        ownership.kind === "owned"
          ? "The Desktop-owned control plane is ready."
          : "The exact reconnectable control plane is ready.",
        ownership.kind === "owned"
          ? "Exact health, server/discover, and the Desktop lifecycle tool identity agree with the owned child handle."
          : "The exact marker, held lock, and Desktop lifecycle identity agree without an owned child handle.",
        undefined,
        CONTROL_PLANE_PRODUCT_VERSION,
      );
    case "absent":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.controlPlane,
        "Casys control plane",
        "unavailable",
        "The local Casys control plane is unavailable.",
        "No Desktop-owned control-plane listener is present.",
        "Start the packaged control-plane helper from Desktop. Do not run a general Deno CLI.",
      );
    case "foreign":
    case "ambiguous":
    case "stale":
    case "mismatch":
      return diagnostic(
        CONTROL_PLANE_COMPONENT_IDS.controlPlane,
        "Casys control plane",
        "error",
        `The local Casys control plane is error: ${ownership.kind}.`,
        ownership.reason,
        ownership.recovery,
      );
  }
}

function diagnoseProviders(
  ownershipKind: ControlPlaneOwnership["kind"],
  snapshot: ProviderSnapshotObservation | undefined,
): ComponentDiagnostic {
  if (
    (ownershipKind !== "owned" && ownershipKind !== "reconnected") ||
    snapshot === undefined
  ) {
    return diagnostic(
      CONTROL_PLANE_COMPONENT_IDS.providers,
      "Engineering providers",
      "unavailable",
      "Engineering provider health is unavailable.",
      "Provider observation requires a Desktop-owned console_snapshot. Compose metadata is unavailable.",
      "Do not infer provider readiness from directory state or a foreign listener.",
    );
  }
  if (snapshot.fleetStatus === "healthy" && snapshot.healthy === snapshot.total) {
    return diagnostic(
      CONTROL_PLANE_COMPONENT_IDS.providers,
      "Engineering providers",
      "ready",
      "Engineering provider observation is ready.",
      `console_snapshot reported fleet healthy for ${snapshot.healthy} of ${snapshot.total} servers.`,
    );
  }
  if (snapshot.fleetStatus === "unavailable") {
    return diagnostic(
      CONTROL_PLANE_COMPONENT_IDS.providers,
      "Engineering providers",
      "unavailable",
      "Engineering providers are unavailable.",
      "console_snapshot reported fleet unavailable. Compose metadata remains unavailable.",
    );
  }
  return diagnostic(
    CONTROL_PLANE_COMPONENT_IDS.providers,
    "Engineering providers",
    "unresolved",
    "Engineering provider observation is unresolved.",
    `console_snapshot reported fleet ${snapshot.fleetStatus}.`,
  );
}

function diagnoseProjectEvidence(
  ownershipKind: ControlPlaneOwnership["kind"],
  snapshot: ProviderSnapshotObservation | undefined,
): ComponentDiagnostic {
  if (
    (ownershipKind !== "owned" && ownershipKind !== "reconnected") ||
    snapshot === undefined
  ) {
    return diagnostic(
      CONTROL_PLANE_COMPONENT_IDS.projectEvidence,
      "Project evidence",
      "unavailable",
      "Persisted project evidence is unavailable.",
      "Project evidence is read from console_snapshot only. Directory existence is not proof.",
    );
  }
  if (snapshot.runCount === 0) {
    return diagnostic(
      CONTROL_PLANE_COMPONENT_IDS.projectEvidence,
      "Project evidence",
      "unavailable",
      "Persisted project evidence is unavailable.",
      "console_snapshot returned no run items. Directory existence is not proof.",
    );
  }
  const demoLabel = snapshot.demoRunCount === snapshot.runCount
    ? " Indexed candidates are labelled demo."
    : snapshot.demoRunCount > 0
    ? " At least one indexed run is labelled demo."
    : "";
  return diagnostic(
    CONTROL_PLANE_COMPONENT_IDS.projectEvidence,
    "Project evidence",
    "unresolved",
    "Persisted project evidence is unresolved.",
    `console_snapshot returned ${snapshot.runCount} candidate run item(s), but control-plane diagnostics do not reopen an exact project revision.${demoLabel}`,
    "Open an exact project through the read-only Workbench projection before claiming verified evidence.",
  );
}

function diagnostic(
  id: string,
  label: string,
  state: ComponentState,
  summary: string,
  evidence: string,
  recovery?: string,
  version?: string,
): ComponentDiagnostic {
  return {
    id,
    label,
    state,
    summary,
    evidence,
    ...(recovery === undefined ? {} : { recovery }),
    ...(version === undefined ? {} : { version }),
  };
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

export function sanitizeText(value: string): string {
  return value
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "[redacted]")
    .replace(
      /(^|[=\s"'`(])(\/(?:Users|home|var|private|opt|tmp|etc)\/[^\s"']+)/g,
      "$1[redacted]",
    )
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted]")
    .replace(/\b(?:127\.0\.0\.1|localhost)\b/g, "[redacted]")
    .replace(/:3020\b/g, "[redacted]")
    .replace(/\bpid\b\s*[:=]?\s*\d+/gi, "pid [redacted]")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "[redacted]",
    )
    .replace(/\bsha256:[a-f0-9]{64}\b/gi, "[redacted]");
}
