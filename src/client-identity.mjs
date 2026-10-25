import crypto from 'node:crypto';
import os from 'node:os';

// Preserve this derivation across updates: reconnects must reach the same session.
export function clientScope(config, root, host, machine = os.hostname()) {
  if (config.clientId !== undefined && (typeof config.clientId !== 'string' || !config.clientId.trim())) {
    throw new Error('clientId must be a nonempty string when configured');
  }
  return JSON.stringify([config.clientId || [machine.toLowerCase(), root.toLowerCase()], host.toLowerCase()]);
}

// The remote host indexes sessions by client name. Separate installations and
// SSH aliases while retaining reconnect identity and hiding machine/path values.
export function scopedClientName(name, scope) {
  if (!scope || typeof name !== 'string' || name.length > 200) return name;
  const suffix = crypto.createHash('sha256').update(scope).update('\0').update(name).digest('hex').slice(0, 24);
  return name.slice(0, 160) + '-' + suffix;
}
