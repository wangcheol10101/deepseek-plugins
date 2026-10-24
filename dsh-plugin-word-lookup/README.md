# dsh-plugin-word-lookup

One control in the composer opens a lookup box for English text. It fills itself from the
selection or the clipboard, explains the text with the **dictionary-helper** skill, and reads
the looked-up part aloud — all on demand, with nothing added to the conversation.

## What it does

Press the control and a small panel opens beside it:

```
┌─────────────────────────────────────────────────┐
│ This test is a <piece of cake>.                  │
│ Put <...> around the part to explain.  [Explain] │
├─────────────────────────────────────────────────┤
│ piece of cake                            🔊   ⟳ │
│ IPA: /piːs əv keɪk/                              │
│ In this passage                                  │
│ Meaning: It means the test was very easy.        │
│ In general                                       │
│ Meaning: It means something is very easy to do.  │
│ Example: The quiz was a piece of cake.           │
│ Example: The job was a piece of cake.            │
└─────────────────────────────────────────────────┘
```

The box is editable, and **Explain** sends exactly what it contains. Selecting text on its own
never opens anything, so the page stays clear while you read.

### What fills the box

| What you did | What the box contains |
| --- | --- |
| Selected a **word or idiom** | The whole sentence around it, with the selection wrapped: `This test is a <piece of cake>.` |
| Selected **anything longer** | The selected text, as it is |
| Selected **nothing** | The clipboard |
| Selected nothing, clipboard empty | An empty box, with *Type or select something first* when you press Explain |

The angle brackets are dictionary-helper's own convention: Task C explains only the bracketed
part, in the way **that passage** uses it, and gives two new example sentences. It also shows the
IPA and the usual meaning **In general**, after the meaning in that passage. When the sentence
around a selection cannot be found — or is longer than 400 characters — the box falls back to the
selection alone, which the skill then answers as a word or idiom.

### The answer

The Host sends a prompt built from the dictionary-helper skill, so the answer keeps the skill's shape:

- **A word** — IPA, a meaning and an example for every part of speech, the word origin, and more
  examples.
- **An idiom** — IPA, every common meaning, an example for each, and why the idiom is used that
  way.
- **A word or idiom inside a sentence `<...>`** — its IPA, the meaning in this passage, the usual
  meaning **In general**, and two new examples.
- **A full sentence** — a chunk-by-chunk analysis with a one-line summary.
- **`/analysis`, `/fix`, `/question`** typed into the box — the skill's sentence analysis,
  correction, and grammar-question tasks.

Everything is written in short, beginner-friendly English, `like you are explaining to a
10-year-old` — that is the skill's most important rule. The prompt makes it concrete: sentences
of about 15 words, no copied hard words, and a final check of every sentence with *Would a
10-year-old understand this?*

The panel's **🔊** reads the looked-up text: the bracketed phrase when the box marks one,
otherwise the whole box. **⟳** asks the Host again, bypassing the page cache. While a text
reads, nothing floats over the page: the same **🔊** turns into a **■** and pressing it stops
the reading. Closing the panel also stops it.

Nothing is added to the conversation and no Session is touched: the answer is fetched over a
loopback route and rendered in place.

## How the explanation works

The model lives on the Host, and the page cannot call it directly — the key is in the Host
environment and no Remote exposes a secret. So the Host serves one route and the page calls it:

```
POST /word-lookup/explain   { input, model?, sessionId? }
  → { answer }
```

`input` is the contents of the lookup box, trimmed and capped at 2000 characters. `model` is
optional: the client sends the **session's currently selected** provider, model, and reasoning
effort, so the lookup answers with the same model as the conversation. `sessionId` is the owning
session's id; gateways that route requests by session (opencode-go expects it as
`x-opencode-session`) reject a call without it. When the browser sends no usable selection, the
Host falls back to the deployment default (`ctx.agentDefaultModel.currentSelection()`). `answer`
is dictionary-helper markdown, trimmed and capped at 12000 characters.

