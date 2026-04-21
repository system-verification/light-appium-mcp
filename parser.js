// ----------------------------------------------------------------
// Copyright (c) 2026 System Verification Sweden AB.
// Licensed under the Apache License, Version 2.0
// See LICENSE in the project root for license information.
// ----------------------------------------------------------------

/**
 * Detects whether the XML page source is from Android or iOS.
 * @param {string} xml - Raw XML page source from Appium.
 * @returns {'android' | 'ios'}
 */
function detectPlatform(xml) {
    if (/XCUIElementType/.test(xml)) return 'ios';
    return 'android';
}

/**
 * Extracts a normalized element from Android XML attributes.
 */
function parseAndroidElement(tag, attrs) {
    if (!/displayed="true"/.test(attrs)) return null;

    const cls = attrs.match(/class="([^"]+)"/)?.[1] || '';
    const rid = attrs.match(/resource-id="([^"]*)"/)?.[1] || '';
    const desc = attrs.match(/content-desc="([^"]*)"/)?.[1] || '';
    const text = attrs.match(/text="([^"]*)"/)?.[1] || '';
    const bounds = attrs.match(/bounds="([^"]*)"/)?.[1] || '';
    const clickable = /clickable="true"/.test(attrs);
    const isButton = /Button|FloatingActionButton/.test(cls);

    return { tag, cls, rid, desc, text, bounds, clickable, isButton };
}

/**
 * Extracts a normalized element from iOS XML attributes.
 */
function parseIOSElement(tag, attrs) {
    if (!/visible="true"/.test(attrs)) return null;

    const type = attrs.match(/type="([^"]+)"/)?.[1] || '';
    const name = attrs.match(/name="([^"]*)"/)?.[1] || '';
    const label = attrs.match(/label="([^"]*)"/)?.[1] || '';
    const value = attrs.match(/value="([^"]*)"/)?.[1] || '';
    const x = attrs.match(/x="(\d+)"/)?.[1] || '0';
    const y = attrs.match(/y="(\d+)"/)?.[1] || '0';
    const width = attrs.match(/width="(\d+)"/)?.[1] || '0';
    const height = attrs.match(/height="(\d+)"/)?.[1] || '0';
    const bounds = `[${x},${y}][${+x + +width},${+y + +height}]`;
    const isButton = /Button|Cell|Link/.test(type);
    const enabled = /enabled="true"/.test(attrs);

    return { tag, cls: type, rid: '', desc: name, text: label || value, bounds, clickable: enabled && isButton, isButton };
}

/**
 * Checks whether a resource-id is a meaningful app-level identifier
 * (not a generic Android/iOS system id).
 */
function isMeaningfulRid(rid) {
    if (!rid) return false;
    if (rid.startsWith('android:id/')) return false;
    return true;
}

/**
 * Finds the nearest ancestor with a meaningful identifier from the stack.
 * @param {Array<{rid: string, desc: string}>} stack - Ancestor stack.
 * @param {string} platform - 'android' or 'ios'
 * @returns {{ parentRid: string, parentDesc: string }}
 */
function findMeaningfulAncestor(stack, platform) {
    for (let i = stack.length - 1; i >= 0; i--) {
        const ancestor = stack[i];
        if (platform === 'android' && isMeaningfulRid(ancestor.rid)) {
            return { parentRid: ancestor.rid, parentDesc: ancestor.desc };
        }
        if (platform === 'ios' && ancestor.desc) {
            return { parentRid: '', parentDesc: ancestor.desc };
        }
    }
    return { parentRid: '', parentDesc: '' };
}

/**
 * Parses page source XML (Android or iOS) and extracts interactive/labeled elements with XPath suggestions.
 * Uses stack-based parsing to preserve parent-child hierarchy information.
 * @param {string} xml - Raw XML page source from Appium.
 * @returns {{ platform: string, clickableElements: object[], labeledElements: object[], xpathSuggestions: string[] }}
 */
