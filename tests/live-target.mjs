// Live tests are opt-in and never select a workstation from checked-in config.
export function liveTarget() {
  const host = process.env.CODEX_TEST_HOST?.trim();
  if (!host || host.startsWith('-') || /[\s\x00-\x1f]/.test(host)) {
    throw new Error('Set CODEX_TEST_HOST to an SSH config alias before running a live test.');
  }
  return host;
}

export async function remoteTemp(client) {
  const result = await client.rpc('command/exec', {
    command: ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::Write([IO.Path]::GetTempPath())'],
    timeoutMs: 10000,
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) throw new Error('Cannot resolve remote temporary directory');
  return result.stdout.trim();
}
