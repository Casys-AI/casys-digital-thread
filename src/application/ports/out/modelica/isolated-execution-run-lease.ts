/** Run-scoped cross-process exclusion for local Modelica dispatch and recovery. */

export interface ModelicaIsolatedExecutionRunLease {
  withLease<T>(
    projectId: string,
    executionRunId: string,
    operation: () => Promise<T>,
  ): Promise<T>;
}
