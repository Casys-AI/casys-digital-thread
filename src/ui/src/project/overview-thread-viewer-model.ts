/**
 * Return an App only when the recorded anchor has one exact binding.
 * Zero is unavailable; more than one is terminally ambiguous, never a chooser.
 */
export function uniqueOverviewThreadViewerSession<T>(
  sessions: readonly T[],
): T | undefined {
  return sessions.length === 1 ? sessions[0] : undefined;
}
