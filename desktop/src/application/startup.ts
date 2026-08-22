import type {
  DesktopControlPlaneProjection,
  DesktopShellViewModel,
} from "../contracts/diagnostics.ts";
import type { ControlPlaneLayoutProfile } from "../control-plane/contracts.ts";
import type { DesktopPlatform } from "../host/mod.ts";
import {
  bootstrapDesktopShellFromFacts,
  type DesktopBootstrapInput,
  inspectDesktopBootstrap,
} from "./bootstrap.ts";
import { resolvePackagedControlPlaneHelper } from "./helper-path.ts";

export interface DesktopControlPlaneLaunch {
  readonly helperPath: string;
  readonly platform: DesktopPlatform;
  readonly layoutProfile: ControlPlaneLayoutProfile;
  readonly launchCwd: string;
  readonly relativeWorkspace: string;
  readonly productIdentifier: string;
  readonly productVersion: string;
  readonly controlPlaneVersion: string;
}

export interface DesktopControlPlaneController {
  /** Performs inspect/reconnect/start and returns only the renderer-safe DTO. */
  start(): Promise<DesktopControlPlaneProjection>;
  /** Stops only a child handle retained by this controller in memory. */
  stop(): Promise<void>;
}

export interface DesktopStartupPorts {
  readonly createControlPlane: (
    launch: DesktopControlPlaneLaunch,
  ) => DesktopControlPlaneController;
}

export interface DesktopStartupInput
  extends Omit<DesktopBootstrapInput, "controlPlane"> {
  /** Must be the direct result of Deno.execPath in production. */
  readonly executablePath: string;
}

export interface StartedDesktopApplication {
  readonly model: DesktopShellViewModel;
  stop(): Promise<void>;
}

/**
 * Validates every host fact before the lifecycle factory can run. The only
 * executable accepted afterward is the nested helper in the current macOS app
 * bundle; there is no checkout or general-runtime fallback.
 */
export async function startDesktopApplication(
  input: DesktopStartupInput,
  ports: DesktopStartupPorts,
): Promise<StartedDesktopApplication> {
  const facts = inspectDesktopBootstrap(input);
  if (
    !facts.controlPlaneLaunchable || !facts.manifest.ok || !facts.layout.ok ||
    facts.controlPlaneVersion === undefined
  ) {
    return stoppedApplication(
      bootstrapDesktopShellFromFacts(
        facts,
        facts.manifest.ok && !facts.controlPlanePinValid
          ? manifestMismatchProjection()
          : undefined,
      ),
    );
  }

  const helper = resolvePackagedControlPlaneHelper(input.executablePath);
  if (!helper.ok) {
    return stoppedApplication(
      bootstrapDesktopShellFromFacts(facts, helperUnavailableProjection()),
    );
  }

  const layout = facts.layout.value;
  const launch: DesktopControlPlaneLaunch = Object.freeze({
    helperPath: helper.value,
    platform: facts.platform,
    layoutProfile: layout.controlPlaneLayoutProfile,
    launchCwd: layout.controlPlaneLaunchCwd,
    relativeWorkspace: layout.controlPlaneRelativeWorkspace,
    productIdentifier: facts.manifest.value.product.identifier,
    productVersion: facts.manifest.value.product.version,
    controlPlaneVersion: facts.controlPlaneVersion,
  });

  let controller: DesktopControlPlaneController | undefined;
  try {
    controller = ports.createControlPlane(launch);
    const projection = await controller.start();
    return liveApplication(
      bootstrapDesktopShellFromFacts(facts, projection),
      controller,
    );
  } catch {
    await controller?.stop().catch(() => undefined);
    return stoppedApplication(
      bootstrapDesktopShellFromFacts(facts, startupFailureProjection()),
    );
  }
}

function liveApplication(
  model: DesktopShellViewModel,
  controller: DesktopControlPlaneController,
): StartedDesktopApplication {
  let stopPromise: Promise<void> | undefined;
  return Object.freeze({
    model,
    stop(): Promise<void> {
      stopPromise ??= controller.stop();
      return stopPromise;
    },
  });
}

function stoppedApplication(
  model: DesktopShellViewModel,
): StartedDesktopApplication {
  return Object.freeze({
    model,
    stop: () => Promise.resolve(),
  });
}

function helperUnavailableProjection(): DesktopControlPlaneProjection {
  return Object.freeze({
    configuration: "missing",
    lifecycle: "recovery-required",
    recoveryCode: "helper-unavailable",
    providers: Object.freeze({ state: "unavailable" }),
    persistedEvidence: "unavailable",
  });
}

function manifestMismatchProjection(): DesktopControlPlaneProjection {
  return Object.freeze({
    configuration: "error",
    lifecycle: "recovery-required",
    recoveryCode: "manifest-mismatch",
    providers: Object.freeze({ state: "unavailable" }),
    persistedEvidence: "unavailable",
  });
}

function startupFailureProjection(): DesktopControlPlaneProjection {
  return Object.freeze({
    configuration: "error",
    lifecycle: "recovery-required",
    recoveryCode: "startup-failed",
    providers: Object.freeze({ state: "unavailable" }),
    persistedEvidence: "unavailable",
  });
}
