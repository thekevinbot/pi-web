// @vitest-environment happy-dom

import { LitElement, html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialAppState, type AppState } from "../appState";
import type { SessionInfo, SessionStatus, SessionWarning, Workspace } from "../api";
import { SessionController } from "../controllers/sessionController";
import { reportBrowserError, sessionBrowserErrorScope, workspaceBrowserErrorScope, type BrowserErrorRecovery } from "../browserErrors";
import { machineSessionKey } from "../machineKeys";
import { saveDraft } from "../promptDraftStorage";
import { clearStagedAttachments, saveStagedAttachments } from "../promptAttachmentStaging";
import { PromptEditor } from "./PromptEditor";
import { StatusBar } from "./StatusBar";
import { PluginRegistry } from "../plugins/registry";
import { corePlugin } from "../plugins/core";
import type { WorkspacePanelContext } from "../plugins/types";
import { PiWebApp } from "./PiWebApp";
import { ChatView } from "./ChatView";
import { FormattedText } from "./FormattedText";
import { WorkspacePanel } from "./WorkspacePanel";
import { WorkspaceList } from "./WorkspaceList";
import { ProjectList } from "./ProjectList";
import { SessionList } from "./SessionList";
import { deepActiveElement } from "./modalLayerRegistry";

// Exercise the real shell and child rendering without starting API/socket
// orchestration. The inherited Lit controllers and update lifecycle still run.
class RenderOnlyApp extends PiWebApp {
  override connectedCallback(): void {
    LitElement.prototype.connectedCallback.call(this);
  }
}
customElements.define("render-only-pi-web-app", RenderOnlyApp);

