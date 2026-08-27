import type { ComponentState, ShellStatus } from "../contracts/diagnostics.ts";
import type { HostResult } from "../host/result.ts";
import {
  type ControlPlaneInspectDocument,
  type ControlPlaneLifecycleIdentity,
  type ControlPlaneOwnership,
  type ExpectedLiveControlPlaneIdentity,
  OWNERSHIP_RECOVERY,
} from "./contracts.ts";

export type ListenerObservation = "absent" | "exact" | "ambiguous";

export interface OwnershipEvidence {
  readonly listener: ListenerObservation;
  readonly inspect: HostResult<ControlPlaneInspectDocument>;
  readonly lifecycle: HostResult<ControlPlaneLifecycleIdentity> | null;
  readonly expected: ExpectedLiveControlPlaneIdentity;
  readonly mintedLaunchId?: string;
  readonly hasOwnedHandle: boolean;
}

export function classifyOwnership(
  evidence: OwnershipEvidence,
): ControlPlaneOwnership {
  if (!evidence.inspect.ok) {
    return ownership(
      "ambiguous",
      "The inspect document is corrupt or not the exact inspect schema.",
      "marker-invalid",
    );
  }

  const inspect = evidence.inspect.value;
  const marker = inspect.marker;

  if (
    inspect.productVersion !== evidence.expected.productVersion ||
    inspect.serverVersion !== evidence.expected.serverVersion
  ) {
    return ownership(
      "mismatch",
      "The packaged helper inspect versions do not match this Desktop release.",
      "helper-unavailable",
    );
  }
  if (
    inspect.expectedConfigDigest !== evidence.expected.configDigest ||
    inspect.configuration === "mismatch"
  ) {
    return ownership(
      "mismatch",
      "The inspected configuration does not match the packaged configuration digest.",
      "config-mismatch",
    );
  }
  if (inspect.configuration === "error") {
    return ownership(
      "ambiguous",
      "The helper could not inspect the packaged configuration exactly.",
      "startup-failed",
    );
  }

  if (evidence.listener === "ambiguous") {
    return ownership(
      "ambiguous",
      "Listener absence was not proven: the exact lifecycle probe failed or timed out.",
      "probe-failed",
    );
  }

  if (evidence.listener === "absent") {
    if (inspect.lock !== "free" || marker !== null) {
      return ownership(
        "stale",
        "A control-plane marker or non-free lock is present without a listener.",
        "marker-invalid",
      );
    }
    return {
      kind: "absent",
      reason:
        "Connection refusal proves no listener and inspect reports no marker with a free lock.",
    };
  }

  if (evidence.lifecycle === null || !evidence.lifecycle.ok) {
    return ownership(
      "foreign",
      "A listener is present but the exact Desktop lifecycle identity was not observed.",
      "foreign-listener",
    );
  }
  if (marker === null || inspect.lock !== "held") {
    return ownership(
      "foreign",
      "A listener is present without the exact held lock and ownership marker.",
      "foreign-listener",
    );
  }
  if (inspect.configuration !== "verified") {
    return ownership(
      "ambiguous",
      "A live control plane requires a verified inspected configuration.",
      "marker-invalid",
    );
  }

  const lifecycle = evidence.lifecycle.value;
  if (
    marker.productVersion !== evidence.expected.productVersion ||
    marker.serverVersion !== evidence.expected.serverVersion ||
    lifecycle.productVersion !== evidence.expected.productVersion ||
    lifecycle.serverVersion !== evidence.expected.serverVersion
  ) {
    return ownership(
      "mismatch",
      "Marker or lifecycle versions do not match this Desktop release.",
      "foreign-listener",
    );
  }
  if (
    marker.configDigest !== evidence.expected.configDigest ||
    lifecycle.configDigest !== evidence.expected.configDigest
  ) {
    return ownership(
      "mismatch",
      "Marker or lifecycle digest does not match the packaged configuration digest.",
      "config-mismatch",
    );
  }
  if (
    marker.launchId !== lifecycle.launchId ||
    marker.configDigest !== lifecycle.configDigest
  ) {
    return ownership(
      "ambiguous",
      "The marker and MCP lifecycle identity do not agree exactly.",
      "marker-invalid",
    );
  }

  const launchAgrees = evidence.mintedLaunchId !== undefined &&
    evidence.mintedLaunchId === lifecycle.launchId;
  if (evidence.hasOwnedHandle && launchAgrees) {
    return {
      kind: "owned",
      reason:
        "The in-memory child handle, marker, held lock, and lifecycle identity agree exactly.",
    };
  }

  return {
    kind: "reconnected",
    reason:
      "The marker, held lock, and lifecycle identity agree exactly without this host owning the child handle.",
  };
}

export function classifyControlPlaneAggregate(
  configuration: ComponentState,
  controlPlane: ComponentState,
  providers: ComponentState,
  projectEvidence: ComponentState,
): ShellStatus {
  const states = [configuration, controlPlane, providers, projectEvidence];
  if (states.some((state) => state === "error")) return "recovery-required";
  if (states.some((state) => state !== "ready")) return "degraded";
  return "ready";
}

function ownership(
  kind: Exclude<ControlPlaneOwnership["kind"], "absent" | "owned" | "reconnected">,
  reason: string,
  recoveryCode: NonNullable<ControlPlaneOwnership["recoveryCode"]>,
): ControlPlaneOwnership {
  return { kind, reason, recovery: OWNERSHIP_RECOVERY, recoveryCode };
}
