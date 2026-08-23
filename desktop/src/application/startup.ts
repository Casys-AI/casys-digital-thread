import type {
  DesktopControlPlaneProjection,
  DesktopShellViewModel,
  DesktopWorkbenchProjection,
} from "../contracts/diagnostics.ts";
import type { ControlPlaneLayoutProfile } from "../control-plane/contracts.ts";
import type { DesktopPlatform } from "../host/mod.ts";
import {
  bootstrapDesktopShellFromFacts,
  type DesktopBootstrapInput,
  inspectDesktopBootstrap,
} from "./bootstrap.ts";
import {
  resolvePackagedControlPlaneHelper,
  resolvePackagedWorkbenchHelper,
} from "./helper-path.ts";
import type { WorkbenchHostResult, WorkbenchSession } from "../workbench/contracts.ts";

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

export interface DesktopWorkbenchController {
  /** Returns a renderer-safe status plus a host-only proxy session. */
  start(): Promise<WorkbenchHostResult>;
  /** Stops only the Workbench child retained by this controller. */
  stop(): Promise<void>;
}

export interface DesktopStartupPorts {
  readonly createControlPlane: (
    launch: DesktopControlPlaneLaunch,
  ) => DesktopControlPlaneController;
  readonly createWorkbench?: (
    launch: DesktopControlPlaneLaunch & { readonly helperPath: string },
  ) => DesktopWorkbenchController;
}

export interface DesktopStartupInput
  extends Omit<DesktopBootstrapInput, "controlPlane"> {
  /** Must be the direct result of Deno.execPath in production. */
  readonly executablePath: string;
}

export interface StartedDesktopApplication {
  readonly model: DesktopShellViewModel;
  /** Host-only reverse-proxy session. Never serialize into the renderer. */
  readonly workbenchSession?: WorkbenchSession;
  stop(): Promise<void>;
}

/**
 * Validates every host fact before the lifecycle factory can run. The only
 * executable accepted afterward is the helper derived from the selected closed
 * macOS, Linux, or Windows bundle layout. Missing or non-conforming artifacts fail
 * later inspect/start without a checkout or general-runtime fallback.
 */
export async function startDesktopApplication(
  input: DesktopStartupInput,
  ports: DesktopStartupPorts,
): Promise<StartedDesktopApplication> {
  const facts = inspectDesktopBootstrap(input);
  if (
    !facts.manifest.ok || !facts.layout.ok || facts.controlPlaneVersion === undefined ||
    !facts.workbenchPinValid
  ) {
    return stoppedApplication(
      bootstrapDesktopShellFromFacts(
        facts,
        facts.manifest.ok && !facts.controlPlanePinValid
          ? manifestMismatchProjection()
          : undefined,
        facts.manifest.ok && !facts.workbenchPinValid
          ? workbenchUnavailableProjection("manifest-mismatch", true)
          : undefined,
      ),
    );
  }

  const helperResolution = {
    platform: facts.platform,
    executablePath: input.executablePath,
  } as const;
  const controlPlaneHelper = resolvePackagedControlPlaneHelper(helperResolution);
  const workbenchHelper = resolvePackagedWorkbenchHelper(helperResolution);

  const layout = facts.layout.value;
  const launch: DesktopControlPlaneLaunch = Object.freeze({
    helperPath: controlPlaneHelper.ok ? controlPlaneHelper.value : "unavailable",
    platform: facts.platform,
    layoutProfile: layout.controlPlaneLayoutProfile,
    launchCwd: layout.controlPlaneLaunchCwd,
    relativeWorkspace: layout.controlPlaneRelativeWorkspace,
    productIdentifier: facts.manifest.value.product.identifier,
    productVersion: facts.manifest.value.product.version,
    controlPlaneVersion: facts.controlPlaneVersion,
  });

  let controller: DesktopControlPlaneController | undefined;
  let controlPlane = controlPlaneHelper.ok && facts.controlPlaneLaunchable
    ? undefined
    : helperUnavailableProjection();
  try {
    if (controlPlaneHelper.ok && facts.controlPlaneLaunchable) {
      controller = ports.createControlPlane(launch);
      controlPlane = await controller.start();
    }
  } catch {
    await controller?.stop().catch(() => undefined);
    controller = undefined;
    controlPlane = startupFailureProjection();
  }

  let workbenchController: DesktopWorkbenchController | undefined;
  let workbench: DesktopWorkbenchProjection;
  let workbenchSession: WorkbenchSession | undefined;
  if (!workbenchHelper.ok || !facts.workbenchLaunchable || !ports.createWorkbench) {
    workbench = workbenchUnavailableProjection(
      workbenchHelper.ok ? "configuration-unavailable" : "helper-unavailable",
    );
  } else {
    try {
      workbenchController = ports.createWorkbench({
        ...launch,
        helperPath: workbenchHelper.value,
      });
      const result = await workbenchController.start();
      workbench = result.projection;
      workbenchSession = result.session;
    } catch {
      await workbenchController?.stop().catch(() => undefined);
      workbenchController = undefined;
      workbench = workbenchUnavailableProjection("startup-failed", true);
    }
  }
  return liveApplication(
    bootstrapDesktopShellFromFacts(facts, controlPlane, workbench),
    [controller, workbenchController],
    workbenchSession,
  );
}

function liveApplication(
  model: DesktopShellViewModel,
  controllers: readonly (
    | DesktopControlPlaneController
    | DesktopWorkbenchController
    | undefined
  )[],
  workbenchSession?: WorkbenchSession,
): StartedDesktopApplication {
  let stopPromise: Promise<void> | undefined;
  return Object.freeze({
    model,
    ...(workbenchSession === undefined ? {} : { workbenchSession }),
    stop(): Promise<void> {
      stopPromise ??= Promise.allSettled(
        controllers.map((controller) => controller?.stop()),
      ).then(() => undefined);
      return stopPromise;
    },
  });
}

function workbenchUnavailableProjection(
  recoveryCode: NonNullable<DesktopWorkbenchProjection["recoveryCode"]>,
  recoveryRequired = false,
): DesktopWorkbenchProjection {
  return Object.freeze({
    lifecycle: recoveryRequired ? "recovery-required" : "unavailable",
    recoveryCode,
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
