// Builds curl config text that is fed to `curl -K -` on stdin, so the token never reaches argv.

var METHODS = { GET: true, POST: true, PUT: true, DELETE: true };

function quote(value) {
  return '"' + String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    + '"';
}

function seg(value) {
  return encodeURIComponent(String(value == null ? "" : value));
}

function queryOf(query) {
  if (!query) return "";
  var keys = [];
  for (var key in query) {
    if (Object.prototype.hasOwnProperty.call(query, key)) keys.push(key);
  }
  keys.sort();
  var parts = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (query[key] == null) continue;
    parts.push(seg(key) + "=" + seg(query[key]));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

function block(engine, token, req) {
  var method = String(req.method || "GET").toUpperCase();
  if (!METHODS[method]) throw new Error("method");
  var path = String(req.path || "");
  if (path.charAt(0) !== "/" || path.indexOf("\n") !== -1 || path.indexOf("\r") !== -1) throw new Error("path");
  var kind = String(req.kind || "request");
  if (!/^[a-z0-9-]{1,24}$/.test(kind)) throw new Error("kind");
  var maxTime = Math.max(1, Math.min(900, Number(req.maxTime) || 12));
  var maxBytes = Math.max(1024, Math.min(2097152, Number(req.maxBytes) || 262144));
  var lines = [
    "url = " + quote(String(engine.apiBase) + path + queryOf(req.query)),
    "silent",
    "show-error",
    "connect-timeout = \"5\"",
    "max-time = " + quote(String(maxTime)),
    "max-filesize = " + quote(String(maxBytes)),
    "proto = \"=https,http\"",
    "proto-redir = \"=https,http\"",
    "header = " + quote("Authorization: Bearer " + String(token)),
    "header = " + quote("Accept: application/json"),
  ];
  if (engine.insecure === true) lines.push("insecure");
  if (method !== "GET") {
    lines.push("request = " + quote(method));
    if (req.body != null) {
      lines.push("header = " + quote("Content-Type: application/json"));
      lines.push("data-raw = " + quote(String(req.body)));
    }
  }
  lines.push("write-out = " + quote("\n--PAWATCH " + kind + " %{exitcode} %{http_code} %{time_total} %{size_download}\n"));
  return lines.join("\n");
}

function config(engine, token, reqs) {
  var parts = [];
  for (var i = 0; i < reqs.length; i++) parts.push(block(engine, token, reqs[i]));
  return parts.join("\nnext\n") + "\n";
}

function projectsRequest() {
  return {
    kind: "projects",
    method: "GET",
    path: "/projects/all",
    query: { with_domain_names: "1" },
    maxTime: 15,
    maxBytes: 1048576,
  };
}

function metricsRequest() {
  return { kind: "metrics", method: "GET", path: "/metrics/current", maxTime: 8, maxBytes: 65536 };
}

function infoRequest() {
  return { kind: "info", method: "GET", path: "/system/info", maxTime: 8, maxBytes: 262144 };
}

function systemUpdateRequest() {
  return { kind: "action", method: "PUT", path: "/system/update", body: "{}", maxTime: 60, maxBytes: 262144 };
}

function deployRequest(username, full) {
  return {
    kind: full ? "log" : "deploy",
    method: "GET",
    path: "/projects/" + seg(username) + "/deploy-log",
    // A huge offset asks for the status pointer only. The log file itself
    // stays on the engine; the panel fetches it when someone opens Logs.
    query: full ? { build_timings: "1" } : { offset: "1000000" },
    maxTime: full ? 20 : 10,
    maxBytes: full ? 1572864 : 131072,
  };
}

function containersRequest(username) {
  return {
    kind: "containers",
    method: "GET",
    path: "/projects/" + seg(username) + "/containers",
    maxTime: 20,
    maxBytes: 524288,
  };
}

function databasesRequest(username) {
  return {
    kind: "databases",
    method: "GET",
    path: "/projects/" + seg(username) + "/mysql/databases",
    maxTime: 15,
    maxBytes: 262144,
  };
}

function logsRequest(username, service) {
  return {
    kind: "logs",
    method: "GET",
    path: "/projects/" + seg(username) + "/containers/" + seg(service) + "/logs",
    query: { lines: "200" },
    maxTime: 20,
    maxBytes: 524288,
  };
}

function healthRequest(username) {
  return {
    kind: "health",
    method: "GET",
    path: "/projects/" + seg(username) + "/app/health",
    query: { timeout: "5", attempts: "1" },
    maxTime: 25,
    maxBytes: 262144,
  };
}

function mcpTokensRequest() {
  return { kind: "mcp", method: "GET", path: "/mcp-tokens", maxTime: 12, maxBytes: 262144 };
}

function mcpTokenCreateRequest(name) {
  return { kind: "mcp", method: "POST", path: "/mcp-tokens", body: JSON.stringify({ name: String(name) }), maxTime: 20, maxBytes: 65536 };
}

function mcpTokenRevokeRequest(id) {
  return { kind: "mcp", method: "PUT", path: "/mcp-tokens/" + seg(parseInt(id, 10)) + "/revoke", maxTime: 20, maxBytes: 65536 };
}

function mcpTokenDeleteRequest(id) {
  return { kind: "mcp", method: "DELETE", path: "/mcp-tokens/" + seg(parseInt(id, 10)), maxTime: 20, maxBytes: 65536 };
}

function mcpActivityRequest() {
  return { kind: "mcp", method: "GET", path: "/mcp-activity-logs", maxTime: 12, maxBytes: 262144 };
}

function actionRequest(verb, username) {
  var user = seg(username);
  var base = "/projects/" + user;
  if (verb === "rebuild") {
    return { kind: "action", method: "POST", path: base + "/rebuild", body: "{}", maxTime: 900, maxBytes: 262144 };
  }
  if (verb === "cancel") {
    return { kind: "action", method: "POST", path: base + "/deploy-cancel", body: "{}", maxTime: 30, maxBytes: 65536 };
  }
  if (verb === "restart" || verb === "stop" || verb === "start") {
    var action = verb === "start" ? "up" : verb;
    return {
      kind: "action",
      method: "POST",
      path: base + "/containers/action",
      body: "{\"action\":\"" + action + "\"}",
      maxTime: 180,
      maxBytes: 262144,
    };
  }
  if (verb === "suspend") {
    return { kind: "action", method: "PUT", path: base + "/suspend", maxTime: 60, maxBytes: 262144 };
  }
  if (verb === "unsuspend") {
    return { kind: "action", method: "PUT", path: base + "/unsuspend", maxTime: 60, maxBytes: 262144 };
  }
  if (verb === "remove") {
    return { kind: "action", method: "DELETE", path: base, maxTime: 180, maxBytes: 262144 };
  }
  return null;
}
