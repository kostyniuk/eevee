# eevee Review Agent Resources

## Knowledge

- [eve: GitHub integration](https://eve.dev/integrations/github)
  Primary framework guide for the GitHub channel, webhook route, pull-request context, and GitHub API access. Use for: channel behavior and framework-owned responsibilities.
- [GitHub REST API: pull-request reviews](https://docs.github.com/en/rest/pulls/reviews)
  Canonical contract for creating formal reviews, review events, permissions, and inline comment anchors. Use for: delivery payloads and advisory-versus-blocking semantics.
- [GitHub Docs: installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
  Canonical explanation of account installation and all-versus-selected repository access. Use for: deciding whether eevee is available per repository or across an account.
- [Vercel: deploying projects from the CLI](https://vercel.com/docs/cli/deploying-from-cli)
  Primary guide to source and prebuilt CLI deployments. Use for: understanding what the CLI uploads.
- [Vercel: deployment overview](https://vercel.com/docs/deployments/overview)
  Confirms that CLI production deployment works with or without a Git connection. Use for: separating deployment artifacts from Git workflow artifacts.
- Local: `node_modules/eve/docs/evals/overview.mdx` and `targets.mdx`
  Version-matched eval documentation installed with the project. Use for: edge-level webhook tests and deterministic model fixtures.

## Wisdom (Communities)

- [GitHub Community Discussions: Apps](https://github.com/orgs/community/discussions/categories/apps)
  Practitioner discussions about App permissions, installations, and webhook behavior. Use for: operational edge cases after consulting official documentation.
- [Vercel Community](https://community.vercel.com/)
  Practitioner troubleshooting around deployments and managed integrations. Use for: production behavior not fully covered by the reference docs.

## Gaps

- We do not yet have a production incident or real pull-request review to compare with the synthetic edge evals.
