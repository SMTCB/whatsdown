import type { CodeSource } from "./source";

const CODE = /\.(js|jsx|mjs|cjs|ts|tsx)$/;
/** Entry points and config are loaded by tools, not imported by other files. */
const ENTRY = /(^|\/)(main|index|App|vite\.config|eslint\.config|playwright\.config|middleware)\.(m?[jt]sx?)$/;
const TESTS = /(^|\/)(tests?|e2e|__tests__)\/|\.(test|spec)\.[jt]sx?$/;

const baseName = (path: string) => (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Source files that no other file imports: dead code, where an edit changes nothing on screen.
 * Only answers when the source can search; on any doubt (no search, a failed lookup) a file counts as used.
 */
export async function unusedFiles(source: CodeSource, paths: readonly string[]): Promise<Set<string>> {
  const unused = new Set<string>();
  if (!source.search) return unused;
  for (const path of paths) {
    if (!CODE.test(path) || ENTRY.test(path) || TESTS.test(path)) continue;
    const name = baseName(path);
    const importLine = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"][^'"\\n]*[/.]${escape(name)}(?:\\.[a-z]+)?['"]`);
    try {
      const mentions = (await source.search(name)).filter((p) => p !== path && CODE.test(p)).slice(0, 8);
      let used = false;
      for (const other of mentions) {
        const text = await source.read(other);
        if (text && importLine.test(text)) {
          used = true;
          break;
        }
      }
      if (!used) unused.add(path);
    } catch {
      // keep it: a failed lookup is not proof the file is dead
    }
  }
  return unused;
}
