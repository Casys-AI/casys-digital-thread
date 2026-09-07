/**
 * Server-owned reconciliation of whole-App registrations from committed local
 * evidence. Never imported by the Workbench/BFF; it only writes viewer CAS and
 * the derived registry, never Project/Thread state or provider resources.
 */
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Hex,
} from "../../domain/kernel/deterministic-json.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadViewerAppBinding } from "../../presentation/workbench/thread/viewer-sessions.ts";
import { FileEngineeringProjectRevisionStore } from "../shared/stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  type CaptureStoreDescriptor,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  REQUIREMENTS_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import { FileThreadViewerAppRegistry } from "./file-thread-viewer-app-registry.ts";
import {
  materializeThreadViewerAppsCatalog,
  THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA,
  type ThreadViewerAppMaterializationCatalogBinding,
  type ThreadViewerAppRegistryPredecessorIdentity,
  ThreadViewerAppRegistryWriteConflictError,
} from "./thread-viewer-app-materializer.ts";
import {
  DEFAULT_THREAD_VIEWER_APP_PACKAGES_PATH,
  type InstalledThreadViewerAppPackage,
  readThreadViewerAppPackages,
} from "./thread-viewer-app-packages.ts";
import { buildSysonViewerBinding } from "./syson-viewer-binding.ts";
import {
  buildGeometryViewerBinding,
  GEOMETRY_VIEWER_SESSION_SCHEMA,
} from "./geometry-viewer-binding.ts";
import { buildApprovedBriefViewerBinding } from "./approved-brief-viewer-binding.ts";
import {
  buildCalculixViewerBinding,
  CALCULIX_VIEWER_SESSION_SCHEMA,
} from "./calculix-viewer-binding.ts";
import { FileCalculixIsolatedExecutionEvidenceStore } from "../fea/isolated-v3/calculix-isolated-execution-evidence.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  buildModelicaViewerBinding,
  MODELICA_VIEWER_SESSION_SCHEMA,
} from "./modelica-viewer-binding.ts";
import {
  PROJECT_RECORDS_APP_ID,
  PROJECT_RECORDS_SESSION_SCHEMA,
  PROJECT_RECORDS_WHOLE_VIEW_URI,
} from "../../apps/project-records/identity.ts";
import {
  currentViewerRegistrationBasis,
  installedViewerResource,
} from "./thread-viewer-registration-context.ts";

const MANAGED_SESSION_SCHEMAS = new Set([
  GEOMETRY_VIEWER_SESSION_SCHEMA,
  PROJECT_RECORDS_SESSION_SCHEMA,
  "io.casys.mcp-syson.recorded-model-children-session/1.0",
  "io.casys.mcp-syson.recorded-authored-requirements-session/1.0",
  CALCULIX_VIEWER_SESSION_SCHEMA,
  MODELICA_VIEWER_SESSION_SCHEMA,
]);

/** Must track the server composition, not the legacy standalone store default. */
export const CALCULIX_VIEWER_EVIDENCE_DIRECTORY =
  "state/local/recorded-analysis/calculix/isolated-execution/evidence" as const;

export interface ThreadViewerRegistrationDiagnostic {
  readonly projectId: string;
  readonly artifactId?: string;
  readonly code: "evidence-unavailable" | "app-unavailable" | "registration-error";
  readonly message: string;
}

export interface ThreadViewerRegistrationResult {
  readonly status: "updated" | "unchanged" | "packages-unavailable" | "retry";
  readonly projectCount: number;
  readonly bindingCount: number;
  readonly diagnostics: readonly ThreadViewerRegistrationDiagnostic[];
}

export interface FileThreadViewerAppRegistrarOptions {
  /** Fixed trusted workspace storage root, not a project/session value. */
  readonly root: string;
  readonly projectIds?: readonly string[];
  readonly packagesPath?: string;
  readonly registryPath?: string;
  readonly objectDirectory?: string;
}

export class FileThreadViewerAppRegistrar {
  readonly #projectDirectory: string;
  readonly #registryPath: string;
  readonly #packagesPath: string;
  readonly #objectDirectory: string;
  readonly #projectStore: FileEngineeringProjectRevisionStore;
  readonly #threadStore: FileThreadSnapshotStore;
  readonly #captures: ReturnType<typeof registrationCaptureStores>;
  #lastInputs: string | undefined;
  #lastResult: ThreadViewerRegistrationResult | undefined;

