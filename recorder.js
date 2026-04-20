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

    // The log buffer is capped (e.g., 3000 entries) and rotates — offset-based
    // slicing doesn't work. Instead, find new entries by timestamp comparison.
    let newLogs;
    if (state.lastSeenTimestamp == null) {
        // No baseline timestamp — treat all as new (shouldn't normally happen)
        newLogs = logs;
    } else {
        // Find the index of the first entry AFTER our last seen timestamp
        let startIdx = logs.length; // default: nothing new
        for (let i = logs.length - 1; i >= 0; i--) {
            const ts = typeof logs[i] === "object" ? logs[i].timestamp : null;
            if (ts != null && ts <= state.lastSeenTimestamp) {
                startIdx = i + 1;
                break;
            }
        }
        newLogs = logs.slice(startIdx);
    }

    // Update the marker to the latest entry's timestamp
    if (logs.length > 0) {
        const lastEntry = logs[logs.length - 1];
        const ts = typeof lastEntry === "object" ? lastEntry.timestamp : null;
        if (ts != null) state.lastSeenTimestamp = ts;
    }


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

    // Fetch existing logs to establish baseline (throw if log access is blocked)
    const existingLogs = await fetchLogs(sessionId, appiumHost, { throwOnError: true });

    // Capture initial page source
    const initialPageSource = await fetchPageSource(sessionId, appiumHost);

    // Use the last log entry's timestamp as our marker for detecting new entries,
    // since the log buffer is capped and offset-based slicing won't work.
    const lastEntry = existingLogs.length > 0 ? existingLogs[existingLogs.length - 1] : null;
    const lastTimestamp = lastEntry && typeof lastEntry === "object" ? lastEntry.timestamp : null;

    const state = {
        appiumHost,
        steps: [],
        stepIndex: 0,
        lastSeenTimestamp: lastTimestamp,
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

// --- Flow building: high-level summary with element names, screen names, deduplication ---

/**
 * Resolves a human-readable element name from a locator
 * by matching against the screen's element list.
 */
function resolveElementName(locator, screenElements) {
    if (!locator || !screenElements?.length) return null;

    const { strategy, value } = locator;
    const bestName = (el) => el.desc || el.text || el.rid || null;

    if (strategy === "accessibility id") {
        const match = screenElements.find((e) => e.desc === value || e.rid === value);
        return match ? bestName(match) : value;
    }

    if (strategy === "id") {
        const match = screenElements.find((e) => e.rid === value);
        return match ? bestName(match) : value.split("/").pop();
    }

    if (strategy === "-android uiautomator") {
        const textMatch = value.match(/\.text\("([^"]+)"\)/);
        if (textMatch) return textMatch[1];
        const descMatch = value.match(/description\("([^"]+)"\)/);
        if (descMatch) return descMatch[1];
        const ridMatch = value.match(/resourceId\("([^"]+)"\)/);
        if (ridMatch) {
            const match = screenElements.find((e) => e.rid === ridMatch[1]);
            return match ? bestName(match) : ridMatch[1];
        }
        return null;
    }

    if (strategy === "xpath") {
        const attrMatch = value.match(
            /@(?:text|content-desc|name|label|resource-id)='([^']+)'/
        );
        return attrMatch ? attrMatch[1] : null;
    }

    if (strategy === "-ios predicate string") {
        const nameMatch = value.match(/name\s*==\s*['"]([^'"]+)['"]/);
        const labelMatch = value.match(/label\s*==\s*['"]([^'"]+)['"]/);
        return nameMatch?.[1] || labelMatch?.[1] || null;
    }

    return null;
}

/**
 * Finds which screen an action's locator best matches by checking
 * if any screen's elements contain a matching identifier.
 */
