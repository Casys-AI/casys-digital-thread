import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ThreadGraphRef } from "../../presentation/workbench/thread/graph.ts";
import type { ThreadWorkbenchSnapshot } from "../../presentation/workbench/thread/snapshot.ts";
import {
  THREAD_VIEWER_SESSIONS_SCHEMA,
  type ThreadViewerSession,
  type ThreadViewerSessionsBasis,
  type ThreadViewerSessionsProjection,
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
}

/**
 * Project viewer sessions from the already-sanitized Workbench read model.
 *
 * The projection is intentionally narrower than viewer discovery. V1 emits a
 * session only for an exact `represented_by` edge whose GLB URI and sha256
 * fingerprint agree. It never joins on labels, systems, provider inventory or
 * graph proximity, and it never calls an engineering provider.
 */
export async function projectThreadViewerSessions(
  context: ThreadViewerSessionsProjectionContext,
  snapshot?: ThreadWorkbenchSnapshot,
): Promise<ThreadViewerSessionsProjection> {
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
  const sessions = snapshot ? await projectNativeCadSessions(snapshot) : [];
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

async function projectNativeCadSessions(
  snapshot: ThreadWorkbenchSnapshot,
): Promise<readonly ThreadViewerSession[]> {
  const nodeKeys = new Set(
    snapshot.graph.nodes.map((node) => graphRefKey(node.ref)),
  );
  const artifacts = new Map(
    snapshot.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const candidates = new Map<
    string,
    {
      readonly anchor: ThreadGraphRef;
      readonly asset: {
        readonly id: string;
        readonly uri: string;
        readonly fingerprint: string;
      };
    }
  >();

  for (const edge of snapshot.graph.edges) {
    if (
      edge.relation !== "represented_by" ||
      edge.from.kind !== "part-definition" ||
      edge.to.kind !== "artifact" ||
      !nodeKeys.has(graphRefKey(edge.from)) ||
      !nodeKeys.has(graphRefKey(edge.to))
    ) continue;
    const artifact = artifacts.get(edge.to.id);
    if (!artifact || !isExactGlbArtifact(artifact)) continue;
    const key = `${graphRefKey(edge.from)}\u0000${artifact.id}`;
    candidates.set(key, {
      anchor: { ...edge.from },
      asset: {
        id: artifact.id,
        uri: artifact.uri!,
        fingerprint: artifact.fingerprint!,
      },
    });
  }

  const sessions = await Promise.all(
    [...candidates.values()].map(async ({ anchor, asset }) => {
      const identity = await sha256Fingerprint({
        kind: "native-cad-glb",
        anchor,
        assetId: asset.id,
      });
      return {
        id: `native-cad-glb:${identity.digest}`,
        kind: "native-cad-glb" as const,
        anchor,
        asset,
        semanticSelection: {
          status: "unavailable" as const,
          reason: "viewer-selection-not-supported" as const,
        },
      };
    }),
  );
  return sessions.toSorted((left, right) => left.id.localeCompare(right.id));
}

function isExactGlbArtifact(
  artifact: ThreadWorkbenchSnapshot["artifacts"][number],
): artifact is ThreadWorkbenchSnapshot["artifacts"][number] & {
  uri: string;
  fingerprint: string;
} {
  if (artifact.kind !== "cad-model") return false;
  const fingerprint = /^sha256:([a-f0-9]{64})$/.exec(
    artifact.fingerprint ?? "",
  );
  const uri = /^\/api\/thread\/assets\/([a-f0-9]{64})\.glb$/.exec(
    artifact.uri ?? "",
  );
  return fingerprint?.[1] !== undefined && fingerprint[1] === uri?.[1];
}

function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
