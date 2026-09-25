
var PLUGIN_ID = "io.github.panelalpha.watch";
var SAMPLE_TOKEN = "paste-your-api-token";
var ID_RE = /^[A-Za-z0-9_-]{1,32}$/;
var USER_RE = /^[A-Za-z0-9_-]{1,32}$/;
var HOST_RE = /^[a-z0-9.-]+$/;

var POLL_DEFAULTS = {
  projectsSec: 20,
  metricsSec: 30,
  deploysSec: 8,
  infoSec: 600,
};

var NOTIFY_DEFAULTS = {
  deployStarted: true,
  deployFinished: true,
  deployFailed: true,
  projectStatus: true,
  resources: true,
};

function clampInt(value, fallback, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function elide(value, max) {
  var text = String(value == null ? "" : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "");
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}

function redact(value) {
  return String(value == null ? "" : value)
    .replace(/Bearer\s+\S+/gi, "Bearer «redacted»")
    .replace(/\b\d+\|[A-Za-z0-9+\/_=-]{8,}\b/g, "«redacted»")
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://«redacted»@");
}

function safeText(value, max) {
  var text = elide(redact(value), max || 180);
  if (text.charAt(0) === "-") text = "\u2011" + text.slice(1);
  return text;
}

function readJson(text) {
  if (typeof text !== "string") return text && typeof text === "object" ? text : null;
  var trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

function envelope(text) {
  var parsed = readJson(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (Object.prototype.hasOwnProperty.call(parsed, "data")) return parsed.data;
  return parsed;
}

function messageOf(text) {
  var parsed = readJson(text);
  if (!parsed || typeof parsed !== "object") return "";
  if (typeof parsed.message === "string") return safeText(parsed.message, 180);
  if (parsed.data && typeof parsed.data.message === "string") return safeText(parsed.data.message, 180);
  return "";
}

function fail(kind, title, detail) {
  return { ok: false, error: { kind: kind, title: title, detail: detail || "" }, warning: null, engines: [], poll: POLL_DEFAULTS, notify: NOTIFY_DEFAULTS };
}

function originOf(raw) {
  var url = String(raw || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) return { error: "url" };
  if (/^[a-z]+:\/\/[^/]*@/i.test(url)) return { error: "userinfo" };
  var match = url.match(/^(https?):\/\/([^/?#]+)/i);
  if (!match) return { error: "url" };
  var scheme = match[1].toLowerCase();
  var hostport = match[2];
  var host = hostport;
  if (host.charAt(0) === "[") {
    var end = host.indexOf("]");
    if (end === -1) return { error: "url" };
    host = host.slice(1, end);
  } else if (host.indexOf(":") !== -1) {
    host = host.slice(0, host.lastIndexOf(":"));
  }
  if (!host) return { error: "url" };
  var path = url.slice(match[0].length).replace(/\/+$/, "");
  if (path && !/^\/api$/i.test(path)) return { error: "url" };
  var site = scheme + "://" + hostport;
  var apiBase = site + "/api";
  return {
    site: site,
    apiBase: apiBase,
    host: host,
    plaintext: scheme === "http",
  };
}

function oneEngine(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { error: "shape" };
  var parsed = originOf(entry.url);
  if (parsed.error === "userinfo") return { error: "userinfo" };
  if (parsed.error) return { error: "url" };
  var token = typeof entry.token === "string" ? entry.token.trim() : "";
  if (!token || token === SAMPLE_TOKEN) return { error: "token" };
  if (/[\r\n]/.test(token)) return { error: "token" };
  var id = typeof entry.id === "string" && entry.id ? entry.id : (index === 0 ? "engine" : "engine" + (index + 1));
  if (!ID_RE.test(id)) return { error: "id" };
  var name = typeof entry.name === "string" && entry.name.trim() ? elide(entry.name, 40) : elide(parsed.host, 40);
  return {
    engine: {
      id: id,
      name: name,
      site: parsed.site,
      apiBase: parsed.apiBase,
      host: parsed.host,
      plaintext: parsed.plaintext,
      insecure: entry.insecure === true,
      token: token,
    },
  };
}

function parseNotify(raw) {
  var notify = {
    deployStarted: NOTIFY_DEFAULTS.deployStarted,
    deployFinished: NOTIFY_DEFAULTS.deployFinished,
    deployFailed: NOTIFY_DEFAULTS.deployFailed,
    projectStatus: NOTIFY_DEFAULTS.projectStatus,
    resources: NOTIFY_DEFAULTS.resources,
  };
  var warning = null;
  if (raw === false) {
    notify.deployStarted = false;
    notify.deployFinished = false;
    notify.deployFailed = false;
    notify.projectStatus = false;
    notify.resources = false;
    return { notify: notify, warning: null };
  }
  if (raw == null || raw === true) return { notify: notify, warning: null };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { notify: notify, warning: { kind: "notify", title: "Notification settings ignored", detail: "notify must be true, false, or an object. Defaults are on." } };
  }
  for (var key in notify) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    if (typeof raw[key] === "boolean") notify[key] = raw[key];
    else warning = { kind: "notify", title: "A notification setting was ignored", detail: key + " must be true or false. The default stays on." };
  }
  return { notify: notify, warning: warning };
}

function parseConfig(text) {
  var raw = readJson(text);
  if (typeof text === "string" && text.trim() && raw == null) return fail("json", "Config is not valid JSON", "Fix the file, or press Edit config and start again from the sample.");
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("shape", "Config must be a JSON object", "Set url and token. That is the whole required config.");
  }
  var entries = [];
  if (Array.isArray(raw.engines)) entries = raw.engines;
  else if (typeof raw.url === "string") {
    entries = [{ id: raw.id, name: raw.name, url: raw.url, token: raw.token, insecure: raw.insecure }];
  } else {
    return fail("shape", "URL and token are missing", "Set url to the engine origin, for example https://vps.example:2011, and token from pae api:token:create.");
  }
  if (!entries.length) return fail("shape", "No engine configured", "Add a url and a token.");
  var engines = [];
  var seen = {};
  for (var i = 0; i < entries.length; i++) {
    var built = oneEngine(entries[i], i);
    if (built.error === "userinfo") return fail("userinfo", "URL must not contain a password", "The token is a separate field. Take user:password out of the URL.");
    if (built.error === "url") return fail("url", "Engine URL is not usable", "Use the origin only, https://host:2011. A path other than /api is refused.");
    if (built.error === "token") return fail("token", "API token is missing", "Create one on the VPS with pae api:token:create, then paste it as token. An assistant token from pae connect is refused by the API.");
    if (built.error === "id") return fail("id", "Engine id is not usable", "Use 1–32 letters, digits, _ or -.");
    if (built.error) return fail("shape", "Engine entry is not an object", "");
    if (seen[built.engine.id]) return fail("id", "Two engines share an id", built.engine.id);
    seen[built.engine.id] = true;
    engines.push(built.engine);
  }
  var pollRaw = raw.poll && typeof raw.poll === "object" && !Array.isArray(raw.poll) ? raw.poll : {};
  var poll = {
    projectsSec: clampInt(pollRaw.projectsSec, POLL_DEFAULTS.projectsSec, 8, 600),
    metricsSec: clampInt(pollRaw.metricsSec, POLL_DEFAULTS.metricsSec, 10, 600),
    deploysSec: clampInt(pollRaw.deploysSec, POLL_DEFAULTS.deploysSec, 4, 120),
    infoSec: clampInt(pollRaw.infoSec, POLL_DEFAULTS.infoSec, 60, 3600),
  };
  var notifyParsed = parseNotify(raw.notify);
  return { ok: true, error: null, warning: notifyParsed.warning, engines: engines, poll: poll, notify: notifyParsed.notify };
}

function slug(text) {
  return String(text == null ? "" : text).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
}

function newEngineId(list, name, url) {
  var parsed = originOf(url);
  var base = slug(name) || slug(parsed && parsed.host) || "engine";
  var taken = {};
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id) taken[list[i].id] = true;
  var id = base;
  var n = 2;
  while (taken[id]) {
    id = base + "-" + n;
    n++;
  }
  return id;
}

function engineEntry(engine) {
  var entry = {
    id: engine.id,
    name: engine.name,
    url: String(engine.site || engine.url || ""),
    token: String(engine.token || ""),
  };
  if (engine.insecure === true) entry.insecure = true;
  return entry;
}

// mode: "edit" updates the active engine, "add" appends one, "remove" drops removeId.
function settingsFile(input) {
  input = input || {};
  var mode = input.mode === "add" || input.mode === "remove" ? input.mode : "edit";
  var url = String(input.url || "").trim();
  var token = String(input.token || "").trim();
  var name = String(input.name || "").trim();
  var insecure = input.insecure === true;
  var list = Array.isArray(input.engines) ? input.engines.filter(function(e) { return e && typeof e === "object"; }) : [];
  var activeId = String(input.activeId || "");
  var entries = [];
  var selected = activeId;

  if (mode === "remove") {
    var removeId = String(input.removeId || "");
    for (var r = 0; r < list.length; r++) if (list[r].id !== removeId) entries.push(engineEntry(list[r]));
    if (entries.length === list.length) {
      var unknown = fail("shape", "No such engine", removeId);
      unknown.text = "";
      return unknown;
    }
    if (!entries.length) {
      var last = fail("shape", "Keep at least one engine", "");
      last.text = "";
      return last;
    }
    if (selected === removeId || !entries.some(function(e) { return e.id === selected; })) selected = entries[0].id;
  } else {
    if (!token) {
      var missing = fail("token", "API token is missing", "Paste the token from pae api:token:create.");
      missing.text = "";
      return missing;
    }
    for (var i = 0; i < list.length; i++) entries.push(engineEntry(list[i]));
    if (mode === "add") {
      var id = newEngineId(list, name, url);
      var added = { id: id, name: name, url: url, token: token };
      if (insecure) added.insecure = true;
      entries.push(added);
      selected = id;
    } else if (entries.length) {
      var found = false;
      for (var e = 0; e < entries.length; e++) {
        if (entries[e].id !== activeId) continue;
        found = true;
        entries[e].url = url;
        entries[e].token = token;
        if (name) entries[e].name = name;
        if (insecure) entries[e].insecure = true;
        else delete entries[e].insecure;
      }
      if (!found) {
        var nope = fail("shape", "No engine is selected", "");
        nope.text = "";
        return nope;
      }
    } else {
      var first = { url: url, token: token };
      if (name) first.name = name;
      if (insecure) first.insecure = true;
      entries.push(first);
    }
  }

  var doc;
  if (entries.length === 1) {
    var only = entries[0];
    doc = { version: 1, url: only.url, token: only.token };
    if (only.insecure) doc.insecure = true;
    if (only.id && only.id !== "engine") doc.id = only.id;
    if (only.name) doc.name = only.name;
  } else {
    doc = { version: 1, engines: entries };
  }

  if (input.poll && typeof input.poll === "object") doc.poll = input.poll;
  if (input.notify && typeof input.notify === "object") doc.notify = input.notify;

  var text = JSON.stringify(doc, null, 2) + "\n";
  var parsed = parseConfig(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, text: "" };
  if (!selected || !parsed.engines.some(function(en) { return en.id === selected; })) selected = parsed.engines[0].id;
  return { ok: true, error: null, text: text, activeId: selected };
}

var SKILLS_REPO = "panelalpha/agent-skills";
var SERVER_NAME = "panelalpha-engine";
var TOKEN_RE = /^[A-Za-z0-9|_.-]{8,200}$/;

var ASSISTANTS = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini CLI" },
  { id: "grok", label: "Grok Build" },
  { id: "opencode", label: "OpenCode" },
  { id: "vscode", label: "VS Code" },
  { id: "windsurf", label: "Windsurf" },
  { id: "openclaw", label: "OpenClaw" },
  { id: "hermes", label: "Hermes" },
  { id: "json", label: "Cursor / Pi / other" },
];

function mcpEndpoint(site) {
  return String(site || "").replace(/\/+$/, "") + "/mcp";
}

function tokenNameError(name) {
  var text = String(name == null ? "" : name).trim();
  if (!text) return "Give the token a name";
  if (text.length > 60) return "Use 60 characters or fewer";
  if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) return "The name has a control character";
  return "";
}

