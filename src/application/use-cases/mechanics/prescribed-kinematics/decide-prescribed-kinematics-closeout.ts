import type {
  DecidePrescribedKinematicsCloseoutCommand,
  DecidePrescribedKinematicsCloseoutUseCase,
} from "../../../ports/in/mechanics/prescribed-kinematics/decide-prescribed-kinematics-closeout.ts";
import { recrossPrescribedKinematicsEvaluationCloseoutCandidate } from "../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";

/**
 * L5 is a human disposition over one current project/subject/Thread basis.
 * It intentionally writes nothing itself; the registered executor supplies
 * the project/Thread transaction after this strict recross has succeeded.
 */
export class DecidePrescribedKinematicsCloseout
  implements DecidePrescribedKinematicsCloseoutUseCase {
  async execute(command: DecidePrescribedKinematicsCloseoutCommand) {
    if (command.origin !== "human") {
      throw new TypeError("Prescribed-kinematics L5 requires a human origin.");
    }
    if (command.basis.subjectId !== command.subjectId) {
      throw new TypeError(
        "Prescribed-kinematics L5 subject is foreign to its exact Thread basis.",
      );
    }
    const candidate = await recrossPrescribedKinematicsEvaluationCloseoutCandidate({
      candidate: command.candidate,
      sealedCase: command.sealedCase,
      observation: command.observation,
      method: command.method,
    });
    if (candidate.consequence === "accept" && candidate.evaluation.verdict !== "pass") {
      throw new TypeError(
        "Prescribed-kinematics L5 accept is unavailable for a non-pass L4 evaluation.",
      );
    }
    return candidate;
  }
}
