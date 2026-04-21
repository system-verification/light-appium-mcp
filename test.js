import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePageSource } from './parser.js';
import { consolidateSteps, deduplicateScreens, buildFlow } from './recorder.js';

// --- Test fixtures ---

const ANDROID_PICKER_XML = `<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" displayed="true" bounds="[0,0][1080,2000]">
    <android.widget.TextView class="android.widget.TextView" text="Pick a date" displayed="true" bounds="[0,100][1080,200]" />
    <android.widget.Spinner class="android.widget.Spinner" resource-id="monthPicker" content-desc="monthPicker" displayed="true" clickable="true" bounds="[0,362][518,887]">
      <android.widget.TextView class="android.widget.TextView" resource-id="android:id/text1" text="January" displayed="true" bounds="[0,554][392,695]" />
    </android.widget.Spinner>
    <android.widget.Spinner class="android.widget.Spinner" resource-id="dayPicker" content-desc="dayPicker" displayed="true" clickable="true" bounds="[518,362][1037,887]">
      <android.widget.TextView class="android.widget.TextView" resource-id="android:id/text1" text="1" displayed="true" bounds="[518,554][911,695]" />
    </android.widget.Spinner>
    <android.widget.Button class="android.widget.Button" resource-id="learnMore" content-desc="learnMore" text="Learn More" displayed="true" clickable="true" bounds="[0,939][1080,1043]" />
  </android.widget.FrameLayout>
</hierarchy>`;

const ANDROID_LIST_XML = `<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" displayed="true" bounds="[0,0][1080,2000]">
    <android.widget.TextView class="android.widget.TextView" text="TheApp" displayed="true" bounds="[42,100][204,168]" />
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="Echo Box" content-desc="Echo Box" displayed="true" clickable="true" bounds="[0,210][1080,403]">
      <android.widget.TextView class="android.widget.TextView" resource-id="listItemTitle" text="Echo Box" displayed="true" bounds="[42,252][216,309]" />
    </android.view.ViewGroup>
    <android.view.ViewGroup class="android.view.ViewGroup" resource-id="Login Screen" content-desc="Login Screen" displayed="true" clickable="true" bounds="[0,403][1080,596]">
      <android.widget.TextView class="android.widget.TextView" resource-id="listItemTitle" text="Login Screen" displayed="true" bounds="[42,445][284,502]" />
    </android.view.ViewGroup>
  </android.widget.FrameLayout>
</hierarchy>`;

const ANDROID_DEEP_NESTING_XML = `<hierarchy rotation="0">
  <android.widget.FrameLayout class="android.widget.FrameLayout" displayed="true" bounds="[0,0][1080,2000]">
    <android.widget.LinearLayout class="android.widget.LinearLayout" resource-id="formContainer" content-desc="formContainer" displayed="true" bounds="[0,100][1080,800]">
      <android.widget.RelativeLayout class="android.widget.RelativeLayout" displayed="true" bounds="[0,100][1080,400]">
        <android.widget.EditText class="android.widget.EditText" resource-id="android:id/input" text="Hello" displayed="true" bounds="[50,150][500,250]" />
      </android.widget.RelativeLayout>
    </android.widget.LinearLayout>
  </android.widget.FrameLayout>
</hierarchy>`;