function dateOnly(value) {
  var text = typeof value === "string" ? value : "";
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function parseMcpTokens(text) {
  var data = envelope(text);
  var list = Array.isArray(data) ? data : [];
  var tokens = [];
  for (var i = 0; i < list.length && tokens.length < 50; i++) {
    var row = list[i];
    if (!row || typeof row !== "object") continue;
    var id = parseInt(row.id, 10);
    if (!isFinite(id)) continue;
    tokens.push({
      id: id,
      name: stringField(row.name, 60) || ("token " + id),
      created: dateOnly(row.created_at),
      lastUsed: dateOnly(row.last_used_at),
      revoked: !!row.revoked_at,
    });
  }
  return tokens;
}

function mcpTokenLine(token) {
  var bits = [];
  if (token.revoked) bits.push("revoked");
  bits.push(token.lastUsed ? "used " + token.lastUsed : "never used");
  if (token.created) bits.push("created " + token.created);
  return bits.join("  ·  ");
}

function parseMcpCreated(text) {
  var data = envelope(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  var secret = typeof data.plain_text_token === "string" ? data.plain_text_token.trim() : "";
  if (!TOKEN_RE.test(secret)) return null;
  var id = parseInt(data.id, 10);
  return { id: isFinite(id) ? id : 0, name: stringField(data.name, 60), token: secret };
}

// Mirrors the commands `pae mcp:connect:<assistant>` prints.
function assistantCommand(id, endpoint, token) {
  if (!TOKEN_RE.test(String(token))) return "";
  var url = String(endpoint);
  if (!/^https?:\/\/[^\s"'\\]+$/.test(url)) return "";
  var bearer = "Authorization: Bearer " + token;
  if (id === "claude") {
    return "claude plugin marketplace add " + SKILLS_REPO + "\n"
      + "claude plugin install engine@panelalpha --config \"server_url=" + url + "\" --config \"api_token=" + token + "\"";
  }
  if (id === "codex") {
    return "codex plugin marketplace add " + SKILLS_REPO + "\n"
      + "codex plugin add engine@panelalpha\n"
      + "PANELALPHA_MCP_TOKEN='" + token + "' codex mcp add " + SERVER_NAME + " --url " + url + " --bearer-token-env-var PANELALPHA_MCP_TOKEN";
  }
  if (id === "gemini") {
    return "gemini mcp add --transport http --header \"" + bearer + "\" " + SERVER_NAME + " " + url;
  }
  if (id === "grok") {
    return "grok plugin marketplace add " + SKILLS_REPO + "\n"
      + "grok plugin install engine --trust\n"
      + "grok mcp add --transport http " + SERVER_NAME + " " + url + " --header \"" + bearer + "\"";
  }
  if (id === "opencode") {
    return "opencode mcp add " + SERVER_NAME + " --url " + url + " --header \"Authorization=Bearer " + token + "\"";
  }
  if (id === "vscode") {
    return "code --add-mcp '{\"name\":\"" + SERVER_NAME + "\",\"type\":\"http\",\"url\":\"" + url + "\",\"headers\":{\"Authorization\":\"Bearer " + token + "\"}}'";
  }
  if (id === "windsurf") {
    return "devin plugins install " + SKILLS_REPO + "#engine\n"
      + "devin mcp add -s user -H \"" + bearer + "\" " + SERVER_NAME + " " + url;
  }
  if (id === "openclaw") {
    return "openclaw plugins install engine --marketplace " + SKILLS_REPO + "\n"
      + "openclaw mcp add " + SERVER_NAME + " --url " + url + " --transport streamable-http --header \"" + bearer + "\"";
  }
  if (id === "hermes") {
    return "hermes plugins install " + SKILLS_REPO + "/engine --enable\n"
      + "echo \"MCP_PANELALPHA_ENGINE_API_KEY='" + token + "'\" >> ~/.hermes/.env\n"
      + "hermes mcp add " + SERVER_NAME + " --url " + url + " --auth header";
  }
  if (id === "json") {
    return JSON.stringify({ mcpServers: { "panelalpha-engine": { url: url, headers: { Authorization: "Bearer " + token } } } }, null, 2);
  }
  return "";
}

function intervals(poll, panelOpen) {
  var projects = poll.projectsSec;
  if (panelOpen) projects = Math.max(8, Math.round(projects / 2));
  return {
    projectsMs: projects * 1000,
    metricsMs: poll.metricsSec * 1000,
    deploysMs: poll.deploysSec * 1000,
    infoMs: poll.infoSec * 1000,
  };
}

function splitResponses(text) {
  var marker = "\n--PAWATCH ";
  var parts = String(text == null ? "" : text).split(marker);
  var results = [];
  for (var i = 1; i < parts.length; i++) {
    var prev = i === 1 ? parts[0] : tailAfterHead(parts[i - 1]);
    var nl = parts[i].indexOf("\n");
    var head = (nl === -1 ? parts[i] : parts[i].slice(0, nl)).trim();
    var bits = head.split(/\s+/);
    results.push({
      kind: bits[0] || "",
      exit: toInt(bits[1]),
      code: toInt(bits[2]),
      timeMs: Math.round((parseFloat(bits[3]) || 0) * 1000),
      bytes: toInt(bits[4]),
      body: prev,
    });
  }
  return results;
}

function tailAfterHead(part) {
  var nl = part.indexOf("\n");
  return nl === -1 ? "" : part.slice(nl + 1);
}

function toInt(value) {
  var n = parseInt(value, 10);
  return isFinite(n) ? n : 0;
}

function errorFor(code, curlExit, body) {
  var message = messageOf(body);
  if (curlExit === 60 || curlExit === 35) {
    return { kind: "tls", title: "Certificate was not trusted", detail: "The engine often serves its own certificate. Add \"insecure\": true to the config if you accept that, or trust the certificate on this machine." };
  }
  if (curlExit === 6 || curlExit === 7 || curlExit === 28) {
    return { kind: "offline", title: "Engine is not reachable", detail: message || "Check the URL, the port (usually 2011), and that this machine can open it." };
  }
  if (curlExit === 63) {
    return { kind: "toolarge", title: "Response was too large", detail: "The answer was cut off. The last good snapshot stays on screen." };
  }
  if (code === 401) {
    return { kind: "auth", title: "Token was rejected", detail: "Create an API token with pae api:token:create. A token from pae connect is for assistants and is refused here." };
  }
  if (code === 403) {
    return { kind: "forbidden", title: "Token cannot do that", detail: message || "The token is authenticated but this route is not allowed." };
  }
  if (code === 404) {
    return { kind: "missing", title: "Not found", detail: message || "The engine has no such project." };
  }
  if (code === 409) {
    return { kind: "conflict", title: "Nothing to do", detail: message || "The engine refused because the project is not in that state." };
  }
  if (code === 422) {
    return { kind: "rejected", title: "Engine refused the request", detail: message || "The engine rejected the call." };
  }
  if (code === 429) {
    return { kind: "ratelimited", title: "Engine asked us to slow down", detail: message || "Polling pauses briefly." };
  }
  if (code >= 400 || curlExit !== 0) {
    return { kind: "http", title: "Engine returned an error", detail: message || ("HTTP " + code + ", curl " + curlExit) };
  }
  return null;
}

function stringField(value, max) {
  return typeof value === "string" ? elide(redact(value), max) : "";
}

function runtimeOf(details) {
  var template = stringField(details.template, 32);
  if (template === "dind") return "dind";
  if (template) return "hosting";
  if (stringField(details.git_repo, 8) || stringField(details.deploy_strategy, 8)) return "dind";
  return "unknown";
}

function publicRepo(value) {
  var repo = stringField(value, 160);
  return repo.replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, "://").replace(/:\/\/[^/\s:@]+@/g, "://");
}

function parseProjects(text) {
  var data = envelope(text);
  var list = Array.isArray(data) ? data : [];
  var projects = [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    if (!row || typeof row !== "object") continue;
    var username = typeof row.username === "string" ? row.username : "";
    if (!USER_RE.test(username)) continue;
    var details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? row.details : {};
    var domains = [];
    if (Array.isArray(row.domain_names)) {
      for (var d = 0; d < row.domain_names.length && domains.length < 8; d++) {
        var name = stringField(row.domain_names[d], 120);
        if (name) domains.push(name);
      }
    }
    var warnings = [];
    if (Array.isArray(details.deployment_warnings)) {
      for (var w = 0; w < details.deployment_warnings.length && warnings.length < 3; w++) {
        var warning = stringField(details.deployment_warnings[w], 140);
        if (warning) warnings.push(warning);
      }
    }
    var status = row.status === "suspended" ? "suspended" : "active";
    projects.push({
      username: username,
      domain: stringField(row.domain, 160),
      domains: domains,
      name: stringField(row.name, 80),
      status: status,
      runtime: runtimeOf(details),
      strategy: stringField(details.deploy_strategy, 40),
      deploymentStatus: stringField(details.deployment_status, 24) || "unknown",
      gitRepo: publicRepo(details.git_repo),
      gitBranch: stringField(details.git_branch, 80),
      warnings: warnings,
    });
  }
  projects.sort(function(a, b) {
    var left = a.username.toLowerCase();
    var right = b.username.toLowerCase();
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  });
  return projects;
}

function parseInfo(text) {
  var data = envelope(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  var web = data.webserver && typeof data.webserver === "object" ? data.webserver : {};
  var webName = stringField(web.name, 40);
  var webVersion = stringField(web.version, 40);
  var webserver = webName;
  if (webVersion && webVersion !== "Unknown") webserver = webName ? webName + " " + webVersion : webVersion;
  return {
    version: stringField(data.version, 40),
    url: stringField(data.url, 160),
    webserver: webserver,
    certDomain: stringField(data.cert_domain, 120),
    update: parseUpdate(data.latest_update),
  };
}

function optionalInt(value) {
  if (value == null || value === "") return null;
  var n = parseInt(value, 10);
  return isFinite(n) ? n : null;
}

function parseUpdate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  var exitCode = optionalInt(raw.exit_code);
  var pid = optionalInt(raw.pid);
  return {
    running: exitCode === null && pid !== null,
    exitCode: exitCode,
    fromVersion: stringField(raw.from_version, 40),
    toVersion: stringField(raw.to_version, 40),
    detail: safeText(raw.tail_stderr || raw.tail_stdout || "", 180),
  };
}

function updateSummary(update) {
  if (!update) return "";
  if (update.running) {
    return update.toVersion ? "Updating to " + update.toVersion + "…" : "Updating…";
  }
  if (update.exitCode === 0) {
    if (update.fromVersion && update.toVersion && update.fromVersion !== update.toVersion) {
      return "Updated " + update.fromVersion + " → " + update.toVersion;
    }
    return "Last update finished";
  }
  if (update.exitCode !== null) {
    return update.detail ? "Update failed — " + update.detail : "Update failed";
  }
  return "";
}

function percent(value) {
  var n = Number(value);
  if (!isFinite(n)) return null;
  if (n < 0) n = 0;
  if (n > 100) n = 100;
  return Math.round(n);
}

function parseMetrics(text) {
  var data = envelope(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return {
    cpu: percent(data.cpu_usage_percent),
    ram: percent(data.ram_usage_percent),
    disk: percent(data.disk_usage_percent),
  };
}

function parseDeployLog(text) {
  var data = envelope(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  var status = stringField(data.status, 24) || "none";
  var allowed = { none: true, running: true, success: true, partial: true, failed: true, cancelled: true };
  if (!allowed[status]) status = "none";
  var lines = [];
  if (Array.isArray(data.lines)) {
    var start = Math.max(0, data.lines.length - 80);
    for (var i = start; i < data.lines.length; i++) {
      var line = data.lines[i];
      var msg = "";
      var level = "info";
      if (typeof line === "string") msg = line;
      else if (line && typeof line === "object") {
        msg = typeof line.msg === "string" ? line.msg : "";
        level = typeof line.level === "string" ? line.level : "info";
      }
      msg = safeText(msg, 200);
      if (!msg) continue;
      lines.push({ level: elide(level, 12), msg: msg });
    }
  }
  var phases = [];
  var timings = data.timings && typeof data.timings === "object" ? data.timings : null;
  if (timings && Array.isArray(timings.phases)) {
    for (var p = 0; p < timings.phases.length && phases.length < 8; p++) {
      var phase = timings.phases[p];
      if (!phase || typeof phase !== "object") continue;
      var seconds = Number(phase.seconds);
      if (!isFinite(seconds)) continue;
      phases.push({ name: stringField(phase.name, 32), seconds: Math.round(seconds * 10) / 10 });
    }
  }
  return {
    status: status,
    stage: stringField(data.stage, 32),
    error: data.error ? safeText(data.error, 240) : "",
    startedAt: stringField(data.started_at, 40),
    finishedAt: stringField(data.finished_at, 40),
    lines: lines,
    phases: phases,
  };
}

function parseContainers(text) {
  var data = envelope(text);
  var list = Array.isArray(data) ? data : [];
  var rows = [];
  for (var i = 0; i < list.length && rows.length < 20; i++) {
    var row = list[i];
    if (!row || typeof row !== "object") continue;
    var service = stringField(row.Service || row.service, 40);
    var name = stringField(row.Name || row.Names || row.name, 60);
    var state = stringField(row.State || row.state, 24).toLowerCase();
    var status = stringField(row.Status || row.status, 60);
    var health = stringField(row.Health || row.health, 24).toLowerCase();
    if (!service && !name) continue;
    rows.push({ service: service, name: name || service, state: state, status: status, health: health });
  }
  return rows;
}

function parseDatabases(text) {
  var data = envelope(text);
  var list = Array.isArray(data) ? data : [];
  var rows = [];
  for (var i = 0; i < list.length && rows.length < 12; i++) {
    var row = list[i];
    if (!row || typeof row !== "object") continue;
    var name = stringField(row.database || row.name, 64);
    if (!name) continue;
    var size = Number(row.size_bytes);
    rows.push({ name: name, size: isFinite(size) && size >= 0 ? size : null });
  }
  return rows;
}

function parseHealth(text) {
  var data = envelope(text);
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  var failed = [];
  var passed = 0;
  if (Array.isArray(data.checks)) {
    for (var i = 0; i < data.checks.length; i++) {
      var check = data.checks[i];
      if (!check || typeof check !== "object") continue;
      if (check.status === "pass") { passed++; continue; }
      if (check.status === "skipped") continue;
      if (failed.length >= 8) continue;
      failed.push({
        title: stringField(check.title, 160),
        detail: stringField(check.detail, 220),
        fix: stringField(check.fix, 220),
      });
    }
  }
  var ports = [];
  if (Array.isArray(data.ports)) {
    for (var p = 0; p < data.ports.length && ports.length < 6; p++) {
      var port = data.ports[p];
      if (!port || typeof port !== "object") continue;
      ports.push({
        port: toInt(port.port),
        status: stringField(port.status, 8),
        httpCode: port.http_code == null ? null : toInt(port.http_code),
        detail: stringField(port.detail, 80),
      });
    }
  }
  return {
    healthy: data.healthy === true ? true : (data.healthy === false ? false : null),
    serving: stringField(data.serving, 32),
    error: stringField(data.error, 220),
    failed: failed,
    passed: passed,
    ports: ports,
  };
}

function healthHeadline(report) {
  if (!report) return "No check result.";
  if (report.error) return "Could not check the application. " + report.error;
  var serving = report.serving || "";
  if (serving === "placeholder") return "The response is the engine placeholder page, not this application.";
  if (serving === "restarting") return "The container starts and exits immediately. The application does not stay up.";
  if (serving === "unknown" && report.healthy === false) return "Nothing answered on the published port.";
  if (serving === "unknown") return "Could not tell what is being served.";
  if (serving && serving !== "ok") return "The application is not serving its own page (" + serving + ").";
  if (report.healthy === false) return "The application did not answer correctly.";
  if (report.healthy === true || serving === "ok") return "The application answers and is serving its own page.";
  return "The check finished without a clear result.";
}

function healthLines(report) {
  if (!report) return ["No check result."];
  var lines = [healthHeadline(report)];
  var ports = report.ports || [];
  for (var i = 0; i < ports.length; i++) {
    var port = ports[i];
    if (port.status === "ok") {
      lines.push("Port " + port.port + " answered" + (port.httpCode ? " with " + port.httpCode : "") + ".");
    } else {
      lines.push("Port " + port.port + " did not answer" + (port.detail ? " — " + port.detail : "") + ".");
    }
  }
  var failed = report.failed || [];
  for (var f = 0; f < failed.length; f++) {
    var check = failed[f];
    var line = check.title || "A check failed";
    if (check.detail) line += " — " + check.detail;
    lines.push(line);
    if (check.fix) lines.push("What to do: " + check.fix);
  }
  if (report.passed) lines.push("Other checks that passed: " + report.passed + ".");
  if (!ports.length && !failed.length && !report.passed && !report.error) {
    lines.push("The engine had no port or check to show.");
  }
  return lines;
}

function containerUp(state) {
  var value = String(state || "").toLowerCase();
  return value === "running" || value === "restarting" || value.indexOf("up") === 0;
}

function projectView(project, deploy, pending, containers) {
  var state = "unknown";
  var label = "Unknown";
  if (project.status === "suspended") {
    state = "suspended";
    label = "Suspended";
  } else if (pending && pending.verb) {
    state = "pending";
    label = pendingLabel(pending.verb);
  } else if (deploy && deploy.status === "running") {
    state = "deploying";
    label = deploy.stage ? "Deploying · " + deploy.stage : "Deploying";
  } else if ((deploy && deploy.status === "failed") || project.deploymentStatus === "failed") {
    state = "failed";
    label = "Failed";
  } else if ((deploy && deploy.status === "partial") || project.deploymentStatus === "partial") {
    state = "partial";
    label = "Warnings";
  } else if (deploy && deploy.status === "cancelled") {
    state = "cancelled";
    label = "Cancelled";
  } else if (containers && containers.known && containers.rows.length && !anyUp(containers.rows)) {
    state = "stopped";
    label = "Stopped";
  } else if (project.status === "active") {
    state = "running";
    label = "Running";
  }
  return {
    username: project.username,
    domain: project.domain,
    domains: project.domains,
    name: project.name,
    status: project.status,
    runtime: project.runtime,
    strategy: project.strategy,
    deploymentStatus: project.deploymentStatus,
    gitRepo: project.gitRepo,
    gitBranch: project.gitBranch,
    warnings: project.warnings,
    state: state,
    label: label,
    deploy: deploy || null,
    error: deploy && deploy.error ? deploy.error : "",
  };
}

function anyUp(rows) {
  for (var i = 0; i < rows.length; i++) if (containerUp(rows[i].state)) return true;
  return false;
}

function pendingLabel(verb) {
  if (verb === "rebuild") return "Rebuilding…";
  if (verb === "restart") return "Restarting…";
  if (verb === "stop") return "Stopping…";
  if (verb === "start") return "Starting…";
  if (verb === "cancel") return "Cancelling…";
  if (verb === "suspend") return "Suspending…";
  if (verb === "unsuspend") return "Resuming…";
  if (verb === "remove") return "Deleting…";
  return "Working…";
}

function present(projects, deploys, pending, containers) {
  var rows = [];
  for (var i = 0; i < projects.length; i++) {
    var project = projects[i];
    rows.push(projectView(
      project,
      deploys ? deploys[project.username] : null,
      pending ? pending[project.username] : null,
      containers ? containers[project.username] : null
    ));
  }
  return rows;
}

function matches(row, filter) {
  var needle = String(filter || "").trim().toLowerCase();
  if (!needle) return true;
  var hay = [row.username, row.domain, row.name, row.strategy, row.gitBranch, row.label, row.state].join(" ").toLowerCase();
  if (row.domains) hay += " " + row.domains.join(" ").toLowerCase();
  return hay.indexOf(needle) !== -1;
}

function visibleRows(rows, filter) {
  var out = [];
  for (var i = 0; i < rows.length; i++) if (matches(rows[i], filter)) out.push(rows[i]);
  return out;
}

function lineText(line) {
  if (typeof line === "string") return line;
  if (!line || typeof line !== "object") return "";
  return String(line.level || "") + " " + String(line.msg || "");
}

function filterLog(lines, needle) {
  var list = Array.isArray(lines) ? lines : [];
  var query = String(needle || "").trim().toLowerCase();
  if (!query) return list.slice();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    if (lineText(list[i]).toLowerCase().indexOf(query) !== -1) out.push(list[i]);
  }
  return out;
}

function isDind(row) {
  return row && row.runtime === "dind";
}

function actionsFor(row) {
  if (!row) return [];
  var actions = [];
  var deploying = row.state === "deploying" || (row.deploy && row.deploy.status === "running");
  if (deploying) actions.push({ verb: "cancel", label: "Cancel", confirm: true });
  actions.push({ verb: "rebuild", label: deploying ? "Rebuild" : "Redeploy", confirm: true });
  if (isDind(row)) {
    if (row.state === "stopped") actions.push({ verb: "start", label: "Start", confirm: false });
    else actions.push({ verb: "restart", label: "Restart", confirm: false });
    if (row.state !== "stopped" && row.state !== "suspended") actions.push({ verb: "stop", label: "Stop", confirm: true });
    actions.push({ verb: "logs", label: "Logs", confirm: false });
    actions.push({ verb: "health", label: "Check", confirm: false });
  }
  if (row.status === "suspended") actions.push({ verb: "unsuspend", label: "Unsuspend", confirm: false });
  else actions.push({ verb: "suspend", label: "Suspend", confirm: true });
  if (siteUrl(row.domain)) actions.push({ verb: "open", label: "Open", confirm: false });
  actions.push({ verb: "remove", label: "Delete", confirm: true });
  return actions;
}

function confirmText(verb, username) {
  if (verb === "rebuild") return "Redeploy " + username + "? The engine rebuilds the project and this can take several minutes.";
  if (verb === "cancel") return "Cancel the deploy running on " + username + "?";
  if (verb === "stop") return "Stop the containers for " + username + "? The site stops answering until you start it.";
  if (verb === "suspend") return "Suspend " + username + "? The engine stops serving its domains.";
  if (verb === "remove") return "Delete project " + username + "? Its files, containers and databases will be removed. This cannot be undone.";
  if (verb === "mcp-revoke") return "Revoke the assistant token \u201c" + username + "\u201d? Any assistant using it loses access right away.";
  if (verb === "mcp-delete") return "Delete the assistant token \u201c" + username + "\u201d? Any assistant using it loses access right away.";
  if (verb === "remove-engine") return "Remove " + username + " from this panel? The engine itself is not touched, only the saved connection.";
  if (verb === "engine-update") return "Update " + username + "? The updater runs on the server. This panel can lose the connection while the engine restarts.";
  return "Run " + verb + " on " + username + "?";
}

function applicable(verb, row) {
  var actions = actionsFor(row);
  for (var i = 0; i < actions.length; i++) if (actions[i].verb === verb) return true;
  return false;
}

function siteUrl(domain) {
  var host = String(domain || "").trim().toLowerCase();
  if (!host || host.length > 253) return "";
  if (!HOST_RE.test(host) || host.indexOf("..") !== -1) return "";
  if (host.charAt(0) === "." || host.charAt(host.length - 1) === ".") return "";
  return "https://" + host + "/";
}

function diffDeploy(previous, next) {
  if (!previous || !next || previous === next) return null;
  if (next === "running" && previous !== "running") return "deployStarted";
  if (previous === "running" && next === "success") return "deployFinished";
  if (previous === "running" && next === "partial") return "deployPartial";
  if (previous === "running" && next === "failed") return "deployFailed";
  if (previous === "running" && next === "cancelled") return "deployCancelled";
  if (next === "failed" && previous !== "failed" && previous !== "running") return "deployFailed";
  return null;
}

function diffAccount(previous, next) {
  if (!previous || previous === next) return null;
  if (previous === "active" && next === "suspended") return "projectSuspended";
  if (previous === "suspended" && next === "active") return "projectResumed";
  return null;
}

function notifyWanted(notify, kind) {
  if (!notify) return true;
  if (kind === "deployStarted") return notify.deployStarted !== false;
  if (kind === "deployFinished" || kind === "deployPartial" || kind === "deployCancelled") return notify.deployFinished !== false;
  if (kind === "deployFailed") return notify.deployFailed !== false;
  if (kind === "projectSuspended" || kind === "projectResumed") return notify.projectStatus !== false;
  if (kind === "resourceHigh") return notify.resources !== false;
  return false;
}

function notifyArgv(event, dnd) {
  if (!event || !event.kind) return null;
  var urgency = "normal";
  var headline = "PanelAlpha";
  if (event.kind === "deployStarted") { urgency = "low"; headline = "Deploy started"; }
  else if (event.kind === "deployFinished") { headline = "Deploy finished"; }
  else if (event.kind === "deployPartial") { headline = "Deploy finished with warnings"; }
  else if (event.kind === "deployFailed") { urgency = "critical"; headline = "Deploy failed"; }
  else if (event.kind === "deployCancelled") { urgency = "low"; headline = "Deploy cancelled"; }
  else if (event.kind === "projectSuspended") { headline = "Project suspended"; }
  else if (event.kind === "projectResumed") { urgency = "low"; headline = "Project resumed"; }
  else if (event.kind === "resourceHigh") {
    urgency = event.critical === true ? "critical" : "normal";
    headline = event.resource === "disk" ? "Disk is almost full" : "Memory is running low";
  }
  else return null;
  var body = safeText(event.username || "", 32);
  if (event.detail) body = body ? body + " — " + safeText(event.detail, 140) : safeText(event.detail, 140);
  if (event.engineName) body = body ? body + " · " + safeText(event.engineName, 40) : safeText(event.engineName, 40);
  var app = urgency === "critical" && dnd === true ? "omarchy-action" : PLUGIN_ID;
  var argv = ["omarchy-notification-send", "--app-name", app, "-g", "󰒍", "-u", urgency, safeText(headline, 80)];
  if (body) argv.push(body);
  var url = siteUrl(event.domain);
  if (url) argv.push("--exec", "omarchy-launch-browser", url);
  return argv;
}

// CPU is left out: the engine reports it as a share since boot, not current load.
var RESOURCE_HIGH = 90;
var RESOURCE_CRITICAL = 95;
var RESOURCE_CLEAR = 80;

function resourceAlerts(previous, metrics) {
  var state = { ram: !!(previous && previous.ram), disk: !!(previous && previous.disk) };
  var events = [];
  var names = ["ram", "disk"];
  for (var i = 0; i < names.length; i++) {
    var key = names[i];
    var value = metrics ? Number(metrics[key]) : NaN;
    if (metrics == null || metrics[key] == null || !isFinite(value)) continue;
    if (state[key]) {
      if (value < RESOURCE_CLEAR) state[key] = false;
    } else if (value >= RESOURCE_HIGH) {
      state[key] = true;
      events.push({ kind: "resourceHigh", resource: key, critical: value >= RESOURCE_CRITICAL, detail: Math.round(value) + "% used" });
    }
  }
  return { state: state, events: events };
}

function stamp(value) {
  var when = new Date(String(value || ""));
  if (isNaN(when.getTime())) return "";
  function two(n) { return (n < 10 ? "0" : "") + n; }
  return two(when.getMonth() + 1) + "-" + two(when.getDate()) + " " + two(when.getHours()) + ":" + two(when.getMinutes());
}

function parseMcpActivity(text) {
  var data = envelope(text);
  var list = Array.isArray(data) ? data : [];
  var rows = [];
  for (var i = 0; i < list.length && rows.length < 20; i++) {
    var row = list[i];
    if (!row || typeof row !== "object") continue;
    var tool = stringField(row.tool_name, 60);
    if (!tool) continue;
    rows.push({
      tool: tool,
      token: stringField(row.token_name, 60),
      ok: row.status !== "error",
      error: safeText(row.error_message || "", 120),
      when: stamp(row.created_at),
    });
  }
  return rows;
}

function activityLine(row) {
  var bits = [];
  if (row.token) bits.push(row.token);
  if (row.when) bits.push(row.when);
  if (!row.ok) bits.push(row.error ? "failed: " + row.error : "failed");
  return bits.join("  ·  ");
}

function counts(rows) {
  var out = { projects: rows.length, deploying: 0, failed: 0, suspended: 0, stopped: 0 };
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].state === "deploying" || rows[i].state === "pending") out.deploying++;
    else if (rows[i].state === "failed") out.failed++;
    else if (rows[i].state === "suspended") out.suspended++;
    else if (rows[i].state === "stopped") out.stopped++;
  }
  return out;
}

function barTip(snapshot) {
  if (!snapshot || !snapshot.configured) return "PanelAlpha — not configured";
  if (snapshot.error && snapshot.error.title) return "PanelAlpha — " + snapshot.error.title;
  var c = counts(snapshot.rows || []);
  var parts = [snapshot.engineName || "PanelAlpha", c.projects + (c.projects === 1 ? " project" : " projects")];
  if (c.deploying) parts.push(c.deploying + " deploying");
  if (c.failed) parts.push(c.failed + " failed");
  if (c.suspended) parts.push(c.suspended + " suspended");
  if (c.stopped) parts.push(c.stopped + " stopped");
  return parts.join(" · ");
}

function statusReport(input) {
  var rows = input && input.rows ? input.rows : [];
  var c = counts(rows);
  var action = input && input.lastAction ? input.lastAction : {};
  return {
    configured: !!(input && input.configured),
    engine: input && input.engineId ? String(input.engineId) : "",
    engineName: input && input.engineName ? String(input.engineName) : "",
    origin: input && input.origin ? String(input.origin) : "",
    error: input && input.errorKind ? String(input.errorKind) : "",
    projects: c.projects,
    deploying: c.deploying,
    failed: c.failed,
    suspended: c.suspended,
    stopped: c.stopped,
    requestsLastMin: input && isFinite(input.requestsLastMin) ? input.requestsLastMin : 0,
    lastAction: {
      verb: action.verb ? String(action.verb) : "",
      username: action.username ? String(action.username) : "",
      code: isFinite(action.code) ? action.code : 0,
    },
  };
}

function bytes(n) {
  if (n == null || !isFinite(n) || n < 0) return "";
  if (n < 1024) return Math.round(n) + " B";
  if (n < 1048576) return (Math.round(n / 102.4) / 10) + " KB";
  if (n < 1073741824) return (Math.round(n / 104857.6) / 10) + " MB";
  return (Math.round(n / 107374182.4) / 10) + " GB";
}

function phaseLine(phases) {
  if (!phases || !phases.length) return "";
  var parts = [];
  for (var i = 0; i < phases.length && parts.length < 4; i++) {
    parts.push(phases[i].name + " " + phases[i].seconds + "s");
  }
  return parts.join(" · ");
}

function modeBits(text) {
  var match = String(text || "").trim().match(/^([0-7]{3,4})\s+(\S+)/);
  if (!match) return null;
  var mode = match[1].length === 4 ? match[1].slice(1) : match[1];
  var group = parseInt(mode.charAt(1), 8);
  var world = parseInt(mode.charAt(2), 8);
  return { owner: match[2], groupWrite: (group & 2) !== 0, worldWrite: (world & 2) !== 0, groupRead: (group & 4) !== 0, worldRead: (world & 4) !== 0 };
}

function findRow(rows, username) {
  for (var i = 0; i < rows.length; i++) if (rows[i].username === username) return rows[i];
  return null;
}
