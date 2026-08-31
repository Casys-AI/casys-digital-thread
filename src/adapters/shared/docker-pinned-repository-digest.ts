/**
 * Canonical OCI repository+digest identity as Docker Engine reports it.
 *
 * Docker Hub official images such as `docker.io/library/postgres` appear as
 * the familiar `postgres` in RepoDigests. These are the same immutable
 * identity. No other registry gets that shorthand: `casys-ai/syson` can never
 * stand in for `ghcr.io/casys-ai/syson`.
 */

export interface PinnedRepositoryDigest {
  readonly repository: string;
  readonly digest: string;
}

export function samePinnedRepositoryDigest(
  observed: string,
  expected: string,
): boolean {
  const left = parsePinnedRepositoryDigest(observed);
  const right = parsePinnedRepositoryDigest(expected);
  return left !== undefined && right !== undefined &&
    left.digest === right.digest && left.repository === right.repository;
}

export function parsePinnedRepositoryDigest(
  value: string,
): PinnedRepositoryDigest | undefined {
  const marker = "@sha256:";
  const markerIndex = value.lastIndexOf(marker);
  if (markerIndex <= 0 || value.indexOf(marker) !== markerIndex) return undefined;
  const name = value.slice(0, markerIndex);
  const digest = value.slice(markerIndex + marker.length);
  if (!/^[a-f0-9]{64}$/.test(digest)) return undefined;

  const segments = name.split("/");
  const first = segments[0];
  if (!first) return undefined;
  const explicitRegistry = segments.length > 1 &&
    (first === "localhost" || first.includes(".") || first.includes(":"));
  if (explicitRegistry && !validRegistry(first)) return undefined;
  const repositorySegments = explicitRegistry ? segments.slice(1) : segments;
  if (
    repositorySegments.length === 0 ||
    repositorySegments.some((segment) =>
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(segment)
    )
  ) return undefined;

  const registry = explicitRegistry ? first : "docker.io";
  const canonicalRepository = registry === "docker.io" &&
      repositorySegments.length === 1
    ? `docker.io/library/${repositorySegments[0]}`
    : `${registry}/${repositorySegments.join("/")}`;
  return { repository: canonicalRepository, digest };
}

/**
 * Exact `docker image inspect` absence already expected by Compose.
 * Generic "not found" stderr, including a missing context or command, stays
 * fail-closed as unknown.
 */
export function dockerInspectReportsImageAbsent(stderr: string): boolean {
  return /no such (image|object)/i.test(stderr);
}

function validRegistry(value: string): boolean {
  const match = /^(.*?)(?::([1-9][0-9]{0,4}))?$/.exec(value);
  if (!match) return false;
  const [, host, port] = match;
  if (!host || port !== undefined && Number(port) > 65_535) return false;
  return host === "localhost" ||
    host.includes(".") &&
      host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}
