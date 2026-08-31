import { assertEquals } from "@std/assert";
import {
  dockerInspectReportsImageAbsent,
  parsePinnedRepositoryDigest,
  samePinnedRepositoryDigest,
} from "./docker-pinned-repository-digest.ts";

const DIGEST = "a".repeat(64);

Deno.test("pinned repository+digest canonicalizes catalog and docker.io spellings", () => {
  const catalog = `casys/ngspice-source@sha256:${DIGEST}`;
  const dockerIo = `docker.io/casys/ngspice-source@sha256:${DIGEST}`;
  assertEquals(samePinnedRepositoryDigest(catalog, dockerIo), true);
  assertEquals(samePinnedRepositoryDigest(dockerIo, catalog), true);
  assertEquals(
    parsePinnedRepositoryDigest(catalog),
    { repository: "docker.io/casys/ngspice-source", digest: DIGEST },
  );
  assertEquals(
    parsePinnedRepositoryDigest(dockerIo),
    { repository: "docker.io/casys/ngspice-source", digest: DIGEST },
  );
});

Deno.test("pinned repository+digest keeps Docker Hub official library shorthand", () => {
  const familiar = `postgres@sha256:${DIGEST}`;
  const canonical = `docker.io/library/postgres@sha256:${DIGEST}`;
  assertEquals(samePinnedRepositoryDigest(familiar, canonical), true);
  assertEquals(
    parsePinnedRepositoryDigest(familiar),
    { repository: "docker.io/library/postgres", digest: DIGEST },
  );
});

Deno.test("pinned repository+digest refuses a foreign digest, tag, or registry shorthand", () => {
  const expected = `casys/ngspice-source@sha256:${DIGEST}`;
  assertEquals(
    samePinnedRepositoryDigest(
      `casys/ngspice-source@sha256:${"b".repeat(64)}`,
      expected,
    ),
    false,
  );
  assertEquals(
    samePinnedRepositoryDigest(
      `casys/ngspice-source:latest@sha256:${DIGEST}`,
      expected,
    ),
    false,
  );
  assertEquals(
    samePinnedRepositoryDigest(
      `mirror.example/ngspice@sha256:${DIGEST}`,
      expected,
    ),
    false,
  );
  assertEquals(
    samePinnedRepositoryDigest(
      `casys-ai/mcp-syson@sha256:${DIGEST}`,
      `ghcr.io/casys-ai/mcp-syson@sha256:${DIGEST}`,
    ),
    false,
  );
});

Deno.test("Docker inspect absence matches the Compose predicate and stays fail-closed", () => {
  assertEquals(
    dockerInspectReportsImageAbsent(
      `Error: No such image: casys/ngspice-source@sha256:${DIGEST}`,
    ),
    true,
  );
  assertEquals(dockerInspectReportsImageAbsent("No such image"), true);
  assertEquals(
    dockerInspectReportsImageAbsent("Error: no such object: sha256:abc"),
    true,
  );
  assertEquals(
    dockerInspectReportsImageAbsent("Error: No such object: sha256:abc"),
    true,
  );
  assertEquals(dockerInspectReportsImageAbsent("Error: image not found"), false);
  assertEquals(
    dockerInspectReportsImageAbsent('context "foo" not found'),
    false,
  );
  assertEquals(
    dockerInspectReportsImageAbsent("docker: command not found"),
    false,
  );
  assertEquals(
    dockerInspectReportsImageAbsent("Cannot connect to the Docker daemon"),
    false,
  );
});
