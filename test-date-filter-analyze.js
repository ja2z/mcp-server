const { spawn } = require('child_process');

console.log('🚀 Testing analyze_documents with date filter...\n');

// Start the MCP server
const server = spawn('node', ['dist/mcp_server_main.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, USE_LOCAL_CACHE: 'true', DEBUG_MODE: 'true' }
});

// Send analyze_documents request with date filter
const analyzeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "analyze_documents",
    arguments: {
      sql_query: "SELECT * FROM documents WHERE opens > 5 ORDER BY opens DESC LIMIT 10",
      original_question: "What are the top 10 most popular documents in the last 500 days?",
      date_filter: "last-500-days"
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

// Send the request
setTimeout(() => {
  console.log('📤 Sending analyze_documents request with date filter...');
  server.stdin.write(JSON.stringify(analyzeRequest) + '\n');
}, 2000);

// Timeout after 30 seconds
setTimeout(() => {
  if (!responseReceived) {
    console.log('⏰ Test timed out after 30 seconds');
    server.kill();
  }
}, 30000);

server.on('close', (code) => {
  console.log(`\n🏁 Server process exited with code ${code}`);
});
