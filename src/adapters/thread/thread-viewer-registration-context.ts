/** Read-only identity checks shared by trusted viewer-registration factories. */
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadViewerSessionsBasis } from "../../presentation/workbench/thread/viewer-sessions.ts";
import type {
  InstalledThreadViewerAppPackage,
  InstalledThreadViewerAppResource,
} from "./thread-viewer-app-packages.ts";

export function currentViewerRegistrationBasis(
  project: EngineeringProjectSnapshot,
  thread: ThreadSnapshot,
): ThreadViewerSessionsBasis {
  validateEngineeringProjectSnapshot(project);
  validateThreadSnapshot(thread);
  const head = [...project.threadSnapshots].sort((a, b) => b.revision - a.revision)[0];
  if (
    !head || head.snapshotId !== thread.id || head.revision !== thread.revision ||
    head.subjectId !== thread.subject.id ||
    project.project.subjectId !== thread.subject.id
  ) {
    throw new TypeError(
      "Viewer registration requires the project's exact declared Thread head.",
    );
  }
  return {
    projectId: project.project.id,
    projectRevision: project.revision,
    subjectId: project.project.subjectId,
    thread: { id: thread.id, revision: thread.revision },
  };
}

export function exactViewerArtifact(
  thread: ThreadSnapshot,
  artifactId: string,
): ThreadArtifact {
  const artifacts = thread.artifacts.filter((artifact) => artifact.id === artifactId);
  if (artifacts.length !== 1 || archivedRefKeys(thread).has(`artifact:${artifactId}`)) {
    throw new TypeError("Viewer registration requires one exact unarchived artifact.");
  }
  return artifacts[0]!;
}

/** Only an explicit installed package can supply a resource. No version ranking. */
export function installedViewerResource(
  packages: readonly InstalledThreadViewerAppPackage[],
  appId: string,
  resourceUri: string,
  sessionSchema: string,
): {
  readonly app: InstalledThreadViewerAppPackage;
  readonly resource: InstalledThreadViewerAppResource;
} | undefined {
  const matches = packages.filter((candidate) => candidate.app.id === appId);
  if (matches.length > 1) throw new TypeError("Viewer App installation is ambiguous.");
  const app = matches[0];
  if (!app) return undefined;
  const resources = app.resources.filter((resource) => resource.uri === resourceUri);
  if (resources.length > 1) {
    throw new TypeError("Installed viewer resource is ambiguous.");
  }
  const resource = resources[0];
  if (
    !resource || !resource.sessionSchemas.includes(sessionSchema) ||
    !resource.acceptedActions.includes("viewer.session.apply")
  ) return undefined;
  return { app, resource };
}
