/**
 * Word-lookup plugin, browser half.
 *
 * Adds one control to the composer, and one occupant to the frame-wide
 * `shell.overlay` slot. Nothing runs by itself: selecting text only records it, and
 * the composer control opens a lookup box pre-filled with what it found:
 *
 * - a selected word or idiom becomes the whole sentence around it, with the selection
 *   wrapped in `<...>`, which is exactly the shape dictionary-helper's Task C expects;
 * - any other selection is used as it is;
 * - with no selection, the clipboard fills the box instead.
 *
 * Press **Explain** and the Host answers with the dictionary-helper skill's explanation,
 * which appears under the box with a speak control and a reload control.
 *
 * Speaking uses the renderer's own `speechSynthesis`, so nothing leaves the machine.
 *
 * Explain deliberately does not call a model from the browser: the model lives on
 * the Host, and a `link:`-installed plugin cannot import the Host packages, so the
 * browser half asks a Host route that runs the skill prompt and returns its markdown,
 * without creating a chat message.
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-word-lookup",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		//#region styles
		/**
		* Feature-local stylesheet. Inserted once per browser run and keyed by a
		* plugin-scoped tag id, so a reload or a re-enable cannot duplicate it.
		*/
		const css = [
			".dshSpeak_icon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;pointer-events:auto}",
			".dshSpeak_icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-brand-primary)}",
			".dshSpeak_icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
			".dshSpeak_note{display:inline-flex;align-items:center;height:28px;padding:0 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.18);pointer-events:auto}",
			".dshSpeak_panel{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;width:360px;max-width:calc(100vw - 16px);padding:10px;overscroll-behavior:contain;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:0 12px 32px rgba(0,0,0,.26);pointer-events:auto;font-size:13px;line-height:1.5}",
			".dshSpeak_input{display:block;flex:none;box-sizing:border-box;width:100%;padding:8px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.45;resize:none;outline:none}",
			".dshSpeak_input:focus{border-color:var(--dsw-alias-brand-primary)}",
			".dshSpeak_input::placeholder{color:var(--dsw-alias-label-secondary)}",
			".dshSpeak_foot{display:flex;align-items:center;gap:8px;flex:none}",
			".dshSpeak_hint{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.35;overflow-wrap:anywhere}",
			".dshSpeak_hintError{color:var(--dsw-alias-label-primary);font-weight:600}",
			".dshSpeak_primary{flex:none;height:28px;padding:0 12px;border:0;border-radius:7px;background:var(--dsw-alias-label-primary,#1a1a1a);color:var(--dsw-alias-bg-overlay,#fff);font-size:12px;font-weight:600;cursor:pointer;pointer-events:auto}",
			".dshSpeak_primary:hover{opacity:.88}",
			".dshSpeak_primary:active{opacity:.78}",
			".dshSpeak_primary:focus-visible{outline:2px solid var(--dsw-alias-label-primary,#1a1a1a);outline-offset:2px}",
			".dshSpeak_answer{display:flex;flex-direction:column;min-height:0;margin-top:2px;padding-top:8px;border-top:1px solid var(--dsw-alias-border-l1)}",
			".dshSpeak_answerHead{display:flex;align-items:center;gap:8px;flex:none}",
			".dshSpeak_answerWord{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600}",
			".dshSpeak_answerActions{display:inline-flex;align-items:center;gap:2px;flex:none;margin-left:auto}",
			".dshSpeak_answerBody{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding-top:6px}",
			".dshSpeak_line{margin:0 0 6px;overflow-wrap:anywhere}",
			".dshSpeak_line:last-child{margin-bottom:0}",
			".dshSpeak_subHead{margin:8px 0 4px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".dshSpeak_label{color:var(--dsw-alias-label-secondary);font-weight:600}",
			".dshSpeak_bullet{margin:0 0 4px;padding-left:12px;text-indent:-12px;overflow-wrap:anywhere}",
			".dshSpeak_muted{color:var(--dsw-alias-label-secondary)}"
		].join("");
		const styleTagId = "dsh-plugin-word-lookup/overlay.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(styleTagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-word-lookup";
			tag.dataset.pluginCss = styleTagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region scope
		/**
		* Regions that are never read or explained: the composer and its drafts,
		* form controls, and this feature's own overlay.
		*/
		const BLOCK_SELECTOR = [
			'[data-slot^="conversation.input"]',
			'[data-slot="conversation.composer.bar"]',
			'[data-slot="conversation.composer.dock"]',
			'[data-slot="conversation.input.dock"]',
			'[data-slot="shell.overlay"]',
			"input",
			"textarea",
			'[contenteditable="true"]'
		].join(",");
		/**
		* Nearest ancestor that carries one sentence-sized block of rendered text.
		*/
		const TEXT_BLOCK_SELECTOR = "p,li,blockquote,dd,dt,td,th,h1,h2,h3,h4,h5,h6,pre";
		/**
		* Nearest ancestor that carries one whole message, used when no smaller block
		* can be found.
		*/
		const MESSAGE_SELECTOR = "[data-chat-node-key],[data-chat-turn],[data-chat-flow]";
		/** Longest lookup text accepted. */
		const MAX_INPUT = 2000;
		/** Longest sentence lifted out of a message. */
		const MAX_SENTENCE = 400;
		/**
		* Resolve the element a DOM node belongs to.
		* @param node - a selection anchor, focus, or range container.
		* @returns the containing element, or null.
		*/
		function elementOf(node) {
			if (node === null || node === void 0) return null;
			const el = node.nodeType === 1 ? node : node.parentElement;
			return el !== null && el !== void 0 && typeof el.closest === "function" ? el : null;
		}
		/**
		* Report whether one node may be read or explained.
		*
		* This accepts any selection outside the blocked regions rather than requiring
		* a conversation marker: the exact markers could not be confirmed against the
		* live DOM from outside the page, and a missing control is worse than one that
		* also shows up in another panel.
		* @param node - candidate node.
		* @returns whether the node is eligible.
		*/
		function inScope(node) {
			const el = elementOf(node);
			if (el === null) return false;
			return el.closest(BLOCK_SELECTOR) === null;
		}
		//#endregion

		//#region selection
		/**
		* Copy a live DOMRect into a plain object, so a stored anchor cannot be a
		* detached or moving reference.
		* @param rect - a DOMRect from a range.
		* @returns a plain rectangle.
		*/
		function toPlainRect(rect) {
			return {
				left: rect.left,
				right: rect.right,
				top: rect.top,
				bottom: rect.bottom,
				width: rect.width,
				height: rect.height
			};
		}
		/**
		* Find the visual end of a selection, which is where the controls belong.
		* @param range - the selection's first range.
		* @returns the last laid-out client rect, or the bounding rect.
		*/
		function anchorRectOf(range) {
			let rects = [];
			try {
				rects = Array.from(range.getClientRects());
			} catch (_error) {
				rects = [];
			}
			for (let i = rects.length - 1; i >= 0; i--) {
				const rect = rects[i];
				if (rect.width > 0 && rect.height > 0) return toPlainRect(rect);
			}
			const bounds = range.getBoundingClientRect();
			if (bounds.width > 0 && bounds.height > 0) return toPlainRect(bounds);
			return null;
		}
		/**
		* Read the sentence-sized block a selection came from.
		* @param node - a node inside the selection.
		* @returns the collapsed block text, or "".
		*/
		function blockTextOf(node) {
			const el = elementOf(node);
			if (el === null) return "";
			const block = el.closest(TEXT_BLOCK_SELECTOR) ?? el.closest(MESSAGE_SELECTOR) ?? el;
			const raw = typeof block.innerText === "string" ? block.innerText : block.textContent ?? "";
			return String(raw).replace(/\s+/g, " ").trim().slice(0, 4000);
		}
		/**
		* Find the sentence of a block that holds one span of selected text.
		* @param block - the collapsed block text.
		* @param text - the selected text.
		* @returns the sentence, or "" when it cannot be found or is too long.
		*/
		function sentenceAround(block, text) {
			const at = block.indexOf(text);
			if (block.length === 0 || at < 0) return "";
			const pattern = /[^.!?]+(?:[.!?]+["')\]]*)?/g;
			let match;
			while ((match = pattern.exec(block)) !== null) {
				const start = match.index;
				const end = start + match[0].length;
				if (at < start || at >= end) continue;
				const sentence = match[0].trim();
				return sentence.length > 0 && sentence.length <= MAX_SENTENCE ? sentence : "";
			}
			return "";
		}
		/**
		* Treat a short selection as one word or idiom.
		*
		* Five words is the limit that still covers idioms such as "a piece of cake";
		* a trailing full stop means a sentence someone wants read, not explained.
		* @param text - the selected text.
		* @returns whether the selection is a word or idiom.
		*/
		function isWordOrIdiom(text) {
			if (text.length === 0 || text.length > 64) return false;
			if (/[.!?。！？]\s*$/.test(text)) return false;
			const words = text.split(/\s+/).filter((word) => word.length > 0);
			return words.length > 0 && words.length <= 5;
		}
		/**
		* Read the current selection.
		* @returns the text, its language, kind, containing sentence, and anchor
		* rectangle; null when nothing eligible is selected.
		*/
		function readSelection() {
			const selection = window.getSelection();
			if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
			const text = String(selection.toString() || "").replace(/\s+/g, " ").trim();
			if (text.length < 2) return null;
			const range = selection.getRangeAt(0);
			if (!inScope(range.commonAncestorContainer) && !inScope(selection.anchorNode) && !inScope(selection.focusNode)) return null;
			const rect = anchorRectOf(range);
			if (rect === null) return null;
			const kind = isWordOrIdiom(text) ? "word" : "passage";
			const node = range.commonAncestorContainer ?? selection.anchorNode;
			return {
				text,
				lang: detectLang(text),
				kind,
				sentence: kind === "word" ? sentenceAround(blockTextOf(node), text) : "",
				rect
			};
		}
		/**
		* Turn one selection into what the lookup box should show.
		*
		* A word or idiom is put back into its sentence, with the selection wrapped in
		* angle brackets, so the Host can answer dictionary-helper's Task C — the
		* meaning in this passage, not every possible meaning.
		* @param selection - the current selection, or null.
		* @returns the lookup text.
		*/
		function inputFromSelection(selection) {
			if (selection === null) return "";
			if (selection.kind !== "word") return selection.text;
			const sentence = selection.sentence;
			if (sentence.length === 0 || sentence.length === selection.text.length) return selection.text;
			const at = sentence.indexOf(selection.text);
			if (at < 0) return selection.text;
			return sentence.slice(0, at) + "<" + selection.text + ">" + sentence.slice(at + selection.text.length);
		}
		//#endregion

		//#region explain
		/** Route the Host serves for one explanation. */
		const EXPLAIN_ROUTE = "/word-lookup/explain";
		/** Most answers kept before the oldest is dropped. */
		const EXPLAIN_CACHE_LIMIT = 60;
		/** How long one answer stays usable before it is fetched again. */
		const EXPLAIN_CACHE_TTL_MS = 30 * 60 * 1000;
		/** Answers already fetched in this page run, keyed by the lookup text and model. */
		const explainCache = new Map();
		/**
		* Normalize one model selection from the session's model store.
		* @param value - candidate selection.
		* @returns provider, model, and optional effort, or null.
		*/
		function modelOf(value) {
			if (value === null || typeof value !== "object") return null;
			const provider = typeof value.provider === "string" ? value.provider.trim() : "";
			const model = typeof value.model === "string" ? value.model.trim() : "";
			if (provider.length === 0 || model.length === 0) return null;
			const reasoningEffort = typeof value.reasoningEffort === "string" ? value.reasoningEffort.trim() : "";
			return reasoningEffort.length === 0 ? { provider, model } : { provider, model, reasoningEffort };
		}
		/**
		* Identity of one cached answer. The same text under another model is a
		* different answer, so the route belongs in the key.
		* @param input - the lookup text.
		* @param model - the route used for the request, or null for the default.
		* @returns the cache key.
		*/
		function explainCacheKey(input, model) {
			if (model === null) return input + "\u0000default";
			return input + "\u0000" + model.provider + "/" + model.model + "/" + (model.reasoningEffort ?? "");
		}
		/**
		* Read one answer out of the run cache, discarding it once it is too old.
		* @param key - lookup text and model identity.
		* @returns the cached answer, or undefined.
		*/
		function explainCacheGet(key) {
			const entry = explainCache.get(key);
			if (entry === void 0) return void 0;
			if (Date.now() - entry.at > EXPLAIN_CACHE_TTL_MS) {
				explainCache.delete(key);
				return void 0;
			}
			return entry.value;
		}
		/**
		* Store one answer, evicting the oldest past the cap.
		* @param key - lookup text.
		* @param value - the Host answer.
		*/
		function explainCacheSet(key, value) {
			if (explainCache.size >= EXPLAIN_CACHE_LIMIT) {
				const oldest = explainCache.keys().next();
				if (oldest.done !== true) explainCache.delete(oldest.value);
			}
			explainCache.set(key, {
				at: Date.now(),
				value
			});
		}
		/**
		* Ask the Host to explain one lookup. The Host calls the model, so the answer
		* never becomes a conversation message.
		* @param input - the lookup text.
		* @param model - the session's model route, or null to use the default.
		* @param sessionId - the owning session id, required by some gateways.
		* @param signal - caller cancellation.
		* @returns the markdown answer.
		*/
		async function fetchExplanation(input, model, sessionId, signal) {
			const body = { input };
			if (model !== null) body.model = model;
			if (sessionId !== null) body.sessionId = sessionId;
			const response = await fetch(EXPLAIN_ROUTE, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
				signal
			});
			const payload = await response.json().catch(() => null);
			if (!response.ok) {
				const detail = payload !== null && typeof payload.error === "string" ? payload.error : "the explanation route answered " + String(response.status);
				throw new Error(detail);
			}
			const answer = payload !== null && typeof payload.answer === "string" ? payload.answer.trim() : "";
			if (answer.length === 0) throw new Error("the explanation route answered with no text");
			return { answer };
		}
		//#endregion

		//#region language
		/** Speech-synthesis language tags for the scripts this feature detects. */
		const LANG_TAG = {
			en: "en-US",
			ko: "ko-KR",
			ja: "ja-JP",
			zh: "zh-CN"
		};
		/**
		* Detect the dominant script of a text, so mixed transcripts are read with
		* the matching system voice.
		* @param text - the text to read.
		* @returns one of the supported language ids.
		*/
		function detectLang(text) {
			const hangul = (text.match(/[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g) || []).length;
			const kana = (text.match(/[\u3040-\u30FF]/g) || []).length;
			const han = (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g) || []).length;
			const latin = (text.match(/[A-Za-z]/g) || []).length;
			const letters = hangul + kana + han + latin;
			if (letters === 0) return "en";
			if (kana > 0) return "ja";
			if (hangul / letters >= 0.12) return "ko";
			if (han / letters >= 0.25) return "zh";
			return "en";
		}
		/**
		* Choose the installed system voice for a language, preferring a local voice and
		* then the platform default for that language.
		* @param lang - a language id from `detectLang`.
		* @returns the matching voice, or null to let the engine pick by `lang`.
		*/
		function pickVoice(lang) {
			const synth = window.speechSynthesis;
			if (synth === void 0 || typeof synth.getVoices !== "function") return null;
			const voices = synth.getVoices() || [];
			const exact = [];
			const related = [];
			for (const voice of voices) {
				const tag = String(voice.lang || "").toLowerCase().replace(/_/g, "-");
				if (tag === lang) exact.push(voice);
				else if (tag.indexOf(lang + "-") === 0) related.push(voice);
			}
			const pool = exact.length > 0 ? exact : related;
			if (pool.length === 0) return null;
			const local = pool.filter((voice) => voice.localService === true);
			const candidates = local.length > 0 ? local : pool;
			return candidates.find((voice) => voice.default === true) || candidates[0];
		}
		//#endregion

		//#region rendering
		/** Fixed inset that keeps a floating control inside the viewport. */
		const VIEWPORT_MARGIN = 8;
		/**
		* Placement box for the lookup panel. The height is the panel's usual size with
		* an answer, not a guess at its smallest: it decides which side of the anchor
		* the panel opens on.
		*/
		const PANEL_BOX = {
			width: 360,
			height: 320
		};
		/** Placement box for a one-line notice. */
		const NOTE_BOX = {
			width: 220,
			height: 28
		};
		/**
		* Place a floating element against its anchor, on the side with room, and keep
		* the whole element on screen.
		*
		* Low anchors are placed by their **bottom** edge rather than by a `top` derived
		* from the estimated height. The real panel is taller than any estimate, and an
		* estimate that is too small is exactly what pushes the bottom off screen; with
		* the bottom pinned above the anchor, a taller panel grows upward instead.
		* @param rect - the anchor rectangle.
		* @param box - the element's estimated size, used only to pick the side.
		* @returns inline positioning styles.
		*/
		function placeAt(rect, box) {
			const viewportWidth = window.innerWidth;
			const viewportHeight = window.innerHeight;
			const gap = 6;
			const roomBelow = viewportHeight - VIEWPORT_MARGIN - rect.bottom - gap;
			const roomAbove = rect.top - gap - VIEWPORT_MARGIN;
			const above = roomBelow < box.height && roomAbove >= roomBelow;
			const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.left), Math.max(VIEWPORT_MARGIN, viewportWidth - box.width - VIEWPORT_MARGIN));
			const style = {
				position: "fixed",
				left: left + "px",
				zIndex: 2147483000,
				pointerEvents: "auto",
				maxHeight: Math.max(0, above ? roomAbove : roomBelow) + "px",
				overflowY: "auto"
			};
			if (above) style.bottom = viewportHeight - rect.top + gap + "px";
			else style.top = rect.bottom + gap + "px";
			return style;
		}
		/**
		* Render one inline icon.
		* @param path - SVG path data.
		* @returns the icon element.
		*/
		function icon(path) {
			return react.createElement("svg", {
				width: 14,
				height: 14,
				viewBox: "0 0 24 24",
				fill: "currentColor",
				"aria-hidden": "true",
				focusable: "false"
			}, react.createElement("path", { d: path }));
		}
		/** Speaker glyph. */
		const ICON_SPEAK = "M4 9v6h3.2l4.3 3.7V5.3L7.2 9H4zm11.4-1.1v8.2a4 4 0 0 0 0-8.2zm0-3.4v2.1a6.6 6.6 0 0 1 0 11.8v2.1a8.6 8.6 0 0 0 0-16z";
		/** Stop glyph. */
		const ICON_STOP = "M6 6h12v12H6z";
		/** Refresh glyph — asks the Host for the explanation again. */
		const ICON_REFRESH = "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-8 8s3.58 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z";
		/** Lookup glyph — the composer control. */
		const ICON_EXPLAIN = "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";
		/**
		* Render one 24px circular control.
		* @param props - glyph path, accessible label, and activation handler.
		* @returns the control element.
		*/
		function Control(props) {
			return react.createElement("button", {
				type: "button",
				className: "dshSpeak_icon",
				title: props.label,
				"aria-label": props.label,
				onMouseDown: (event) => event.preventDefault(),
				onClick: props.onActivate
			}, icon(props.path));
		}
		/**
		* The part of a lookup that deserves its own voice: the bracketed phrase when
		* the text marks one, otherwise the whole text.
		* @param input - the lookup text.
		* @returns the text to read aloud.
		*/
		function targetOf(input) {
			const match = /<([^<>]+)>/.exec(input);
			return (match === null ? input : match[1]).replace(/\s+/g, " ").trim();
		}
		/**
		* Render one line of markdown-lite, keeping bold and inline code.
		* @param text - the line.
		* @param prefix - key prefix.
		* @returns the child elements.
		*/
		function renderInline(text, prefix) {
			const parts = [];
			const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
			let last = 0;
			let index = 0;
			let match;
			while ((match = pattern.exec(text)) !== null) {
				if (match.index > last) parts.push(react.createElement("span", {
					key: prefix + "-t" + String(index++)
				}, text.slice(last, match.index)));
				if (match[1] !== void 0) parts.push(react.createElement("strong", {
					key: prefix + "-b" + String(index++)
				}, match[1]));
				else parts.push(react.createElement("code", {
					key: prefix + "-c" + String(index++)
				}, match[2]));
				last = pattern.lastIndex;
			}
			if (last < text.length) parts.push(react.createElement("span", {
				key: prefix + "-t" + String(index++)
			}, text.slice(last)));
			return parts;
		}
		/**
		* Render a dictionary-helper answer.
		*
		* The skill replies in plain markdown with one item per line. This keeps the
		* shape a reader needs — headings, labels, bullets, bold — without pulling in a
		* markdown library. A first heading that only repeats the looked-up text is
		* dropped, because the panel already shows it.
		* @param source - the answer markdown.
		* @param target - the text the answer explains.
		* @returns the body elements.
		*/
		function renderAnswer(source, target) {
			const normalize = (value) => value.replace(/\*\*/g, "").replace(/[`"“”'’.]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
			const wanted = normalize(target);
			const lines = String(source ?? "").replace(/\r\n?/g, "\n").split("\n");
			const parts = [];
			let first = true;
			let index = 0;
			for (const raw of lines) {
				const line = raw.trim();
				if (line.length === 0) continue;
				const key = "line-" + String(index++);
				if (first) {
					first = false;
					if (/^\*\*[^*]+\*\*$/.test(line) && normalize(line) === wanted) continue;
				}
				const bullet = /^[-*]\s+(.*)$/.exec(line);
				if (bullet !== null) {
					parts.push(react.createElement("p", { key, className: "dshSpeak_line dshSpeak_bullet" }, renderInline(bullet[1], key)));
					continue;
				}
				const heading = /^#{1,6}\s+(.*)$/.exec(line);
				if (heading !== null) {
					parts.push(react.createElement("p", { key, className: "dshSpeak_line dshSpeak_subHead" }, renderInline(heading[1], key)));
					continue;
				}
				if (/^\*\*[^*]+\*\*$/.test(line)) {
					parts.push(react.createElement("p", { key, className: "dshSpeak_line dshSpeak_subHead" }, renderInline(line, key)));
					continue;
				}
				if (/^[A-Z][A-Za-z'’ ]{0,27}:$/.test(line)) {
					parts.push(react.createElement("p", { key, className: "dshSpeak_line dshSpeak_subHead" }, renderInline(line, key)));
					continue;
				}
				const label = /^([A-Z][A-Za-z'’ ]{0,27}:)\s+(.+)$/.exec(line);
				if (label !== null) {
					parts.push(react.createElement("p", { key, className: "dshSpeak_line" }, [
						react.createElement("span", { key: key + "-label", className: "dshSpeak_label" }, label[1]),
						...renderInline(" " + label[2], key + "-value")
					]));
					continue;
				}
				parts.push(react.createElement("p", { key, className: "dshSpeak_line" }, renderInline(line, key)));
			}
			return parts;
		}
		//#endregion

		//#region composer
		/**
		* The last eligible selection seen in the page. Clicking a composer control
		* can collapse the live selection, so the trigger falls back to whatever was
		* selected a moment ago.
		*/
		const lastSelection = { value: null };
		/**
		* Bridge from the composer control to the overlay occupant, so the lookup panel
		* opens beside the control that asked for it. `isOpen` lets the control close an
		* open panel without first reading the clipboard it will not use.
		*/
		const composerBridge = {
			open: null,
			isOpen: null
		};
		/**
		* Read the clipboard as one collapsed line.
		* @returns the text, or "" when the clipboard is empty or unreadable.
		*/
		async function readClipboardText() {
			if (typeof navigator === "undefined" || navigator.clipboard === void 0 || typeof navigator.clipboard.readText !== "function") return "";
			try {
				return String(await navigator.clipboard.readText()).replace(/\s+/g, " ").trim().slice(0, MAX_INPUT);
			} catch (_error) {
				return "";
			}
		}
		/**
		* The single composer control. It never acts on its own: it opens the lookup
		* box and hands over what should fill it.
		*
		* The selection is only remembered here, never shown, so the page gains no
		* control that follows the pointer.
		* @param props - the slot's translator seat.
		* @returns the composer control.
		*/
		function ComposerTextTools(props) {
			const t = typeof props.t === "function" ? props.t : (key) => FALLBACK[key] || key;
			react.useEffect(() => {
				let frame = 0;
				const remember = () => {
					frame = 0;
					const next = readSelection();
					if (next !== null) lastSelection.value = next;
				};
				const schedule = () => {
					if (frame === 0) frame = window.requestAnimationFrame(remember);
				};
				const onMouseDown = (event) => {
					const el = event.target instanceof Element ? event.target : null;
					if (el !== null && el.closest("[data-dsh-speak-trigger]") !== null) return;
					lastSelection.value = null;
				};
				document.addEventListener("mouseup", schedule, true);
				document.addEventListener("keyup", schedule, true);
				document.addEventListener("selectionchange", schedule);
				document.addEventListener("mousedown", onMouseDown, true);
				return () => {
					document.removeEventListener("mouseup", schedule, true);
					document.removeEventListener("keyup", schedule, true);
					document.removeEventListener("selectionchange", schedule);
					document.removeEventListener("mousedown", onMouseDown, true);
					if (frame !== 0) window.cancelAnimationFrame(frame);
				};
			}, []);
			return react.createElement("button", {
				type: "button",
				className: "dshSpeak_icon",
				"data-dsh-speak-trigger": "1",
				title: t("tools"),
				"aria-label": t("tools"),
				"aria-haspopup": "dialog",
				onMouseDown: (event) => event.preventDefault(),
				onClick: async (event) => {
					const rect = toPlainRect(event.currentTarget.getBoundingClientRect());
					if (composerBridge.open === null) return;
					if (typeof composerBridge.isOpen === "function" && composerBridge.isOpen()) {
						composerBridge.open({
							rect,
							selection: null,
							clipboard: "",
							model: null,
							sessionId: null
						});
						return;
					}
					const model = typeof props.modelSelection === "function" ? modelOf(props.modelSelection()) : null;
					const sessionId = typeof props.sessionId === "string" ? props.sessionId : null;
					const selection = readSelection() ?? lastSelection.value;
					// The clipboard is only read when there is nothing selected, so a plain
					// click never asks the browser for it.
					const clipboard = selection === null ? await readClipboardText() : "";
					composerBridge.open({
						rect,
						selection,
						clipboard,
						model,
						sessionId
					});
				}
			}, icon(ICON_EXPLAIN));
		}
		//#endregion

		//#region overlay
		/** Localized copy used when the slot supplies no translator. */
		const FALLBACK = {
			tools: "Look up a word or text",
			explain: "Explain",
			placeholder: "Word, idiom, or sentence",
			hint: "Put <...> around the part to explain.",
			empty: "Type or select something first",
			speak: "Speak",
			speakTitle: "Read it aloud",
			stop: "Stop",
			unavailable: "Speech synthesis is unavailable in this window",
			refresh: "Try again",
			looking: "Looking it up…",
			failed: "Could not look this up"
		};
		/**
		* The floating layer: the lookup panel and short notices. Every one of them
		* follows a click — selecting text alone shows nothing.
		* @param props - the slot's translator seat.
		* @returns the floating control, or nothing.
		*/
		function SpeakOverlay(props) {
			const t = typeof props.t === "function" ? props.t : (key) => FALLBACK[key] || key;
			const engineReady = typeof window !== "undefined" && window.speechSynthesis !== void 0 && typeof window.SpeechSynthesisUtterance === "function";
			/** Where the panel sits and whether it is open at all. */
			const [panel, setPanel] = react.useState(null);
			/** The editable text in the lookup box. */
			const [draft, setDraft] = react.useState("");
			/** The lookup whose answer is on screen, or null before Explain is pressed. */
			const [ask, setAsk] = react.useState(null);
			const [explain, setExplain] = react.useState({
				status: "idle",
				data: null,
				message: ""
			});
			/** A reason shown in the panel's hint line, such as an empty box. */
			const [panelNote, setPanelNote] = react.useState(null);
			const [phase, setPhase] = react.useState("idle");
			const [notice, setNotice] = react.useState(null);
			const openRef = react.useRef(false);
			const rootRef = react.useRef(null);
			const textareaRef = react.useRef(null);
			const requestRef = react.useRef(null);
			const generationRef = react.useRef(0);

			/**
			* Start reading a text, replacing anything already speaking.
			*
			* There is no player window: the answer's speaker control itself turns into
			* a stop control while the utterance runs, so reading adds nothing on screen.
			* @param text - the text to read.
			* @param lang - its detected language id.
			* @param rect - where to place a notice if the engine fails.
			*/
			const speak = react.useCallback((text, lang, rect) => {
				const synth = window.speechSynthesis;
				const generation = ++generationRef.current;
				synth.cancel();
				setNotice(null);
				setPhase("speaking");
				const utterance = new window.SpeechSynthesisUtterance(text);
				utterance.lang = LANG_TAG[lang] || LANG_TAG.en;
				const voice = pickVoice(lang);
				if (voice !== null) utterance.voice = voice;
				utterance.onend = () => {
					if (generationRef.current === generation) setPhase("idle");
				};
				utterance.onerror = (event) => {
					if (generationRef.current !== generation) return;
					setPhase("idle");
					if (event.error !== "interrupted" && event.error !== "canceled") setNotice({
						text: t("unavailable"),
						rect
					});
				};
				synth.speak(utterance);
			}, [t]);

			/** Stop reading. */
			const stop = react.useCallback(() => {
				generationRef.current++;
				window.speechSynthesis.cancel();
				setPhase("idle");
			}, []);

			/** Close the panel and drop whatever it was showing. */
			const close = react.useCallback(() => {
				openRef.current = false;
				const pending = requestRef.current;
				requestRef.current = null;
				if (pending !== null) pending.abort();
				stop();
				setPanel(null);
				setDraft("");
				setAsk(null);
				setPanelNote(null);
				setNotice(null);
				setExplain({
					status: "idle",
					data: null,
					message: ""
				});
			}, [stop]);

			// The composer control opens the panel, or closes it when it is already open.
			const open = react.useCallback((payload) => {
				if (openRef.current) {
					close();
					return;
				}
				stop();
				openRef.current = true;
				setNotice(null);
				setAsk(null);
				setPanelNote(null);
				setExplain({
					status: "idle",
					data: null,
					message: ""
				});
				setPanel({ rect: payload.rect, model: payload.model ?? null, sessionId: payload.sessionId ?? null });
				setDraft(payload.selection !== null ? inputFromSelection(payload.selection) : payload.clipboard);
			}, [close, stop]);

			react.useEffect(() => {
				const isOpen = () => openRef.current;
				composerBridge.open = open;
				composerBridge.isOpen = isOpen;
				return () => {
					if (composerBridge.open === open) composerBridge.open = null;
					if (composerBridge.isOpen === isOpen) composerBridge.isOpen = null;
				};
			}, [open]);

			// A click anywhere else, Escape, a page scroll, or a resize dismisses the
			// panel. A scroll inside the panel — the answer's own scroll area — is not
			// a reason to close it.
			react.useEffect(() => {
				const owns = (target) => rootRef.current !== null && target instanceof Node && rootRef.current.contains(target);
				const isTrigger = (target) => target instanceof Element && target.closest("[data-dsh-speak-trigger]") !== null;
				const onMouseDown = (event) => {
					if (owns(event.target) || isTrigger(event.target)) return;
					close();
				};
				const onKeyUp = (event) => {
					if (event.key === "Escape") close();
				};
				const onScroll = (event) => {
					if (owns(event.target)) return;
					close();
				};
				document.addEventListener("mousedown", onMouseDown, true);
				document.addEventListener("keyup", onKeyUp, true);
				window.addEventListener("scroll", onScroll, true);
				window.addEventListener("resize", close);
				return () => {
					document.removeEventListener("mousedown", onMouseDown, true);
					document.removeEventListener("keyup", onKeyUp, true);
					window.removeEventListener("scroll", onScroll, true);
					window.removeEventListener("resize", close);
				};
			}, [close]);

			// Focus the box as soon as it opens, with the cursor after the prefilled text.
			react.useEffect(() => {
				if (panel === null) return;
				const el = textareaRef.current;
				if (el === null || typeof el.focus !== "function") return;
				el.focus();
				const end = typeof el.value === "string" ? el.value.length : 0;
				if (typeof el.setSelectionRange === "function") el.setSelectionRange(end, end);
			}, [panel]);

			react.useEffect(() => () => {
				const pending = requestRef.current;
				if (pending !== null) pending.abort();
			}, []);

			react.useEffect(() => () => {
				if (engineReady) window.speechSynthesis.cancel();
			}, [engineReady]);

			react.useEffect(() => {
				if (notice === null) return void 0;
				const timer = window.setTimeout(() => setNotice(null), 5000);
				return () => window.clearTimeout(timer);
			}, [notice]);

			/**
			* Ask the Host for one lookup, replacing whatever is on screen.
			* @param input - the text to explain.
			* @param rect - where to place the panel and a notice.
			* @param lang - the language of the text, for speech.
			* @param cached - whether a cached answer may be shown instead.
			* @param model - the session's model route, or null for the default.
			* @param sessionId - the owning session id, or null.
			*/
			const askFor = async (input, rect, lang, cached, model, sessionId) => {
				const key = explainCacheKey(input, model);
				if (cached) {
					const hit = explainCacheGet(key);
					if (hit !== void 0) {
						setAsk({
							input,
							rect,
							lang,
							model,
							sessionId
						});
						setExplain({
							status: "ready",
							data: hit,
							message: ""
						});
						return;
					}
				}
				const previous = requestRef.current;
				if (previous !== null) previous.abort();
				const controller = new AbortController();
				requestRef.current = controller;
				setAsk({
					input,
					rect,
					lang,
					model,
					sessionId
				});
				setExplain({
					status: "loading",
					data: null,
					message: ""
				});
				try {
					const data = await fetchExplanation(input, model, sessionId, controller.signal);
					if (controller.signal.aborted) return;
					explainCacheSet(key, data);
					setExplain({
						status: "ready",
						data,
						message: ""
					});
				} catch (error) {
					if (controller.signal.aborted) return;
					setExplain({
						status: "error",
						data: null,
						message: String(error?.message ?? error)
					});
				} finally {
					if (requestRef.current === controller) requestRef.current = null;
				}
			};

			/** Read the box and explain it. */
			const submit = () => {
				if (panel === null) return;
				const input = draft.trim().slice(0, MAX_INPUT);
				if (input.length === 0) {
					setPanelNote(t("empty"));
					return;
				}
				setPanelNote(null);
				stop();
				const model = typeof panel.model === "function" ? modelOf(panel.model()) : modelOf(panel.model);
				const sessionId = typeof panel.sessionId === "string" ? panel.sessionId : null;
				void askFor(input, panel.rect, detectLang(input), true, model, sessionId);
			};

			/**
			* Render the answer area under the box: the skill's answer, its failure, or
			* the loading line.
			* @returns the elements.
			*/
			const answerParts = () => {
				if (explain.status === "loading") return [react.createElement("p", {
					key: "hint",
					className: "dshSpeak_line dshSpeak_muted"
				}, t("looking"))];
				if (explain.status === "error") return [react.createElement("p", {
					key: "hint",
					className: "dshSpeak_line dshSpeak_muted"
				}, t("failed") + " — " + explain.message)];
				if (explain.data === null) return [];
				return renderAnswer(explain.data.answer, targetOf(ask === null ? "" : ask.input));
			};

			const children = [];
			if (panel !== null) {
				const target = ask === null ? "" : targetOf(ask.input);
				const rows = Math.min(4, Math.max(2, Math.ceil(draft.length / 44)));
				children.push(react.createElement("div", {
					key: "panel",
					className: "dshSpeak_panel",
					role: "dialog",
					"aria-label": t("tools"),
					style: placeAt(panel.rect, PANEL_BOX)
				}, [
					react.createElement("textarea", {
						key: "input",
						ref: textareaRef,
						className: "dshSpeak_input",
						value: draft,
						rows,
						maxLength: MAX_INPUT,
						placeholder: t("placeholder"),
						"aria-label": t("placeholder"),
						spellCheck: false,
						onChange: (event) => {
							setDraft(event.target.value);
							if (panelNote !== null) setPanelNote(null);
						},
						onKeyDown: (event) => {
							if (event.key !== "Enter") return;
							// The composer listens for Enter too; a lookup box must never
							// send the chat message underneath it.
							event.stopPropagation();
							if (event.metaKey || event.ctrlKey) {
								event.preventDefault();
								submit();
							}
						}
					}),
					react.createElement("div", { key: "foot", className: "dshSpeak_foot" }, [
						react.createElement("span", {
							key: "hint",
							className: panelNote === null ? "dshSpeak_hint" : "dshSpeak_hint dshSpeak_hintError"
						}, panelNote === null ? t("hint") : panelNote),
						react.createElement("button", {
							key: "explain",
							type: "button",
							className: "dshSpeak_primary",
							"data-dsh-speak-explain": "1",
							onMouseDown: (event) => event.preventDefault(),
							onClick: submit
						}, t("explain"))
					]),
					ask === null ? null : react.createElement("div", {
						key: "answer",
						className: "dshSpeak_answer"
					}, [
						react.createElement("div", { key: "head", className: "dshSpeak_answerHead" }, [
							react.createElement("span", {
								key: "word",
								className: "dshSpeak_answerWord",
								title: ask.input
							}, target),
							react.createElement("div", { key: "actions", className: "dshSpeak_answerActions" }, [
								engineReady ? react.createElement(Control, {
									key: "speak",
									path: phase === "idle" ? ICON_SPEAK : ICON_STOP,
									label: t(phase === "idle" ? "speakTitle" : "stop"),
									onActivate: phase === "idle" ? () => speak(target, ask.lang, ask.rect) : stop
								}) : null,
								react.createElement(Control, {
									key: "refresh",
									path: ICON_REFRESH,
									label: t("refresh"),
									onActivate: () => {
										explainCache.delete(explainCacheKey(ask.input, ask.model));
										void askFor(ask.input, ask.rect, ask.lang, false, ask.model, ask.sessionId);
									}
								})
							])
						]),
						react.createElement("div", {
							key: "body",
							className: "dshSpeak_answerBody"
						}, answerParts())
					])
				]));
			}
			if (notice !== null) {
				children.push(react.createElement("div", {
					key: "notice",
					className: "dshSpeak_note",
					style: placeAt(notice.rect, NOTE_BOX)
				}, notice.text));
			}
			if (children.length === 0) return null;
			return react.createElement(react.Fragment, null, react.createElement("div", {
				ref: rootRef,
				style: { display: "contents" }
			}, children));
		}
		//#endregion

		//#region plugin
		/** Dictionaries for the two built-in Client locales. */
		const en = {
			tools: "Look up a word or text",
			explain: "Explain",
			placeholder: "Word, idiom, or sentence",
			hint: "Put <...> around the part to explain.",
			empty: "Type or select something first",
			speak: "Speak",
			speakTitle: "Read it aloud",
			stop: "Stop",
			unavailable: "Speech synthesis is unavailable in this window",
			refresh: "Try again",
			looking: "Looking it up…",
			failed: "Could not look this up"
		};
		/** Chinese copy. */
		const zh = {
			tools: "查询单词或文本",
			explain: "解释",
			placeholder: "单词、习语或句子",
			hint: "用 <...> 标出要解释的部分",
			empty: "请先输入或选择内容",
			speak: "朗读",
			speakTitle: "朗读",
			stop: "停止",
			unavailable: "此窗口不支持语音合成",
			refresh: "重试",
			looking: "正在查询…",
			failed: "查询失败"
		};
		/** Services this browser half waits for. */
		const inject = ["slots", "locale"];
		/** Locale namespace owned by this feature. */
		const NS = "speakSelection";
		/**
		* Register the feature's copy, its overlay occupant, and the composer control.
		* @param ctx - browser plugin context.
		*/
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				en,
				zh
			}));
			ctx.effect(() => ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "word-lookup",
				order: 60,
				label: "Word lookup",
				locale: NS
			}, SpeakOverlay)));
			ctx.effect(() => ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "word-lookup-tools",
				order: 80,
				label: "Word lookup",
				locale: NS,
				inject: (sessionId) => {
					const props = { sessionId };
					const directories = ctx.get("modelDirectories");
					if (directories === void 0) return props;
					try {
						const directory = directories.directoryFor(sessionId);
						props.modelSelection = () => directory.store.getSnapshot().current;
					} catch (_error) {
						// No model selection; the Host falls back to its default.
					}
					return props;
				}
			}, ComposerTextTools)));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
