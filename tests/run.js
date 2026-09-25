#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
let failed = 0;

function load(file) {
  const context = vm.createContext({
    console,
    encodeURIComponent,
    decodeURIComponent,
    JSON,
    Number,
    String,
    Object,
    Array,
    Math,
    isFinite,
    parseInt,
    parseFloat,
    Date,
    isNaN,
  });
  vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  return context;
}

const Model = load("Model.js");
const Api = load("Api.js");

function assert(cond, message) {
  if (!cond) {
    failed++;
    console.error("FAIL " + message);
  }
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed++;
    console.error("FAIL " + message + "\n  actual   " + a + "\n  expected " + e);
  }
}

const flat = Model.parseConfig(JSON.stringify({
  url: "https://vps.example:2011/",
  token: "4|abcdefghijklmnopqrstuvwxyz",
  insecure: true,
}));
assert(flat.ok, "flat config ok");
eq(flat.engines[0].apiBase, "https://vps.example:2011/api", "api base appended");
eq(flat.engines[0].site, "https://vps.example:2011", "site origin");
eq(flat.engines[0].insecure, true, "insecure flag");
eq(flat.engines[0].id, "engine", "default id");

const withApi = Model.parseConfig(JSON.stringify({
  url: "https://vps.example:2011/api",
  token: "4|abcdefghijklmnopqrstuvwxyz",
}));
eq(withApi.engines[0].apiBase, "https://vps.example:2011/api", "does not double /api");

const http = Model.parseConfig(JSON.stringify({
  url: "http://10.0.0.5:2011",
  token: "4|abcdefghijklmnopqrstuvwxyz",
}));
assert(http.ok && http.engines[0].plaintext === true, "http is marked plaintext");

const userinfo = Model.parseConfig(JSON.stringify({
  url: "https://user:secret@vps.example:2011",
  token: "4|abcdefghijklmnopqrstuvwxyz",
}));
eq(userinfo.ok, false, "userinfo refused");
eq(userinfo.error.kind, "userinfo", "userinfo kind");

const nestedApi = Model.parseConfig(JSON.stringify({
  url: "https://vps.example:2011/foo/api",
  token: "4|abcdefghijklmnopqrstuvwxyz",
}));
eq(nestedApi.ok, false, "a path that only ends in /api is refused");
eq(nestedApi.error.kind, "url", "nested api path kind");

const placeholder = Model.parseConfig(JSON.stringify({
  url: "https://vps.example:2011",
  token: "paste-your-api-token",
}));
eq(placeholder.error.kind, "token", "placeholder is not a token");

const badJson = Model.parseConfig("{");
eq(badJson.error.kind, "json", "broken json");

const engines = Model.parseConfig(JSON.stringify({
  engines: [
    { id: "home", name: "Home", url: "https://a.example:2011", token: "1|aaaaaaaa" },
    { id: "home", url: "https://b.example:2011", token: "2|bbbbbbbb" },
  ],
}));
eq(engines.error.kind, "id", "duplicate id");

const poll = Model.parseConfig(JSON.stringify({
  url: "https://vps.example:2011",
  token: "4|abcdefghijklmnopqrstuvwxyz",
  poll: { projectsSec: 1, metricsSec: "nope" },
  notify: false,
}));
eq(poll.poll.projectsSec, 8, "projects poll clamped");
eq(poll.poll.metricsSec, 30, "bad metrics poll falls back");
eq(poll.notify.deployFailed, false, "notify false switches alerts off");

const intervals = Model.intervals(poll.poll, true);
eq(intervals.projectsMs, 8000, "open panel does not go below the floor");

const quoted = Api.quote('a"b\\\n');
eq(quoted, '"a\\"b\\\\\\n"', "curl quote");

