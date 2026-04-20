// ----------------------------------------------------------------
// Copyright (c) 2026 System Verification Sweden AB.
// Licensed under the Apache License, Version 2.0
// See LICENSE in the project root for license information.
// ----------------------------------------------------------------

import axios from "axios";

// Map<sessionId, { interval, steps[], startedAt, appiumHost, stepIndex }>
const recordings = new Map();

// Endpoints that represent user actions worth recording
const ACTION_PATTERNS = [
    /\/element\/[^/]+\/click$/,
    /\/element\/[^/]+\/value$/,
    /\/element\/[^/]+\/clear$/,
    /\/element\/[^/]+\/keys$/,
    /\/actions$/,
    /\/touch\/perform$/,
    /\/touch\/multi\/perform$/,
    /\/element$/,
    /\/elements$/,
    /\/back$/,
    /\/forward$/,
    /\/refresh$/,
    /\/appium\/device\/press_key$/,
    /\/appium\/device\/hide_keyboard$/,
];

// Log line regex: [HTTP] --> POST /session/xxx/element/yyy/click {...}
const LOG_LINE_RE = /\[HTTP\]\s+-->\s+(GET|POST|PUT|DELETE|PATCH)\s+(\/session\/[^\s]+?)(?:\s+(.+))?$/;

function parseLogLine(line) {
    const match = line.match(LOG_LINE_RE);
    if (!match) return null;

    const [, method, endpoint, bodyStr] = match;

    // Only care about action-relevant endpoints
    // Strip the /session/:id prefix to match against patterns
    const pathWithoutSession = endpoint.replace(/^\/session\/[^/]+/, "");
    const isAction = ACTION_PATTERNS.some((re) => re.test(pathWithoutSession));
    if (!isAction) return null;

    let params = null;
    if (bodyStr) {
        try {
            params = JSON.parse(bodyStr.trim());
        } catch {
            // body wasn't valid JSON, store as-is
            params = { raw: bodyStr.trim() };
        }
    }

    // Derive action name from the last meaningful path segment
    const segments = pathWithoutSession.split("/").filter(Boolean);
    let action = segments[segments.length - 1];
    // For /element/:id/value, /element/:id/click, etc.
    if (segments.length >= 2 && segments[0] === "element") {
        action = segments[segments.length - 1];
    }

    return { method, endpoint, action, params };
}

async function fetchLogs(sessionId, appiumHost, { throwOnError = false } = {}) {
    try {
        const res = await axios.post(`${appiumHost}/session/${sessionId}/log`, {
            type: "server",
        });
        return res.data.value || [];
    } catch (err) {
        const msg = err.response?.data?.value?.message || err.message || "";
        if (msg.includes("get_server_logs") || msg.includes("insecure feature")) {
            throw new Error(
                "Appium server log access is blocked. " +
                "Start Appium with: appium --allow-insecure=*:get_server_logs"
            );
        }
        if (throwOnError) throw err;
        // During polling, silently skip transient errors
        return [];
    }
}

async function fetchPageSource(sessionId, appiumHost) {
    try {
        const res = await axios.get(`${appiumHost}/session/${sessionId}/source`);
        return res.data.value || "";
    } catch {
        return "";
    }
}

async function pollLogs(sessionId) {
    const state = recordings.get(sessionId);
    if (!state) return;

    const logs = await fetchLogs(sessionId, state.appiumHost);

    // Logs are not cleared between fetches — skip entries we've already seen
    const newLogs = logs.slice(state.logOffset);
    state.logOffset = logs.length;

    for (const entry of newLogs) {
        // entry may be { message: "...", level: "...", timestamp: ... } or just a string
        const message = typeof entry === "string" ? entry : entry.message || "";

        const parsed = parseLogLine(message);
        if (!parsed) continue;

        // Capture page source right after detecting an action
        const pageSource = await fetchPageSource(sessionId, state.appiumHost);

        state.steps.push({
            index: state.stepIndex++,
            timestamp: typeof entry === "object" && entry.timestamp
                ? new Date(entry.timestamp).toISOString()
                : new Date().toISOString(),
            action: parsed.action,
            endpoint: parsed.endpoint,
            params: parsed.params,
            pageSource,
        });
    }
}

export async function startRecording(sessionId, appiumHost) {
    // Stop any existing recording for this session
    if (recordings.has(sessionId)) {
        await stopRecording(sessionId);
    }

    // Fetch existing logs to establish offset baseline (throw if log access is blocked)
    const existingLogs = await fetchLogs(sessionId, appiumHost, { throwOnError: true });

    // Capture initial page source
    const initialPageSource = await fetchPageSource(sessionId, appiumHost);

    const state = {
        appiumHost,
        steps: [],
        stepIndex: 0,
        logOffset: existingLogs.length,
        startedAt: new Date().toISOString(),
        initialPageSource,
        interval: setInterval(() => pollLogs(sessionId), 1000),
    };

    recordings.set(sessionId, state);
}

