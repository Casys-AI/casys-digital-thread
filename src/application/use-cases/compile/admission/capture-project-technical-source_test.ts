import { assertEquals, assertRejects } from "@std/assert";
import {
  CaptureBackedTechnicalCompilationSourceReader,
  TechnicalCompilationSourceReadError,
} from "../../../../adapters/compile/admission/capture-backed-technical-compilation-source-reader.ts";
import { FixedTechnicalCompilationProfileCatalogProvider } from "../../../../adapters/compile/admission/fixed-technical-compilation-profile-catalog-provider.ts";
import { createInitialTechnicalSourceAnalysisCaptureService } from "../../../../adapters/compile/captures/initial-technical-source-analysis-composition.ts";
import { QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE } from "../../../../adapters/cad/source/qualified-build123d-source-analyzer.ts";
import { SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE } from "../../../../adapters/electrical/spice/circuit-source-analyzer.ts";
import { QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE } from "../../../../adapters/modelica/source/qualified-source-analyzer.ts";
import { FileProjectSourceWorkspaceStore } from "../../../../adapters/project-source-workspace/file-project-source-workspace-store.ts";
import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import { FileAgentResourceStore } from "../../../../adapters/resource/file-agent-resource-store.ts";
import { parseAgentResourceEnvelope } from "../../../../domain/resource/agent-resource-envelope.ts";
import { technicalSourceAnalysisCaptureStores } from "../../../../testing/technical-source-capture-test-support.ts";
import { ReopenAgentResource } from "../../resource/reopen-agent-resource.ts";
import { ProjectSourceWorkspaceUseCases } from "../../project-source-workspace/project-source-workspace-use-cases.ts";
import { ProjectTechnicalSourceCaptureError } from "../../../ports/in/compile/admission/project-technical-source-capture.ts";
import { CaptureProjectTechnicalSource } from "./capture-project-technical-source.ts";

const PROJECT = "project.vertical-two";
const CAD_SOURCE = [
  "from build123d import Box",
  "length = 20",
  "width = 10",
  "height = 2",
  "result = Box(length, width, height)",
  "",
].join("\n");
const MODELICA_SOURCE = `model CaptureTemperatureTrial
  parameter Real heatingRate(unit = "K/s") = 1;
  output Real temperatureC(unit = "degC", start = 20, fixed = true);
equation
  der(temperatureC) = heatingRate;
annotation(experiment(StartTime = 0, StopTime = 1, Interval = 0.1, Tolerance = 1e-6));
end CaptureTemperatureTrial;
`;
const SPICE_SOURCE = "Vin in 0 5\nRload in 0 1k\n";
const BASIS = {
  kind: "thread-snapshot" as const,
  snapshotId: "snapshot.1",
  revision: 1,
  subjectId: "subject.vertical-two",
};

