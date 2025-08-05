# Sigma MCP Server Deployment Guide

## Overview
This guide walks you through deploying the Sigma MCP Server to AWS Lambda with API Gateway.

## Architecture
```
Claude/MCP Client → API Gateway → Lambda → DynamoDB (cache)
                                    ↓
                              Secrets Manager (credentials)
                                    ↓
                               Sigma API
```

## Prerequisites

1. **AWS CLI** configured with appropriate permissions
2. **Terraform** installed (v1.0+)
3. **Node.js** 18+ and npm
4. **Sigma API credentials** (client ID and secret)

## Step 1: Prepare the Lambda Package

```bash
# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Create deployment package
npm run package
```

This creates `sigma-mcp-server.zip` with your compiled code and dependencies.

## Step 2: Configure Terraform Variables

Create a `terraform.tfvars` file:

```hcl
aws_region = "us-east-1"
environment = "dev"
sigma_base_url = "https://api.sigmacomputing.com"
```

## Step 3: Deploy Infrastructure

```bash
# Initialize Terraform
terraform init

# Plan the deployment
terraform plan

# Apply the changes
terraform apply
```

**Important**: After deployment, update the Secrets Manager secret with your actual Sigma credentials:

```bash
aws secretsmanager update-secret \
  --secret-id "sigma-api-credentials-dev" \
  --secret-string '{"clientId":"YOUR_ACTUAL_CLIENT_ID","clientSecret":"YOUR_ACTUAL_SECRET"}'
```

## Step 4: Initial Cache Population

The document cache needs to be populated before the MCP server can search documents. You can do this by:

### Option A: One-time Script
Create a simple script to populate the cache:

```typescript
// populate-cache.ts
import { SigmaApiClient } from './src/sigma-client.js';
import { DocumentCache } from './src/document-cache.js';

async function populateCache() {
  const client = new SigmaApiClient({
    baseUrl: process.env.SIGMA_BASE_URL!,
    clientId: process.env.SIGMA_CLIENT_ID!,
    clientSecret: process.env.SIGMA_CLIENT_SECRET!,
  });
  
  const cache = new DocumentCache(process.env.CACHE_TABLE_NAME!);
  
  await client.initialize();
  await cache.initialize();
  await cache.refreshCache(client);
  
  console.log('Cache populated successfully');
}

populateCache().catch(console.error);
```

### Option B: Lambda Function Invocation
You can invoke the Lambda directly to trigger cache refresh (you'd need to add an endpoint for this).

## Step 5: Configure Claude Desktop

Add your MCP server to Claude Desktop's configuration:

```json
{
  "mcpServers": {
    "sigma-analytics": {
      "command": "node",
      "args": [
        "path/to/mcp-client-script.js"
      ],
      "env": {
        "API_GATEWAY_URL": "https://your-api-id.execute-api.region.amazonaws.com/dev"
      }
    }
  }
}
```

You'll need to create a client script that communicates with your API Gateway endpoint instead of stdio.

## API Gateway Setup Details

The Terraform creates:

1. **REST API** - Main API Gateway resource
2. **Proxy Resource** - `{proxy+}` to catch all paths
3. **ANY Method** - Accepts all HTTP methods
4. **Lambda Integration** - Routes requests to your Lambda function
5. **Deployment** - Creates a stage (dev/prod) with invoke URL

### API Gateway Flow:
1. Client sends HTTP POST with MCP request in body
2. API Gateway forwards to Lambda via AWS_PROXY integration
3. Lambda processes MCP request and returns response
4. API Gateway returns response to client

## Environment Variables

The Lambda function uses these environment variables (set by Terraform):

- `SIGMA_BASE_URL` - Sigma API endpoint
- `CACHE_TABLE_NAME` - DynamoDB table name
- `NODE_ENV` - Environment (dev/prod)

Credentials are loaded from AWS Secrets Manager automatically.

## Monitoring and Logs

- **CloudWatch Logs**: `/aws/lambda/sigma-mcp-server-{environment}`
- **API Gateway Logs**: Can be enabled in the API Gateway console
- **DynamoDB Metrics**: Available in CloudWatch

## Outputs

After deployment, Terraform provides:

```bash
# Get the API Gateway URL
terraform output api_gateway_url

# Get other resource names
terraform output lambda_function_name
terraform output dynamodb_table_name
terraform output secrets_manager_secret_name
```

## Local Testing

Before deploying to AWS, you can test the MCP server locally:

### 1. Set up Environment Variables

Create a `.env` file in the project root (this file is already in .gitignore):

```bash
# Sigma API Configuration
SIGMA_CLIENT_ID=your_actual_sigma_client_id
SIGMA_CLIENT_SECRET=your_actual_sigma_client_secret
SIGMA_BASE_URL=https://api.sigmacomputing.com

# Cache Configuration
# Set to 'true' for local file-based cache (for testing)
# Set to 'false' or omit for DynamoDB cache (for production)
USE_LOCAL_CACHE=true

# AWS Configuration (for local testing, these can be empty or use localstack)
AWS_REGION=us-east-1
CACHE_TABLE_NAME=sigma-documents-cache

# Environment
NODE_ENV=development
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Test the Heartbeat

Run the local test script to verify connectivity:

```bash
npm run test:local
```

This will:
- Check your environment variables
- Build the TypeScript code
- Start the MCP server
- Send a heartbeat request
- Display the response with server status

### 4. Manual Testing

You can also run the server manually and interact with it:

```bash
# Build the project
npm run build

# Start the server
npm start
```

The server will run on stdio and wait for MCP requests.

**Note**: When using local cache (`USE_LOCAL_CACHE=true`), the server will create a `local-cache.json` file in the project root to store document metadata. This file will be automatically created on first run and updated when the cache is refreshed.

## Testing

Test the deployment:

## Security Considerations

1. **API Gateway** has no authentication in this prototype - consider adding API keys or IAM auth for production
2. **Secrets Manager** stores credentials securely with automatic rotation capability
3. **IAM roles** follow least-privilege principle
4. **VPC** - Consider deploying Lambda in VPC for additional network security

## Scaling and Performance

- **Lambda**: Auto-scales, cold starts ~1-2 seconds
- **DynamoDB**: On-demand billing scales automatically
- **API Gateway**: Handles up to 10,000 requests per second by default
- **Cache Strategy**: In-memory cache in Lambda for fast lookups, DynamoDB for persistence

## Troubleshooting

Common issues:

1. **"Secret not found"** - Update Secrets Manager with real credentials
2. **"Table not found"** - Ensure DynamoDB table exists and Lambda has permissions
3. **Cold starts** - First request after idle time takes longer
4. **CORS errors** - API Gateway includes CORS headers

Check CloudWatch Logs for detailed error information.