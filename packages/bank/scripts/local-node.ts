import { createServer } from 'node:http';
import { network } from 'hardhat';
const connection = await network.connect('default');
// Hardhat's CLI prints public development keys. This local-only RPC wrapper never prints keys.
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1048576) throw new Error('Payload too large');
      chunks.push(Buffer.from(chunk));
    }
    const request = JSON.parse(Buffer.concat(chunks).toString());
    const result = await connection.provider.request({
      method: request.method,
      params: request.params ?? [],
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  } catch (error) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: error instanceof Error ? error.message : 'Local EVM request failed' },
      }),
    );
  }
});
const port = Number(process.env.CAPORA_LOCAL_CHAIN_PORT ?? 8545);
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Local test EVM listening on 127.0.0.1:${port} (chain 84532). This is not hosted Base Sepolia.`,
  ),
);
