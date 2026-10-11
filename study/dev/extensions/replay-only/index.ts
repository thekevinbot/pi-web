import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// pi-web registers its own `edit` tool, which `defaultTools` cannot remove.
export default function replayOnly(pi: ExtensionAPI) {
  pi.on("before_agent_start", () => {
    pi.setActiveTools(["offer_options"]);
  });
}