function matchActionToScreen(locator, screens) {
    if (!locator) return -1;

    const { strategy, value } = locator;

    for (const screen of screens) {
        for (const el of screen.elements) {
            if (strategy === "accessibility id" && (el.desc === value || el.rid === value))
                return screen.screenIndex;
            if (strategy === "id" && el.rid === value)
                return screen.screenIndex;

            if (strategy === "-android uiautomator") {
                const ridMatch = value.match(/resourceId\("([^"]+)"\)/);
                const textMatch = value.match(/\.text\("([^"]+)"\)/);
                const descMatch = value.match(/description\("([^"]+)"\)/);
                if (ridMatch && el.rid === ridMatch[1]) return screen.screenIndex;
                if (textMatch && el.text === textMatch[1]) return screen.screenIndex;
                if (descMatch && el.desc === descMatch[1]) return screen.screenIndex;
            }

            if (strategy === "-ios predicate string") {
                const nameMatch = value.match(/name\s*==\s*['"]([^'"]+)['"]/);
                const labelMatch = value.match(/label\s*==\s*['"]([^'"]+)['"]/);
                if (nameMatch && el.desc === nameMatch[1]) return screen.screenIndex;
                if (labelMatch && el.text === labelMatch[1]) return screen.screenIndex;
            }
        }
    }

    return -1;
}

/**
 * Detects a screen name from its elements by finding
 * the topmost text element (likely the header/title).
 */
function detectScreenName(screen) {
    if (!screen?.elements?.length) return null;

    const candidates = screen.elements
        .filter((e) => e.text && /TextView|Text|StaticText/.test(e.cls))
        .map((e) => {
            const m = e.bounds.match(/\[\d+,(\d+)\]/);
            return { text: e.text, y: m ? parseInt(m[1]) : Infinity };
        })
        .sort((a, b) => a.y - b.y);

    return candidates[0]?.text || null;
}

/**
 * Removes repeated action sequences from the flow.
 * Matches on action+elementName signature (ignores typed values).
 */
function deduplicateFlow(flow, depth = 0) {
    if (flow.length < 6 || depth > 10) return { flow, removedCount: 0 };

    const sig = (f) => `${f.action}|${f.elementName || ""}`;

    for (let len = Math.min(15, Math.floor(flow.length / 2)); len >= 3; len--) {
        for (let start = 0; start <= flow.length - len * 2; start++) {
            const pattern = [];
            for (let k = 0; k < len; k++) pattern.push(sig(flow[start + k]));

            let repeats = 1;
            let pos = start + len;
            while (pos + len <= flow.length) {
                let matches = true;
                for (let k = 0; k < len; k++) {
                    if (sig(flow[pos + k]) !== pattern[k]) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    repeats++;
                    pos += len;
                } else {
                    break;
                }
            }

            if (repeats >= 2) {
                const removed = (repeats - 1) * len;
                const before = flow.slice(0, start);
                const kept = flow.slice(start, start + len);
                const after = flow.slice(start + len * repeats);
                const result = deduplicateFlow([...before, ...kept, ...after], depth + 1);
                return {
                    flow: result.flow,
                    removedCount: removed + result.removedCount,
                };
            }
        }
    }

    return { flow, removedCount: 0 };
}

/**
 * Builds a high-level flow summary from consolidated actions and screens.
 * Resolves element names, detects screen names/transitions, and deduplicates.
 */
export function buildFlow(actions, screens) {
    // Name each screen by its topmost text element
    const screenNames = screens.map((s) => detectScreenName(s) || `Screen ${s.screenIndex}`);

    // Resolve screen assignment and element names for each action
    const enriched = actions.map((action) => {
        let screenIdx = action.screenIndex;
        if (action.locator) {
            const matched = matchActionToScreen(action.locator, screens);
            if (matched >= 0) screenIdx = matched;
        }

        const screen = screens[screenIdx];
        const elementName = resolveElementName(action.locator, screen?.elements);

        const entry = { action: action.action, screen: screenNames[screenIdx] };
        if (elementName) entry.elementName = elementName;
        if (action.text) entry.value = action.text;
        return entry;
    });

    // Detect screen transitions
    for (let i = 0; i < enriched.length - 1; i++) {
        if (enriched[i + 1].screen !== enriched[i].screen) {
            enriched[i].navigatesTo = enriched[i + 1].screen;
        }
    }

    // Deduplicate repeated sequences
    const { flow, removedCount } = deduplicateFlow(enriched);

    return {
        screenNames: screenNames.map((name, i) => ({ screenIndex: i, name })),
        steps: flow,
        deduplication: removedCount > 0 ? { removedActions: removedCount } : null,
    };
}
