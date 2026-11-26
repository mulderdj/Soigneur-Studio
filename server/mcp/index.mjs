#!/usr/bin/env node
//
// Soigneur's MCP server over stdio, for an AI app on the rider's computer
// (Claude Code, Gemini CLI, LM Studio, ...):
//
//   SOIGNEUR_URL=https://192.168.1.116:8443 SOIGNEUR_TOKEN=sst_... node server/mcp/index.mjs
//
// SOIGNEUR_TOKEN is an access key from the app: Account, AI access. With the
// local HTTPS certificate, NODE_EXTRA_CA_CERTS points to Caddy's root.crt.
//

// stdout carries the protocol only: the app's modules log, so everything
// else goes to stderr, before they are loaded
for(const k of ['log', 'info', 'debug']) console[k] = (...args) => console.error(...args);
process.removeAllListeners('warning');
process.on('warning', w => { if(w.name !== 'Warning' || !/Module type/.test(w.message)) console.error(w.message); });

const url = process.env.SOIGNEUR_URL;
const token = process.env.SOIGNEUR_TOKEN;
if(!url || !token) {
    console.error('Set SOIGNEUR_URL (e.g. https://192.168.1.116:8443) and SOIGNEUR_TOKEN (Account, AI access in the app).');
    process.exit(2);
}

const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
const { createApi, createSoigneur } = await import('./soigneur.js');
const { createServer } = await import('./server.js');

const server = createServer(createSoigneur({api: createApi({url, token})}));
await server.connect(new StdioServerTransport());
console.error(`:mcp Soigneur MCP server on stdio, for ${url}`);
