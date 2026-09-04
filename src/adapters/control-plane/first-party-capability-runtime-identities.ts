/**
 * Exact first-party worker identities shared by server composition and the
 * capability-runtime catalogue.  They are deployment facts, not project,
 * provider, or public-tool inputs.
 */

export const LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE =
  "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8" as const;

/** Docker source for `docker image save`. Not the Microsandbox runtime pin. */
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE =
  "casys/build123d-module-assembler-worker@sha256:40accee586603416f573386df29d881ffd682730bb8bd0e2df53ce1454ede5a2" as const;

/** Hashes asserted by the assembler Dockerfile before it changes to its worker user. */
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_SOURCE_HASH_LABELS = Object.freeze({
  "io.casys.wrapper.sha256":
    "609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581",
  "io.casys.bundle-decoder.sha256":
    "79fb3f485581f2e732e18771817d8e2199327281c6090e6f61236b8ade68df76",
  "io.casys.fontconfig.sha256":
    "71f58af72fc487fe6c434dde129fa13dffd1cdc84bb7d1744170f2bd037586aa",
});

/** Microsandbox inspectImage manifest. Product runtime imageReference. */
export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE =
  "docker.io/casys/build123d-module-assembler-worker@sha256:5aa833e19f1956a001013661e726c19c4566677a75f58493a6534456b99b6707" as const;

export { LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE } from "../../domain/modelica/local-execution-image.ts";

/** Published mcp-chrono 0.3.2 Linux/amd64 OCI index, pinned without a tag. */
export const MCP_CHRONO_032_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-chrono@sha256:2e9b7d5b27e344499fe233ff4e0a1fcdbbe77c8f83bd78ee0cdbc26eb7a74557" as const;

/** Published mcp-calculix 0.8.2 OCI index, pinned without a tag. */
export const MCP_CALCULIX_082_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-calculix@sha256:ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8" as const;
