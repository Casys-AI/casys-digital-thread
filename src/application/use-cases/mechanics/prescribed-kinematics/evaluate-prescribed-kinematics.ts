import type {
  EvaluatePrescribedKinematicsCommand,
  EvaluatePrescribedKinematicsUseCase,
} from "../../../ports/in/mechanics/prescribed-kinematics/evaluate-prescribed-kinematics.ts";
import { evaluatePrescribedKinematics } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation.ts";

/** No provider, runtime, tool or caller-supplied verdict exists on this path. */
export class EvaluatePrescribedKinematics
  implements EvaluatePrescribedKinematicsUseCase {
  execute(command: EvaluatePrescribedKinematicsCommand) {
    return evaluatePrescribedKinematics(command);
  }
}
