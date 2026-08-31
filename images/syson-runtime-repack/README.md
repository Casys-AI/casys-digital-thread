# SysON runtime repack

This directory is the fallback rebuild recipe for the SysON **application** used by the
local Digital Thread topology. It is not the `mcp-syson` server.

The current runtime catalog still pins this image by immutable digest:

```text
ghcr.io/casys-ai/syson@sha256:d372ae26e5d32e5c599fa7c1599d42c73cf9a54e101cfe6f77175f313d7d84e9
```

The retired 1.0.0 digest remains historical evidence only. The 1.0.1 repack
is a separately pinned runtime identity; its host qualification stays literal
until the exact textual SysML workflow records it. Never silently substitute a
mutable tag or treat this publication change as a scientific result.

`mcp-syson` runs as a separate service and connects to this application at
`http://syson-app:8080`. The application persists its data in the separate `syson-db`
PostgreSQL service.

## Why the recipe exists

The upstream `eclipsesyson/syson:v2026.7.0` image is amd64-only. Its application JAR is
pure Java, so this recipe copies the byte-identical upstream JAR onto a
multi-architecture JRE and installs Node for SysON's bundled textual SysML parser. The
Docker build checks both the copied JAR checksum and `node --version`; it does not fork
or recompile SysON.

## Replacement release and qualification

The next replacement release is `v2026.7.0-casys.2`.

### Local smoke build

Build locally from this exact recipe before proposing a release:

```bash
docker build -t casys-digital-thread/syson-runtime:v2026.7.0-casys.2 \
  images/syson-runtime-repack

docker image inspect casys-digital-thread/syson-runtime:v2026.7.0-casys.2 \
  --format '{{ index .Config.Labels "org.opencontainers.image.version" }}'
docker run --rm --entrypoint node \
  casys-digital-thread/syson-runtime:v2026.7.0-casys.2 --version
```

### Multi-architecture publication candidate

After release approval, publish both supported platforms from the same recipe. This is
the publication command; it is not the local smoke-build command above:

```bash
docker buildx build --platform linux/amd64,linux/arm64 --push \
  --tag ghcr.io/casys-ai/syson:v2026.7.0-casys.2 \
  images/syson-runtime-repack
```

Publication does not qualify the replacement. Before any catalog change, qualify the
published image on its supported platforms with the actual SysON textual SysML workflow,
record its immutable digest and its native/emulated status, then review the resulting
binding change. Until that review, no runtime configuration may refer to this release by
tag and this document intentionally states no future digest.
