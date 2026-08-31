import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ThreadGraphRef } from "../../presentation/workbench/thread/graph.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import {
  isDenseUnadornedArray,
  isThreadViewerAppBinding,
  isThreadViewerProjectReviewAnchor,
  isThreadViewerVerifiedAppLaunch,
  THREAD_VIEWER_SESSIONS_SCHEMA,
  type ThreadViewerAppBinding,
  type ThreadViewerAppIdentity,
  type ThreadViewerAppResourceIdentity,
  type ThreadViewerProjectReviewAnchor,
  type ThreadViewerReadResource,
  type ThreadViewerSession,
  type ThreadViewerSessionsBasis,
  type ThreadViewerSessionsProjection,
  type ThreadViewerVerifiedAppLaunch,
  type ThreadViewerWholeAppResourceIdentity,
} from "../../presentation/workbench/thread/viewer-sessions.ts";

export interface ThreadViewerSessionsProjectionContext {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly subjectId: string;
  /** Monotonic read-model sequence within this exact project/Thread basis. */
  readonly sequence: number;
  readonly thread?: {
    readonly id: string;
    readonly revision: number;
  };
  /** Exact pending Project reviews; absent/empty means no pre-MRTR App. */
  readonly projectReviewAnchors?: readonly ThreadViewerProjectReviewAnchor[];
}

export interface ThreadViewerAppLaunchRequest {
  readonly app: ThreadViewerAppIdentity;
  readonly manifest: ThreadViewerAppResourceIdentity;
  readonly resource: ThreadViewerWholeAppResourceIdentity;
  readonly readResources: readonly ThreadViewerReadResource[];
}

/**
 * Out-of-band authority for exact browser-launch bytes.
 *
 * Implementations must map the exact `ui://` identities to a same-origin HTML
 * route which reopens and hashes the manifest and whole-view resource bytes
 * before every response. `undefined` means the route is not currently
 * attested; the projector then emits no session.
 */
export interface ThreadViewerAppLaunchResolver {
  resolve(
    request: ThreadViewerAppLaunchRequest,
  ): Promise<ThreadViewerVerifiedAppLaunch | undefined>;
}

/**
 * Project explicitly registered whole-App sessions from a sanitized Workbench
 * read model.
 *
 * A binding is admitted only when its complete project/Thread basis and exact
 * graph anchor match. No App is inferred from a label, artifact kind, provider
 * inventory, graph edge, or proximity, and this projector never calls an MCP
 * server or engineering provider.
 */
export async function projectThreadViewerSessions(
  context: ThreadViewerSessionsProjectionContext,
  snapshot?: ThreadWorkbenchSnapshot,
  bindings: readonly ThreadViewerAppBinding[] = [],
  launchResolver?: ThreadViewerAppLaunchResolver,
): Promise<ThreadViewerSessionsProjection> {
  if (!isDenseUnadornedArray(bindings)) {
    throw new TypeError(
      "Thread viewer App bindings must be a dense, unadorned array.",
    );
  }
  const projectReviewAnchors = context.projectReviewAnchors ?? [];
  if (
    !isDenseUnadornedArray(projectReviewAnchors) ||
    projectReviewAnchors.some((anchor) =>
      !isThreadViewerProjectReviewAnchor(anchor) ||
      anchor.revision !== context.projectRevision
    )
  ) {
    throw new TypeError(
      "Thread viewer Project review anchors must match the exact Project revision.",
    );
  }
  if (!Number.isSafeInteger(context.sequence) || context.sequence < 0) {
    throw new TypeError(
      "Thread viewer projection sequence must be a non-negative integer.",
    );
  }
  if (snapshot && snapshot.subject.id !== context.subjectId) {
    throw new TypeError(
      `Thread viewer subject ${snapshot.subject.id} does not match ${context.subjectId}.`,
    );
  }
  if (
    (snapshot === undefined) !== (context.thread === undefined) ||
    (snapshot && context.thread?.id !== snapshot.id)
  ) {
    throw new TypeError(
      "Thread viewer projection requires the exact canonical Thread identity.",
    );
  }
  const basis: ThreadViewerSessionsBasis = {
    projectId: context.projectId,
    projectRevision: context.projectRevision,
    subjectId: context.subjectId,
    ...(context.thread ? { thread: { ...context.thread } } : {}),
  };
  const hasExactThreadBasis = snapshot === undefined ||
    (context.thread?.id === snapshot.id &&
      context.thread.revision === snapshot.evidenceFamilyGraph.asOf.revision);
  const sessions = hasExactThreadBasis
    ? await projectRegisteredAppSessions(
      basis,
      snapshot,
      projectReviewAnchors,
      bindings,
      launchResolver,
    )
    : [];
  const projection = {
    schemaVersion: THREAD_VIEWER_SESSIONS_SCHEMA,
    basis,
    sequence: context.sequence,
    sessions,
  };
  const fingerprint = await sha256Fingerprint(projection);
  return {
    ...projection,
    projectionFingerprint: `${fingerprint.algorithm}:${fingerprint.digest}`,
  };
}

