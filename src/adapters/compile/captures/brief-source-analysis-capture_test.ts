import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { SourceAnalysisFrontend } from "../../../domain/compile/source/source-analysis-frontend.ts";
import type { SourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import {
  FixedSourceAnalysisFrontendRegistry,
  SourceAnalysisFrontendNotRegisteredError,
} from "../../../domain/compile/source/source-analysis-frontend-registry.ts";
import type { ProjectBriefRevision } from "../../../domain/project/project-brief.ts";
import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  BriefSourceAnalysisCaptureError,
  BriefSourceAnalysisCaptureService,
  requireBriefSourceAnalysis,
  validateBriefSourceCapture,
} from "./brief-source-analysis-capture.ts";
import {
  PROJECT_BRIEF_SOURCE_ANALYZER_ID,
  PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
  ProjectBriefSourceAnalyzer,
} from "../source/project-brief-source-analyzer.ts";

const BRIEF: ProjectBriefRevision = {
  contractVersion: "2.0" as const,
  briefId: "project-a:brief",
  id: "brief-snapshot-2",
  revision: 2,
  previous: { snapshotId: "brief-snapshot-1", revision: 1 },
  items: [{
    id: "objective",
    kind: "objective" as const,
    statement: "Keep the water hot.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:1" }],
  }, {
    id: "mission",
    kind: "mission-scenario" as const,
    statement: "Heat water during a nominal beverage cycle.",
    sourceRefs: [{ kind: "intent" as const, reference: "conversation:1" }],
  }, {
    id: "gate-thermal",
    kind: "success-criterion" as const,
    statement: "Temperature remains stable.",
    sourceRefs: [{ kind: "document" as const, reference: "spec:thermal" }],
    dependsOnItemIds: [],
  }],
  proposedAt: "2026-08-11T09:00:00.000Z",
  proposedBy: { id: "agent:planner", origin: "agent" as const },
};

Deno.test("brief source capture seals canonical bytes before the frontend runs", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    let sourcePresentBeforeAnalysis = false;
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        sourcePresentBeforeAnalysis = await hasAnyCapture(sourceCaptures);
        return await new ProjectBriefSourceAnalyzer().analyze(input);
      },
    };
    const service = new BriefSourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      ...briefFrontendRegistration(frontend),
    });

    const reference = await service.capture({ brief: BRIEF });

    assertEquals(sourcePresentBeforeAnalysis, true);
    const sourceText = await sourceCaptures.read(reference.sourceCaptureFingerprint);
    assertEquals(sourceText !== undefined, true);
    assertEquals(JSON.parse(sourceText!).sourceText, deterministicJson(BRIEF));
    assertEquals(
      await analysisCaptures.read(reference.analysisFingerprint) !== undefined,
      true,
    );
    assertEquals(/^brief-source:[a-f0-9]{64}$/.test(reference.sourceId), true);
  });
});

Deno.test("brief source capture validation recomputes bytes and metadata", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const service = new BriefSourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      ...briefFrontendRegistration(new ProjectBriefSourceAnalyzer()),
    });
    const reference = await service.capture({ brief: BRIEF });
    const persisted = await sourceCaptures.read(reference.sourceCaptureFingerprint);
    const capture = JSON.parse(persisted!);

    await assertRejects(
      () => validateBriefSourceCapture({ ...capture, briefSnapshotId: "other" }),
      TypeError,
      "metadata does not match",
    );
    await assertRejects(
      () =>
        validateBriefSourceCapture({
          ...capture,
          sourceFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
        }),
      TypeError,
      "does not match sourceText bytes",
    );
  });
});

Deno.test("brief source capture rejects a mismatched analysis identity before analysis CAS save", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        const bundle = await new ProjectBriefSourceAnalyzer().analyze(input);
        return { ...bundle, source: { ...bundle.source, id: "brief:other" } };
      },
    };
    const service = new BriefSourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      ...briefFrontendRegistration(frontend),
    });

    const error = await assertRejects(
      () => service.capture({ brief: BRIEF }),
      BriefSourceAnalysisCaptureError,
    );
    assertInstanceOf(error, BriefSourceAnalysisCaptureError);
    assertEquals(error.code, "analysis_identity_mismatch");
    assertEquals(await hasAnyCapture(analysisCaptures), false);
  });
});

