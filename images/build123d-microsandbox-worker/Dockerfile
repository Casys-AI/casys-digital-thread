# syntax=docker/dockerfile:1.7

# The multi-platform index digest pins Python and every inherited Debian package.
ARG PYTHON_IMAGE=python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7
FROM ${PYTHON_IMAGE}

ARG BUILD123D_VERSION=0.11.1
ARG CADQUERY_OCP_NOVTK_VERSION=7.9.3.1.1
ARG LIBGL1_VERSION=1.6.0-1

LABEL org.opencontainers.image.title="Casys qualified Build123d worker" \
      org.opencontainers.image.description="Fixed local Microsandbox worker for Build123d STEP AP214 generation" \
      io.casys.execution-profile="build123d-closed-subset-v1" \
      io.casys.python.version="3.12.11" \
      io.casys.build123d.version="${BUILD123D_VERSION}" \
      io.casys.cadquery-ocp-novtk.version="${CADQUERY_OCP_NOVTK_VERSION}" \
      io.casys.debian.libgl1.version="${LIBGL1_VERSION}"

ENV HOME=/nonexistent \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONHASHSEED=0 \
    PYTHONNOUSERSITE=1 \
    PYTHONUNBUFFERED=1 \
    TMPDIR=/tmp

# OCP links libGL even for headless STEP export. The direct OS package is
# version-pinned; --no-install-recommends keeps the runtime surface minimal.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      "libgl1=${LIBGL1_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.lock /opt/casys/requirements.lock
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

COPY --chmod=0555 run-build123d.py execute-build123d-child.py /opt/casys/bin/

RUN groupadd --system --gid 65532 casys-worker \
    && useradd --system --uid 65532 --gid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin casys-worker \
    && install -d -o 0 -g 0 -m 0755 /input \
    && install -d -o 0 -g 0 -m 0700 /run/casys \
    && install -d -o 65532 -g 65532 -m 0700 /out /work \
    && chmod 1777 /tmp

# The fixed supervisor owns the trust boundary and must out-rank untrusted
# source. It drops the child irreversibly to uid/gid 65532 before Python exec.
USER 0:0
WORKDIR /work

ENTRYPOINT ["/usr/local/bin/python3", "-I", "-B", "/opt/casys/bin/run-build123d.py"]
