import { SigmaMcpServer } from './mcp_server_main.js';

// Create a singleton instance to reuse across Lambda invocations
let mcpServerInstance: SigmaMcpServer | null = null;

async function getMcpServer(): Promise<SigmaMcpServer> {
  if (!mcpServerInstance) {
    mcpServerInstance = new SigmaMcpServer();
    // Initialize without starting stdio transport
    await mcpServerInstance.initialize();
  }
  return mcpServerInstance;
}

export const handler = async (event: any, context: any) => {
  console.log('Lambda event:', JSON.stringify(event, null, 2));
  
  try {
    const server = await getMcpServer();
    
    // Parse the request
    let requestBody;
    try {
      requestBody = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
      requestBody = {};
    }
    
    const path = event.path || event.requestContext?.path || '/';
    const method = event.httpMethod || 'GET';
    
    // Handle different endpoints
    if (path.includes('heartbeat') || requestBody.method === 'tools/call') {
      // Handle MCP tool calls
      if (requestBody.params?.name === 'heartbeat') {
        const result = await server.callTool('heartbeat', {});
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(result),
        };
      }
      
      if (requestBody.params?.name === 'export_data') {
        const result = await server.callTool('export_data', requestBody.params.arguments);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(result),
        };
      }
      
      if (requestBody.params?.name === 'search_documents') {
        const result = await server.callTool('search_documents', requestBody.params.arguments);
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(result),
        };
      }
    }
    
    // Handle resource requests
    if (path.includes('resources') || requestBody.method === 'resources/list') {
      const resources = await server.listResources();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(resources),
      };
    }
    
    // Handle tools list
    if (path.includes('tools') || requestBody.method === 'tools/list') {
      const tools = await server.listTools();
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(tools),
      };
    }
    
    // Default health check
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Sigma MCP Server is running',
        timestamp: new Date().toISOString(),
        availableEndpoints: [
          '/heartbeat',
          '/tools',
          '/resources',
          '/ (this health check)'
        ]
      }),
    };
    
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
    };
  }
};