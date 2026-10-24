/**
 * Render the two halves of the browser plugin against a tiny hook-capable React
 * stub, then drive the real click path and assert what the user would see.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

//#region environment
const fetchCalls = [];
let hostAnswer = {
	answer: '**piece of cake**\nIPA: /piːs əv keɪk/\n\n**In this passage**\nMeaning: It means the test was very easy.\n\n**In general**\nMeaning: It means something is very easy to do.\n\nExample: The quiz was a piece of cake.\nExample: The job was a piece of cake.'
};
const spoken = [];
const clipboard = { text: "under the weather" };
const MODEL = { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "max" };
const SESSION_ID = "session-test";
let selectionMode = "word";
let selectionText = "piece of cake";
let blockText = "This is a piece of cake.";
const listeners = new Map();
const on = (key, fn) => {
	const list = listeners.get(key) ?? [];
	list.push(fn);
	listeners.set(key, list);
};
const dispatch = (key, event) => (listeners.get(key) ?? []).forEach((fn) => fn(event));

class Element {
	closest() {
		return null;
	}
}
class Node {}

const rangeNode = Object.assign(new Element(), {
	nodeType: 1,
	get innerText() {
		return blockText;
	},
	get textContent() {
		return blockText;
	}
});
const rect = {
	left: 300,
	top: 200,
	right: 420,
	bottom: 220,
	width: 120,
	height: 20
};

const window = {
	innerWidth: 1280,
	innerHeight: 800,
	requestAnimationFrame: () => 1,
	cancelAnimationFrame: () => {},
	setTimeout: (fn) => setTimeout(fn, 0),
	clearTimeout: (id) => clearTimeout(id),
	addEventListener: (type, fn) => on("w:" + type, fn),
	removeEventListener: () => {},
	speechSynthesis: {
		paused: false,
		cancel() {},
		pause() {},
		resume() {},
		getVoices: () => [],
		speak: (utterance) => spoken.push(utterance.text)
	},
	SpeechSynthesisUtterance: class {
		constructor(text) {
			this.text = text;
		}
	},
	getSelection: () => {
		if (selectionMode === "none") {
			return {
				rangeCount: 0,
				isCollapsed: true,
				toString: () => "",
				anchorNode: null,
				focusNode: null,
				getRangeAt: () => {
					throw new Error("no range");
				}
			};
		}
		return {
			rangeCount: 1,
			isCollapsed: false,
			toString: () => selectionText,
			anchorNode: rangeNode,
			focusNode: rangeNode,
			getRangeAt: () => ({
				commonAncestorContainer: rangeNode,
				getClientRects: () => [rect],
				getBoundingClientRect: () => rect
			})
		};
	}
};
const document = {
	querySelector: () => ({}),
	createElement: () => ({ dataset: {} }),
	head: { appendChild() {} },
	addEventListener: (type, fn) => on("d:" + type, fn),
	removeEventListener: () => {}
};
const navigator = { clipboard: { readText: async () => clipboard.text } };
//#endregion

//#region react stub
let current = null;
const deps = (a, b) => a !== void 0 && b !== void 0 && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
const react = {
	useState(initial) {
		const inst = current;
		const index = inst.cursor++;
		if (inst.hooks[index] === void 0) inst.hooks[index] = typeof initial === "function" ? initial() : initial;
		return [inst.hooks[index], (next) => {
			const value = typeof next === "function" ? next(inst.hooks[index]) : next;
			if (Object.is(value, inst.hooks[index])) return;
			inst.hooks[index] = value;
			inst.dirty = true;
		}];
	},
	useRef(initial) {
		const inst = current;
		const index = inst.cursor++;
		if (inst.hooks[index] === void 0) inst.hooks[index] = { current: initial };
		return inst.hooks[index];
	},
	useCallback(fn, list) {
		const inst = current;
		const index = inst.cursor++;
		const previous = inst.hooks[index];
		if (previous !== void 0 && deps(previous.deps, list)) return previous.fn;
		inst.hooks[index] = { fn, deps: list };
		return fn;
	},
	useEffect(fn, list) {
		const inst = current;
		const index = inst.cursor++;
		const previous = inst.hooks[index];
		if (previous !== void 0 && deps(previous.deps, list)) return;
		inst.hooks[index] = { fn, deps: list, cleanup: previous === void 0 ? void 0 : previous.cleanup };
		inst.pending.push(index);
	},
	createElement(type, props, ...children) {
		const flat = [];
		const push = (value) => {
			if (Array.isArray(value)) value.forEach(push);
			else flat.push(value);
		};
		children.forEach(push);
		return { type, props: props ?? {}, children: flat };
	},
	Fragment: "Fragment"
};
function mount(component, props) {
	const inst = { component, props, hooks: [], cursor: 0, pending: [], dirty: true, tree: null };
	return inst;
}
function flush(inst) {
	let guard = 0;
	while ((inst.dirty || inst.pending.length > 0) && guard++ < 200) {
		inst.dirty = false;
		inst.cursor = 0;
		current = inst;
		const tree = inst.component(inst.props);
		const pending = inst.pending;
		inst.pending = [];
		current = null;
		inst.tree = tree;
		for (const index of pending) {
			const hook = inst.hooks[index];
			if (typeof hook.cleanup === "function") hook.cleanup();
			const cleanup = hook.fn();
			hook.cleanup = typeof cleanup === "function" ? cleanup : void 0;
		}
	}
	assert.ok(guard < 200, "component did not settle");
}
function expand(node) {
	if (node === null || node === void 0 || node === true || node === false) return null;
	if (Array.isArray(node)) return node.map(expand).filter((value) => value !== null);
	if (typeof node === "string" || typeof node === "number") return String(node);
	if (typeof node.type === "function") return expand(node.type(node.props));
	return {
		type: node.type,
		props: node.props,
		children: node.children.map(expand).filter((value) => value !== null)
	};
}
function findAll(node, test, found = []) {
	if (node === null || typeof node === "string") return found;
	if (test(node)) found.push(node);
	node.children.forEach((child) => findAll(child, test, found));
	return found;
}
const byClass = (name) => (node) => typeof node.props.className === "string" && node.props.className.split(" ").includes(name);
const textOf = (node) => {
	if (typeof node === "string") return node;
	return node.children.map(textOf).join("");
};
//#endregion

//#region load the plugin
let factory = null;
window.__ModuleLoader__ = { load: (definition) => { factory = definition.factory; } };
const source = fs.readFileSync("lib/client.js", "utf8");
new Function("window", "document", "navigator", "Element", "Node", "fetch", "AbortController", source)(
	window,
	document,
	navigator,
	Element,
	Node,
	async (url, options) => {
		fetchCalls.push({ url, body: JSON.parse(options.body) });
		return {
			ok: true,
			json: async () => hostAnswer
		};
	},
	AbortController
);
const exportsObject = factory((name) => {
	assert.equal(name, "react");
	return react;
});
const registered = {};
exportsObject.apply({
	effect: (fn) => fn(),
	locale: { register: () => {} },
	slots: {
		inject: (_key, fn) => fn(),
		register: (declaration, component) => {
			registered[declaration.id] = { declaration, component };
			return () => {};
		}
	}
});
assert.deepEqual(Object.keys(registered).sort(), ["word-lookup", "word-lookup-tools"]);
//#endregion

//#region drive the real path
// The overlay must mount first: it owns the bridge the composer calls.
const overlay = mount(registered["word-lookup"].component, { t: (key) => key });
flush(overlay);
assert.equal(overlay.tree, null, "nothing renders before a click");

const composer = mount(registered["word-lookup-tools"].component, { t: (key) => key, modelSelection: () => MODEL, sessionId: SESSION_ID });
flush(composer);
const trigger = expand(composer.tree);
assert.equal(trigger.props["data-dsh-speak-trigger"], "1");
assert.equal(trigger.props["aria-haspopup"], "dialog");

const clickTrigger = async () => {
	await trigger.props.onClick({
		preventDefault() {},
		currentTarget: {
			getBoundingClientRect: () => ({ left: 640, top: 700, right: 664, bottom: 724, width: 24, height: 24 })
		}
	});
	flush(overlay);
};
const settle = async () => {
	await new Promise((resolve) => setTimeout(resolve, 5));
	flush(overlay);
};
const panelNow = () => findAll(expand(overlay.tree), byClass("dshSpeak_panel"))[0];
const inputNow = () => findAll(expand(overlay.tree), (node) => node.type === "textarea")[0];
const explainNow = () => findAll(expand(overlay.tree), (node) => node.props["data-dsh-speak-explain"] === "1")[0];
const close = async () => {
	dispatch("d:keyup", { key: "Escape" });
	flush(overlay);
	await settle();
};

// A selected idiom is put back into its sentence, with the selection bracketed.
await clickTrigger();
let panel = panelNow();
assert.ok(panel, "the lookup panel opens");
assert.equal(textOf(findAll(panel, byClass("dshSpeak_hint"))[0]), "hint");
let textarea = inputNow();
assert.equal(textarea.props.value, "This is a <piece of cake>.");
assert.equal(textarea.props.rows, 2);
assert.equal(panel.props.style.bottom, "106px", "a low anchor is placed by its bottom edge");
assert.equal(panel.props.style.top, void 0);
assert.equal(panel.props.style.maxHeight, "686px");

// Explain asks the Host with the whole sentence, and the skill answer is rendered.
await explainNow().props.onClick();
flush(overlay);
await settle();
assert.equal(fetchCalls.length, 1);
assert.equal(fetchCalls[0].url, "/word-lookup/explain");
assert.deepEqual(fetchCalls[0].body, { input: "This is a <piece of cake>.", model: MODEL, sessionId: SESSION_ID });
panel = panelNow();
let answer = findAll(panel, byClass("dshSpeak_answer"))[0];
assert.ok(answer, "the answer area opens under the box");
assert.match(textOf(answer), /In this passage/);
assert.match(textOf(answer), /In general/);
assert.match(textOf(answer), /IPA: \/piːs əv keɪk\//);
assert.match(textOf(answer), /Meaning: It means the test was very easy\./);
assert.equal(textOf(findAll(answer, byClass("dshSpeak_answerWord"))[0]), "piece of cake");
assert.equal(findAll(answer, byClass("dshSpeak_answerWord"))[0].props.title, "This is a <piece of cake>.");
assert.ok(findAll(answer, (node) => node.type === "strong").length > 0, "the markdown bold is real bold");

// Speak in the answer reads the bracketed phrase, not the whole sentence. No
// floating player appears: the speaker control itself turns into stop.
const actions = findAll(answer, byClass("dshSpeak_icon"));
assert.equal(actions.length, 2, "speak and reload");
actions[0].props.onClick();
flush(overlay);
assert.deepEqual(spoken, ["piece of cake"]);
assert.equal(findAll(expand(overlay.tree), byClass("dshSpeak_player")).length, 0, "no player window");
assert.ok(panelNow(), "the panel stays while speaking");
assert.equal(findAll(panelNow(), byClass("dshSpeak_icon"))[0].props["aria-label"], "stop");

// Pressing it again stops the reading and restores the speaker control.
findAll(panelNow(), byClass("dshSpeak_icon"))[0].props.onClick();
flush(overlay);
assert.match(textOf(panelNow()), /In this passage/);
assert.equal(findAll(panelNow(), byClass("dshSpeak_icon"))[0].props["aria-label"], "speakTitle");

// Reload asks again even though the answer is cached, and replaces the text.
hostAnswer = { answer: '**piece of cake**\nIPA: /piːs əv keɪk/\n\n**In this passage**\nMeaning: Reloaded answer.' };
answer = findAll(panelNow(), byClass("dshSpeak_answer"))[0];
findAll(answer, byClass("dshSpeak_icon"))[1].props.onClick();
flush(overlay);
assert.match(textOf(panelNow()), /looking/, "the reload shows the loading line");
await settle();
assert.equal(fetchCalls.length, 2);
assert.match(textOf(panelNow()), /Reloaded answer/);

// Pressing Explain again reuses the cached answer instead of calling the model.
const beforeCache = fetchCalls.length;
await explainNow().props.onClick();
flush(overlay);
await settle();
assert.equal(fetchCalls.length, beforeCache, "a cached answer is reused");

// Editing the box changes the lookup.
hostAnswer = {
	answer: "**deprecated**\nIPA: /ˈdeprəkeɪtɪd/\n\n**As an adjective**\nMeaning: It means old.\nExample: This app is deprecated."
};
textarea = inputNow();
textarea.props.onChange({ target: { value: "deprecated" } });
flush(overlay);
await explainNow().props.onClick();
flush(overlay);
await settle();
assert.deepEqual(fetchCalls.at(-1).body, { input: "deprecated", model: MODEL, sessionId: SESSION_ID });
panel = panelNow();
answer = findAll(panel, byClass("dshSpeak_answer"))[0];
assert.equal(textOf(findAll(answer, byClass("dshSpeak_answerWord"))[0]), "deprecated");
assert.match(textOf(answer), /As an adjective/);
assert.match(textOf(answer), /Meaning: It means old\./);
assert.match(textOf(answer), /IPA: \/ˈdeprəkeɪtɪd\//);
assert.ok(!textOf(findAll(answer, byClass("dshSpeak_answerBody"))[0]).startsWith("deprecated"), "the doubled title is dropped");

// Cmd+Enter in the box explains without pressing the button.
hostAnswer = { answer: "**typed**\nIPA: /taɪpt/" };
textarea = inputNow();
textarea.props.onChange({ target: { value: "typed" } });
flush(overlay);
let prevented = false;
let stopped = false;
inputNow().props.onKeyDown({
	key: "Enter",
	metaKey: true,
	preventDefault: () => {
		prevented = true;
	},
	stopPropagation: () => {
		stopped = true;
	}
});
flush(overlay);
await settle();
assert.equal(prevented, true);
assert.equal(stopped, true, "Enter never reaches the composer underneath");
assert.deepEqual(fetchCalls.at(-1).body, { input: "typed", model: MODEL, sessionId: SESSION_ID });

// Escape closes everything.
await close();
assert.equal(panelNow(), void 0);

// With no selection the clipboard fills the box, unbracketed.
selectionMode = "none";
clipboard.text = "under the weather";
hostAnswer = { answer: "**under the weather**\n\n**Meaning 1:** feeling sick.\nExample: I am under the weather today." };
await clickTrigger();
assert.equal(inputNow().props.value, "under the weather");
await explainNow().props.onClick();
flush(overlay);
await settle();
assert.deepEqual(fetchCalls.at(-1).body, { input: "under the weather", model: MODEL, sessionId: SESSION_ID });
assert.match(textOf(panelNow()), /feeling sick/);
await close();

// An empty box says so in its own hint line and calls nobody.
clipboard.text = "   ";
await clickTrigger();
assert.equal(inputNow().props.value, "");
const beforeEmpty = fetchCalls.length;
explainNow().props.onClick();
flush(overlay);
assert.equal(findAll(panelNow(), byClass("dshSpeak_hintError")).length, 1);
assert.equal(textOf(findAll(panelNow(), byClass("dshSpeak_hintError"))[0]), "empty");
assert.equal(fetchCalls.length, beforeEmpty, "an empty box never reaches the Host");
inputNow().props.onChange({ target: { value: "word" } });
flush(overlay);
assert.equal(textOf(findAll(panelNow(), byClass("dshSpeak_hint"))[0]), "hint", "typing clears the warning");
await close();

// A whole sentence selected is used as it is, and is what Speak reads.
selectionMode = "passage";
selectionText = "This is a whole sentence to read";
blockText = "This is a whole sentence to read";
hostAnswer = { answer: 'Sentence: "This is a whole sentence to read"\n\n- "This" -> the subject\n\n**Simple summary:** It is a simple sentence.' };
await clickTrigger();
assert.equal(inputNow().props.value, "This is a whole sentence to read");
await explainNow().props.onClick();
flush(overlay);
await settle();
assert.deepEqual(fetchCalls.at(-1).body, { input: "This is a whole sentence to read", model: MODEL, sessionId: SESSION_ID });
assert.match(textOf(panelNow()), /Simple summary/);
answer = findAll(panelNow(), byClass("dshSpeak_answer"))[0];
findAll(answer, byClass("dshSpeak_icon"))[0].props.onClick();
flush(overlay);
assert.equal(spoken.at(-1), "This is a whole sentence to read");
assert.equal(findAll(expand(overlay.tree), byClass("dshSpeak_player")).length, 0, "still no player");
findAll(panelNow(), byClass("dshSpeak_icon"))[0].props.onClick();
flush(overlay);
assert.equal(findAll(panelNow(), byClass("dshSpeak_icon"))[0].props["aria-label"], "speakTitle");

// A click elsewhere dismisses the panel.
dispatch("d:mousedown", { target: new Element() });
flush(overlay);
assert.equal(panelNow(), void 0);

// The trigger toggles the panel closed and open again.
await clickTrigger();
assert.ok(panelNow());
await clickTrigger();
assert.equal(panelNow(), void 0);

console.log("render test: all assertions passed");
//#endregion
