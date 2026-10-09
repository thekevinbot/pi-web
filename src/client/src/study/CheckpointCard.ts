import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { CheckpointOption } from "../components/shared";

@customElement("checkpoint-card")
export class CheckpointCard extends LitElement {
  @property() question = "";
  /** Already in display order. */
  @property({ attribute: false }) options: CheckpointOption[] = [];
  @property() selectedId: string | undefined;
  @property({ type: Boolean }) skipped = false;
  @property({ attribute: false }) onPick: ((optionId: string) => void | Promise<void>) | undefined;
  @state() private submittedId: string | undefined;

  override render() {
    const chosen = this.selectedId ?? this.submittedId;
    const answerable = chosen === undefined && !this.skipped && this.onPick !== undefined;
    return html`
      <section class="card" aria-label="Choose how to proceed">
        <p class="question" dir="auto">${this.question}</p>
        <ol class="options">
          ${this.options.map((option) => html`
            <li>
              <button
                type="button"
                class=${option.id === chosen ? "option chosen" : "option"}
                ?disabled=${!answerable}
                aria-pressed=${option.id === chosen ? "true" : "false"}
                data-option-id=${option.id}
                @click=${() => { void this.pick(option.id); }}
              >${option.label}</button>
            </li>
          `)}
        </ol>
      </section>
    `;
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
    :host { display: block; margin: 0 0 14px; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    .card { border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); padding: 10px 12px 12px; }
    .question { margin: 0 0 10px; font-weight: 600; }
    .options { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .option {
      width: 100%; padding: 8px 10px; border: 1px solid var(--pi-border); border-radius: 8px;
      background: var(--pi-bg); color: inherit; font: inherit; text-align: start; cursor: pointer;
    }
    .option:hover:not(:disabled), .option:focus-visible { border-color: var(--pi-accent); outline: none; }
    .option:disabled { cursor: default; opacity: 0.55; }
    .option.chosen { opacity: 1; border-color: var(--pi-accent); background: color-mix(in srgb, var(--pi-accent) 12%, var(--pi-bg)); }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "checkpoint-card": CheckpointCard;
  }
}