  constructor(private readonly options: FileThreadViewerAppRegistrarOptions) {
    this.#projectDirectory = rooted(options.root, "state/local/engineering-projects");
    this.#registryPath = options.registryPath ??
      rooted(options.root, "state/local/thread-viewer-apps/registry.json");
    this.#packagesPath = options.packagesPath ??
      rooted(options.root, DEFAULT_THREAD_VIEWER_APP_PACKAGES_PATH);
    this.#objectDirectory = options.objectDirectory ??
      rooted(options.root, "state/local/thread-viewer-apps/objects");
    this.#projectStore = new FileEngineeringProjectRevisionStore(
      this.#projectDirectory,
    );
    this.#threadStore = new FileThreadSnapshotStore(
      rooted(options.root, "state/local/thread-snapshots"),
    );
    this.#captures = registrationCaptureStores(options.root);
  }

  async reconcile(): Promise<ThreadViewerRegistrationResult> {
    const packageBytes = await readOptionalBytes(this.#packagesPath);
    if (!packageBytes) {
      this.#lastInputs = undefined;
      return result("packages-unavailable", 0, 0, []);
    }
    const packageFingerprint = await sha256Hex(packageBytes);
    const registryBytes = await readOptionalBytes(this.#registryPath);
    const predecessor = await registryIdentity(registryBytes);
    const projectIds = this.options.projectIds ?? await this.#projectIds();
    const projects: EngineeringProjectSnapshot[] = [];
    const diagnostics: ThreadViewerRegistrationDiagnostic[] = [];
    for (const projectId of projectIds) {
      try {
        const project = await this.#projectStore.get(projectId);
        if (!project) throw new Error("The project has no published revision.");
        projects.push(project);
      } catch (error) {
        diagnostics.push({
          projectId,
          code: "evidence-unavailable",
          message: message(error),
        });
      }
    }
    const inputKey = registrationInputKey(projects, packageFingerprint, predecessor);
    if (
      inputKey === this.#lastInputs && this.#lastResult && diagnostics.length === 0 &&
      this.#lastResult.diagnostics.length === 0
    ) {
      return { ...this.#lastResult, status: "unchanged" };
    }
    const packages = await readThreadViewerAppPackages(
      this.#packagesPath,
      this.#objectDirectory,
    );
    if (!packages) return result("retry", projects.length, 0, diagnostics);
    const registered = await new FileThreadViewerAppRegistry({
      registryPath: this.#registryPath,
      objectDirectory: this.#objectDirectory,
    }).read();
    if (registryBytes && !registered) {
      throw new Error(
        "Existing viewer registry is not admissible; automatic reconciliation will not overwrite it.",
      );
    }
    const existing = registered?.bindings ?? [];
    const managedProjects = new Set<string>();
    const desired: ThreadViewerAppMaterializationCatalogBinding[] = [];
    for (const project of projects) {
      const projectId = project.project.id;
      const desiredStart = desired.length;
      let evidenceFailed = false;
      try {
        const head = [...project.threadSnapshots].sort((a, b) =>
          b.revision - a.revision
        )[0];
        if (!head) continue;
        const thread = await this.#threadStore.get(head.snapshotId);
        if (!thread) {
          throw new Error("The declared Thread head is not durably readable.");
        }
        currentViewerRegistrationBasis(project, thread);
        managedProjects.add(projectId);
        const archived = archivedRefKeys(thread);
        for (const artifact of thread.artifacts) {
          if (
            archived.has(`artifact:${artifact.id}`) ||
            !supportedRegistrationArtifact(artifact)
          ) continue;
          try {
            const binding = await this.#binding(project, thread, artifact, packages);
            if (binding) desired.push(binding);
            else {diagnostics.push({
                projectId,
                artifactId: artifact.id,
                code: "app-unavailable",
                message:
                  "No installed compatible whole-App resource or exact display asset is available for this capture.",
              });}
          } catch (error) {
            evidenceFailed = true;
            diagnostics.push({
              projectId,
              artifactId: artifact.id,
              code: "registration-error",
              message: message(error),
            });
          }
        }
      } catch (error) {
        evidenceFailed = true;
        diagnostics.push({
          projectId,
          code: "evidence-unavailable",
          message: message(error),
        });
      }
      if (evidenceFailed) {
        // Failed evidence reads are not revocations. Preserve this project's
        // last good registrations; the projector still requires exact basis.
        managedProjects.delete(projectId);
        desired.splice(desiredStart);
      }
    }
    const retained = existing.filter((binding) =>
      !managedProjects.has(binding.basis.projectId) ||
      binding.anchor.kind === "project-review" ||
      !MANAGED_SESSION_SCHEMAS.has(binding.session.schema)
    ).map((binding) => registeredBindingSource(binding, this.#objectDirectory));
    const bindings = [...retained, ...desired].sort((a, b) =>
      registrationBindingKey(a).localeCompare(registrationBindingKey(b))
    );
    // Source reads may take time. Do not publish a knowingly obsolete basis or
    // a mixed App installation generation. A later tick retries from the heads.
    for (const project of projects) {
      const current = await this.#projectStore.get(project.project.id);
      if (current?.id !== project.id || current.revision !== project.revision) {
        return result("retry", projects.length, existing.length, diagnostics);
      }
    }
    const currentPackageBytes = await readOptionalBytes(this.#packagesPath);
    if (
      !currentPackageBytes ||
      await sha256Hex(currentPackageBytes) !== packageFingerprint
    ) {
      return result("retry", projects.length, existing.length, diagnostics);
    }
    const previous = existing.map((binding) =>
      registeredBindingSource(binding, this.#objectDirectory)
    )
      .sort((a, b) =>
        registrationBindingKey(a).localeCompare(registrationBindingKey(b))
      );
    if (deterministicJson(bindings) === deterministicJson(previous)) {
      this.#lastInputs = inputKey;
      this.#lastResult = result(
        "unchanged",
        projects.length,
        bindings.length,
        diagnostics,
      );
      return this.#lastResult;
    }
    try {
      const materialized = await materializeThreadViewerAppsCatalog({
        catalog: {
          schemaVersion: THREAD_VIEWER_APP_MATERIALIZATION_CATALOG_SCHEMA,
          bindings,
        },
        registryPath: this.#registryPath,
        objectDirectory: this.#objectDirectory,
        predecessor,
      });
      const written = {
        kind: "present",
        sha256: materialized.registryFingerprint,
      } as const;
      this.#lastInputs = registrationInputKey(projects, packageFingerprint, written);
      this.#lastResult = result(
        materialized.changed ? "updated" : "unchanged",
        projects.length,
        materialized.bindingCount,
        diagnostics,
      );
      return this.#lastResult;
    } catch (error) {
      if (error instanceof ThreadViewerAppRegistryWriteConflictError) {
        return result("retry", projects.length, existing.length, diagnostics);
      }
      throw error;
    }
  }

  async #projectIds(): Promise<readonly string[]> {
    const ids: string[] = [];
    try {
      for await (const entry of Deno.readDir(this.#projectDirectory)) {
        if (entry.isDirectory && !entry.isSymlink) {
          ids.push(decodeURIComponent(entry.name));
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return ids.sort();
  }

  async #binding(
    project: EngineeringProjectSnapshot,
    thread: ThreadSnapshot,
    artifact: ThreadArtifact,
    packages: readonly InstalledThreadViewerAppPackage[],
  ): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
    if (artifact.producer.tool === "verify.run-fea-static-proof@3") {
      return await buildCalculixViewerBinding({
        project,
        thread,
        artifactId: artifact.id,
        packages,
        evidence: this.#captures.calculix,
      });
    }
    if (artifact.producer.tool === "simulate.run-admitted-modelica@1") {
      return await buildModelicaViewerBinding({
        project,
        thread,
        artifactId: artifact.id,
        packages,
        captures: this.#captures.modelica,
      });
    }
    if (artifact.producer.tool === "design.write-geometry@1") {
      return await buildGeometryViewerBinding({
        project,
        thread,
        artifactId: artifact.id,
        packages,
        captures: this.#captures.geometry,
        assetDirectory: rooted(this.options.root, "state/local/thread-assets"),
      });
    }
    if (artifact.producer.serverId === "syson") {
      const store = artifact.uri?.startsWith("casys://architecture-capture/")
        ? this.#captures.architecture
        : artifact.uri?.startsWith("casys://part-definitions-capture/")
        ? this.#captures.partDefinitions
        : this.#captures.requirements;
      const captureText = await store.read(artifact.fingerprint);
      if (!captureText) throw new Error("The exact SysON capture is not readable.");
      return await buildSysonViewerBinding({
        project,
        thread,
        artifactId: artifact.id,
        captureText,
        packages,
      });
    }
    const installed = installedViewerResource(
      packages,
      PROJECT_RECORDS_APP_ID,
      PROJECT_RECORDS_WHOLE_VIEW_URI,
      PROJECT_RECORDS_SESSION_SCHEMA,
    );
    if (!installed) return undefined;
    const binding = await buildApprovedBriefViewerBinding({
      project,
      thread,
      artifactId: artifact.id,
      captures: this.#captures.brief,
      sources: {
        manifestPath: installed.app.manifest.path,
        htmlPath: installed.resource.path,
        capturePath: this.#captures.brief.pathFor(artifact.fingerprint),
      },
    });
    return {
      ...binding,
      basis: { ...binding.basis },
      session: {
        schema: binding.session.schema,
        payload: { ...binding.session.payload },
      },
    };
  }
}

function supportedRegistrationArtifact(artifact: ThreadArtifact): boolean {
  return (artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === "design.write-geometry@1" &&
    artifact.kind === "cad-model") ||
    (artifact.producer.serverId === "syson" && artifact.kind === "sysml-model" &&
      [
        "casys://architecture-capture/",
        "casys://part-definitions-capture/",
        "casys://requirements-capture/",
      ].some((prefix) => artifact.uri?.startsWith(prefix))) ||
    (artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === "verify.run-fea-static-proof@3" &&
      artifact.kind === "solver-result" &&
      artifact.id === `calculix-isolated-result-json-${artifact.fingerprint.digest}`) ||
    (artifact.producer.serverId === "digital-thread" &&
      artifact.producer.tool === "simulate.run-admitted-modelica@1" &&
      artifact.kind === "solver-result" &&
      artifact.id === `modelica-admitted-result-${artifact.fingerprint.digest}`) ||
    (artifact.producer.serverId === "casys-digital-thread" &&
      artifact.producer.tool === "baseline_from_approved_brief" &&
      artifact.kind === "document");
}

function registrationCaptureStores(root: string) {
  const at = <Kind extends string>(descriptor: CaptureStoreDescriptor<Kind>) =>
    new FileCaptureStore({
      ...descriptor,
      directory: rooted(root, descriptor.directory),
    });
  return {
    brief: at(APPROVED_BRIEF_CAPTURE_DESCRIPTOR),
    architecture: at(ARCHITECTURE_CAPTURE_DESCRIPTOR),
    partDefinitions: at(PART_DEFINITIONS_CAPTURE_DESCRIPTOR),
    requirements: at(REQUIREMENTS_CAPTURE_DESCRIPTOR),
    geometry: at(GEOMETRY_CAPTURE_DESCRIPTOR),
    calculix: new FileCalculixIsolatedExecutionEvidenceStore(
      rooted(
        root,
        CALCULIX_VIEWER_EVIDENCE_DIRECTORY,
      ),
      rooted(root, "state/local/recorded-analysis"),
    ),
    modelica: new FileByteStore({
      kind: "modelica-admitted-execution-capture",
      directory: rooted(
        root,
        "state/local/recorded-analysis/modelica/admitted/captures",
      ),
      uriNamespace: "modelica-admitted-execution-capture",
      label: "Admitted Modelica execution capture",
    }),
  };
}

export function registeredBindingSource(
  binding: ThreadViewerAppBinding,
  objectDirectory: string,
): ThreadViewerAppMaterializationCatalogBinding {
  const path = (fingerprint: string) =>
    `${objectDirectory.replace(/\/$/, "")}/${fingerprint.slice(7)}`;
  return {
    basis: { ...binding.basis },
    anchor: { ...binding.anchor },
    app: { ...binding.app },
    manifest: { uri: binding.manifest.uri, path: path(binding.manifest.fingerprint) },
    resource: { uri: binding.resource.uri, path: path(binding.resource.fingerprint) },
    readResources: binding.readResources.map((resource) => ({
      path: path(resource.fingerprint),
      mimeType: resource.mimeType,
    })),
    session: {
      schema: binding.session.schema,
      payload: structuredClone(binding.session.payload),
    },
  };
}

function registrationBindingKey(
  binding: ThreadViewerAppMaterializationCatalogBinding,
): string {
  return deterministicJson([
    binding.basis,
    binding.anchor,
    binding.app,
    binding.resource.uri,
    binding.session.schema,
  ]);
}

function registrationInputKey(
  projects: readonly EngineeringProjectSnapshot[],
  packages: string,
  registry: ThreadViewerAppRegistryPredecessorIdentity,
): string {
  return deterministicJson({
    packages,
    registry,
    projects: projects.map((p) => ({ id: p.id, revision: p.revision })),
  });
}

async function registryIdentity(
  bytes: Uint8Array | undefined,
): Promise<ThreadViewerAppRegistryPredecessorIdentity> {
  return bytes
    ? { kind: "present", sha256: `sha256:${await sha256Hex(bytes)}` }
    : { kind: "absent" };
}

async function readOptionalBytes(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function rooted(root: string, path: string): string {
  return root === "." ? path : `${root.replace(/\/$/, "")}/${path}`;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function result(
  status: ThreadViewerRegistrationResult["status"],
  projectCount: number,
  bindingCount: number,
  diagnostics: readonly ThreadViewerRegistrationDiagnostic[],
): ThreadViewerRegistrationResult {
  return { status, projectCount, bindingCount, diagnostics };
}
