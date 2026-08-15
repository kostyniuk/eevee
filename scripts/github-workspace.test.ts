import assert from "node:assert/strict";
import test from "node:test";

import { trustWorkspace } from "../agent/lib/github-workspace.ts";

test("idempotently trusts the exact workspace used by Eve's GitHub checkout", async () => {
  const commands: string[] = [];

  const sandbox = {
    async run({ command }) {
      commands.push(command);
      return { exitCode: 0 };
    },
  };
  await trustWorkspace(sandbox);
  await trustWorkspace(sandbox);

  assert.deepEqual(commands, [
    "git config --global --replace-all safe.directory /workspace",
    "git config --global --replace-all safe.directory /workspace",
  ]);
});

test("fails sandbox setup when the Git safety configuration fails", async () => {
  await assert.rejects(
    trustWorkspace({
      async run() {
        return { exitCode: 1, stderr: "permission denied" };
      },
    }),
    /permission denied/u,
  );
});
