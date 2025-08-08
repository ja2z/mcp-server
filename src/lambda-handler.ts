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

interface JsonRpcRequest {
    jsonrpc: string;
    id?: string | number;
    method: string;
    params?: any;
  }
  
interface JsonRpcResponse {
    jsonrpc: string;
    id?: string | number;
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
}

function createSuccessResponse(id: string | number | undefined, result: any): JsonRpcResponse {
    return {
        jsonrpc: "2.0",
        id,
        result
    };
}

function createErrorResponse(id: string | number | undefined, code: number, message: string): JsonRpcResponse {
    return {
        jsonrpc: "2.0",
        id,
        error: { code, message }
    };
}

export const handler = async (event: any, context: any) => {
    console.log('Lambda event:', JSON.stringify(event, null, 2));
    
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
          'Access-Control-Max-Age': '86400',
        },
        body: '',
      };
    }
  
    try {
      const server = await getMcpServer();
      
      // Parse JSON-RPC request
      let jsonRpcRequest: JsonRpcRequest;
      try {
        const body = event.body || '{}';
        jsonRpcRequest = typeof body === 'string' ? JSON.parse(body) : body;
      } catch (e) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(createErrorResponse(undefined, -32700, 'Parse error')),
        };
      }
  
      // Validate JSON-RPC format
      if (jsonRpcRequest.jsonrpc !== '2.0' || !jsonRpcRequest.method) {
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify(createErrorResponse(jsonRpcRequest.id, -32600, 'Invalid Request')),
        };
      }
  
      let result: any;
  
      // Handle MCP methods
      switch (jsonRpcRequest.method) {
        case 'initialize':
          result = {
            protocolVersion: "2024-11-05",
            capabilities: {
              resources: {},
              tools: {},
            },
            serverInfo: {
              name: "sigma-analytics-server",
              version: "0.1.0",
            }
          };
          break;
  
        case 'initialized':
          result = {};
          break;
  
        case 'ping':
          result = {};
          break;
  
        case 'resources/list':
          result = await server.listResources();
          break;
  
        case 'resources/read':
          const uri = jsonRpcRequest.params?.uri;
          if (!uri) {
            return {
              statusCode: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify(createErrorResponse(jsonRpcRequest.id, -32602, 'Missing uri parameter')),
            };
          }
          result = await server.readResource(uri);
          break;
  
        case 'tools/list':
          result = await server.listTools();
          break;
  
        case 'tools/call':
          const toolName = jsonRpcRequest.params?.name;
          const toolArgs = jsonRpcRequest.params?.arguments || {};
          
          if (!toolName) {
            return {
              statusCode: 400,
              headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              },
              body: JSON.stringify(createErrorResponse(jsonRpcRequest.id, -32602, 'Missing tool name')),
            };
          }
          
          result = await server.callTool(toolName, toolArgs);
          break;
  
        default:
          return {
            statusCode: 400,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(createErrorResponse(jsonRpcRequest.id, -32601, `Method not found: ${jsonRpcRequest.method}`)),
          };
      }
  
      // Return successful response
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(createSuccessResponse(jsonRpcRequest.id, result)),
      };
  
    } catch (error) {
      console.error('Lambda handler error:', error);
      
      // Try to parse the request ID from the event for proper error response
      let requestId: string | number | undefined;
      try {
        const body = event.body ? JSON.parse(event.body) : {};
        requestId = body.id;
      } catch (e) {
        // Ignore parse errors here
      }
  
      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify(createErrorResponse(requestId, -32603, 'Internal error')),
      };
    }
  };