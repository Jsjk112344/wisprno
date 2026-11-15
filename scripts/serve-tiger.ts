import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { tigerMetrics } from '../src/tiger/http.ts';
const html = readFileSync(new URL('../ui/tiger/index.html', import.meta.url));
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') { res.writeHead(405).end(); return; }
  const asset=req.url?.startsWith('/brand/')?req.url.slice(7):'';
  if(['WisprNo-horizontal-dark.svg','WisprNo-icon-mono-dark.svg','WisprNo-icon-mono-light.svg','wisprno.css'].includes(asset)){res.writeHead(200,{'Content-Type':asset.endsWith('.svg')?'image/svg+xml':'text/css'}).end(readFileSync(new URL('../ui/brand/'+asset,import.meta.url)));return;}
  if (req.url === '/api/metrics') {
    const result = await tigerMetrics();
    res.writeHead(result.status, { 'Content-Type': 'application/json' }).end(JSON.stringify(result.body));
  } else if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  else res.writeHead(404).end();
});
server.listen(4318, '127.0.0.1', () => console.log('WisprNo archive chart: http://127.0.0.1:4318'));
process.once('SIGINT', () => server.close());
process.once('SIGTERM', () => server.close());
