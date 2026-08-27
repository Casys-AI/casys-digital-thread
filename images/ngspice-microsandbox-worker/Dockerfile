# syntax=docker/dockerfile:1.7

# The Ubuntu and Deno parents are immutable. The published worker itself must
# still be selected by its own OCI digest in a later execution profile.
ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea
ARG DENO_IMAGE=denoland/deno:bin-2.9.4@sha256:25675bd2a125b59bdcfbb6592ec5c332a2bc56e0dabf038184d8b2c6aec45c3b

FROM ${DENO_IMAGE} AS deno-bin
FROM ${UBUNTU_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
ARG NGSPICE_VERSION=42+ds-3build1
ARG WRAPPER_SHA256=f91a844ce3b4ce215aa2dd1d5a60e3a46ac68da03a73a005978db47054807f23
ARG WORKER_CONTRACT_SHA256=3f332e8624f81161849782e797f289b3eb6d647f112d65527341a043ebd9b183
ARG ADMITTED_CONTRACT_SHA256=b47dd9ffd28bf25dd0e925b9318a22c506f68f5dcbb70667322e44c8557dd06a
ARG SOURCE_AUTHORITY_SHA256=c5c8de25d1f3b548ce786c9c7739a047db87de9bce0be30e697f2da8ce5a472d
ARG SOURCE_LEXICAL_SHA256=66b09ac5e5b6e92a230b65c4ea779df67908455d81516e8e892e5b50369441e3
ARG SOURCE_PARSE_SHA256=cc69eb450ae4d5c9158155a9ffca2f75ba4c77ead26e66abfda16df5e970f68a
ARG DENO_LOCK_SHA256=688c54a05c9a76a6c7d199c7cdeac61316babc775cbdd26bc989809b38595314

COPY --from=deno-bin /deno /usr/local/bin/deno

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      "ngspice=${NGSPICE_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="Casys ngspice worker" \
      org.opencontainers.image.description="Fixed local Microsandbox worker: generic circuit-only SPICE operating-point from /input/source.cir" \
      io.casys.execution-profile="spice-circuit-closed-subset-v1" \
      io.casys.ngspice.package="${NGSPICE_VERSION}" \
      io.casys.admitted-profile="spice-circuit-closed-subset-v1@1.0.0" \
      io.casys.result-normalizer="spice-operating-point-print-vectors@1.0.0" \
      io.casys.wrapper.sha256="${WRAPPER_SHA256}" \
      io.casys.worker-contract.sha256="${WORKER_CONTRACT_SHA256}" \
      io.casys.deno-lock.sha256="${DENO_LOCK_SHA256}"

ENV DENO_DIR=/opt/casys/deno-cache \
    HOME=/nonexistent \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TMPDIR=/tmp

COPY --chmod=0555 \
  src/adapters/electrical/spice/admitted/run.ts \
  /opt/casys/src/adapters/electrical/spice/admitted/run.ts
COPY --chmod=0444 \
  src/adapters/electrical/spice/admitted/worker-contract.ts \
  /opt/casys/src/adapters/electrical/spice/admitted/worker-contract.ts
COPY --chmod=0444 \
  src/domain/electrical/spice/admitted/contract.ts \
  /opt/casys/src/domain/electrical/spice/admitted/contract.ts
COPY --chmod=0444 \
  src/domain/electrical/spice/closed-subset-v1.ts \
  /opt/casys/src/domain/electrical/spice/closed-subset-v1.ts
COPY --chmod=0444 \
  src/domain/electrical/spice/lexical.ts \
  /opt/casys/src/domain/electrical/spice/lexical.ts
COPY --chmod=0444 \
  src/domain/electrical/spice/parse.ts \
  /opt/casys/src/domain/electrical/spice/parse.ts
COPY --chmod=0444 \
  images/ngspice-microsandbox-worker/deno.lock \
  /opt/casys/src/adapters/electrical/spice/admitted/deno.lock

RUN echo "${DENO_LOCK_SHA256}  /opt/casys/src/adapters/electrical/spice/admitted/deno.lock" \
      | sha256sum --check --strict \
    && deno cache --no-config --frozen \
      --lock=/opt/casys/src/adapters/electrical/spice/admitted/deno.lock \
      /opt/casys/src/adapters/electrical/spice/admitted/run.ts \
    && echo "${WRAPPER_SHA256}  /opt/casys/src/adapters/electrical/spice/admitted/run.ts" \
      | sha256sum --check --strict \
    && echo "${WORKER_CONTRACT_SHA256}  /opt/casys/src/adapters/electrical/spice/admitted/worker-contract.ts" \
      | sha256sum --check --strict \
    && echo "${ADMITTED_CONTRACT_SHA256}  /opt/casys/src/domain/electrical/spice/admitted/contract.ts" \
      | sha256sum --check --strict \
    && echo "${SOURCE_AUTHORITY_SHA256}  /opt/casys/src/domain/electrical/spice/closed-subset-v1.ts" \
      | sha256sum --check --strict \
    && echo "${SOURCE_LEXICAL_SHA256}  /opt/casys/src/domain/electrical/spice/lexical.ts" \
      | sha256sum --check --strict \
    && echo "${SOURCE_PARSE_SHA256}  /opt/casys/src/domain/electrical/spice/parse.ts" \
      | sha256sum --check --strict \
    && chmod -R a=rX /opt/casys/deno-cache /opt/casys/src \
    && groupadd --system --gid 65532 casys-worker \
    && useradd --system --uid 65532 --gid 65532 \
      --home-dir /nonexistent --shell /usr/sbin/nologin casys-worker \
    && install -d -o 65532 -g 65532 -m 0700 /input /out /work \
    && chmod 1777 /tmp

USER 65532:65532
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/deno", "run", "--cached-only", "--no-config", "--no-prompt", "--allow-read=/input,/out,/work,/opt/casys/src", "--allow-write=/out,/work", "--allow-run=ngspice", "--allow-env=HOME,LANG,LC_ALL,PATH,TMPDIR", "/opt/casys/src/adapters/electrical/spice/admitted/run.ts"]