async function projectRegisteredAppSessions(
  basis: ThreadViewerSessionsBasis,
  snapshot: ThreadWorkbenchSnapshot | undefined,
  projectReviewAnchors: readonly ThreadViewerProjectReviewAnchor[],
  bindings: readonly ThreadViewerAppBinding[],
  launchResolver: ThreadViewerAppLaunchResolver | undefined,
): Promise<readonly ThreadViewerSession[]> {
  const nodeKeys = new Set(
    snapshot?.graph.nodes.map((node) => graphRefKey(node.ref)) ?? [],
  );
  const reviewKeys = new Set(projectReviewAnchors.map(projectReviewAnchorKey));
  const sessions = new Map<string, ThreadViewerSession>();

  for (const [index, binding] of bindings.entries()) {
    if (!isThreadViewerAppBinding(binding)) {
      throw new TypeError(
        `Thread viewer App binding ${index} has an unsupported contract.`,
      );
    }
    if (binding.anchor.kind === "project-review") {
      if (
        binding.basis.thread !== undefined ||
        !sameProjectBasis(binding.basis, basis) ||
        !reviewKeys.has(projectReviewAnchorKey(binding.anchor))
      ) continue;
    } else {
      if (!sameBasis(binding.basis, basis)) continue;
      if (!nodeKeys.has(graphRefKey(binding.anchor))) continue;
    }

    const payloadFingerprint = await sha256Fingerprint(binding.session.payload);
    const expectedPayloadFingerprint =
      `${payloadFingerprint.algorithm}:${payloadFingerprint.digest}`;
    if (binding.session.fingerprint !== expectedPayloadFingerprint) {
      throw new TypeError(
        `Thread viewer App binding ${index} session payload fingerprint does not match.`,
      );
    }

    if (!launchResolver) continue;
    const launchRequest: ThreadViewerAppLaunchRequest = {
      app: { ...binding.app },
      manifest: { ...binding.manifest },
      resource: { ...binding.resource },
      readResources: binding.readResources.map((resource) => ({ ...resource })),
    };
    const launch = await launchResolver.resolve(launchRequest);
    if (!launch) continue;
    if (
      !isThreadViewerVerifiedAppLaunch(launch) ||
      !sameLaunchIdentity(launch, launchRequest)
    ) {
      throw new TypeError(
        `Thread viewer App binding ${index} launch resolver returned an unsupported attestation.`,
      );
    }

    const descriptor = {
      kind: "mcp-app" as const,
      anchor: { ...binding.anchor },
      app: { ...binding.app },
      manifest: { ...binding.manifest },
      resource: { ...binding.resource },
      launchUri: launch.launchUri,
      readResources: binding.readResources.map((resource) => ({ ...resource })),
      session: {
        action: binding.session.action,
        schema: binding.session.schema,
        payload: structuredClone(binding.session.payload),
        fingerprint: binding.session.fingerprint,
      },
    };
    const identity = await sha256Fingerprint(descriptor);
    const session: ThreadViewerSession = {
      id: `mcp-app:${identity.digest}`,
      ...descriptor,
    };
    sessions.set(session.id, session);
  }

  return [...sessions.values()].toSorted((left, right) =>
    left.id.localeCompare(right.id)
  );
}

function sameLaunchIdentity(
  launch: ThreadViewerVerifiedAppLaunch,
  request: ThreadViewerAppLaunchRequest,
): boolean {
  return launch.app.id === request.app.id &&
    launch.app.version === request.app.version &&
    launch.manifest.uri === request.manifest.uri &&
    launch.manifest.fingerprint === request.manifest.fingerprint &&
    launch.resource.uri === request.resource.uri &&
    launch.resource.fingerprint === request.resource.fingerprint &&
    launch.resource.ownership === request.resource.ownership &&
    launch.resource.mimeType === request.resource.mimeType &&
    launch.resource.bytes === request.resource.bytes &&
    JSON.stringify(launch.readResources) ===
      JSON.stringify(request.readResources);
}

function sameBasis(
  left: ThreadViewerSessionsBasis,
  right: ThreadViewerSessionsBasis,
): boolean {
  return left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.subjectId === right.subjectId &&
    left.thread?.id === right.thread?.id &&
    left.thread?.revision === right.thread?.revision;
}

function sameProjectBasis(
  left: ThreadViewerSessionsBasis,
  right: ThreadViewerSessionsBasis,
): boolean {
  return left.projectId === right.projectId &&
    left.projectRevision === right.projectRevision &&
    left.subjectId === right.subjectId;
}

function projectReviewAnchorKey(
  anchor: ThreadViewerProjectReviewAnchor,
): string {
  return `${anchor.kind}:${anchor.id}:${anchor.revision}:${anchor.fingerprint}`;
}

function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
