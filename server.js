const express = require('express');
const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Repository configurations
const REPOSITORIES = {
  'context7': 'https://gitmcp.io/upstash/context7',
  'n8n-mcp': 'https://gitmcp.io/nicknerov/n8n-mcp', 
  'n8n-workflows': 'https://gitmcp.io/Zie619/n8n-workflows'
};

// Store active MCP processes
const mcpProcesses = new Map();

// Initialize MCP servers
async function initializeMCPServers() {
  console.log('Initializing MCP servers...');
  
  for (const [name, url] of Object.entries(REPOSITORIES)) {
    try {
      console.log(`Starting MCP server for ${name}...`);
      
      const process = spawn('npx', ['mcp-remote', url], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' }
      });
      
      process.stdout.on('data', (data) => {
        console.log(`[${name}] ${data.toString()}`);
      });
      
      process.stderr.on('data', (data) => {
        console.error(`[${name}] ERROR: ${data.toString()}`);
      });
      
      process.on('exit', (code) => {
        console.log(`[${name}] Process exited with code ${code}`);
        mcpProcesses.delete(name);
      });
      
      mcpProcesses.set(name, {
        process: process,
        url: url,
        status: 'running'
      });
      
    } catch (error) {
      console.error(`Failed to start MCP server for ${name}:`, error);
    }
  }
}

// MCP Protocol handler
class MCPHandler {
  constructor() {
    this.tools = new Map();
    this.resources = new Map();
  }
  
  async handleRequest(method, params) {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: 'unified-mcp-server',
            version: '1.0.0'
          }
        };
        
      case 'tools/list':
        return {
          tools: await this.getAllTools()
        };
        
      case 'tools/call':
        return await this.callTool(params.name, params.arguments);
        
      case 'resources/list':
        return {
          resources: await this.getAllResources()
        };
        
      case 'resources/read':
        return await this.readResource(params.uri);
        
      default:
        throw new Error(`Unknown method: ${method}`);
    }
  }
  
  async getAllTools() {
    const tools = [];
    
    // Add tools from each repository
    for (const [repoName, repoData] of mcpProcesses) {
      if (repoData.status === 'running') {
        tools.push({
          name: `${repoName}_search`,
          description: `Search ${repoName} repository`,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
              limit: { type: 'number', default: 10 }
            },
            required: ['query']
          }
        });
        
        tools.push({
          name: `${repoName}_list`,
          description: `List files in ${repoName} repository`,
          inputSchema: {
            type: 'object',
            properties: {
              path: { type: 'string', default: '/' }
            }
          }
        });
      }
    }
    
    return tools;
  }
  
  async getAllResources() {
    const resources = [];
    
    for (const [repoName, repoData] of mcpProcesses) {
      if (repoData.status === 'running') {
        resources.push({
          uri: `mcp://${repoName}/`,
          name: `${repoName} Repository`,
          description: `Access to ${repoName} repository files`,
          mimeType: 'application/json'
        });
      }
    }
    
    return resources;
  }
  
  async callTool(name, args) {
    // Parse tool name to get repository and action
    const [repoName, action] = name.split('_');
    
    if (!mcpProcesses.has(repoName)) {
      throw new Error(`Repository ${repoName} not available`);
    }
    
    // Simulate tool execution (in real implementation, you'd proxy to the actual MCP server)
    switch (action) {
      case 'search':
        return {
          results: [
            {
              path: `/${repoName}/example.md`,
              content: `Search results for "${args.query}" in ${repoName}`,
              score: 0.95
            }
          ]
        };
        
      case 'list':
        return {
          files: [
            { name: 'README.md', type: 'file', path: `${args.path}/README.md` },
            { name: 'docs', type: 'directory', path: `${args.path}/docs/` }
          ]
        };
        
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
  
  async readResource(uri) {
    // Parse URI and return resource content
    const [, , repoName, ...pathParts] = uri.split('/');
    const path = pathParts.join('/');
    
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Content of ${path} from ${repoName} repository`
        }
      ]
    };
  }
}

const mcpHandler = new MCPHandler();

// HTTP endpoints
app.get('/health', (req, res) => {
  const status = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    repositories: Array.from(mcpProcesses.keys()),
    processes: Array.from(mcpProcesses.entries()).map(([name, data]) => ({
      name,
      status: data.status,
      url: data.url
    }))
  };
  res.json(status);
});

app.get('/mcp/tools', async (req, res) => {
  try {
    const tools = await mcpHandler.getAllTools();
    res.json({ tools });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/mcp/tools/:toolName', async (req, res) => {
  try {
    const result = await mcpHandler.callTool(req.params.toolName, req.body.arguments || {});
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/mcp/resources', async (req, res) => {
  try {
    const resources = await mcpHandler.getAllResources();
    res.json({ resources });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/mcp/resources/*', async (req, res) => {
  try {
    const uri = `mcp://${req.params[0]}`;
    const resource = await mcpHandler.readResource(uri);
    res.json(resource);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket server for MCP stdio protocol
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New MCP WebSocket connection');
  
  ws.on('message', async (message) => {
    try {
      const request = JSON.parse(message.toString());
      const response = await mcpHandler.handleRequest(request.method, request.params);
      
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        result: response
      }));
    } catch (error) {
      ws.send(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32000,
          message: error.message
        }
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('MCP WebSocket connection closed');
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down MCP servers...');
  for (const [name, data] of mcpProcesses) {
    if (data.process) {
      data.process.kill();
    }
  }
  process.exit(0);
});

// Start server
server.listen(port, async () => {
  console.log(`Unified MCP Server running on port ${port}`);
  await initializeMCPServers();
});

module.exports = app;
