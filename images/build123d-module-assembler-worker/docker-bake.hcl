variable "IMAGE_NAME" {
  default = "casys/build123d-module-assembler-worker"
}

variable "IMAGE_TAG" {
  default = "local"
}

group "default" {
  targets = ["worker"]
}

target "worker" {
  context    = "."
  dockerfile = "images/build123d-module-assembler-worker/Dockerfile"
  platforms = [
    "linux/amd64",
    "linux/arm64",
  ]
  tags = ["${IMAGE_NAME}:${IMAGE_TAG}"]
}

target "worker-local-arm64" {
  inherits  = ["worker"]
  platforms = ["linux/arm64"]
}
