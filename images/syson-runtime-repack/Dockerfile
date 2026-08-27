# Upstream SysON ships amd64-only images; on Apple Silicon the app then runs
# emulated (40.6 s Spring startup measured, vs 14.4 s native). The application
# jar is pure-Java bytecode, so a native image only needs the SAME jar on a
# multi-arch JRE base — no rebuild from source, no fork.
#
# This recipe builds the SysON application runtime. It does not contain the
# mcp-syson bridge, which remains a separate provider process.
FROM --platform=linux/amd64 eclipsesyson/syson:v2026.7.0 AS source

FROM eclipse-temurin:21-jre
# SysON's textual SysML path (SysmlToAst) extracts a bundled Syside CLI and
# runs it through `node`; without Node every insertTextualSysMLv2 dies with a
# generic "Unable to convert" — probed for real on 2026-08-05.
RUN apt-get update && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*
COPY --from=source /syson-application.jar /syson-application.jar
ENTRYPOINT ["java", "-jar", "/syson-application.jar"]
