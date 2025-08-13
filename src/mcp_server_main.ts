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
import { join } from "path";
import Database from 'better-sqlite3';

// Load environment variables from .env file with explicit path
config({ path: '/Users/jonathanavrach/code/mcp-server/.env' });

// Environment variables with defaults for local development
const CLIENT_ID = process.env.SIGMA_CLIENT_ID;
const CLIENT_SECRET = process.env.SIGMA_CLIENT_SECRET;
const SIGMA_BASE_URL = process.env.SIGMA_BASE_URL || "https://api.sigmacomputing.com";
const CACHE_TABLE_NAME = process.env.CACHE_TABLE_NAME || "sigma-document-cache";
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Add option to skip cache entirely for testing
const SKIP_CACHE = process.env.SKIP_CACHE === 'true';

// Debug logging function
function debugLog(message: string, data?: any) {
  if (DEBUG_MODE) {
    if (data) {
      console.log(`🔍 [DEBUG] ${message}`, JSON.stringify(data, null, 2));
    } else {
      console.log(`🔍 [DEBUG] ${message}`);
    }
  }
}

// Validate required environment variables
if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error("Missing required environment variables: SIGMA_CLIENT_ID, SIGMA_CLIENT_SECRET");
}

// Only require CACHE_TABLE_NAME if not using local cache
if (!SKIP_CACHE && !CACHE_TABLE_NAME) {
  throw new Error("Missing required environment variable: CACHE_TABLE_NAME (required when not using local cache)");
}

export class SigmaMcpServer {
  private server: Server;
  private sigmaClient: SigmaApiClient;
  private documentCache: DocumentCache;

