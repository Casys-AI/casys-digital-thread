# Upstream SysON ships amd64-only images; on Apple Silicon the app then runs
# emulated (40.6 s Spring startup measured, vs 14.4 s native). The application
# JAR is pure-Java bytecode, so a native image only needs the exact upstream JAR
# on a multi-architecture JRE base — no rebuild from source and no fork.
#
# This recipe builds the SysON application runtime. It does not contain the
# mcp-syson bridge, which remains a separate provider process.
ARG SYSON_UPSTREAM_VERSION=v2026.7.0
ARG SYSON_REPACK_VERSION=v2026.7.0-casys.2

FROM --platform=linux/amd64 eclipsesyson/syson:${SYSON_UPSTREAM_VERSION} AS source
RUN sha256sum /syson-application.jar > /tmp/syson-application.jar.sha256

FROM eclipse-temurin:21-jre
ARG SYSON_UPSTREAM_VERSION
ARG SYSON_REPACK_VERSION
LABEL org.opencontainers.image.title="Casys SysON runtime repack" \
  org.opencontainers.image.description="Native-platform runtime repack of the unchanged SysON application JAR" \
  org.opencontainers.image.source="https://github.com/Casys-AI/casys-digital-thread" \
  org.opencontainers.image.version="${SYSON_REPACK_VERSION}" \
  org.opencontainers.image.licenses="EPL-2.0" \
  org.opencontainers.image.base.name="eclipsesyson/syson:${SYSON_UPSTREAM_VERSION}"

# SysON's textual SysML path (SysmlToAst) extracts a bundled Syside CLI and
# runs it through `node`; without Node every insertTextualSysMLv2 dies with a
# generic "Unable to convert". Keep the copied artifact byte-identical to its
# upstream source and fail the build if Node is absent or non-executable.
COPY --from=source /syson-application.jar /syson-application.jar
COPY --from=source /tmp/syson-application.jar.sha256 /tmp/syson-application.jar.sha256
RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && node --version \
  && sha256sum --check /tmp/syson-application.jar.sha256 \
  && rm /tmp/syson-application.jar.sha256 \
  && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["java", "-jar", "/syson-application.jar"]
