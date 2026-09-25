import QtQuick
import qs.Commons
import qs.Ui
import "Model.js" as ModelTip

BarWidget {
  id: root
  moduleName: "io.github.panelalpha.watch"

  readonly property var svc: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
    if ("service" in target) target.service = root.svc
  }

  function open() {
    if (panelLoader.item && panelLoader.item.openFromHotkey) panelLoader.item.openFromHotkey()
  }

  function close() {
    if (panelLoader.item && panelLoader.item.close) panelLoader.item.close()
  }

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function togglePanel() {
    if (panelLoader.item && panelLoader.item.toggle) panelLoader.item.toggle()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSvcChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  readonly property url logoUrl: Qt.resolvedUrl("logo.svg")

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    slotSize: Style.bar.statusSlot
    tooltipText: root.tip
    iconComponent: Component {
      Image {
        anchors.fill: parent
        source: root.logoUrl
        fillMode: Image.PreserveAspectFit
        smooth: true
        mipmap: true
        opacity: root.markOpacity
      }
    }

    onPressed: function(b) {
      if (!root.bar) return
      if (b === Qt.RightButton) { if (root.svc) root.svc.openEngine() }
      else if (b === Qt.MiddleButton) { if (root.svc) root.svc.cycleEngine() }
      else root.togglePanel()
    }
  }

  readonly property string tip: {
    var revision = root.svc ? root.svc.revision : 0
    if (!root.svc) return "PanelAlpha"
    return ModelTip.barTip({
      "configured": root.svc.configured,
      "engineName": root.svc.engineName,
      "error": root.svc.error,
      "rows": root.svc.rows,
      "revision": revision
    })
  }

  readonly property string badge: {
    var revision = root.svc ? root.svc.revision : 0
    if (!root.svc || revision < 0) return ""
    var state = root.svc.glyphState()
    return state === "urgent" || state === "deploying" ? state : ""
  }

  Rectangle {
    visible: root.badge !== ""
    width: Style.space(7)
    height: width
    radius: width / 2
    color: root.badge === "urgent" ? "#E24B4B" : "#FF7A2F"
    anchors.right: parent.right
    anchors.top: parent.top
    anchors.rightMargin: Style.space(2)
    anchors.topMargin: Style.space(2)
  }

  readonly property real markOpacity: {
    var revision = root.svc ? root.svc.revision : 0
    if (!root.svc || revision < 0) return 1
    return root.svc.glyphState() === "dim" ? 0.4 : 1
  }
}
