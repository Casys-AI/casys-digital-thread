/**
 * Profile-owned ngspice worker identities. The Docker distribution/index
 * digest and the Microsandbox executable manifest digest are related but
 * distinct; product inspect requires the latter.
 */

/** Docker source for `docker image save`. Not the IsolatedCodeRunner pin. */
export const LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE =
  "casys/ngspice-microsandbox-worker@sha256:4350b3b70bb75acee46d24ffe329b809d1132acd506cc9bd4e83c1340aa6942d" as const;

/** Microsandbox inspectImage manifest. Product runtime imageReference. */
export const LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE =
  "casys/ngspice-microsandbox-worker@sha256:54079cf7c0e1fcdf9dc30941cc97a752460d787d8d27dd9617d4cfe462e59720" as const;