const workspace: Workspace = { id: "workspace", projectId: "project", path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
const session: SessionInfo = { id: "session", path: "/repo/session.jsonl", cwd: "/repo", name: "Current chat", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };

const unexpectedRequest = vi.fn(() => Promise.reject(new Error("Rendering tests must not make network requests")));

beforeEach(() => {
  unexpectedRequest.mockClear();
  window.history.replaceState(null, "", "/");
  vi.stubGlobal("fetch", unexpectedRequest);
  // Scroll scheduling is not under test; happy-dom supplies no layout metrics.
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  clearStagedAttachments(machineSessionKey("local", session.id));
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(unexpectedRequest).not.toHaveBeenCalled();
});

describe("application rendering boundaries", () => {
  it("keeps the activity notice in the blocked composer until dismissal without losing drafts or attachments", async () => {
    const send = vi.spyOn(SessionController.prototype, "send").mockResolvedValue(true);
    const key = machineSessionKey("local", session.id);
    saveDraft(key, "Unsent draft");
    saveStagedAttachments(key, [{ id: "file", kind: "file", name: "notes.txt", mimeType: "text/plain", data: "aGk=", size: 2 }]);
    const app = await mountApp({ selectedSession: session, status: sessionStatus(session.id) });
    await settle(app);
    const editor = promptEditor(app);
    expect(editor.disabled).toBe(false);

    patchState(app, { status: { ...sessionStatus(session.id, [{ severity: "warning", message: "Ordinary runtime warning" }]), recentlyActiveElsewhere: true } });
    await settle(app);
    const notice = app.shadowRoot?.querySelector(".composer-activity-notice");
    expect(notice?.getAttribute("role")).toBe("alert");
    expect(notice?.textContent).toContain("Recently active in another PI-WEB instance");
    expect(notice?.parentElement).toBe(editor.parentElement);
    expect(editor.parentElement?.classList.contains("composer-area")).toBe(true);
    expect(notice?.previousElementSibling).toBe(editor);
    expect(editor.hasAttribute("inert")).toBe(true);
    expect(editor.disabled).toBe(true);
    expect(editor.view?.contentDOM.getAttribute("contenteditable")).toBe("false");
    const sendButton = editor.shadowRoot?.querySelector<HTMLButtonElement>(".send-button");
    expect(sendButton?.disabled).toBe(true);
    sendButton?.click();
    editor.view?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, composed: true }));
    expect(send).not.toHaveBeenCalled();

    const chat = app.shadowRoot?.querySelector("chat-view");
    expect(chat?.hasAttribute("inert")).toBe(false);
    expect(chat?.shadowRoot?.textContent).not.toContain("Recently active in another PI-WEB instance");
    expect(chat?.shadowRoot?.textContent).toContain("Ordinary runtime warning");
    const statusBar = app.shadowRoot?.querySelector<StatusBar>("status-bar");
    expect(statusBar?.warningCount).toBe(1);
    statusBar?.shadowRoot?.querySelector<HTMLButtonElement>(".warning-toggle")?.click();
    await settle(app);
    expect(chat?.shadowRoot?.textContent).not.toContain("Ordinary runtime warning");
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBe(notice);
    expect(editor.disabled).toBe(true);

    dismissActivityNotice(app);
    await settle(app);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBeNull();
    expect(promptEditor(app)).toBe(editor);
    expect(editor.hasAttribute("inert")).toBe(false);
    expect(editor.disabled).toBe(false);
    expect(editor.view?.contentDOM.getAttribute("contenteditable")).toBe("true");
    expect(editor.view?.state.doc.toString()).toBe("Unsent draft");
    expect(editor.shadowRoot?.querySelector(".attachments")?.textContent).toContain("notes.txt");
    expect(deepActiveElement(document)).toBe(editor.view?.contentDOM);
    sendButton?.click();
    expect(send).toHaveBeenCalledOnce();
  });

  it("scopes activity acknowledgement by machine/session and asks again after activity elsewhere clears", async () => {
    const status = { ...sessionStatus(session.id), recentlyActiveElsewhere: true };
    const app = await mountApp({ selectedSession: session, status });
    await settle(app);
    dismissActivityNotice(app);
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    expect(app.shadowRoot?.querySelector<StatusBar>("status-bar")?.warningCount).toBe(0);
    // Missing activity information, a stale session status, or unrelated warnings must not erase acknowledgement.
    patchState(app, { status: undefined });
    await settle(app);
    const missingActivityStatus: SessionStatus = { ...status };
    delete missingActivityStatus.recentlyActiveElsewhere;
    patchState(app, { status: missingActivityStatus });
    await settle(app);
    patchState(app, { status: sessionStatus("unrelated-session") });
    await settle(app);
    patchState(app, { status: { ...status, warnings: [{ severity: "warning", message: "New runtime warning" }] } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    const otherSession = { ...session, id: "other-session" };
    patchState(app, { selectedSession: otherSession, status: { ...status, sessionId: otherSession.id } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    patchState(app, { selectedSession: session, status });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    patchState(app, { selectedMachine: { id: "remote", name: "Remote", kind: "remote", baseUrl: "https://remote.test", createdAt: "now", updatedAt: "now" } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    dismissActivityNotice(app);
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);
    patchState(app, { selectedMachine: undefined });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);

    patchState(app, { status: sessionStatus(session.id) });
    await settle(app);
    patchState(app, { status });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).not.toBeNull();
  });

  it("re-arms the notice when activity clears and resumes while another session is selected", async () => {
    const status = { ...sessionStatus(session.id), recentlyActiveElsewhere: true };
    const app = await mountApp({ selectedSession: session, status, sessionStatuses: { [session.id]: status } });
    await settle(app);
    dismissActivityNotice(app);
    await settle(app);

    const otherSession = { ...session, id: "other-session" };
    patchState(app, { selectedSession: otherSession, status: sessionStatus(otherSession.id) });
    await settle(app);
    patchState(app, { sessionStatuses: { [session.id]: sessionStatus(session.id) } });
    await settle(app);
    patchState(app, { sessionStatuses: { [session.id]: status } });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(false);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBeNull();

    patchState(app, { selectedSession: session, status });
    await settle(app);
    expect(promptEditor(app).disabled).toBe(true);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).not.toBeNull();
  });

  it("does not re-enable archived sessions when the activity notice is dismissed", async () => {
    const app = await mountApp({ selectedSession: { ...session, archived: true }, status: { ...sessionStatus(session.id), recentlyActiveElsewhere: true } });
    await settle(app);
    dismissActivityNotice(app);
    await settle(app);
    expect(app.shadowRoot?.querySelector(".composer-activity-notice")).toBeNull();
    expect(promptEditor(app).disabled).toBe(true);
  });

  it("does not update the selected chat for unrelated shell state, but does update its transcript", async () => {
    const app = await mountApp({ selectedSession: session, sessions: [session], messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }] });
    await settle(app);
    const chat = app.shadowRoot?.querySelector("chat-view");
    if (!(chat instanceof ChatView)) throw new Error("Expected selected chat");
    const render = vi.spyOn(chat, "render");

    patchState(app, { error: "Unrelated shell notice" });
    await settle(app);
    expect(render).not.toHaveBeenCalled();

    patchState(app, { messages: [{ role: "user", parts: [{ type: "text", text: "new transcript" }] }] });
    await settle(app);
    expect(render).toHaveBeenCalledOnce();
    expect(chat.messages[0]?.parts[0]).toEqual({ type: "text", text: "new transcript" });
  });

  it("refreshes guarded surfaces when built-in registration finishes asynchronously", async () => {
    let finishActivation: () => void = () => { throw new Error("Activation gate was not initialized"); };
    const ready = new Promise<void>((resolve) => { finishActivation = resolve; });
    vi.spyOn(corePlugin, "activate").mockImplementationOnce(async () => {
      await ready;
      return { contributions: { workspacePanels: [{
        id: "late-panel", title: "Late panel", render: () => html`<p>Loaded asynchronously</p>`,
      }] } };
    });
    const app = await mountApp({ selectedWorkspace: workspace, workspaces: [workspace] });
    Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
    await settle(app);
    expect(app.shadowRoot?.querySelector("workspace-panel")?.shadowRoot?.textContent).not.toContain("Loaded asynchronously");

    finishActivation();
    const registration: unknown = Reflect.get(app, "builtInPluginsReady");
    if (!(registration instanceof Promise)) throw new Error("Expected built-in registration");
    await registration;
    await settle(app);
    expect(app.shadowRoot?.querySelector("workspace-panel")?.shadowRoot?.textContent).toContain("Loaded asynchronously");
  });

  it("keeps navigation lists and workspace tools outside transcript-only updates", async () => {
    const panelRender = vi.fn(() => html`<p>Workspace tool</p>`);
    const app = await mountApp({ selectedWorkspace: workspace, workspaces: [workspace] }, panelRender);
    await settle(app);
    const workspacePanel = app.shadowRoot?.querySelector("workspace-panel");
    if (!(workspacePanel instanceof WorkspacePanel)) throw new Error("Expected workspace panel");
    const workspaceRender = vi.spyOn(workspacePanel, "render");
    const lists = [ProjectList, WorkspaceList, SessionList].map((component) => vi.spyOn(component.prototype, "render"));
    panelRender.mockClear();

    patchState(app, { messages: [{ role: "assistant", parts: [{ type: "text", text: "streaming" }] }] });
    await settle(app);
    expect(workspaceRender).not.toHaveBeenCalled();
    expect(panelRender).not.toHaveBeenCalled();
    for (const render of lists) expect(render).not.toHaveBeenCalled();
  });

  it("refreshes query and upload capabilities without a workspace change", async () => {
    let context: WorkspacePanelContext | undefined;
    const app = await mountApp({ selectedWorkspace: workspace, workspaces: [workspace] }, (next) => {
      context = next;
      return html`<p>Tool</p>`;
    });
    await settle(app);
    if (context === undefined) throw new Error("Expected plugin context");
    const previousFiles = context.files;

    window.history.replaceState(null, "", "?project=project&workspace=workspace&render-test.panel--item=next");
    app.requestUpdate();
    await settle(app);
    expect(context.navigation?.query["item"]).toBe("next");

    Reflect.set(app, "workspaceUploadDefaultFolder", "new-uploads");
    await settle(app);
    expect(context.files).not.toBe(previousFiles);
    expect(context.files.capabilityVersion).toBe(1);
    if (context.files.capabilityVersion !== 1) throw new Error("Expected files capability");
    expect(context.files.defaultUploadFolder).toBe("new-uploads");
  });

  it("renews workspace navigation after reselecting the active Chat tab", async () => {
    window.history.replaceState(null, "", "?project=project&workspace=workspace&tool=render-test%3Apanel&view=chat");
    let context: WorkspacePanelContext | undefined;
    const app = await mountApp({
      selectedProject: { id: "project", name: "Project", path: "/repo", createdAt: "now" },
      selectedWorkspace: workspace, workspaces: [workspace],
      workspaceTool: "render-test:panel", mainView: "chat",
    }, (next) => {
      context = next;
      return html`<button aria-label="Open folder" @click=${() => next.navigation?.set("folder", "src")}>Open folder</button>`;
    });
    await settle(app);
    const previousContext = context;
    const url = window.location.href;
    const chat = app.shadowRoot?.querySelector("app-mobile-main-tabs")?.shadowRoot?.querySelector<HTMLButtonElement>('button[title="Chat"]');
    if (chat === undefined || chat === null) throw new Error("Expected Chat tab");
    chat.click();
    await settle(app);
    expect(window.location.href).toBe(url);
    expect(previousContext?.navigation?.set("folder", "stale")).toBe(false);

    const folder = app.shadowRoot?.querySelector("workspace-panel")?.shadowRoot?.querySelector('button[aria-label="Open folder"]');
    if (!(folder instanceof HTMLButtonElement)) throw new Error("Expected folder action");
    folder.click();
    await settle(app);
    expect(new URL(window.location.href).searchParams.get("render-test.panel--folder")).toBe("src");
  });

  it("opens chat file links through generic panel navigation and rejects stale workspace requests", async () => {
    const app = await mountApp({
      selectedProject: { id: "project", name: "Project", path: "/repo", createdAt: "now" },
      selectedWorkspace: workspace, workspaces: [workspace], selectedSession: session, sessions: [session],
      mainView: "chat", messages: [{ role: "assistant", parts: [{ type: "text", text: "[file](./reports/a%20%231.txt)" }] }],
    });
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Expected plugin registry");
    Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
    const fileOpenQuery = vi.fn((_context: WorkspacePanelContext, path: string) => ({ file: path }));
    await registry.register({ id: "viewer", plugin: {
      apiVersion: 4, name: "Viewer", activate: () => ({ contributions: { workspacePanels: [{
        id: "files", title: "Viewer", fileOpenQuery,
        render: (context) => html`<p>Selected: ${context.navigation?.query["file"]}</p>`,
      }] } }),
    } });
    await settle(app);
    const chat = app.shadowRoot?.querySelector("chat-view");
    const formatted = chat?.shadowRoot?.querySelector("formatted-text");
    if (!(formatted instanceof FormattedText)) throw new Error("Expected formatted chat text");
    const anchor = formatted.shadowRoot?.querySelector("a");
    if (!(anchor instanceof HTMLAnchorElement)) throw new Error("Expected file link");
    const detail = { machineId: "local", projectId: "project", workspaceId: "workspace", root: "/repo", path: "reports/a #1.txt" };
    for (const field of ["machineId", "projectId", "workspaceId", "root"] as const) {
      const stale = new CustomEvent("workspace-file-open", {
        detail: { ...detail, [field]: "stale" }, bubbles: true, composed: true, cancelable: true,
      });
      formatted.dispatchEvent(stale);
      expect(stale.defaultPrevented).toBe(false);
    }
    expect(fileOpenQuery).not.toHaveBeenCalled();

    const click = new MouseEvent("click", { bubbles: true, composed: true, cancelable: true });
    anchor.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(fileOpenQuery).toHaveBeenCalledOnce();
    expect(anchor.href).toContain("download=1");
    await settle(app);
    const query = new URL(window.location.href).searchParams;
    expect(query.get("tool")).toBe("viewer:files");
    expect(query.get("viewer.files--file")).toBe("reports/a #1.txt");
    expect(app.shadowRoot?.querySelector("workspace-panel")?.shadowRoot?.textContent).toContain("Selected: reports/a #1.txt");

    await registry.dispose();
    const unhandled = new CustomEvent("workspace-file-open", { detail, bubbles: true, composed: true, cancelable: true });
    formatted.dispatchEvent(unhandled);
    expect(unhandled.defaultPrevented).toBe(false);
  });

  it.each(["session-refresh", "workspace-sessions-refresh"] as const)("offers Retry for a persistent %s failure without a reconnect banner", async (recovery: BrowserErrorRecovery) => {
    window.history.replaceState(null, "", `?${new URLSearchParams({ project: workspace.projectId, workspace: workspace.id, session: session.id })}`);
    const scope = recovery === "session-refresh"
      ? sessionBrowserErrorScope("local", session.id, { cwd: session.cwd, projectId: workspace.projectId, workspaceId: workspace.id })
      : workspaceBrowserErrorScope("local", workspace.projectId, workspace.id);
    const app = await mountApp({
      selectedProject: { id: workspace.projectId, name: "Project", path: workspace.path, createdAt: "now" },
      selectedWorkspace: workspace, selectedSession: session, mainView: "chat",
      browserErrors: reportBrowserError({}, scope, "Updates could not be refreshed. Check your connection and retry.", recovery),
    });
    const sessions: unknown = Reflect.get(app, "sessions");
    if (!(sessions instanceof SessionController)) throw new Error("Expected SessionController");
    const refreshSelected = vi.spyOn(sessions, "refreshSelectedSession").mockResolvedValue();
    const refreshWorkspace = vi.spyOn(sessions, "refreshCurrentWorkspaceSessions").mockResolvedValue();
    await settle(app);
    const retry = [...app.shadowRoot?.querySelectorAll<HTMLButtonElement>("main .error button") ?? []].find((button) => button.textContent.trim() === "Retry");
    if (retry === undefined) throw new Error("Expected a recovery Retry button");
    retry.click();

    if (recovery === "session-refresh") {
      expect(refreshSelected).toHaveBeenCalledExactlyOnceWith(session.id, { recoverNetwork: true });
      expect(refreshWorkspace).not.toHaveBeenCalled();
    } else {
      expect(refreshWorkspace).toHaveBeenCalledExactlyOnceWith("local", { recoverNetwork: true });
      expect(refreshSelected).not.toHaveBeenCalled();
    }
    expect(app.shadowRoot?.textContent).not.toContain("Reconnecting");
  });

  it("does not offer automatic recovery for a failed user action", async () => {
    window.history.replaceState(null, "", `?${new URLSearchParams({ session: session.id })}`);
    const app = await mountApp({
      selectedWorkspace: workspace, selectedSession: session, mainView: "chat",
      browserErrors: reportBrowserError({}, sessionBrowserErrorScope("local", session.id), "Prompt delivery could not be confirmed"),
    });
    await settle(app);
    expect(app.shadowRoot?.textContent).toContain("Prompt delivery could not be confirmed");
    const retry = [...app.shadowRoot?.querySelectorAll<HTMLButtonElement>("main .error button") ?? []].find((button) => button.textContent.trim() === "Retry");
    expect(retry).toBeUndefined();
  });

  it("updates the workspace empty state as project loading completes", async () => {
    const app = await mountApp({ isLoadingProjects: true });
    await settle(app);
    expect(app.shadowRoot?.querySelector("workspace-panel")?.shadowRoot?.textContent).toContain("Loading projects");
    patchState(app, { isLoadingProjects: false });
    await settle(app);
    expect(app.shadowRoot?.querySelector("workspace-panel")?.shadowRoot?.textContent).toContain("No projects yet");
  });
});

