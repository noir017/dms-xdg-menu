import QtQuick
import Quickshell.Io
import qs.Common
import qs.DCommon.Widgets
import qs.Modules.Plugins
import qs.Services

PluginComponent {
    id: root

    property var menu: null
    property var popout: null
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
        MenuPanel {
            widget: root
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
            if (widget && !widget.popout?.shouldBeVisible)
                BarWidgetService.triggerWidgetPopout(root.pluginId);
        }

        function close(): void {
            BarWidgetService.getWidgetOnFocusedScreen(root.pluginId)?.closePopout();
        }
    }
}
