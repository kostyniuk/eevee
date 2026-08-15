import { defineSandbox } from "eve/sandbox";

import { trustWorkspace } from "./lib/github-workspace";

export default defineSandbox({
  async bootstrap({ use }) {
    const sandbox = await use();
    await trustWorkspace(sandbox);
  },
});
