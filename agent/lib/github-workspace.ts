export async function trustWorkspace(sandbox: SandboxRunner): Promise<void> {
  const result = await sandbox.run({
    command: "git config --global --replace-all safe.directory /workspace",
  });
  if (result.exitCode === 0) return;

  const detail = result.stderr?.trim();
  throw new Error(
    `Could not mark /workspace as a safe Git directory${detail ? `: ${detail}` : "."}`,
  );
}

type SandboxRunner = {
  run(options: { readonly command: string }): PromiseLike<{
    readonly exitCode: number;
    readonly stderr?: string;
  }>;
};