const engine = flat.engines[0];
const cfg = Api.config(engine, engine.token, [
  Api.projectsRequest(),
  Api.deployRequest("shop_1", false),
  Api.actionRequest("restart", "shop_1"),
]);
assert(cfg.indexOf("Authorization: Bearer " + engine.token) !== -1, "bearer is in the config body");
assert(cfg.indexOf("\nnext\n") !== -1, "transfers are joined with next");
assert(cfg.indexOf("/projects/shop_1/deploy-log?offset=1000000") !== -1, "status poll skips the log body");
assert(cfg.indexOf('data-raw = "{\\"action\\":\\"restart\\"}"') !== -1, "restart body is a constant");
assert(cfg.indexOf("insecure\n") !== -1, "insecure is emitted only when asked");
assert(Api.config({ apiBase: engine.apiBase, insecure: false }, "t", [Api.metricsRequest()]).indexOf("\ninsecure\n") === -1, "insecure stays off by default");

let threw = false;
try { Api.block(engine, "t", { method: "PATCH", path: "/projects/x", kind: "action" }); }
catch (e) { threw = true; }
assert(threw, "patch is not a method we send");
const removal = Api.actionRequest("remove", "shop");
eq(removal.method, "DELETE", "remove is a delete");
eq(removal.path, "/projects/shop", "remove hits the project");
assert(Api.config(engine, "t", [removal]).indexOf('request = "DELETE"') !== -1, "delete is sent");

threw = false;
try { Api.block(engine, "t", { method: "GET", path: "/projects/../../etc", kind: "projects" }); }
catch (e) { threw = false; }
assert(Api.config(engine, "t", [Api.containersRequest("a b")]).indexOf("/projects/a%20b/containers") !== -1, "path segment is encoded");

const stream = [
  '{"data":[{"username":"shop"}]}',
  "--PAWATCH projects 0 200 0.2 40",
  '{"data":{"cpu_usage_percent":12.4,"ram_usage_percent":40,"disk_usage_percent":70}}',
  "--PAWATCH metrics 0 200 0.1 20",
  "",
].join("\n");
const parts = Model.splitResponses(stream);
eq(parts.length, 2, "two trailers");
eq(parts[0].kind, "projects", "first kind");
eq(parts[0].code, 200, "first code");
eq(parts[1].kind, "metrics", "second kind");
assert(parts[1].body.indexOf("cpu_usage_percent") !== -1, "second body follows the first trailer");

const projects = Model.parseProjects(JSON.stringify({
  data: [
    {
      username: "Shop",
      domain: "shop.example",
      status: "active",
      domain_names: ["shop.example", "www.shop.example"],
      details: {
        template: "dind",
        deploy_strategy: "laravel",
        deployment_status: "success",
        git_repo: "https://user:ghp_secret@github.com/acme/shop.git",
        git_branch: "main",
        git_token: "should-not-appear",
        env_vars: { APP_KEY: "secret" },
        deployment_warnings: [],
      },
    },
    { username: "../etc", domain: "nope.example", status: "active", details: {} },
    { username: "blog", domain: "blog.example", status: "suspended", details: { template: "apache" } },
  ],
}));
eq(projects.map((p) => p.username), ["blog", "Shop"], "bad username dropped, sorted");
eq(projects[1].gitRepo.indexOf("ghp_secret"), -1, "git userinfo stripped");
eq(projects[1].gitRepo.indexOf("github.com/acme/shop.git") !== -1, true, "repo path kept");
assert(JSON.stringify(projects).indexOf("should-not-appear") === -1, "git token field is not copied");
assert(JSON.stringify(projects).indexOf("APP_KEY") === -1, "env vars are not copied");
eq(projects[1].runtime, "dind", "dind template");
eq(projects[0].runtime, "hosting", "classic template");
eq(projects[0].status, "suspended", "suspended account");

const info = Model.parseInfo(JSON.stringify({
  data: { version: "1.4.0", url: "https://vps.example:2011", cert_domain: "vps.example", webserver: { name: "Nginx", version: "Unknown" } },
}));
eq(info.webserver, "Nginx", "unknown webserver version is omitted");
eq(info.version, "1.4.0", "engine version");
eq(info.update, null, "no update record is absent");

