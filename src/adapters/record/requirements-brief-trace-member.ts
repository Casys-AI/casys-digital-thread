/** Exact scalar comparison for one selected native requirements-capture member. */
import type {
  OracleLimit,
  OracleOperator,
  OracleRequirement,
} from "../../domain/kernel/proof-case.ts";

export interface RequirementsBriefTraceProposedMember {
  readonly name: string;
  readonly metric: string;
  readonly operator: OracleOperator;
  readonly limit: OracleLimit;
}

/**
 * Native `id` is deliberately not part of the reviewed scalar declaration.
 * A capture's UUID/legacy identifier remains sealed elsewhere; correspondence
 * selects its member by canonical metric and preserves its visible semantics.
 */
export function requirementsBriefTraceMemberMatchesProposal(
  captured: OracleRequirement,
  proposed: RequirementsBriefTraceProposedMember,
): boolean {
  return captured.name === proposed.name &&
    captured.metric === proposed.metric &&
    captured.operator === proposed.operator &&
    Object.is(captured.limit.value, proposed.limit.value) &&
    captured.limit.unit === proposed.limit.unit;
}
