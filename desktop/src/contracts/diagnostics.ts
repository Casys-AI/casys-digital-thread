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
