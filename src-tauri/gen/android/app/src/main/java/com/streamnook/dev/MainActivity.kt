package com.streamnook.dev

import android.app.PictureInPictureParams
import android.content.Intent
import android.os.Bundle
import android.util.Rational
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  // Last known insets in CSS px, readable synchronously from JS via the
  // `SNInsets` bridge (covers boot and page reloads, when the pushed CSS vars
  // have not been applied to the fresh document yet).
  @Volatile private var insetsJson: String = "{}"

  // Whether a stream is playing, so onUserLeaveHint knows to enter system
  // picture-in-picture. Pushed from JS.
  @Volatile private var pipEligible: Boolean = false

  inner class InsetsBridge {
    @JavascriptInterface
    fun get(): String = insetsJson

    /** Hide/show the system bars (immersive playback, e.g. landscape watch). */
    @JavascriptInterface
    fun setImmersive(immersive: Boolean) {
      runOnUiThread {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.systemBarsBehavior =
          WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars())
        else controller.show(WindowInsetsCompat.Type.systemBars())
      }
    }

    /** Keep the screen awake while a stream plays. */
    @JavascriptInterface
    fun setKeepScreenOn(on: Boolean) {
      runOnUiThread { webView?.keepScreenOn = on }
    }

    /** Mark whether leaving the app should enter system picture-in-picture. */
    @JavascriptInterface
    fun setPipEligible(eligible: Boolean) {
      pipEligible = eligible
    }

    /** Hand text (a stream link) to the system share sheet. */
    @JavascriptInterface
    fun share(text: String, subject: String) {
      runOnUiThread {
        try {
          val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            if (subject.isNotEmpty()) putExtra(Intent.EXTRA_SUBJECT, subject)
          }
          startActivity(Intent.createChooser(send, null))
        } catch (_: Exception) {
          /* no share target available */
        }
      }
    }

    /** Enter TRUE system picture-in-picture on demand (drag-down, PiP button).
     *  The activity shrinks into the OS PiP window: draggable, resizable,
     *  floats over everything, tap to expand back. */
    @JavascriptInterface
    fun enterPip() {
      runOnUiThread {
        if (!isInPictureInPictureMode) {
          try {
            enterPictureInPictureMode(
              PictureInPictureParams.Builder()
                .setAspectRatio(Rational(16, 9))
                .build(),
            )
          } catch (_: Exception) {
            /* PiP unavailable on this device/config */
          }
        }
      }
    }
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

  // Home/recents while a stream plays: keep it playing in a system PiP window.
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (pipEligible && !isInPictureInPictureMode) {
      try {
        enterPictureInPictureMode(
          PictureInPictureParams.Builder()
            .setAspectRatio(Rational(16, 9))
            .build(),
        )
      } catch (_: Exception) {
        /* PiP unavailable on this device/config */
      }
    }
  }

  override fun onPictureInPictureModeChanged(
    isInPictureInPictureMode: Boolean,
    newConfig: android.content.res.Configuration,
  ) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    // Tell the web shell so it strips down to the bare player while pipped.
    val flag = if (isInPictureInPictureMode) "true" else "false"
    webView?.evaluateJavascript(
      "(function(){document.documentElement.dataset.snPip='" + flag +
        "';window.dispatchEvent(new CustomEvent('sn:pip',{detail:" + flag + "}));})()",
      null,
    )
  }

  /**
   * Foldable posture -> CSS variables.
   *
   * A Z Fold unfolds with the hinge running VERTICALLY down the middle, so the
   * centre of the viewport is the one place content must not sit. Publishing the
   * fold's position lets the shell align a two-pane split TO the seam and keep
   * centred overlays off it.
   *
   * WindowManager rather than CSS on purpose: the Viewport Segments API
   * (`env(viewport-segment-*)`, `@media (horizontal-viewport-segments: 2)`) is
   * still experimental and origin-trial gated, so it cannot be relied on in a
   * WebView.
   */
  private fun observeFoldPosture(webView: WebView) {
    val density = resources.displayMetrics.density
    lifecycleScope.launch {
      lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
        WindowInfoTracker.getOrCreate(this@MainActivity)
          .windowLayoutInfo(this@MainActivity)
          .collect { layoutInfo ->
            val fold = layoutInfo.displayFeatures
              .filterIsInstance<FoldingFeature>()
              .firstOrNull()
            val js = if (fold == null) {
              "(function(){var d=document.documentElement,s=d.style;" +
                "d.dataset.snFold='none';" +
                "s.removeProperty('--sn-fold-x');s.removeProperty('--sn-fold-w');" +
                "window.dispatchEvent(new CustomEvent('sn:fold',{detail:null}));})()"
            } else {
              val b = fold.bounds
              fun dp(v: Int): Int = (v / density).toInt()
              // VERTICAL orientation means the hinge line itself runs top to
              // bottom, i.e. it splits the screen left/right. That is the Z Fold
              // book posture and the case a two-pane split should align to.
              val vertical = fold.orientation == FoldingFeature.Orientation.VERTICAL
              val posture = if (fold.state == FoldingFeature.State.HALF_OPENED) "half" else "flat"
              val json = JSONObject()
                .put("vertical", vertical)
                .put("posture", posture)
                .put("x", dp(b.left))
                .put("width", dp(b.width()))
                .put("y", dp(b.top))
                .put("height", dp(b.height()))
                .toString()
              "(function(){var d=document.documentElement,s=d.style;" +
                "d.dataset.snFold='" + (if (vertical) "vertical" else "horizontal") + "';" +
                "d.dataset.snFoldPosture='" + posture + "';" +
                "s.setProperty('--sn-fold-x','${dp(b.left)}px');" +
                "s.setProperty('--sn-fold-w','${dp(b.width())}px');" +
                "window.dispatchEvent(new CustomEvent('sn:fold',{detail:" + json + "}));})()"
            }
            webView.post { webView.evaluateJavascript(js, null) }
          }
      }
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(InsetsBridge(), "SNInsets")
    observeFoldPosture(webView)

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
