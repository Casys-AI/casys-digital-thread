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
import { FileProjectSourceClosureStore } from "../../../../adapters/project-source-workspace/file-project-source-closure-store.ts";
import { FixedProjectSourceAttachmentRoleCatalog } from "../../../../adapters/project-source-workspace/fixed-project-source-attachment-role-catalog.ts";
import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { TechnicalCompilationBasis } from "../../../../domain/compile/admission/technical-compilation.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import { FileAgentResourceStore } from "../../../../adapters/resource/file-agent-resource-store.ts";
import { parseAgentResourceEnvelope } from "../../../../domain/resource/agent-resource-envelope.ts";
import { technicalSourceAnalysisCaptureStores } from "../../../../testing/technical-source-capture-test-support.ts";
import { ReopenAgentResource } from "../../resource/reopen-agent-resource.ts";
import { ProjectSourceWorkspaceUseCases } from "../../project-source-workspace/project-source-workspace-use-cases.ts";
import { ProjectTechnicalSourceCaptureError } from "../../../ports/in/compile/admission/project-technical-source-capture.ts";
import { CaptureProjectTechnicalSource } from "./capture-project-technical-source.ts";
import type { OpenedProductStructure } from "../../../ports/out/product-navigation/product-structure-traversal.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";

const PROJECT = "project.vertical-two";
const SUBJECT = "subject.vertical-two";
const SNAPSHOT_ID = "snapshot.1";
const ARCHITECTURE_ID = "architecture-" + "a".repeat(64);
const ARCHITECTURE_FP = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};
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
const COMPILATION_BASIS: TechnicalCompilationBasis = {
  thread: {
    projectId: PROJECT,
    subjectId: SUBJECT,
    snapshotId: SNAPSHOT_ID,
    revision: 1,
    snapshotFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
  },
  sysmlAnchor: {
    artifactId: ARCHITECTURE_ID,
    artifactFingerprint: ARCHITECTURE_FP,
    captureId: "capture.syson",
    editingContextId: "editing-context.main",
    rootElementId: "pkg",
    rootElementKind: "Package",
    elements: [{
      id: "def.cad",
      kind: "PartDefinition",
      provenance: {
        artifactId: ARCHITECTURE_ID,
        artifactFingerprint: ARCHITECTURE_FP,
        captureId: "capture.syson",
      },
    }],
  },
  sysmlAnchorFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
};

