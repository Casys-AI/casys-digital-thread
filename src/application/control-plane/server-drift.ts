import type { DriftField, ServerRecord } from "./read-model/fleet-drift.ts";
import type { DesiredServer } from "./read-model/fleet-manifest.ts";
import type { ObservedServer } from "./read-model/fleet-observation.ts";
import type { DriftStatus } from "./read-model/status.ts";

export function buildServerRecord(
  desired: DesiredServer,
  observed: ObservedServer,
): ServerRecord {
  const fields: DriftField[] = [
    healthDrift(observed),
    containerDrift(desired, observed),
    imageDrift(desired, observed),
    toolDrift(desired, observed),
    resourceDrift(desired, observed),
  ];
  const status: DriftStatus = fields.some((field) => field.status === "drift")
    ? "drift"
    : fields.some((field) => field.status === "unknown")
    ? "unknown"
    : "in_sync";

  return {
    id: desired.id,
    desired,
    observed,
    drift: { status, fields },
    demo: false,
  };
}

function healthDrift(observed: ObservedServer): DriftField {
  if (observed.status === "healthy") {
    return {
      field: "health",
      status: "in_sync",
      desired: "healthy",
      observed: observed.status,
      message: "Health and MCP discovery succeeded.",
    };
  }
  return {
    field: "health",
    status: observed.status === "unknown" ? "unknown" : "drift",
    desired: "healthy",
    observed: observed.status,
    message: observed.error ?? `Server is ${observed.status}.`,
  };
}

function containerDrift(
  desired: DesiredServer,
  observed: ObservedServer,
): DriftField {
  const container = observed.container;
  if (!container.runtimeAvailable) {
    return {
      field: "container",
      status: "unknown",
      desired: desired.serviceName,
      message: container.error ?? "Docker runtime is not observable.",
    };
  }
  if (!container.present) {
    return {
      field: "container",
      status: "drift",
      desired: desired.serviceName,
      observed: "absent",
      message: "Desired Compose service has no container.",
    };
  }
  const running = container.state?.toLowerCase() === "running";
  return {
    field: "container",
    status: running ? "in_sync" : "drift",
    desired: "running",
    observed: container.state ?? "unknown",
    message: running ? "Container is running." : "Container is not running.",
  };
}

function imageDrift(
  desired: DesiredServer,
  observed: ObservedServer,
): DriftField {
  const container = observed.container;
  if (desired.image.endsWith(":latest")) {
    return {
      field: "image",
      status: "drift",
      desired: desired.image,
      observed: {
        image: container.image,
        imageId: container.imageId,
        repoDigests: container.repoDigests ?? [],
      },
      message:
        "Desired image uses the mutable :latest tag; pin a version or digest for reproducible runs.",
    };
  }
  if (!container.runtimeAvailable || !container.present) {
    return {
      field: "image",
      status: "unknown",
      desired: desired.image,
      observed: container.image,
      message: "Image cannot be compared without an observable container.",
    };
  }
  const matches = container.image === desired.image ||
    (container.repoDigests ?? []).includes(desired.image);
  return {
    field: "image",
    status: matches ? "in_sync" : "drift",
    desired: desired.image,
    observed: container.image,
    message: matches
      ? "Observed image matches desired state."
      : "Observed image differs from desired state.",
  };
}

function toolDrift(
  desired: DesiredServer,
  observed: ObservedServer,
): DriftField {
  if (!observed.mcp.reachable) {
    return {
      field: "tools",
      status: "unknown",
      desired: desired.expectedTools,
      message: "Tool inventory is unavailable.",
    };
  }
  const observedNames = observed.mcp.tools.map((tool) => tool.name).sort();
  const expected = [...desired.expectedTools].sort();
  const missing = expected.filter((name) => !observedNames.includes(name));
  const unexpected = observedNames.filter((name) => !expected.includes(name));
  const inSync = missing.length === 0 && unexpected.length === 0;
  return {
    field: "tools",
    status: inSync ? "in_sync" : "drift",
    desired: expected,
    observed: observedNames,
    message: inSync
      ? `${observedNames.length} tools match desired state.`
      : `Missing ${missing.length}, unexpected ${unexpected.length}.`,
  };
}

function resourceDrift(
  desired: DesiredServer,
  observed: ObservedServer,
): DriftField {
  const expected = [...(desired.expectedViews ?? [])].sort();
  if (!observed.mcp.reachable) {
    return {
      field: "resources",
      status: "unknown",
      desired: expected,
      message: "Viewer/resource inventory is unavailable.",
    };
  }
  const observedUris = [...observed.mcp.viewerUris].sort();
  const missing = expected.filter((uri) => !observedUris.includes(uri));
  const unexpected = observedUris.filter((uri) => !expected.includes(uri));
  const inSync = missing.length === 0 && unexpected.length === 0;
  return {
    field: "resources",
    status: inSync ? "in_sync" : "drift",
    desired: expected,
    observed: observedUris,
    message: inSync
      ? `${observedUris.length} viewer resources match desired state.`
      : `Missing ${missing.length}, unexpected ${unexpected.length}.`,
  };
}
