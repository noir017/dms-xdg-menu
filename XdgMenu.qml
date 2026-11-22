pragma ComponentBehavior: Bound

import QtQuick
import QtCore as QtCore
import Qt.labs.folderlistmodel
import Quickshell
import Quickshell.Io
import qs.Common
import qs.DCommon.Widgets
import qs.Modals.DLauncherV2
import qs.Modals.DLauncherV2.Components
import qs.Modules.Plugins
import qs.Services
import qs.Widgets as Shell
import "favorites.js" as Favorites
import "menu.js" as XdgMenu
import "pinyin.js" as Pinyin

PluginComponent {
    id: root

    // The parsed menu; parsed again only when a menu file, a watched directory or DMS's app list changes.
    property var menu: null
    // Named like a bar pill's property so `dms ipc call widget status xdgMenu` works.
    property var popoutTarget: null
    property string _menuJson: ""
    property bool _pending: false
    // Directory listings and file watchers the parsed menu depends on, by path.
    property var _listings: ({})
    property var _watchers: ({})
    readonly property var _env: {
        const env = {};
        for (const name of ["HOME", "XDG_CONFIG_HOME", "XDG_CONFIG_DIRS", "XDG_DATA_HOME", "XDG_DATA_DIRS", "XDG_MENU_PREFIX", "XDG_CURRENT_DESKTOP", "LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"])
            env[name] = Quickshell.env(name) ?? "";
        return env;
    }
    // Desktop ids, in the user's order; kept in the plugin's own settings.
    readonly property var favorites: pluginData.favorites ?? []
    // Desktops whose OnlyShowIn apps are shown too, from the settings page: "KDE;GNOME".
    readonly property var extraDesktops: String(pluginData.extraDesktops ?? "").split(/[;,:\s]+/).filter(name => name)
    readonly property bool showPowerMenu: pluginData.showPowerMenu !== false
    readonly property bool showRecentApps: pluginData.showRecentApps !== false
    readonly property string viewMode: pluginData.viewMode === "grid" ? "grid" : "list"
    readonly property bool canPowerOffMonitors: CompositorService.isNiri
        || CompositorService.isHyprland
        || CompositorService.isMango
        || CompositorService.isSway
        || CompositorService.isScroll
        || CompositorService.isMiracle
        || CompositorService.isLabwc
        || CompositorService.isUmbriel
        || CompositorService.outputPowerAvailable
    // DMS's own apps (Settings, Notepad, ...) have no desktop file; they get ids of their own.
    readonly property string builtInPrefix: "dms:"

    onExtraDesktopsChanged: rebuildTimer.restart()

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

            readonly property string favoritesId: "#favorites"
            readonly property string recentId: "#recent"
            readonly property bool isGrid: root.viewMode === "grid"
            readonly property string query: searchField.text.trim().toLowerCase()
            readonly property var menuFolders: buildFolders(root.menu)
            readonly property var usageRanking: AppUsageHistoryData.appUsageRanking ?? ({})
            readonly property var allApps: {
                const seen = new Set();
                const apps = [];
                for (const f of menuFolders) {
                    for (const item of f.items) {
                        if (item.type === "app" && !seen.has(item.id)) {
                            seen.add(item.id);
                            apps.push(item);
                        }
                    }
                }
                return apps;
            }
            readonly property var favoriteApps: Favorites.resolve(root.favorites, allApps)
            readonly property var recentApps: {
                const ranking = usageRanking;
                const list = [];
                for (const app of allApps) {
                    const info = ranking[app.id];
                    if (info && (info.lastUsed ?? 0) > 0)
                        list.push({
                            app: app,
                            lastUsed: info.lastUsed,
                            usageCount: info.usageCount ?? 0
                        });
                }
                list.sort((a, b) => (b.lastUsed - a.lastUsed) || (b.usageCount - a.usageCount) || a.app.name.localeCompare(b.app.name));
                return list.slice(0, 16).map(entry => entry.app);
            }
            readonly property var pinnedFolders: {
                const out = [
                    {
                        id: favoritesId,
                        name: I18n.trFor("xdgMenu", "Favorites"),
                        icon: "star",
                        iconType: "material",
                        depth: 0,
                        items: favoriteApps
                    }
                ];
                if (root.showRecentApps && recentApps.length > 0)
                    out.push({
                        id: recentId,
                        name: I18n.trFor("xdgMenu", "Recent"),
                        icon: "history",
                        iconType: "material",
                        depth: 0,
                        items: recentApps
                    });
                return out;
            }
            readonly property var folders: pinnedFolders.concat(menuFolders)
            readonly property int folderIndex: Math.max(0, folders.findIndex(f => f.id === folderId))
            readonly property var folder: folders[folderIndex] ?? null
            readonly property bool inFavorites: !query && folder?.id === favoritesId
            readonly property var items: query ? search(query) : (folder?.items ?? [])
            readonly property bool appsActive: appsFocused || query.length > 0
            // The plugin popout pads its content; cancel that so the margins match the app drawer.
            readonly property real inset: Theme.spacingM - PopoutMetrics.contentPadding

            implicitHeight: root.popoutHeight - PopoutMetrics.contentPadding * 2

            onParentPopoutChanged: root.popoutTarget = parentPopout
            onItemsChanged: {
                appIndex = Math.max(0, Math.min(appIndex, items.length - 1));
                if (isGrid)
                    appGrid.contentY = 0;
                else if (!inFavorites)
                    Qt.callLater(() => appList.resetScroll());
            }
            onQueryChanged: resetView()
            onFolderIdChanged: resetView()
            onAppIndexChanged: {
                if (isGrid)
                    appGrid.positionViewAtIndex(appIndex, GridView.Contain);
                else if (inFavorites)
                    revealFavorite(appIndex);
                else
                    appList.revealIndex(appIndex);
            }
            onFolderIndexChanged: folderList.revealIndex(folderIndex)

            Connections {
                target: panel.parentPopout
                function onOpened() {
                    searchField.text = "";
                    panel.folderId = panel.favoriteApps.length > 0 ? panel.favoritesId : (panel.menuFolders[0]?.id ?? panel.favoritesId);
                    panel.appIndex = 0;
                    panel.appsFocused = false;
                    folderList.resetScroll();
                    appList.resetScroll();
                    favoritesView.contentY = 0;
                    appGrid.contentY = 0;
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
                        icon: node.icon || "folder",
                        iconType: node.icon ? "image" : "material",
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
                const icon = override?.icon || app.icon || "application-x-executable";
                const py = Pinyin.toPinyin(name);
                return {
                    type: "app",
                    id: app.id,
                    name: name,
                    subtitle: override?.comment || app.comment,
                    icon: icon,
                    // DMS draws its own apps as its logo with a symbol in the corner.
                    iconType: icon.startsWith("svg+corner:") ? "composite" : "image",
                    iconFull: icon,
                    terms: [app.genericName, app.id].concat(app.keywords).join("\n").toLowerCase(),
                    key: name.toLowerCase(),
                    pinyinFull: py.full,
                    pinyinInitials: py.initials
                };
            }

            function search(text) {
                const ranking = usageRanking;
                const scored = [];
                for (const app of allApps) {
                    const s = Pinyin.matchScore(text, app);
                    if (s > 0)
                        scored.push({
                            app: app,
                            score: s,
                            usage: ranking[app.id]?.usageCount ?? 0
                        });
                }
                scored.sort((a, b) => (b.score - a.score) || (b.usage - a.usage) || a.app.name.localeCompare(b.app.name));
                return scored.map(entry => entry.app);
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
                const builtIn = root.builtInApp(item.id);
                if (builtIn) {
                    // Close first: these open DMS's own windows and modals, which take the focus.
                    root.closePopout();
                    AppSearchService.executeCoreApp(builtIn);
                    return;
                }
                launcher.launchApp({
                    id: item.id
                });
                root.closePopout();
            }

            function resetView() {
                appIndex = 0;
                favoritesView.contentY = 0;
                appGrid.contentY = 0;
            }

            function revealFavorite(index) {
                const row = favoritesList.itemAt(index);
                if (!row)
                    return;
                const top = Math.min(favoritesView.contentY, row.y);
                favoritesView.contentY = Math.max(top, row.y + row.height - favoritesView.height);
            }

            function showMenu(item, sceneX, sceneY) {
                const popout = parentPopout;
                const body = popout?.contentLoader?.item;
                if (item?.type !== "app" || !body)
                    return;
                const pos = body.mapFromItem(null, sceneX, sceneY);
                appMenu.app = item;
                appMenu.open(popout.screen, popout.renderedAlignedX + pos.x + Theme.spacingXS, popout.renderedAlignedY + pos.y + Theme.spacingXS, false);
            }

            function togglePowerMenu() {
                if (powerMenu.renderActive) {
                    powerMenu.hide();
                    return;
                }
                const popout = parentPopout;
                const body = popout?.contentLoader?.item;
                if (!body)
                    return;
                powerMenu.pendingAction = "";
                powerMenu.targetScreen = popout.screen;
                const pos = body.mapFromItem(powerButton, powerButton.width, powerButton.height + Theme.spacingXS);
                powerMenu.open(popout.screen, popout.renderedAlignedX + pos.x - powerMenu.effectiveMenuWidth, popout.renderedAlignedY + pos.y, false);
            }

            function triggerPowerAction(action) {
                if (action === "screenOff") {
                    root.closePopout();
                    screenOffTimer.restart();
                    return;
                }
                if (action === "lock") {
                    root.closePopout();
                    IdleService.lockRequested();
                    return;
                }
                if (action === "suspend") {
                    root.closePopout();
                    SessionService.executePowerAction("suspend");
                    return;
                }
                if (SettingsData.powerActionConfirm && powerMenu.pendingAction !== action) {
                    powerMenu.pendingAction = action;
                    powerConfirmTimer.restart();
                    return;
                }
                powerMenu.pendingAction = "";
                powerConfirmTimer.stop();
                root.closePopout();
                SessionService.executePowerAction(action);
            }

            Controller {
                id: launcher
            }

            Shell.DContextMenu {
                id: appMenu

                property var app: null
                readonly property bool isFavorite: Favorites.contains(root.favorites, app?.id)
                readonly property var desktopEntry: root.desktopEntryFor(app?.id)

                layerNamespace: "dms:plugins:xdgMenu:context-menu"
                keyboardNavigable: true
                transientSurfaceTracker: panel.parentPopout?.transientSurfaceTracker ?? null
                menuItems: {
                    const items = [];
                    if (!app)
                        return items;
                    items.push({
                        type: "item",
                        icon: isFavorite ? "remove" : "star",
                        text: isFavorite ? I18n.trFor("xdgMenu", "Remove from Favorites") : I18n.trFor("xdgMenu", "Add to Favorites"),
                        action: () => root.saveFavorites(Favorites.toggle(root.favorites, appMenu.app.id))
                    });
                    const entry = desktopEntry;
                    if (!entry)
                        return items;
                    if (entry.actions && entry.actions.length > 0) {
                        items.push({
                            type: "separator"
                        });
                        for (let i = 0; i < entry.actions.length; i++) {
                            const act = entry.actions[i];
                            items.push({
                                type: "item",
                                icon: act.icon || "play_arrow",
                                text: act.name || "",
                                action: () => {
                                    root.closePopout();
                                    SessionService.launchDesktopAction(entry, act);
                                    AppUsageHistoryData.addAppUsage(entry);
                                }
                            });
                        }
                    }
                    items.push({
                        type: "separator"
                    });
                    if (SessionService.nvidiaCommand) {
                        items.push({
                            type: "item",
                            icon: "memory",
                            text: I18n.tr("Launch on dGPU"),
                            action: () => {
                                root.closePopout();
                                SessionService.launchDesktopEntry(entry, true);
                                AppUsageHistoryData.addAppUsage(entry);
                            }
                        });
                    }
                    items.push({
                        type: "item",
                        icon: "visibility_off",
                        text: I18n.tr("Hide App"),
                        action: () => SessionData.hideApp(entry.id)
                    });
                    return items;
                }
                onRenderActiveChanged: {
                    if (!renderActive)
                        Qt.callLater(() => searchField.forceActiveFocus());
                }
            }

            Timer {
                id: powerConfirmTimer
                interval: 4000
                onTriggered: powerMenu.pendingAction = ""
            }

            Shell.DContextMenu {
                id: powerMenu

                property string pendingAction: ""

                function confirmLabel(action) {
                    switch (action) {
                    case "logout":
                        return I18n.trFor("xdgMenu", "Confirm log out?");
                    case "reboot":
                        return I18n.trFor("xdgMenu", "Confirm reboot?");
                    case "poweroff":
                        return I18n.trFor("xdgMenu", "Confirm power off?");
                    default:
                        return "";
                    }
                }

                function powerItem(action, destructive) {
                    const data = SessionService.getPowerActionData(action);
                    const needsConfirm = destructive && SettingsData.powerActionConfirm;
                    const confirming = needsConfirm && pendingAction === action;
                    return {
                        type: "item",
                        icon: data.icon,
                        text: confirming ? confirmLabel(action) : data.label,
                        isDestructive: confirming || action === "poweroff",
                        keepOpen: needsConfirm && !confirming,
                        action: () => panel.triggerPowerAction(action)
                    };
                }

                layerNamespace: "dms:plugins:xdgMenu:power-menu"
                keyboardNavigable: true
                transientSurfaceTracker: panel.parentPopout?.transientSurfaceTracker ?? null
                menuItems: [
                    {
                        type: "item",
                        icon: "desktop_access_disabled",
                        text: I18n.trFor("xdgMenu", "Turn off screen"),
                        hidden: !root.canPowerOffMonitors,
                        action: () => panel.triggerPowerAction("screenOff")
                    },
                    powerItem("lock", false),
                    powerItem("suspend", false),
                    {
                        type: "separator"
                    },
                    powerItem("logout", true),
                    powerItem("reboot", true),
                    powerItem("poweroff", true)
                ]
                onRenderActiveChanged: {
                    if (!renderActive) {
                        pendingAction = "";
                        powerConfirmTimer.stop();
                        Qt.callLater(() => searchField.forceActiveFocus());
                    }
                }
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
                    const dir = key === Qt.Key_Down ? 1 : -1;
                    if (appsActive) {
                        const step = isGrid ? dir * appGrid.columns : dir;
                        appIndex = Math.max(0, Math.min(items.length - 1, appIndex + step));
                    } else if (folders.length > 0) {
                        folderId = folders[Math.max(0, Math.min(folders.length - 1, folderIndex + dir))].id;
                    }
                } else if (key === Qt.Key_Tab || key === Qt.Key_Backtab) {
                    if (!query)
                        appsFocused = !appsFocused && items.length > 0;
                } else if (key === Qt.Key_Right) {
                    if (!appsActive)
                        appsFocused = items.length > 0;
                    else if (isGrid && appIndex < items.length - 1)
                        appIndex += 1;
                    else {
                        event.accepted = false;
                        return;
                    }
                } else if (key === Qt.Key_Left && appsActive) {
                    if (isGrid && appIndex % appGrid.columns > 0)
                        appIndex -= 1;
                    else if (!query)
                        appsFocused = false;
                    else {
                        event.accepted = false;
                        return;
                    }
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
                width: parent.width - panel.inset * 2 - (root.showPowerMenu ? powerButton.width + Theme.spacingS : 0)
                placeholderText: I18n.tr("Search", "search field placeholder") + "…"
                keyForwardTargets: [panel]
            }

            DIconButton {
                id: powerButton
                visible: root.showPowerMenu
                anchors.right: parent.right
                anchors.rightMargin: panel.inset
                anchors.verticalCenter: searchField.verticalCenter
                variant: "outlined"
                round: false
                buttonSize: searchField.height
                width: searchField.height
                radius: searchField.cornerRadius
                iconName: "power_settings_new"
                iconSize: Theme.iconSize
                tooltipText: I18n.trFor("xdgMenu", "Power")
                checkable: true
                checked: powerMenu.renderActive
                focusPolicy: Qt.NoFocus
                onClicked: panel.togglePowerMenu()
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
                // Switch the highlight off rather than using index -1: a new model resets currentIndex to 0.
                highlightSelection: !panel.query
                currentIndex: panel.folderIndex
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
                    isSelected: ListView.isCurrentItem && !panel.query
                    // Favorites form a group of their own above the menu folders.
                    firstInGroup: index === 0 || index === panel.pinnedFolders.length
                    lastInGroup: index === panel.pinnedFolders.length - 1 || index === ListView.view.count - 1
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
                        iconValue: folderRow.modelData.iconType === "material" ? "material:" + folderRow.modelData.icon : folderRow.modelData.icon
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
                anchors.rightMargin: panel.inset + viewModeButton.width + Theme.spacingXS
                anchors.topMargin: LauncherMetrics.resultsGap
                canChangeViewMode: false
                canCollapse: false
                section: panel.query ? {
                    title: I18n.trFor("xdgMenu", "Search results"),
                    icon: "search"
                } : {
                    title: panel.folder?.name ?? "",
                    icon: panel.folder?.icon ?? "folder",
                    iconType: panel.folder?.iconType ?? "material"
                }
            }

            DActionButton {
                id: viewModeButton
                anchors.right: parent.right
                anchors.rightMargin: panel.inset
                anchors.verticalCenter: header.verticalCenter
                focusPolicy: Qt.NoFocus
                iconName: panel.isGrid ? "view_list" : "grid_view"
                tooltipText: panel.isGrid ? I18n.tr("List", "noun, list view mode option") : I18n.tr("Grid", "noun, grid view mode and layout option")
                buttonSize: LauncherMetrics.headerButtonSize
                iconSize: Theme.iconSizeSmall
                onClicked: root.saveViewMode(panel.isGrid ? "list" : "grid")
            }

            DListView {
                id: appList
                anchors.left: header.left
                anchors.right: parent.right
                anchors.top: header.bottom
                anchors.bottom: parent.bottom
                anchors.topMargin: LauncherMetrics.resultsGap
                anchors.rightMargin: panel.inset
                anchors.bottomMargin: panel.inset
                visible: !panel.isGrid && !panel.inFavorites
                clip: true
                highlightSelection: panel.appsActive
                currentIndex: panel.appIndex
                spacing: LauncherMetrics.rowGap
                fadeLength: LauncherMetrics.fadeLength
                model: panel.items

                delegate: LauncherRow {
                    required property var modelData
                    required property int index

                    width: ListView.view.width
                    focusPolicy: Qt.NoFocus
                    item: modelData
                    isSelected: ListView.isCurrentItem && panel.appsActive
                    firstInGroup: index === 0
                    lastInGroup: index === ListView.view.count - 1
                    onClicked: panel.activate(modelData)
                    onRightClicked: (x, y) => panel.showMenu(modelData, x, y)
                }
            }

            // Favorites can be dragged into a new order; dropping a row saves it.
            DFlickable {
                id: favoritesView
                anchors.fill: appList
                visible: !panel.isGrid && panel.inFavorites
                clip: true
                contentHeight: favoritesList.height

                DReorderList {
                    id: favoritesList
                    width: favoritesView.width
                    flickable: favoritesView
                    spacing: LauncherMetrics.rowGap
                    model: panel.inFavorites ? panel.items : []
                    onReordered: order => root.saveFavorites(Favorites.reorder(root.favorites, panel.items.map(app => app.id), order))

                    delegate: LauncherRow {
                        id: favoriteRow
                        required property var modelData
                        required property int index
                        readonly property bool dragging: favoritesList.draggingIndex === index
                        readonly property int slot: favoritesList.order.indexOf(index)

                        z: dragging ? 1 : 0
                        focusPolicy: Qt.NoFocus
                        item: modelData
                        isSelected: dragging || (panel.appsActive && index === panel.appIndex)
                        firstInGroup: dragging || slot === 0
                        lastInGroup: dragging || slot === favoritesList.count - 1
                        onClicked: panel.activate(modelData)
                        onRightClicked: (x, y) => panel.showMenu(modelData, x, y)

                        Behavior on y {
                            enabled: favoritesList.animateLayout && !favoriteRow.dragging && !SettingsData.reduceMotion
                            NumberAnimation {
                                duration: Theme.shortDuration
                                easing.type: Theme.standardEasing
                            }
                        }

                        DragHandler {
                            target: null
                            xAxis.enabled: false
                            enabled: favoritesList.count > 1
                            cursorShape: Qt.ClosedHandCursor
                            onGrabChanged: (transition, point) => {
                                switch (transition) {
                                case PointerDevice.GrabExclusive:
                                    favoritesList.begin(favoriteRow.index, favoritesList.mapFromItem(null, point.scenePressPosition.x, point.scenePressPosition.y));
                                    favoritesList.dragTo(favoritesList.mapFromItem(null, point.scenePosition.x, point.scenePosition.y));
                                    break;
                                case PointerDevice.UngrabExclusive:
                                    if (favoriteRow.dragging)
                                        favoritesList.finish();
                                    break;
                                case PointerDevice.CancelGrabExclusive:
                                    favoritesList.cancel();
                                    break;
                                }
                            }
                            onCentroidChanged: {
                                if (active && favoriteRow.dragging)
                                    favoritesList.dragTo(favoritesList.mapFromItem(null, centroid.scenePosition.x, centroid.scenePosition.y));
                            }
                        }
                    }
                }
            }

            GridView {
                id: appGrid
                readonly property int columns: Math.max(3, Math.floor(width / 120))

                anchors.fill: appList
                visible: panel.isGrid
                clip: true
                cellWidth: Math.floor(width / columns)
                cellHeight: Math.max(104, LauncherMetrics.gridIconSize + Theme.fontSizeSmall * 2 + Theme.spacingM * 2)
                currentIndex: panel.appIndex
                model: panel.isGrid ? panel.items : []
                boundsBehavior: Flickable.StopAtBounds

                delegate: LauncherTile {
                    required property var modelData
                    required property int index

                    width: appGrid.cellWidth
                    height: appGrid.cellHeight
                    item: modelData
                    isSelected: GridView.isCurrentItem && panel.appsActive
                    onClicked: panel.activate(modelData)
                    onRightClicked: (x, y) => panel.showMenu(modelData, x, y)
                }
            }

            Column {
                anchors.centerIn: appList
                spacing: Theme.spacingM
                visible: panel.items.length === 0

                DIcon {
                    anchors.horizontalCenter: parent.horizontalCenter
                    name: panel.inFavorites ? "star" : "search_off"
                    size: LauncherMetrics.gridIconSize
                    color: Theme.outlineButton
                }

                StyledText {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: panel.inFavorites ? I18n.trFor("xdgMenu", "Right-click an app to add it to Favorites") : I18n.tr("No apps found")
                    font.pixelSize: Theme.fontSizeMedium
                    color: Theme.onSurfaceVariant
                }
            }
        }
    }

    function rebuildMenu() {
        let result;
        try {
            result = XdgMenu.build({
                env: _env,
                apps: Array.prototype.slice.call(AppSearchService.applications).concat(builtInApps()),
                extraDesktops: extraDesktops,
                fallbackDataDirs: [PluginService.getPluginPath("xdgMenu") + "/data"],
                read: readFile,
                list: listDir,
                executable: name => QtCore.StandardPaths.findExecutable(name).toString() !== "",
                compare: (a, b) => a.localeCompare(b)
            });
        } catch (e) {
            console.warn("xdgMenu: cannot read the menu:", e);
            return;
        }
        _watchers = keepObjects(_watchers, result.files, path => watcherComponent.createObject(root, {
                path: path
            }));
        _listings = keepObjects(_listings, result.dirs, null);
        // A listing is still loading; its model triggers the next rebuild.
        _pending = result.pending;
        if (_pending)
            return;
        for (const warning of result.warnings)
            console.warn("xdgMenu:", warning);
        if (result.error) {
            console.warn("xdgMenu:", result.error);
            return;
        }
        const json = JSON.stringify(result.menu);
        if (json !== _menuJson) {
            _menuJson = json;
            menu = result.menu;
        }
    }

    // The same list DMS's launcher shows; the ones switched off in its settings are not in it.
    function builtInApps() {
        return AppSearchService.coreApps.map(app => ({
                    id: builtInPrefix + app.builtInPluginId,
                    name: app.name,
                    genericName: "",
                    comment: app.comment,
                    icon: app.icon || "",
                    keywords: [],
                    categories: app.categories ?? [],
                    builtIn: true
                }));
    }

    function builtInApp(id) {
        if (!id.startsWith(builtInPrefix))
            return null;
        return AppSearchService.coreApps.find(app => builtInPrefix + app.builtInPluginId === id) ?? null;
    }

    function desktopEntryFor(id) {
        if (!id || id.startsWith(builtInPrefix))
            return null;
        return AppSearchService.applications.find(app => app.id === id) ?? null;
    }

    function readFile(path) {
        reader.failure = 0;
        reader.path = path;
        reader.reload();
        const text = reader.text();
        return reader.failure === 0 ? text : null;
    }

    // undefined while the listing loads. A FolderListModel whose folder is missing lists the working
    // directory instead, so check that the directory exists first.
    function listDir(dir) {
        readFile(dir);
        if (reader.failure !== FileViewError.NotAFile)
            return null;
        let model = _listings[dir];
        if (!model) {
            model = listingComponent.createObject(root, {
                folder: "file://" + dir.split("/").map(encodeURIComponent).join("/")
            });
            _listings[dir] = model;
        }
        if (model.status !== FolderListModel.Ready)
            return undefined;
        const entries = [];
        for (let i = 0; i < model.count; i++) {
            if (model.get(i, "filePath").startsWith(dir + "/"))
                entries.push({
                    name: model.get(i, "fileName"),
                    dir: model.get(i, "fileIsDir")
                });
        }
        return entries;
    }

    // Keeps the objects for `paths`, creating missing ones with `create`, and destroys the rest.
    function keepObjects(objects, paths, create) {
        const kept = {};
        for (const path of paths) {
            const object = objects[path] ?? (create ? create(path) : null);
            if (object)
                kept[path] = object;
        }
        for (const path in objects) {
            if (!kept[path])
                objects[path].destroy();
        }
        return kept;
    }

    Component.onCompleted: rebuildMenu()

    Connections {
        target: AppSearchService
        function onApplicationsChanged() {
            rebuildTimer.restart();
        }
        function onCoreAppsChanged() {
            rebuildTimer.restart();
        }
    }

    function listingChanged() {
        if (_pending)
            Qt.callLater(rebuildMenu);
        else
            rebuildTimer.restart();
    }

    // Changes come in bursts, e.g. a package installing many files; parse once they settle.
    Timer {
        id: rebuildTimer
        interval: 100
        onTriggered: root.rebuildMenu()
    }

    // Delay monitor power-off slightly so releasing the mouse button or closing the popout does not wake the display.
    Timer {
        id: screenOffTimer
        interval: 400
        onTriggered: CompositorService.powerOffMonitors()
    }

    FileView {
        id: reader
        property int failure: 0
        preload: false
        blockAllReads: true
        printErrors: false
        onLoadFailed: error => failure = error
    }

    Component {
        id: listingComponent
        FolderListModel {
            onStatusChanged: root.listingChanged()
            onCountChanged: root.listingChanged()
            onDataChanged: root.listingChanged()
        }
    }

    Component {
        id: watcherComponent
        FileView {
            preload: false
            printErrors: false
            watchChanges: true
            onFileChanged: rebuildTimer.restart()
        }
    }

    function saveFavorites(ids) {
        (pluginService ?? PluginService).savePluginData("xdgMenu", "favorites", ids);
    }

    function saveViewMode(mode) {
        (pluginService ?? PluginService).savePluginData("xdgMenu", "viewMode", mode);
    }

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
