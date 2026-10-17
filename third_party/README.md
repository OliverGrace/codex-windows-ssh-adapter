# Third-party components

This repository does not contain Codex Desktop, Codex CLI, Node.js binaries, SSH keys, or account credentials.

- **ws** is pinned in `package-lock.json`. `npm ci --ignore-scripts` installs it from the npm registry. Its license is included in `node_modules/ws/LICENSE` and copied into the remote deployment package.
- **Node.js** is supplied by the local installation during packaging. The packager downloads the matching version's license from `https://raw.githubusercontent.com/nodejs/node/<version>/LICENSE`, caches it here, and includes it with the private runtime. It retries through Windows PowerShell networking if Node's HTTPS request fails. For offline builds, place the exact upstream license at `third_party/Node-v<version>-LICENSE.txt` first. Cached licenses and runtime binaries are ignored by Git. Node's license includes notices for its bundled components.
- **Codex Desktop and CLI** must be installed separately. The adapter uses the installed products; it does not redistribute them. Compatibility checks read the installed Desktop package locally.

Third-party components remain subject to their respective licenses. Public repository visibility does not itself grant a license for this project's original code; no project-wide license has been selected yet.
