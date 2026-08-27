export interface FeaContractCapturePersistenceState {
  readonly pendingFixtureText: string | undefined;
  readonly runFailure: unknown;
  readonly cleanupFailure: unknown;
}

/**
 * Releases fixture bytes for persistence only after the capture and its
 * required ephemeral-export cleanup both succeeded.
 */
export function requireCleanCaptureForPersistence(
  state: FeaContractCapturePersistenceState,
): string {
  if (state.cleanupFailure !== undefined) throw state.cleanupFailure;
  if (state.runFailure !== undefined) throw state.runFailure;
  if (state.pendingFixtureText === undefined) {
    throw new Error("FEA contract capture produced no fixture bytes.");
  }
  return state.pendingFixtureText;
}
