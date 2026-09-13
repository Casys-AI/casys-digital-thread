/** Shared startup budget for real Chrome browser gates on slower CI hosts. */
export async function waitForChromeDebuggerAddress(profile: string): Promise<string> {
  const activePortPath = `${profile}/DevToolsActivePort`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const [port] = (await Deno.readTextFile(activePortPath)).trim().split("\n");
      if (port && /^(?:[1-9][0-9]{0,4})$/.test(port) && Number(port) <= 65535) {
        return `http://127.0.0.1:${port}`;
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Chrome did not publish its DevTools endpoint within 45 seconds.");
}

export async function stopChrome(
  chrome: Deno.ChildProcess,
  status: Promise<Deno.CommandStatus>,
): Promise<void> {
  try {
    chrome.kill("SIGTERM");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (await settlesWithin(status, 2_000)) return;
  try {
    chrome.kill("SIGKILL");
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  if (!(await settlesWithin(status, 2_000))) {
    throw new Error("The test Chrome process did not terminate.");
  }
}

export async function removeChromeProfile(profile: string): Promise<void> {
  let lastDirectoryNotEmpty: Error | undefined;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await Deno.remove(profile, { recursive: true });
      return;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Directory not empty")) {
        throw error;
      }
      lastDirectoryNotEmpty = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw lastDirectoryNotEmpty;
}

async function settlesWithin<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
