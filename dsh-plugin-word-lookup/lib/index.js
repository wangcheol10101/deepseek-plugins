/**
 * Word-lookup plugin, node half.
 *
 * Serves one loopback HTTP route, `POST /word-lookup/explain`, that answers with a
 * dictionary-helper explanation of whatever the composer lookup box sends: a word, an
 * idiom, a command such as `/analysis`, or a passage with the part to explain wrapped in
 * angle brackets. The browser calls it directly, so the answer never enters the
 * conversation and never touches a Session.
 *
 * This half imports nothing on purpose. A bundle installed with `link:` resolves
 * modules from its real path on disk, outside the profile, so it cannot reach the
 * packages that ship inside the dsh installation — but it does receive the Host
 * Context, which already carries `webServer`, `llm`, and `agentDefaultModel`.
 */

/** Services this host half needs before it runs. */
export const inject = ["webServer", "llm", "agentDefaultModel"];

/** Route the browser posts one lookup to. */
const ROUTE = "/word-lookup/explain";
/** Longest accepted lookup text. */
const MAX_INPUT = 2000;
/** Largest accepted request body. */
const MAX_BODY = 65536;
/** Response budget for one explanation. */
const MAX_TOKENS = 1200;
/** Longest answer kept. */
const MAX_ANSWER = 12000;

/**
 * The dictionary-helper skill, condensed to the part a lookup needs: the task choice,
 * the six output formats, and the beginner-English rules. It is sent as the system
 * prompt so the answer keeps the skill's shape without the text ever entering a chat.
 */
const SYSTEM = `You are dictionary-helper, an English dictionary and grammar helper for a learner whose English is poor.
This is the most important rule: every answer must be in very simple, beginner-friendly English, as if explaining to a 10-year-old.
Use short sentences, about 15 words at most. Use common everyday words. If a simple word can say it, never use a hard word.
Do not copy hard words from the text into the explanation, apart from the word or phrase you are explaining. The example sentences must be simple too.
Before you answer, check every sentence with this question: "Would a 10-year-old understand this?" If not, write it again in simpler words.
Good: "It means the thing is old. People do not want to use it now."
Bad: "It denotes an obsolete condition that is no longer actively maintained."
Do not comment on the topic, tone, or content of the text. Do not carry over anything from earlier requests.

Pick exactly one task:
- The text starts with /analysis: Task D, sentence analysis.
- The text starts with /fix: Task E, sentence correction.
- The text starts with /question: Task F, grammar question.
- The text contains a word or phrase wrapped in angle brackets, like <this>: Task C, in-context phrase meaning.
- The text is one word: Task A, word explanation.
- The text is a fixed expression or idiom: Task B, idiom explanation.
- The text is a full sentence: Task D, sentence analysis.

Task A format:
**[word]**
IPA: /.../

**As a [part of speech]**
Meaning: (simple definition)
Example: (simple example sentence)

**As a [other part of speech]**
Meaning: ...
Example: ...

**Word origin**
(short, simple explanation of where the word comes from)

**Examples**
(two more short example sentences)

Task B format:
**[idiom]**
IPA: /.../

**Meaning 1:** (simple explanation)
Example: (example sentence)
Why it's used this way: (simple reason or picture behind it)

**Meaning 2:** (only when there is another common meaning)
Example: ...
Why it's used this way: ...

Task C format:
**[word or phrase]**
IPA: /.../

**In this passage**
Meaning: (simple explanation using the passage)

**In general**
Meaning: (the usual meaning of the word or phrase on its own)

Example: (new example sentence with the in-passage meaning)
Example: (another new example sentence)

Task D format:
Sentence: "..."

- "[chunk 1]" -> (grammatical function) - (simple reason for this word order)
- "[chunk 2]" -> ...

**Simple summary:** (one or two plain sentences)

Task E format:
Original: "..."
Corrected: "..."

Fixes:
- "[wrong part]" -> "[fixed part]": (simple reason)

Task F format:
**Short answer:** (one simple sentence)

**Examples:**
- (example)

**Explanation:**
(step-by-step, simple explanation)

Rules:
- Task C: give the IPA, then the meaning in this passage, then the usual meaning in general. Always give both meanings. Explain only the bracketed part; do not explain the rest of the passage.
- Task A: give a definition and one example for every part of speech the word can have.
- Task B: give the IPA, every common meaning, one example for each, and why the idiom is used this way.
- Keep the labels exactly as written above.
- Reply in plain markdown. No code fence, no introduction, no closing remark.
- Final check on every sentence: is it short, and would a 10-year-old understand it? If not, write it again simply.`;

/**
 * Tell the model which task applies, because a lookup box text does not always carry
 * the skill's own trigger and the prompt wraps the text after this line.
 * @param text - the lookup text.
 * @returns one short instruction line.
 */
