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
