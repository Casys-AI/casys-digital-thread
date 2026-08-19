/** Run-scoped cross-process exclusion for local CalculiX dispatch and recovery. */

export interface CalculixIsolatedExecutionRunLease {
  withLease<T>(
    projectId: string,
    executionRunId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
}
