import http from 'node:http';
import net from 'node:net';

/**
 * A minimal HTTP CONNECT tunnel the e2e browsers route their non-localhost traffic
 * through. It exists because a process-level firewall (Little Snitch on this dev
 * machine) silently RESETS outbound connections from the hermetic Playwright browser
 * while allowing established CLI runtimes like node — so the browser cannot reach the
 * real LiveKit cloud directly, and every LiveKit spec fails at "could not establish
 * signal connection". Tunnelling through a node-owned socket restores the path without
 * touching the machine's firewall rules; verified end-to-end: the signal websocket AND
 * real WebRTC media (TURN/TLS through the tunnel) both flow.
 *
 * On a machine with an open network the tunnel is a no-op hop through localhost — one
 * configuration for every machine, not a mode to toggle [LAW:no-mode-explosion]. It
 * proxies; it never inspects, rewrites, or swallows — a failed upstream connect drops
 * the client socket, which surfaces in the spec as the loud connection failure it is
 * [LAW:no-silent-failure].
 */

const port = Number(process.argv[2] ?? 3180);

const proxy = http.createServer((req, res) => {
  // The readiness probe Playwright's webServer polls; plain requests are otherwise
  // not this tunnel's job.
  res.writeHead(req.method === 'GET' && req.url === '/' ? 200 : 405);
  res.end();
});

proxy.on('connect', (req, clientSocket, head) => {
  // CONNECT targets are host:port, where host may be a bracketed IPv6 literal.
  const split = req.url.lastIndexOf(':');
  const host = req.url.slice(0, split).replace(/^\[|\]$/g, '');
  const targetPort = Number(req.url.slice(split + 1));
  if (!Number.isInteger(targetPort) || targetPort <= 0 || targetPort >= 65536) {
    clientSocket.destroy();
    return;
  }
  const upstream = net.connect(targetPort, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
});

proxy.listen(port, '127.0.0.1', () => {
  console.log(`e2e connect proxy listening on 127.0.0.1:${port}`);
});
