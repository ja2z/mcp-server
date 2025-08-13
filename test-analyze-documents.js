#!/usr/bin/env node

import { spawn } from 'child_process';
import { config } from 'dotenv';

// Load environment variables
config();

console.log('🔍 Testing analyze_documents tool with debugging...\n');

// Check if credentials are available
if (!process.env.SIGMA_CLIENT_ID || process.env.SIGMA_CLIENT_ID === 'your_sigma_client_id_here') {
  console.log('❌ Sigma credentials not configured properly');
  console.log('Please update your .env file with actual Sigma API credentials');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log('🚀 Starting MCP server to test analyze_documents...\n');

// Start the MCP server
const server = spawn('node', ['dist/mcp_server_main.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, USE_LOCAL_CACHE: 'true', DEBUG_MODE: 'true' }
});

// Send analyze_documents request
const analyzeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "analyze_documents",
    arguments: {
      query: "What are my top 10 most popular documents?",
      limit: 10,
      timeframe: "all"
    }
  }
};

let responseReceived = false;

// Handle server output
server.stdout.on('data', (data) => {
  const output = data.toString();
  console.log('📡 Server stdout:');
  console.log(output);
  
  try {
    const response = JSON.parse(output);
    if (response.result && response.result.content) {
      const content = response.result.content[0].text;
      console.log('\n📊 Analysis Result:');
      console.log(content);
      
      responseReceived = true;
      server.kill();
    }
  } catch (e) {
    // Not a JSON response, just log the output
  }
});

server.stderr.on('data', (data) => {
  console.log('⚠️  Server stderr:');
  console.log(data.toString());
});

server.on('close', (code) => {
  if (!responseReceived) {
    console.log(`\n❌ Server process exited with code ${code} before receiving response`);
  }
  process.exit(code);
});

// Send the analyze_documents request
console.log('📤 Sending analyze_documents request...');
server.stdin.write(JSON.stringify(analyzeRequest) + '\n');

// Timeout after 30 seconds (longer for analytics)
setTimeout(() => {
  if (!responseReceived) {
    console.log('\n⏰ Timeout: No response received within 30 seconds');
    server.kill();
    process.exit(1);
  }
}, 30000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  server.kill();
  process.exit();
}); 