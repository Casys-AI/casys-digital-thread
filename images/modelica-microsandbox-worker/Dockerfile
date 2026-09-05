# syntax=docker/dockerfile:1.7

# The OpenModelica and Deno parents are immutable. The final worker must still
# be published and selected by its own OCI digest in the execution profile.
ARG OPENMODELICA_IMAGE=openmodelica/openmodelica@sha256:80fbff1a66fb6a6ade64a158415a45e022363249982c9f3ade07df2a369a357e
ARG DENO_IMAGE=denoland/deno:bin-2.9.4@sha256:25675bd2a125b59bdcfbb6592ec5c332a2bc56e0dabf038184d8b2c6aec45c3b

FROM ${DENO_IMAGE} AS deno-bin
FROM ${OPENMODELICA_IMAGE} AS runtime

ARG MSL_COMMIT=8ae3d35c24e519cb2996cab20f3b13daf2b0c50a
ARG MSL_TARBALL_SHA256=b402903aefd4f1397364e3ae1992bb99080ce935ab9a426d3bcdb47e4da8eeb6
ARG PERL_VERSION=5.34.0-3ubuntu1.7
ARG WRAPPER_SHA256=b5336d1615b017900f65aa9d491f3ecae8b3afb377d0bb38bc5678b03028c816
ARG WORKER_CONTRACT_SHA256=043132ed24db6df3f9ded2e688a70d4cf6527841f626a9134f0ced49a2f61b72
ARG ADMITTED_V2_WRAPPER_SHA256=c34a610bbd257b29b84abb804e75012d4b7b6a0748ff5c0a7376928e39e65121
ARG ADMITTED_V2_WORKER_CONTRACT_SHA256=49931a551ea684f7d6de0ed190f318871e0abf7fb034b1c1c9f6580a67be5c77
ARG ADMITTED_V2_SOURCE_AUTHORITY_SHA256=54f724f701b229394c8497242c60b4e38fbcfdc1cd1b7b93895bf384427be1d5
ARG ADMITTED_V2_SOURCE_LEXICAL_SHA256=2cabc206743c5e19e3b4b8d1acd65aa168c131769708cf3f2d19a4e48ce1a3d2
ARG ADMITTED_V2_SOURCE_PARSE_SHA256=05cd8fc07295c3a9c73c03fcade718205093d9d233c6ed7d0540c59165ac26d1
ARG DENO_LOCK_SHA256=458cd80498b070cb2313cfdf5f4184a70272f689a9c20d7fc90acff655b88e65

COPY --from=deno-bin /deno /usr/local/bin/deno

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      "perl=${PERL_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/modelica-libraries \
    && curl --fail --location --silent --show-error \
      --output /tmp/modelica-standard-library.tar.gz \
      "https://github.com/modelica/ModelicaStandardLibrary/archive/${MSL_COMMIT}.tar.gz" \
    && echo "${MSL_TARBALL_SHA256}  /tmp/modelica-standard-library.tar.gz" \
      | sha256sum --check --strict \
    && tar -xzf /tmp/modelica-standard-library.tar.gz --strip-components=1 \
      -C /opt/modelica-libraries \
    && rm /tmp/modelica-standard-library.tar.gz

LABEL org.opencontainers.image.title="Casys qualified Modelica worker" \
      org.opencontainers.image.description="Fixed local Microsandbox worker: pinned LinearThermalRamp kit (ENTRYPOINT) plus admitted closed-subset /input/source.mo" \
      io.casys.execution-profile="modelica-qualified-kit-v1" \
      io.casys.modelica.library="@casys/mcp-modelica@0.4.0" \
      io.casys.modelica.kit="linear-thermal-ramp-v1@0.1.0" \
      io.casys.lowering="modelica-omc-lowering@1.0.0" \
      io.casys.result-normalizer="linear-thermal-ramp-result-normalizer@1.0.0" \
      io.casys.modelica.admitted-profile="modelica-closed-subset-v2@2.0.0" \
      io.casys.modelica.admitted-result-normalizer="modelica-closed-subset-v2-result-normalizer@2.0.0" \
      io.casys.wrapper.sha256="${WRAPPER_SHA256}" \
      io.casys.worker-contract.sha256="${WORKER_CONTRACT_SHA256}" \
      io.casys.deno-lock.sha256="${DENO_LOCK_SHA256}"

ENV DENO_DIR=/opt/casys/deno-cache \
    HOME=/nonexistent \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    OPENMODELICALIBRARY=/opt/modelica-libraries \
    TMPDIR=/tmp

