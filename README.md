# System Verification Light Appium MCP

A lightweight MCP (Model Context Protocol) server that connects AI assistants to Appium for mobile sessions to extract XML tree and create locators. It exposes tools to list sessions, get page source, and suggest element locators — with automatic parsing for both Android and iOS.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- An [Appium](https://appium.io/) server running (default: `http://localhost:4723`)

## Tools

| Tool | Description |
|---|---|
| `list_sessions` | List all active Appium sessions |
| `get_page_source` | Get the XML page source of the current screen |
| `suggest_locators` | Parse the page source and suggest XPath locators for interactive elements |

All tools that accept a `sessionId` will automatically use the first active session if none is provided.

## Setup

By default the server connects to Appium at `http://localhost:4723`. Override this with the `APPIUM_HOST` environment variable.

### VS Code (Copilot)

Add to your `.vscode/mcp.json` (create it if it doesn't exist):

```json
{
  "servers": {
    "light-appium-mcp": {
      "command": "npx",
      "args": ["github:system-verification/light-appium-mcp"],
      "env": {
        "APPIUM_HOST": "http://localhost:4723"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add light-appium-mcp npx github:system-verification/light-appium-mcp
```

To set a custom Appium host:

```bash
claude mcp add light-appium-mcp -e APPIUM_HOST=http://192.168.1.100:4723 npx github:system-verification/light-appium-mcp
```

### Local install (from source)

```bash
git clone https://github.com/system-verification/light-appium-mcp.git
cd light-appium-mcp
npm install
node server.js
```

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
