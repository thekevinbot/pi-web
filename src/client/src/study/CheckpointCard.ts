import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CheckpointOption } from "../components/shared";

const OWN = "\u0000own";

/** Takes the composer's place while a checkpoint waits for an answer. */
@customElement("checkpoint-card")
export class CheckpointCard extends LitElement {
  @property() checkpointId = "";
  @property() question = "";
  /** Already in display order. */
  @property({ attribute: false }) options: CheckpointOption[] = [];
  @property({ attribute: false }) onPick: ((optionId: string) => void | Promise<void>) | undefined;
  @property({ attribute: false }) onWriteOwn: ((text: string) => boolean | Promise<boolean>) | undefined;
  @state() private submittedId: string | undefined;
  @state() private ownText = "";

  override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("checkpointId")) {
      this.submittedId = undefined;
      this.ownText = "";
    }
  }

  override render() {
    const answerable = this.submittedId === undefined && this.onPick !== undefined;
    return html`
      <section class="card" aria-label="Choose how to proceed">
        <p class="label">Your call</p>
        <p class="question" dir="auto">${this.question}</p>
        <ol class="options">
          ${this.options.map((option) => html`
            <li>
              <button
                type="button"
                class=${option.id === this.submittedId ? "option chosen" : "option"}
                ?disabled=${!answerable}
                aria-pressed=${option.id === this.submittedId ? "true" : "false"}
                data-option-id=${option.id}
                @click=${() => { void this.pick(option.id); }}
              ><span class="num" aria-hidden="true"></span>${option.label}</button>
            </li>
          `)}
          ${this.onWriteOwn === undefined ? null : html`
            <li>
              <input
                class=${this.submittedId === OWN ? "option own chosen" : "option own"}
                placeholder="Other: type your own answer, Enter to send"
                aria-label="Other"
                .value=${this.ownText}
                ?disabled=${!answerable}
                @input=${(event: Event) => { if (event.target instanceof HTMLInputElement) this.ownText = event.target.value; }}
                @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); void this.writeOwn(); } }}
              >
            </li>
          `}
        </ol>
      </section>
    `;
  }

  private async writeOwn(): Promise<void> {
    const text = this.ownText.trim();
    if (text === "" || this.submittedId !== undefined || this.onWriteOwn === undefined) return;
    this.submittedId = OWN;
    try {
      if (!await this.onWriteOwn(text)) this.submittedId = undefined;
    } catch {
      this.submittedId = undefined;
    }
  }

  private async pick(optionId: string): Promise<void> {
    if (this.submittedId !== undefined || this.onPick === undefined) return;
    this.submittedId = optionId;
    try {
      await this.onPick(optionId);
    } catch {
      this.submittedId = undefined;
    }
  }

  static override styles = css`
    :host { display: block; padding: 10px 16px 12px; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .card {
      max-width: 900px; margin: 0 auto; padding: 12px 14px 14px; border: 1.5px solid var(--pi-accent); border-radius: 12px;
      background: color-mix(in srgb, var(--pi-accent) 7%, var(--pi-bg));
      box-shadow: 0 -6px 24px color-mix(in srgb, var(--pi-shadow-strong, #000) 25%, transparent);
    }
    .label { margin: 0 0 4px; color: var(--pi-accent); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .question { margin: 0 0 10px; font-weight: 600; }
    .options { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; counter-reset: option; }
    .option {
      display: flex; align-items: baseline; gap: 10px;
      width: 100%; padding: 8px 10px; border: 1px solid var(--pi-border); border-radius: 8px;
      background: var(--pi-bg); color: inherit; font: inherit; text-align: start; cursor: pointer;
    }
    .num { flex: 0 0 auto; color: var(--pi-muted); font-variant-numeric: tabular-nums; }
    .num::before { counter-increment: option; content: counter(option) "."; }
    .option:hover:not(:disabled), .option:focus-visible { border-color: var(--pi-accent); outline: none; }
    .option:disabled { cursor: default; opacity: 0.55; }
    .option.chosen { opacity: 1; border-color: var(--pi-accent); background: color-mix(in srgb, var(--pi-accent) 12%, var(--pi-bg)); }
    .own { box-sizing: border-box; cursor: text; }
    .own::placeholder { color: var(--pi-muted); }
  `;
}

/** What the transcript keeps of an answered checkpoint. */
@customElement("checkpoint-record")
export class CheckpointRecord extends LitElement {
  @property() question = "";
  @property() choice: string | undefined;

  override render() {
    return html`
      <p class="question" dir="auto">${this.question}</p>
      ${this.choice === undefined ? null : html`<p class="choice" dir="auto">Chose: ${this.choice}</p>`}
    `;
  }

  static override styles = css`
    :host { display: block; margin: 0 0 14px; padding-left: 10px; border-left: 2px solid var(--pi-border); color: var(--pi-muted); font: 13px system-ui, sans-serif; }
    p { margin: 0; }
    .choice { margin-top: 2px; color: var(--pi-text); }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "checkpoint-card": CheckpointCard;
    "checkpoint-record": CheckpointRecord;
  }
}
