/**
 * Fresh global JIT demand query used before a shared persistent launch group
 * may stop.  Its scope is deliberately host-wide: a group can serve leases
 * belonging to several projects, so the releasing project cannot decide this
 * alone.
 */

export interface CapabilityRuntimeGlobalJitDemandReader {
  /**
   * Returns true when any project still has a ready or in-progress demand for
   * at least one supplied exact material. Implementations must fail closed
   * when their project census or a participating project cannot be read.
   */
  hasAnyRemainingDemand(input: {
    readonly materialKeys: readonly string[];
  }): Promise<boolean>;
}