const updating = Model.parseInfo(JSON.stringify({
  data: {
    version: "2.0.1",
    webserver: { name: "Nginx", version: "1.24" },
    latest_update: { pid: 42, exit_code: null, from_version: "2.0.1", to_version: "2.0.2", tail_stderr: "" },
  },
}));
eq(updating.update.running, true, "an update without an exit code is running");
eq(Model.updateSummary(updating.update), "Updating to 2.0.2…", "running update names the target");

const updated = Model.parseUpdate({ exit_code: 0, pid: 42, from_version: "2.0.1", to_version: "2.0.2" });
eq(updated.running, false, "a finished update is not running");
eq(Model.updateSummary(updated), "Updated 2.0.1 → 2.0.2", "a finished update names both versions");
eq(Model.updateSummary(Model.parseUpdate({ exit_code: 1, pid: 9, tail_stderr: "license rejected" })), "Update failed — license rejected", "a failed update keeps the reason");

const updateCall = Api.systemUpdateRequest();
eq(updateCall.method, "PUT", "engine update is a PUT");
eq(updateCall.path, "/system/update", "engine update path");
assert(Api.config(engine, "t", [updateCall]).indexOf('request = "PUT"') !== -1, "update request is sent");
assert(Model.confirmText("engine-update", "Home").indexOf("lose the connection") !== -1, "update asks before it runs");

const metrics = Model.parseMetrics(JSON.stringify({ data: { cpu_usage_percent: 150, ram_usage_percent: 33.2, disk_usage_percent: 70 } }));
eq(metrics, { cpu: 100, ram: 33, disk: 70 }, "metrics clamped and rounded");

const deploy = Model.parseDeployLog(JSON.stringify({
  data: {
    status: "failed",
    stage: "running",
    error: "Bearer 9|sekret composer failed",
    lines: [
      { level: "info", msg: "Detected project type: PHP" },
      { level: "error", msg: "composer failed" },
    ],
    timings: { phases: [{ name: "build", seconds: 12.24 }, { name: "cloning", seconds: 3 }] },
  },
}));
eq(deploy.status, "failed", "deploy status");
assert(deploy.error.indexOf("sekret") === -1, "deploy error redacts a token");
eq(deploy.lines.length, 2, "log lines kept");
eq(deploy.phases[0].seconds, 12.2, "phase seconds rounded");

const containers = Model.parseContainers(JSON.stringify({
  data: [{ Service: "app", Name: "project-app-1", State: "running", Status: "Up 2 hours", Health: "healthy" }],
}));
eq(containers[0].service, "app", "compose service");
eq(containers[0].state, "running", "compose state");

const databases = Model.parseDatabases(JSON.stringify({
  data: [{ database: "shop", size_bytes: 4096, details: { password: "nope" } }],
}));
eq(databases, [{ name: "shop", size: 4096 }], "database row keeps name and size only");
assert(JSON.stringify(databases).indexOf("nope") === -1, "database details are dropped");

const health = Model.parseHealth(JSON.stringify({
  data: {
    healthy: false,
    serving: "placeholder",
    checks: [
      { status: "pass", title: "ok" },
      { status: "fail", title: "Placeholder page", detail: "the engine page", fix: "Deploy the application." },
    ],
    ports: [{ port: 8000, status: "ok", http_code: 200, detail: "200" }],
  },
}));
eq(health.failed.length, 1, "a failed check is kept");
eq(health.passed, 1, "a passing check is counted");
eq(health.ports[0].httpCode, 200, "port code");
const healthText = Model.healthLines(health).join("\n");
assert(healthText.indexOf("placeholder page") !== -1, "placeholder is explained");
assert(healthText.indexOf("Port 8000 answered with 200") !== -1, "a port answer is explained");
assert(healthText.indexOf("Deploy the application") !== -1, "the fix is shown");
assert(healthText.indexOf("Other checks that passed: 1") !== -1, "passes are counted, not dumped");

const logLines = [
  { level: "info", msg: "Detected project type: PHP" },
  { level: "dim", msg: "npm ci" },
  { level: "error", msg: "composer failed" },
];
eq(Model.filterLog(logLines, "").length, 3, "an empty log filter keeps every line");
eq(Model.filterLog(logLines, "composer").length, 1, "log filter matches the message");
eq(Model.filterLog(logLines, "INFO").length, 1, "log filter matches the level");
eq(Model.filterLog(["npm ci", "composer failed"], "composer"), ["composer failed"], "string lines filter too");

