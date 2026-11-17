pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Io
import qs.Common
import qs.DCommon.Widgets
import qs.Modals.DLauncherV2
import qs.Modals.DLauncherV2.Components
import qs.Modules.Plugins
import qs.Services

PluginComponent {
    id: root

    property var menu: null
    // Named like a bar pill's property so `dms ipc call widget status xdgMenu` works.
    property var popoutTarget: null
    property string _lastOutput: ""

    readonly property real sidebarWidth: 200
    readonly property real pillPadding: (barConfig?.widgetPadding ?? SettingsData.barWidgetPaddingDefault) * (widgetThickness / 30)

    // Same size as the app drawer, plus the folder column.
    popoutWidth: Math.min(560 + sidebarWidth, (parentScreen?.width ?? 1920) - Theme.spacingXL * 2)
    popoutHeight: Math.min(640, (parentScreen?.height ?? 1080) - Theme.spacingXL * 2)

    horizontalBarPill: Component {
        Item {
            implicitWidth: root.widgetThickness - root.pillPadding * 2
            implicitHeight: implicitWidth

            DIcon {
                anchors.centerIn: parent
                name: "apps"
                size: root.iconSize
                color: Theme.widgetIconColor
            }
        }
    }
    verticalBarPill: horizontalBarPill

    popoutContent: Component {
        FocusScope {
            id: panel

            property var parentPopout: null

            property string folderId: ""
            property int appIndex: 0
            property bool appsFocused: false

            readonly property string query: searchField.text.trim().toLowerCase()
            readonly property var folders: buildFolders(root.menu)
            readonly property int folderIndex: Math.max(0, folders.findIndex(f => f.id === folderId))
            readonly property var folder: folders[folderIndex] ?? null
            readonly property var allApps: {
                const seen = new Set();
                const apps = [];
                for (const f of folders) {
                    for (const item of f.items) {
                        if (item.type === "app" && !seen.has(item.id)) {
                            seen.add(item.id);
                            apps.push(item);
                        }
                    }
                }
                return apps;
            }
            readonly property var items: query ? search(query) : (folder?.items ?? [])
            readonly property bool appsActive: appsFocused || query.length > 0
            // The plugin popout pads its content; cancel that so the margins match the app drawer.
            readonly property real inset: Theme.spacingM - PopoutMetrics.contentPadding

            implicitHeight: root.popoutHeight - PopoutMetrics.contentPadding * 2

            onParentPopoutChanged: root.popoutTarget = parentPopout
            onItemsChanged: appIndex = 0
            onAppIndexChanged: appList.revealIndex(appIndex)
            onFolderIndexChanged: folderList.revealIndex(folderIndex)

            Connections {
                target: panel.parentPopout
                function onOpened() {
                    searchField.text = "";
                    panel.folderId = "";
                    panel.appsFocused = false;
                    root.refresh();
                    Qt.callLater(() => searchField.forceActiveFocus());
                }
            }

            // Flattens the menu tree into sidebar rows; folders left empty by DMS's hidden apps are dropped.
            function buildFolders(menu) {
                const out = [];
                const visit = (node, depth, withMenus) => {
                    const index = out.length;
                    const entry = {
                        id: node.id,
                        name: node.name,
                        icon: node.icon,
                        depth: depth,
                        items: []
                    };
                    out.push(entry);
                    for (const sub of withMenus ? node.menus : []) {
                        if (visit(sub, depth + 1, true))
                            entry.items.push(folderItem(sub));
                    }
                    for (const app of node.apps) {
                        if (!SessionData.isAppHidden(app.id))
                            entry.items.push(appItem(app));
                    }
                    if (entry.items.length === 0)
                        out.splice(index);
                    return entry.items.length > 0;
                };
                if (!menu)
                    return out;
                if (menu.apps.length > 0)
                    visit(menu, 0, false);
                for (const sub of menu.menus)
                    visit(sub, 0, true);
                return out;
            }

            function folderItem(node) {
                return {
                    type: "folder",
                    id: node.id,
                    name: node.name,
                    icon: node.icon || "folder",
                    iconType: node.icon ? "image" : "material",
                    badgeLabel: I18n.trFor("xdgMenu", "Folder")
                };
            }

            function appItem(app) {
                const override = SessionData.getAppOverride(app.id);
                const name = override?.name || app.name;
                return {
                    type: "app",
                    id: app.id,
                    name: name,
                    subtitle: override?.comment || app.comment,
                    icon: override?.icon || app.icon || "application-x-executable",
                    iconType: "image",
                    terms: [app.genericName, app.id].concat(app.keywords).join("\n").toLowerCase(),
                    key: name.toLowerCase()
                };
            }

            function search(text) {
                const score = app => app.key.startsWith(text) ? 3 : app.key.includes(text) ? 2 : app.terms.includes(text) ? 1 : 0;
                return allApps.filter(app => score(app) > 0).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name));
            }

            function showFolder(id) {
                searchField.text = "";
                folderId = id;
            }

            function activate(item) {
                if (!item)
                    return;
                if (item.type === "folder") {
                    showFolder(item.id);
                    return;
                }
                launcher.launchApp({
                    id: item.id
                });
                root.closePopout();
            }

            Controller {
                id: launcher
            }

            Keys.onPressed: event => {
                const key = event.key;
                if (key === Qt.Key_Escape) {
                    root.closePopout();
                } else if (key === Qt.Key_Return || key === Qt.Key_Enter) {
                    if (appsActive)
                        activate(items[appIndex]);
                    else
                        appsFocused = items.length > 0;
                } else if (key === Qt.Key_Down || key === Qt.Key_Up) {
                    const step = key === Qt.Key_Down ? 1 : -1;
                    if (appsActive)
                        appIndex = Math.max(0, Math.min(items.length - 1, appIndex + step));
                    else if (folders.length > 0)
                        folderId = folders[Math.max(0, Math.min(folders.length - 1, folderIndex + step))].id;
                } else if (key === Qt.Key_Tab || key === Qt.Key_Backtab) {
                    if (!query)
                        appsFocused = !appsFocused && items.length > 0;
                } else if (key === Qt.Key_Right && !appsActive) {
                    appsFocused = items.length > 0;
                } else if (key === Qt.Key_Left && appsFocused && !query) {
                    appsFocused = false;
                } else {
                    event.accepted = false;
                    return;
                }
                event.accepted = true;
            }

            LauncherSearchField {
                id: searchField
                x: panel.inset
                y: panel.inset
                width: parent.width - panel.inset * 2
                placeholderText: I18n.tr("Search", "search field placeholder") + "…"
                keyForwardTargets: [panel]
            }

            DListView {
                id: folderList
                anchors.left: parent.left
                anchors.top: searchField.bottom
                anchors.bottom: parent.bottom
                anchors.leftMargin: panel.inset
                anchors.topMargin: LauncherMetrics.resultsGap + LauncherMetrics.sectionBand
                anchors.bottomMargin: panel.inset
                width: root.sidebarWidth - panel.inset - Theme.spacingM
                clip: true
                highlightSelection: true
                currentIndex: panel.query ? -1 : panel.folderIndex
                spacing: LauncherMetrics.rowGap
                fadeLength: LauncherMetrics.fadeLength
                model: panel.folders

                delegate: DListItem {
                    id: folderRow
                    required property var modelData
                    required property int index

                    width: ListView.view.width
                    height: Theme.menuItemHeight
                    focusPolicy: Qt.NoFocus
                    isSelected: ListView.isCurrentItem
                    firstInGroup: index === 0
                    lastInGroup: index === ListView.view.count - 1
                    onClicked: {
                        panel.showFolder(modelData.id);
                        panel.appsFocused = false;
                    }

                    AppIconRenderer {
                        id: folderIcon
                        anchors.left: parent.left
                        anchors.leftMargin: Theme.spacingM + folderRow.modelData.depth * Theme.spacingL
                        anchors.verticalCenter: parent.verticalCenter
                        width: Theme.iconSize
                        height: Theme.iconSize
                        iconSize: Theme.iconSize
                        iconValue: folderRow.modelData.icon || "material:folder"
                        iconColor: folderRow.contentColor
                        materialIconSizeAdjustment: 0
                        fallbackText: folderRow.modelData.name.charAt(0).toUpperCase()
                    }

                    StyledText {
                        anchors.left: folderIcon.right
                        anchors.right: parent.right
                        anchors.leftMargin: Theme.spacingM
                        anchors.rightMargin: Theme.spacingM
                        anchors.verticalCenter: parent.verticalCenter
                        text: folderRow.modelData.name
                        font.pixelSize: Theme.fontSizeMedium
                        font.weight: Theme.fontWeightMedium
                        color: folderRow.contentColor
                        elide: Text.ElideRight
                    }
                }
            }

            SectionHeader {
                id: header
                anchors.left: folderList.right
                anchors.right: parent.right
                anchors.top: searchField.bottom
                anchors.leftMargin: Theme.spacingM
                anchors.rightMargin: panel.inset
                anchors.topMargin: LauncherMetrics.resultsGap
                canChangeViewMode: false
                canCollapse: false
                section: panel.query ? {
                    title: I18n.trFor("xdgMenu", "Search results"),
                    icon: "search"
                } : {
                    title: panel.folder?.name ?? "",
                    icon: panel.folder?.icon || "folder",
                    iconType: panel.folder?.icon ? "image" : "material"
                }
            }

            DListView {
                id: appList
                anchors.left: header.left
                anchors.right: header.right
                anchors.top: header.bottom
                anchors.bottom: parent.bottom
                anchors.topMargin: LauncherMetrics.resultsGap
                anchors.bottomMargin: panel.inset
                clip: true
                highlightSelection: true
                currentIndex: panel.appsActive ? panel.appIndex : -1
                spacing: LauncherMetrics.rowGap
                fadeLength: LauncherMetrics.fadeLength
                model: panel.items

                delegate: LauncherRow {
                    required property var modelData
                    required property int index

                    width: ListView.view.width
                    focusPolicy: Qt.NoFocus
                    item: modelData
                    isSelected: ListView.isCurrentItem
                    firstInGroup: index === 0
                    lastInGroup: index === ListView.view.count - 1
                    onClicked: panel.activate(modelData)
                }
            }

            Column {
                anchors.centerIn: appList
                spacing: Theme.spacingM
                visible: panel.items.length === 0

                DIcon {
                    anchors.horizontalCenter: parent.horizontalCenter
                    name: "search_off"
                    size: LauncherMetrics.gridIconSize
                    color: Theme.outlineButton
                }

                StyledText {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: I18n.tr("No apps found")
                    font.pixelSize: Theme.fontSizeMedium
                    color: Theme.onSurfaceVariant
                }
            }
        }
    }

    function refresh() {
        Proc.runCommand(null, ["python3", PluginService.getPluginPath("xdgMenu") + "/xdg-menu.py"], (output, exitCode) => {
            if (exitCode !== 0) {
                console.warn("xdgMenu: menu helper exited with code", exitCode);
                return;
            }
            if (output === _lastOutput)
                return;
            try {
                menu = JSON.parse(output);
                _lastOutput = output;
            } catch (e) {
                console.warn("xdgMenu: cannot parse menu helper output:", e);
            }
        }, 0, undefined, root);
    }

    Component.onCompleted: refresh()

    // Every bar instance has this handler; only the first registered one answers.
    IpcHandler {
        target: "xdgMenu"
        enabled: BarWidgetService.getWidget(root.pluginId) === root

        function toggle(): void {
            BarWidgetService.triggerWidgetPopout(root.pluginId);
        }

        function open(): void {
            const widget = BarWidgetService.getWidgetOnFocusedScreen(root.pluginId);
            if (widget && !widget.popoutTarget?.shouldBeVisible)
                BarWidgetService.triggerWidgetPopout(root.pluginId);
        }

        function close(): void {
            BarWidgetService.getWidgetOnFocusedScreen(root.pluginId)?.closePopout();
        }
    }
}
