import { assertEquals } from "@std/assert";
import { sampleTechnicalProjectSourceAnchor } from "../../testing/technical-source-capture-test-support.ts";
import type { TechnicalCompilationAdmissionBinding } from "../../domain/compile/admission/technical-compilation-proposal.ts";
import type { TechnicalProjectSourceAnchor } from "../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
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
    const anchor = sampleTechnicalProjectSourceAnchor("source.cad");
    const workspace = matchingWorkspace(anchor);
    const files = recrossTechnicalAdmissionSourceFiles({
      facts: facts(anchor, [
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
    const anchor = sampleTechnicalProjectSourceAnchor("source.cad");
    const workspace = matchingWorkspace(anchor);
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(anchor, []),
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
        facts: facts(anchor, []),
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
        facts: facts(anchor, []),
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
    const anchor = sampleTechnicalProjectSourceAnchor("source.cad");
    const named = matchingWorkspace(anchor);
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
        facts: facts(anchor, []),
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
    const anchor = sampleTechnicalProjectSourceAnchor("source.cad");
    const workspace = matchingWorkspace(anchor);
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
        facts: facts(anchor, []),
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
    const anchor = sampleTechnicalProjectSourceAnchor("source.cad");
    const workspace = matchingWorkspace(anchor);
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(anchor, []),
        currentArchitecture: ARCHITECTURE,
        workspaceHead: undefined,
        workspaceAtNamedRevision: workspace,
      }),
      [],
    );
    assertEquals(
      recrossTechnicalAdmissionSourceFiles({
        facts: facts(anchor, []),
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
  anchor: TechnicalProjectSourceAnchor,
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
      id: anchor.fileId,
      role: "cad-script",
      language: "python",
      profileId: PROFILE,
      projectSource: anchor,
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
  anchor: TechnicalProjectSourceAnchor,
): ProjectSourceWorkspaceState {
  const modules = new Map<string, ProjectSourceModule>([
    ["mod-mech", {
      moduleId: "mod-mech",
      slug: "mech",
      displayName: "Mech",
    }],
  ]);
  const files = new Map<string, ProjectSourceFileRecord>([
    [anchor.fileId, {
      fileId: anchor.fileId,
      headRevision: anchor.fileRevision,
      status: "active",
      revisions: new Map([[anchor.fileRevision, {
        kind: "content",
        fileId: anchor.fileId,
        fileRevision: anchor.fileRevision,
        resourceRef: anchor.resourceRef,
        moduleId: "mod-mech",
        logicalName: "hook.py",
        role: "cad-script",
        captureRequest: { profileId: PROFILE },
        dependencies: [],
        fingerprint: anchor.fileFingerprint,
      }]]),
    }],
  ]);
  return {
    projectId: anchor.projectId,
    workspaceRevision: anchor.workspaceRevision,
    lastEventFingerprint: anchor.workspaceEventFingerprint,
    modules,
    files,
    mutations: new Map(),
  };
}
