#!/usr/bin/env node

// Set environment variable for local testing
process.env.USE_LOCAL_CACHE = 'true';

import { spawn } from 'child_process';
import path from 'path';

console.log('Starting MCP server with local cache...');
console.log('💓 Sending heartbeat request...');

// Start the MCP server
const server = spawn('node', ['dist/mcp_server_main.js'], {
  stdio: ['pipe', 'pipe', 'pipe']
});

// Send a heartbeat request
const heartbeatRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "heartbeat",
    arguments: {}
  }
};

server.stdin.write(JSON.stringify(heartbeatRequest) + '\n');

// Handle server output
server.stdout.on('data', (data) => {
  console.log('Server stdout:', data.toString());
});

server.stderr.on('data', (data) => {
  console.log('Server stderr:', data.toString());
});

server.on('close', (code) => {
  console.log(`Server process exited with code ${code}`);
});

// Cleanup on script exit
process.on('SIGINT', () => {
  server.kill('SIGINT');
  process.exit();
}); 