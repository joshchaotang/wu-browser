/**
 * src/index.ts — 主入口
 *
 * 根據 CLI 參數決定啟動 MCP server 或 HTTP server。
 */

export { startMcpServer, createMcpServer } from './mcp/server.js';
export { startHttpServer } from './http/server.js';
export { connect, disconnect, isConnected, getClient } from './browser/connection.js';
export { snapshot, getText, loadSnapshotCache, saveSnapshotCache, snapshotToJson } from './dom/snapshot.js';
export { click, typeText, scroll, navigate, goBack, goForward } from './dom/actions.js';
export { checkPermission } from './permissions/engine.js';
export { detectModel, getCurrentProfile, getProfile, listProfiles, type ModelProfile } from './model-sense/index.js';
