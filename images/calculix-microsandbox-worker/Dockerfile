# syntax=docker/dockerfile:1.7

# Both parent manifests are pinned. The published worker itself must still be
# referenced by its final OCI digest in the qualified execution profile.
ARG UBUNTU_IMAGE=ubuntu:24.04@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea
ARG DENO_IMAGE=denoland/deno:bin-2.9.4@sha256:25675bd2a125b59bdcfbb6592ec5c332a2bc56e0dabf038184d8b2c6aec45c3b

FROM ${DENO_IMAGE} AS deno-bin
FROM ${UBUNTU_IMAGE}

ARG DEBIAN_FRONTEND=noninteractive
ARG WRAPPER_SHA256=507c29da72e346aa87465ce96572b19b42e96105c64b2854be73d6894592e4e2
ARG WORKER_CONTRACT_SHA256=83ffc2b3cc5dd1102d3e6f41e7ef2795afdbb68cf2df92cb97089eac88e14728
ARG DENO_LOCK_SHA256=add8c985733a7071314de5b03d9d9099c4e192bc2cff9923a2f8d1250f94ce83
COPY --from=deno-bin /deno /usr/local/bin/deno

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      calculix-ccx \
      gmsh \
    && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="Casys CalculiX worker candidate" \
      org.opencontainers.image.description="Fixed worker candidate awaiting Microsandbox qualification" \
      io.casys.execution-profile="calculix-static-proof-v1" \
      io.casys.calculix.library="@casys/mcp-calculix@0.7.0" \
      io.casys.lowering="calculix.static.abaqus-deck@1.0" \
      io.casys.wrapper.sha256="${WRAPPER_SHA256}" \
      io.casys.worker-contract.sha256="${WORKER_CONTRACT_SHA256}" \
      io.casys.deno-lock.sha256="${DENO_LOCK_SHA256}"

ENV DENO_DIR=/opt/casys/deno-cache \
    HOME=/nonexistent \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    TMPDIR=/tmp

COPY --chmod=0555 \
  src/adapters/fea/isolated-v3/calculix-static-proof-v1/run.ts \
  /opt/casys/profiles/calculix-static-proof-v1/run.ts
COPY --chmod=0444 \
  src/adapters/fea/isolated-v3/calculix-static-proof-v1/worker-contract.ts \
  /opt/casys/profiles/calculix-static-proof-v1/worker-contract.ts
COPY --chmod=0444 \
  images/calculix-microsandbox-worker/deno.lock \
  /opt/casys/profiles/calculix-static-proof-v1/deno.lock

# Runtime has no network permission and uses this immutable cache only.
RUN echo "${DENO_LOCK_SHA256}  /opt/casys/profiles/calculix-static-proof-v1/deno.lock" \
      | sha256sum --check --strict \
    && deno cache --no-config --frozen \
      --lock=/opt/casys/profiles/calculix-static-proof-v1/deno.lock \
      /opt/casys/profiles/calculix-static-proof-v1/run.ts \
    && echo "${WRAPPER_SHA256}  /opt/casys/profiles/calculix-static-proof-v1/run.ts" \
      | sha256sum --check --strict \
    && echo "${WORKER_CONTRACT_SHA256}  /opt/casys/profiles/calculix-static-proof-v1/worker-contract.ts" \
      | sha256sum --check --strict \
    && chmod -R a=rX /opt/casys/deno-cache \
    && groupadd --system --gid 65532 casys-worker \
    && useradd --system --uid 65532 --gid 65532 \
      --home-dir /nonexistent --shell /usr/sbin/nologin casys-worker \
    && install -d -o 65532 -g 65532 -m 0700 /input /out /work \
    && chmod 1777 /tmp

USER 65532:65532
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/deno", "run", "--cached-only", "--no-config", "--no-prompt", "--allow-read=/input,/out,/work,/tmp", "--allow-write=/out,/work,/tmp", "--allow-run=gmsh,ccx", "--allow-env=HOME,LANG,LC_ALL,PATH,TMPDIR", "/opt/casys/profiles/calculix-static-proof-v1/run.ts", "/input/calculix-static.bundle", "/out"]
