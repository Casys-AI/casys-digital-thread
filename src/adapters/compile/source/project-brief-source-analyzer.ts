/**
 * Conservative frontend for the canonical JSON representation of one project
 * brief revision. It promotes only the explicit item ids and V2 gate
 * dependencies; statements and source references deliberately remain text and
 * documentary evidence, never inferred graph relations.
 */

import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  exactRecord,
  nonEmptyText,
  safeId,
  safeVersion,
} from "../../../domain/kernel/case-validation.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import { briefSourceIdFor } from "../../../domain/compile/brief/brief-source-analysis-reference.ts";
import type {
  SourceAnalysisFrontend,
  SourceAnalysisFrontendInput,
} from "../../../domain/compile/source/source-analysis-frontend.ts";

export const PROJECT_BRIEF_SOURCE_ANALYZER_ID = "project-brief-json" as const;
export const PROJECT_BRIEF_SOURCE_ANALYZER_VERSION = "1.0.0" as const;
export const PROJECT_BRIEF_SOURCE_ANALYSIS_PROFILE =
  "project-brief-explicit-v1" as const;

const ITEM_KINDS = new Set([
  "objective",
  "primary-user",
  "mission-scenario",
  "operating-environment",
  "success-criterion",
  "constraint",
  "exclusion",
  "intended-market",
  "manufacturing-jurisdiction",
  "operating-jurisdiction",
  "compliance-target",
  "verification-activity",
  "manufacturing-evidence",
  "observed-fact",
  "assumption",
  "open-question",
  "proposed-decision",
]);

export { briefSourceIdFor } from "../../../domain/compile/brief/brief-source-analysis-reference.ts";

/** Parser-backed (JSON plus exact structural validation) brief frontend. */
export class ProjectBriefSourceAnalyzer implements SourceAnalysisFrontend {
  async analyze(input: SourceAnalysisFrontendInput): Promise<SourceAnalysisBundle> {
    if (input.role !== "brief" || input.language !== "plain-text") {
      throw new TypeError(
        "ProjectBriefSourceAnalyzer only accepts source role brief and language plain-text.",
      );
    }
    if (typeof input.sourceText !== "string" || input.sourceText.length === 0) {
      throw new TypeError("Project brief sourceText must be a non-empty string.");
    }
    safeId(input.sourceId, "$input.sourceId");
    const fingerprint = await fingerprintText(input.sourceText);

    try {
      const parsed = JSON.parse(input.sourceText);
      if (deterministicJson(parsed) !== input.sourceText) {
        throw new TypeError(
          "Project brief sourceText must be canonical deterministic JSON.",
        );
      }
      const brief = parseBriefRevision(parsed);
      const expectedSourceId = await briefSourceIdFor(
        brief.briefId,
        brief.id,
        brief.revision,
      );
      if (input.sourceId !== expectedSourceId) {
        throw new TypeError("sourceId does not match the canonical brief identity.");
      }
      const symbols = await Promise.all(brief.items.map(async (item) => ({
        id: await tupleId("brief-item", { itemId: item.id }),
        kind: "brief-item" as const,
        name: item.id,
      })));
      const symbolIdByItemId = new Map(
        symbols.map((symbol) => [symbol.name, symbol.id]),
      );
      const dependencies = [];
      if (brief.contractVersion === "2.0") {
        for (const gate of brief.items) {
          if (!isGate(gate.kind)) continue;
          for (const prerequisiteId of gate.dependsOnItemIds!) {
            dependencies.push({
              id: await tupleId("dependency-declared", {
                fromItemId: prerequisiteId,
                toItemId: gate.id,
              }),
              kind: "declared-dependency" as const,
              fromSymbolId: symbolIdByItemId.get(prerequisiteId)!,
              toSymbolId: symbolIdByItemId.get(gate.id)!,
            });
          }
        }
      }
      const unresolvedConstructs = [];
      if (brief.contractVersion === "1.0") {
        for (const gate of brief.items) {
          if (!isGate(gate.kind)) continue;
          unresolvedConstructs.push({
            id: await tupleId("unresolved-brief-v1-gate-dependencies", {
              gateItemId: gate.id,
            }),
            kind: "brief-v1-gate-dependencies",
            message:
              "Historical V1 brief gate has no explicit item dependency declaration.",
          });
        }
      }
      return validateSourceAnalysisBundle({
        schemaVersion: SOURCE_ANALYSIS_SCHEMA,
        source: {
          id: input.sourceId,
          role: "brief",
          language: "plain-text",
          fingerprint,
        },
        analyzer: {
          id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
          version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
        },
        policy: {
          profile: PROJECT_BRIEF_SOURCE_ANALYSIS_PROFILE,
          status: "passed",
          findings: [],
        },
        symbols,
        dependencies,
        unresolvedConstructs,
      });
    } catch (error) {
      return rejectedBundle(input, fingerprint, errorMessage(error));
    }
  }
}

