# SysON runtime repack

This directory is the fallback rebuild recipe for the SysON **application** used by the
local Digital Thread topology. It is not the `mcp-syson` server.

The default Compose path pulls the reviewed multi-architecture image by immutable
digest:

```text
ghcr.io/casys-ai/syson@sha256:fc599abb95587913de11ff6de68060b5593956abc0c47bc753cd19e2987141a6
```

`mcp-syson` runs as a separate service and connects to this application at
`http://syson-app:8080`. The application persists its data in the separate `syson-db`
PostgreSQL service.

## Why the recipe exists

The upstream `eclipsesyson/syson:v2026.7.0` image is amd64-only. Its application JAR is
pure Java, so this recipe copies the unchanged upstream JAR onto a multi-architecture
JRE and installs Node for SysON's bundled textual SysML parser. It does not fork or
recompile SysON.

## Local fallback rebuild

Rebuild only when the pinned GHCR image cannot be used or when qualifying a replacement:

```bash
docker build -t casys-digital-thread/syson-runtime:v2026.7.0 \
  images/syson-runtime-repack

SYSON_IMAGE=casys-digital-thread/syson-runtime:v2026.7.0 \
  docker compose up -d syson-db syson-app mcp-syson
```

Building an image does not publish or qualify it. Registry publication and digest
changes require their own review.
