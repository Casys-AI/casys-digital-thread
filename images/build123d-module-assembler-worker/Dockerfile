# syntax=docker/dockerfile:1.7

# Dedicated code-owned assembler. It does not execute agent CAD source.
# The published worker must still be referenced by its final OCI digest.
ARG PYTHON_IMAGE=python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7
FROM ${PYTHON_IMAGE}

ARG BUILD123D_VERSION=0.11.1
ARG CADQUERY_OCP_NOVTK_VERSION=7.9.3.1.1
ARG LIBGL1_VERSION=1.6.0-1
ARG WRAPPER_SHA256=609eaf93f2564b88b9103d5e0d53d1dd3e93fcdf8e54c61cc313b957370bf581
ARG BUNDLE_DECODER_SHA256=79fb3f485581f2e732e18771817d8e2199327281c6090e6f61236b8ade68df76
ARG FONTCONFIG_SHA256=71f58af72fc487fe6c434dde129fa13dffd1cdc84bb7d1744170f2bd037586aa

LABEL org.opencontainers.image.title="Casys Build123d module assembler worker" \
      org.opencontainers.image.description="Fixed local Microsandbox worker for one-level STEP compound assembly" \
      io.casys.execution-profile="build123d-module-assembler-v1" \
      io.casys.python.version="3.12.11" \
      io.casys.build123d.version="${BUILD123D_VERSION}" \
      io.casys.cadquery-ocp-novtk.version="${CADQUERY_OCP_NOVTK_VERSION}" \
      io.casys.debian.libgl1.version="${LIBGL1_VERSION}" \
      io.casys.wrapper.sha256="${WRAPPER_SHA256}" \
      io.casys.bundle-decoder.sha256="${BUNDLE_DECODER_SHA256}" \
      io.casys.fontconfig.sha256="${FONTCONFIG_SHA256}" \
      io.casys.qualification="pending"

ENV HOME=/nonexistent \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=0 \
    PYTHONNOUSERSITE=1 \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/tmp

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      "libgl1=${LIBGL1_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

COPY images/build123d-microsandbox-worker/requirements.lock /opt/casys/requirements.lock
RUN python3 -m pip install \
      --disable-pip-version-check \
      --no-cache-dir \
      --no-compile \
      --no-deps \
      --only-binary=:all: \
      --require-hashes \
      --root-user-action=ignore \
      --requirement /opt/casys/requirements.lock \
    && python3 -I -B -c "import build123d, OCP; assert build123d.__version__ == '${BUILD123D_VERSION}'; assert OCP.__version__ == '7.9.3.1'" \
    && rm -f /opt/casys/requirements.lock

COPY --chmod=0555 \
  images/build123d-module-assembler-worker/run-module-assembler.py \
  images/build123d-module-assembler-worker/geometry_module_bundle.py \
  /opt/casys/bin/
RUN install -d -o root -g root -m 0555 /etc/fonts /opt/casys/fonts
COPY --chmod=0444 \
  images/build123d-module-assembler-worker/fonts.conf \
  /etc/fonts/fonts.conf

RUN echo "${WRAPPER_SHA256}  /opt/casys/bin/run-module-assembler.py" \
      | sha256sum --check --strict \
    && echo "${BUNDLE_DECODER_SHA256}  /opt/casys/bin/geometry_module_bundle.py" \
      | sha256sum --check --strict \
    && echo "${FONTCONFIG_SHA256}  /etc/fonts/fonts.conf" \
      | sha256sum --check --strict \
    && groupadd --system --gid 65532 casys-worker \
    && useradd --system --uid 65532 --gid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin casys-worker \
    && install -d -o 65532 -g 65532 -m 0700 /input /out /work \
    && chmod 1777 /tmp

USER 65532:65532
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/python3", "-I", "-B", "/opt/casys/bin/run-module-assembler.py", "/input/geometry-module.bundle", "/out"]
