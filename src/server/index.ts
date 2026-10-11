#!/usr/bin/env node
import { effectivePiWebConfig, maxUploadBytes } from "../config.js";
import { buildApp } from "./app.js";

const { config } = effectivePiWebConfig();
// Fails closed: a deployment exposes the full API only if it opts out explicitly.
const app = await buildApp({ bodyLimit: maxUploadBytes(process.env, config), studyRouteAllowlist: process.env["PI_WEB_STUDY_OPEN_API"] !== "1" });
await app.listen({ port: config.port ?? 8504, host: config.host ?? "127.0.0.1" });
