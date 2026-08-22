#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define CASYS_RUNTIME_EXECUTABLE "casys-desktop-runtime"
#define CASYS_HELPER_EXECUTABLE "casys-control-plane"
#define CASYS_SYSTEM_PATH "/usr/bin:/bin:/usr/sbin:/sbin"

static int join_path(char *output, size_t size, const char *left,
                     const char *right) {
  const int written = snprintf(output, size, "%s/%s", left, right);
  return written >= 0 && (size_t)written < size ? 0 : -1;
}

static int exact_regular_executable(const char *path) {
  struct stat info;
  char physical[PATH_MAX];
  if (lstat(path, &info) != 0 || !S_ISREG(info.st_mode) ||
      (info.st_mode & (S_IXUSR | S_IXGRP | S_IXOTH)) == 0 ||
      realpath(path, physical) == NULL) {
    return -1;
  }
  return strcmp(path, physical) == 0 ? 0 : -1;
}

static int exact_directory(const char *path) {
  struct stat info;
  char physical[PATH_MAX];
  if (lstat(path, &info) != 0 || !S_ISDIR(info.st_mode) ||
      realpath(path, physical) == NULL) {
    return -1;
  }
  return strcmp(path, physical) == 0 ? 0 : -1;
}

static int fail_launch(void) {
  fputs("Casys Digital Thread launcher: signed bundle layout unavailable.\n",
        stderr);
  return 126;
}

int main(int argc, char **argv) {
  (void)argc;
  uint32_t executable_size = 0;
  if (_NSGetExecutablePath(NULL, &executable_size) != -1 ||
      executable_size == 0) {
    return fail_launch();
  }

  char *unresolved = calloc(executable_size, sizeof(char));
  if (unresolved == NULL) {
    return fail_launch();
  }
  if (_NSGetExecutablePath(unresolved, &executable_size) != 0) {
    free(unresolved);
    return fail_launch();
  }

  char launcher[PATH_MAX];
  if (realpath(unresolved, launcher) == NULL) {
    free(unresolved);
    return fail_launch();
  }
  free(unresolved);

  char macos_directory[PATH_MAX];
  if (strlcpy(macos_directory, launcher, sizeof(macos_directory)) >=
      sizeof(macos_directory)) {
    return fail_launch();
  }
  char *separator = strrchr(macos_directory, '/');
  if (separator == NULL || separator == macos_directory) {
    return fail_launch();
  }
  *separator = '\0';

  char contents_directory[PATH_MAX];
  if (strlcpy(contents_directory, macos_directory,
              sizeof(contents_directory)) >= sizeof(contents_directory)) {
    return fail_launch();
  }
  separator = strrchr(contents_directory, '/');
  if (separator == NULL || strcmp(separator + 1, "MacOS") != 0) {
    return fail_launch();
  }
  *separator = '\0';

  char helper_directory[PATH_MAX];
  char helper[PATH_MAX];
  char runtime[PATH_MAX];
  char controlled_path[PATH_MAX];
  int path_size;
  if (join_path(helper_directory, sizeof(helper_directory), contents_directory,
                "Helpers") != 0 ||
      join_path(helper, sizeof(helper), helper_directory,
                CASYS_HELPER_EXECUTABLE) != 0 ||
      join_path(runtime, sizeof(runtime), macos_directory,
                CASYS_RUNTIME_EXECUTABLE) != 0) {
    return fail_launch();
  }
  path_size = snprintf(controlled_path, sizeof(controlled_path), "%s:%s",
                       helper_directory, CASYS_SYSTEM_PATH);
  if (path_size < 0 || (size_t)path_size >= sizeof(controlled_path)) {
    return fail_launch();
  }

  if (exact_directory(helper_directory) != 0 ||
      exact_regular_executable(helper) != 0 ||
      exact_regular_executable(runtime) != 0 ||
      setenv("PATH", controlled_path, 1) != 0) {
    return fail_launch();
  }

  argv[0] = runtime;
  execv(runtime, argv);
  (void)errno;
  return fail_launch();
}
