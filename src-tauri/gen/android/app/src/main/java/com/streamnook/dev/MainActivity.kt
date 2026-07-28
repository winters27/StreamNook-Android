package com.streamnook.dev

import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  // Last known insets in CSS px, readable synchronously from JS via the
  // `SNInsets` bridge (covers boot and page reloads, when the pushed CSS vars
  // have not been applied to the fresh document yet).
  @Volatile private var insetsJson: String = "{}"

  inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = insetsJson
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Android back: ask the web shell first (sheets, drill stacks, the watch
    // layer). Unconsumed presses background the task instead of killing the
    // session. TauriActivity sets handleBackNavigation=false, so without this
    // callback a back press would finish the activity.
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val wv = webView
        if (wv == null) {
          moveTaskToBack(true)
          return
        }
        wv.evaluateJavascript("window.__SN_BACK__ ? window.__SN_BACK__() : false") { result ->
          if (result != "true") moveTaskToBack(true)
        }
      }
    })
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(InsetsBridge(), "SNInsets")

    // Native inset bridge: Android WebView's env(safe-area-inset-*) is
    // unreliable under edge-to-edge (0 for the top without a display cutout,
    // 0 for the bottom with button navigation), so real WindowInsets are
    // pushed into CSS variables the mobile shell reads. IME height rides the
    // same channel for the chat input.
    val density = resources.displayMetrics.density
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      fun px(v: Int): Int = (v / density).toInt()
      val kb = maxOf(0, px(ime.bottom) - px(bars.bottom))
      insetsJson = JSONObject()
        .put("top", px(bars.top))
        .put("right", px(bars.right))
        .put("bottom", px(bars.bottom))
        .put("left", px(bars.left))
        .put("kb", kb)
        .toString()
      val js = "(function(){var d=document.documentElement,s=d.style;" +
        "s.setProperty('--sn-inset-t','${px(bars.top)}px');" +
        "s.setProperty('--sn-inset-r','${px(bars.right)}px');" +
        "s.setProperty('--sn-inset-b','${px(bars.bottom)}px');" +
        "s.setProperty('--sn-kb','${kb}px');" +
        "s.setProperty('--sn-inset-l','${px(bars.left)}px');" +
        "d.dataset.snNativeInsets='true';})()"
      view.post { (view as WebView).evaluateJavascript(js, null) }
      insets
    }
    ViewCompat.requestApplyInsets(webView)
  }
}
