import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as Model

Panel {
  id: root
  moduleName: "io.github.panelalpha.watch"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root

  property int cursor: 0
  property bool stripOpen: false
  property int stripIndex: 0
  property bool filtering: false
  property string filterText: ""
  property string logFilter: ""
  property string view: "list"
  property var confirm: null
  property bool settingsOpen: false
  property bool trustCert: false
  property string settingsMode: "edit"
  property bool mcpNaming: false
  property int mcpCursor: 0
  property int mcpAssistant: 0

  readonly property var mcpInfo: service && service.mcp ? service.mcp : null
  readonly property var mcpTokens: mcpInfo ? mcpInfo.tokens : []
  readonly property var mcpCreated: mcpInfo ? mcpInfo.created : null
  readonly property var mcpActivity: mcpInfo ? mcpInfo.activity : []
  readonly property string mcpCommand: mcpCreated ? Model.assistantCommand(Model.ASSISTANTS[mcpAssistant].id, mcpCreated.endpoint, mcpCreated.token) : ""

  readonly property color fg: bar ? bar.foreground : Color.popups.text
  readonly property color dim: Qt.darker(fg, 1.45)
  readonly property color brand: "#FF7A2F"
  readonly property color brandOn: "#FFFFFF"
  readonly property color brandSoft: Util.alpha(brand, 0.16)
  readonly property string fontName: bar ? bar.fontFamily : Style.font.family
  readonly property color danger: "#E24B4B"
  readonly property color dangerSoft: "#F0716B"
  readonly property color warn: "#E0A106"
  readonly property color good: "#2FBF71"

  function tone(state) {
    if (state === "failed") return danger
    if (state === "deploying" || state === "pending") return brand
    if (state === "running") return good
    if (state === "partial") return warn
    return dim
  }
  readonly property var shown: service ? Model.visibleRows(service.rows, filterText) : []
  readonly property var current: shown.length ? shown[Math.max(0, Math.min(cursor, shown.length - 1))] : null
  readonly property var actions: actionList()

  function actionList() {
    var revision = service ? service.revision : 0
    var base = Model.actionsFor(current)
    if (!current || !service || revision < 0) return base
    var containers = service.containersFor(current.username)
    if (!containers.length) return base
    var out = []
    var added = false
    for (var i = 0; i < base.length; i++) {
      if (!added && (base[i].verb === "open" || base[i].verb === "suspend" || base[i].verb === "unsuspend")) {
        out.push({ "verb": "applog", "label": "App log", "confirm": false })
        added = true
      }
      out.push(base[i])
    }
    if (!added) out.push({ "verb": "applog", "label": "App log", "confirm": false })
    return out
  }

  function open() { openFromHotkey() }

  function openFromHotkey() {
    view = "list"
    var already = opened
    if (!already && service) service.panelOpened()
    if (service && !service.configured) openSettings()
    controller.show()
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
      keyCatcher.forceActiveFocus()
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    var wasOpen = opened
    confirm = null
    stripOpen = false
    filtering = false
    mcpNaming = false
    if (wasOpen && service) service.panelClosed()
    controller.hide()
  }

  function toggle() {
    if (opened) close()
    else open()
  }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function setCenterHoverRevealSuppressed(value) {
    if (bar && typeof bar.setCenterHoverRevealSuppressed === "function")
      bar.setCenterHoverRevealSuppressed(value)
  }

  function ensureVisible() {
    var y = cursor * rowHeight
    if (y < flick.contentY) flick.contentY = y
    else if (y + rowHeight > flick.contentY + flick.height) flick.contentY = y + rowHeight - flick.height
  }

  function scrollView(dy) {
    var most = Math.max(0, flick.contentHeight - flick.height)
    flick.contentY = Math.max(0, Math.min(most, flick.contentY + dy))
  }

  function refreshView() {
    if (!service) return
    if (view === "logs" && current) service.openDeployLog(current.username)
    else if (view === "applog" && current) service.openAppLog(current.username)
    else if (view === "health" && current) service.act("health", current.username)
    else if (view === "mcp") service.loadMcpTokens()
    else if (view === "activity") service.loadMcpActivity()
    else service.refresh()
  }

  function closeFiltering() {
    if (!filtering) return
    filtering = false
    filterField.text = ""
    keyCatcher.forceActiveFocus()
  }

  function openMcp() {
    if (!service || !service.configured) return
    closeFiltering()
    view = "mcp"
    stripOpen = false
    mcpNaming = false
    mcpCursor = 0
    service.loadMcpTokens()
  }

  function openActivity() {
    if (!service || !service.configured) return
    closeFiltering()
    view = "activity"
    service.loadMcpActivity()
  }

  function leaveMcp() {
    mcpNaming = false
    if (service) service.dismissMcpCreated()
    keyCatcher.forceActiveFocus()
  }

  function newToken() {
    if (!service || !service.configured) return
    mcpNaming = true
    mcpNameField.text = ""
    Qt.callLater(function() { if (root.mcpNaming) mcpNameField.forceActiveFocus() })
  }

  function createToken() {
    if (!service) return
    var result = service.createMcpToken(mcpNameField.text)
    if (result === "invalid") return
    mcpNaming = false
    mcpNameField.text = ""
    keyCatcher.forceActiveFocus()
  }

  function cycleAssistant(direction) {
    if (!mcpCreated) return
    var count = Model.ASSISTANTS.length
    mcpAssistant = (mcpAssistant + direction + count) % count
  }

  function copyToken() {
    if (!mcpCreated || !service) return
    service.copyText(mcpCreated.token, "Token copied")
  }

  function copyCommand() {
    if (!mcpCreated || !service || !mcpCommand) return
    service.copyText(mcpCommand, "Command for " + Model.ASSISTANTS[mcpAssistant].label + " copied")
  }

  function askMcp(verb) {
    var token = mcpTokens.length ? mcpTokens[Math.max(0, Math.min(mcpCursor, mcpTokens.length - 1))] : null
    if (!token) return
    if (verb === "mcp-revoke" && token.revoked) return
    confirm = {
      "verb": verb,
      "username": token.name,
      "id": token.id,
      "message": Model.confirmText(verb, token.name)
    }
  }

  function askRemoveEngine() {
    if (!service || !service.engines || service.engines.length < 2) return
    confirm = {
      "verb": "remove-engine",
      "username": service.engineName,
      "id": service.activeId,
      "message": Model.confirmText("remove-engine", service.engineName)
    }
  }

  function ensureMcpVisible() {
    var item = mcpRepeater.itemAt(mcpCursor)
    if (!item) return
    var y = item.mapToItem(viewColumn, 0, 0).y
    if (y < flick.contentY) flick.contentY = y
    else if (y + item.height > flick.contentY + flick.height) flick.contentY = y + item.height - flick.height
  }

  function mcpKey(text) {
    if (text === "n") { newToken(); return true }
    if (text === "y") { copyToken(); return true }
    if (text === "c") { copyCommand(); return true }
    if (text === "i") { openActivity(); return true }
    if (text === "v") { askMcp("mcp-revoke"); return true }
    if (text === "D") { askMcp("mcp-delete"); return true }
    return text !== "r" && text !== "e" && text !== "E" && text !== "g"
  }

  onViewChanged: {
    flick.contentY = 0
    if (view === "list") Qt.callLater(ensureVisible)
  }

  function moveCursor(dy) {
    if (view === "mcp" && mcpTokens.length) {
      mcpCursor = Math.max(0, Math.min(mcpTokens.length - 1, mcpCursor + dy))
      Qt.callLater(ensureMcpVisible)
      return
    }
    if (view !== "list") {
      scrollView(dy * Style.space(60))
      return
    }
    if (stripOpen && actions.length) {
      stripIndex = Math.max(0, Math.min(actions.length - 1, stripIndex + dy))
      return
    }
    if (!shown.length) return
    cursor = Math.max(0, Math.min(shown.length - 1, cursor + dy))
    ensureVisible()
  }

  function activate() {
    if (view === "mcp") {
      if (mcpCreated) copyCommand()
      else newToken()
      return
    }
    if (!current) {
      openSettings()
      return
    }
    if (!stripOpen) {
      stripOpen = true
      stripIndex = 0
      if (service) service.loadDetail(current.username)
      return
    }
    runAction(actions[stripIndex])
  }

  function runAction(action) {
    if (!action || !current || !service) return
    if (action.verb === "logs") {
      closeFiltering()
      view = "logs"
      logFilter = ""
      service.openDeployLog(current.username)
      return
    }
    if (action.verb === "applog") {
      closeFiltering()
      view = "applog"
      logFilter = ""
      service.openAppLog(current.username)
      return
    }
    if (action.verb === "health") {
      closeFiltering()
      view = "health"
      service.act("health", current.username)
      return
    }
    if (action.confirm) {
      confirm = {
        "verb": action.verb,
        "username": current.username,
        "message": Model.confirmText(action.verb, current.username)
      }
      return
    }
    service.act(action.verb, current.username)
  }

  function ask(verb) {
    if (!current) return
    var found = null
    for (var i = 0; i < actions.length; i++) if (actions[i].verb === verb) found = actions[i]
    if (!found) return
    runAction(found)
  }

  function back() {
    if (confirm) { confirm = null; return }
    if (mcpNaming) { mcpNaming = false; keyCatcher.forceActiveFocus(); return }
    if (settingsOpen && service && service.configured) { closeSettings(); return }
    if (filtering) {
      filtering = false
      if (view === "logs" || view === "applog") logFilter = ""
      else filterText = ""
      filterField.text = ""
      keyCatcher.forceActiveFocus()
      return
    }
    if (view === "activity") { view = "mcp"; return }
    if (view !== "list") {
      if (view === "mcp") leaveMcp()
      view = "list"
      logFilter = ""
      return
    }
    if (stripOpen) { stripOpen = false; return }
    close()
  }

  function onText(text) {
    if (view === "activity") return
    if (view === "mcp" && mcpKey(text)) return
    if (text === "a") { if (view === "list") openMcp(); return }
    if (text === "E") { openSettings("add"); return }
    if (text === "/") {
      filtering = true
      filterField.text = (view === "logs" || view === "applog") ? logFilter : filterText
      filterField.forceActiveFocus()
      return
    }
    if (text === "r") { refreshView(); return }
    if (text === "e") { openSettings(); return }
    if (text === "g" && service && service.engines.length > 1) { service.cycleEngine(); return }
    if (!current) return
    if (text === "d") ask("rebuild")
    else if (text === "t") ask("restart")
    else if (text === "s") ask(current.state === "stopped" ? "start" : "stop")
    else if (text === "o") ask("open")
    else if (text === "L") ask("logs")
    else if (text === "D") ask("remove")
  }

  readonly property int rowHeight: Style.space(46)

  function openSettings(mode) {
    closeFiltering()
    var adding = mode === "add" && service && service.configured
    settingsMode = adding ? "add" : "edit"
    settingsOpen = true
    nameField.text = !adding && service && service.settingsName ? service.settingsName() : ""
    urlField.text = !adding && service && service.settingsUrl ? service.settingsUrl() : ""
    tokenField.text = ""
    trustCert = !adding && !!(service && service.settingsInsecure && service.settingsInsecure())
    Qt.callLater(function() {
      if (!root.settingsOpen) return
      if (adding) nameField.forceActiveFocus()
      else urlField.forceActiveFocus()
    })
  }

  function closeSettings() {
    settingsOpen = false
    settingsMode = "edit"
    nameField.text = ""
    urlField.text = ""
    tokenField.text = ""
    keyCatcher.forceActiveFocus()
  }

  function askEngineUpdate() {
    if (!service || !service.configured) return
    if (service.engineUpdate && service.engineUpdate.running) return
    confirm = {
      "verb": "engine-update",
      "username": service.engineName || "this engine",
      "message": Model.confirmText("engine-update", service.engineName || "this engine")
    }
  }

  readonly property string updateLabel: {
    var update = service && service.engineUpdate ? service.engineUpdate : null
    return update && update.running ? "Updating…" : "Update"
  }

  readonly property string updateStatus: {
    if (!service || !service.engineUpdate) return ""
    var summary = Model.updateSummary(service.engineUpdate)
    if (summary === "Updating…" || summary.indexOf("Updating to ") === 0) return ""
    return summary
  }

  function confirmLabel(verb) {
    if (verb === "remove") return "Delete"
    if (verb === "engine-update") return "Update"
    if (verb === "mcp-revoke") return "Revoke"
    if (verb === "mcp-delete") return "Delete"
    if (verb === "remove-engine") return "Remove"
    if (verb === "rebuild") return "Redeploy"
    if (verb === "cancel") return "Cancel deploy"
    if (verb === "stop") return "Stop"
    if (verb === "suspend") return "Suspend"
    return "Do it"
  }

  function cancelLabel(verb) {
    if (verb === "remove" || verb === "mcp-delete" || verb === "remove-engine") return "Keep"
    return "Back"
  }

  readonly property string footerHint: {
    if (settingsOpen) return "enter next or save  ·  esc " + (service && service.configured ? "cancel" : "close")
    if (mcpNaming) return "type a name  ·  enter create  ·  esc cancel"
    if (view === "mcp") {
      if (mcpCreated) return "y token  ·  c command  ·  h l assistant  ·  esc done"
      return "n new  ·  j k  ·  v revoke  ·  D delete  ·  i activity  ·  esc back"
    }
    if (filtering) return "type to filter  ·  esc clear"
    if (view === "logs" || view === "applog") return "j k scroll  ·  / filter  ·  r refresh  ·  esc back"
    if (view === "health") return "r check again  ·  esc back"
    if (view === "activity") return "j k scroll  ·  r refresh  ·  esc back"
    if (stripOpen) return "h l choose  ·  enter run  ·  esc back"
    var hint = "j k  ·  enter  ·  / search  ·  a assistants  ·  e settings"
    if (service && service.engines.length > 1) hint += "  ·  g engine"
    return hint
  }

  function submitSettings() {
    if (!service || !service.saveSettings) return
    service.saveSettings(urlField.text, tokenField.text, trustCert, nameField.text, settingsMode)
  }

  Connections {
    target: root.service
    ignoreUnknownSignals: true
    function onSettingsSaved() {
      root.closeSettings()
    }
    function onActiveIdChanged() {
      root.mcpCursor = 0
      if (root.view === "mcp" && root.service) root.service.loadMcpTokens()
    }
  }

  onShownChanged: {
    if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1)
  }

  onActionsChanged: {
    if (stripIndex >= actions.length) stripIndex = Math.max(0, actions.length - 1)
  }

  onMcpTokensChanged: {
    if (mcpCursor >= mcpTokens.length) mcpCursor = Math.max(0, mcpTokens.length - 1)
  }


  component PanelText: Text {
    textFormat: Text.PlainText
    font.family: root.fontName
  }

  component Caption: PanelText {
    font.pixelSize: Style.font.caption
    color: root.dim
  }

  component Body: PanelText {
    font.pixelSize: Style.font.body
    color: root.fg
  }

  component WrapCaption: Caption {
    width: parent.width
    wrapMode: Text.WordWrap
  }

  component WrapBody: Body {
    width: parent.width
    wrapMode: Text.WordWrap
  }

  component ErrorNotice: WrapCaption {
    visible: !!(root.mcpInfo && root.mcpInfo.error)
    color: root.danger
    text: root.mcpInfo && root.mcpInfo.error ? root.mcpInfo.error.title + (root.mcpInfo.error.detail ? ". " + root.mcpInfo.error.detail : "") : ""
  }

  component AccentBar: Rectangle {
    width: 3
    height: parent.height
    color: root.brand
  }

  component OutlineButton: Button {
    bordered: true
    foreground: root.fg
    accent: root.brand
    fontFamily: root.fontName
    fontSize: Style.font.caption
  }

  component AccentButton: OutlineButton {
    foreground: root.brand
  }

  component FilledButton: Button {
    background: root.brand
    foreground: root.brandOn
    accent: root.brand
    fontFamily: root.fontName
  }

  component FilledCaptionButton: FilledButton {
    fontSize: Style.font.caption
  }

  component DangerButton: Button {
    bordered: true
    foreground: root.dangerSoft
    accent: root.danger
    fontFamily: root.fontName
    fontSize: Style.font.caption
  }

  component ChipButton: Button {
    bordered: !active
    background: active ? root.brand : "transparent"
    foreground: active ? root.brandOn : root.fg
    accent: root.brand
    fontFamily: root.fontName
    fontSize: Style.font.caption
  }

  component RowHighlight: Rectangle {
    id: highlightRoot
    property bool chosen: false
    property bool hot: false
    height: root.rowHeight
    radius: Style.cornerRadius
    color: chosen ? root.brandSoft : (hot ? Util.alpha(root.brand, 0.08) : "transparent")

    Rectangle {
      width: 3
      height: parent.height - Style.space(10)
      anchors.verticalCenter: parent.verticalCenter
      anchors.left: parent.left
      radius: 2
      color: root.brand
      visible: highlightRoot.chosen
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: Style.space(460)
    contentHeight: Style.space(560)
    borderSpec: Border.surfaceSpec("popups", "border", root.brand, Math.max(2, Style.space(2)))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: root.confirm !== null || filterField.activeFocus || urlField.activeFocus || tokenField.activeFocus || nameField.activeFocus || mcpNameField.activeFocus
      onMoveRequested: function(dx, dy) {
        if (dx !== 0 && root.view === "mcp") root.cycleAssistant(dx)
        else if (dx !== 0 && root.view === "list" && !root.stripOpen && root.service && root.service.engines.length > 1) {
          root.service.cycleEngine()
        }
        if (dy !== 0) root.moveCursor(dy)
        if (dx !== 0 && root.stripOpen && root.view === "list") root.moveCursor(dx)
      }
      onActivateRequested: root.activate()
      onCloseRequested: root.back()
      onDeleteRequested: root.ask("cancel")
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) { root.onText(text) }

      Column {
        anchors.fill: parent
        spacing: Style.space(8)

        Column {
          width: parent.width
          spacing: Style.space(8)

          Item {
            id: headerRow
            width: parent.width
            height: heroMark.height

            Image {
              id: heroMark
              width: Style.space(42)
              height: Style.space(42)
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
              source: Qt.resolvedUrl("logo.svg")
              fillMode: Image.PreserveAspectFit
              smooth: true
              mipmap: true
            }

            Column {
              anchors.left: heroMark.right
              anchors.leftMargin: Style.space(12)
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)

              Row {
                spacing: Style.space(8)

                PanelText {
                  text: "PanelAlpha"
                  color: root.fg
                  font.pixelSize: Style.font.title
                  font.bold: true
                }

                Rectangle {
                  anchors.verticalCenter: parent.verticalCenter
                  implicitWidth: engineWord.implicitWidth + Style.space(10)
                  implicitHeight: engineWord.implicitHeight + Style.space(4)
                  radius: height / 2
                  color: root.brand

                  Caption {
                    id: engineWord
                    anchors.centerIn: parent
                    text: "Engine"
                    color: root.brandOn
                    font.bold: true
                  }
                }
              }
            }
          }

          WrapCaption {
            visible: root.heroLine !== ""
            maximumLineCount: 2
            elide: Text.ElideRight
            text: root.heroLine
          }

          Row {
            id: usageRow
            visible: root.service && root.service.configured
            width: parent.width
            spacing: Style.space(12)

            Repeater {
              model: root.usageItems

              delegate: Column {
                required property var modelData
                width: (usageRow.width - usageRow.spacing * 2) / 3
                spacing: Style.space(4)

                Item {
                  width: parent.width
                  height: usageLabel.implicitHeight

                  Caption {
                    id: usageLabel
                    anchors.left: parent.left
                    text: modelData.label
                  }

                  PanelText {
                    anchors.right: parent.right
                    text: modelData.text
                    color: root.fg
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }
                }

                Rectangle {
                  width: parent.width
                  height: Style.space(6)
                  radius: height / 2
                  color: Util.alpha(root.brand, 0.22)

                  Rectangle {
                    width: Math.max(modelData.ratio > 0 ? 4 : 0, parent.width * modelData.ratio)
                    height: parent.height
                    radius: height / 2
                    color: modelData.ratio >= 0.9 ? root.danger : (modelData.ratio >= 0.75 ? root.warn : root.brand)
                  }
                }
              }
            }
          }

          Row {
            visible: root.service && root.service.configured && !root.settingsOpen
            spacing: Style.space(6)

            AccentButton {
              text: "Assistants"
              tooltipText: "Create tokens for AI assistants (a)"
              selected: root.view === "mcp"
              onClicked: root.view === "mcp" ? root.back() : root.openMcp()
            }

            AccentButton {
              text: root.updateLabel
              tooltipText: "Update the engine on the server"
              onClicked: root.askEngineUpdate()
            }

            OutlineButton {
              text: "Settings"
              tooltipText: "Edit this engine (e)"
              onClicked: root.openSettings()
            }
          }

          WrapCaption {
            visible: root.updateStatus !== ""
            text: root.updateStatus
          }

          Rectangle {
            width: parent.width
            height: 1
            color: Util.alpha(root.brand, 0.45)
          }
        }

        WrapCaption {
          visible: root.service && root.service.actionMessage !== ""
          color: root.brand
          text: root.service ? root.service.actionMessage : ""
        }

        Rectangle {
          visible: root.calloutText !== ""
          width: parent.width
          implicitHeight: callout.implicitHeight + Style.space(16)
          height: implicitHeight
          radius: Style.cornerRadius
          color: root.brandSoft

          AccentBar {}

          Column {
            id: callout
            width: parent.width - Style.space(22)
            x: Style.space(14)
            y: Style.space(8)
            spacing: Style.space(6)

            WrapBody {
              text: root.calloutText
            }

            FilledButton {
              visible: root.needsConfig && !root.settingsOpen
              text: "Connect engine"
              onClicked: root.openSettings()
            }
          }
        }

        Flow {
          visible: root.service && root.service.configured
          spacing: Style.space(6)
          width: parent.width

          Repeater {
            model: root.service && root.service.engines.length > 1 ? root.service.engines.length : 0
            delegate: ChipButton {
              required property int index
              readonly property var chip: root.service.engines[index]
              text: chip.name
              active: chip.id === root.service.activeId
              onClicked: {
                if (root.settingsOpen) root.closeSettings()
                root.service.selectEngine(chip.id, true)
              }
            }
          }

          OutlineButton {
            text: "+ Engine"
            tooltipText: "Connect another PanelAlpha Engine (E)"
            foreground: root.dim
            onClicked: root.openSettings("add")
          }
        }

        Rectangle {
          id: settingsForm
          visible: root.settingsOpen
          width: parent.width
          implicitHeight: settingsBody.implicitHeight + Style.space(28)
          height: implicitHeight
          radius: Style.cornerRadius
          color: root.brandSoft

          Column {
            id: settingsBody
            width: parent.width - Style.space(28)
            x: Style.space(14)
            y: Style.space(14)
            spacing: Style.space(8)

            Caption {
              width: parent.width
              text: root.settingsMode === "add" ? "New engine" : "Engine"
              color: root.brand
              font.bold: true
              font.letterSpacing: 1.2
            }

            Caption {
              width: parent.width
              text: "Name"
            }

            TextField {
              id: nameField
              width: parent.width
              placeholderText: "Home, Work VPS… (optional)"
              foreground: root.fg
              accent: root.brand
              font.family: root.fontName
              onAccepted: urlField.forceActiveFocus()
              Keys.onEscapePressed: function(event) {
                root.back()
                event.accepted = true
              }
            }

            Caption {
              width: parent.width
              text: "Engine URL"
            }

            TextField {
              id: urlField
              width: parent.width
              placeholderText: "https://vps.example:2011"
              foreground: root.fg
              accent: root.brand
              font.family: root.fontName
              inputMethodHints: Qt.ImhUrlCharactersOnly
              onAccepted: tokenField.forceActiveFocus()
              Keys.onEscapePressed: function(event) {
                root.back()
                event.accepted = true
              }
            }

            Caption {
              width: parent.width
              text: "API token"
            }

            TextField {
              id: tokenField
              width: parent.width
              password: true
              foreground: root.fg
              accent: root.brand
              font.family: root.fontName
              placeholderText: root.settingsMode === "edit" && root.service && root.service.hasToken() ? "leave blank to keep the current token" : "paste the token from pae api:token:create"
              onAccepted: root.submitSettings()
              Keys.onEscapePressed: function(event) {
                root.back()
                event.accepted = true
              }
            }

            Toggle {
              width: parent.width
              label: "Trust the certificate"
              description: "Turn on when the engine uses its own certificate."
              checked: root.trustCert
              foreground: root.fg
              accent: root.brand
              fontFamily: root.fontName
              onClicked: root.trustCert = !root.trustCert
            }

            Row {
              spacing: Style.space(8)

              FilledButton {
                text: "Save"
                onClicked: root.submitSettings()
              }

              OutlineButton {
                visible: root.service && root.service.configured
                text: "Cancel"
                onClicked: root.closeSettings()
              }

              DangerButton {
                visible: root.settingsMode === "edit" && root.service && root.service.engines.length > 1
                text: "Remove"
                onClicked: root.askRemoveEngine()
              }
            }
          }
        }

        TextField {
          id: filterField
          visible: root.filtering
          width: parent.width
          placeholderText: (root.view === "logs" || root.view === "applog") ? "Filter log lines" : "Filter projects"
          foreground: root.fg
          font.family: root.fontName
          onTextChanged: {
            if (root.view === "logs" || root.view === "applog") root.logFilter = text
            else root.filterText = text
          }
          Keys.onEscapePressed: function(event) {
            root.back()
            event.accepted = true
          }
        }

        Flickable {
          id: flick
          visible: !root.settingsOpen
          width: parent.width
          height: Math.max(Style.space(140), parent.height - y - (stripColumn.visible ? stripColumn.implicitHeight + Style.space(8) : 0) - footer.implicitHeight - Style.space(24))
          clip: true
          contentWidth: width
          contentHeight: viewColumn.implicitHeight
          boundsBehavior: Flickable.StopAtBounds
          flickableDirection: Flickable.VerticalFlick

          Column {
            id: viewColumn
            width: flick.width
            spacing: Style.space(4)

            Column {
              visible: root.view === "list"
              width: parent.width
              spacing: Style.space(2)

              WrapBody {
                visible: root.shown.length === 0
                color: root.dim
                text: root.emptyText
              }

              Repeater {
                model: root.shown.length
                delegate: RowHighlight {
                  required property int index
                  readonly property var row: root.shown[index]
                  chosen: index === root.cursor
                  hot: rowMouse.containsMouse
                  width: viewColumn.width

                  Row {
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.leftMargin: Style.space(12)
                    anchors.rightMargin: Style.space(8)
                    spacing: Style.space(8)

                    Rectangle {
                      width: Style.space(8)
                      height: Style.space(8)
                      radius: width / 2
                      anchors.verticalCenter: parent.verticalCenter
                      color: root.tone(row.state)
                    }

                    Column {
                      width: parent.width - Style.space(16)
                      spacing: Style.space(1)

                      Body {
                        width: parent.width
                        elide: Text.ElideRight
                        font.bold: chosen
                        text: row.username
                      }

                      Caption {
                        width: parent.width
                        elide: Text.ElideRight
                        color: root.tone(row.state)
                        text: row.label + (row.domain ? "  ·  " + row.domain : "") + (row.strategy ? "  ·  " + row.strategy : "")
                      }
                    }
                  }

                  MouseArea {
                    id: rowMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: {
                      root.cursor = index
                      root.stripOpen = true
                      root.stripIndex = 0
                      root.view = "list"
                      if (root.service) root.service.loadDetail(row.username)
                    }
                  }
                }
              }
            }

            Column {
              visible: root.view === "logs" || root.view === "applog" || root.view === "health"
              width: parent.width
              spacing: Style.space(6)

              Row {
                spacing: Style.space(6)

                OutlineButton {
                  text: "Back"
                  onClicked: root.back()
                }

                AccentButton {
                  text: root.view === "health" ? "Check again" : "Refresh"
                  onClicked: root.refreshView()
                }
              }

              WrapBody {
                font.bold: true
                text: root.view === "health" ? root.healthTitle : root.logTitle
              }

              WrapCaption {
                text: root.view === "health" ? root.healthBody : root.logBody
              }
            }

            Column {
              id: mcpView
              visible: root.view === "mcp"
              width: parent.width
              spacing: Style.space(8)

              Row {
                spacing: Style.space(6)

                OutlineButton {
                  text: "Back"
                  onClicked: root.back()
                }

                FilledCaptionButton {
                  text: "New token"
                  onClicked: root.newToken()
                }

                AccentButton {
                  text: "Refresh"
                  onClicked: root.refreshView()
                }

                OutlineButton {
                  text: "Activity"
                  onClicked: root.openActivity()
                }
              }

              WrapBody {
                font.bold: true
                text: "Assistant tokens" + (root.service && root.service.engineName ? "  ·  " + root.service.engineName : "")
              }

              WrapCaption {
                text: "A token lets an AI assistant work with this engine over MCP. It cannot call the REST API. The engine shows it once, so copy it right away."
              }

              ErrorNotice {}

              Column {
                visible: root.mcpNaming
                width: parent.width
                spacing: Style.space(6)

                TextField {
                  id: mcpNameField
                  width: parent.width
                  placeholderText: "Token name, for example claude-laptop"
                  foreground: root.fg
                  accent: root.brand
                  font.family: root.fontName
                  onAccepted: root.createToken()
                  Keys.onEscapePressed: function(event) {
                    root.back()
                    event.accepted = true
                  }
                }

                Row {
                  spacing: Style.space(6)

                  FilledCaptionButton {
                    text: "Create"
                    onClicked: root.createToken()
                  }

                  OutlineButton {
                    text: "Cancel"
                    onClicked: { root.mcpNaming = false; keyCatcher.forceActiveFocus() }
                  }
                }
              }

              Rectangle {
                visible: root.mcpCreated !== null
                width: parent.width
                implicitHeight: createdBody.implicitHeight + Style.space(20)
                height: implicitHeight
                radius: Style.cornerRadius
                color: root.brandSoft

                AccentBar {}

                Column {
                  id: createdBody
                  width: parent.width - Style.space(26)
                  x: Style.space(14)
                  y: Style.space(10)
                  spacing: Style.space(6)

                  WrapCaption {
                    color: root.brand
                    font.bold: true
                    text: root.mcpCreated ? "New token “" + root.mcpCreated.name + "”. Shown once." : ""
                  }

                  Caption {
                    width: parent.width
                    wrapMode: Text.WrapAnywhere
                    text: root.mcpCreated ? root.mcpCreated.token : ""
                  }

                  Caption {
                    width: parent.width
                    text: "Add it to an assistant"
                  }

                  Flow {
                    width: parent.width
                    spacing: Style.space(4)

                    Repeater {
                      model: Model.ASSISTANTS.length
                      delegate: ChipButton {
                        required property int index
                        text: Model.ASSISTANTS[index].label
                        active: index === root.mcpAssistant
                        onClicked: root.mcpAssistant = index
                      }
                    }
                  }

                  Caption {
                    width: parent.width
                    wrapMode: Text.WrapAnywhere
                    text: root.mcpCommand
                  }

                  Row {
                    spacing: Style.space(6)

                    FilledCaptionButton {
                      text: "Copy command"
                      onClicked: root.copyCommand()
                    }

                    OutlineButton {
                      text: "Copy token"
                      onClicked: root.copyToken()
                    }

                    OutlineButton {
                      text: "Done"
                      onClicked: root.service.dismissMcpCreated()
                    }
                  }
                }
              }

              WrapBody {
                visible: root.mcpTokens.length === 0
                color: root.dim
                text: root.mcpInfo && root.mcpInfo.loading ? "Loading tokens…" : (root.mcpInfo && root.mcpInfo.error ? "" : "No assistant tokens yet. Press n to create one.")
              }

              Repeater {
                id: mcpRepeater
                model: root.mcpTokens.length
                delegate: RowHighlight {
                  required property int index
                  readonly property var token: root.mcpTokens[index]
                  chosen: index === root.mcpCursor
                  hot: tokenMouse.containsMouse
                  width: mcpView.width

                  MouseArea {
                    id: tokenMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    onClicked: root.mcpCursor = index
                  }

                  Row {
                    id: tokenButtons
                    anchors.right: parent.right
                    anchors.rightMargin: Style.space(8)
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(4)

                    OutlineButton {
                      visible: !token.revoked
                      text: "Revoke"
                      onClicked: { root.mcpCursor = index; root.askMcp("mcp-revoke") }
                    }

                    DangerButton {
                      text: "Delete"
                      onClicked: { root.mcpCursor = index; root.askMcp("mcp-delete") }
                    }
                  }

                  Column {
                    anchors.left: parent.left
                    anchors.leftMargin: Style.space(12)
                    anchors.right: tokenButtons.left
                    anchors.rightMargin: Style.space(8)
                    anchors.verticalCenter: parent.verticalCenter
                    spacing: Style.space(1)

                    Body {
                      width: parent.width
                      elide: Text.ElideRight
                      color: token.revoked ? root.dim : root.fg
                      font.bold: chosen
                      text: token.name
                    }

                    Caption {
                      width: parent.width
                      elide: Text.ElideRight
                      color: token.revoked ? root.danger : root.dim
                      text: Model.mcpTokenLine(token)
                    }
                  }
                }
              }
            }

            Column {
              visible: root.view === "activity"
              width: parent.width
              spacing: Style.space(8)

              Row {
                spacing: Style.space(6)

                OutlineButton {
                  text: "Back"
                  onClicked: root.back()
                }

                AccentButton {
                  text: "Refresh"
                  onClicked: root.refreshView()
                }
              }

              WrapBody {
                font.bold: true
                text: "What assistants did" + (root.service && root.service.engineName ? "  ·  " + root.service.engineName : "")
              }

              ErrorNotice {}

              WrapBody {
                visible: root.mcpActivity.length === 0
                color: root.dim
                text: root.mcpInfo && root.mcpInfo.loading ? "Loading activity…" : (root.mcpInfo && root.mcpInfo.error ? "" : "No assistant calls yet.")
              }

              Repeater {
                model: root.mcpActivity.length
                delegate: Column {
                  required property int index
                  readonly property var entry: root.mcpActivity[index]
                  width: parent.width
                  spacing: Style.space(1)

                  Body {
                    width: parent.width
                    elide: Text.ElideRight
                    color: entry.ok ? root.fg : root.dangerSoft
                    text: entry.tool
                  }

                  Caption {
                    width: parent.width
                    elide: Text.ElideRight
                    text: Model.activityLine(entry)
                  }
                }
              }
            }
          }
        }

        Column {
          id: stripColumn
          visible: !root.settingsOpen && root.stripOpen && root.view === "list" && root.current
          width: parent.width
          spacing: Style.space(6)

          Flow {
            width: parent.width
            spacing: Style.space(6)

            Repeater {
              model: root.actions.length
              delegate: ChipButton {
                required property int index
                readonly property var action: root.actions[index]
                text: action.label
                active: index === root.stripIndex
                selected: index === root.stripIndex
                onClicked: {
                  root.stripIndex = index
                  root.runAction(action)
                }
              }
            }
          }

          WrapCaption {
            text: root.detailText
          }
        }

        Row {
          id: footer
          width: parent.width
          spacing: Style.space(6)

          Rectangle {
            width: Style.space(8)
            height: Style.space(8)
            radius: width / 2
            anchors.verticalCenter: parent.verticalCenter
            color: root.brand
          }

          Caption {
            width: parent.width - Style.space(14)
            elide: Text.ElideRight
            text: root.footerHint
          }
        }
      }

      ConfirmDialog {
        id: confirmDialog
        anchors.fill: parent
        opened: root.confirm !== null
        focus: opened
        message: root.confirm ? root.confirm.message : ""
        confirmText: root.confirm ? root.confirmLabel(root.confirm.verb) : "Do it"
        cancelText: root.confirm ? root.cancelLabel(root.confirm.verb) : "Back"
        background: Color.popups.background
        foreground: root.fg
        selectedText: root.brand
        fontFamily: root.fontName
        onOpenedChanged: if (opened) { selectedIndex = 0; forceActiveFocus() }
        Keys.onPressed: function(event) { if (handleKey(event)) event.accepted = true }
        onConfirmed: {
          var pending = root.confirm
          root.confirm = null
          if (pending && root.service) {
            if (pending.verb === "engine-update") root.service.updateEngine()
            else if (pending.verb === "mcp-revoke") root.service.revokeMcpToken(pending.id, pending.username)
            else if (pending.verb === "mcp-delete") root.service.deleteMcpToken(pending.id, pending.username)
            else if (pending.verb === "remove-engine") root.service.removeEngine(pending.id)
            else root.service.act(pending.verb, pending.username)
          }
          keyCatcher.forceActiveFocus()
        }
        onCanceled: {
          root.confirm = null
          keyCatcher.forceActiveFocus()
        }
      }
    }
  }

  readonly property bool needsConfig: !service || !service.configured || (service.error && (service.error.kind === "noconfig" || service.error.kind === "token" || service.error.kind === "json" || service.error.kind === "shape" || service.error.kind === "url" || service.error.kind === "unsafe"))

  readonly property string heroLine: {
    if (!service || !service.configured) return "Connect your PanelAlpha Engine"
    var bits = []
    if (service.engineName && service.engineName !== "PanelAlpha") bits.push(service.engineName)
    if (service.version) bits.push(service.version)
    if (service.webserver) bits.push(service.webserver)
    return bits.join("  ·  ")
  }

  readonly property var usageItems: {
    var m = service && service.metrics ? service.metrics : {}
    function item(label, value) {
      var n = value == null || value === undefined ? NaN : Number(value)
      var known = isFinite(n)
      return {
        "label": label,
        "text": known ? Math.round(n) + "%" : "—",
        "ratio": known ? Math.max(0, Math.min(1, n / 100)) : 0
      }
    }
    return [item("CPU", m.cpu), item("RAM", m.ram), item("Disk", m.disk)]
  }

  readonly property string emptyText: {
    if (!service || !service.configured) return "Connect an engine to see projects."
    if (filterText) return "No project matches “" + filterText + "”."
    if (service.lastPollAt === 0 && !service.error) return "Loading projects…"
    return "No projects on this engine."
  }

  readonly property string calloutText: {
    if (!service) return "Starting…"
    if (service.error && service.error.title) {
      var detail = service.error.detail ? " " + service.error.detail : ""
      return service.error.title + "." + detail
    }
    if (service.warning && service.warning.title) return service.warning.title + ". " + (service.warning.detail || "")
    return ""
  }

  readonly property string logTitle: {
    if (view === "applog") {
      var app = service && service.appLog ? service.appLog : null
      if (!app) return "App log"
      var appTitle = (app.service || "App") + (app.loading ? "  ·  loading" : "")
      var appTotal = app.lines ? app.lines.length : 0
      if (logFilter && appTotal) appTitle += "  ·  " + Model.filterLog(app.lines, logFilter).length + "/" + appTotal
      return appTitle
    }
    var log = service && service.logView ? service.logView : null
    if (!log) return "Deploy log"
    var title = log.username || "Deploy log"
    if (log.status) title += "  ·  " + log.status
    if (log.stage) title += "  ·  " + log.stage
    if (log.loading) title += "  ·  loading"
    var shownCount = Model.filterLog(log.lines || [], logFilter).length
    var totalCount = log.lines ? log.lines.length : 0
    if (logFilter && totalCount) title += "  ·  " + shownCount + "/" + totalCount
    return title
  }

  readonly property string logBody: {
    if (view === "applog") {
      var app = service && service.appLog ? service.appLog : null
      if (!app || app.loading) return app && app.loading ? "Reading the container log…" : "No log."
      return formatLog(app.lines || [])
    }
    var log = service && service.logView ? service.logView : null
    if (!log) return ""
    if (log.loading) return "Reading the deploy log…"
    var parts = []
    if (!logFilter) {
      if (log.error) parts.push(log.error)
      if (log.phases && log.phases.length) parts.push(Model.phaseLine(log.phases))
    }
    var body = formatLog(log.lines || [])
    if (body) parts.push(body)
    else if (!parts.length) parts.push(logFilter ? "No line matches the filter." : "No deploy log yet.")
    return parts.join("\n")
  }

  function formatLog(lines) {
    var matched = Model.filterLog(lines, logFilter)
    if (logFilter && lines.length && !matched.length) return "No line matches the filter."
    var out = []
    for (var i = 0; i < matched.length; i++) {
      var line = matched[i]
      out.push(typeof line === "string" ? line : (line.level + "  " + line.msg))
    }
    return out.join("\n")
  }

  readonly property string healthTitle: {
    var health = service && service.healthFor ? service.healthFor : null
    var name = health && health.username ? health.username : (current ? current.username : "")
    return (name || "Project") + "  ·  check"
  }

  readonly property string healthBody: {
    var health = service && service.healthFor ? service.healthFor : null
    if (!health || health.loading || !health.report) return "Checking whether the application answers on its port…"
    return Model.healthLines(health.report).join("\n\n")
  }

  readonly property string detailText: {
    if (!current || !service) return ""
    var parts = []
    if (current.gitRepo) parts.push(current.gitRepo)
    if (current.domains && current.domains.length) parts.push(current.domains.join(", "))
    if (current.error) parts.push(current.error)
    if (current.warnings && current.warnings.length) parts.push(current.warnings.join(" "))
    var deploy = current.deploy
    if (deploy && deploy.phases && deploy.phases.length) parts.push(Model.phaseLine(deploy.phases))
    var containers = service.containersFor(current.username)
    for (var i = 0; i < containers.length && i < 6; i++) {
      var row = containers[i]
      parts.push((row.service || row.name) + " " + (row.state || row.status))
    }
    var databases = service.databasesFor
    if (databases && databases.username === current.username && databases.rows) {
      var names = []
      for (var d = 0; d < databases.rows.length; d++) {
        var size = Model.bytes(databases.rows[d].size)
        names.push(databases.rows[d].name + (size ? " " + size : ""))
      }
      if (names.length) parts.push(names.join(", "))
    }
    var health = service.healthFor
    if (health && health.username === current.username) {
      if (health.loading) parts.push("Checking whether the application answers…")
      else if (health.report) parts.push(Model.healthHeadline(health.report))
    }
    return parts.join("\n")
  }

  Component.onDestruction: if (opened && service) service.panelClosed()
}