const row = Model.present(projects, {
  Shop: { status: "running", stage: "build", error: "" },
}, {}, {})[1];
eq(row.state, "deploying", "running deploy wins over account active");
eq(row.label.indexOf("build") !== -1, true, "stage is in the label");

const failedRow = Model.present(projects, { Shop: { status: "failed", error: "build broke" } }, {}, {})[1];
eq(failedRow.state, "failed", "failed deploy");

const stopped = Model.present([projects[1]], {}, {}, {
  Shop: { known: true, rows: [{ state: "exited" }] },
})[0];
eq(stopped.state, "stopped", "all containers exited");

const pending = Model.present([projects[1]], { Shop: { status: "running" } }, { Shop: { verb: "rebuild" } }, {})[0];
eq(pending.state, "pending", "pending caption beats the deploy word");

eq(Model.visibleRows([row, failedRow], "shop").length, 2, "filter matches username case-insensitively");
eq(Model.visibleRows([row], "nope").length, 0, "filter hides misses");

const actions = Model.actionsFor(row);
assert(actions.some((a) => a.verb === "cancel" && a.confirm), "cancel asks first");
assert(actions.some((a) => a.verb === "remove" && a.confirm), "delete asks first");
assert(Model.confirmText("remove", "shop").indexOf("cannot be undone") !== -1, "delete says it cannot be undone");
assert(actions.some((a) => a.verb === "rebuild"), "redeploy is offered");
assert(!Model.actionsFor(Model.present([projects[0]], {}, {}, {})[0]).some((a) => a.verb === "restart"), "classic hosting has no container restart");

eq(Model.diffDeploy(undefined, "failed"), null, "missing previous is not a diff the caller should treat as first... function itself returns failed when previous is empty");
eq(Model.diffDeploy("success", "running"), "deployStarted", "deploy started");
eq(Model.diffDeploy("running", "success"), "deployFinished", "deploy finished");
eq(Model.diffDeploy("running", "failed"), "deployFailed", "deploy failed");
eq(Model.diffDeploy("success", "success"), null, "same status is quiet");
eq(Model.diffAccount("active", "suspended"), "projectSuspended", "suspend edge");
eq(Model.diffAccount("suspended", "suspended"), null, "no repeat suspend");

const argv = Model.notifyArgv({
  kind: "deployFailed",
  username: "shop",
  domain: "shop.example",
  detail: "Bearer 9|sekret",
  engineName: "Home",
}, true);
eq(argv[0], "omarchy-notification-send", "notifier program");
eq(argv[2], "omarchy-action", "critical toast during do-not-disturb uses the shell's exception");
assert(argv.join(" ").indexOf("sekret") === -1, "toast body redacts the token");
assert(argv[argv.length - 1] === "https://shop.example/", "open url is the site");
eq(Model.siteUrl("not a host"), "", "site url refuses spaces");
eq(Model.siteUrl("ok.example"), "https://ok.example/", "site url");

const tls = Model.errorFor(0, 60, "");
eq(tls.kind, "tls", "curl 60 is the certificate");
eq(Model.errorFor(401, 0, '{"message":"Unauthenticated."}').kind, "auth", "401");
eq(Model.errorFor(0, 7, "").kind, "offline", "connection refused");

const report = Model.statusReport({
  configured: true,
  engineId: "engine",
  engineName: "vps",
  origin: "https://vps.example:2011",
  rows: [row],
  requestsLastMin: 3,
  lastAction: { verb: "rebuild", username: "shop", code: 200 },
  token: "4|should-not-leak",
});
assert(JSON.stringify(report).indexOf("should-not-leak") === -1, "status report has no token field to leak");
eq(report.deploying, 1, "status count");
eq(report.lastAction.verb, "rebuild", "last action");

