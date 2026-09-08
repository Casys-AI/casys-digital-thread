/**
 * Overview hull projection of server-owned current Engineering Cases.
 *
 * Consumes `engineering-cases/1.1` `current` recrossed with exact `cases`.
 * It never recomputes the current selection, invents a case identity, or
 * publishes revision history. Whiteboard rows are current mechanical-proof
 * cases only.
 */
import type {
  EngineeringCase,
  EngineeringCaseCatalog,
} from "../../../../thread/types.ts";
import type {
  OverviewHeroNode,
  OverviewRecordedHeroNode,
} from "../../../overview-thread-hero-model.ts";
import { overviewThreadD3FlowGroupIdentity } from "../../../overview-thread-d3-flow-layout.ts";
import type { ThreadViewerSession } from "../../../../thread/viewer-sessions-client.ts";
import type { OverviewViewerOpenTarget } from "../../../overview-thread-viewer-discovery.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "../domain-groups.ts";
import type {
  OverviewCurrentEngineeringCasesInput,
  OverviewHullAdapter,
} from "./types.ts";
import type { OverviewHullContent, OverviewHullContentRow } from "../types.ts";
import { overviewHullBoundRowViewer } from "../row-viewer.ts";

export type { OverviewCurrentEngineeringCasesInput } from "./types.ts";

const NO_VIEWER_ALIASES: ReadonlyMap<
  string,
  readonly OverviewViewerOpenTarget[]
> = new Map();

const PROJECT_ID_PREFIX = /^[A-Za-z]+\d+-/;
const PHYSICS_FEA = overviewThreadD3FlowGroupIdentity(
  "physics",
  OVERVIEW_DOMAIN_GROUP_KEYS.fea,
);
const VERDICTS_FEA = overviewThreadD3FlowGroupIdentity(
  "verdicts",
  OVERVIEW_DOMAIN_GROUP_KEYS.fea,
);

export const OVERVIEW_CURRENT_ENGINEERING_CASES_ADAPTER_ID =
  "current-engineering-cases";

/**
 * Fold server current selections onto FEA hulls. Missing or unusable DTOs
 * leave the existing exact records untouched.
 */
export function withOverviewCurrentEngineeringCases(
  contents: ReadonlyMap<string, OverviewHullContent>,
  nodes: readonly OverviewHeroNode[],
  input: OverviewCurrentEngineeringCasesInput = {},
): ReadonlyMap<string, OverviewHullContent> {
  if (!usableEngineeringCaseCatalog(input.catalog)) return contents;
  const catalog = input.catalog;
  const currentCases = mechanicalCurrentCases(catalog);
  if (currentCases.length === 0) return contents;
  const membersByHull = feaMembersByHull(nodes);
  if (membersByHull.size === 0) return contents;

  const sessionsByRecord = sessionsByRecordKey(input.sessions ?? []);
  const viewerAliases = input.viewerAliases ?? NO_VIEWER_ALIASES;
  const result = new Map(contents);
  for (const [groupKey, content] of contents) {
    const members = membersByHull.get(groupKey);
    if (!members || members.length === 0) continue;
    const wrapped = buildOverviewCurrentEngineeringCasesContent(
      content,
      members,
      catalog,
      {
        ...input,
        sessionsByRecord,
        viewerAliases,
        nodes,
      },
    );
    if (wrapped) result.set(groupKey, wrapped);
  }
  return result;
}

export const currentEngineeringCasesAdapter: OverviewHullAdapter = {
  id: OVERVIEW_CURRENT_ENGINEERING_CASES_ADAPTER_ID,
  apply(contents, context) {
    return withOverviewCurrentEngineeringCases(
      contents,
      context.nodes,
      context.engineeringCases,
    );
  },
};

