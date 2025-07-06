# Multi-repository MCP Server for Railway
FROM node:20-alpine

WORKDIR /app

# Install git and other dependencies
RUN apk add --no-cache git curl python3 make g++

# Install MCP packages
RUN npm install -g mcp-remote @modelcontextprotocol/sdk @modelcontextprotocol/server-stdio

# Create MCP server script
COPY server.js .
COPY package.json .

# Install dependencies
RUN npm install

# Create health check endpoint
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the unified MCP server
CMD ["node", "server.js"]
