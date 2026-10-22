# Project Rules

## Deployment workflow (mandatory order)

Every change goes through these steps, in this order:

1. **Build and test locally.** Make the change here and confirm it works on this machine.
2. **Commit and push to GitHub.** Commit only code that has been checked locally.
3. **Pull on the VPS, then build or (re)deploy.** Connect with the `,server` CLI alias (SSH to the VPS), `git pull` the pushed commit, then build, deploy or redeploy there.

### Never
- Edit code or config directly on the VPS. That includes hot fixes, quick tweaks and `vim` on the server.
- Let the local copy and the VPS copy diverge. The VPS runs exactly what is on GitHub, and GitHub holds exactly what was tested locally.
- Skip a step, for example by copying files to the server with `scp` or `rsync` instead of going through GitHub.

### If something is broken on the VPS
Reproduce it locally, fix it locally, then commit, push, pull and redeploy.

## What the rule does not cover: the personal layer

The rule is for the **core** (the app's own code). Personal stuff is the app's data, it is changed through the app itself, live on the VPS, and it never goes to GitHub:

- **The personal layer:** custom UI code and the custom database agents create tables in. Editing it on the VPS is using the app, not deploying it.
- **Server-only state:** secrets, `.env` files, the core database and other data volumes.

The personal layer lives in a data folder outside the repo, and is backed up instead of committed. The local copy has its own separate personal layer for testing. If a customization needs something the core can't do, that is a core change and goes through the rule.
