/**
 * Exercise the Host's prompt helpers: the task hint a lookup box needs, the input
 * trim and cap, and the fence stripping an answer gets.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("lib/index.js", "utf8");
const slice = source.slice(source.indexOf("const MAX_INPUT"), source.indexOf("function readBody"));
const { taskHint, readInput, cleanAnswer, SYSTEM } = new Function(slice + "\nreturn { taskHint, readInput, cleanAnswer, SYSTEM };")();

// The system prompt carries the skill's task formats and its most important rule.
assert.match(SYSTEM, /dictionary-helper/);
assert.match(SYSTEM, /Task A format/);
assert.match(SYSTEM, /Task C format/);
assert.match(SYSTEM, /Task D format/);
assert.match(SYSTEM, /\*\*In general\*\*/);
assert.match(SYSTEM, /Would a 10-year-old understand this/);
assert.match(SYSTEM, /Bad: "It denotes/);
assert.match(SYSTEM, /beginner-friendly English/);
assert.match(SYSTEM, /No code fence/);

// The task hint covers every shape the lookup box can send.
assert.match(taskHint("piece"), /Task A/);
assert.match(taskHint("piece of cake"), /Task B/);
assert.match(taskHint("This test is a <piece of cake>."), /Task C/);
assert.match(taskHint("The cat sat on the mat."), /Task B when this is a fixed expression/);
assert.match(taskHint("/analysis The cat sat on the mat."), /Task D/);
assert.match(taskHint("/fix He go home."), /Task E/);
assert.match(taskHint("/question What is a gerund?"), /Task F/);
assert.match(taskHint("/analysisx not a command"), /Task B when this is a fixed expression/, "a command must be the whole first word");

// Input is trimmed, capped, and keeps its newlines.
assert.equal(readInput("  hello  "), "hello");
assert.equal(readInput(42), "");
assert.equal(readInput(null), "");
assert.equal(readInput("a".repeat(2500)).length, 2000);
assert.equal(readInput("one\r\ntwo"), "one\ntwo");

// A fenced answer loses the fence; anything else is only trimmed.
assert.equal(cleanAnswer("```markdown\n**word**\nIPA: /x/\n```"), "**word**\nIPA: /x/");
assert.equal(cleanAnswer("```\nplain\n```"), "plain");
assert.equal(cleanAnswer("  **word**  "), "**word**");
assert.equal(cleanAnswer(void 0), "");

console.log("prompt test: all assertions passed");
