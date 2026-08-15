import { basename } from "node:path";

/** Resolve a named template inside the bundled template directory. */
export function templatePath(templateRoot: string, name: string): string {
  return `${templateRoot}/${basename(name)}`;
}
