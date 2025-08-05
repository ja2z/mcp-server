#!/usr/bin/env node

import { spawn } from 'child_process';
import { config } from 'dotenv';
import { watch } from 'fs';
import { join } from 'path';

// Load environment variables
config();

console.log('🔄 Starting Sigma MCP Server in development mode...\n');

// Check environment variables
if (!process.env.SIGMA_CLIENT_ID || process.env.SIGMA_CLIENT_ID === 'your_sigma_client_id_here') {
  console.log('⚠️  Please update your .env file with actual Sigma API credentials:');
  console.log('   SIGMA_CLIENT_ID=your_actual_client_id');
  console.log('   SIGMA_CLIENT_SECRET=your_actual_client_secret\n');
  process.exit(1);
}

let serverProcess = null;

function startServer() {
  console.log('🚀 Starting MCP server...');
  
  // Kill existing server if running
  if (serverProcess) {
    serverProcess.kill();
  }
  
  // Build the project
  const buildProcess = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
  
  buildProcess.on('close', (code) => {
    if (code === 0) {
      console.log('✅ Build successful, starting server...\n');
      
      // Start the server using tsx for development
      serverProcess = spawn('npx', ['tsx', 'src/mcp_server_main.ts'], {
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'development' }
      });
      
      serverProcess.on('close', (code) => {
        console.log(`\n🏁 Server process exited with code ${code}`);
      });
      
      serverProcess.on('error', (error) => {
        console.error('❌ Server error:', error);
      });
    } else {
      console.log('❌ Build failed');
    }
  });
}

// Watch for file changes
function watchFiles() {
  console.log('👀 Watching for file changes...\n');
  
  watch('src', { recursive: true }, (eventType, filename) => {
    if (filename && filename.endsWith('.ts')) {
      console.log(`\n📝 File changed: ${filename}`);
      console.log('🔄 Restarting server...\n');
      startServer();
    }
  });
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down development server...');
  if (serverProcess) {
    serverProcess.kill();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down development server...');
  if (serverProcess) {
    serverProcess.kill();
  }
  process.exit(0);
});

// Start the server and watch for changes
startServer();
watchFiles(); 