- **Host** (`lib/index.js`) registers the route on `ctx.webServer`, takes the model route and
  session id from the request (or the default), and calls `ctx.llm.stream` with the skill prompt.
- **Client** (`lib/client.js`) reads the session id and model selection from the session-scoped
  composer slot inject, posts the box contents with them, then renders the answer.

Two details make this possible:

- The app is served over **HTTP**, so the page and the route share an origin and a relative
  `fetch` is same-origin.
- The Host half **imports nothing at all** — it only uses the `ctx` it receives. That matters
  because a bundle installed with `link:` resolves modules from its real path on disk, outside
  the profile, so it cannot reach the packages that ship inside the dsh installation. An
  earlier attempt to import `@deepseek-ai/dsh-typert-protocol` there failed with
  `ERR_MODULE_NOT_FOUND`, which is why the explanation does not use a Remote.

### The task hint

The skill picks its task from the prompt, but a lookup box does not always carry the skill's
own trigger, so the Host adds one line:

- the text starts with a command → no hint; the command is the task;
- it contains `<...>` → *This is Task C*;
- it is one word → *This is Task A*;
- otherwise → *Choose Task B when this is a fixed expression or idiom, or Task D when this is a
  full sentence.*

The prompt itself is the skill's grammar, formats, and style rules, condensed into one system
message. The user turn ends with one more simplicity reminder, because the beginner-English rule
is the one a model drops most easily. Nothing is read from the skills directory at run time, so
the plugin works even if that directory is not installed.

### Empty answers

A model call can return an empty reply. The Host asks **once more**; if the second answer is
also empty, the route answers `502` with a message. The panel shows *Could not look this up* and
leaves **⟳** available — an empty card is never presented as an explanation. A code fence around
a whole answer is stripped before it is returned.

The route answers this shape:

```json
{"answer":"**deprecated**\nIPA: /ˈdeprəkeɪtɪd/\n\n**As an adjective**\nMeaning: old.\nExample: This app is deprecated."}
```

The Host trims the text before answering, and `.dsh-probe/host-test.mjs` drives the route end to
end against a stubbed model.

### Rendering the answer

The answer is plain markdown, and the panel renders the subset the skill actually uses: bold
headings, `Label:` lines, `-` bullets, bold, and inline code. A first heading that only repeats
the looked-up text is dropped, because the panel already shows it in its header. There is no
markdown library in the plugin; the renderer is a short function at the bottom of
`lib/client.js`.

### Caching

Answers are cached in the page for the life of the tab, keyed by **the lookup text and the
model route**:

```js
explainCacheKey(input, model)
```

The box contents include the sentence, so the same word in a different sentence is a different
entry; the route is part of the key because the same text under another model is another answer. The cache holds up to 60 answers (oldest evicted), never reaches disk, and stores only
successful answers. An entry **expires 30 minutes after it was fetched**
(`EXPLAIN_CACHE_TTL_MS`), checked on read, so a tab left open overnight never serves yesterday's
answer. **⟳** deletes the entry and refetches.

## Why a composer control and not an item in the right-click menu

The **Copy** you get when you right-click selected text is built in the application's Electron
main process, not in plugin space:

```js
window.webContents.on("context-menu", (_event, { isEditable, selectionText, editFlags }) => {
  const items = [];
  if (isEditable) items.push(undo, redo, separator, cut, copy, paste, separator, selectAll);
  else if (selectionText.length > 0) items.push({ role: "copy", enabled: editFlags.canCopy });
  // ...
  Menu.buildFromTemplate(items.map(/* ... */)).popup({ window });
});
```

That handler is hardcoded in the shipped shell. It exposes no Cordis Service and no slot, and
DSH plugins run in two other places — a private Node host process (`dsh-desktop-host` →
`runProfile`) and the web renderer. Adding an item next to **Copy** would mean patching a
code-signed application bundle, which is unsupported and is erased by every app update. A
control in the composer is the plugin-legal equivalent, and the panel it opens never blocks the
app underneath because the overlay layer is click-through by default.

