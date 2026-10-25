import http from 'node:http';
import { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import { scopedClientName } from './client-identity.mjs';

// A WebSocket endpoint over process pipes, never a network listener.
export function serveBridge({ input, output, startChild, clientScope = '', maxMessageBytes = 16 * 1024 * 1024, onFinish = () => {}, log = () => {} }) {
  let child, ws, finished = false, upgraded = false, exitTimer, stdoutBuffer = Buffer.alloc(0), upstreamEnded = false;
  const socket = new Duplex({
    read() { input.resume(); },
    write(chunk, encoding, callback) { output.write(chunk, encoding, callback); },
    final(callback) { callback(); },
    destroy(error, callback) { input.pause(); callback(error); }
  });
  socket.setTimeout = () => socket; socket.setNoDelay = () => socket; socket.setKeepAlive = () => socket;
  socket.remoteAddress = '127.0.0.1';
  input.on('data', onData); input.once('end', onEnd); input.once('error', onError); output.once('error', onError);
  function onData(chunk) { if (!socket.push(chunk)) input.pause(); }
  function onEnd() { socket.push(null); finish(0); }
  function onError() { finish(1); }
  function finish(code) {
    if (finished) return; finished = true;
    clearTimeout(handshakeTimer);
    input.off('data', onData); input.off('end', onEnd); input.off('error', onError); output.off('error', onError);
    socket.destroy(); ws?.terminate(); server.close(); wss.close();
    if (child && child.exitCode === null) {
      child.stdin.end();
      exitTimer = setTimeout(() => { child.kill(); onFinish(code); }, 2500);
      child.once('close', () => { clearTimeout(exitTimer); onFinish(code); });
    } else onFinish(code);
  }
  function fail(reason) { log('bridge_failure', { reason }); if (ws?.readyState === WebSocket.OPEN) ws.close(1011, reason.slice(0,100)); finish(1); }
  socket.on('error', () => finish(1));
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  const wss = new WebSocketServer({ noServer: true, clientTracking: false, perMessageDeflate: false, maxPayload: maxMessageBytes });
  server.on('clientError', () => fail('Invalid HTTP handshake'));
  const handshakeTimer = setTimeout(() => fail('WebSocket handshake timed out'), 30000);
  server.on('upgrade', (request, stream, head) => {
    if (upgraded || request.url !== '/rpc') { fail('Unexpected WebSocket endpoint'); return; }
    upgraded = true; clearTimeout(handshakeTimer);
    wss.handleUpgrade(request, stream, head, client => {
      ws = client;
      ws.on('error', () => fail('WebSocket protocol error'));
      ws.on('close', () => finish(0));
      try { child = startChild(); } catch { fail('Unable to start SSH'); return; }
      log('bridge_open');
      child.once('error', () => fail('SSH launch failed'));
      child.once('close', code => { upstreamEnded = true; if (!finished) { log('upstream_exit', { code }); finish(code ?? 1); } });
      child.stdin.on('error', () => { if (!finished && !upstreamEnded) fail('Remote input closed'); });
      child.stdout.on('data', chunk => {
        stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
        for (;;) {
          const index = stdoutBuffer.indexOf(10);
          if (index < 0) break;
          if (index > maxMessageBytes) { fail('Remote message exceeds limit'); return; }
          const line = stdoutBuffer.subarray(0, index).toString('utf8').trim();
          stdoutBuffer = stdoutBuffer.subarray(index + 1);
          if (!line) continue;
          try { JSON.parse(line); } catch { fail('Remote stdout contains non-JSON data'); return; }
          if (ws.readyState === WebSocket.OPEN) {
            child.stdout.pause();
            ws.send(line, error => { if (error) fail('Client output closed'); else if (!finished) child.stdout.resume(); });
          }
        }
        if (stdoutBuffer.length > maxMessageBytes) fail('Remote message exceeds limit');
      });
      child.stdout.on('error', () => fail('Remote output failed'));
      ws.on('message', (data, binary) => {
        if (finished) return;
        if (binary) { fail('Binary application messages unsupported'); return; }
        let message;
        try { message = JSON.parse(data.toString('utf8')); } catch { fail('Client message is not JSON'); return; }
        if (message === null || typeof message !== 'object' || Array.isArray(message)) { fail('Expected JSON-RPC object'); return; }
        // Scope only the durable identity; preserve request IDs and all other data.
        if (clientScope && message.method === 'initialize' && typeof message.params?.clientInfo?.name === 'string') {
          message.params.clientInfo.name = scopedClientName(message.params.clientInfo.name, clientScope);
        }
        if (!child.stdin.write(JSON.stringify(message) + '\n')) { ws.pause(); child.stdin.once('drain', () => { if (!finished) ws.resume(); }); }
      });
    });
  });
  server.emit('connection', socket);
  return { close: () => finish(0) };
}
