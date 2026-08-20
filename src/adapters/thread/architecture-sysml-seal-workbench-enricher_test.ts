import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../../testing/workbench/generic-thread-workbench-fixture.ts";
import { QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE } from "../architecture/agent-seal/qualified-architecture-sysml-analyzer.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileArchitectureSysmlSealCaptureReader } from "../architecture/agent-seal/file-architecture-sysml-seal-capture-reader.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "../architecture/agent-seal/architecture-sysml-source-analysis-composition.ts";
import {
  ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX,
  validateArchitectureSysmlSealCapture,
} from "../architecture/agent-seal/architecture-sysml-seal-capture-schema.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import { enrichThreadWorkbenchWithArchitectureSysmlSeals } from "./architecture-sysml-seal-workbench-enricher.ts";

const SOURCE_TEXT = `package DroneV4 {
  part def DroneSystem {
    part wing : Wing;
    part motor : Motor;
  }
  part def Wing {}
  part def Motor {}
}
`;

Deno.test(
  "enricher reopens a sealed architecture SysML document as symbol ids, not Product Structure",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "architecture-sysml-seal-enricher-",
    });
    try {
      const sources = createArchitectureSysmlSourceAnalysisCaptureService({
        sourceCaptures: new FileByteStore({
          kind: "architecture-sysml-source",
          directory: `${root}/sources`,
          uriNamespace: "architecture-sysml-source",
          label: "architecture SysML source",
        }),
        analysisCaptures: new FileByteStore({
          kind: "architecture-sysml-source-analysis",
          directory: `${root}/analyses`,
          uriNamespace: "architecture-sysml-source-analysis",
          label: "architecture SysML analysis",
        }),
      });
      const reference = await sources.capture({
        profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
        sourceId: "source.architecture",
        sourceText: SOURCE_TEXT,
      });
      const capture = validateArchitectureSysmlSealCapture({
        schemaVersion: "architecture-sysml-seal-capture/1.0",
        kind: "architecture-sysml-seal",
        operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
        trustedRunId: "run.architecture-sysml",
        decisionId: "decision.architecture-sysml",
        sealedAt: "2026-08-14T00:00:00.000Z",
        admission: {
          schemaVersion: "architecture-sysml-seal-admission/1.0",
          sourceId: reference.source.id,
          profile: reference.profile,
          source: {
            sha256: reference.source.sha256,
            byteCount: reference.source.byteCount,
            casUri: reference.source.casUri,
          },
          analysis: {
            analyzer: reference.analysis.analyzer,
            policy: { ...reference.analysis.policy, status: "passed" },
            sha256: reference.analysis.sha256,
            byteCount: reference.analysis.byteCount,
            casUri: reference.analysis.casUri,
          },
        },
        sourceCapture: reference,
        unresolvedConstructs: [],
      });
      const fingerprint = await sha256Fingerprint(capture);
      const sealStore = new FileByteStore({
        kind: "architecture-sysml-seal-capture",
        directory: `${root}/seals`,
        uriNamespace: "architecture-sysml-seal-capture",
        label: "Sealed architecture SysML analysis",
      });
      await sealStore.save(
        fingerprint,
        new TextEncoder().encode(deterministicJson(capture)),
      );
      const artifactId = `architecture-sysml-seal-${fingerprint.digest}`;
      const snapshot = workbenchWithArtifact({
        id: artifactId,
        label: "Agent-authored architecture SysML analysis",
        kind: "document",
        system: "digital-thread",
        revision: fingerprint.digest,
        freshness: "fresh",
        fingerprint: `sha256:${fingerprint.digest}`,
        uri: `${ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX}${fingerprint.digest}`,
        producedBy: "model.seal-architecture-sysml@1",
        dependsOn: [],
      });

      const enriched = await enrichThreadWorkbenchWithArchitectureSysmlSeals(
        snapshot,
        {
          seals: fileArchitectureSysmlSealCaptureReader(sealStore),
          sources: {
            reopen: async (value) => {
              const reopened = await sources.reopen(value);
              const first = reopened.analysis.symbols[0];
              const second = reopened.analysis.symbols[1];
              if (!first || !second) {
                throw new Error("expected at least two symbols");
              }
              return {
                ...reopened,
                analysis: {
                  ...reopened.analysis,
                  dependencies: [
                    ...reopened.analysis.dependencies,
                    {
                      id: "dependency:declared-must-drop",
                      kind: "declared-dependency",
                      fromSymbolId: first.id,
                      toSymbolId: second.id,
                    },
                  ],
                },
              };
            },
          },
        },
      );
      const seal = enriched.artifacts.find((item) => item.id === artifactId);

      assertEquals(seal?.kind, "document");
      assertEquals(seal?.uri?.startsWith("casys://architecture-capture/"), false);
      assertEquals(seal?.architectureSysmlSeal?.authority, "documentary");
      assertEquals(
        seal?.architectureSysmlSeal?.producer,
        "model.seal-architecture-sysml@1",
      );
      assertEquals(seal?.architectureSysmlSeal?.notSyson, true);
      assertEquals(seal?.architectureSysmlSeal?.notWriteArchitecture, true);
      assertEquals(seal?.architectureSysmlSeal?.notCompilationAdmission, true);
      assertEquals(seal?.architectureSysmlSeal?.symbolsStatus, "observed");
      assertEquals(seal?.architectureSysmlSeal?.sourceStatus, "observed");
      assertEquals(seal?.architectureSysmlSeal?.sourceText, SOURCE_TEXT);
      const symbolIds = seal?.architectureSysmlSeal?.symbols.map((item) => item.id) ??
        [];
      assertEquals(symbolIds.length > 0, true);
      assertEquals(
        new Set(symbolIds).size,
        symbolIds.length,
        "bindings are unique symbol ids",
      );
      assertEquals(
        seal?.architectureSysmlSeal?.symbols.every((item) => item.id !== item.label),
        true,
        "labels stay display-only and are not used as join keys",
      );
      const symbolIdSet = new Set(symbolIds);
      const incidences = seal?.architectureSysmlSeal?.incidences ?? [];
      assertEquals(incidences.length > 0, true);
      assertEquals(
        incidences.every((item) => item.kind === "structural-incidence"),
        true,
      );
      assertEquals(
        incidences.some((item) => item.id === "dependency:declared-must-drop"),
        false,
      );
      assertEquals(
        incidences.every((item) =>
          symbolIdSet.has(item.fromSymbolId) && symbolIdSet.has(item.toSymbolId)
        ),
        true,
        "incidence ends bind symbol ids, never labels",
      );
      assertEquals(
        incidences.every((item) =>
          Object.keys(item).join(",") === "id,kind,fromSymbolId,toSymbolId,span"
        ),
        true,
      );
      const reopened = await sources.reopen(capture.sourceCapture);
      assertEquals(
        incidences.map((item) => item.id),
        reopened.analysis.dependencies
          .filter((item) => item.kind === "structural-incidence")
          .map((item) => item.id),
      );
      assertEquals(
        seal?.architectureSysmlSeal?.symbols.map((item) => item.span),
        reopened.analysis.symbols.map((item) => item.span),
      );
      assertEquals(
        incidences.map((item) => item.span),
        reopened.analysis.dependencies
          .filter((item) => item.kind === "structural-incidence")
          .map((item) => item.span),
      );
      assertEquals(enriched.graph.nodes, snapshot.graph.nodes);
      assertEquals(
        enriched.graph.nodes.some((node) =>
          node.ref.kind === "part-definition" || node.ref.kind === "part-usage"
        ),
        false,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test(
  "enricher does not promote a generic document or a missing seal capture",
  async () => {
    const snapshot = workbenchWithArtifact({
      id: "artifact.brief",
      label: "Brief",
      kind: "document",
      system: "digital-thread",
      revision: "1",
      freshness: "fresh",
      fingerprint: `sha256:${"1".repeat(64)}`,
      uri: "casys://approved-brief/sha256/" + "1".repeat(64),
      producedBy: "baseline.from-approved-brief@1",
      dependsOn: [],
    });
    const enriched = await enrichThreadWorkbenchWithArchitectureSysmlSeals(
      snapshot,
      {
        seals: { read: () => Promise.resolve(undefined) },
        sources: {
          reopen: () => {
            throw new Error("must not reopen source analysis for a brief");
          },
        },
      },
    );
    assertEquals(enriched.artifacts[0]?.architectureSysmlSeal, undefined);
  },
);

Deno.test(
  "enricher drops incidences when the sealed source analysis cannot be reopened",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "architecture-sysml-seal-enricher-unavailable-",
    });
    try {
      const sources = createArchitectureSysmlSourceAnalysisCaptureService({
        sourceCaptures: new FileByteStore({
          kind: "architecture-sysml-source",
          directory: `${root}/sources`,
          uriNamespace: "architecture-sysml-source",
          label: "architecture SysML source",
        }),
        analysisCaptures: new FileByteStore({
          kind: "architecture-sysml-source-analysis",
          directory: `${root}/analyses`,
          uriNamespace: "architecture-sysml-source-analysis",
          label: "architecture SysML analysis",
        }),
      });
      const reference = await sources.capture({
        profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
        sourceId: "source.architecture",
        sourceText: SOURCE_TEXT,
      });
      const capture = validateArchitectureSysmlSealCapture({
        schemaVersion: "architecture-sysml-seal-capture/1.0",
        kind: "architecture-sysml-seal",
        operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
        trustedRunId: "run.architecture-sysml",
        decisionId: "decision.architecture-sysml",
        sealedAt: "2026-08-14T00:00:00.000Z",
        admission: {
          schemaVersion: "architecture-sysml-seal-admission/1.0",
          sourceId: reference.source.id,
          profile: reference.profile,
          source: {
            sha256: reference.source.sha256,
            byteCount: reference.source.byteCount,
            casUri: reference.source.casUri,
          },
          analysis: {
            analyzer: reference.analysis.analyzer,
            policy: { ...reference.analysis.policy, status: "passed" },
            sha256: reference.analysis.sha256,
            byteCount: reference.analysis.byteCount,
            casUri: reference.analysis.casUri,
          },
        },
        sourceCapture: reference,
        unresolvedConstructs: [{
          id: "unresolved:comment",
          kind: "comment",
        }],
      });
      const fingerprint = await sha256Fingerprint(capture);
      const sealStore = new FileByteStore({
        kind: "architecture-sysml-seal-capture",
        directory: `${root}/seals`,
        uriNamespace: "architecture-sysml-seal-capture",
        label: "Sealed architecture SysML analysis",
      });
      await sealStore.save(
        fingerprint,
        new TextEncoder().encode(deterministicJson(capture)),
      );
      const artifactId = `architecture-sysml-seal-${fingerprint.digest}`;
      const snapshot = workbenchWithArtifact({
        id: artifactId,
        label: "Agent-authored architecture SysML analysis",
        kind: "document",
        system: "digital-thread",
        revision: fingerprint.digest,
        freshness: "fresh",
        fingerprint: `sha256:${fingerprint.digest}`,
        uri: `${ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX}${fingerprint.digest}`,
        producedBy: "model.seal-architecture-sysml@1",
        dependsOn: [],
      });

      const enriched = await enrichThreadWorkbenchWithArchitectureSysmlSeals(
        snapshot,
        {
          seals: fileArchitectureSysmlSealCaptureReader(sealStore),
          sources: {
            reopen: () => {
              throw new Error("source analysis unavailable");
            },
          },
        },
      );
      const seal = enriched.artifacts.find((item) => item.id === artifactId);
      assertEquals(seal?.architectureSysmlSeal?.symbolsStatus, "unavailable");
      assertEquals(seal?.architectureSysmlSeal?.sourceStatus, "unavailable");
      assertEquals(seal?.architectureSysmlSeal?.sourceText, undefined);
      assertEquals(seal?.architectureSysmlSeal?.symbols, []);
      assertEquals(seal?.architectureSysmlSeal?.incidences, []);
      assertEquals(seal?.architectureSysmlSeal?.unresolvedConstructs, [{
        id: "unresolved:comment",
        kind: "comment",
      }]);
      assertEquals(
        Object.keys(seal?.architectureSysmlSeal?.unresolvedConstructs[0] ?? {}),
        ["id", "kind"],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

Deno.test(
  "enricher copies analysis messages and spans and never invents them from capture id+kind",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "architecture-sysml-seal-enricher-source-",
    });
    try {
      const sources = createArchitectureSysmlSourceAnalysisCaptureService({
        sourceCaptures: new FileByteStore({
          kind: "architecture-sysml-source",
          directory: `${root}/sources`,
          uriNamespace: "architecture-sysml-source",
          label: "architecture SysML source",
        }),
        analysisCaptures: new FileByteStore({
          kind: "architecture-sysml-source-analysis",
          directory: `${root}/analyses`,
          uriNamespace: "architecture-sysml-source-analysis",
          label: "architecture SysML analysis",
        }),
      });
      const reference = await sources.capture({
        profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
        sourceId: "source.architecture",
        sourceText: SOURCE_TEXT,
      });
      const analysisSpan = {
        start: { line: 1, column: 0 },
        end: { line: 1, column: 8 },
      };
      const capture = validateArchitectureSysmlSealCapture({
        schemaVersion: "architecture-sysml-seal-capture/1.0",
        kind: "architecture-sysml-seal",
        operation: MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
        trustedRunId: "run.architecture-sysml",
        decisionId: "decision.architecture-sysml",
        sealedAt: "2026-08-14T00:00:00.000Z",
        admission: {
          schemaVersion: "architecture-sysml-seal-admission/1.0",
          sourceId: reference.source.id,
          profile: reference.profile,
          source: {
            sha256: reference.source.sha256,
            byteCount: reference.source.byteCount,
            casUri: reference.source.casUri,
          },
          analysis: {
            analyzer: reference.analysis.analyzer,
            policy: { ...reference.analysis.policy, status: "passed" },
            sha256: reference.analysis.sha256,
            byteCount: reference.analysis.byteCount,
            casUri: reference.analysis.casUri,
          },
        },
        sourceCapture: reference,
        unresolvedConstructs: [
          { id: "unresolved:comment", kind: "comment" },
          { id: "unresolved:capture-only", kind: "attribute" },
        ],
      });
      const fingerprint = await sha256Fingerprint(capture);
      const sealStore = new FileByteStore({
        kind: "architecture-sysml-seal-capture",
        directory: `${root}/seals`,
        uriNamespace: "architecture-sysml-seal-capture",
        label: "Sealed architecture SysML analysis",
      });
      await sealStore.save(
        fingerprint,
        new TextEncoder().encode(deterministicJson(capture)),
      );
      const artifactId = `architecture-sysml-seal-${fingerprint.digest}`;
      const snapshot = workbenchWithArtifact({
        id: artifactId,
        label: "Agent-authored architecture SysML analysis",
        kind: "document",
        system: "digital-thread",
        revision: fingerprint.digest,
        freshness: "fresh",
        fingerprint: `sha256:${fingerprint.digest}`,
        uri: `${ARCHITECTURE_SYSML_SEAL_CAPTURE_URI_PREFIX}${fingerprint.digest}`,
        producedBy: "model.seal-architecture-sysml@1",
        dependsOn: [],
      });

      const enriched = await enrichThreadWorkbenchWithArchitectureSysmlSeals(
        snapshot,
        {
          seals: fileArchitectureSysmlSealCaptureReader(sealStore),
          sources: {
            reopen: async (value) => {
              const reopened = await sources.reopen(value);
              return {
                ...reopened,
                analysis: {
                  ...reopened.analysis,
                  unresolvedConstructs: [{
                    id: "unresolved:comment",
                    kind: "comment",
                    message: "A comment is outside the architecture closed subset.",
                    span: analysisSpan,
                  }],
                },
              };
            },
          },
        },
      );
      const seal = enriched.artifacts.find((item) => item.id === artifactId);
      assertEquals(seal?.architectureSysmlSeal?.sourceStatus, "observed");
      assertEquals(seal?.architectureSysmlSeal?.sourceText, SOURCE_TEXT);
      assertEquals(seal?.architectureSysmlSeal?.unresolvedConstructs, [
        {
          id: "unresolved:comment",
          kind: "comment",
          message: "A comment is outside the architecture closed subset.",
          span: analysisSpan,
        },
        {
          id: "unresolved:capture-only",
          kind: "attribute",
        },
      ]);
      assertEquals(
        Object.hasOwn(
          seal?.architectureSysmlSeal?.unresolvedConstructs[1] ?? {},
          "message",
        ),
        false,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

function workbenchWithArtifact(
  artifact: ThreadWorkbenchSnapshot["artifacts"][number],
): ThreadWorkbenchSnapshot {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  snapshot.artifacts = [artifact];
  snapshot.graph = { nodes: [], edges: [] };
  snapshot.flow = [];
  snapshot.evidenceFamilyGraph = {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: snapshot.id, revision: 1 },
    families: [],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
  return snapshot;
}
