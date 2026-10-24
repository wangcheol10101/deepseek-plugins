/**
 * Drive the Host route end to end against a stubbed model: the dictionary-helper task
 * choice, the markdown answer, and the empty-reply retry.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

const module = await import("../lib/index.js");

let route = null;
const answers = [];
const calls = [];
const ctx = {
	effect: (fn) => fn(),
	webServer: {
		register: (spec) => {
			route = spec;
			return () => {};
		}
	},
	agentDefaultModel: {
		currentSelection: () => ({ provider: "p", model: "m" })
	},
	llm: {
		stream: async function* (options) {
			calls.push(options);
			const reply = answers.shift();
			for (const piece of reply) yield { type: "text-delta", text: piece };
			yield { type: "finish", reason: { kind: "stop" } };
		}
	}
};
module.apply(ctx);
assert.equal(route.path, "/word-lookup/explain");

const post = (payload) => {
	const req = new EventEmitter();
	req.method = "POST";
	const res = {
		statusCode: 0,
		headers: {},
		writableEnded: false,
		setHeader(key, value) {
			this.headers[key] = value;
		},
		end(text) {
			this.body = text;
			this.writableEnded = true;
		}
	};
	const done = route.handler(req, res);
	req.emit("data", Buffer.from(JSON.stringify(payload)));
	req.emit("end");
	return done.then(() => ({ status: res.statusCode, body: res.body === void 0 ? null : JSON.parse(res.body) }));
};

// A single word is Task A, and the answer travels as the skill's markdown.
answers.push(["**deprecated**\nIPA: /ˈdeprəkeɪtɪd/\n\n**As an adjective**\nMeaning: old.\nExample: This is deprecated."]);
let response = await post({ input: "deprecated" });
assert.equal(response.status, 200);
assert.match(response.body.answer, /^\*\*deprecated\*\*/);
assert.equal(response.body.text, void 0, "the old JSON shape is gone");
assert.equal(calls.length, 1);
const first = calls[0];
assert.match(first.system, /dictionary-helper/);
assert.match(first.system, /Task C format/);
assert.match(first.system, /beginner-friendly English/);
assert.match(first.system, /Would a 10-year-old understand this/);
assert.match(first.system, /\*\*In general\*\*/);
assert.equal(first.maxTokens, 1200);
assert.match(first.messages[0].content[0].text, /^This is Task A\./);
assert.match(first.messages[0].content[0].text, /The text:\n"""\ndeprecated\n"""/);

// A sentence with a bracketed phrase is Task C, and the whole sentence is the prompt.
answers.push(['**piece of cake**\nIPA: /piːs əv keɪk/\n\n**In this passage**\nMeaning: It means the test was very easy.\n\n**In general**\nMeaning: Something very easy.']);
response = await post({ input: "This test is a <piece of cake>." });
assert.equal(response.status, 200);
assert.match(response.body.answer, /\*\*In general\*\*/);
assert.match(response.body.answer, /IPA: \/piːs əv keɪk\//);
assert.match(calls.at(-1).messages[0].content[0].text, /^This is Task C\./);
assert.match(calls.at(-1).messages[0].content[0].text, /This test is a <piece of cake>\./);
assert.match(calls.at(-1).messages[0].content[0].text, /talking to a 10-year-old/);

// A full sentence leaves the B-or-D choice to the model.
answers.push(["Sentence: ..."]);
response = await post({ input: "The quick brown fox jumps over the lazy dog." });
assert.equal(response.status, 200);
assert.match(calls.at(-1).messages[0].content[0].text, /^Choose Task B when this is a fixed expression or idiom, or Task D when this is a full sentence\./);

// A command still gets an explicit task, because the prompt wraps the text.
answers.push(["Sentence: ..."]);
response = await post({ input: "/analysis The cat sat on the mat." });
assert.equal(response.status, 200);
assert.match(calls.at(-1).messages[0].content[0].text, /^This is Task D\./);
assert.match(calls.at(-1).messages[0].content[0].text, /\/analysis The cat sat on the mat\./);

// A fenced answer is unwrapped without a second call.
answers.push(["```markdown\n**word**\nIPA: /x/\n```"]);
response = await post({ input: "word" });
assert.equal(response.status, 200);
assert.equal(response.body.answer, "**word**\nIPA: /x/");
assert.equal(calls.length, 5, "a fenced answer is not retried");

// An empty answer is asked for once more.
answers.push(["   "]);
answers.push(["**second try**"]);
response = await post({ input: "retry" });
assert.equal(response.status, 200);
assert.equal(response.body.answer, "**second try**");
assert.equal(calls.length, 7, "the empty answer was retried");

// Two empty answers are an error, never an empty card.
answers.push([""]);
answers.push(["  "]);
response = await post({ input: "broken" });
assert.equal(response.status, 502);
assert.match(response.body.error, /did not answer with an explanation/);
assert.equal(response.body.answer, void 0);
assert.equal(calls.length, 9);

// Empty input is refused before any model call.
response = await post({ input: "   " });
assert.equal(response.status, 400);
assert.match(response.body.error, /input is required/);
assert.equal(calls.length, 9);

// The route accepts POST only.
const res = {
	statusCode: 0,
	writableEnded: false,
	setHeader() {},
	end() {
		this.writableEnded = true;
	}
};
await route.handler({ method: "GET", on() {} }, res);
assert.equal(res.statusCode, 405);

// A model route from the browser overrides the deployment default.
answers.push(["**override**"]);
response = await post({ input: "override", sessionId: "session-test", model: { provider: "opencode-go", model: "deepseek-v4.1-flash", reasoningEffort: "max" } });
assert.equal(response.status, 200);
assert.equal(response.body.answer, "**override**");
const override = calls.at(-1);
assert.equal(override.provider, "opencode-go");
assert.equal(override.model, "deepseek-v4.1-flash");
assert.equal(override.reasoningEffort, "max");
assert.equal(override.sessionId, "session-test");
assert.equal(override.temperature, void 0, "temperature is no longer sent");

// A malformed route is ignored and the default is used.
answers.push(["**fallback**"]);
response = await post({ input: "fallback", model: { provider: "", model: "" } });
assert.equal(response.status, 200);
assert.equal(calls.at(-1).provider, "p");
assert.equal(calls.at(-1).model, "m");

console.log("host test: all assertions passed");