export function buildOverviewCurrentEngineeringCasesContent(
  content: OverviewHullContent,
  members: readonly OverviewRecordedHeroNode[],
  catalog: EngineeringCaseCatalog,
  input: OverviewCurrentEngineeringCasesInput & {
    readonly sessionsByRecord?: ReadonlyMap<string, readonly string[]>;
    readonly nodes?: readonly OverviewHeroNode[];
  } = {},
): OverviewHullContent | undefined {
  if (!usableEngineeringCaseCatalog(catalog) || members.length === 0) {
    return undefined;
  }
  const principalKind = principalKindForHull(content.groupKey);
  if (principalKind === undefined) return undefined;
  const currentCases = mechanicalCurrentCases(catalog);
  if (currentCases.length === 0) return undefined;

  const unique = uniqueRecordedMembers(members);
  const sessionsByRecord = input.sessionsByRecord ??
    sessionsByRecordKey(input.sessions ?? []);
  const viewerAliases = input.viewerAliases ?? NO_VIEWER_ALIASES;
  const lookupNodes = input.nodes ?? unique;
  const candidates: OverviewHullContentRow[] = [];
  for (const sealed of currentCases) {
    const row = currentCaseRow(
      sealed,
      unique,
      principalKind,
      lookupNodes,
      sessionsByRecord,
      viewerAliases,
    );
    if (row) candidates.push(row);
  }
  const rows = uniquePrincipalCurrentCaseRows(candidates);
  return {
    groupKey: content.groupKey,
    mode: "records",
    rows,
    records: content.records,
    ...(content.status ? { status: content.status } : {}),
  };
}

type PrincipalKind = "solver-result" | "evaluation";

function principalKindForHull(groupKey: string): PrincipalKind | undefined {
  if (groupKey === PHYSICS_FEA) return "solver-result";
  if (groupKey === VERDICTS_FEA) return "evaluation";
  return undefined;
}

function currentCaseRow(
  sealed: EngineeringCase,
  members: readonly OverviewRecordedHeroNode[],
  principalKind: PrincipalKind,
  nodes: readonly OverviewHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): OverviewHullContentRow | undefined {
  const currentMembers = members.filter((member) =>
    member.node.engineeringCaseRefs?.includes(sealed.key)
  );
  const principals = currentMembers.filter((member) =>
    isPrincipalCandidate(member, principalKind)
  );
  if (principals.length !== 1) return undefined;
  const principal = principals[0]!;
  const graphRefs = [
    principal.key,
    ...currentMembers
      .map((member) => member.key)
      .filter((key) => key !== principal.key)
      .toSorted((left, right) => left.localeCompare(right)),
  ];
  const viewer = principalKind === "solver-result"
    ? overviewHullBoundRowViewer(
      principal.key,
      sessionsByRecord,
      viewerAliases,
    )
    : { sessionIds: [] as readonly string[] };
  const detail = principalKind === "evaluation"
    ? verdictDetail(principal, nodes)
    : undefined;
  return {
    key: sealed.key,
    kind: "record",
    label: engineeringCasePresentationLabel(sealed.id),
    ...(detail ? { detail } : {}),
    depth: 0,
    nodeKey: principal.key,
    graphRefs,
    ...(viewer.viewerNodeKey ? { viewerNodeKey: viewer.viewerNodeKey } : {}),
    sessionIds: viewer.sessionIds,
    endpoint: true,
    selectable: true,
    focusable: true,
  };
}

function isPrincipalCandidate(
  member: OverviewRecordedHeroNode,
  principalKind: PrincipalKind,
): boolean {
  if (principalKind === "solver-result") {
    return member.node.artifactKind === "solver-result";
  }
  return member.node.entityKind === "evaluation";
}

