import { describe, expect, it } from "vitest";
import { normalizeMessages } from "../chatMessages";
import { applyCheckpoints, displayOrder } from "./checkpoints";

const options = [{ id: "a", label: "Option A" }, { id: "b", label: "Option B" }, { id: "c", label: "Option C" }];

const recording = [
  { role: "user", content: [{ type: "text", text: "Continue the task." }] },
  { role: "assistant", content: [{ type: "text", text: "Here is the state." }, { type: "toolCall", id: "call-1", name: "offer_options", arguments: { question: "Which way?", options } }] },
  { role: "toolResult", toolCallId: "call-1", toolName: "offer_options", content: [{ type: "text", text: "Which way?\n\n  a  Option A" }] },
  { role: "assistant", content: [{ type: "text", text: "Pick one with /pick" }] },
  { role: "custom", customType: "option_selection", content: "Option B", display: true, details: { id: "b", label: "Option B", question: "Which way?" } },
  { role: "assistant", content: [{ type: "text", text: "Doing B." }] },
];

describe("applyCheckpoints", () => {
  it("attaches the selection to its checkpoint and hides the protocol lines", () => {
    const lines = applyCheckpoints(normalizeMessages(recording));
    expect(lines).toHaveLength(normalizeMessages(recording).length);
    const parts = lines.flatMap((line) => line.parts);
    expect(parts.find((part) => part.type === "checkpoint")).toMatchObject({ question: "Which way?", options, selectedId: "b" });
    expect(parts.some((part) => part.type === "optionSelection" || part.type === "toolResult")).toBe(false);
    const texts = parts.flatMap((part) => part.type === "text" ? [part.text] : []);
    expect(texts).toEqual(["Continue the task.", "Here is the state.", "Doing B."]);
  });

  it("leaves the checkpoint open until a selection arrives", () => {
    const lines = applyCheckpoints(normalizeMessages(recording.slice(0, 4)));
    const checkpoint = lines.flatMap((line) => line.parts).find((part) => part.type === "checkpoint");
    expect(checkpoint).toBeDefined();
    expect(checkpoint).not.toHaveProperty("selectedId");
  });
});

describe("displayOrder", () => {
  it("is stable for a seed and keeps every option", () => {
    const first = displayOrder(options, "session-1:call-1");
    expect(displayOrder(options, "session-1:call-1")).toEqual(first);
    expect([...first].sort((x, y) => x.id.localeCompare(y.id))).toEqual(options);
  });
});
