/**
 * Inward port for capturing one exact agent-authored architecture SysML source.
 *
 * The MCP surface may select only the server-registered closed-subset profile
 * and supply source identity plus unchanged UTF-8 text. Parsing, CAS
 * persistence, and replay stay behind this provider-free port.
 */

export interface ProjectArchitectureSysmlSourceCaptureCommand {
  readonly profileId: string;
  readonly sourceId: string;
  readonly sourceText: string;
}

export type ProjectArchitectureSysmlSourceCaptureReference = Readonly<object>;

export interface ProjectArchitectureSysmlSourceCaptureUseCase {
  capture(
    command: ProjectArchitectureSysmlSourceCaptureCommand,
  ): Promise<ProjectArchitectureSysmlSourceCaptureReference>;
}