function taskHint(text) {
	const command = /^\/(analysis|fix|question)(\s|$)/i.exec(text);
	if (command !== null) {
		const task = command[1].toLowerCase() === "analysis" ? "D" : command[1].toLowerCase() === "fix" ? "E" : "F";
		return "This is Task " + task + ". The command at the start of the text says what to do.";
	}
	if (/<[^<>]+>/.test(text)) {
		return "This is Task C. The part inside < > is the part to explain; the text around it is its passage.";
	}
	if (text.split(/\s+/).filter((word) => word.length > 0).length <= 1) return "This is Task A.";
	return "Choose Task B when this is a fixed expression or idiom, or Task D when this is a full sentence.";
}

/**
 * Read the lookup text from a request field.
 * @param value - candidate field.
 * @returns the trimmed text, or "".
 */
function readInput(value) {
	if (typeof value !== "string") return "";
	return value.replace(/\r\n?/g, "\n").trim().slice(0, MAX_INPUT);
}

/**
 * Remove the fence a model sometimes wraps around a whole answer, and trim it.
 * @param raw - the model's text.
 * @returns the answer text.
 */
function cleanAnswer(raw) {
	return String(raw ?? "")
		.replace(/```[a-zA-Z]*\s*/g, "")
		.replace(/```/g, "")
		.trim()
		.slice(0, MAX_ANSWER)
		.trim();
}

/**
 * Collect a request body as text, refusing oversized input.
 * @param req - the incoming request.
 * @returns the body text.
 */
function readBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY) {
				reject(new Error("request body is too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/**
 * Answer one request with JSON.
 * @param res - the response to own.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
function send(res, status, payload) {
	if (res.writableEnded === true) return;
	res.statusCode = status;
	res.setHeader("content-type", "application/json; charset=utf-8");
	res.setHeader("cache-control", "no-store");
	res.end(JSON.stringify(payload));
}

/**
 * Resolve the provider route the session already uses.
 * @param ctx - owning Host Context.
 * @returns the exact provider and model to call.
 */
function resolveRoute(ctx) {
	const selection = ctx.agentDefaultModel.currentSelection();
	const route = selection?.route ?? selection;
	const provider = route?.provider;
	const model = route?.model;
	if (typeof provider !== "string" || provider.length === 0 || typeof model !== "string" || model.length === 0) {
		throw new Error("no default model route is configured");
	}
	return { provider, model };
}

/**
 * Run one model call and return its whole text reply.
 * @param ctx - owning Host Context.
 * @param route - provider and model to call.
 * @param prompt - the user turn.
 * @returns the collected reply text.
 */
async function askModel(ctx, route, prompt) {
	let output = "";
	let failure;
	for await (const chunk of ctx.llm.stream({
		provider: route.provider,
		model: route.model,
		system: SYSTEM,
		messages: [{
			role: "user",
			content: [{
				type: "text",
				text: prompt
			}]
		}],
		maxTokens: MAX_TOKENS,
		temperature: 0.2
	})) {
		if (chunk.type === "text-delta") output += chunk.text;
		else if (chunk.type === "finish" && chunk.reason.kind === "error") failure = chunk.reason.failure;
	}
	if (failure !== undefined) throw new Error(`the model call failed (${failure.code})`);
	return output;
}

/**
 * Build the user turn for one lookup.
 * @param input - the lookup text.
 * @returns the prompt.
 */
function promptFor(input) {
	const hint = taskHint(input);
	return [
		hint,
		"The text:",
		'"""',
		input,
		'"""',
		"Now write the answer in very simple English: short sentences, common words, like talking to a 10-year-old."
	].filter((part) => part.length > 0).join("\n");
}

/**
 * Ask the model for one dictionary-helper answer.
 * @param ctx - owning Host Context.
 * @param input - the lookup text.
 * @returns the markdown answer.
 */
async function explain(ctx, input) {
	const route = resolveRoute(ctx);
	const prompt = promptFor(input);
	let answer = cleanAnswer(await askModel(ctx, route, prompt));
	// One more sample when the reply is empty: the output is generated, and a second
	// attempt is usually well formed. An answer that is still empty is an error, never
	// the raw reply — an empty card is not an explanation.
	if (answer.length < 2) answer = cleanAnswer(await askModel(ctx, route, prompt));
	if (answer.length < 2) throw new Error("the model did not answer with an explanation");
	return { answer };
}

/**
 * Build the route handler bound to one Host Context.
 * @param ctx - owning Host Context.
 * @returns the request handler.
 */
function handlerFor(ctx) {
	return async (req, res) => {
		if (req.method !== "POST") {
			send(res, 405, { error: "POST only" });
			return;
		}
		let body;
		try {
			body = JSON.parse(await readBody(req));
		} catch (error) {
			send(res, 400, { error: String(error?.message ?? error) });
			return;
		}
		const input = readInput(body?.input);
		if (input.length === 0) {
			send(res, 400, { error: "input is required" });
			return;
		}
		try {
			send(res, 200, await explain(ctx, input));
		} catch (error) {
			send(res, 502, { error: String(error?.message ?? error) });
		}
	};
}

/**
 * Register the explanation route.
 * @param ctx - owning Host Context.
 */
export function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: ROUTE,
		handler: handlerFor(ctx)
	}));
}