function verdictDetail(
  principal: OverviewRecordedHeroNode,
  nodes: readonly OverviewHeroNode[],
): string | undefined {
  const status = displayVerdictSummary(principal.node.summary);
  const requirementName = exactRequirementName(principal, nodes);
  const parts = [status, requirementName].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function displayVerdictSummary(
  summary: string | undefined,
): string | undefined {
  if (summary === undefined || summary === "") return undefined;
  if (summary === "pass") return "Pass";
  if (summary === "fail") return "Fail";
  return summary;
}

function exactRequirementName(
  principal: OverviewRecordedHeroNode,
  nodes: readonly OverviewHeroNode[],
): string | undefined {
  const selection = principal.node.selection;
  if (selection === undefined || selection.kind !== "requirement") {
    return undefined;
  }
  const matches = nodes.flatMap((node) => {
    if (node.kind !== "recorded") return [];
    if (
      node.node.entityKind !== "requirement" ||
      node.node.ref.kind !== "requirement" ||
      node.node.ref.id !== selection.id
    ) {
      return [];
    }
    return [node.node.label];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function engineeringCasePresentationLabel(id: string): string {
  const withoutPrefix = id.replace(PROJECT_ID_PREFIX, "");
  const words = withoutPrefix.replace(/[_-]+/g, " ").replace(/\s+/g, " ")
    .trim();
  if (words.length === 0) return id;
  return `${words.charAt(0).toUpperCase()}${words.slice(1).toLowerCase()}`;
}

function usableEngineeringCaseCatalog(
  catalog: EngineeringCaseCatalog | undefined,
): catalog is EngineeringCaseCatalog {
  if (
    catalog === undefined ||
    catalog.schemaVersion !== "engineering-cases/1.1" ||
    catalog.status === "unavailable" ||
    !Array.isArray(catalog.current) ||
    !Array.isArray(catalog.cases)
  ) {
    return false;
  }
  const casesByKey = new Map(catalog.cases.map((item) => [item.key, item]));
  const seenGroups = new Set<string>();
  const seenKeys = new Set<string>();
  for (const selection of catalog.current) {
    const group = `${selection.family}\0${selection.id}`;
    if (
      seenGroups.has(group) ||
      seenKeys.has(selection.currentCaseKey)
    ) {
      return false;
    }
    seenGroups.add(group);
    seenKeys.add(selection.currentCaseKey);
    if (!recrossedCurrentCase(selection, casesByKey)) return false;
  }
  return true;
}

function recrossedCurrentCase(
  selection: EngineeringCaseCatalog["current"][number],
  casesByKey: ReadonlyMap<string, EngineeringCase>,
): EngineeringCase | undefined {
  const sealed = casesByKey.get(selection.currentCaseKey);
  if (
    !sealed ||
    sealed.family !== selection.family ||
    sealed.id !== selection.id ||
    sealed.revision !== selection.revision ||
    sealed.key !== selection.currentCaseKey
  ) {
    return undefined;
  }
  return sealed;
}

function mechanicalCurrentCases(
  catalog: EngineeringCaseCatalog,
): readonly EngineeringCase[] {
  const casesByKey = new Map(catalog.cases.map((item) => [item.key, item]));
  const current: EngineeringCase[] = [];
  for (const selection of catalog.current) {
    if (selection.family !== "mechanical-proof") continue;
    const sealed = recrossedCurrentCase(selection, casesByKey);
    if (!sealed) return [];
    current.push(sealed);
  }
  return current;
}

function feaMembersByHull(
  nodes: readonly OverviewHeroNode[],
): ReadonlyMap<string, OverviewRecordedHeroNode[]> {
  const groups = new Map<string, OverviewRecordedHeroNode[]>();
  for (const node of nodes) {
    if (node.kind !== "recorded") continue;
    if (node.groupKey !== OVERVIEW_DOMAIN_GROUP_KEYS.fea) continue;
    const hullKey = overviewThreadD3FlowGroupIdentity(node.lane, node.groupKey);
    const members = groups.get(hullKey) ?? [];
    members.push(node);
    groups.set(hullKey, members);
  }
  return groups;
}

function uniqueRecordedMembers(
  members: readonly OverviewRecordedHeroNode[],
): OverviewRecordedHeroNode[] {
  const unique = new Map<string, OverviewRecordedHeroNode>();
  for (const member of members) unique.set(member.key, member);
  return [...unique.values()];
}

/** One solver-result or evaluation may back at most one current-case row. */
function uniquePrincipalCurrentCaseRows(
  rows: readonly OverviewHullContentRow[],
): OverviewHullContentRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.nodeKey === undefined) continue;
    counts.set(row.nodeKey, (counts.get(row.nodeKey) ?? 0) + 1);
  }
  return rows.filter((row) =>
    row.nodeKey !== undefined && counts.get(row.nodeKey) === 1
  );
}

function sessionsByRecordKey(
  sessions: readonly ThreadViewerSession[],
): ReadonlyMap<string, string[]> {
  const sessionsByRecord = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.anchor.kind === "project-review") continue;
    const key = `${session.anchor.kind}:${session.anchor.id}`;
    sessionsByRecord.set(key, [...sessionsByRecord.get(key) ?? [], session.id]);
  }
  return sessionsByRecord;
}