COPY --chmod=0555 \
  src/adapters/modelica/qualified-kit/kit-v1/run.ts \
  /opt/casys/profiles/modelica-qualified-kit-v1/run.ts
COPY --chmod=0444 \
  src/adapters/modelica/qualified-kit/kit-v1/worker-contract.ts \
  /opt/casys/profiles/modelica-qualified-kit-v1/worker-contract.ts
COPY --chmod=0444 \
  images/modelica-microsandbox-worker/deno.lock \
  /opt/casys/profiles/modelica-qualified-kit-v1/deno.lock

# Runtime has neither Deno network authority nor a mutable dependency graph.
RUN echo "${DENO_LOCK_SHA256}  /opt/casys/profiles/modelica-qualified-kit-v1/deno.lock" \
      | sha256sum --check --strict \
    && deno cache --no-config \
      --lock=/opt/casys/profiles/modelica-qualified-kit-v1/deno.lock \
      --frozen \
      /opt/casys/profiles/modelica-qualified-kit-v1/run.ts \
    && echo "${WRAPPER_SHA256}  /opt/casys/profiles/modelica-qualified-kit-v1/run.ts" \
      | sha256sum --check --strict \
    && echo "${WORKER_CONTRACT_SHA256}  /opt/casys/profiles/modelica-qualified-kit-v1/worker-contract.ts" \
      | sha256sum --check --strict

# Second worker in the same image. It imports the same pure v2 source authority
# as the frontend; the image retains source layout to prevent a worker-only
# parser from diverging from the admission frontend.
COPY --chmod=0555 \
  src/adapters/modelica/admitted/closed-subset-v2/run.ts \
  /opt/casys/src/adapters/modelica/admitted/closed-subset-v2/run.ts
COPY --chmod=0444 \
  src/adapters/modelica/admitted/closed-subset-v2/worker-contract.ts \
  /opt/casys/src/adapters/modelica/admitted/closed-subset-v2/worker-contract.ts
COPY --chmod=0444 \
  src/domain/modelica/source/closed-subset-v2.ts \
  /opt/casys/src/domain/modelica/source/closed-subset-v2.ts
COPY --chmod=0444 \
  src/domain/modelica/source/lexical.ts \
  /opt/casys/src/domain/modelica/source/lexical.ts
COPY --chmod=0444 \
  src/domain/modelica/source/parse.ts \
  /opt/casys/src/domain/modelica/source/parse.ts
RUN deno cache --no-config \
      --lock=/opt/casys/profiles/modelica-qualified-kit-v1/deno.lock \
      --frozen \
      /opt/casys/src/adapters/modelica/admitted/closed-subset-v2/run.ts \
    && echo "${ADMITTED_V2_WRAPPER_SHA256}  /opt/casys/src/adapters/modelica/admitted/closed-subset-v2/run.ts" \
      | sha256sum --check --strict \
    && echo "${ADMITTED_V2_WORKER_CONTRACT_SHA256}  /opt/casys/src/adapters/modelica/admitted/closed-subset-v2/worker-contract.ts" \
      | sha256sum --check --strict \
    && echo "${ADMITTED_V2_SOURCE_AUTHORITY_SHA256}  /opt/casys/src/domain/modelica/source/closed-subset-v2.ts" \
      | sha256sum --check --strict \
    && echo "${ADMITTED_V2_SOURCE_LEXICAL_SHA256}  /opt/casys/src/domain/modelica/source/lexical.ts" \
      | sha256sum --check --strict \
    && echo "${ADMITTED_V2_SOURCE_PARSE_SHA256}  /opt/casys/src/domain/modelica/source/parse.ts" \
      | sha256sum --check --strict \
    && chmod -R a=rX /opt/casys/deno-cache /opt/modelica-libraries /opt/casys/src \
    && groupadd --system --gid 65532 casys-worker \
    && useradd --system --uid 65532 --gid 65532 \
      --home-dir /nonexistent --shell /usr/sbin/nologin casys-worker \
    && install -d -o 65532 -g 65532 -m 0700 /input /out /work \
    && chmod 1777 /tmp

USER 65532:65532
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/deno", "run", "--cached-only", "--no-config", "--no-prompt", "--allow-read=/input,/out,/work", "--allow-write=/out,/work", "--allow-run=omc,perl", "--allow-env=HOME,LANG,LC_ALL,OPENMODELICALIBRARY,PATH,TMPDIR", "/opt/casys/profiles/modelica-qualified-kit-v1/run.ts", "/input/bundle.json", "/out", "/work"]
