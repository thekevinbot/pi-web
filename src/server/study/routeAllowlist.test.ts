import { describe, expect, it } from "vitest";
import { isStudyBodyAllowed, isStudyRouteAllowed } from "./routeAllowlist.js";

const s = "/api/machines/local/sessions/abc";

describe("isStudyRouteAllowed", () => {
  it.each([
    ["GET", "/"],
    ["GET", "/assets/index-abc.js"],
    ["GET", "/pi-web-plugins/files/browser/pi-web-plugin.js"],
    ["GET", "/api/pi-web/status?refresh=1"],
    ["GET", "/api/projects/p1/workspaces/w1/tree"],
    ["GET", `${s}/transcript-snapshot`],
    ["GET", "/api/machines/local/events"],
    ["POST", `${s}/prompt`],
    ["POST", `${s}/commands/run`],
    ["POST", `${s}/unread/acknowledge`],
  ])("allows %s %s", (method, url) => {
    expect(isStudyRouteAllowed(method, url)).toBe(true);
  });

  it.each([
    ["POST", `${s}/shell`],
    ["POST", "/api/sessions"],
    ["POST", "/api/projects"],
    ["DELETE", "/api/projects/p1"],
    ["PUT", "/api/config"],
    ["GET", "/api/pi-packages"],
    ["GET", "/api/project-directories"],
    ["GET", `${s}%2F..%2Fshell`],
    ["GET", "/api/projects/p1/workspaces/w1/../../x"],
    ["POST", "/"],
    ["GET", "/api/machines/remote/sessions"],
  ])("blocks %s %s", (method, url) => {
    expect(isStudyRouteAllowed(method, url)).toBe(false);
  });
});

describe("isStudyBodyAllowed", () => {
  it("allows only /pick through commands/run", () => {
    expect(isStudyBodyAllowed(`${s}/commands/run`, { text: "/pick a" })).toBe(true);
    expect(isStudyBodyAllowed(`${s}/commands/run`, { text: "/reload" })).toBe(false);
    expect(isStudyBodyAllowed(`${s}/commands/run`, { text: "/pick" })).toBe(false);
  });

  it("rejects prompt attachments", () => {
    expect(isStudyBodyAllowed(`${s}/prompt`, { text: "hi" })).toBe(true);
    expect(isStudyBodyAllowed(`${s}/prompt`, { text: "hi", attachments: [] })).toBe(false);
  });
});