const mode = Model.modeBits("600 damian");
eq(mode.owner, "damian", "stat owner");
eq(mode.worldRead, false, "0600 is private");
eq(Model.modeBits("644 damian").worldRead, true, "0644 is world-readable");
eq(Model.modeBits("660 damian").groupWrite, true, "0660 is group-writable");

eq(Model.bytes(4096), "4 KB", "size format");
eq(Model.phaseLine([{ name: "build", seconds: 12.2 }]), "build 12.2s", "phase line");

const tip = Model.barTip({ configured: true, engineName: "Home", rows: [row] });
assert(tip.indexOf("deploying") !== -1, "tooltip names a deploy");
eq(Model.barTip({ configured: false }).indexOf("not configured") !== -1, true, "unconfigured tooltip");

const saved = Model.settingsFile({
  url: "https://vps.example:2011/",
  token: "4|abcdefghijklmnopqrstuvwxyz",
  insecure: true,
});
assert(saved.ok, "settings file builds");
const savedParsed = Model.parseConfig(saved.text);
eq(savedParsed.engines[0].apiBase, "https://vps.example:2011/api", "saved url is the engine origin");
eq(savedParsed.engines[0].insecure, true, "saved insecure flag");
eq(savedParsed.engines[0].token, "4|abcdefghijklmnopqrstuvwxyz", "saved token");

const blankToken = Model.settingsFile({ url: "https://vps.example:2011", token: "  " });
eq(blankToken.ok, false, "a blank token is refused");
eq(blankToken.error.kind, "token", "blank token kind");
eq(blankToken.text, "", "refused settings produce no file text");

const multiSaved = Model.settingsFile({
  url: "https://new.example:2011",
  token: "9|newtokenxx",
  insecure: false,
  activeId: "home",
  engines: [
    { id: "home", name: "Dom", site: "https://old.example:2011", token: "1|oldtokenx", insecure: true },
    { id: "vps", name: "VPS", site: "https://vps.example:2011", token: "2|keeptoken", insecure: false },
  ],
});
assert(multiSaved.ok, "multi-engine settings file builds");
const multiParsed = Model.parseConfig(multiSaved.text);
eq(multiParsed.engines.map((engine) => engine.id), ["home", "vps"], "both engines stay");
eq(multiParsed.engines[0].site, "https://new.example:2011", "the engine being edited gets the new url");
eq(multiParsed.engines[0].token, "9|newtokenxx", "the engine being edited gets the new token");
eq(multiParsed.engines[1].token, "2|keeptoken", "the other engine keeps its token");
eq(multiParsed.engines[0].insecure, false, "clearing the certificate trust is saved");

const addedEngine = Model.settingsFile({
  mode: "add",
  name: "Work VPS",
  url: "https://work.example:2011",
  token: "5|worktokenxx",
  activeId: "engine",
  engines: [{ id: "engine", name: "Home", site: "https://home.example:2011", token: "1|hometokenx", insecure: true }],
});
assert(addedEngine.ok, "adding an engine builds a file");
const addedParsed = Model.parseConfig(addedEngine.text);
eq(addedParsed.engines.map((engine) => engine.id), ["engine", "work-vps"], "the new engine gets an id from its name");
eq(addedParsed.engines[0].token, "1|hometokenx", "adding keeps the first engine's token");
eq(addedParsed.engines[0].insecure, true, "adding keeps the first engine's certificate trust");
eq(addedEngine.activeId, "work-vps", "the new engine becomes active");
eq(Model.settingsFile({ mode: "add", name: "x", url: "https://x.example", token: " ", engines: [] }).ok, false, "adding without a token is refused");
eq(Model.newEngineId([{ id: "vps" }, { id: "vps-2" }], "VPS", "https://a.example"), "vps-3", "engine ids stay unique");
eq(Model.newEngineId([], "", "https://host.example:2011"), "host.example".replace(/[^a-z0-9_-]+/g, "-"), "an unnamed engine takes its host");

