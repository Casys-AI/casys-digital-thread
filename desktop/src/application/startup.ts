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
  /**
   * True only after the pinned product/runtime/control-plane bootstrap is live
   * and the exact Chat Host component declaration was validated.
   */
  readonly chatHostLaunchable: boolean;
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
  let controlPlaneLive = false;
  let controlPlane = controlPlaneHelper.ok && facts.controlPlaneLaunchable
    ? undefined
    : facts.packagedHelperPermissionsCompatible
    ? helperUnavailableProjection()
    : helperPermissionUnavailableProjection();
  try {
    if (controlPlaneHelper.ok && facts.controlPlaneLaunchable) {
      controller = ports.createControlPlane(launch);
      controlPlane = await controller.start();
      controlPlaneLive = isLiveControlPlaneProjection(
        controlPlane,
        facts.controlPlaneVersion,
      );
    }
  } catch {
    if (await stopControllerAfterStartupFailure(controller)) {
      controller = undefined;
    }
    controlPlane = startupFailureProjection();
  }

  let workbenchController: DesktopWorkbenchController | undefined;
  let workbench: DesktopWorkbenchProjection;
  let workbenchSession: WorkbenchSession | undefined;
  if (!workbenchHelper.ok || !facts.workbenchLaunchable || !ports.createWorkbench) {
    workbench = workbenchUnavailableProjection(
      !workbenchHelper.ok
        ? "helper-unavailable"
        : !facts.packagedHelperPermissionsCompatible
        ? "permission-denied"
        : "configuration-unavailable",
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
      const stopped = await stopControllerAfterStartupFailure(
        workbenchController,
      );
      if (stopped) workbenchController = undefined;
      workbench = workbenchUnavailableProjection(
        stopped ? "startup-failed" : "termination-unresolved",
        true,
      );
    }
  }
  return liveApplication(
    bootstrapDesktopShellFromFacts(facts, controlPlane, workbench),
    [controller, workbenchController],
    controlPlaneLive && facts.chatHostPinValid,
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
  chatHostLaunchable: boolean,
  workbenchSession?: WorkbenchSession,
): StartedDesktopApplication {
  let stopPromise: Promise<void> | undefined;
  return Object.freeze({
    model,
    chatHostLaunchable,
    ...(workbenchSession === undefined ? {} : { workbenchSession }),
    stop(): Promise<void> {
      if (stopPromise === undefined) {
        const gate = stopControllers(controllers);
        stopPromise = gate;
        void gate.catch(() => {
          if (stopPromise === gate) stopPromise = undefined;
        });
      }
      return stopPromise;
    },
  });
}

function isLiveControlPlaneProjection(
  projection: DesktopControlPlaneProjection,
  expectedVersion: string,
): boolean {
  return projection.configuration === "verified" &&
    (projection.lifecycle === "owned-ready" ||
      projection.lifecycle === "reconnected-ready") &&
    projection.controlPlaneVersion === expectedVersion;
}

async function stopControllerAfterStartupFailure(
  controller:
    | DesktopControlPlaneController
    | DesktopWorkbenchController
    | undefined,
): Promise<boolean> {
  if (controller === undefined) return true;
  try {
    await controller.stop();
    return true;
  } catch {
    return false;
  }
}

async function stopControllers(
  controllers: readonly (
    | DesktopControlPlaneController
    | DesktopWorkbenchController
    | undefined
  )[],
): Promise<void> {
  const results = await Promise.allSettled(
    controllers.map((controller) => controller?.stop()),
  );
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "One or more owned Desktop helpers have unresolved termination.",
    );
  }
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
    chatHostLaunchable: false,
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

function helperPermissionUnavailableProjection(): DesktopControlPlaneProjection {
  return Object.freeze({
    configuration: "error",
    lifecycle: "recovery-required",
    recoveryCode: "permission-denied",
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
