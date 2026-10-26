# Contributing

[English](CONTRIBUTING.md) | [简体中文](docs/CONTRIBUTING.zh-CN.md)

## Branches

- `main`: default branch containing the reviewed, publishable baseline.
- `dev`: local development branch; do not push it to GitHub.
- Develop locally on `dev`, review and sanitize the changes before promoting them to `main`, and push only `main`. External pull requests target `main`.

Only `main` is published. Keep local configuration, credentials, machine identifiers, and test output out of **all** commits, including local development history. These roles are a workflow convention, not a server-side branch protection rule.

## Local checks

Use Windows x64 and Node.js 22+ x64:

```powershell
npm ci --ignore-scripts
npm test
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-remote.ps1
git add .
npm run check:publication
git diff --cached --check
git diff --cached
```

Close any App using this checkout before rebuilding `bin/ssh.exe`. Use a separate checkout to verify a build without disturbing a running App. The default tests cover classification, binary markers, SSH options, MCP port preflight, streaming, durable sessions, installation/target identity isolation, authenticated reconnect, discovery, and setup reuse. Keep identity derivation stable across changes and use the shared identity helper when looking up sessions in live tests. CI runs local tests, publication checks, and native compilation; it does not connect to your computers.

Publication checks scan the **Git index**. Stage final edits first. The check rejects generated/private file locations, binary content, private home paths, LAN addresses, and common credential patterns without printing matched values. It supplements manual review; it is not a complete secret detector. Use documentation domains and placeholders in examples, and synthetic `C:\fixtures` paths in tests.

## Opt-in live tests

Build the launcher and prepare a package first. Install/configure Desktop locally and native CLI remotely. Live tests use your SSH credentials and may create a scheduled service on first connection. They require remote PowerShell 7. Run them sequentially, preferably on a dedicated test host.

```powershell
$env:CODEX_TEST_HOST = 'windows-dev'
npm run prepare:remote
npm run test:integration
npm run test:durable
npm run test:discovery
npm run test:install
```

| Command | Scope |
| --- | --- |
| `test:integration` | Actual Desktop envelope, native handshake, identity, Unicode files, streaming, exit status, reconnect. |
| `test:durable` | Disconnect its own SSH; verify process/stdin continuity and authenticated MCP before/after reconnection. |
| `test:discovery` | Detect/bootstrap a host absent from `adapter.config.json`'s legacy `aliases`. Choose such an alias; the example list is empty. |
| `test:install` | Create a uniquely named isolated task; verify fresh setup and repeat-install reuse; stop/remove only that instance in cleanup. |

Reports and fixtures go into ignored `work/`. Tests do not stop the production service, but ordinary test sessions can remain in its bounded pool. An interrupted test may need cleanup of its uniquely named temporary files or task. Do not remove another session's state.

These additional tests **use the remote user's model/account quota** and run ephemeral agent turns:

```powershell
npm run test:agent
npm run test:agent-durable
```

The second disconnects the test SSH client while the agent command runs. Neither is part of CI or `npm test`.

## Compatibility and service changes

The compatibility helper reads a small command-formatting function from the installed Desktop package. Layout and version checks are deliberately conservative. For a new App version, review the envelope/protocol, run applicable live tests, then update the example's version gate and **both** READMEs. Do not distribute the Desktop bundle.

Setup reuses compatible services rather than overwriting them. Upgrade remotely after active work finishes; stopping the scheduled host kills its children. Packaging copies local Node and downloads its matching license, so a new Node version changes the generated package.

## Pull requests and documentation

Describe the behavior changed, checks actually run, and untested platform/account assumptions. Keep the English README as the entry point and update Chinese docs for user-visible changes. Do not attach raw SSH config, host caches, auth files, or full reports. Keep personal reproduction details outside the repository.

See [third-party notices](third_party/README.md) for license status. No project-wide license has been selected yet.