Deno.test("brief source capture persists a rejected analysis without granting a reference", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    let rejected: SourceAnalysisBundle | undefined;
    const frontend: SourceAnalysisFrontend = {
      analyze: async (input) => {
        const accepted = await new ProjectBriefSourceAnalyzer().analyze(input);
        rejected = {
          ...accepted,
          policy: {
            ...accepted.policy,
            status: "rejected",
            findings: [{
              id: "finding:rejected",
              code: "rejected",
              severity: "error",
              message: "Intentional test rejection.",
            }],
          },
        };
        return rejected;
      },
    };
    const service = new BriefSourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      ...briefFrontendRegistration(frontend),
    });

    const error = await assertRejects(
      () => service.capture({ brief: BRIEF }),
      BriefSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "analysis_rejected");
    assertEquals(await hasAnyCapture(analysisCaptures), true);
  });
});

Deno.test("brief source analysis replay uses the persisted analyzer version", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const registration = briefFrontendRegistration(new ProjectBriefSourceAnalyzer());
    const service = new BriefSourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      ...registration,
    });
    const historical = await service.capture({ brief: BRIEF });

    const replay = await requireBriefSourceAnalysis(historical, {
      sourceCaptures,
      analysisCaptures,
      frontends: registration.frontends,
    });

    assertEquals(replay.bundle.analyzer, registration.analyzer);
    assertEquals(replay.reference, historical);
  });
});

Deno.test("brief source analysis replay refuses an unregistered persisted analyzer before promotion", async () => {
  await withStores(async ({ sourceCaptures, analysisCaptures }) => {
    const registration = briefFrontendRegistration(new ProjectBriefSourceAnalyzer());
    const service = new BriefSourceAnalysisCaptureService({
      sourceCaptures,
      analysisCaptures,
      ...registration,
    });
    const historical = await service.capture({ brief: BRIEF });

    let promotionReached = false;
    await assertRejects(
      () =>
        requireBriefSourceAnalysis(historical, {
          sourceCaptures,
          analysisCaptures,
          frontends: new FixedSourceAnalysisFrontendRegistry([]),
        }).then(() => {
          promotionReached = true;
        }),
      SourceAnalysisFrontendNotRegisteredError,
      "project-brief-json@1.0.0",
    );
    assertEquals(promotionReached, false);
  });
});

async function withStores(
  action: (stores: {
    sourceCaptures: FileCaptureStore<"brief-source-capture">;
    analysisCaptures: FileCaptureStore<"source-analysis">;
  }) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "brief-source-analysis-" });
  try {
    await action({
      sourceCaptures: new FileCaptureStore({
        kind: "brief-source-capture",
        directory: `${directory}/sources`,
        uriNamespace: "brief-source-test",
        label: "Brief source test",
      }),
      analysisCaptures: new FileCaptureStore({
        kind: "source-analysis",
        directory: `${directory}/analyses`,
        uriNamespace: "source-analysis-test",
        label: "Source analysis test",
      }),
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

async function hasAnyCapture(store: FileCaptureStore<string>): Promise<boolean> {
  const directory = store.pathFor({
    algorithm: "sha256",
    digest: "0".repeat(64),
  }).replace(/\/[^/]+$/, "");
  try {
    for await (const _entry of Deno.readDir(directory)) return true;
    return false;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

function briefFrontendRegistration(frontend: SourceAnalysisFrontend): {
  readonly frontends: FixedSourceAnalysisFrontendRegistry;
  readonly analyzer: {
    readonly id: typeof PROJECT_BRIEF_SOURCE_ANALYZER_ID;
    readonly version: typeof PROJECT_BRIEF_SOURCE_ANALYZER_VERSION;
  };
} {
  return {
    frontends: new FixedSourceAnalysisFrontendRegistry([{
      analyzer: {
        id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
        version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
      },
      frontend,
    }]),
    analyzer: {
      id: PROJECT_BRIEF_SOURCE_ANALYZER_ID,
      version: PROJECT_BRIEF_SOURCE_ANALYZER_VERSION,
    },
  };
}