Deno.test("CAD, Modelica and SPICE captures bind the exact workspace file revision", async () => {
  await withWorkspace(async (harness) => {
    const cad = await harness.captureFile({
      fileId: "file.cad",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "assembly.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    assertEquals(cad.review.parser.status, "passed");
    assertEquals(
      cad.review.reference.schemaVersion,
      TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
    );
    validateTechnicalSourceAnalysisCaptureLocator(cad.review.reference);

    const modelica = await harness.captureFile({
      fileId: "file.modelica",
      role: "modelica-model",
      profileId: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
      name: "thermal.mo",
      mimeType: "text/x-modelica",
      text: MODELICA_SOURCE,
    });
    assertEquals(modelica.review.parser.status, "passed");
    assertEquals(modelica.review.levers.status, "not-applicable");

    const spice = await harness.captureFile({
      fileId: "file.spice",
      role: "spice-circuit",
      profileId: SPICE_CIRCUIT_SOURCE_ANALYSIS_PROFILE,
      name: "clamp.cir",
      mimeType: "text/x-spice",
      text: SPICE_SOURCE,
    });
    assertEquals(spice.review.parser.status, "passed");
    assertEquals(spice.review.levers.status, "not-applicable");
  });
});

Deno.test("capture refuses missing, unknown and role-mismatched profiles plus inactive revisions", async () => {
  await withWorkspace(async (harness) => {
    const missing = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          fileId: "file.cad",
          fileRevision: 1,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(missing.code, "file_not_found");

    await harness.putFile({
      fileId: "file.unknown",
      role: "cad-script",
      profileId: "no-such-profile",
      name: "unknown.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const unknown = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          fileId: "file.unknown",
          fileRevision: 1,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(unknown.code, "profile_not_registered");

    await harness.putFile({
      fileId: "file.role",
      role: "script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "role.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const role = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          fileId: "file.role",
          fileRevision: 1,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(role.code, "role_mismatch");

    const seeded = await harness.captureFile({
      fileId: "file.tombstone",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "gone.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const removed = await harness.workspace.removeFile({
      projectId: PROJECT,
      mutationId: "remove-tombstone",
      expectedWorkspaceRevision: harness.revision,
      mutation: {
        kind: "file_remove",
        fileId: "file.tombstone",
        activeFileRevision: seeded.fileRevision,
      },
    });
    harness.revision = removed.workspaceRevision;
    const tombstone = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          fileId: "file.tombstone",
          fileRevision: seeded.fileRevision,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(tombstone.code, "file_revision_not_active");
  });
});

Deno.test("a sibling workspace bump still reopens the historical capture and a successor never substitutes", async () => {
  await withWorkspace(async (harness) => {
    const original = await harness.captureFile({
      fileId: "file.cad",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "assembly.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const historicalRevision = original.workspaceRevision;
    await harness.putFile({
      fileId: "file.sibling",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "sibling.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const successorText = CAD_SOURCE.replace("height = 2", "height = 8");
    await harness.putFile({
      fileId: "file.cad",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "assembly.py",
      mimeType: "text/x-python",
      text: successorText,
      predecessorFileRevision: original.fileRevision,
    });
    const fingerprint = await sha256Fingerprint(original.review.reference);
    const reopened = await harness.reader.read({
      projectId: PROJECT,
      basis: BASIS,
      reference: original.review.reference,
      referenceFingerprint: fingerprint,
    });
    assertEquals(reopened.source.sourceText.includes("height = 2"), true);
    assertEquals(
      reopened.provenance.projectSource.workspaceRevision,
      historicalRevision,
    );
    assertEquals(reopened.provenance.projectSource.fileRevision, original.fileRevision);
    assertEquals(reopened.source.sourceText.includes("height = 8"), false);
  });
});

Deno.test("cross-project reuse and V1 locators are rejected", async () => {
  await withWorkspace(async (harness) => {
    const captured = await harness.captureFile({
      fileId: "file.cad",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "assembly.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const fingerprint = await sha256Fingerprint(captured.review.reference);
    const foreign = await assertRejects(
      () =>
        harness.reader.read({
          projectId: "project.foreign",
          basis: BASIS,
          reference: captured.review.reference,
          referenceFingerprint: fingerprint,
        }),
      TechnicalCompilationSourceReadError,
    );
    assertEquals(foreign.code, "project_mismatch");
    const oldLocator = await assertRejects(
      () =>
        harness.reader.read({
          projectId: PROJECT,
          basis: BASIS,
          reference: {
            schemaVersion: "technical-source-analysis-capture/1.0",
            kind: "technical-source-analysis",
            fingerprint: captured.review.reference.fingerprint,
            byteCount: captured.review.reference.byteCount,
            casUri: captured.review.reference.casUri,
          } as never,
          referenceFingerprint: fingerprint,
        }),
      TechnicalCompilationSourceReadError,
    );
    assertEquals(oldLocator.code, "locator_invalid");
  });
});

function uniqueSourceText(mimeType: string, text: string, fileId: string): string {
  if (mimeType.includes("python")) return `${text}# ${fileId}\n`;
  if (mimeType.includes("modelica")) return `${text}\n// ${fileId}\n`;
  if (mimeType.includes("spice")) return `${text}* ${fileId}\n`;
  return `${text}\n${fileId}\n`;
}

async function withWorkspace(
  run: (harness: WorkspaceHarness) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "technical-source-workspace-" });
  try {
    const resourceStore = new FileAgentResourceStore(`${directory}/resources`);
    const reopen = new ReopenAgentResource(resourceStore);
    const store = new FileProjectSourceWorkspaceStore(`${directory}/workspace`);
    const workspace = new ProjectSourceWorkspaceUseCases({
      projects: { get: (id) => Promise.resolve(id === PROJECT ? { id } : undefined) },
      workspace: store,
      resources: reopen,
    });
    await workspace.putModule({
      projectId: PROJECT,
      mutationId: "module-root",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put",
        moduleId: "mod.root",
        slug: "src",
        displayName: "Sources",
      },
    });
    const captures = createInitialTechnicalSourceAnalysisCaptureService(
      technicalSourceAnalysisCaptureStores(`${directory}/captures`),
    );
    const capture = new CaptureProjectTechnicalSource({
      workspace: store,
      resources: reopen,
      captures,
    });
    const reader = new CaptureBackedTechnicalCompilationSourceReader({
      captures,
      workspace: store,
      resources: reopen,
      profiles: new FixedTechnicalCompilationProfileCatalogProvider(),
    });
    const harness: WorkspaceHarness = {
      revision: 1,
      workspace,
      store,
      capture,
      reader,
      async putFile(input) {
        const stored = await resourceStore.save(parseAgentResourceEnvelope({
          name: input.name,
          mimeType: input.mimeType,
          text: uniqueSourceText(input.mimeType, input.text, input.fileId),
        }));
        const snapshot = await workspace.putFile({
          projectId: PROJECT,
          mutationId: `put-${input.fileId}-${this.revision + 1}`,
          expectedWorkspaceRevision: this.revision,
          mutation: {
            kind: "file_put",
            fileId: input.fileId,
            moduleId: "mod.root",
            logicalName: input.name,
            role: input.role,
            dependencies: [],
            resourceRef: stored.reference,
            captureRequest: { profileId: input.profileId },
            ...(input.predecessorFileRevision !== undefined
              ? { predecessorFileRevision: input.predecessorFileRevision }
              : {}),
          },
        });
        this.revision = snapshot.workspaceRevision;
        const state = await store.load(PROJECT);
        const file = state.files.get(input.fileId);
        if (!file) throw new Error(`missing file ${input.fileId}`);
        return {
          workspaceRevision: snapshot.workspaceRevision,
          fileRevision: file.headRevision,
        };
      },
      async captureFile(input) {
        const put = await this.putFile(input);
        const review = await capture.capture({
          projectId: PROJECT,
          workspaceRevision: put.workspaceRevision,
          fileId: input.fileId,
          fileRevision: put.fileRevision,
        });
        return { ...put, review };
      },
    };
    await run(harness);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

interface WorkspaceHarness {
  revision: number;
  workspace: ProjectSourceWorkspaceUseCases;
  store: FileProjectSourceWorkspaceStore;
  capture: CaptureProjectTechnicalSource;
  reader: CaptureBackedTechnicalCompilationSourceReader;
  putFile(input: {
    fileId: string;
    role: string;
    profileId: string;
    name: string;
    mimeType: string;
    text: string;
    predecessorFileRevision?: number;
  }): Promise<{ workspaceRevision: number; fileRevision: number }>;
  captureFile(input: {
    fileId: string;
    role: string;
    profileId: string;
    name: string;
    mimeType: string;
    text: string;
    predecessorFileRevision?: number;
  }): Promise<{
    workspaceRevision: number;
    fileRevision: number;
    review: Awaited<ReturnType<CaptureProjectTechnicalSource["capture"]>>;
  }>;
}
