/**
 * Overview hull projection of current DFM-check Engineering Cases.
 *
 * Consumes `engineering-cases/1.1` `current` recrossed with exact `cases`
 * and `engineeringCaseRefs`. It never recomputes current selection, picks
 * latest by date/id, or synthesizes a viewer payload. FEA principal folding
 * is not reused: one DFM case has an evidence capture and three evaluations.
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
const PHYSICS_DFM = overviewThreadD3FlowGroupIdentity(
  "physics",
  OVERVIEW_DOMAIN_GROUP_KEYS.dfm,
);
const VERDICTS_DFM = overviewThreadD3FlowGroupIdentity(
  "verdicts",
  OVERVIEW_DOMAIN_GROUP_KEYS.dfm,
);

export const OVERVIEW_CURRENT_DFM_CASES_ADAPTER_ID = "current-dfm-cases";

/**
 * Fold server current DFM selections onto DFM hulls. Missing or unusable
 * DTOs leave the existing exact records untouched.
 */
export function withOverviewCurrentDfmCases(
  contents: ReadonlyMap<string, OverviewHullContent>,
  nodes: readonly OverviewHeroNode[],
  input: OverviewCurrentEngineeringCasesInput = {},
): ReadonlyMap<string, OverviewHullContent> {
  if (!usableEngineeringCaseCatalog(input.catalog)) return contents;
  const catalog = input.catalog;
  const currentCases = dfmCurrentCases(catalog);
  if (currentCases.length === 0) return contents;
  const membersByHull = dfmMembersByHull(nodes);
  if (membersByHull.size === 0) return contents;

  const sessionsByRecord = sessionsByRecordKey(input.sessions ?? []);
  const viewerAliases = input.viewerAliases ?? NO_VIEWER_ALIASES;
  const result = new Map(contents);
  for (const [groupKey, content] of contents) {
    const members = membersByHull.get(groupKey);
    if (!members || members.length === 0) continue;
    const wrapped = buildOverviewCurrentDfmCasesContent(
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

export const currentDfmCasesAdapter: OverviewHullAdapter = {
  id: OVERVIEW_CURRENT_DFM_CASES_ADAPTER_ID,
  apply(contents, context) {
    return withOverviewCurrentDfmCases(
      contents,
      context.nodes,
      context.engineeringCases,
    );
  },
};

export function buildOverviewCurrentDfmCasesContent(
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
  const currentCases = dfmCurrentCases(catalog);
  if (currentCases.length === 0) return undefined;
  const unique = uniqueRecordedMembers(members);
  const sessionsByRecord = input.sessionsByRecord ??
    sessionsByRecordKey(input.sessions ?? []);
  const viewerAliases = input.viewerAliases ?? NO_VIEWER_ALIASES;
  const lookupNodes = input.nodes ?? unique;
  const rows = content.groupKey === PHYSICS_DFM
    ? physicsCurrentDfmRows(
      currentCases,
      unique,
      sessionsByRecord,
      viewerAliases,
    )
    : content.groupKey === VERDICTS_DFM
    ? verdictCurrentDfmRows(
      currentCases,
      unique,
      lookupNodes,
      sessionsByRecord,
      viewerAliases,
    )
    : undefined;
  if (rows === undefined) return undefined;
  return {
    groupKey: content.groupKey,
    mode: "records",
    rows,
    records: content.records,
    ...(content.status ? { status: content.status } : {}),
  };
}

function physicsCurrentDfmRows(
  currentCases: readonly EngineeringCase[],
  members: readonly OverviewRecordedHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): OverviewHullContentRow[] {
  const rows: OverviewHullContentRow[] = [];
  for (const sealed of currentCases) {
    const currentMembers = members.filter((member) =>
      member.node.engineeringCaseRefs?.includes(sealed.key)
    );
    const caseArtifact = uniqueAuthorityMember(sealed, currentMembers);
    const captures = currentMembers.filter((member) =>
      isDfmCaptureCandidate(member, sealed)
    );
    if (captures.length === 1) {
      const capture = captures[0]!;
      const observations = currentMembers
        .filter((member) => member.node.entityKind === "observation")
        .map((member) => member.key)
        .toSorted((left, right) => left.localeCompare(right));
      const graphRefs = [
        capture.key,
        ...[caseArtifact?.key, ...observations]
          .filter((key): key is string =>
            key !== undefined && key !== capture.key
          )
          .toSorted((left, right) => left.localeCompare(right)),
      ];
      const viewer = overviewHullBoundRowViewer(
        capture.key,
        sessionsByRecord,
        viewerAliases,
      );
      rows.push({
        key: sealed.key,
        kind: "record",
        label: engineeringCasePresentationLabel(sealed.id),
        depth: 0,
        nodeKey: capture.key,
        graphRefs,
        ...(viewer.viewerNodeKey
          ? { viewerNodeKey: viewer.viewerNodeKey }
          : {}),
        sessionIds: viewer.sessionIds,
        endpoint: true,
        selectable: true,
        focusable: true,
      });
      continue;
    }
    if (captures.length === 0 && caseArtifact) {
      rows.push({
        key: sealed.key,
        kind: "record",
        label: engineeringCasePresentationLabel(sealed.id),
        depth: 0,
        nodeKey: caseArtifact.key,
        graphRefs: [caseArtifact.key],
        sessionIds: [],
        endpoint: true,
        selectable: true,
        focusable: true,
      });
      continue;
    }
    if (captures.length > 1) {
      for (const capture of captures) {
        const viewer = overviewHullBoundRowViewer(
          capture.key,
          sessionsByRecord,
          viewerAliases,
        );
        rows.push({
          key: capture.key,
          kind: "record",
          label: engineeringCasePresentationLabel(sealed.id),
          depth: 0,
          nodeKey: capture.key,
          graphRefs: [capture.key],
          ...(viewer.viewerNodeKey
            ? { viewerNodeKey: viewer.viewerNodeKey }
            : {}),
          sessionIds: viewer.sessionIds,
          endpoint: true,
          selectable: true,
          focusable: true,
        });
      }
    }
  }
  return uniquePrincipalCurrentCaseRows(rows);
}

function verdictCurrentDfmRows(
  currentCases: readonly EngineeringCase[],
  members: readonly OverviewRecordedHeroNode[],
  nodes: readonly OverviewHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): OverviewHullContentRow[] {
  const currentKeys = new Set(currentCases.map((item) => item.key));
  const rows: OverviewHullContentRow[] = [];
  for (const member of members) {
    if (member.node.entityKind !== "evaluation") continue;
    const owned = uniqueOwnedCurrentCase(member, currentKeys);
    if (owned === undefined) continue;
    const viewer = overviewHullBoundRowViewer(
      member.key,
      sessionsByRecord,
      viewerAliases,
    );
    const requirementName = exactRequirementName(member, nodes);
    const status = displayVerdictSummary(member.node.summary);
    rows.push({
      key: member.key,
      kind: "record",
      label: requirementName ?? member.label,
      ...(status ? { detail: status } : {}),
      depth: 0,
      nodeKey: member.key,
      graphRefs: [member.key],
      ...(viewer.viewerNodeKey ? { viewerNodeKey: viewer.viewerNodeKey } : {}),
      sessionIds: viewer.sessionIds,
      endpoint: true,
      selectable: true,
      focusable: true,
    });
  }
  return rows.toSorted((left, right) => left.key.localeCompare(right.key));
}

function uniqueAuthorityMember(
  sealed: EngineeringCase,
  members: readonly OverviewRecordedHeroNode[],
): OverviewRecordedHeroNode | undefined {
  const authorities = members.filter((member) =>
    member.node.ref.kind === "artifact" &&
    sealed.authorityArtifactIds.includes(member.node.ref.id)
  );
  return authorities.length === 1 ? authorities[0] : undefined;
}

function isDfmCaptureCandidate(
  member: OverviewRecordedHeroNode,
  sealed: EngineeringCase,
): boolean {
  return member.node.ref.kind === "artifact" &&
    member.node.artifactKind === "evidence" &&
    member.node.engineeringCaseRefs?.includes(sealed.key) === true &&
    !sealed.authorityArtifactIds.includes(member.node.ref.id);
}

function uniqueOwnedCurrentCase(
  member: OverviewRecordedHeroNode,
  currentKeys: ReadonlySet<string>,
): string | undefined {
  const owned = (member.node.engineeringCaseRefs ?? []).filter((key) =>
    currentKeys.has(key)
  );
  return owned.length === 1 ? owned[0] : undefined;
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

function dfmCurrentCases(
  catalog: EngineeringCaseCatalog,
): readonly EngineeringCase[] {
  const casesByKey = new Map(catalog.cases.map((item) => [item.key, item]));
  const current: EngineeringCase[] = [];
  for (const selection of catalog.current) {
    if (selection.family !== "dfm-check") continue;
    const sealed = recrossedCurrentCase(selection, casesByKey);
    if (!sealed || sealed.caseSchemaVersion !== "dfm-check-case/1.0") {
      return [];
    }
    current.push(sealed);
  }
  return current;
}

function dfmMembersByHull(
  nodes: readonly OverviewHeroNode[],
): ReadonlyMap<string, OverviewRecordedHeroNode[]> {
  const groups = new Map<string, OverviewRecordedHeroNode[]>();
  for (const node of nodes) {
    if (node.kind !== "recorded") continue;
    if (node.groupKey !== OVERVIEW_DOMAIN_GROUP_KEYS.dfm) continue;
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

/** One capture may back at most one current-case physics row. */
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
