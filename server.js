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
import { startRecording, stopRecording, isRecording, consolidateSteps, deduplicateScreens, buildFlow } from "./recorder.js";

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

server.registerTool(
    "start_recording",
    {
        description: "Start recording actions from an Appium session. Polls Appium server logs in the background to capture user interactions (taps, typing, etc.) along with XML page source snapshots.",
        inputSchema: {
            sessionId: z.string().optional().describe("The Appium session ID. If not provided, uses the first active session."),
        },
    },
    async ({ sessionId }) => {
        const resolvedSessionId = sessionId || await getFirstSessionId();

        if (isRecording(resolvedSessionId)) {
            return { content: [{ type: "text", text: `Already recording session ${resolvedSessionId}. Call stop_recording first.` }] };
        }

        try {
            await startRecording(resolvedSessionId, APPIUM_HOST);
        } catch (err) {
            return { content: [{ type: "text", text: `Failed to start recording: ${err.message}` }], isError: true };
        }
        return { content: [{ type: "text", text: `Recording started for session ${resolvedSessionId}. Perform actions in Appium Inspector, then call stop_recording to retrieve them.` }] };
    }
);

server.registerTool(
    "stop_recording",
    {
        description: "Stop recording and return a high-level flow summary. Raw actions are merged (findElement+click → 'tap', findElement+getText → 'verify'), element names are resolved from screen context, screens are auto-named by their header text, and repeated action sequences are deduplicated. Output: summary, named screens with element inventories, and a flow array of {action, elementName, screen, value?, navigatesTo?, attributeName?} steps. Verify steps capture the element's current text/attribute value for assertion generation.",
        inputSchema: {
            sessionId: z.string().optional().describe("The Appium session ID. If not provided, uses the first active session."),
        },
    },
    async ({ sessionId }) => {
        const resolvedSessionId = sessionId || await getFirstSessionId();

        if (!isRecording(resolvedSessionId)) {
            return { content: [{ type: "text", text: `No active recording for session ${resolvedSessionId}.` }] };
        }

        const recording = await stopRecording(resolvedSessionId);
        const consolidated = consolidateSteps(recording.steps);
        const { screens, actions } = deduplicateScreens(
            consolidated, recording.initialPageSource, parsePageSource
        );

        const flow = buildFlow(actions, screens);

        const output = {
            summary: {
                startedAt: recording.startedAt,
                stoppedAt: recording.stoppedAt,
                totalRawActions: actions.length,
                totalFlowSteps: flow.steps.length,
                platform: screens[0]?.platform || "unknown",
                deduplication: flow.deduplication,
            },
            screens: screens.map((s, i) => ({
                ...s,
                name: flow.screenNames[i]?.name,
            })),
            flow: flow.steps,
        };

        return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
