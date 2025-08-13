#!/bin/bash

# Replace with your actual API Gateway URL
API_URL="https://afswe7a63l.execute-api.us-west-2.amazonaws.com/dev"

echo "Testing MCP Server Handshake..."
echo "================================"

echo -e "\n1. Testing initialize method:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0"
      }
    }
  }' | jq '.'

echo -e "\n2. Testing initialized method:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "initialized",
    "params": {}
  }' | jq '.'

echo -e "\n3. Testing tools/list method:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/list",
    "params": {}
  }' | jq '.'

echo -e "\n4. Testing resources/list method:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "resources/list",
    "params": {}
  }' | jq '.'

echo -e "\n5. Testing heartbeat tool:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "heartbeat",
      "arguments": {}
    }
  }' | jq '.'

echo -e "\n6. Testing ping method:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 6,
    "method": "ping",
    "params": {}
  }' | jq '.'

echo -e "\n7. Testing doc search tool:"
curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "search_documents",
      "arguments": {
        "query": "sales data",
        "document_type": "workbook",
        "limit": 3
      }
    }
  }' | jq '.'

echo -e "\nTest complete!"