interface ParsedBriefItem {
  readonly id: string;
  readonly kind: string;
  readonly dependsOnItemIds?: readonly string[];
}

interface ParsedBriefRevision {
  readonly contractVersion: "1.0" | "2.0";
  readonly briefId: string;
  readonly id: string;
  readonly revision: number;
  readonly items: readonly ParsedBriefItem[];
}

function parseBriefRevision(value: unknown): ParsedBriefRevision {
  const raw = asRecord(value, "$brief");
  const contractVersion = raw.contractVersion === undefined
    ? "1.0"
    : raw.contractVersion;
  if (contractVersion !== "1.0" && contractVersion !== "2.0") {
    throw new TypeError("$brief.contractVersion must be 1.0 or 2.0.");
  }
  exactKeys(
    raw,
    ["briefId", "id", "revision", "items", "proposedAt", "proposedBy"],
    ["contractVersion", "previous"],
    "$brief",
  );
  const briefId = safeId(raw.briefId, "$brief.briefId");
  const id = safeId(raw.id, "$brief.id");
  const revision = positiveInteger(raw.revision, "$brief.revision");
  parseIsoDateTime(raw.proposedAt, "$brief.proposedAt");
  parseActor(raw.proposedBy, "$brief.proposedBy");
  if (raw.previous !== undefined) parsePrevious(raw.previous, "$brief.previous");
  if (!Array.isArray(raw.items)) throw new TypeError("$brief.items must be an array.");
  const items = raw.items.map((item, index) =>
    parseBriefItem(item, `$brief.items[${index}]`, contractVersion)
  );
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) throw new TypeError("$brief.items ids must be unique.");
    itemIds.add(item.id);
  }
  if (items.filter((item) => item.kind === "objective").length !== 1) {
    throw new TypeError("$brief.items must contain exactly one objective.");
  }
  if (!items.some((item) => item.kind === "mission-scenario")) {
    throw new TypeError("$brief.items must contain a mission-scenario.");
  }
  if (!items.some((item) => item.kind === "success-criterion")) {
    throw new TypeError("$brief.items must contain a success-criterion.");
  }
  if (
    (revision === 1 && raw.previous !== undefined) ||
    (revision > 1 &&
      (!raw.previous ||
        (raw.previous as Record<string, unknown>).revision !== revision - 1))
  ) {
    throw new TypeError(
      "$brief.previous must name the immediately preceding revision.",
    );
  }
  if (contractVersion === "2.0") {
    for (const gate of items) {
      if (!isGate(gate.kind)) continue;
      const seen = new Set<string>();
      for (const prerequisiteId of gate.dependsOnItemIds!) {
        if (seen.has(prerequisiteId)) {
          throw new TypeError(`$brief gate ${gate.id} dependencies must be unique.`);
        }
        seen.add(prerequisiteId);
        if (prerequisiteId === gate.id) {
          throw new TypeError(`$brief gate ${gate.id} must not depend on itself.`);
        }
        if (!itemIds.has(prerequisiteId)) {
          throw new TypeError(
            `$brief gate ${gate.id} dependency ${prerequisiteId} must name an item.`,
          );
        }
      }
    }
  }
  return { contractVersion, briefId, id, revision, items };
}