## How it works

One occupant on the frame-wide `shell.overlay` slot (`replaceRisk: none`), which hosts the lookup
panel and short notices, plus one control on `conversation.input.left`. The
layer is click-through, so every element opts back into pointer events.

- **Scope.** A selection is eligible anywhere except the composer, `input`, `textarea`,
  `contenteditable`, and the overlay itself. It deliberately does not require a conversation
  marker: the exact markers could not be confirmed against the live DOM from outside the page,
  and a missing control is worse than one that also appears in another panel.
- **Anchor.** The panel is placed from the composer control's rect. Because the control sits at
  the bottom of the window, the panel is placed by its **bottom** edge and grows upward; the room
  above also caps it, and the answer area scrolls inside. The header and the box never scroll
  away.
- **Prefill.** The selection is read on click, because pressing a button can collapse it; the
  trigger's `mousedown` is prevented for the same reason, and the last eligible selection is
  kept as a fallback. The clipboard is read **only** when there is no selection, so an ordinary
  click never asks the browser for it.
- **Model and session.** The composer control is session-scoped, so the slot's `inject` hands it
  the session id and that session's model directory; the click reads the store's current provider,
  model, and reasoning effort and the Host calls exactly that route with the session id. A session
  that switched models keeps working even when the deployment default is stale, and session-routed
  gateways receive the header they require. Only when no selection is available does the Host fall
  back to the default.
- **The sentence around a selection.** The anchor node is walked up to the nearest block-level
  element (`p`, `li`, `blockquote`, `pre`, a table cell, a heading), the block's `innerText` is
  collapsed, and the sentence holding the selection is cut out. Sentence ends are `.!?` followed
  by a quote or bracket and then whitespace and a capital letter — good enough for rendered chat
  text.
- **Dismissal.** Escape, a click elsewhere, a page scroll, or a resize closes the panel. A scroll
  inside the panel — the answer's own scroll area — does not, because that would make a long
  answer impossible to read.
- **Language.** The dominant script picks the voice: Hangul → Korean, kana → Japanese,
  Han → Chinese, otherwise English. Latin text that merely quotes a Korean word stays on the
  English voice. A local voice for the language is preferred, then the platform default.
- **Speaking.** The speaker control in the answer header starts the system voice and turns into
  a stop control while the utterance runs; closing the panel or explaining again stops it. Each
  utterance carries a generation counter and the engine is cancelled first, so a superseded
  utterance can never clear the state of the live one.

### Where the lookup can read

- **Conversation transcript** — yes.
- **File previews for text, Markdown, and code** — yes. Those render in the page's own document
  (`pre`, `CodeBlock`, `MarkdownText`), so an ordinary selection reaches the control.
- **The embedded browser panel** — **no**. Its content is an `iframe` whose `src` is the page
  you navigated to (`http:`/`https:`), sandboxed with `allow-same-origin`, so it keeps the
  target site's origin. The page cannot read a selection inside a foreign frame, and events do
  not bubble out of one; only the app could cross that boundary, by injecting a script into the
  frame.
- **PDF and Office previews** — no, for the same reason: their renderers are iframes.
- **The terminal** — no; xterm.js keeps its own selection model rather than the browser's.
- **Composer, inputs, and contenteditable** — excluded on purpose, so drafts are never read.

**For text you cannot select in place** — the embedded browser page, a PDF — copy it (`⌘C`) and
open the panel. With nothing selected, the clipboard fills the box, exactly as if you had typed
it. The app's main window grants every permission except `media`, so the clipboard read is
allowed and the button click supplies the gesture it requires.

## Install

### From npm (any DSH)

The package is published as **`dsh-plugin-word-lookup`**.

