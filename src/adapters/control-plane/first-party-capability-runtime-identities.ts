/**
 * Exact first-party worker identities shared by server composition and the
 * capability-runtime catalogue.  They are deployment facts, not project,
 * provider, or public-tool inputs.
 */

export const LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE =
  "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8" as const;

export const LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE =
  "casys/build123d-module-assembler-worker@sha256:5aa833e19f1956a001013661e726c19c4566677a75f58493a6534456b99b6707" as const;

export const LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:7d3fdeabe794b0ded5360921b16724c7904487e9d11bc24fa37c72f9b92a1894" as const;

export const LOCAL_ADMITTED_MODELICA_EXECUTION_IMAGE_REFERENCE =
  "casys/modelica-microsandbox-worker@sha256:d25f220287cd8d1713e9e7d773afb8bb867fc5404a112e5e50ffa2e862fd6fdf" as const;

/** Published mcp-chrono 0.3.1 Linux/amd64 OCI index, pinned without a tag. */
export const MCP_CHRONO_031_IMAGE_REFERENCE =
  "ghcr.io/casys-ai/mcp-chrono@sha256:b6302001725df4722d84096a51eeff7e7ffeee843690a2ba0cc417191c67683c" as const;
