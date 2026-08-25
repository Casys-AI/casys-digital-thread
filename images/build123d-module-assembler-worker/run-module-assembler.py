"""Image-owned Build123d module assembler.

Decodes and rehashes one geometry-module-input-bundle/1.0, stages each child
STEP on a fixed path, applies right-handed mm extrinsic XYZ placements, builds
one compound, and writes the server-fixed assembly STEP and binary GLB.
The caller supplies no program. Success does not assert collision freedom.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
import sys


def load_image_owned_sibling(module_name: str):
    """Load one code-owned sibling next to this wrapper.

    Isolated `python -I` ignores PYTHONPATH and the script directory, so a
    normal import of geometry_module_bundle would fail.
    """
    path = Path(__file__).resolve().with_name(f"{module_name}.py")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise SystemExit(
            f"casys-module-assembler:The image-owned sibling {module_name} is missing."
        )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


geometry_module_bundle = load_image_owned_sibling("geometry_module_bundle")
GeometryModuleBundleError = geometry_module_bundle.GeometryModuleBundleError
parse_bundle = geometry_module_bundle.parse_bundle
stage_child_steps = geometry_module_bundle.stage_child_steps

from build123d import Compound, Location, export_gltf, export_step, import_step
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec


BUNDLE_PATH = Path("/input/geometry-module.bundle")
OUTPUT_DIRECTORY = Path("/out")
WORK_DIRECTORY = Path("/work")
CHILD_DIRECTORY = WORK_DIRECTORY / "children"
CONTROL_DIRECTORY = WORK_DIRECTORY / ".casys"
QUIESCENCE_PATH = CONTROL_DIRECTORY / "quiesced.json"
STDOUT_PATH = CONTROL_DIRECTORY / "stdout.bin"
STDERR_PATH = CONTROL_DIRECTORY / "stderr.bin"
ASSEMBLY_STEP_PATH = OUTPUT_DIRECTORY / "assembly.step"
ASSEMBLY_GLB_PATH = OUTPUT_DIRECTORY / "assembly.glb"
QUIESCENCE_TEXT = (
    '{"schemaVersion":"casys-geometry-module-assembler-quiescence/1.0",'
    '"status":"bundle-decoded-compound-exported"}\n'
)


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != str(BUNDLE_PATH) or sys.argv[2] != str(OUTPUT_DIRECTORY):
        fail("The fixed module assembler requires its registered paths.")
    os.umask(0o077)
    bundle_bytes = BUNDLE_PATH.read_bytes()
    try:
        bundle = parse_bundle(bundle_bytes)
    except GeometryModuleBundleError as error:
        fail(str(error))
    assert_empty_directory(OUTPUT_DIRECTORY)
    CHILD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    staged = stage_child_steps(bundle, CHILD_DIRECTORY)
    occurrences = bundle["occurrences"]
    if not isinstance(occurrences, list) or len(occurrences) != len(staged):
        fail("The staged child STEP table is incomplete.")
    placed = []
    for index, occurrence in enumerate(occurrences):
        if not isinstance(occurrence, dict):
            fail(f"Occurrence {index} is not an object.")
        imported = import_step(str(staged[index]))
        if imported is None:
            fail(f"Child STEP {index} could not be imported from its staged path.")
        location = extrinsic_xyz_location(occurrence["placement"])
        placed.append(location * imported)
    compound = Compound(children=placed)
    if export_step(compound, ASSEMBLY_STEP_PATH) is not True:
        fail("Assembly STEP export was rejected.")
    if export_gltf(compound, str(ASSEMBLY_GLB_PATH), binary=True) is not True:
        fail("Assembly GLB export was rejected.")
    ASSEMBLY_STEP_PATH.chmod(0o400)
    ASSEMBLY_GLB_PATH.chmod(0o400)
    assert_exact_outputs()
    write_control_evidence()


def extrinsic_xyz_location(placement: object) -> Location:
    """Right-handed mm pose: R = Rz Ry Rx about fixed axes, then p' = R p + t."""
    if not isinstance(placement, dict):
        fail("A placement record is required.")
    translation = placement.get("translationMm")
    rotation = placement.get("rotationDeg")
    if not isinstance(translation, list) or not isinstance(rotation, list):
        fail("Placement vectors must be triples.")
    rx, ry, rz = [math.radians(float(angle)) for angle in rotation]
    rx_t = gp_Trsf()
    rx_t.SetRotation(gp_Ax1(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(1.0, 0.0, 0.0)), rx)
    ry_t = gp_Trsf()
    ry_t.SetRotation(gp_Ax1(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 1.0, 0.0)), ry)
    rz_t = gp_Trsf()
    rz_t.SetRotation(gp_Ax1(gp_Pnt(0.0, 0.0, 0.0), gp_Dir(0.0, 0.0, 1.0)), rz)
    rotation_trsf = rz_t.Multiplied(ry_t).Multiplied(rx_t)
    translation_trsf = gp_Trsf()
    translation_trsf.SetTranslation(
        gp_Vec(float(translation[0]), float(translation[1]), float(translation[2])),
    )
    return Location(translation_trsf.Multiplied(rotation_trsf))


def assert_empty_directory(path: Path) -> None:
    if any(path.iterdir()):
        fail("The output directory is not empty.")


def assert_exact_outputs() -> None:
    observed = sorted(
        entry.name
        for entry in OUTPUT_DIRECTORY.iterdir()
        if entry.is_file() and not entry.is_symlink()
    )
    if observed != ["assembly.glb", "assembly.step"]:
        fail("The module assembler emitted an unexpected output set.")
    if ASSEMBLY_STEP_PATH.stat().st_size <= 0 or ASSEMBLY_GLB_PATH.stat().st_size <= 0:
        fail("An assembly output is empty.")


def write_control_evidence() -> None:
    CONTROL_DIRECTORY.mkdir(parents=True, exist_ok=True)
    STDOUT_PATH.write_bytes(b"")
    STDERR_PATH.write_bytes(b"")
    STDOUT_PATH.chmod(0o400)
    STDERR_PATH.chmod(0o400)
    QUIESCENCE_PATH.write_text(QUIESCENCE_TEXT, encoding="ascii")
    QUIESCENCE_PATH.chmod(0o400)
    observed = sorted(entry.name for entry in CONTROL_DIRECTORY.iterdir())
    if (
        observed != ["quiesced.json", "stderr.bin", "stdout.bin"]
        or QUIESCENCE_PATH.read_text(encoding="ascii") != QUIESCENCE_TEXT
        or STDOUT_PATH.stat().st_size != 0
        or STDERR_PATH.stat().st_size != 0
    ):
        fail("The module-assembler control evidence failed its exact reread.")


def fail(message: str) -> None:
    raise SystemExit(f"casys-module-assembler:{message}")


if __name__ == "__main__":
    main()