function parseBriefItem(
  value: unknown,
  path: string,
  contractVersion: "1.0" | "2.0",
): ParsedBriefItem {
  const raw = asRecord(value, path);
  const isV2 = contractVersion === "2.0";
  exactKeys(
    raw,
    ["id", "kind", "statement", "sourceRefs"],
    isV2
      ? ["owner", "reviewTrigger", "dependsOnItemIds", "verificationAuthority"]
      : ["owner", "reviewTrigger"],
    path,
  );
  const id = safeId(raw.id, `${path}.id`);
  if (typeof raw.kind !== "string" || !ITEM_KINDS.has(raw.kind)) {
    throw new TypeError(`${path}.kind must be a supported project brief item kind.`);
  }
  const kind = raw.kind;
  nonEmptyText(raw.statement, `${path}.statement`);
  const sourceKinds = parseSourceRefs(raw.sourceRefs, `${path}.sourceRefs`);
  if (raw.owner !== undefined) nonEmptyText(raw.owner, `${path}.owner`);
  if (raw.reviewTrigger !== undefined) {
    nonEmptyText(raw.reviewTrigger, `${path}.reviewTrigger`);
  }
  if (
    kind === "assumption" &&
    (raw.owner === undefined || raw.reviewTrigger === undefined)
  ) {
    throw new TypeError(`${path} assumptions require owner and reviewTrigger.`);
  }
  if (
    kind === "observed-fact" &&
    !sourceKinds.some((sourceKind) =>
      sourceKind === "tool" || sourceKind === "document" || sourceKind === "expert"
    )
  ) {
    throw new TypeError(
      `${path} observed facts require a tool, document, or expert source.`,
    );
  }
  const hasDependencies = Object.hasOwn(raw, "dependsOnItemIds");
  const hasVerificationAuthority = Object.hasOwn(raw, "verificationAuthority");
  if (hasVerificationAuthority) {
    if (kind !== "verification-activity") {
      throw new TypeError(
        `${path}.verificationAuthority is only permitted on a verification-activity.`,
      );
    }
    const authority = exactRecord(
      raw.verificationAuthority,
      ["id", "version"],
      `${path}.verificationAuthority`,
    );
    safeId(authority.id, `${path}.verificationAuthority.id`);
    safeVersion(authority.version, `${path}.verificationAuthority.version`);
  }
  if (!isV2) return { id, kind };
  if (isGate(kind)) {
    if (!hasDependencies) {
      throw new TypeError(`${path}.dependsOnItemIds is required for a V2 gate.`);
    }
    if (!Array.isArray(raw.dependsOnItemIds)) {
      throw new TypeError(`${path}.dependsOnItemIds must be an array.`);
    }
    return {
      id,
      kind,
      dependsOnItemIds: raw.dependsOnItemIds.map((dependencyId, index) =>
        safeId(dependencyId, `${path}.dependsOnItemIds[${index}]`)
      ),
    };
  }
  if (hasDependencies) {
    throw new TypeError(`${path}.dependsOnItemIds is only permitted on V2 gates.`);
  }
  return { id, kind };
}

function parseSourceRefs(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length === 0) {
    throw new TypeError(`${path} must retain at least one source.`);
  }
  return value.map((sourceRef, index) => {
    const source = exactRecord(sourceRef, ["kind", "reference"], `${path}[${index}]`);
    if (
      source.kind !== "intent" && source.kind !== "answer" && source.kind !== "tool" &&
      source.kind !== "document" && source.kind !== "expert"
    ) {
      throw new TypeError(`${path}[${index}].kind must be a supported source kind.`);
    }
    nonEmptyText(source.reference, `${path}[${index}].reference`);
    return source.kind as string;
  });
}

function parseActor(value: unknown, path: string): void {
  const actor = exactRecord(value, ["id", "origin"], path);
  if (
    typeof actor.id !== "string" || actor.id.length === 0 ||
    actor.id !== actor.id.trim()
  ) {
    throw new TypeError(`${path}.id must be a non-empty trimmed opaque actor id.`);
  }
  if (actor.origin !== "human" && actor.origin !== "agent") {
    throw new TypeError(`${path}.origin must be human or agent.`);
  }
}

function parsePrevious(value: unknown, path: string): void {
  const previous = exactRecord(value, ["snapshotId", "revision"], path);
  safeId(previous.snapshotId, `${path}.snapshotId`);
  positiveInteger(previous.revision, `${path}.revision`);
}

function parseIsoDateTime(value: unknown, path: string): void {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) {
    throw new TypeError(`${path} must be a canonical ISO date-time.`);
  }
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${path} must be valid.`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be a record.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path} has unsupported field ${key}.`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required.`);
  }
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}

function isGate(kind: string): boolean {
  return kind === "success-criterion" || kind === "verification-activity";
}

function rejectedBundle(
  input: SourceAnalysisFrontendInput,
  fingerprint: Awaited<ReturnType<typeof fingerprintText>>,
  message: string,
): SourceAnalysisBundle {
  return validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: input.sourceId,
      role: "brief",
      language: "plain-text",
      fingerprint,
    },
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
    policy: {
      profile: PROJECT_BRIEF_SOURCE_ANALYSIS_PROFILE,
      status: "rejected",
      findings: [{
        id: "finding:invalid-brief-source",
        code: "invalid-brief-source",
        severity: "error",
        message: `Project brief source was rejected: ${message}`,
      }],
    },
    symbols: [],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

async function fingerprintText(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256" as const,
    digest: [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

async function tupleId(
  prefix: string,
  tuple: Readonly<Record<string, string>>,
): Promise<string> {
  const fingerprint = await fingerprintText(deterministicJson(tuple));
  return safeId(`${prefix}:${fingerprint.digest}`, "$brief.generatedId");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
