/**
 * Exact first-party worker identities shared by server composition and the
 * capability-runtime catalogue.  They are deployment facts, not project,
 * provider, or public-tool inputs.
 */

export const LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE =
  "casys/build123d-microsandbox-worker@sha256:6484a43b3632972de349ba5aa55f3da7316fb5bd7ad957b7c22aaf7888fad159" as const;

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

/** Published mcp-chrono 0.3.5 Linux/amd64 OCI index, pinned without a tag. */
export const MCP_CHRONO_035_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-chrono@sha256:a56fc994c6ff6beb33b884a7a638cd5fc00281201f9ad5e5556ba790adb39c18" as const;

/** Published mcp-calculix 0.8.5 OCI index, pinned without a tag. */
export const MCP_CALCULIX_085_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-calculix@sha256:3fad853cdb720d6d50e4714d23c9e4cf7bb011fec7b10addad5945b045757123" as const;

/** Published mcp-dfm 0.3.0 OCI index, pinned without a tag. Same digest as fleet. */
export const MCP_DFM_030_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-dfm@sha256:fd161cfd936773fa551e281d1ae371f7edc544f996eb966e6466d5ff49f384f5" as const;