export function parsePageSource(xml) {
    const platform = detectPlatform(xml);
    const tagRe = /<(\/?)([^\s/>]+)(?:\s([^>]*?))?\s*(\/?)>/g;
    let m;
    const labeledElements = [];
    const clickableElements = [];
    const stack = []; // ancestor elements for hierarchy tracking: { rid, desc }

    while ((m = tagRe.exec(xml)) !== null) {
        const [, closing, tag, attrs, selfClosing] = m;

        if (closing) {
            stack.pop();
            continue;
        }

        const el = platform === 'ios'
            ? parseIOSElement(tag, attrs || '')
            : parseAndroidElement(tag, attrs || '');

        // Find nearest meaningful ancestor for this element
        const { parentRid, parentDesc } = findMeaningfulAncestor(stack, platform);

        if (el) {
            el.parentRid = parentRid;
            el.parentDesc = parentDesc;

            if (el.clickable || el.isButton) {
                clickableElements.push(el);
            }
            if (el.text || el.desc) {
                labeledElements.push(el);
            }
        }

        if (!selfClosing) {
            // Opening tag — push to stack for hierarchy tracking
            // Extract rid/desc from attrs directly (even if element wasn't parsed)
            const stackRid = el?.rid || (attrs?.match(/resource-id="([^"]*)"/)?.[1]) || '';
            const stackDesc = el?.desc || (attrs?.match(/content-desc="([^"]*)"/)?.[1]) || '';
            stack.push({ rid: stackRid, desc: stackDesc });
        }
    }

    const xpathSuggestions = clickableElements.map((b) => {
        const shortCls = b.cls.split('.').pop();
        let xpath = '';

        if (platform === 'ios') {
            if (b.desc) {
                xpath = `//${shortCls}[@name='${b.desc}']`;
            } else if (b.text) {
                xpath = `//${shortCls}[@label='${b.text}']`;
            }
        } else {
            if (b.rid) {
                xpath = `//${shortCls}[@resource-id='${b.rid}']`;
            } else if (b.desc) {
                xpath = `//${shortCls}[@content-desc='${b.desc}']`;
            } else if (b.text) {
                xpath = `//${shortCls}[@text='${b.text}']`;
            }
        }

        if (!xpath) {
            const parentBounds = b.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
            if (parentBounds) {
                const [, px1, py1, px2, py2] = parentBounds.map(Number);
                const childLabel = labeledElements.find(l => {
                    if (!l.text || l.cls === b.cls) return false;
                    const cb = l.bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
                    if (!cb) return false;
                    const [, cx1, cy1, cx2, cy2] = cb.map(Number);
                    return cx1 >= px1 && cy1 >= py1 && cx2 <= px2 && cy2 <= py2;
                });
                if (childLabel) {
                    const childShortCls = childLabel.cls.split('.').pop();
                    const textAttr = platform === 'ios' ? 'label' : 'text';
                    xpath = `//${shortCls}[.//${childShortCls}[@${textAttr}='${childLabel.text}']]`;
                }
            }
        }

        if (!xpath) return null;
        const label = b.desc || b.text || '(anonymous)';
        return `${label}: ${xpath}`;
    }).filter(Boolean);

    return { platform, clickableElements, labeledElements, xpathSuggestions };
}

/**
 * Formats parsed page source results into a human/LLM-readable text report.
 * @param {object} params
 * @param {string} params.platform - 'android' or 'ios'
 * @param {object[]} params.clickableElements
 * @param {object[]} params.labeledElements
 * @param {string[]} params.xpathSuggestions
 * @param {string} params.description - Element search description
 * @param {string[]} params.strategies - Preferred locator strategies
 * @param {string} params.source - Raw XML page source
 * @returns {string}
 */
export function formatLocatorReport({ platform, clickableElements, labeledElements, xpathSuggestions, description, strategies, source }) {
    const sections = [];
    sections.push(`Platform: ${platform}`);
    sections.push(`Find element matching: "${description}"`);
    sections.push(`Preferred locator strategies: ${strategies.join(", ")}`);

    sections.push('\n=== CLICKABLE ELEMENTS ===\n');
    if (platform === 'ios') {
        clickableElements.forEach((b, i) => {
            sections.push(`${i + 1}. ${b.cls}`);
            sections.push(`   Name (accessibility id): ${b.desc}`);
            sections.push(`   Label: ${b.text}`);
            sections.push(`   Bounds: ${b.bounds}`);
            sections.push('');
        });
    } else {
        clickableElements.forEach((b, i) => {
            sections.push(`${i + 1}. ${b.cls}`);
            sections.push(`   Resource ID: ${b.rid}`);
            sections.push(`   Content Desc: ${b.desc}`);
            sections.push(`   Text: ${b.text}`);
            sections.push(`   Bounds: ${b.bounds}`);
            sections.push('');
        });
    }

    sections.push('=== LABELED ELEMENTS ===\n');
    if (platform === 'ios') {
        labeledElements.forEach((b) => {
            sections.push(`${b.cls} | label="${b.text}" | name="${b.desc}" | bounds=${b.bounds}`);
        });
    } else {
        labeledElements.forEach((b) => {
            sections.push(`${b.cls} | text="${b.text}" | desc="${b.desc}" | bounds=${b.bounds}`);
        });
    }

    sections.push('\n=== XPATH SUGGESTIONS ===\n');
    xpathSuggestions.forEach((s) => sections.push(s));

    sections.push('\n=== RAW PAGE SOURCE XML ===\n');
    sections.push(source);

    return sections.join('\n');
}