1. In DSH, open **Plugins → Add plugin → Install a third-party plugin**.
2. Type `dsh-plugin-word-lookup` and press **Install**.
3. Choose **Enable now**, and restart if DSH reports that a restart is required.

Or, from a terminal:

```
dsh plugin add dsh-plugin-word-lookup
```

The package has **no** npm dependencies and **no** DSH peer requirement, so any DSH build with
the services it uses can install it: `llm`, `webServer`, `agentDefaultModel`, `shell.overlay`,
`conversation.input.left`, `slots`, and `locale`. It runs the session's own default model, so
there is no key to configure.

The plugin is self-contained: its dictionary-helper prompt is embedded in `lib/index.js`, so
the skill does not need to be installed on that device. If you also want the skill for normal
chat there, copy `~/.agents/skills/dictionary-helper`.

### From this checkout

Install the package from this directory into your DSH profile:

```
dsh plugin add .
```

The profile links this directory, so it must stay where it is while it is installed.

The package declares **no** `dependencies` or `peerDependencies`. That is deliberate: an unmet
DSH peer requirement blocks bundle activation outright, and packages shipped with dsh resolve
from the dsh installation.

### From a tarball (development)

Build the tarball with `npm pack`, copy it to the other device, then give **Add plugin** its
absolute local path or a direct URL. The dialog reads the package before installing, installs
it with pnpm, and offers **Enable now**.

### Iterating

Reload the page for `lib/client.js` changes. `lib/index.js` changes need an app restart,
because host hot reload is opt-in per module root and this profile watches none.

- Toggle it in **Plugins** in the sidebar.
- Uninstall it there too, or with `dsh plugin remove dsh-plugin-word-lookup`.

### Probes

The tests in `.dsh-probe/` run against stubs, with no app and no model:

```
node .dsh-probe/prompt-test.mjs    # task hints, input caps, fence stripping
node .dsh-probe/host-test.mjs      # route, retry, error status, method guard
node .dsh-probe/render-test.mjs    # prefill, Explain, markdown, speak, reload, empty box
```

## Limitations

- **The route is unauthenticated.** It binds to loopback, so only local processes can reach
  it, and the worst case is that one of them spends model tokens. Hardening it would need a
  secret injected into the page.
- **The explanation is generated, so it can be wrong.** It follows the dictionary-helper
  skill, not a fixed dictionary database.
- **One model call per Explain**, two when the first reply is empty. Cached per lookup text and
  model afterwards; **⟳** forces a fresh one.
- **A session with no model selection** uses the deployment default. If that default is
  unavailable, Explain reports the model error for that route.
- **System voice quality.** These are the OS voices, not a cloud model. Voice and rate are
  fixed at the engine default.
- **English and Chinese UI copy.** Those are the two built-in Client locales; the dictionary
  carries both. The explanation itself is always simple English, whichever locale is active.
- **The answer is not read aloud.** **🔊** reads the looked-up text (the bracketed phrase, or the
  whole box); the explanation stays on screen for reading.
- **The markdown renderer is deliberately small.** Bold, `Label:` lines, bullets, and inline
  code. Tables, links, and nested lists would show their source characters.
- **A word's sentence is lifted from its block.** In rendered chat that is normally a paragraph
  or a list item; a selection spanning several blocks falls back to the selection alone.
- **Long input is capped.** 2000 characters in the box, 400 for a lifted sentence, 12000 for the
  answer.

## Layout

| Path | Purpose |
| --- | --- |
| `package.json` | Bundle patch plus the `dsh.client` declaration for the browser half |
| `cordis.patch.yml` | Inserts the single `ui-speak-selection` Loader row |
| `lib/index.js` | Node half — the explanation route, the dictionary-helper prompt, the model call; imports nothing |
| `lib/client.js` | The whole browser feature: scope, selection, prefill, lookup panel, markdown renderer, speaking, cache |
| `locale/*.json` | Display metadata for the Plugins list |
| `.dsh-probe/` | Stubbed render and route tests |
