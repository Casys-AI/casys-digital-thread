# Upstream SysON ships amd64-only images; on Apple Silicon the app then runs
# emulated (40.6 s Spring startup measured, vs 14.4 s native). The application
# jar is pure-Java bytecode, so a native image only needs the SAME jar on a
# multi-arch JRE base — no rebuild from source, no fork. This stays a local
# build on purpose: redistributing a repackaged third-party (EPL-2.0) artifact
# under our registry namespace is a decision, not a side effect.
FROM --platform=linux/amd64 eclipsesyson/syson:v2026.7.0 AS source

FROM eclipse-temurin:21-jre
COPY --from=source /syson-application.jar /syson-application.jar
ENTRYPOINT ["java", "-jar", "/syson-application.jar"]
