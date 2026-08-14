/**
 * Inward port for capturing one exact agent-authored technical source.
 *
 * The MCP surface may select only a server-registered capture profile and
 * supply source identity plus unchanged UTF-8 text. Profile resolution,
 * parsing, CAS persistence, and replay stay behind this provider-free port.
 */

export interface ProjectTechnicalSourceCaptureCommand {
  readonly profileId: string;
  readonly sourceId: string;
  readonly sourceText: string;
}

/**
 * Opaque, immutable locator returned by the capture boundary.
 *
 * Callers must preserve and pass the complete JSON object back unchanged. It
 * grants no project, Thread, MRTR, provider, or execution authority.
 */
export type ProjectTechnicalSourceCaptureReference = Readonly<object>;

export interface ProjectTechnicalSourceCaptureUseCase {
  capture(
    command: ProjectTechnicalSourceCaptureCommand,
  ): Promise<ProjectTechnicalSourceCaptureReference>;
}
