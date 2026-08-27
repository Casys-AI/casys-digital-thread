import type { ComponentDiagnostic, ShellStatus } from "../contracts/diagnostics.ts";

export const HOST_CRITICAL_COMPONENT_IDS = [
  "manifest",
  "runtime",
  "layout",
  "desktop-shell",
] as const;

const HOST_CRITICAL = new Set<string>(HOST_CRITICAL_COMPONENT_IDS);

export function classifyShellStatus(
  components: readonly ComponentDiagnostic[],
): ShellStatus {
  const host = components.filter((component) => HOST_CRITICAL.has(component.id));
  if (host.length !== HOST_CRITICAL.size) return "recovery-required";
  if (host.some((component) => component.state !== "ready")) {
    return "recovery-required";
  }
  if (components.some((component) => component.state === "error")) {
    return "recovery-required";
  }
  if (components.some((component) => component.state !== "ready")) {
    return "degraded";
  }
  return "ready";
}
