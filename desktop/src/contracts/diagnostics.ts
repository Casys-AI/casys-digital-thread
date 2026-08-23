export type ShellStatus = "ready" | "degraded" | "recovery-required";

/** Literal evidence states remain distinct from the shell aggregate. */
export type ComponentState = "ready" | "unavailable" | "unresolved" | "error";

export interface ComponentDiagnostic {
  readonly id: string;
  readonly label: string;
  readonly state: ComponentState;
  readonly summary: string;
  readonly evidence: string;
  readonly recovery?: string;
  readonly version?: string;
}

export interface DesktopShellViewModel {
  readonly productName: string;
  readonly productVersion: string;
  readonly status: ShellStatus;
  readonly title: string;
  readonly summary: string;
  readonly platform: "macOS" | "Windows" | "Linux";
  readonly components: readonly ComponentDiagnostic[];
}

/** Safe host projection: deliberately contains no pid, path, endpoint, or nonce. */
export interface DesktopControlPlaneProjection {
  readonly configuration:
    | "verified"
    | "missing"
    | "mismatch"
    | "error";
  readonly lifecycle:
    | "owned-ready"
    | "reconnected-ready"
    | "starting"
    | "unavailable"
    | "recovery-required";
  readonly controlPlaneVersion?: string;
  readonly recoveryCode?:
    | "config-mismatch"
    | "foreign-listener"
    | "helper-unavailable"
    | "manifest-mismatch"
    | "marker-invalid"
    | "permission-denied"
    | "probe-failed"
    | "startup-failed";
  readonly providers: {
    readonly state: "healthy" | "degraded" | "unavailable" | "unknown" | "error";
    readonly total?: number;
    readonly healthy?: number;
    readonly drift?: number;
  };
  readonly persistedEvidence:
    | "verified"
    | "candidate-unverified"
    | "unavailable"
    | "error";
}

/** Renderer-safe Workbench lifecycle; contains no origin, token, path, or pid. */
export interface DesktopWorkbenchProjection {
  readonly lifecycle:
    | "owned-ready"
    | "reconnected-ready"
    | "unavailable"
    | "recovery-required";
  readonly version?: string;
  readonly recoveryCode?:
    | "configuration-unavailable"
    | "helper-unavailable"
    | "listener-conflict"
    | "manifest-mismatch"
    | "marker-invalid"
    | "permission-denied"
    | "probe-failed"
    | "startup-failed"
    | "termination-unresolved";
}
