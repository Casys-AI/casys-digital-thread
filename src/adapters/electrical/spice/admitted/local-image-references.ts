/**
 * Profile-owned ngspice worker identities. The Docker distribution/index
 * digest and the Microsandbox executable manifest digest are related but
 * distinct; product inspect requires the latter.
 */

/** Docker source for `docker image save`. Not the IsolatedCodeRunner pin. */
export const LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE =
  "casys/ngspice-microsandbox-worker@sha256:62748f195c86751c5fc565ea8e0ac5ab6bd283ddcae2426918d697b25ce6d392" as const;

/** Microsandbox inspectImage manifest. Product runtime imageReference. */
export const LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE =
  "casys/ngspice-microsandbox-worker@sha256:3350527ceba0dbe8f2e31e435e834f962978e800134b83d6ee8f4875b7ffb79a" as const;