const IOS_XML = `<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="TheApp" label="TheApp" enabled="true" visible="true" x="0" y="0" width="390" height="844">
    <XCUIElementTypeWindow type="XCUIElementTypeWindow" enabled="true" visible="true" x="0" y="0" width="390" height="844">
      <XCUIElementTypeOther type="XCUIElementTypeOther" name="LoginForm" enabled="true" visible="true" x="0" y="100" width="390" height="400">
        <XCUIElementTypeTextField type="XCUIElementTypeTextField" name="" label="Enter username" enabled="true" visible="true" x="20" y="150" width="350" height="44" />
        <XCUIElementTypeButton type="XCUIElementTypeButton" name="loginButton" label="Log In" enabled="true" visible="true" x="20" y="250" width="350" height="44" />
      </XCUIElementTypeOther>
    </XCUIElementTypeWindow>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

// --- Parser tests ---

describe('parsePageSource', () => {
    describe('Android parent hierarchy', () => {
        it('assigns parentRid from Spinner to child TextView', () => {
            const { labeledElements } = parsePageSource(ANDROID_PICKER_XML);
            const january = labeledElements.find(e => e.text === 'January');
            assert.equal(january.parentRid, 'monthPicker');
            assert.equal(january.parentDesc, 'monthPicker');
        });

        it('assigns parentRid from dayPicker Spinner to child TextView', () => {
            const { labeledElements } = parsePageSource(ANDROID_PICKER_XML);
            const day = labeledElements.find(e => e.text === '1');
            assert.equal(day.parentRid, 'dayPicker');
            assert.equal(day.parentDesc, 'dayPicker');
        });

        it('does not assign parentRid to top-level elements', () => {
            const { labeledElements } = parsePageSource(ANDROID_PICKER_XML);
            const header = labeledElements.find(e => e.text === 'Pick a date');
            assert.equal(header.parentRid, '');
            assert.equal(header.parentDesc, '');
        });

        it('does not assign parentRid to elements that ARE the meaningful parent', () => {
            const { clickableElements } = parsePageSource(ANDROID_PICKER_XML);
            const spinner = clickableElements.find(e => e.desc === 'monthPicker');
            assert.equal(spinner.parentRid, '');
        });

        it('assigns parentRid from ViewGroup to child listItemTitle', () => {
            const { labeledElements } = parsePageSource(ANDROID_LIST_XML);
            const echoText = labeledElements.find(e => e.text === 'Echo Box' && e.rid === 'listItemTitle');
            assert.equal(echoText.parentRid, 'Echo Box');
            assert.equal(echoText.parentDesc, 'Echo Box');
        });

        it('skips generic android:id/ rids when walking ancestors', () => {
            const { labeledElements } = parsePageSource(ANDROID_DEEP_NESTING_XML);
            const input = labeledElements.find(e => e.text === 'Hello');
            // Should skip android:id/input and find formContainer
            assert.equal(input.parentRid, 'formContainer');
            assert.equal(input.parentDesc, 'formContainer');
        });
    });

    describe('iOS parent hierarchy', () => {
        it('assigns parentDesc from named container to child elements', () => {
            const { labeledElements } = parsePageSource(IOS_XML);
            const textField = labeledElements.find(e => e.text === 'Enter username');
            assert.equal(textField.parentDesc, 'LoginForm');
        });

        it('assigns parentDesc to button inside named container', () => {
            const { clickableElements } = parsePageSource(IOS_XML);
            const button = clickableElements.find(e => e.desc === 'loginButton');
            assert.equal(button.parentDesc, 'LoginForm');
        });
    });

    describe('platform detection', () => {
        it('detects Android', () => {
            const { platform } = parsePageSource(ANDROID_PICKER_XML);
            assert.equal(platform, 'android');
        });

        it('detects iOS', () => {
            const { platform } = parsePageSource(IOS_XML);
            assert.equal(platform, 'ios');
        });
    });

    describe('self-closing vs opening tags', () => {
        it('handles self-closing tags without polluting the stack', () => {
            // The Learn More button is self-closing (leaf) - it should not affect
            // elements parsed after it
            const xml = `<hierarchy rotation="0">
              <android.widget.FrameLayout class="android.widget.FrameLayout" displayed="true" bounds="[0,0][1080,2000]">
                <android.widget.Button class="android.widget.Button" resource-id="btn1" text="First" displayed="true" clickable="true" bounds="[0,100][100,200]" />
                <android.widget.TextView class="android.widget.TextView" text="After" displayed="true" bounds="[0,300][100,400]" />
              </android.widget.FrameLayout>
            </hierarchy>`;
            const { labeledElements } = parsePageSource(xml);
            const after = labeledElements.find(e => e.text === 'After');
            // "After" should NOT have btn1 as parent (btn1 is self-closing, not a container)
            assert.equal(after.parentRid, '');
        });
    });
});

// --- Recorder: consolidateSteps tests ---

describe('consolidateSteps', () => {
    it('merges findElement + click into tap', () => {
        const steps = [
            { action: 'element', params: { using: 'accessibility id', value: 'loginBtn' }, timestamp: 't1', pageSource: '<xml/>' },
            { action: 'click', params: null, timestamp: 't2', pageSource: '<xml/>' },
        ];
        const result = consolidateSteps(steps);
        assert.equal(result.length, 1);
        assert.equal(result[0].action, 'tap');
        assert.deepEqual(result[0].locator, { strategy: 'accessibility id', value: 'loginBtn' });
    });

    it('merges findElement + value into type with text', () => {
        const steps = [
            { action: 'element', params: { using: 'id', value: 'username' }, timestamp: 't1', pageSource: '<xml/>' },
            { action: 'value', params: { text: 'hello', value: 'hello' }, timestamp: 't2', pageSource: '<xml/>' },
        ];
        const result = consolidateSteps(steps);
        assert.equal(result.length, 1);
        assert.equal(result[0].action, 'type');
        assert.equal(result[0].text, 'hello');
    });

    it('merges findElement + text into verify with text from response', () => {
        const steps = [
            { action: 'element', params: { using: 'id', value: 'label' }, timestamp: 't1', pageSource: '<xml/>' },
            { action: 'text', params: { text: 'Welcome', attributeName: null }, timestamp: 't2', pageSource: '<xml/>' },
        ];
        const result = consolidateSteps(steps);
        assert.equal(result.length, 1);
        assert.equal(result[0].action, 'verify');
        assert.equal(result[0].text, 'Welcome');
        assert.equal(result[0].attributeName, null);
    });

    it('merges findElement + attribute into verify with attributeName', () => {
        const steps = [
            { action: 'element', params: { using: 'id', value: 'toggle' }, timestamp: 't1', pageSource: '<xml/>' },
            { action: 'attribute', params: { text: 'true', attributeName: 'checked' }, timestamp: 't2', pageSource: '<xml/>' },
        ];
        const result = consolidateSteps(steps);
        assert.equal(result.length, 1);
        assert.equal(result[0].action, 'verify');
        assert.equal(result[0].text, 'true');
        assert.equal(result[0].attributeName, 'checked');
    });

    it('drops orphaned findElement steps', () => {
        const steps = [
            { action: 'element', params: { using: 'id', value: 'orphan' }, timestamp: 't1', pageSource: '<xml/>' },
            { action: 'element', params: { using: 'id', value: 'real' }, timestamp: 't2', pageSource: '<xml/>' },
            { action: 'click', params: null, timestamp: 't3', pageSource: '<xml/>' },
        ];
        const result = consolidateSteps(steps);
        assert.equal(result.length, 1);
        assert.deepEqual(result[0].locator, { strategy: 'id', value: 'real' });
    });

    it('keeps standalone actions without preceding find', () => {
        const steps = [
            { action: 'back', params: null, timestamp: 't1', pageSource: '<xml/>' },
        ];
        const result = consolidateSteps(steps);
        assert.equal(result.length, 1);
        assert.equal(result[0].action, 'back');
    });
});

// --- Recorder: deduplicateScreens tests ---

describe('deduplicateScreens', () => {
    it('propagates parentRid and parentDesc to screen elements', () => {
        const actions = [
            { index: 0, action: 'tap', locator: { strategy: '-android uiautomator', value: 'new UiSelector().text("January")' }, pageSource: ANDROID_PICKER_XML },
        ];
        const { screens } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
        const january = screens[0].elements.find(e => e.text === 'January');
        assert.equal(january.parentRid, 'monthPicker');
        assert.equal(january.parentDesc, 'monthPicker');
    });

    it('deduplicates identical page sources into one screen', () => {
        const actions = [
            { index: 0, action: 'tap', pageSource: ANDROID_PICKER_XML },
            { index: 1, action: 'tap', pageSource: ANDROID_PICKER_XML },
        ];
        const { screens, actions: compact } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
        assert.equal(screens.length, 1);
        assert.equal(compact[0].screenIndex, 0);
        assert.equal(compact[1].screenIndex, 0);
    });

    it('creates separate screens for different page sources', () => {
        const actions = [
            { index: 0, action: 'tap', pageSource: ANDROID_PICKER_XML },
            { index: 1, action: 'tap', pageSource: ANDROID_LIST_XML },
        ];
        const { screens } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
        assert.equal(screens.length, 2);
    });
});

// --- Recorder: buildFlow (resolveElementName + full pipeline) tests ---

describe('buildFlow', () => {
    function buildSingleActionFlow(action, xml) {
        const actions = [{ index: 0, ...action, pageSource: xml }];
        const { screens, actions: compact } = deduplicateScreens(actions, xml, parsePageSource);
        return buildFlow(compact, screens).steps[0];
    }

    describe('parent promotion via -android uiautomator', () => {
        it('promotes text("January") to parent monthPicker', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: '-android uiautomator', value: 'new UiSelector().text("January")' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'monthPicker');
            assert.equal(step.value, 'January');
        });

        it('promotes text("1") to parent dayPicker', () => {
            const step = buildSingleActionFlow(
                { action: 'verify', locator: { strategy: '-android uiautomator', value: 'new UiSelector().text("1")' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'dayPicker');
            assert.equal(step.value, '1');
        });

        it('does not promote element with own meaningful resourceId', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: '-android uiautomator', value: 'new UiSelector().resourceId("learnMore")' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'learnMore');
            assert.equal(step.value, undefined);
        });

        it('does not promote text element without a parent', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: '-android uiautomator', value: 'new UiSelector().text("Pick a date")' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'Pick a date');
            assert.equal(step.value, undefined);
        });

        it('promotes generic resourceId("android:id/text1") to parent', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: '-android uiautomator', value: 'new UiSelector().resourceId("android:id/text1")' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'monthPicker');
        });

        it('promotes description to parent when child has parentRid', () => {
            // The monthPicker spinner has desc "monthPicker" and its child has parentRid "monthPicker"
            // But the spinner itself has no parent, so accessing it by desc should not promote
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: '-android uiautomator', value: 'new UiSelector().description("monthPicker")' } },
                ANDROID_PICKER_XML
            );
            // monthPicker itself has no meaningful parent
            assert.equal(step.elementName, 'monthPicker');
        });
    });

    describe('parent promotion via id strategy', () => {
        it('promotes generic android:id/text1 to parent monthPicker', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: 'id', value: 'android:id/text1' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'monthPicker');
            assert.equal(step.value, 'January');
        });

        it('does not promote meaningful rid like learnMore', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: 'id', value: 'learnMore' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'learnMore');
            assert.equal(step.value, undefined);
        });
    });

    describe('parent promotion via accessibility id', () => {
        it('resolves element with own rid by accessibility id without promotion', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: 'accessibility id', value: 'monthPicker' } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'monthPicker');
        });

        it('resolves element with own rid (Echo Box ViewGroup) without promotion', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: 'accessibility id', value: 'Echo Box' } },
                ANDROID_LIST_XML
            );
            assert.equal(step.elementName, 'Echo Box');
        });
    });

    describe('parent promotion via xpath strategy', () => {
        it('promotes xpath text match to parent when element has no own rid', () => {
            const step = buildSingleActionFlow(
                { action: 'verify', locator: { strategy: 'xpath', value: "//android.widget.TextView[@text='January']" } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'monthPicker');
            assert.equal(step.value, 'January');
        });

        it('does not promote xpath match when element has own meaningful rid', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: 'xpath', value: "//android.widget.Button[@resource-id='learnMore']" } },
                ANDROID_PICKER_XML
            );
            assert.equal(step.elementName, 'learnMore');
            assert.equal(step.value, undefined);
        });
    });

    describe('parent promotion via iOS predicate string', () => {
        it('promotes child label match to parent container name', () => {
            const step = buildSingleActionFlow(
                { action: 'tap', locator: { strategy: '-ios predicate string', value: "label == 'Enter username'" } },
                IOS_XML
            );
            assert.equal(step.elementName, 'LoginForm');
            assert.equal(step.value, 'Enter username');
        });
    });

    describe('value precedence', () => {
        it('action.text takes precedence over childValue', () => {
            const actions = [{
                index: 0,
                action: 'verify',
                text: 'ResponseText',
                locator: { strategy: '-android uiautomator', value: 'new UiSelector().text("January")' },
                pageSource: ANDROID_PICKER_XML,
            }];
            const { screens, actions: compact } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
            const step = buildFlow(compact, screens).steps[0];
            assert.equal(step.elementName, 'monthPicker');
            assert.equal(step.value, 'ResponseText');
        });

        it('childValue used as fallback when action.text is empty', () => {
            const actions = [{
                index: 0,
                action: 'verify',
                text: '',
                locator: { strategy: '-android uiautomator', value: 'new UiSelector().text("January")' },
                pageSource: ANDROID_PICKER_XML,
            }];
            const { screens, actions: compact } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
            const step = buildFlow(compact, screens).steps[0];
            assert.equal(step.elementName, 'monthPicker');
            assert.equal(step.value, 'January');
        });
    });

    describe('screen transitions', () => {
        it('detects navigatesTo when screen changes between actions', () => {
            const actions = [
                { index: 0, action: 'tap', locator: { strategy: 'accessibility id', value: 'Echo Box' }, pageSource: ANDROID_LIST_XML },
                { index: 1, action: 'tap', locator: { strategy: 'accessibility id', value: 'monthPicker' }, pageSource: ANDROID_PICKER_XML },
            ];
            const { screens, actions: compact } = deduplicateScreens(actions, ANDROID_LIST_XML, parsePageSource);
            const flow = buildFlow(compact, screens);
            assert.equal(flow.steps[0].navigatesTo, flow.steps[1].screen);
        });

        it('does not add navigatesTo when screen stays the same', () => {
            const actions = [
                { index: 0, action: 'tap', locator: { strategy: 'accessibility id', value: 'monthPicker' }, pageSource: ANDROID_PICKER_XML },
                { index: 1, action: 'tap', locator: { strategy: 'accessibility id', value: 'learnMore' }, pageSource: ANDROID_PICKER_XML },
            ];
            const { screens, actions: compact } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
            const flow = buildFlow(compact, screens);
            assert.equal(flow.steps[0].navigatesTo, undefined);
        });
    });

    describe('screen name detection', () => {
        it('names screen by topmost TextView text', () => {
            const actions = [{ index: 0, action: 'tap', pageSource: ANDROID_PICKER_XML }];
            const { screens, actions: compact } = deduplicateScreens(actions, ANDROID_PICKER_XML, parsePageSource);
            const flow = buildFlow(compact, screens);
            assert.equal(flow.steps[0].screen, 'Pick a date');
        });
    });

    describe('flow deduplication', () => {
        it('removes repeated action sequences', () => {
            // Create a flow with 3-step repeated pattern (need 6+ steps)
            const xml = ANDROID_PICKER_XML;
            const actions = [];
            for (let i = 0; i < 6; i++) {
                actions.push({
                    index: i,
                    action: i % 3 === 0 ? 'tap' : i % 3 === 1 ? 'type' : 'tap',
                    locator: { strategy: 'accessibility id', value: i % 3 === 0 ? 'monthPicker' : i % 3 === 1 ? 'dayPicker' : 'learnMore' },
                    text: i % 3 === 1 ? 'text' : undefined,
                    pageSource: xml,
                });
            }
            const { screens, actions: compact } = deduplicateScreens(actions, xml, parsePageSource);
            const flow = buildFlow(compact, screens);
            // Should deduplicate from 6 steps (2x3 pattern) to 3
            assert.equal(flow.steps.length, 3);
            assert.deepEqual(flow.deduplication, { removedActions: 3 });
        });

        it('does not deduplicate when fewer than 6 steps', () => {
            const xml = ANDROID_PICKER_XML;
            const actions = [
                { index: 0, action: 'tap', locator: { strategy: 'accessibility id', value: 'monthPicker' }, pageSource: xml },
                { index: 1, action: 'tap', locator: { strategy: 'accessibility id', value: 'learnMore' }, pageSource: xml },
            ];
            const { screens, actions: compact } = deduplicateScreens(actions, xml, parsePageSource);
            const flow = buildFlow(compact, screens);
            assert.equal(flow.steps.length, 2);
            assert.equal(flow.deduplication, null);
        });
    });
});

// --- Integration: full recording scenario ---

describe('integration: Picker Demo recording', () => {
    it('produces correct flow for Spinner interaction', () => {
        // Simulate: tap monthPicker, verify text, select from dropdown
        const pickerXml = ANDROID_PICKER_XML;
        const dropdownXml = `<hierarchy rotation="0">
          <android.widget.FrameLayout class="android.widget.FrameLayout" displayed="true" bounds="[0,0][1080,2000]">
            <android.widget.CheckedTextView class="android.widget.CheckedTextView" resource-id="android:id/text1" text="January" displayed="true" bounds="[70,354][1010,495]" />
            <android.widget.CheckedTextView class="android.widget.CheckedTextView" resource-id="android:id/text1" text="February" displayed="true" bounds="[70,495][1010,636]" />
            <android.widget.CheckedTextView class="android.widget.CheckedTextView" resource-id="android:id/text1" text="March" displayed="true" bounds="[70,636][1010,777]" />
          </android.widget.FrameLayout>
        </hierarchy>`;
        // After selecting February, the picker page source reflects the new value
        const pickerAfterSelectXml = ANDROID_PICKER_XML.replace('text="January"', 'text="February"');

        const rawSteps = [
            // find monthPicker + click (opens dropdown)
            { action: 'element', params: { using: '-android uiautomator', value: 'new UiSelector().text("January")' }, timestamp: 't1', pageSource: pickerXml },
            { action: 'click', params: null, timestamp: 't2', pageSource: pickerXml },
            // find February in dropdown + click (selects it)
            { action: 'element', params: { using: '-android uiautomator', value: 'new UiSelector().text("February")' }, timestamp: 't3', pageSource: dropdownXml },
            { action: 'click', params: null, timestamp: 't4', pageSource: dropdownXml },
            // verify month changed — Appium uses the spinner's accessibility id for getText
            { action: 'element', params: { using: 'accessibility id', value: 'monthPicker' }, timestamp: 't5', pageSource: pickerAfterSelectXml },
            { action: 'text', params: { text: 'February', attributeName: null }, timestamp: 't6', pageSource: pickerAfterSelectXml },
        ];

        const consolidated = consolidateSteps(rawSteps);
        assert.equal(consolidated.length, 3);
        assert.equal(consolidated[0].action, 'tap');
        assert.equal(consolidated[1].action, 'tap');
        assert.equal(consolidated[2].action, 'verify');

        const { screens, actions } = deduplicateScreens(consolidated, pickerXml, parsePageSource);
        const flow = buildFlow(actions, screens);

        // Step 1: tap monthPicker (resolved from "January" text in spinner)
        assert.equal(flow.steps[0].action, 'tap');
        assert.equal(flow.steps[0].elementName, 'monthPicker');
        assert.equal(flow.steps[0].value, 'January');

        // Step 2: tap February in dropdown (no meaningful parent in flat dropdown)
        assert.equal(flow.steps[1].action, 'tap');
        assert.equal(flow.steps[1].elementName, 'February');

        // Step 3: verify monthPicker shows "February" (text from response)
        assert.equal(flow.steps[2].action, 'verify');
        assert.equal(flow.steps[2].elementName, 'monthPicker');
        assert.equal(flow.steps[2].value, 'February');
    });
});
