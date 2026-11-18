import QtQuick
import qs.Common
import qs.Modules.Plugins

PluginSettings {
    pluginId: "xdgMenu"

    StringSetting {
        settingKey: "extraDesktops"
        label: I18n.trFor("xdgMenu", "Also show apps for these desktops")
        description: I18n.trFor("xdgMenu", "Apps made only for another desktop are hidden unless it is listed here. Separate names with semicolons.")
        placeholder: "KDE;GNOME"
        defaultValue: ""
    }
}