const removedEngine = Model.settingsFile({
  mode: "remove",
  removeId: "home",
  activeId: "home",
  engines: [
    { id: "home", name: "Home", site: "https://home.example:2011", token: "1|hometokenx" },
    { id: "vps", name: "VPS", site: "https://vps.example:2011", token: "2|vpstokenxx" },
  ],
});
assert(removedEngine.ok, "removing an engine builds a file");
const removedParsed = Model.parseConfig(removedEngine.text);
eq(removedParsed.engines.map((engine) => engine.id), ["vps"], "the removed engine is gone");
eq(removedEngine.activeId, "vps", "removing the active engine selects another");
eq(Model.settingsFile({ mode: "remove", removeId: "vps", engines: [{ id: "vps", name: "VPS", site: "https://vps.example", token: "2|vpstokenxx" }] }).ok, false, "the last engine cannot be removed");
eq(Model.settingsFile({ mode: "remove", removeId: "nope", engines: [{ id: "vps", name: "VPS", site: "https://vps.example", token: "2|vpstokenxx" }] }).ok, false, "an unknown engine cannot be removed");

const renamed = Model.settingsFile({
  url: "https://home.example:2011",
  token: "1|hometokenx",
  name: "Basement",
  activeId: "engine",
  engines: [{ id: "engine", name: "home.example", site: "https://home.example:2011", token: "1|hometokenx" }],
});
eq(Model.parseConfig(renamed.text).engines[0].name, "Basement", "editing an engine renames it");

eq(Model.mcpEndpoint("https://vps.example:2011/"), "https://vps.example:2011/mcp", "assistant endpoint");
eq(Model.tokenNameError("  "), "Give the token a name", "a blank token name is refused");
eq(Model.tokenNameError("claude-laptop"), "", "a plain token name is fine");
eq(Model.tokenNameError("a\nb") !== "", true, "a control character in the name is refused");
const mcpList = Model.parseMcpTokens(JSON.stringify({ data: [
  { id: 3, name: "claude", last_used_at: "2026-09-20T10:00:00.000000Z", revoked_at: null, created_at: "2026-09-01T08:00:00.000000Z" },
  { id: 4, name: "old", last_used_at: null, revoked_at: "2026-09-02T08:00:00.000000Z", created_at: "2026-08-01T08:00:00.000000Z" },
  { name: "no id" },
] }));
eq(mcpList.length, 2, "rows without an id are skipped");
eq(Model.mcpTokenLine(mcpList[0]), "used 2026-09-20  ·  created 2026-09-01", "a used token line");
eq(Model.mcpTokenLine(mcpList[1]), "revoked  ·  never used  ·  created 2026-08-01", "a revoked token line");
const minted = Model.parseMcpCreated(JSON.stringify({ data: { id: 9, name: "codex", plain_text_token: "12|abcdefghijklmnop" } }));
eq(minted.token, "12|abcdefghijklmnop", "the minted token is read");
eq(Model.parseMcpCreated(JSON.stringify({ data: { id: 9, name: "codex" } })), null, "a response without a secret is not a token");
eq(Model.parseMcpCreated(JSON.stringify({ data: { plain_text_token: "bad token; rm -rf" } })), null, "an odd secret is refused");
const claudeCmd = Model.assistantCommand("claude", "https://vps.example:2011/mcp", "12|abcdefghijklmnop");
assert(claudeCmd.indexOf("--config \"api_token=12|abcdefghijklmnop\"") !== -1, "claude command carries the token");
assert(Model.assistantCommand("gemini", "https://vps.example:2011/mcp", "12|abcdefghijklmnop").indexOf("Authorization: Bearer 12|abcdefghijklmnop") !== -1, "gemini command carries the bearer");
eq(JSON.parse(Model.assistantCommand("json", "https://vps.example:2011/mcp", "12|abcdefghijklmnop")).mcpServers["panelalpha-engine"].headers.Authorization, "Bearer 12|abcdefghijklmnop", "json config is valid");
eq(Model.assistantCommand("claude", "https://vps.example:2011/mcp", "x; rm -rf ~"), "", "an unsafe token makes no command");
eq(Model.assistantCommand("claude", "javascript:alert(1)", "12|abcdefghijklmnop"), "", "an unsafe endpoint makes no command");
eq(Model.ASSISTANTS.every((a) => Model.assistantCommand(a.id, "https://vps.example:2011/mcp", "12|abcdefghijklmnop") !== ""), true, "every listed assistant has a command");

