import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export async function initializeWorkspace(state = "/home/node/.openclaw", parse = JSON.parse) {
  let label = "workspace";
  try {
    const base = await realpath(state);
    const config = parse(await readFile(resolve(base, "openclaw.json"), "utf8"));
    const agents = config.agents ?? {};
    const main = agents.entries?.main ?? agents.list?.find((agent) => agent.id === "main") ?? {};
    const configured = main.workspace ?? agents.defaults?.workspace ?? resolve(base, "workspace");
    if (typeof configured !== "string" || !isAbsolute(configured)) throw new Error();
    const workspace = resolve(configured);
    const child = relative(base, workspace);
    if (!child || child === ".." || child.startsWith(".." + sep) || isAbsolute(child)) throw new Error();
    // Reject every symlink component before mkdir or file creation.
    let current = base;
    for (const component of child.split(sep)) {
      current = resolve(current, component);
      try {
        const info = await lstat(current);
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await mkdir(current, { mode: 0o700 });
      }
    }
    if (await realpath(workspace) !== workspace) throw new Error();
    for (const [name, content] of [["USER.md", "# User\n"], ["MEMORY.md", "# Memory\n"]]) {
      label = name;
      const path = resolve(workspace, name);
      try {
        const file = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
        try { await file.writeFile(content); } finally { await file.close(); }
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error();
        await access(path, constants.R_OK | constants.W_OK);
      }
    }
  } catch {
    throw new Error(`Cannot initialize ${label}: unsafe target or access failure.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const require = createRequire("/app/package.json");
    await initializeWorkspace(undefined, require("json5").parse);
  } catch (error) {
    console.error(error.message.startsWith("Cannot initialize") ? error.message : "Cannot initialize workspace: configuration is unavailable.");
    process.exitCode = 1;
  }
}