function sessionStatus(sessionId: string, warnings: SessionWarning[] = []): SessionStatus {
  return {
    sessionId, isStreaming: false, isCompacting: false, isBashRunning: false,
    recentlyActiveElsewhere: false,
    pendingMessageCount: 0, queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0,
    warnings,
  };
}

function promptEditor(app: PiWebApp): PromptEditor {
  const editor = app.shadowRoot?.querySelector("prompt-editor");
  if (!(editor instanceof PromptEditor)) throw new Error("Expected prompt editor");
  return editor;
}

function dismissActivityNotice(app: PiWebApp): void {
  const button = app.shadowRoot?.querySelector<HTMLButtonElement>(".composer-activity-notice button");
  if (button == null) throw new Error("Expected activity notice dismissal");
  expect(button.textContent).toBe("Dismiss and continue");
  button.click();
}

async function mountApp(patch: Partial<AppState>, panelRender?: (context: WorkspacePanelContext) => ReturnType<typeof html>, label?: () => string): Promise<RenderOnlyApp> {
  const app = new RenderOnlyApp();
  if (panelRender !== undefined) {
    const registry: unknown = Reflect.get(app, "plugins");
    if (!(registry instanceof PluginRegistry)) throw new Error("Expected plugin registry");
    // Recovery mode permits an ordinary plugin without booting the terminal
    // backend; this test only needs the workspace rendering contract.
    Reflect.set(app, "verifiedPluginModeByMachine", new Map([["local", "recovery-disabled"]]));
    await registry.register({
      id: "render-test",
      plugin: {
        apiVersion: 4, name: "Render test",
        activate: () => ({ contributions: {
          workspacePanels: [{ id: "panel", title: "Test", render: panelRender, ...(label === undefined ? {} : { badge: label }) }],
          ...(label === undefined ? {} : { workspaceLabels: [{ id: "label", items: () => [{ type: "text" as const, text: label() }] }] }),
        } }),
      },
    });
  }
  Reflect.set(app, "state", { ...initialAppState(), ...patch });
  document.body.append(app);
  return app;
}

function patchState(app: PiWebApp, patch: Partial<AppState>): void {
  const state: unknown = Reflect.get(app, "state");
  if (typeof state !== "object" || state === null) throw new Error("Expected app state");
  Reflect.set(app, "state", { ...state, ...patch });
}

async function settle(element: LitElement): Promise<void> {
  await element.updateComplete;
  for (const child of element.shadowRoot?.querySelectorAll("*") ?? []) {
    if (child instanceof LitElement) await settle(child);
  }
  await element.updateComplete;
}
