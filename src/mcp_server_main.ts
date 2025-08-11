import { config } from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SigmaApiClient } from "./sigma_client.js";
import { DocumentCache } from "./document_cache.js";

// Load environment variables from .env file
config();

// Environment variables
const CLIENT_ID = process.env.SIGMA_CLIENT_ID;
const CLIENT_SECRET = process.env.SIGMA_CLIENT_SECRET;
const SIGMA_BASE_URL = process.env.SIGMA_BASE_URL || "https://api.sigmacomputing.com";
const CACHE_TABLE_NAME = process.env.CACHE_TABLE_NAME;

// Validate required environment variables
if (!CLIENT_ID || !CLIENT_SECRET || !CACHE_TABLE_NAME) {
  throw new Error("Missing required environment variables: SIGMA_CLIENT_ID, SIGMA_CLIENT_SECRET, CACHE_TABLE_NAME");
}

export class SigmaMcpServer {
  private server: Server;
  private sigmaClient: SigmaApiClient;
  private documentCache: DocumentCache;

  constructor() {
    this.server = new Server(
      {
        name: "sigma-analytics-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      }
    );

    this.sigmaClient = new SigmaApiClient({
      baseUrl: SIGMA_BASE_URL,
      clientId: CLIENT_ID!,
      clientSecret: CLIENT_SECRET!,
    });

    this.documentCache = new DocumentCache(CACHE_TABLE_NAME!);

    this.setupHandlers();
  }

  private setupHandlers() {
    // List available resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      return {
        resources: [
          {
            uri: "sigma://documents/workbooks",
            name: "Sigma Workbooks",
            description: "List of all available Sigma workbooks with metadata",
            mimeType: "application/json",
          },
          {
            uri: "sigma://documents/datasets",
            name: "Sigma Datasets", 
            description: "List of all available Sigma datasets with metadata",
            mimeType: "application/json",
          },
        ],
      };
    });

    // Read specific resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
      const { uri } = request.params;

      try {
        if (uri === "sigma://documents/workbooks") {
          const workbooks = await this.documentCache.getWorkbooks();
          return {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(workbooks, null, 2),
              },
            ],
          };
        }

        if (uri === "sigma://documents/datasets") {
          const datasets = await this.documentCache.getDatasets();
          return {
            contents: [
              {
                uri,
                mimeType: "application/json", 
                text: JSON.stringify(datasets, null, 2),
              },
            ],
          };
        }

        throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${uri}`);
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to read resource: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });

    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "heartbeat",
            description: "Test connectivity to Sigma API and return server information",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: "export_data",
            description: "Export data from a Sigma workbook or dataset in CSV/JSON format",
            inputSchema: {
              type: "object",
              properties: {
                workbook_id: {
                  type: "string",
                  description: "The ID of the workbook to export data from",
                },
                element_id: {
                  type: "string", 
                  description: "The ID of the specific element (table/chart) to export",
                },
                format: {
                  type: "string",
                  enum: ["csv", "json"],
                  description: "Export format",
                  default: "json",
                },
              },
              required: ["workbook_id", "element_id"],
            },
          },
          {
            name: "search_documents",
            description: "Search for Sigma workbooks or datasets based on title, description, or content",
            inputSchema: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "Search query to match against document titles, descriptions, and content",
                },
                document_type: {
                  type: "string",
                  enum: ["workbook", "dataset", "all"],
                  description: "Type of documents to search",
                  default: "all",
                },
                limit: {
                  type: "number",
                  description: "Maximum number of results to return",
                  default: 10,
                },
              },
              required: ["query"],
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "heartbeat":
            return await this.handleHeartbeat(args);
          case "export_data":
            return await this.handleExportData(args);
          case "search_documents":
            return await this.handleSearchDocuments(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
        }
      } catch (error) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    });
  }

  private async handleHeartbeat(args: any) {
    try {
      const startTime = Date.now();
      const whoamiResponse = await this.sigmaClient.whoami();
      const responseTime = Date.now() - startTime;
      
      // Print whoami response to stdout
      console.log('Whoami response:', JSON.stringify(whoamiResponse, null, 2));
      
      // Get cache status
      const [workbooks, datasets] = await Promise.all([
        this.documentCache.getWorkbooks(),
        this.documentCache.getDatasets()
      ]);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "healthy",
              timestamp: new Date().toISOString(),
              sigma_api: {
                connected: true,
                response_time_ms: responseTime,
                user_info: whoamiResponse
              },
              document_cache: {
                workbooks_count: workbooks.length,
                datasets_count: datasets.length,
                last_updated: workbooks[0]?.lastCached || datasets[0]?.lastCached || "never"
              },
              server_info: {
                version: "0.1.0",
                environment: process.env.NODE_ENV || "unknown",
                lambda_function: process.env.AWS_LAMBDA_FUNCTION_NAME || "local"
              }
            }, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "unhealthy",
              timestamp: new Date().toISOString(),
              error: error instanceof Error ? error.message : String(error),
              sigma_api: {
                connected: false
              },
              server_info: {
                version: "0.1.0",
                environment: process.env.NODE_ENV || "unknown",
                lambda_function: process.env.AWS_LAMBDA_FUNCTION_NAME || "local"
              }
            }, null, 2),
          },
        ],
      };
    }
  }

  private async handleExportData(args: any) {
    const { workbook_id, element_id, format = "json" } = args;

    // Validate arguments
    if (!workbook_id || !element_id) {
      throw new McpError(ErrorCode.InvalidParams, "workbook_id and element_id are required");
    }

    try {
      const data = await this.sigmaClient.exportData(workbook_id, element_id, format);
      
      return {
        content: [
          {
            type: "text",
            text: `Data exported successfully from workbook ${workbook_id}, element ${element_id}:\n\n${data}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to export data: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async handleSearchDocuments(args: any) {
    const { query, document_type = "all", limit = 10 } = args;

    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, "query is required");
    }

    try {
      const results = await this.documentCache.searchDocuments(query, document_type, limit);
      
      return {
        content: [
          {
            type: "text",
            text: `Found ${results.length} documents matching "${query}":\n\n${JSON.stringify(results, null, 2)}`,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Search failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async start() {
    // Initialize connections
    await this.sigmaClient.initialize();
    await this.documentCache.initialize();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Sigma MCP server running on stdio");
  }

  async initialize() {
    await this.sigmaClient.initialize();
    await this.documentCache.initialize();
  }

  async callTool(name: string, args: any) {
    switch (name) {
      case "heartbeat":
        return await this.handleHeartbeat(args);
      case "export_data":
        return await this.handleExportData(args);
      case "search_documents":
        return await this.handleSearchDocuments(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async listResources() {
    return {
      resources: [
        {
          uri: "sigma://documents/workbooks",
          name: "Sigma Workbooks",
          description: "List of all available Sigma workbooks with metadata",
          mimeType: "application/json",
        },
        {
          uri: "sigma://documents/datasets",
          name: "Sigma Datasets", 
          description: "List of all available Sigma datasets with metadata",
          mimeType: "application/json",
        },
      ],
    };
  }

  async listTools() {
    return {
      tools: [
        {
          name: "heartbeat",
          description: "Test connectivity to Sigma API and return server information",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "export_data",
          description: "Export data from a Sigma workbook or dataset in CSV/JSON format",
          inputSchema: {
            type: "object",
            properties: {
              workbook_id: {
                type: "string",
                description: "The ID of the workbook to export data from",
              },
              element_id: {
                type: "string", 
                description: "The ID of the specific element (table/chart) to export",
              },
              format: {
                type: "string",
                enum: ["csv", "json"],
                description: "Export format",
                default: "json",
              },
            },
            required: ["workbook_id", "element_id"],
          },
        },
        {
          name: "search_documents",
          description: "Search for Sigma workbooks or datasets based on title, description, or content",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query to match against document titles, descriptions, and content",
              },
              document_type: {
                type: "string",
                enum: ["workbook", "dataset", "all"],
                description: "Type of documents to search",
                default: "all",
              },
              limit: {
                type: "number",
                description: "Maximum number of results to return",
                default: 10,
              },
            },
            required: ["query"],
          },
        },
      ],
    };
  }

  // Read specific resources
  async readResource(uri: string) {
    if (uri === "sigma://documents/workbooks") {
      const workbooks = await this.documentCache.getWorkbooks();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(workbooks, null, 2),
          },
        ],
      };
    }

    if (uri === "sigma://documents/datasets") {
      const datasets = await this.documentCache.getDatasets();
      return {
        contents: [
          {
            uri,
            mimeType: "application/json", 
            text: JSON.stringify(datasets, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  }
}


// For local development
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SigmaMcpServer();
  server.start().catch(console.error);
}