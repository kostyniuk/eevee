import assert from "node:assert/strict";
import test from "node:test";

import { trustWorkspace } from "../agent/lib/github-workspace.ts";

test("trusts the exact workspace used by Eve's GitHub checkout", async () => {
  const commands: string[] = [];

  await trustWorkspace({
    async run({ command }) {
      commands.push(command);
      return { exitCode: 0 };
    },
  });

  assert.deepEqual(commands, ["git config --global --add safe.directory /workspace"]);
});

test("fails session initialization when the Git safety configuration fails", async () => {
  await assert.rejects(
    trustWorkspace({
      async run() {
        return { exitCode: 1, stderr: "permission denied" };
      },
    }),
    /permission denied/u,
  );
});
