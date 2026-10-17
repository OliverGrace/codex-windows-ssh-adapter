import { Duplex } from 'node:stream';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import crypto from 'node:crypto';
import { WebSocket } from 'ws';

export const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
export function envelope(command, marker = crypto.randomBytes(8)) {
  const markerText = [...marker].map(b => '\\' + b.toString(8).padStart(3, '0')).join('');
  const wrapper = 'if [ -z "$SHELL" ]; then echo "Codex remote SSH requires SHELL"; fi; CODEX_REMOTE_PAYLOAD="$1"; export CODEX_REMOTE_PAYLOAD; exec /bin/sh -c "$CODEX_REMOTE_PAYLOAD"';
  return { marker, command: `sh -c ${quote(wrapper)} sh ${quote(`printf '%b' ${quote(markerText)}; PATH="\${CODEX_INSTALL_DIR:-$HOME/.local/bin}:$PATH"; export PATH; ${command}`)}` };
}
export const proxyCommand = 'if [ -S "${SSH_AUTH_SOCK:-}" ]; then true; fi && exec codex app-server proxy';
export const lookupCommand = 'if command -v codex >/dev/null 2>&1; then exit 0; fi; exit 86';
export const bootstrapCommand = 'if [ "${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}" = "true" ]; then exit 0; fi; (umask 077; mkdir -p example) && { nohup codex -c features.code_mode_host=true app-server --listen unix:// </dev/null >/dev/null 2>&1 & }';

export async function pipeClient(executable, args, marker = null, options = {}) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ['pipe','pipe','pipe'], ...options });
  let stderr = '', pending = Buffer.alloc(0), found = !marker;
  child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-8000); });
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  const socket = new Duplex({ read() { child.stdout.resume(); }, write(b,e,cb) { child.stdin.write(b,e,cb); }, final(cb) { child.stdin.end(); cb(); }, destroy(error,cb) { child.stdin.end(); cb(error); } });
  socket.setTimeout = () => socket; socket.setNoDelay = () => socket; socket.setKeepAlive = () => socket;
  child.stdout.on('data', chunk => {
    if (!found) { pending = Buffer.concat([pending, chunk]); const i = pending.indexOf(marker); if (i < 0) { if (pending.length > 65536) socket.destroy(new Error('Marker not found')); return; } chunk = pending.subarray(i + marker.length); found = true; }
    if (chunk.length && !socket.push(chunk)) child.stdout.pause();
  });
  child.stdout.on('end', () => socket.push(null));
  child.on('error', e => socket.destroy(e));
  child.stdin.on('error', () => socket.destroy());
  const ws = new WebSocket('ws://codex-app-server/rpc', { createConnection: () => socket, perMessageDeflate: false, handshakeTimeout: 15000, maxPayload: 16*1024*1024 });
  const messages = [], pendingRpc = new Map(); let nextId = 0;
  ws.on('message', data => {
    const m = JSON.parse(data.toString()); messages.push(m);
    const p = pendingRpc.get(m.id);
    if (p && !m.method) { pendingRpc.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  });
  ws.on('error', () => {});
  ws.on('close', () => { for (const p of pendingRpc.values()) { clearTimeout(p.timer); p.reject(new Error('Connection closed: ' + stderr)); } pendingRpc.clear(); });
  try { await once(ws, 'open'); } catch(e) { child.kill(); throw new Error(e.message + '\n' + stderr); }
  return { ws, child, closed, messages, stderr: () => stderr,
    rpc(method, params, timeout = 20000) { return new Promise((resolve,reject) => { const id = ++nextId; const timer = setTimeout(() => { pendingRpc.delete(id); reject(new Error(`${method} timed out`)); }, timeout); pendingRpc.set(id,{resolve,reject,timer}); ws.send(JSON.stringify({id,method,params})); }); },
    notify(method, params) { ws.send(JSON.stringify({method,params})); },
    async close() { ws.close(); const timer = setTimeout(() => child.kill(), 5000); await closed; clearTimeout(timer); }
  };
}
