# System Verification Light Appium MCP

A lightweight MCP (Model Context Protocol) server that connects AI assistants to Appium for mobile test automation. It provides tools to inspect sessions, extract page source, suggest locators, and **record user interactions** from Appium Inspector into a structured flow — ready for automated test generation.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- An [Appium](https://appium.io/) server running (default: `http://localhost:4723`)
- Appium started with `--allow-insecure=*:get_server_logs` (required for recording)

## Tools

| Tool | Description |
|---|---|
| `list_sessions` | List all active Appium sessions |
| `get_page_source` | Get the XML page source of the current screen, parsed into interactive and labeled elements |
| `suggest_locators` | Find elements matching a description and suggest XPath locators |
| `start_recording` | Start recording user actions from Appium server logs |
| `stop_recording` | Stop recording and return a processed flow summary |

All tools that accept a `sessionId` will automatically use the first active session if none is provided.

## Recording

The recording feature captures user interactions performed in Appium Inspector (or any Appium client) by polling the Appium server logs.

### Workflow

1. Start an Appium session (e.g., via Appium Inspector)
2. Call `start_recording` — the MCP begins polling server logs
3. Perform actions in Appium Inspector (tap, type, swipe, etc.)
4. Use Inspector's "Get Text" or "Get Attribute" to mark verifications
5. Call `stop_recording` — returns the processed flow

### Output format

```json
{
  "summary": {
    "startedAt": "...",
    "stoppedAt": "...",
    "totalRawActions": 12,
    "totalFlowSteps": 7,
    "platform": "android",
    "deduplication": { "removedActions": 3 }
  },
  "screens": [
    {
      "screenIndex": 0,
      "platform": "android",
      "name": "Login",
      "elements": [
        { "cls": "EditText", "rid": "username", "text": "", "desc": "username", "bounds": "...", "parentRid": "", "parentDesc": "" }
      ]
    }
  ],
  "flow": [
    { "action": "tap", "screen": "Login", "elementName": "username" },
    { "action": "type", "screen": "Login", "elementName": "username", "value": "john@doe.com" },
    { "action": "verify", "screen": "Login", "elementName": "errorMessage", "value": "Invalid credentials" }
  ]
}
```

### Flow actions

| Action | Trigger |
|---|---|
| `tap` | Element click |
| `type` | Send keys / set value |
| `gesture` | Swipe, scroll, or multi-touch |
| `verify` | getText or getAttribute call (verification intent) |

### Features

- **Element name resolution** — Resolves human-readable names from resource-id, content-desc, or text. Prefers parent container identifiers for child elements (e.g., a TextView inside a Spinner resolves to the Spinner's name).
- **Screen detection** — Auto-names screens from the topmost text element (header/title).
- **Screen deduplication** — Identical page sources are collapsed into a single screen reference.
- **Flow deduplication** — Repeated action sequences are detected and removed.
- **Verify via parent** — When `getText` is called on a child element with a generic id (e.g., `android:id/text1`), the element resolves to its meaningful parent and the text becomes the `value`.

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

## Testing

```bash
npm test
```

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
