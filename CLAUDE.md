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
Reproduce it locally, fix it locally, then commit, push, pull and redeploy. Server-only state (secrets, `.env` files, data volumes) is the one exception: it stays out of git and is managed on the server.
