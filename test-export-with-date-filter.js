#!/usr/bin/env node

import { spawn } from 'child_process';
import { config } from 'dotenv';

// Load environment variables
config();

console.log('🔍 Testing export_data tool with date filter...\n');

// Check if credentials are available
if (!process.env.SIGMA_CLIENT_ID || process.env.SIGMA_CLIENT_ID === 'your_sigma_client_id_here') {
  console.log('❌ Sigma credentials not configured properly');
  console.log('Please update your .env file with actual Sigma API credentials');
  process.exit(1);
}

console.log('✅ Environment variables loaded');
console.log('🚀 Starting MCP server to test export_data with date filter...\n');

// Start the MCP server
const server = spawn('node', ['dist/mcp_server_main.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, USE_LOCAL_CACHE: 'true', DEBUG_MODE: 'true' }
});

// Send export_data request with date filter
const exportRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "export_data",
    arguments: {
      workbook_id: "1yHvaPVFWhSgL42yGvt9I9", // Analytics workbook
      element_id: "csuTQytGNe", // Analytics element
      format: "json",
      date_filter: "last-500-days" // Test the date filter
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
      console.log('\n📊 Export Result:');
      console.log(content.substring(0, 500) + '...'); // Show first 500 chars
      
      // Check if the response indicates successful export with date filter
      if (content.includes('Data exported successfully') && content.includes('last-500-days')) {
        console.log('\n✅ SUCCESS: Export with date filter worked correctly!');
      } else {
        console.log('\n⚠️  WARNING: Export completed but date filter may not have been applied');
      }
      
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

// Send the export_data request
console.log('📤 Sending export_data request with date filter...');
server.stdin.write(JSON.stringify(exportRequest) + '\n');

// Timeout after 30 seconds
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
