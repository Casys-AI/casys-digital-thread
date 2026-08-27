import { assertEquals } from "@std/assert";
import {
  sampleAdmissionSourceWorkspaceFields,
} from "../../testing/technical-source-capture-test-support.ts";
import type { TechnicalCompilationAdmissionBinding } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import type {
  TechnicalSourceAttachmentProvenance,
  TechnicalSourceClosureProvenance,
} from "../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type {
  ProjectSourceFileRecord,
  ProjectSourceModule,
  ProjectSourceWorkspaceState,
} from "../../domain/project-source-workspace/types.ts";
import {
  recrossTechnicalAdmissionSourceFiles,
  type TechnicalAdmissionSourceFileFacts,
} from "./technical-admission-source-files.ts";

const ADMISSION = "technical-compilation-admission-" + "a".repeat(64);
const ARCHITECTURE = {
  artifactId: "architecture-capture-root",
  fingerprint: `sha256:${"1".repeat(64)}`,
};
const PROFILE = "build123d-closed-subset-v1";

Deno.test(
  "recross projects exact source bindings against the named workspace revision",
  () => {
    const identity = sampleAdmissionSourceWorkspaceFields("source.cad");
    const workspace = matchingWorkspace(identity);
    const files = recrossTechnicalAdmissionSourceFiles({
      facts: facts(identity, [
        binding("represents", "artifact.result", "def-hook", "PartDefinition"),
        binding(
          "parameterizes",
          "parameter.thickness",
          "attr-thickness",
          "AttributeUsage",
        ),
      ]),
      currentArchitecture: {
        artifactId: ARCHITECTURE.artifactId,
        fingerprint: ARCHITECTURE.fingerprint,
      },
      workspaceHead: workspace,
      workspaceAtNamedRevision: workspace,
    });
    assertEquals(files.length, 1);
    assertEquals(files[0]?.fileId, "source.cad");
    assertEquals(files[0]?.fileRevision, 1);
    assertEquals(files[0]?.workspaceRevision, 2);
    assertEquals(files[0]?.role, "cad-script");
    assertEquals(files[0]?.moduleId, "mod-mech");
    assertEquals(files[0]?.derivedPath, "/mech/hook.py");
    assertEquals(files[0]?.admissionArtifactId, ADMISSION);
    assertEquals(files[0]?.bindings.map((item) => item.relation), [
      "represents",
      "parameterizes",
    ]);
  },
);

Deno.test(
  "recross fails closed when the current architecture artifact is not the admission basis",
  () => {
    const identity = sampleAdmissionSourceWorkspaceFields("source.cad");
    const workspace = matchingWorkspace(identity);
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: {
          artifactId: "architecture-other",
          fingerprint: ARCHITECTURE.fingerprint,
        },
        workspaceHead: workspace,
        workspaceAtNamedRevision: workspace,
      }),
      [],
    );
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: {
          artifactId: ARCHITECTURE.artifactId,
          fingerprint: `sha256:${"9".repeat(64)}`,
        },
        workspaceHead: workspace,
        workspaceAtNamedRevision: workspace,
      }),
      [],
    );
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: undefined,
        workspaceHead: workspace,
        workspaceAtNamedRevision: workspace,
      }),
      [],
    );
  },
);

Deno.test(
  "recross fails closed when the current workspace head is stale relative to the admission",
  () => {
    const identity = sampleAdmissionSourceWorkspaceFields("source.cad");
    const named = matchingWorkspace(identity);
    const staleHead: ProjectSourceWorkspaceState = {
      ...named,
      workspaceRevision: 9,
      lastEventFingerprint: {
        algorithm: "sha256",
        digest: "d".repeat(64),
      },
    };
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: ARCHITECTURE,
        workspaceHead: staleHead,
        workspaceAtNamedRevision: named,
      }),
      [],
    );
  },
);

