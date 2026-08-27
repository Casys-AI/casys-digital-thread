#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int valid_data_root(const char *value) {
  static const char prefix[] = "--data-root=";
  if (strncmp(value, prefix, sizeof(prefix) - 1) != 0) return 0;
  const char *path = value + sizeof(prefix) - 1;
  if (path[0] != '/' || path[1] == '\0' || strstr(path, "//") != NULL) return 0;
  const char *segment = path + 1;
  while (*segment != '\0') {
    const char *end = segment;
    while (*end != '\0' && *end != '/') end++;
    if ((end - segment == 1 && segment[0] == '.') ||
        (end - segment == 2 && segment[0] == '.' && segment[1] == '.')) {
      return 0;
    }
    segment = *end == '/' ? end + 1 : end;
  }
  return 1;
}

int main(int argc, char **argv, char **envp) {
  if (argc != 2 || !valid_data_root(argv[1])) {
    fputs("casys-chat-host accepts exactly one absolute --data-root argument\n", stderr);
    return 64;
  }

  char executable[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0) {
    fputs("casys-chat-host executable path is unavailable\n", stderr);
    return 70;
  }
  char resolved[PATH_MAX];
  if (realpath(executable, resolved) == NULL) {
    fputs("casys-chat-host executable path cannot be resolved\n", stderr);
    return 70;
  }
  char *helpers = strstr(resolved, "/Contents/Helpers/casys-chat-host");
  if (helpers == NULL || helpers[strlen("/Contents/Helpers/casys-chat-host")] != '\0') {
    fputs("casys-chat-host must run from its signed app bundle\n", stderr);
    return 70;
  }
  *helpers = '\0';

  char node[PATH_MAX];
  char entry[PATH_MAX];
  if (snprintf(node, sizeof(node), "%s/Contents/Resources/chat-host/node", resolved) >=
          (int)sizeof(node) ||
      snprintf(entry, sizeof(entry), "%s/Contents/Resources/chat-host/main.mjs", resolved) >=
          (int)sizeof(entry)) {
    fputs("casys-chat-host bundle path is too long\n", stderr);
    return 70;
  }
  char *const child_argv[] = {node, entry, argv[1], NULL};
  execve(node, child_argv, envp);
  perror("casys-chat-host execve");
  return 70;
}