  constructor() {
    this.server = new Server(
      {
        name: "sigma-analytics",
        version: "0.1.0",
      },
      {
        capabilities: {
          resources: {
            "sigma://documents/workbooks": {
              name: "Sigma Workbooks",
              description: "List of all available Sigma workbooks with metadata",
              mimeType: "application/json",
            },
            "sigma://documents/datasets": {
              name: "Sigma Datasets",
              description: "List of all available Sigma datasets with metadata", 
              mimeType: "application/json",
            },
          },
          tools: {
            heartbeat: {
              description: "Test connectivity to Sigma API and return server information",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
            },
            export_data: {
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
                  date_filter: {
                    type: "string",
                    description: "Optional date filter for the data (e.g., 'last-500-days', 'last-30-days', 'min:last-day-500,max:'). If provided, will bypass cache to get fresh data.",
                  },
                },
                required: ["workbook_id", "element_id"],
              },
            },
            search_documents: {
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
            analyze_documents: {
              description: "Analyze Sigma documents using SQL queries to filter data before analysis. Use this after generate_sql_query to get filtered results.",
              inputSchema: {
                type: "object",
                properties: {
                  sql_query: {
                    type: "string",
                    description: "SQL query to filter documents before analysis. Use the output from generate_sql_query tool.",
                  },
                  original_question: {
                    type: "string",
                    description: "The original user question that led to this analysis.",
                  },
                  date_filter: {
                    type: "string",
                    description: "Optional date filter for the data (e.g., 'last-500-days', 'last-30-days', 'min:last-day-500,max:'). If provided, will bypass cache to get fresh data.",
                  },
                },
                required: ["sql_query", "original_question"],
              },
            },
            generate_sql_query: {
              description: "Get a prompt to generate a SQL query for filtering document data. Use this to create SQL that will help answer your question about documents.",
              inputSchema: {
                type: "object",
                properties: {
                  description: {
                    type: "string",
                    description: "A natural language description of what you want to analyze (e.g., 'least used documents', 'most popular documents', 'documents by John')",
                  },
                },
                required: ["description"],
              },
            },
          },
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
                date_filter: {
                  type: "string",
                  description: "Optional date filter for the data (e.g., 'last-500-days', 'last-30-days', 'min:last-day-500,max:'). If provided, will bypass cache to get fresh data.",
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
          {
            name: "analyze_documents",
            description: "Analyze Sigma documents using SQL queries to filter data before analysis. Use this after generate_sql_query to get filtered results.",
            inputSchema: {
              type: "object",
              properties: {
                sql_query: {
                  type: "string",
                  description: "SQL query to filter documents before analysis. Use the output from generate_sql_query tool.",
                },
                original_question: {
                  type: "string",
                  description: "The original user question that led to this analysis.",
                },
              },
              required: ["sql_query", "original_question"],
            },
          },
          {
            name: "generate_sql_query",
            description: "Get a prompt to generate a SQL query for filtering document data. Use this to create SQL that will help answer your question about documents.",
            inputSchema: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "A natural language description of what you want to analyze (e.g., 'least used documents', 'most popular documents', 'documents by John')",
                },
              },
              required: ["description"],
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
          case "analyze_documents":
            return await this.handleAnalyzeDocuments(args);
          case "generate_sql_query":
            return await this.handleGenerateSqlQuery(args);
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
    const { workbook_id, element_id, format = "json", date_filter } = args;

    // Validate arguments
    if (!workbook_id || !element_id) {
      throw new McpError(ErrorCode.InvalidParams, "workbook_id and element_id are required");
    }

    try {
      // Convert date_filter to Sigma API parameters format
      let parameters: { [key: string]: string } | undefined;
      if (date_filter) {
        debugLog(`Using date filter: ${date_filter}`);
        // Handle different date filter formats
        if (date_filter.includes('min:') || date_filter.includes('max:')) {
          // Direct Sigma parameter format
          parameters = { "p_datefilter": date_filter };
        } else if (date_filter.includes('last-')) {
          // Convert user-friendly format to Sigma format
          const days = date_filter.match(/last-(\d+)-days/)?.[1];
          if (days) {
            parameters = { "p_datefilter": `min:last-day-${days},max:` };
          } else {
            debugLog(`Invalid date filter format: ${date_filter}`);
          }
        }
      }

      const data = await this.exportDataFromSigma(workbook_id, element_id, format, parameters);
      
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

  /**
   * Reusable method for exporting data from Sigma
   * This can be used by multiple tools that need to export data
   */
  private async exportDataFromSigma(workbookId: string, elementId: string, format: 'csv' | 'json' = 'json', parameters?: { [key: string]: string }): Promise<string> {
    return await this.sigmaClient.exportData(workbookId, elementId, format, parameters);
  }

  /**
   * Reusable method for getting document analytics data from Sigma
   * This can be used by multiple tools that need analytics data
   */
  private async getDocumentAnalyticsFromSigma(workbookId: string, elementId: string, parameters?: { [key: string]: string }): Promise<any[]> {
    debugLog(`getDocumentAnalyticsFromSigma called with workbookId: ${workbookId}, elementId: ${elementId}`);
    if (parameters) {
      debugLog(`Using parameters:`, parameters);
    }
    
    // If parameters are provided, bypass cache to get fresh data
    if (parameters) {
      debugLog(`Parameters provided, bypassing cache to get fresh data...`);
      try {
        const analyticsData = await this.sigmaClient.getDocumentAnalytics(workbookId, elementId, parameters);
        debugLog(`Successfully fetched ${analyticsData.length} analytics records from Sigma with parameters`);
        return analyticsData;
      } catch (error) {
        debugLog(`Failed to fetch analytics data from Sigma with parameters:`, error instanceof Error ? error.message : String(error));
        throw error;
      }
    }
    
    // Check cache first (only when no parameters)
    debugLog(`Checking cache for analytics data...`);
    let analyticsData = await this.documentCache.getCachedDocumentAnalytics(workbookId, elementId);
    
    if (!analyticsData) {
      debugLog(`Analytics data not found in cache for workbook ${workbookId}, element ${elementId}, fetching from Sigma...`);
      
      // Fetch fresh data from Sigma
      debugLog(`Calling sigmaClient.getDocumentAnalytics...`);
      try {
        analyticsData = await this.sigmaClient.getDocumentAnalytics(workbookId, elementId);
        debugLog(`Successfully fetched ${analyticsData.length} analytics records from Sigma`);
        
        // Cache the data
        debugLog(`Caching analytics data...`);
        await this.documentCache.cacheDocumentAnalytics(workbookId, elementId, analyticsData);
        debugLog(`Analytics data cached successfully`);
      } catch (error) {
        debugLog(`Failed to fetch analytics data from Sigma:`, error instanceof Error ? error.message : String(error));
        throw error;
      }
    } else {
      debugLog(`Using cached analytics data (${analyticsData.length} records)`);
    }

    debugLog(`Returning ${analyticsData.length} analytics records`);
    return analyticsData;
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

  private async handleAnalyzeDocuments(args: any) {
    const { sql_query, original_question, date_filter } = args;

    debugLog(`handleAnalyzeDocuments called with args:`, JSON.stringify(args, null, 2));

    if (!sql_query || !original_question) {
      debugLog(`Missing required parameters`);
      throw new McpError(ErrorCode.InvalidParams, "sql_query and original_question are required");
    }

    try {
      // Hardcoded workbook and element IDs for document analytics
      const ANALYTICS_WORKBOOK_ID = process.env.ANALYTICS_WORKBOOK_ID || "1yHvaPVFWhSgL42yGvt9I9";
      const ANALYTICS_ELEMENT_ID = process.env.ANALYTICS_ELEMENT_ID || "csuTQytGNe";

      debugLog(`Using analytics workbook ID: ${ANALYTICS_WORKBOOK_ID}`);
      debugLog(`Using analytics element ID: ${ANALYTICS_ELEMENT_ID}`);

      // Convert date_filter to Sigma API parameters format
      let parameters: { [key: string]: string } | undefined;
      if (date_filter) {
        debugLog(`Using date filter: ${date_filter}`);
        // Handle different date filter formats
        if (date_filter.includes('min:') || date_filter.includes('max:')) {
          // Direct Sigma parameter format
          parameters = { "p_datefilter": date_filter };
        } else if (date_filter.includes('last-')) {
          // Convert user-friendly format to Sigma format
          const days = date_filter.match(/last-(\d+)-days/)?.[1];
          if (days) {
            parameters = { "p_datefilter": `min:last-day-${days},max:` };
          } else {
            debugLog(`Invalid date filter format: ${date_filter}`);
          }
        }
      }

      // Get analytics data from Sigma (with date filter if provided)
      const analyticsData = await this.getDocumentAnalyticsFromSigma(ANALYTICS_WORKBOOK_ID, ANALYTICS_ELEMENT_ID, parameters);
      debugLog(`Retrieved ${analyticsData.length} analytics records`);

      console.log(`📊 [ANALYTICS] Retrieved ${analyticsData.length} documents from Sigma`);
      console.log(`🔍 [SQL] Executing query: ${sql_query}`);

      // Load data into SQLite and execute query
      const filteredData = await this.executeSqlQuery(analyticsData, sql_query);
      console.log(`📋 [FILTERED] Query returned ${filteredData.length} documents`);

      // Send the filtered dataset to AI for analysis
      const analysisResult = {
        original_question: original_question,
        sql_query: sql_query,
        total_documents_in_database: analyticsData.length,
        filtered_documents: filteredData.length,
        documents: filteredData, // Send filtered documents to AI
        data_fields: [
          "documentName", "opens", "interactions", "users", "docCreatedByName", 
          "lastOpenedOn", "docCreatedAt", "documentType", "versionTag",
          "interactionsPercentile", "opensPercentile", "daysSinceLastActivity",
          "daysWithActivity", "firstActivity", "lastActivity", "totalEngagement"
        ],
        instructions: `Analyze these ${filteredData.length} filtered documents to answer: "${original_question}"
                       
                       These documents were filtered from a total of ${analyticsData.length} documents using the SQL query: "${sql_query}"
                       
                       Please provide a comprehensive answer based on the filtered dataset provided.`
      };

      const responseText = `Here's the filtered document dataset to answer your question "${original_question}":\n\n${JSON.stringify(analysisResult, null, 2)}`;
      console.log(`📤 [RESPONSE] Sending ${filteredData.length} filtered documents to AI for analysis`);
      console.log(`📏 [RESPONSE] Response size: ${responseText.length} characters`);

      return {
        content: [
          {
            type: "text",
            text: responseText,
          },
        ],
      };
    } catch (error) {
      debugLog(`handleAnalyzeDocuments failed:`, error instanceof Error ? error.message : String(error));
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      console.error(`❌ [MCP ERROR] analyze_documents failed:`, {
        error: errorMessage,
        args: args,
        timestamp: new Date().toISOString()
      });
      
      throw new McpError(
        ErrorCode.InternalError,
        `Document analysis failed: ${errorMessage}`
      );
    }
  }

  private async executeSqlQuery(analyticsData: any[], sqlQuery: string): Promise<any[]> {
    // Create in-memory SQLite database
    const db = new Database(':memory:');
    
    try {
      // Create table
      db.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          documentName TEXT,
          opens INTEGER,
          interactions INTEGER,
          users INTEGER,
          docCreatedByName TEXT,
          docCreatedByEmail TEXT,
          docCreatedAt TEXT,
          documentType TEXT,
          versionTag TEXT,
          lastOpenedOn TEXT,
          lastInteractedOn TEXT,
          lastPublishedOn TEXT,
          firstActivity TEXT,
          lastActivity TEXT,
          daysSinceLastActivity INTEGER,
          daysWithActivity INTEGER,
          totalEngagement INTEGER,
          engagementScore REAL
        );
      `);

      // Insert data
      const insert = db.prepare(`
        INSERT INTO documents (
          id, documentName, opens, interactions, users, docCreatedByName, 
          docCreatedByEmail, docCreatedAt, documentType, versionTag,
          lastOpenedOn, lastInteractedOn, lastPublishedOn, firstActivity, 
          lastActivity, daysSinceLastActivity, daysWithActivity, totalEngagement, engagementScore
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertMany = db.transaction((docs: any[]) => {
        for (let i = 0; i < docs.length; i++) {
          const doc = docs[i];
          const totalEngagement = (doc.opens || 0) + (doc.interactions || 0);
          insert.run(
            `doc_${i}`, // Generate surrogate key
            doc.documentName,
            doc.opens || 0,
            doc.interactions || 0,
            doc.users || 0,
            doc.docCreatedByName,
            doc.docCreatedByEmail,
            doc.docCreatedAt,
            doc.documentType,
            doc.versionTag,
            doc.lastOpenedOn,
            doc.lastInteractedOn,
            doc.lastPublishedOn,
            doc.firstActivity,
            doc.lastActivity,
            doc.daysSinceLastActivity || 0,
            doc.daysWithActivity || 0,
            totalEngagement,
            doc.engagementScore || totalEngagement
          );
        }
      });

      insertMany(analyticsData);

      // Execute the SQL query
      const result = db.prepare(sqlQuery).all();
      
      return result;
    } finally {
      db.close();
    }
  }

  private async handleGenerateSqlQuery(args: any) {
    const { description } = args;

    if (!description) {
      throw new McpError(ErrorCode.InvalidParams, "description is required");
    }

    try {
      // Database schema for SQL generation
      const schema = `
        CREATE TABLE documents (
          id TEXT PRIMARY KEY,
          documentName TEXT,
          opens INTEGER,
          interactions INTEGER,
          users INTEGER,
          docCreatedByName TEXT,
          docCreatedByEmail TEXT,
          docCreatedAt TEXT,
          documentType TEXT,
          versionTag TEXT,
          lastOpenedOn TEXT,
          lastInteractedOn TEXT,
          lastPublishedOn TEXT,
          firstActivity TEXT,
          lastActivity TEXT,
          daysSinceLastActivity INTEGER,
          daysWithActivity INTEGER,
          totalEngagement INTEGER,
          engagementScore REAL
        );
      `;

      // Provide a prompt for the AI to generate SQL
      const sqlGenerationPrompt = `You need to generate a SQL query to filter document data based on this description: "${description}"

Database Schema:
${schema}

Available columns:
- documentName: Name of the document
- opens: Number of times document was opened
- interactions: Number of user interactions with the document
- users: Number of unique users who accessed the document
- docCreatedByName: Name of the person who created the document
- docCreatedByEmail: Email of the person who created the document
- docCreatedAt: When the document was created
- documentType: Type of document (workbook, dataset, etc.)
- versionTag: Version status (Published, Draft, etc.)
- lastOpenedOn: Last time document was opened
- lastInteractedOn: Last time user interacted with document
- lastPublishedOn: Last time document was published
- firstActivity: First activity on the document
- lastActivity: Last activity on the document
- daysSinceLastActivity: Days since last activity
- daysWithActivity: Number of days with activity
- totalEngagement: opens + interactions
- engagementScore: Calculated engagement score

Instructions:
1. Generate a SQL query that will filter the documents to help answer the question
2. Use ORDER BY to sort the results appropriately
3. Use LIMIT 200 to return a manageable subset (not too many, not too few)
4. Focus on the most relevant columns for the question
5. Return ONLY the SQL query, no explanations

Example queries:
- For "least used documents": SELECT * FROM documents ORDER BY totalEngagement ASC LIMIT 200
- For "most popular documents": SELECT * FROM documents ORDER BY totalEngagement DESC LIMIT 200
- For "recent documents": SELECT * FROM documents ORDER BY lastActivity DESC LIMIT 200
- For "documents by specific creator": SELECT * FROM documents WHERE docCreatedByName LIKE '%John%' ORDER BY totalEngagement DESC LIMIT 200

Generate SQL for: "${description}"`;

      return {
        content: [
          {
            type: "text",
            text: sqlGenerationPrompt,
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to generate SQL query prompt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private generateSqlFromDescription(description: string): string {
    // This method is no longer used - AI will generate SQL dynamically
    throw new Error("This method should not be called - use AI-generated SQL instead");
  }


  async start() {
    try {
      debugLog("Starting MCP server initialization...");
      
      // Initialize connections
      debugLog("Initializing Sigma client...");
      await this.sigmaClient.initialize();
      debugLog("Sigma client initialized successfully");
      
      debugLog("Initializing document cache...");
      await this.documentCache.initialize();
      debugLog("Document cache initialized successfully");

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error("Sigma MCP server running on stdio");
    } catch (error) {
      console.error("❌ [MCP ERROR] Failed to start server:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

// Lambda handler for AWS
export const handler = async (event: any, context: any) => {
  try {
    const server = new SigmaMcpServer();
    await server.start();
    
    // Handle the specific MCP request from the event
    // This will need to be adapted based on how you route requests through API Gateway
    return {
      statusCode: 200,
      body: JSON.stringify({ message: "MCP server initialized" }),
    };
  } catch (error) {
    console.error("Lambda handler error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

// For local development
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new SigmaMcpServer();
  server.start().catch(console.error);
}