export async function stopRecording(sessionId) {
    const state = recordings.get(sessionId);
    if (!state) {
        return { steps: [], startedAt: null, stoppedAt: null, initialPageSource: "" };
    }

    clearInterval(state.interval);

    // Do one final poll to catch any remaining logs
    await pollLogs(sessionId);

    const result = {
        startedAt: state.startedAt,
        stoppedAt: new Date().toISOString(),
        initialPageSource: state.initialPageSource,
        steps: state.steps,
    };

    recordings.delete(sessionId);
    return result;
}

export function getRecording(sessionId) {
    const state = recordings.get(sessionId);
    if (!state) return null;
    return {
        startedAt: state.startedAt,
        initialPageSource: state.initialPageSource,
        steps: [...state.steps],
    };
}

export function isRecording(sessionId) {
    return recordings.has(sessionId);
}

// Action name mapping for consolidated output
const ACTION_NAME_MAP = {
    click: "tap",
    value: "type",
    keys: "type",
    actions: "gesture",
    perform: "gesture",
};

/**
 * Consolidates raw steps by merging findElement/findElements with their
 * subsequent action (click, value, clear, keys). Orphaned finds are dropped.
 */
export function consolidateSteps(steps) {
    const consolidated = [];
    let index = 0;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const isFindStep = step.action === "element" || step.action === "elements";

        if (isFindStep) {
            const next = steps[i + 1];
            // If the next step is an action on the found element, merge them
            if (next && next.action !== "element" && next.action !== "elements") {
                const action = ACTION_NAME_MAP[next.action] || next.action;
                const entry = {
                    index: index++,
                    action,
                    locator: step.params
                        ? { strategy: step.params.using, value: step.params.value }
                        : undefined,
                    timestamp: next.timestamp,
                    pageSource: next.pageSource,
                };
                if (action === "type") {
                    entry.text = next.params?.text || next.params?.value || "";
                }
                consolidated.push(entry);
                i++; // skip the next step since we merged it
            }
            // Orphaned find (not followed by an action) — drop it
            continue;
        }

        // Standalone action (back, gesture, etc.) with no preceding find
        const action = ACTION_NAME_MAP[step.action] || step.action;
        const entry = {
            index: index++,
            action,
            timestamp: step.timestamp,
            pageSource: step.pageSource,
        };
        consolidated.push(entry);
    }

    return consolidated;
}

/**
 * Deduplicates page sources across actions and replaces them with compact
 * parsed screen references.
 */
export function deduplicateScreens(actions, initialPageSource, parsePageSourceFn) {
    // Build a fingerprint for deduplication: length + first 500 chars
    function fingerprint(src) {
        if (!src) return "empty";
        return `${src.length}:${src.slice(0, 500)}`;
    }

    const screenMap = new Map(); // fingerprint → screenIndex
    const screens = [];

    function getOrCreateScreen(pageSource) {
        if (!pageSource) return 0; // fallback to first screen
        const fp = fingerprint(pageSource);
        if (screenMap.has(fp)) return screenMap.get(fp);

        const parsed = parsePageSourceFn(pageSource);
        const shortClass = (cls) => cls.split(".").pop();

        // Merge clickable + labeled, dedup by bounds
        const seen = new Set();
        const elements = [];
        for (const el of [...parsed.clickableElements, ...parsed.labeledElements]) {
            const key = `${el.cls}|${el.bounds}`;
            if (seen.has(key)) continue;
            seen.add(key);
            elements.push({
                cls: shortClass(el.cls),
                rid: el.rid,
                text: el.text,
                desc: el.desc,
                bounds: el.bounds,
            });
        }

        const screenIndex = screens.length;
        screens.push({
            screenIndex,
            platform: parsed.platform,
            elements,
        });
        screenMap.set(fp, screenIndex);
        return screenIndex;
    }

    // Process initial page source as screen 0
    if (initialPageSource) {
        getOrCreateScreen(initialPageSource);
    }

    // Replace pageSource on each action with a screenIndex
    const compactActions = actions.map((a) => {
        const screenIndex = getOrCreateScreen(a.pageSource);
        const { pageSource, ...rest } = a;
        return { ...rest, screenIndex };
    });

    return { screens, actions: compactActions };
}
