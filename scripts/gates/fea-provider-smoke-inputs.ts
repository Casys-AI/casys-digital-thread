export const CONTRACT_CAPTURE_BOX_DIMENSIONS_MM = [80, 50, 50] as const;
export const CONTRACT_CAPTURE_MESH_SIZE_MM = 10;

export const LIVE_SMOKE_BOX_DIMENSIONS_MM = [20, 20, 20] as const;
export const LIVE_SMOKE_MESH_SIZE_MM = 5;

const STEP_FACE_SELECTION_MARGIN_MM = 1;

type Dimensions3 = readonly [number, number, number];
type Point3 = [number, number, number];

interface SelectionBox {
  readonly min: Point3;
  readonly max: Point3;
}

/**
 * Returns two slabs that contain the complete -Z and +Z faces of a centered
 * build123d Box.
 *
 * CalculiX provider 0.4.0 rejects a box that intersects only part of a face:
 * it produces an empty NSET. The one-millimetre margin also keeps exact STEP
 * boundary coordinates away from the selection limits after serialization.
 */
export function centeredBoxZFaceSelectionBoxes(
  dimensionsMm: Dimensions3,
  marginMm = STEP_FACE_SELECTION_MARGIN_MM,
): Readonly<{ negativeZ: SelectionBox; positiveZ: SelectionBox }> {
  for (const dimension of dimensionsMm) {
    if (!Number.isFinite(dimension) || dimension <= 0) {
      throw new TypeError("Box dimensions must be positive finite numbers.");
    }
  }
  if (!Number.isFinite(marginMm) || marginMm <= 0) {
    throw new TypeError("Selection margin must be a positive finite number.");
  }

  const [halfX, halfY, halfZ] = dimensionsMm.map((value) => value / 2) as [
    number,
    number,
    number,
  ];
  if (marginMm >= halfZ) {
    throw new TypeError("Selection margin must be smaller than the box half-height.");
  }

  return {
    negativeZ: {
      min: [-halfX - marginMm, -halfY - marginMm, -halfZ - marginMm],
      max: [halfX + marginMm, halfY + marginMm, -halfZ + marginMm],
    },
    positiveZ: {
      min: [-halfX - marginMm, -halfY - marginMm, halfZ - marginMm],
      max: [halfX + marginMm, halfY + marginMm, halfZ + marginMm],
    },
  };
}

export function contractCaptureSelections() {
  const faces = centeredBoxZFaceSelectionBoxes(
    CONTRACT_CAPTURE_BOX_DIMENSIONS_MM,
  );
  return [
    { name: "FIXED", box: faces.negativeZ },
    { name: "LOADED", box: faces.positiveZ },
  ];
}

export function liveSmokeSelections() {
  const faces = centeredBoxZFaceSelectionBoxes(LIVE_SMOKE_BOX_DIMENSIONS_MM);
  return [
    { name: "BASE", box: faces.negativeZ },
    { name: "TOP", box: faces.positiveZ },
  ];
}
