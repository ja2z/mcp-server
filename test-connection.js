#!/usr/bin/env node

import { spawn } from 'child_process';
import { config } from 'dotenv';

// Load environment variables
config();

console.log('🔍 Testing Sigma API connection...\n');

// Check if credentials are available
if (!process.env.SIGMA_CLIENT_ID || process.env.SIGMA_CLIENT_ID === 'your_sigma_client_id_here') {
  console.log('❌ Sigma credentials not configured properly');
  console.log('Please update your .env file with actual Sigma API credentials');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log('🚀 Starting MCP server to test connection...\n');

// Start the MCP server
const server = spawn('node', ['dist/mcp_server_main.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, USE_LOCAL_CACHE: 'true' }
});

// Send heartbeat request
const heartbeatRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "heartbeat",
    arguments: {}
  }
};

let responseReceived = false;

// Handle server output
server.stdout.on('data', (data) => {
  const output = data.toString();
  console.log('📡 Server response:');
  console.log(output);
  
  try {
    const response = JSON.parse(output);
    if (response.result && response.result.content) {
      const content = response.result.content[0].text;
      const heartbeatData = JSON.parse(content);
      
      console.log('\n📊 Connection Status:');
      console.log(`Status: ${heartbeatData.status}`);
      console.log(`Sigma API Connected: ${heartbeatData.sigma_api?.connected ? '✅ YES' : '❌ NO'}`);
      
      if (heartbeatData.sigma_api?.connected) {
        console.log(`Response Time: ${heartbeatData.sigma_api.response_time_ms}ms`);
        console.log(`User Info: ${JSON.stringify(heartbeatData.sigma_api.user_info, null, 2)}`);
      } else {
        console.log(`Error: ${heartbeatData.error || 'Unknown error'}`);
      }
      
      responseReceived = true;
      server.kill();
    }
  } catch (e) {
    // Not a JSON response, just log the output
  }
});

server.stderr.on('data', (data) => {
  console.log('⚠️  Server stderr:', data.toString());
});

server.on('close', (code) => {
  if (!responseReceived) {
    console.log(`\n❌ Server process exited with code ${code} before receiving response`);
  }
  process.exit(code);
});

// Send the heartbeat request
server.stdin.write(JSON.stringify(heartbeatRequest) + '\n');

// Timeout after 10 seconds
setTimeout(() => {
  if (!responseReceived) {
    console.log('\n⏰ Timeout: No response received within 10 seconds');
    server.kill();
    process.exit(1);
  }
}, 10000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  server.kill();
  process.exit();
}); 