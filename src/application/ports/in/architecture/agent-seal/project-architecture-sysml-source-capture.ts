/**
 * Inward port for capturing one exact agent-authored architecture SysML source.
 *
 * The MCP surface may select only the server-registered closed-subset profile
 * and supply source identity plus a full AgentResourceReference from
 * `project_resource_capture`. Parsing, CAS persistence, and replay stay
 * behind this provider-free port.
 */

import type { AgentResourceReference } from "../../../../../domain/resource/agent-resource-capture.ts";

export interface ProjectArchitectureSysmlSourceCaptureCommand {
  readonly profileId: string;
  readonly sourceId: string;
  readonly resourceRef: AgentResourceReference;
}

export type ProjectArchitectureSysmlSourceCaptureReference = Readonly<object>;

export interface ProjectArchitectureSysmlSourceCaptureUseCase {
  capture(
    command: ProjectArchitectureSysmlSourceCaptureCommand,
  ): Promise<ProjectArchitectureSysmlSourceCaptureReference>;
}
