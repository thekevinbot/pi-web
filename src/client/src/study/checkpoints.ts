import type { ChatLine, ChatPart, CheckpointOption } from "../components/shared";

// Laith's checkpoint extension: the agent calls `offer_options`, and `/pick <id>`
// records the answer as an `option_selection` custom message.
export const OFFER_OPTIONS_TOOL = "offer_options";
export const OPTION_SELECTION_CUSTOM_TYPE = "option_selection";

export function pickCommand(optionId: string): string {
  return `/pick ${optionId}`;
}

type CheckpointPart = Extract<ChatPart, { type: "checkpoint" }>;

export function checkpointPart(toolCallId: string | undefined, args: unknown): CheckpointPart | undefined {
  if (!isRecord(args)) return undefined;
  const { question, options } = args;
  if (typeof question !== "string" || !Array.isArray(options)) return undefined;
  const parsed = options.flatMap((option): CheckpointOption[] => {
    if (!isRecord(option)) return [];
    const { id, label } = option;
    return typeof id === "string" && typeof label === "string" ? [{ id, label }] : [];
  });
  if (parsed.length === 0) return undefined;
  return { type: "checkpoint", ...(toolCallId === undefined ? {} : { toolCallId }), question, options: parsed };
}

export function optionSelectionPart(details: unknown): Extract<ChatPart, { type: "optionSelection" }> | undefined {
  if (!isRecord(details) || typeof details["id"] !== "string") return undefined;
  return { type: "optionSelection", id: details["id"] };
}

/**
 * Attach each answer to its checkpoint and hide the protocol plumbing: the
 * selection message, the tool result, and the agent's "pick one" reply. Keeps
 * one output line per input line so transcript indexes stay valid.
 */
export function applyCheckpoints(lines: readonly ChatLine[]): ChatLine[] {
  const out = lines.map((line) => ({ ...line, parts: [...line.parts] }));
  let open: { line: ChatLine; part: CheckpointPart } | undefined;
  const close = (update: Partial<CheckpointPart>) => {
    if (open === undefined) return;
    const { line, part } = open;
    line.parts = line.parts.map((candidate) => candidate === part ? { ...part, ...update } : candidate);
    open = undefined;
  };
  for (const line of out) {
    line.parts = line.parts.flatMap((part): ChatPart[] => {
      if (part.type === "checkpoint") {
        close({ skipped: true });
        open = { line, part };
        return [part];
      }
      if (part.type === "optionSelection") {
        close({ selectedId: part.id });
        return [];
      }
      if (open !== undefined && (part.type === "toolResult" || part.type === "toolExecution") && part.toolName === OFFER_OPTIONS_TOOL) return [];
      if (open !== undefined && line.role === "assistant" && part.type === "text") return [];
      return [part];
    });
    if (line.role === "user") close({ skipped: true });
  }
  return out;
}

/** Stable per-participant order: the UI, not the agent, decides display order. */
export function displayOrder(options: readonly CheckpointOption[], seed: string): CheckpointOption[] {
  return [...options]
    .map((option) => ({ option, rank: hash(`${seed}:${option.id}`) }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ option }) => option);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The checkpoint still waiting for an answer, if the last one is unanswered. */
export function openCheckpoint(lines: readonly ChatLine[]): CheckpointPart | undefined {
  const checkpoints = applyCheckpoints(lines).flatMap((line) => line.parts.filter((part): part is CheckpointPart => part.type === "checkpoint"));
  const last = checkpoints.at(-1);
  return last === undefined || last.selectedId !== undefined || last.skipped === true ? undefined : last;
}
