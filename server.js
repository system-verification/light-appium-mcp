#!/usr/bin/env node
// ----------------------------------------------------------------
// Copyright (c) 2026 System Verification Sweden AB.
// Licensed under the Apache License, Version 2.0
// See LICENSE in the project root for license information.
// ----------------------------------------------------------------

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import { parsePageSource, formatLocatorReport } from "./parser.js";

const APPIUM_HOST = process.env.APPIUM_HOST || "http://localhost:4723";

async function getFirstSessionId() {
    const res = await axios.get(`${APPIUM_HOST}/appium/sessions`);
    const sessions = res.data.value;
    if (!sessions.length) {
        throw new Error("No active Appium sessions found.");
    }
    return sessions[0].id;
}

const server = new McpServer({
    name: "light-appium-mcp",
    version: "1.0.0",
});

server.registerTool(
    "list_sessions",
    {
        description: "List all active Appium sessions",
    },
    async () => {
        const res = await axios.get(`${APPIUM_HOST}/appium/sessions`);
        const sessions = res.data.value;

        if (!sessions.length) {
            return { content: [{ type: "text", text: "No active sessions found." }] };
        }

        const text = sessions
            .map((s) => `Session ID: ${s.id}\nCapabilities: ${JSON.stringify(s.capabilities, null, 2)}`)
            .join("\n\n");

        return { content: [{ type: "text", text }] };
    }
);

server.registerTool(
    "get_page_source",
    {
        description: "Get the XML page source of the current screen from a running Appium session",
        inputSchema: { sessionId: z.string().optional().describe("The Appium session ID. If not provided, uses the first active session.") },
    },
    async ({ sessionId }) => {
        const resolvedSessionId = sessionId || await getFirstSessionId();
        const res = await axios.get(`${APPIUM_HOST}/session/${resolvedSessionId}/source`);
        const source = res.data.value;
        return { content: [{ type: "text", text: source }] };
    }
);

server.registerTool(
    "suggest_locators",
    {
        description: "Given an element description, find matching elements in the page source and suggest locators",
        inputSchema: {
            sessionId: z.string().optional().describe("The Appium session ID. If not provided, uses the first active session."),
            description: z.string().optional().describe("Description of the element you are looking for, e.g. 'login button'. Defaults to all buttons, input fields, and text fields."),
            strategies: z.array(
                z.enum(["xpath", "id", "accessibility id", "class name", "-android uiautomator", "-ios predicate string", "-ios class chain", "css selector"])
            ).optional().describe("Locator strategies to suggest. Defaults to xpath if not specified."),
        },
    },
    async ({ sessionId, description, strategies }) => {
        const resolvedSessionId = sessionId || await getFirstSessionId();
        const res = await axios.get(`${APPIUM_HOST}/session/${resolvedSessionId}/source`);
        const source = res.data.value;
        const parsed = parsePageSource(source);

        const text = formatLocatorReport({
            ...parsed,
            description: description || "all buttons, input fields, and text fields",
            strategies: strategies?.length ? strategies : ["xpath"],
            source,
        });

        return { content: [{ type: "text", text }] };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
