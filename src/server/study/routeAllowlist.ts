import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isRecord } from "../sessions/sessionFileFormat.js";

// Participants only watch a replay and pick options. Everything else (shell, session
// creation, packages, config writes, plugin backends) is unreachable over HTTP.
// Operators mint sessions through the sessiond socket instead.

const P = String.raw`/api(?:/machines/local)?`;
const ID = "[^/]+";

const allowed: Record<string, RegExp[]> = {
  GET: [
    `/api/machines`,
    `/api/sessiond/health`,
    `${P}/pi-web/(?:status|health)`,
    `${P}/config`,
    `${P}/(?:status|notices|runtime|health|events)`,
    `${P}/projects`,
    `${P}/projects/${ID}/workspaces`,
    `${P}/projects/${ID}/workspaces/${ID}/(?:tree|file)`,
    `${P}/sessions`,
    `${P}/sessions/(?:unread|notifications|events)`,
    `${P}/sessions/${ID}/(?:notifications|transcript-snapshot|thinking-levels|events|models|models/catalog|defaults|media/${ID})`,
    `/pi-web-plugins/.+`,
  ].map((path) => new RegExp(`^${path}$`)),
  POST: [
    `${P}/sessions/${ID}/(?:prompt|unread/acknowledge|commands/run)`,
  ].map((path) => new RegExp(`^${path}$`)),
};

const appPath = /^\/(?:api|pi-web-plugins)(?:\/|$)/;
const traversal = /%2f|%2e|%5c|\.\.|\/\/|\\/i;

function pathOf(url: string): string {
  return url.split("?", 1)[0] ?? url;
}

export function isStudyRouteAllowed(method: string, url: string): boolean {
  const path = pathOf(url);
  if (traversal.test(path)) return false;
  const verb = method === "HEAD" ? "GET" : method;
  if (!appPath.test(path)) return verb === "GET";
  return allowed[verb]?.some((pattern) => pattern.test(path)) ?? false;
}

export function isStudyBodyAllowed(url: string, body: unknown): boolean {
  const path = pathOf(url);
  const field = (key: string): unknown => isRecord(body) ? body[key] : undefined;
  if (path.endsWith("/commands/run")) {
    const text = field("text");
    return typeof text === "string" && /^\/pick \S/.test(text);
  }
  if (path.endsWith("/prompt")) return field("attachments") === undefined;
  return true;
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: "Not found" });
}

export function installStudyRouteAllowlist(app: FastifyInstance): void {
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isStudyRouteAllowed(request.method, request.url)) return notFound(reply);
  });
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === "POST" && !isStudyBodyAllowed(request.url, request.body)) return notFound(reply);
  });
}