const mcpCreate = Api.mcpTokenCreateRequest('lap"top');
eq(mcpCreate.method, "POST", "creating a token is a POST");
eq(JSON.parse(mcpCreate.body).name, 'lap"top', "the token name travels as JSON");
assert(Api.config(engine, "t", [mcpCreate]).indexOf('data-raw = "{\\"name\\":\\"lap\\\\\\"top\\"}"') !== -1, "the body is quoted for curl");
eq(Api.mcpTokenRevokeRequest("7").path, "/mcp-tokens/7/revoke", "revoke path");
eq(Api.mcpTokenRevokeRequest("7/../../x").path, "/mcp-tokens/7/revoke", "the id is a number, never a path");
eq(Api.mcpTokenDeleteRequest(7).method, "DELETE", "delete method");

assert(Model.confirmText("mcp-revoke", "claude").indexOf("loses access") !== -1, "revoking a token asks first");
assert(Model.confirmText("remove-engine", "VPS").indexOf("not touched") !== -1, "removing an engine says the engine is untouched");

const noAlert = Model.resourceAlerts(null, { cpu: 99, ram: 50, disk: 60 });
eq(noAlert.events.length, 0, "high CPU alone raises no alert");
const firstAlert = Model.resourceAlerts(null, { cpu: 10, ram: 93, disk: 96 });
eq(firstAlert.events.map((e) => e.resource + ":" + e.critical), ["ram:false", "disk:true"], "RAM and disk alert once each, disk as critical");
eq(Model.resourceAlerts(firstAlert.state, { ram: 94, disk: 97 }).events.length, 0, "an alert is not repeated while the value stays high");
eq(Model.resourceAlerts(firstAlert.state, { ram: 85, disk: 85 }).events.length, 0, "no new alert while it falls but stays above the clear line");
const cleared = Model.resourceAlerts(firstAlert.state, { ram: 70, disk: 70 });
eq(cleared.state, { ram: false, disk: false }, "dropping below the clear line resets the alert");
eq(Model.resourceAlerts(cleared.state, { ram: 91, disk: 10 }).events.length, 1, "it alerts again after a reset");
eq(Model.resourceAlerts(null, { ram: null, disk: undefined }).events.length, 0, "unknown values raise nothing");
eq(Model.notifyWanted({ resources: false }, "resourceHigh"), false, "resource alerts can be turned off");
eq(Model.notifyWanted(null, "resourceHigh"), true, "resource alerts are on by default");
eq(Model.parseConfig('{"url":"https://x.example","token":"1|abcdefgh","notify":false}').notify.resources, false, "notify:false silences resource alerts");
const memArgv = Model.notifyArgv({ kind: "resourceHigh", resource: "ram", detail: "93% used", engineName: "Home" }, false);
assert(memArgv.indexOf("Memory is running low") !== -1, "memory alert headline");
assert(Model.notifyArgv({ kind: "resourceHigh", resource: "disk", critical: true }, false).indexOf("critical") !== -1, "a nearly full disk is critical");

const activity = Model.parseMcpActivity(JSON.stringify({ data: [
  { tool_name: "project_list", token_name: "claude", status: "success", created_at: "2026-09-25T10:05:00.000000Z" },
  { tool_name: "project_delete", token_name: "cursor", status: "error", error_message: "not allowed", created_at: "2026-09-25T09:00:00.000000Z" },
  { token_name: "no tool" },
] }));
eq(activity.length, 2, "activity rows without a tool are skipped");
eq(activity[0].ok, true, "a successful call");
eq(activity[1].ok, false, "a failed call");
assert(/^\d\d-\d\d \d\d:\d\d$/.test(activity[0].when), "activity time is short");
assert(Model.activityLine(activity[1]).indexOf("failed: not allowed") !== -1, "a failed call keeps its reason");
eq(Api.mcpActivityRequest().path, "/mcp-activity-logs", "activity path");

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("ok " + "panelalpha-watch model and api");