Deno.test("CAD, Modelica and SPICE captures bind the exact workspace attachment head", async () => {
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

Deno.test("public capture refuses free-root file fields and missing attachments", async () => {
  await withWorkspace(async (harness) => {
    const extra = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          fileId: "file.cad",
          fileRevision: 1,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(extra.code, "invalid_request");

    const missing = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          attachmentId: "att.missing",
          attachmentRevision: 1,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(missing.code, "attachment_not_found");
  });
});

Deno.test("capture refuses unknown profiles and source-removed attachments while profile owns the analyzer role", async () => {
  await withWorkspace(async (harness) => {
    const unknown = await harness.putAttachedFile({
      fileId: "file.unknown",
      role: "cad-script",
      profileId: "no-such-profile",
      name: "unknown.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const unknownCapture = await assertRejects(
      () =>
        harness.capture.capture({
          projectId: PROJECT,
          workspaceRevision: harness.revision,
          attachmentId: unknown.attachmentId,
          attachmentRevision: unknown.attachmentRevision,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(unknownCapture.code, "profile_not_registered");

    const role = await harness.putAttachedFile({
      fileId: "file.role",
      role: "script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "role.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const roleCapture = await harness.capture.capture({
      projectId: PROJECT,
      workspaceRevision: harness.revision,
      attachmentId: role.attachmentId,
      attachmentRevision: role.attachmentRevision,
    });
    assertEquals(roleCapture.parser.status, "passed");

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
          attachmentId: seeded.attachmentId,
          attachmentRevision: seeded.attachmentRevision,
        }),
      ProjectTechnicalSourceCaptureError,
    );
    assertEquals(tombstone.code, "source_removed");
  });
});

Deno.test("a later workspace edit does not rewrite a historical capture reopen", async () => {
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
      basis: COMPILATION_BASIS,
      reference: original.review.reference,
      referenceFingerprint: fingerprint,
    });
    assertEquals(reopened.source.sourceText.includes("height = 2"), true);
    assertEquals(
      reopened.provenance.sourceClosure.workspaceRevision,
      historicalRevision,
    );
    assertEquals(
      reopened.provenance.sourceClosure.root.fileRevision,
      original.fileRevision,
    );
    assertEquals(reopened.source.sourceText.includes("height = 8"), false);
    assertEquals(reopened.source.effectiveUnit.closureKind, "root-only");
  });
});

Deno.test("a multi-file Build123d closure captures and reopens the exact lowered unit", async () => {
  await withWorkspace(async (harness) => {
    const dependency = await harness.putFile({
      fileId: "dep-dimensions",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "dimensions.py",
      mimeType: "text/x-python",
      text: "width = 20\n",
    });
    const root = await harness.captureFile({
      fileId: "file.assembly",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "assembly.py",
      mimeType: "text/x-python",
      text: [
        "from casys_workspace.f_6465702d64696d656e73696f6e73 import width",
        "from build123d import Box",
        "result = Box(width, 10, 2)",
        "",
      ].join("\n"),
      dependencies: [{
        fileId: "dep-dimensions",
        fileRevision: dependency.fileRevision,
      }],
    });
    const captured = await harness.captures.reopenLocator(root.review.reference);
    assertEquals(
      captured.document.effectiveUnit.kind,
      "build123d-workspace-closure-lowered",
    );
    assertEquals(
      captured.document.effectiveUnit.closureKind,
      "build123d-workspace-closure-lowered",
    );
    if (
      captured.document.effectiveUnit.kind !==
        "build123d-workspace-closure-lowered"
    ) {
      throw new Error("expected a lowered Build123d effective unit");
    }
    assertEquals(
      captured.document.source.id,
      `technical-unit:${captured.document.sourceClosure.fingerprint.digest}`,
    );
    assertEquals(
      captured.sourceText.includes("casys_workspace"),
      false,
    );
    assertEquals(captured.sourceText.includes("width = 20"), true);
    assertEquals(
      captured.document.effectiveUnit.loweringManifest.script.fingerprint.digest,
      captured.document.source.sha256,
    );

    const reopened = await harness.reader.read({
      projectId: PROJECT,
      basis: COMPILATION_BASIS,
      reference: root.review.reference,
      referenceFingerprint: await sha256Fingerprint(root.review.reference),
    });
    assertEquals(reopened.source.sourceText, captured.sourceText);
    const { loweringManifest: _loweringManifest, ...compactEffectiveUnit } =
      captured.document.effectiveUnit;
    assertEquals(
      reopened.source.effectiveUnit,
      compactEffectiveUnit,
    );
  });
});

Deno.test("source reader refuses a capture that mixes another file's root-only closure", async () => {
  await withWorkspace(async (harness) => {
    const alone = await harness.captureFile({
      fileId: "file.alone",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "alone.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const mixed = await harness.captureFile({
      fileId: "file.cad",
      role: "cad-script",
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      name: "assembly.py",
      mimeType: "text/x-python",
      text: CAD_SOURCE,
    });
    const aloneCapture = await harness.captures.reopenLocator(
      alone.review.reference,
    );
    const mixedReader = new CaptureBackedTechnicalCompilationSourceReader({
      captures: {
        requireCaptureProfile: (profileId) =>
          harness.captures.requireCaptureProfile(profileId),
        persist: (input) => harness.captures.persist(input),
        reopenLocator: async (value) => {
          const reopened = await harness.captures.reopenLocator(value);
          if (
            reopened.locator.casUri !== mixed.review.reference.casUri
          ) return reopened;
          return {
            ...reopened,
            document: {
              ...reopened.document,
              sourceClosure: {
                ...reopened.document.sourceClosure,
                locator: aloneCapture.document.sourceClosure.locator,
                fingerprint: aloneCapture.document.sourceClosure.fingerprint,
              },
            },
          };
        },
      },
      closures: harness.closures,
      workspace: harness.store,
      resources: harness.resources,
      profiles: new FixedTechnicalCompilationProfileCatalogProvider(),
    });
    const fingerprint = await sha256Fingerprint(mixed.review.reference);
    const error = await assertRejects(
      () =>
        mixedReader.read({
          projectId: PROJECT,
          basis: COMPILATION_BASIS,
          reference: mixed.review.reference,
          referenceFingerprint: fingerprint,
        }),
      TechnicalCompilationSourceReadError,
    );
    assertEquals(error.code, "closure_mismatch");
  });
});

Deno.test("cross-project reuse and v2 locators are rejected", async () => {
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
          basis: COMPILATION_BASIS,
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
          basis: COMPILATION_BASIS,
          reference: {
            schemaVersion: "technical-source-analysis-capture-locator/2.0",
            kind: "technical-source-analysis-capture-locator",
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

function uniqueSourceText(
  mimeType: string,
  text: string,
  fileId: string,
): string {
  if (mimeType.includes("python")) return `${text}# ${fileId}\n`;
  if (mimeType.includes("modelica")) return `${text}\n// ${fileId}\n`;
  if (mimeType.includes("spice")) return `${text}* ${fileId}\n`;
  return `${text}\n${fileId}\n`;
}

async function withWorkspace(
  run: (harness: WorkspaceHarness) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({
    prefix: "technical-source-workspace-",
  });
  try {
    const resourceStore = new FileAgentResourceStore(`${directory}/resources`);
    const reopen = new ReopenAgentResource(resourceStore);
    const store = new FileProjectSourceWorkspaceStore(`${directory}/workspace`);
    const roles = new FixedProjectSourceAttachmentRoleCatalog();
    const workspace = new ProjectSourceWorkspaceUseCases({
      projects: {
        get: (id) =>
          Promise.resolve(
            id === PROJECT
              ? {
                project: { id: PROJECT, name: "P", subjectId: SUBJECT },
                threadSnapshots: [{
                  snapshotId: SNAPSHOT_ID,
                  revision: 1,
                  subjectId: SUBJECT,
                }],
              } as unknown as EngineeringProjectSnapshot
              : undefined,
          ),
      },
      workspace: store,
      resources: reopen,
      snapshots: {
        get: () =>
          Promise.resolve({
            id: SNAPSHOT_ID,
            revision: 1,
            subject: { id: SUBJECT },
            artifacts: [{
              id: ARCHITECTURE_ID,
              fingerprint: ARCHITECTURE_FP,
            }],
          } as unknown as ThreadSnapshot),
      },
      traversal: {
        open: () => Promise.resolve(openedStructure()),
      },
      roles,
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
    const stores = technicalSourceAnalysisCaptureStores(
      `${directory}/captures`,
    );
    const captures = createInitialTechnicalSourceAnalysisCaptureService(stores);
    const closures = new FileProjectSourceClosureStore(stores.closureDocuments);
    const capture = new CaptureProjectTechnicalSource({
      workspace: store,
      resources: reopen,
      captures,
      closures,
      roles,
    });
    const reader = new CaptureBackedTechnicalCompilationSourceReader({
      captures,
      closures,
      workspace: store,
      resources: reopen,
      profiles: new FixedTechnicalCompilationProfileCatalogProvider(),
    });
    const harness: WorkspaceHarness = {
      revision: 1,
      workspace,
      store,
      capture,
      captures,
      closures,
      resources: reopen,
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
            dependencies: input.dependencies ?? [],
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
      async putAttachedFile(input) {
        const put = await this.putFile(input);
        const attachmentId = `att.${input.fileId}`;
        const snapshot = await workspace.putAttachment({
          projectId: PROJECT,
          mutationId: `att-${input.fileId}-${this.revision + 1}`,
          expectedWorkspaceRevision: this.revision,
          mutation: {
            kind: "attachment_put",
            attachmentId,
            fileId: input.fileId,
            role: { id: "design-source", version: 1 },
            target: {
              elementId: `def.${input.fileId}`,
              elementKind: "PartDefinition",
            },
            declaredAgainst: {
              thread: {
                snapshotId: SNAPSHOT_ID,
                revision: 1,
                subjectId: SUBJECT,
              },
              architecture: {
                artifactId: ARCHITECTURE_ID,
                fingerprint: ARCHITECTURE_FP,
                captureSchema: "architecture-capture/4.0",
              },
            },
          },
        });
        this.revision = snapshot.workspaceRevision;
        return {
          ...put,
          workspaceRevision: snapshot.workspaceRevision,
          attachmentId,
          attachmentRevision: 1,
        };
      },
      async captureFile(input) {
        const put = await this.putAttachedFile(input);
        const review = await capture.capture({
          projectId: PROJECT,
          workspaceRevision: put.workspaceRevision,
          attachmentId: put.attachmentId,
          attachmentRevision: put.attachmentRevision,
        });
        return { ...put, review };
      },
    };
    await run(harness);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

function openedStructure(): OpenedProductStructure {
  return {
    architectureArtifactId: ARCHITECTURE_ID,
    architectureFingerprint: ARCHITECTURE_FP,
    root: () => undefined,
    childrenOfRoot: () => [],
    childrenOf: () => [],
    path: () => undefined,
    neighborhood: () => ({ siblings: [], children: [] }),
    element: () => undefined,
    searchElements: () => [],
    pageOccurrences: () => ({ items: [], nextOffset: null }),
    hasDefinition: () => false,
    hasElement: () => true,
    typedDefinition: () => undefined,
  };
}

interface WorkspaceHarness {
  revision: number;
  workspace: ProjectSourceWorkspaceUseCases;
  store: FileProjectSourceWorkspaceStore;
  capture: CaptureProjectTechnicalSource;
  captures: ReturnType<
    typeof createInitialTechnicalSourceAnalysisCaptureService
  >;
  closures: FileProjectSourceClosureStore;
  resources: ReopenAgentResource;
  reader: CaptureBackedTechnicalCompilationSourceReader;
  putFile(input: {
    fileId: string;
    role: string;
    profileId: string;
    name: string;
    mimeType: string;
    text: string;
    dependencies?: readonly { fileId: string; fileRevision: number }[];
    predecessorFileRevision?: number;
  }): Promise<{ workspaceRevision: number; fileRevision: number }>;
  putAttachedFile(input: {
    fileId: string;
    role: string;
    profileId: string;
    name: string;
    mimeType: string;
    text: string;
    dependencies?: readonly { fileId: string; fileRevision: number }[];
    predecessorFileRevision?: number;
  }): Promise<{
    workspaceRevision: number;
    fileRevision: number;
    attachmentId: string;
    attachmentRevision: number;
  }>;
  captureFile(input: {
    fileId: string;
    role: string;
    profileId: string;
    name: string;
    mimeType: string;
    text: string;
    dependencies?: readonly { fileId: string; fileRevision: number }[];
    predecessorFileRevision?: number;
  }): Promise<{
    workspaceRevision: number;
    fileRevision: number;
    attachmentId: string;
    attachmentRevision: number;
    review: Awaited<ReturnType<CaptureProjectTechnicalSource["capture"]>>;
  }>;
}