Deno.test(
  "recross fails closed when the named workspace revision cannot recross the file identity",
  () => {
    const identity = sampleAdmissionSourceWorkspaceFields("source.cad");
    const workspace = matchingWorkspace(identity);
    const original = workspace.files.get("source.cad")!;
    const originalRevision = original.revisions.get(1);
    if (!originalRevision || originalRevision.kind !== "content") {
      throw new Error("expected content revision");
    }
    const mismatched: ProjectSourceWorkspaceState = {
      ...workspace,
      files: new Map([
        ["source.cad", {
          fileId: original.fileId,
          headRevision: original.headRevision,
          status: original.status,
          revisions: new Map([
            [1, {
              ...originalRevision,
              fingerprint: {
                algorithm: "sha256" as const,
                digest: "0".repeat(64),
              },
            }],
          ]),
        }],
      ]),
    };
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: ARCHITECTURE,
        workspaceHead: mismatched,
        workspaceAtNamedRevision: mismatched,
      }),
      [],
    );
  },
);

Deno.test(
  "recross fails closed without a workspace or when the admission project is foreign",
  () => {
    const identity = sampleAdmissionSourceWorkspaceFields("source.cad");
    const workspace = matchingWorkspace(identity);
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: ARCHITECTURE,
        workspaceHead: undefined,
        workspaceAtNamedRevision: workspace,
      }),
      [],
    );
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(identity, []),
        currentArchitecture: ARCHITECTURE,
        workspaceHead: workspace,
        workspaceAtNamedRevision: undefined,
        projectId: "project.foreign",
      }),
      [],
    );
  },
);

function facts(
  identity: {
    readonly attachment: TechnicalSourceAttachmentProvenance;
    readonly sourceClosure: TechnicalSourceClosureProvenance;
  },
  bindings: readonly TechnicalCompilationAdmissionBinding[],
): TechnicalAdmissionSourceFileFacts {
  return {
    admissionArtifactId: ADMISSION,
    architecture: {
      artifactId: ARCHITECTURE.artifactId,
      artifactFingerprint: {
        algorithm: "sha256",
        digest: "1".repeat(64),
      },
    },
    sources: [{
      id: identity.sourceClosure.root.fileId,
      role: "cad-script",
      language: "python",
      profileId: PROFILE,
      attachment: identity.attachment,
      sourceClosure: identity.sourceClosure,
    }],
    bindings,
  };
}

function binding(
  relation: "represents" | "parameterizes",
  sourceSymbolId: string,
  sysmlElementId: string,
  sysmlElementKind: string,
): TechnicalCompilationAdmissionBinding {
  return {
    id: `binding:${sourceSymbolId}:${relation}`,
    sourceId: "source.cad",
    sourceSymbolId,
    sysmlElementId,
    sysmlElementKind,
    relation,
  };
}

function matchingWorkspace(
  identity: {
    readonly attachment: TechnicalSourceAttachmentProvenance;
    readonly sourceClosure: TechnicalSourceClosureProvenance;
  },
): ProjectSourceWorkspaceState {
  const { attachment, sourceClosure } = identity;
  const root = sourceClosure.root;
  const modules = new Map<string, ProjectSourceModule>([
    ["mod-mech", {
      moduleId: "mod-mech",
      slug: "mech",
      displayName: "Mech",
    }],
  ]);
  const files = new Map<string, ProjectSourceFileRecord>([
    [root.fileId, {
      fileId: root.fileId,
      headRevision: root.fileRevision,
      status: "active",
      revisions: new Map([[root.fileRevision, {
        kind: "content",
        fileId: root.fileId,
        fileRevision: root.fileRevision,
        resourceRef: root.resourceRef,
        moduleId: "mod-mech",
        logicalName: "hook.py",
        role: "mechanical-source",
        captureRequest: { profileId: PROFILE },
        dependencies: [],
        fingerprint: root.fileFingerprint,
      }]]),
    }],
  ]);
  return {
    projectId: sourceClosure.projectId,
    workspaceRevision: sourceClosure.workspaceRevision,
    lastEventFingerprint: sourceClosure.workspaceEventFingerprint,
    modules,
    files,
    attachments: new Map([
      [attachment.attachmentId, {
        attachmentId: attachment.attachmentId,
        fileId: attachment.fileId,
        headRevision: attachment.attachmentRevision,
        status: "active",
        revisions: new Map([[attachment.attachmentRevision, {
          kind: "content",
          attachmentId: attachment.attachmentId,
          attachmentRevision: attachment.attachmentRevision,
          fileId: attachment.fileId,
          role: attachment.role,
          target: attachment.target,
          declaredAgainst: attachment.declaredAgainst,
          fingerprint: attachment.fingerprint,
        }]]),
      }],
    ]),
    mutations: new Map(),
  };
}
