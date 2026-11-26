//
// The MCP server object, apart from its transport (stdio in index.js, an
// in-memory pair in the tests).
//

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools, registerPrompts } from './tools.js';

const INSTRUCTIONS = `Soigneur Studio: the rider's own indoor cycling and training server. The tools read the rider's rides, ride analyses, fitness and form, health data (from Garmin), the rider model and the training plan, all worked out by Soigneur the same way its app shows them. Start with get_athlete. Ride ids come from list_rides.`;

function createServer(data, {version = '0.1.0'} = {}) {
    const server = new McpServer({name: 'soigneur', title: 'Soigneur Studio', version}, {instructions: INSTRUCTIONS});
    registerTools(server, data);
    registerPrompts(server);
    return server;
}

export { createServer };
