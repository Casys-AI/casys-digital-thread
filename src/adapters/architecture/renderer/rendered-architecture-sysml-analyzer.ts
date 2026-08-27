/**
 * Compiler companion for the bounded, server-rendered architecture SysML form.
 *
 * It does not attempt to parse arbitrary SysML. The only input accepted here is
 * the renderer's exact text paired with its typed manifest. Consequently a
 * relation is emitted only where the manifest explicitly attests a PartUsage
 * and its typed PartDefinition target.
 */

import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  type RenderedArchitectureSysml,
  validateRenderedArchitectureSysml,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  type SourceAnalysisBundle,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";

export const RENDERED_ARCHITECTURE_SYSML_ANALYZER_ID =
  "rendered-architecture-sysml" as const;
export const RENDERED_ARCHITECTURE_SYSML_ANALYZER_VERSION = "1.1.0" as const;
export const RENDERED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE =
  "server-rendered-architecture-sysml-v1" as const;

/** SourceAnalysis frontend specialized to the renderer/manifest pair. */
export interface RenderedArchitectureSysmlAnalysisFrontend {
  analyzeRendered(input: {
    readonly sourceId: string;
    readonly rendered: RenderedArchitectureSysml;
  }): Promise<SourceAnalysisBundle>;
}

export class RenderedArchitectureSysmlAnalyzer
  implements RenderedArchitectureSysmlAnalysisFrontend {
  async analyzeRendered(input: {
    readonly sourceId: string;
    readonly rendered: RenderedArchitectureSysml;
  }): Promise<SourceAnalysisBundle> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(input.sourceId)) {
      throw new TypeError("SysML sourceId must be a safe id.");
    }
    const rendered = validateRenderedArchitectureSysml(input.rendered);
    const sourceFingerprint = await fingerprintUtf8(rendered.sourceText);
    const symbols = [];
    const symbolIdByEntry = new Map<number, string>();
    for (const [index, entry] of rendered.manifest.entries.entries()) {
      const kind = entry.kind === "package"
        ? "artifact" as const
        : entry.kind === "attribute"
        ? "parameter" as const
        : "component" as const;
      const name = entry.kind === "package"
        ? entry.packageName
        : entry.kind === "part-definition"
        ? entry.definitionName!
        : entry.kind === "attribute"
        ? entry.attributeName!
        : entry.usageName!;
      const id = await tupleId("symbol", {
        entry: entryIdentity(entry),
        sourceId: input.sourceId,
      });
      symbolIdByEntry.set(index, id);
      symbols.push({ id, kind, name, span: entry.span });
    }
    const definitionByName = new Map<string, number>();
    for (const [index, entry] of rendered.manifest.entries.entries()) {
      if (entry.kind === "part-definition") {
        if (definitionByName.has(entry.definitionName!)) {
          throw new TypeError(
            "Rendered SysML manifest has duplicate PartDefinition entries.",
          );
        }
        definitionByName.set(entry.definitionName!, index);
      }
    }
    const dependencies = [];
    for (const [index, entry] of rendered.manifest.entries.entries()) {
      if (entry.kind !== "part-usage") continue;
      const targetIndex = definitionByName.get(entry.targetName!);
      // A standalone `part usage : Type;` intentionally has no declaration in
      // its own source text. Keep Type as an explicit manifest-attested target
      // reference (without claiming it was declared here), rather than refusing
      // a real registered write form or inferring from text.
      const targetSymbolId = targetIndex === undefined
        ? await tupleId("target-reference", {
          sourceId: input.sourceId,
          targetName: entry.targetName,
          selector: entry.selector,
        })
        : symbolIdByEntry.get(targetIndex)!;
      if (targetIndex === undefined) {
        symbols.push({
          id: targetSymbolId,
          kind: "component" as const,
          name: entry.targetName!,
        });
      }
      dependencies.push({
        id: await tupleId("structural-incidence", {
          from: symbolIdByEntry.get(index),
          sourceId: input.sourceId,
          to: targetSymbolId,
        }),
        kind: "structural-incidence" as const,
        fromSymbolId: symbolIdByEntry.get(index)!,
        toSymbolId: targetSymbolId,
        span: entry.span,
      });
    }
    return validateSourceAnalysisBundle({
      schemaVersion: SOURCE_ANALYSIS_SCHEMA,
      source: {
        id: input.sourceId,
        role: "sysml-model",
        language: "sysml-v2",
        fingerprint: sourceFingerprint,
      },
      analyzer: {
        id: RENDERED_ARCHITECTURE_SYSML_ANALYZER_ID,
        version: RENDERED_ARCHITECTURE_SYSML_ANALYZER_VERSION,
      },
      policy: {
        profile: RENDERED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
        status: "passed",
        findings: [],
      },
      symbols,
      dependencies,
      unresolvedConstructs: [],
    });
  }
}

/** Stable id, hashed from an unambiguous canonical selector tuple. */
export function sysmlRenderedSourceIdFor(
  selector: RenderedArchitectureSysml["manifest"]["selector"],
  runId: string,
  operation: { readonly id: string; readonly version: string },
): Promise<string> {
  return tupleId("source", { operation, runId, selector });
}

async function tupleId(kind: string, tuple: unknown): Promise<string> {
  const fingerprint = await sha256Fingerprint({ kind, tuple });
  return `sysml-${kind}:${fingerprint.digest}`;
}

function entryIdentity(
  entry: RenderedArchitectureSysml["manifest"]["entries"][number],
): unknown {
  return {
    kind: entry.kind,
    selector: entry.selector,
    packageName: entry.packageName,
    parentName: entry.parentName,
    definitionName: entry.definitionName,
    usageName: entry.usageName,
    attributeName: entry.attributeName,
    targetName: entry.targetName,
    span: entry.span,
  };
}

async function fingerprintUtf8(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256" as const,
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}
