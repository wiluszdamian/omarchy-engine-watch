import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import "Model.js" as Model
import "Api.js" as Api

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string pluginId: "io.github.panelalpha.watch"
  readonly property string home: Quickshell.env("HOME") || ""
  readonly property string userName: Quickshell.env("USER") || Quickshell.env("LOGNAME") || ""
  readonly property string configDir: home + "/.config/panelalpha-watch"
  readonly property string configPath: configDir + "/config.json"

  property bool configured: false
  property var error: null
  property var warning: null
  property var engines: []
  property string activeId: ""
  property string engineName: ""
  property string origin: ""
  property string version: ""
  property string webserver: ""
  property var engineUpdate: null
  property var mcp: null
  property var metrics: ({ "cpu": null, "ram": null, "disk": null })
  property var rows: []
  property string actionMessage: ""
  property bool busy: false
  property var logView: null
  property var appLog: null
  property var databasesFor: null
  property var healthFor: null
  property int panelsOpen: 0
  property double lastPollAt: 0
  property int revision: 0

  property var _engines: []
  property var _poll: ({ "projectsSec": 20, "metricsSec": 30, "deploysSec": 8, "infoSec": 600 })
  property var _notify: ({})
  property string _token: ""
  property var _engine: null
  property var _projects: []
  property var _deploys: ({})
  property var _pending: ({})
  property var _containers: ({})
  property var _seenDeploy: ({})
  property var _seenAccount: ({})
  property bool _baselineAccounts: false
  property var _runtime: ({})
  property string _pollConfig: ""
  property string _pollBody: ""
  property string _pollErr: ""
  property string _inflightUser: ""
  property string _queuedUser: ""
  property string _pollEngineId: ""
  property var _lastAction: ({})
  property var _requestTimes: []
  property double _nextProjects: 0
  property double _nextMetrics: 0
  property double _nextInfo: 0
  property double _nextDeploy: 0
  property int _deployCursor: 0
  property bool _unsafe: false
  property string _statMode: ""
  property string _saveBody: ""
  property string _wantActive: ""
  property var _resourceAlert: ({ "ram": false, "disk": false })

  signal settingsSaved()

  // The config arrives on stdin so the token never appears in argv.
  readonly property string saveScript: "umask 077\n" +
    "dir=$1\nfile=$2\n" +
    "mkdir -p -- \"$dir\"\nchmod 700 -- \"$dir\"\n" +
    "tmp=$(mktemp \"$dir/.config.XXXXXX\")\n" +
    "cat > \"$tmp\"\n" +
    "chmod 600 -- \"$tmp\"\n" +
    "mv -f -- \"$tmp\" \"$file\"\n"

  function panelOpened() {
    panelsOpen = panelsOpen + 1
    primeSoon()
  }

  function panelClosed() {
    panelsOpen = Math.max(0, panelsOpen - 1)
    dismissMcpCreated()
  }

  function containersFor(username) {
    var entry = _containers[username]
    return entry && entry.rows ? entry.rows : []
  }

  function glyphState() {
    if (!configured || error) return "dim"
    var found = Model.counts(rows)
    if (found.failed) return "urgent"
    if (found.deploying) return "deploying"
    return "ok"
  }

  function publish() {
    rows = Model.present(_projects, _deploys, _pending, _containers)
    revision = revision + 1
  }

  function projectBy(username) {
    for (var i = 0; i < _projects.length; i++) {
      if (_projects[i].username === username) return _projects[i]
    }
    return null
  }

  function engineById(id) {
    for (var i = 0; i < _engines.length; i++) {
      if (_engines[i].id === id) return _engines[i]
    }
    return null
  }

  function noteRequest(count) {
    var t = Date.now()
    var next = []
    for (var i = 0; i < _requestTimes.length; i++) {
      if (t - _requestTimes[i] < 60000) next.push(_requestTimes[i])
    }
    for (var n = 0; n < count; n++) next.push(t)
    _requestTimes = next
  }

  function requestsLastMin() {
    var t = Date.now()
    var count = 0
    for (var i = 0; i < _requestTimes.length; i++) {
      if (t - _requestTimes[i] < 60000) count++
    }
    return count
  }

  function dndOn() {
    if (!shell || !shell.firstPartyServiceFor) return false
    var notes = shell.firstPartyServiceFor("omarchy.notifications")
    return !!(notes && notes.doNotDisturb === true)
  }

  function notify(event) {
    var argv = Model.notifyArgv(event, dndOn())
    if (!argv) return
    Util.execArgv(argv)
  }

  function say(text) {
    actionMessage = text
    messageTimer.restart()
  }

  function noteMissing() {
    configured = false
    _token = ""
    _engine = null
    error = { "kind": "noconfig", "title": "Not configured", "detail": "Set the engine URL and an API token in " + configPath }
  }

  function applyConfigText(text) {
    var parsed = Model.parseConfig(text || "")
    warning = parsed.warning
    if (!parsed.ok) {
      configured = false
      _token = ""
      _engine = null
      _engines = []
      engines = []
      error = parsed.error
      return
    }
    _engines = parsed.engines
    _poll = parsed.poll
    _notify = parsed.notify
    var chips = []
    for (var i = 0; i < parsed.engines.length; i++) {
      chips.push({ "id": parsed.engines[i].id, "name": parsed.engines[i].name })
    }
    engines = chips
    if (_wantActive && engineById(_wantActive)) activeId = _wantActive
    _wantActive = ""
    if (!activeId || !engineById(activeId)) activeId = parsed.engines[0].id
    _statMode = "apply"
    statProc.command = ["stat", "-c", "%a %U", configPath]
    statProc.running = true
  }

  function onStat(text, code) {
    var mode = _statMode
    _statMode = ""
    if (code !== 0) {
      configured = false
      _token = ""
      error = { "kind": "noconfig", "title": "Config is missing", "detail": configPath }
      return
    }
    var bits = Model.modeBits(text)
    if (!bits || (userName && bits.owner !== userName) || bits.groupWrite || bits.worldWrite) {
      _unsafe = true
      configured = false
      _token = ""
      error = {
        "kind": "unsafe",
        "title": "Config file is not safe to read",
        "detail": "It must be owned by you and not writable by anyone else."
      }
      return
    }
    _unsafe = false
    if (bits.groupRead || bits.worldRead) {
      warning = {
        "kind": "permissions",
        "title": "Config is readable by others",
        "detail": "chmod 600 the config file. Polling continues."
      }
    }
    if (mode === "refresh" && configured) {
      primeSoon()
      return
    }
    selectEngine(activeId, true)
  }

  function selectEngine(id, reset) {
    var engine = engineById(id)
    if (!engine) return "unknown engine"
    activeId = engine.id
    _engine = engine
    _token = engine.token
    engineName = engine.name
    origin = engine.site
    configured = true
    error = null
    if (warning && warning.kind === "plaintext") warning = null
    if (engine.plaintext) {
      warning = {
        "kind": "plaintext",
        "title": "Token crosses the network in the clear",
        "detail": engine.name + " uses http://. Prefer https://."
      }
    }
    if (reset) {
      _projects = []
      _deploys = ({})
      _pending = ({})
      _containers = ({})
      _seenDeploy = ({})
      _seenAccount = ({})
      _baselineAccounts = false
      _runtime = ({})
      _deployCursor = 0
      _inflightUser = ""
      _queuedUser = ""
      _nextProjects = 0
      _nextMetrics = 0
      _nextInfo = 0
      _nextDeploy = 0
      version = ""
      webserver = ""
      engineUpdate = null
      mcp = null
      _resourceAlert = ({ "ram": false, "disk": false })
      metrics = ({ "cpu": null, "ram": null, "disk": null })
      logView = null
      appLog = null
      databasesFor = null
      healthFor = null
      rows = []
      revision = revision + 1
    }
    primeSoon()
    return "active " + engine.id
  }

  function cycleEngine() {
    if (_engines.length < 2) return
    var idx = 0
    for (var i = 0; i < _engines.length; i++) {
      if (_engines[i].id === activeId) idx = i
    }
    selectEngine(_engines[(idx + 1) % _engines.length].id, true)
  }

  function refresh() {
    if (!configured) {
      configView.reload()
      return
    }
    _statMode = "refresh"
    if (!statProc.running) {
      statProc.command = ["stat", "-c", "%a %U", configPath]
      statProc.running = true
    }
  }

  function primeSoon() {
    primeTimer.restart()
  }

  function settingsUrl() {
    var engine = engineById(activeId)
    return engine ? engine.site : ""
  }

  function settingsInsecure() {
    var engine = engineById(activeId)
    return !!(engine && engine.insecure)
  }

  function settingsName() {
    var engine = engineById(activeId)
    return engine ? engine.name : ""
  }

  function hasToken() {
    var engine = engineById(activeId)
    return !!(engine && engine.token)
  }

  function updateEngine() {
    if (!configured || !_token || !_engine) return "not configured"
    if (engineUpdate && engineUpdate.running) {
      say("An update is already running")
      return "busy"
    }
    if (quickProc.running || actionProc.running) {
      say("Busy with another action")
      return "busy"
    }
    var req = Api.systemUpdateRequest()
    quickProc.verb = "engine-update"
    quickProc.user = ""
    quickProc.body = ""
    quickProc.config = Api.config(_engine, _token, [req])
    noteRequest(1)
    busy = true
    quickProc.stdinEnabled = true
    quickProc.command = ["curl", "-q", "-S", "-K", "-"]
    quickProc.running = true
    return "updating"
  }

  function saveSettings(url, token, insecure, name, mode) {
    if (saveProc.running) return "busy"
    var adding = mode === "add"
    var kept = String(token || "").trim()
    if (!kept && !adding) {
      var current = engineById(activeId)
      if (current && current.token) kept = current.token
    }
    return writeSettings({
      "mode": adding ? "add" : "edit",
      "url": url,
      "token": kept,
      "name": name,
      "insecure": insecure === true
    })
  }

  function removeEngine(id) {
    if (saveProc.running) return "busy"
    return writeSettings({ "mode": "remove", "removeId": id })
  }

  function writeSettings(input) {
    input.engines = _engines
    input.activeId = activeId
    input.poll = _poll
    input.notify = _notify
    var built = Model.settingsFile(input)
    if (!built.ok) {
      say(built.error && built.error.title ? built.error.title : "Could not save")
      return built.error && built.error.kind ? built.error.kind : "invalid"
    }
    _wantActive = built.activeId || ""
    _saveBody = built.text
    saveProc.stdinEnabled = true
    saveProc.command = ["bash", "-c", saveScript, "bash", configDir, configPath]
    saveProc.running = true
    return "saving"
  }

  function mcpEndpoint() {
    return Model.mcpEndpoint(origin)
  }

  function mcpState(patch) {
    var next = ({ "loading": false, "tokens": [], "activity": [], "error": null, "created": null })
    if (mcp) for (var key in mcp) next[key] = mcp[key]
    for (var k in patch) next[k] = patch[k]
    mcp = next
  }

  function mcpRun(verb, req, label) {
    if (!configured || !_token || !_engine) return "not configured"
    if (mcpProc.running) {
      say("Busy with another assistant request")
      return "busy"
    }
    mcpProc.verb = verb
    mcpProc.label = label || ""
    mcpProc.body = ""
    mcpProc.config = Api.config(_engine, _token, [req])
    noteRequest(1)
    mcpProc.stdinEnabled = true
    mcpProc.command = ["curl", "-q", "-S", "-K", "-"]
    mcpProc.running = true
    return verb
  }

  function loadMcpTokens() {
    mcpState({ "loading": true, "error": null })
    var result = mcpRun("mcp-list", Api.mcpTokensRequest(), "")
    if (result !== "mcp-list") mcpState({ "loading": false })
    return result
  }

  function loadMcpActivity() {
    mcpState({ "loading": true, "error": null })
    var result = mcpRun("mcp-activity", Api.mcpActivityRequest(), "")
    if (result !== "mcp-activity") mcpState({ "loading": false })
    return result
  }

  function createMcpToken(name) {
    var problem = Model.tokenNameError(name)
    if (problem) {
      say(problem)
      return "invalid"
    }
    mcpState({ "error": null })
    return mcpRun("mcp-create", Api.mcpTokenCreateRequest(String(name).trim()), String(name).trim())
  }

  function revokeMcpToken(id, name) {
    return mcpRun("mcp-revoke", Api.mcpTokenRevokeRequest(id), name)
  }

  function deleteMcpToken(id, name) {
    return mcpRun("mcp-delete", Api.mcpTokenDeleteRequest(id), name)
  }

  function dismissMcpCreated() {
    if (mcp && mcp.created) mcpState({ "created": null })
  }

  function finishMcp(verb, label, body, exitCode) {
    var results = Model.splitResponses(body)
    var result = results.length ? results[0] : { "code": 0, "exit": exitCode, "body": body }
    var ok = result.exit === 0 && result.code >= 200 && result.code < 300
    if (!ok) {
      var problem = Model.errorFor(result.code, result.exit, result.body)
      if (problem && (result.code === 403 || result.code === 404)) {
        problem = {
          "kind": problem.kind,
          "title": "Assistant tokens are not available",
          "detail": "This API token may not manage them, or the engine is too old to offer them."
        }
      }
      mcpState({ "loading": false, "error": problem || { "kind": "http", "title": "Request failed", "detail": "" } })
      say(problem ? problem.title : "Request failed")
      console.warn("pawatch mcp failed", verb, result.code || 0, "exit=" + (result.exit || exitCode))
      return
    }
    if (verb === "mcp-list") {
      mcpState({ "loading": false, "error": null, "tokens": Model.parseMcpTokens(result.body) })
    } else if (verb === "mcp-activity") {
      mcpState({ "loading": false, "error": null, "activity": Model.parseMcpActivity(result.body) })
    } else if (verb === "mcp-create") {
      var minted = Model.parseMcpCreated(result.body)
      if (!minted) {
        mcpState({ "error": { "kind": "shape", "title": "The engine answered without a token", "detail": "Nothing was created that this panel can show." } })
        say("The engine answered without a token")
      } else {
        mcpState({ "created": { "name": minted.name || label, "token": minted.token, "endpoint": mcpEndpoint() } })
        say("Token created. It is shown once.")
      }
      loadMcpTokens()
    } else {
      say(verb === "mcp-revoke" ? "Revoked " + label : "Deleted " + label)
      loadMcpTokens()
    }
  }

  function copyText(text, message) {
    if (!text) return
    copyProc.message = message || "Copied"
    copyProc.payload = String(text)
    copyProc.stdinEnabled = true
    copyProc.command = ["wl-copy"]
    copyProc.running = true
  }

  function openEngine() {
    if (origin.indexOf("http://") === 0 || origin.indexOf("https://") === 0)
      Util.execArgv(["omarchy-launch-browser", origin + "/"])
  }

  function openSite(username) {
    var project = projectBy(username)
    var url = project ? Model.siteUrl(project.domain) : ""
    if (!url) {
      say("No site address on " + username)
      return
    }
    Util.execArgv(["omarchy-launch-browser", url])
  }

  function launch(reqs, username) {
    if (!_engine || !_token || !reqs || !reqs.length) return
    if (pollProc.running) {
      _queuedUser = username || ""
      return
    }
    _inflightUser = username || ""
    _pollEngineId = activeId
    _pollBody = ""
    _pollErr = ""
    _pollConfig = Api.config(_engine, _token, reqs)
    noteRequest(reqs.length)
    pollProc.stdinEnabled = true
    pollProc.command = ["curl", "-q", "-S", "-K", "-"]
    pollProc.running = true
  }

  function loadDetail(username) {
    var project = projectBy(username)
    if (!project || !_token) return
    var reqs = [Api.databasesRequest(username)]
    if (project.runtime !== "hosting") {
      reqs.unshift(Api.containersRequest(username))
      reqs.push(Api.deployRequest(username, true))
    }
    launch(reqs, username)
  }

  function openDeployLog(username) {
    logView = { "username": username, "lines": [], "status": "", "stage": "", "error": "", "phases": [], "loading": true }
    launch([Api.deployRequest(username, true)], username)
  }

  function openAppLog(username) {
    var list = containersFor(username)
    var service = ""
    for (var i = 0; i < list.length; i++) {
      if (list[i].state === "running" && list[i].service) { service = list[i].service; break }
    }
    if (!service && list.length) service = list[0].service
    if (!service) {
      say("No container to read")
      return
    }
    appLog = { "username": username, "service": service, "lines": [], "loading": true }
    launch([Api.logsRequest(username, service)], username)
  }

  function tick() {
    if (!configured || _unsafe || !_token || !_engine) return
    if (pollProc.running) return
    var t = Date.now()
    var every = Model.intervals(_poll, panelsOpen > 0)
    var reqs = []
    if (_nextInfo === 0 || t >= _nextInfo) {
      reqs.push(Api.infoRequest())
      _nextInfo = t + every.infoMs
    }
    if (_nextMetrics === 0 || t >= _nextMetrics) {
      reqs.push(Api.metricsRequest())
      _nextMetrics = t + every.metricsMs
    }
    if (_nextProjects === 0 || t >= _nextProjects) {
      reqs.push(Api.projectsRequest())
      _nextProjects = t + every.projectsMs
    }
    if (reqs.length) {
      launch(reqs, "")
      return
    }
    if (t < _nextDeploy) return
    var users = dindUsers()
    if (!users.length) return
    var chosen = ""
    for (var i = 0; i < users.length; i++) {
      var known = _deploys[users[i]]
      if (known && known.status === "running") { chosen = users[i]; break }
    }
    if (!chosen) {
      if (_deployCursor >= users.length) _deployCursor = 0
      chosen = users[_deployCursor]
      _deployCursor = _deployCursor + 1
    }
    _nextDeploy = t + every.deploysMs
    launch([Api.deployRequest(chosen, false)], chosen)
  }

  function dindUsers() {
    var out = []
    for (var i = 0; i < _projects.length; i++) {
      var runtime = _projects[i].runtime
      if (runtime === "dind" || runtime === "unknown") out.push(_projects[i].username)
    }
    return out
  }

  function finishPoll(body, errText, exitCode, user, engineId) {
    if (engineId !== activeId) {
      // Answer from an engine we have since switched away from.
      drainQueue()
      return
    }
    var results = []
    try {
      results = Model.splitResponses(body)
    } catch (e) {
      results = []
    }
    if (!results.length) {
      var transport = Model.errorFor(0, exitCode, errText)
      if (transport) error = transport
      drainQueue()
      return
    }
    var anyOk = false
    for (var i = 0; i < results.length; i++) {
      var result = results[i]
      var ok = result.exit === 0 && result.code >= 200 && result.code < 300
      if (ok) {
        anyOk = true
        dispatch(result, user)
      } else if (result.code === 429) {
        error = Model.errorFor(result.code, result.exit, result.body)
        var later = Date.now() + 30000
        _nextProjects = later
        _nextMetrics = later
        _nextDeploy = later
      } else {
        sideError(result, user)
      }
    }
    if (anyOk) {
      if (error && error.kind !== "unsafe" && error.kind !== "noconfig" && error.kind !== "token") error = null
      lastPollAt = Date.now()
    }
    drainQueue()
  }

  function drainQueue() {
    if (!_queuedUser || pollProc.running) return
    var user = _queuedUser
    _queuedUser = ""
    loadDetail(user)
  }

  function sideError(result, user) {
    if ((result.kind === "deploy" || result.kind === "log" || result.kind === "containers") && result.code === 403 && user) {
      markRuntime(user, "hosting")
      return
    }
    if (result.kind === "projects" || result.kind === "metrics" || result.kind === "info") {
      var global = Model.errorFor(result.code, result.exit, result.body)
      if (global) error = global
      return
    }
    var local = Model.errorFor(result.code, result.exit, result.body)
    if (local) say(local.title)
    if (result.kind === "log" && logView && logView.username === user) {
      logView = {
        "username": user,
        "lines": [],
        "status": "",
        "stage": "",
        "error": local ? local.detail : "",
        "phases": [],
        "loading": false
      }
    }
  }

  function dispatch(result, user) {
    if (result.kind === "projects") applyProjects(Model.parseProjects(result.body))
    else if (result.kind === "metrics") {
      var metricsParsed = Model.parseMetrics(result.body)
      if (metricsParsed) {
        metrics = metricsParsed
        checkResources(metricsParsed)
      }
    } else if (result.kind === "info") {
      var info = Model.parseInfo(result.body)
      if (info) {
        version = info.version
        webserver = info.webserver
        engineUpdate = info.update
        if (info.update && info.update.running) _nextInfo = Date.now() + 8000
      }
    } else if ((result.kind === "deploy" || result.kind === "log") && user) {
      var deploy = Model.parseDeployLog(result.body)
      if (deploy) {
        if (deploy.status !== "none") markRuntime(user, "dind")
        noteDeploy(user, deploy, result.kind === "log")
      }
    } else if (result.kind === "containers" && user) {
      putContainers(user, Model.parseContainers(result.body))
    } else if (result.kind === "databases" && user) {
      databasesFor = { "username": user, "rows": Model.parseDatabases(result.body) }
    } else if (result.kind === "health" && user) {
      var report = Model.parseHealth(result.body)
      healthFor = { "username": user, "report": report, "loading": false }
      say(report ? Model.healthHeadline(report) : "The engine did not return a check result.")
    } else if (result.kind === "logs" && user) {
      appLog = { "username": user, "service": appLog && appLog.service ? appLog.service : "", "lines": takeLog(result.body), "loading": false }
    }
  }

  function takeLog(body) {
    var parsed = Model.readJson(body)
    var data = parsed && parsed.data != null ? String(parsed.data) : ""
    var lines = data.split("\n")
    var out = []
    var start = Math.max(0, lines.length - 200)
    for (var i = start; i < lines.length; i++) {
      var line = Model.safeText(lines[i], 200)
      if (line) out.push(line)
    }
    return out
  }

  function applyProjects(list) {
    var next = []
    for (var i = 0; i < list.length; i++) {
      var project = list[i]
      if (_runtime[project.username]) project.runtime = _runtime[project.username]
      if (_baselineAccounts) {
        var kind = Model.diffAccount(_seenAccount[project.username], project.status)
        if (kind && Model.notifyWanted(_notify, kind)) {
          notify({
            "kind": kind,
            "username": project.username,
            "domain": project.domain,
            "engineName": engineName
          })
        }
      }
      next.push(project)
    }
    var seen = ({})
    for (var s = 0; s < next.length; s++) seen[next[s].username] = next[s].status
    _seenAccount = seen
    _baselineAccounts = true
    _projects = next
    publish()
  }

  function checkResources(latest) {
    var found = Model.resourceAlerts(_resourceAlert, latest)
    _resourceAlert = found.state
    if (!Model.notifyWanted(_notify, "resourceHigh")) return
    for (var i = 0; i < found.events.length; i++) {
      var event = found.events[i]
      event.engineName = engineName
      notify(event)
    }
  }

  function noteDeploy(username, deploy, full) {
    var previous = _seenDeploy[username]
    var kind = previous === undefined ? null : Model.diffDeploy(previous, deploy.status)
    var seen = ({})
    for (var key in _seenDeploy) seen[key] = _seenDeploy[key]
    seen[username] = deploy.status
    _seenDeploy = seen
    if (kind && Model.notifyWanted(_notify, kind)) {
      var project = projectBy(username)
      notify({
        "kind": kind,
        "username": username,
        "domain": project ? project.domain : "",
        "detail": deploy.error || "",
        "engineName": engineName
      })
    }
    var deploys = ({})
    for (var name in _deploys) deploys[name] = _deploys[name]
    deploys[username] = deploy
    _deploys = deploys
    publish()
    if (full) {
      logView = {
        "username": username,
        "lines": deploy.lines,
        "status": deploy.status,
        "stage": deploy.stage,
        "error": deploy.error,
        "phases": deploy.phases,
        "loading": false
      }
    }
  }

  function putContainers(username, list) {
    var next = ({})
    for (var key in _containers) next[key] = _containers[key]
    next[username] = { "known": true, "rows": list }
    _containers = next
    publish()
  }

  function markRuntime(username, runtime) {
    if (_runtime[username] === runtime) return
    var flags = ({})
    for (var key in _runtime) flags[key] = _runtime[key]
    flags[username] = runtime
    _runtime = flags
    var next = []
    for (var i = 0; i < _projects.length; i++) {
      if (_projects[i].username !== username) {
        next.push(_projects[i])
        continue
      }
      var copy = ({})
      for (var field in _projects[i]) copy[field] = _projects[i][field]
      copy.runtime = runtime
      next.push(copy)
    }
    _projects = next
    publish()
  }

  function clearPending(username) {
    var next = ({})
    for (var key in _pending) if (key !== username) next[key] = _pending[key]
    _pending = next
    publish()
  }

  function act(verb, username) {
    var name = String(username || "")
    if (!configured || !_token) return "not configured"
    if (_unsafe) return "config unsafe"
    if (verb === "open") {
      openSite(name)
      return "opened"
    }
    if (verb === "logs") {
      openDeployLog(name)
      return "logs"
    }
    if (verb === "applog") {
      openAppLog(name)
      return "logs"
    }
    if (verb === "health") {
      healthFor = { "username": name, "report": null, "loading": true }
      launch([Api.healthRequest(name)], name)
      say("Checking whether " + name + " answers…")
      return "health"
    }
    var row = Model.findRow(rows, name)
    if (!row) {
      say("Unknown project " + name)
      return "unknown " + name
    }
    if (!Model.applicable(verb, row)) {
      say(verb + " does not apply to " + name)
      return "not applicable"
    }
    var proc = verb === "rebuild" ? actionProc : quickProc
    if (proc.running) {
      say("Busy with another action")
      return "busy"
    }
    var req = Api.actionRequest(verb, name)
    if (!req) return "not applicable"
    var pending = ({})
    for (var key in _pending) pending[key] = _pending[key]
    pending[name] = { "verb": verb }
    _pending = pending
    publish()
    proc.verb = verb
    proc.user = name
    proc.body = ""
    proc.config = Api.config(_engine, _token, [req])
    noteRequest(1)
    proc.stdinEnabled = true
    proc.command = ["curl", "-q", "-S", "-K", "-"]
    proc.running = true
    busy = true
    return "queued " + verb + " " + name
  }

  function finishAction(verb, username, body, exitCode) {
    busy = actionProc.running || quickProc.running
    var results = Model.splitResponses(body)
    var result = results.length ? results[0] : { "code": 0, "exit": exitCode, "body": body }
    if (_pending[username] && _pending[username].verb === verb) clearPending(username)
    _lastAction = { "verb": verb, "username": username, "code": result.code || 0 }
    var ok = result.exit === 0 && result.code >= 200 && result.code < 300
    if (ok) {
      say(verb === "engine-update" ? "Engine update started" : doneLabel(verb, username))
      _nextProjects = 0
      _nextDeploy = 0
      _nextInfo = 0
      primeSoon()
    } else {
      var problem = Model.errorFor(result.code, result.exit, result.body)
      say(problem ? problem.title + (problem.detail ? " — " + problem.detail : "") : "Action failed")
      console.warn("pawatch action failed", verb, username, result.code || 0, "exit=" + (result.exit || exitCode))
    }
  }

  function doneLabel(verb, username) {
    if (verb === "rebuild") return "Rebuild finished for " + username
    if (verb === "cancel") return "Cancel requested for " + username
    if (verb === "restart") return "Restarted " + username
    if (verb === "stop") return "Stopped " + username
    if (verb === "start") return "Started " + username
    if (verb === "suspend") return "Suspended " + username
    if (verb === "unsuspend") return "Resumed " + username
    if (verb === "remove") return "Deleted " + username
    return "Done"
  }

  function statusText() {
    return JSON.stringify(Model.statusReport({
      "configured": configured,
      "engineId": activeId,
      "engineName": engineName,
      "origin": origin,
      "errorKind": error && error.kind ? error.kind : "",
      "rows": rows,
      "requestsLastMin": requestsLastMin(),
      "lastAction": _lastAction
    }))
  }

  function enginesText() {
    var parts = []
    for (var i = 0; i < engines.length; i++) {
      parts.push(engines[i].id + (engines[i].id === activeId ? " (active)" : ""))
    }
    return parts.join(", ")
  }

  FileView {
    id: configView
    path: root.configPath
    watchChanges: true
    printErrors: false
    onLoaded: root.applyConfigText(text())
    onLoadFailed: root.noteMissing()
    onFileChanged: reload()
  }

  Process {
    id: statProc
    stdout: SplitParser { onRead: function(line) { statProc.buffer = statProc.buffer + line + "\n" } }
    property string buffer: ""
    onStarted: buffer = ""
    onExited: function(code) { root.onStat(buffer, code); buffer = "" }
  }

  Process {
    id: saveProc
    stdinEnabled: true
    onStarted: {
      write(root._saveBody)
      root._saveBody = ""
      stdinEnabled = false
    }
    onExited: function(code) {
      root._saveBody = ""
      if (code === 0) {
        root.say("Saved")
        root.settingsSaved()
      } else {
        root._wantActive = ""
        root.say("Could not save the settings")
      }
    }
  }

  Process {
    id: pollProc
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { root._pollBody = root._pollBody + line + "\n" } }
    stderr: SplitParser { onRead: function(line) { root._pollErr = root._pollErr + line + "\n" } }
    onStarted: {
      write(root._pollConfig)
      root._pollConfig = ""
      stdinEnabled = false
    }
    onExited: function(code) {
      var body = root._pollBody
      var err = root._pollErr
      var user = root._inflightUser
      var engineId = root._pollEngineId
      root._pollBody = ""
      root._pollErr = ""
      root.finishPoll(body, err, code, user, engineId)
    }
  }

  Process {
    id: actionProc
    property string verb: ""
    property string user: ""
    property string config: ""
    property string body: ""
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { actionProc.body = actionProc.body + line + "\n" } }
    onStarted: {
      write(actionProc.config)
      actionProc.config = ""
      actionProc.stdinEnabled = false
    }
    onExited: function(code) {
      var text = actionProc.body
      var which = actionProc.verb
      var who = actionProc.user
      actionProc.body = ""
      root.finishAction(which, who, text, code)
    }
  }

  Process {
    id: quickProc
    property string verb: ""
    property string user: ""
    property string config: ""
    property string body: ""
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { quickProc.body = quickProc.body + line + "\n" } }
    onStarted: {
      write(quickProc.config)
      quickProc.config = ""
      quickProc.stdinEnabled = false
    }
    onExited: function(code) {
      var text = quickProc.body
      var which = quickProc.verb
      var who = quickProc.user
      quickProc.body = ""
      root.finishAction(which, who, text, code)
    }
  }

  Process {
    id: mcpProc
    property string verb: ""
    property string label: ""
    property string config: ""
    property string body: ""
    stdinEnabled: true
    stdout: SplitParser { onRead: function(line) { mcpProc.body = mcpProc.body + line + "\n" } }
    onStarted: {
      write(mcpProc.config)
      mcpProc.config = ""
      mcpProc.stdinEnabled = false
    }
    onExited: function(code) {
      var text = mcpProc.body
      mcpProc.body = ""
      root.finishMcp(mcpProc.verb, mcpProc.label, text, code)
    }
  }

  Process {
    id: copyProc
    property string payload: ""
    property string message: ""
    stdinEnabled: true
    onStarted: {
      write(copyProc.payload)
      copyProc.payload = ""
      copyProc.stdinEnabled = false
    }
    onExited: function(code) {
      root.say(code === 0 ? copyProc.message : "Could not copy to the clipboard")
    }
  }

  Timer {
    id: clock
    interval: 1000
    repeat: true
    running: true
    onTriggered: root.tick()
  }

  Timer {
    id: primeTimer
    interval: 200
    repeat: false
    onTriggered: root.tick()
  }

  Timer {
    id: messageTimer
    interval: 8000
    repeat: false
    onTriggered: root.actionMessage = ""
  }

  Timer {
    id: missingTimer
    interval: 4000
    repeat: true
    running: !root.configured
    onTriggered: if (!root.configured) configView.reload()
  }

  IpcHandler {
    target: root.pluginId

    function refresh(): string { root.refresh(); return "refreshing" }
    function update(): string { return root.updateEngine() }
    function status(): string { return root.statusText() }
    function engines(): string { return root.enginesText() }
    function engine(id: string): string { return root.selectEngine(id, true) }
    function rebuild(username: string): string { return root.act("rebuild", username) }
    function restart(username: string): string { return root.act("restart", username) }
    function stop(username: string): string { return root.act("stop", username) }
    function start(username: string): string { return root.act("start", username) }
    function cancel(username: string): string { return root.act("cancel", username) }
    function suspend(username: string): string { return root.act("suspend", username) }
    function remove(username: string): string { return root.act("remove", username) }
    function unsuspend(username: string): string { return root.act("unsuspend", username) }
    function open(): string {
      if (root.shell && root.shell.summon) root.shell.summon(root.pluginId, "")
      return "open"
    }
    function close(): string {
      if (root.shell && root.shell.hide) root.shell.hide(root.pluginId)
      return "close"
    }
  }

  Component.onCompleted: configView.reload()
}
