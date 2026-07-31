# StreamNook keep rules (picked up by the release fileTree("**/*.pro") glob).

# The MainActivity insets bridge is called reflectively from JS via
# addJavascriptInterface; R8 must not strip or rename it.
-keepclassmembers class app.streamnook.MainActivity$InsetsBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Tauri mobile plugins are instantiated reflectively by PluginManager.
-keep class app.streamnook.TwitchLoginPlugin { *; }
