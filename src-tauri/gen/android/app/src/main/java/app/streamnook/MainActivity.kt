package app.streamnook

import android.Manifest
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Rational
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
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

  // Whether a stream is playing, so leaving the app enters system
  // picture-in-picture. Pushed from JS.
  @Volatile private var pipEligible: Boolean = false

  // Mirrors the <video> mute state, so the PiP window's action shows the right
  // icon and label. Pushed from JS on every mute change, from either control.
  @Volatile private var pipMuted: Boolean = false

  // The video's rect in window coordinates. Without it the OS crops and scales
  // the WHOLE activity into the PiP window, so the frames before the web layer
  // repaints show whatever full-screen panel happened to be open.
  @Volatile private var pipSourceRect: Rect? = null

  // Set when the PiP window was DISMISSED rather than expanded. Read and cleared
  // by the web shell on its way back to the foreground.
  @Volatile private var pipClosedPending: Boolean = false

  // Channel login from a tapped notification, waiting for the web shell to pick
  // it up. Needed for the cold case: the tap starts the activity, and there is
  // no WebView to hand it to for some time afterwards.
  @Volatile private var pendingChannel: String? = null

  // Fired by the PiP window's mute action. Private to the app; the receiver is
  // registered in code and explicitly NOT exported.
  private val muteReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('sn:pip-mute'))",
        null,
      )
    }
  }

  /**
   * Tell the web shell that the in-app login overlay was closed by the user.
   *
   * Without this, closing it leaves whatever was waiting on a token polling
   * against a screen that is no longer on top, with no way back: the sign-in
   * button stays busy forever and the setup wizard stays stuck mid-step.
   *
   * Rides the same `sn:` custom-event channel as the PiP signals. The plugin's
   * own `trigger` goes to Tauri's plugin event channel, which needs an ACL
   * grant an app-local plugin does not get, and working around that is the
   * reason its commands are forwarded through Rust in the first place.
   */
  fun notifyLoginCancelled() {
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('sn:login-cancelled'))",
        null,
      )
    }
  }

  /**
   * Hands the shell a value read out of the login WebView's own storage.
   *
   * 7TV's sign-in finishes by writing a token into its page's localStorage
   * rather than by redirecting somewhere readable, so the value comes through
   * here instead of being pulled off a URL. Carried as JSON so the token cannot
   * break out of the string it is being embedded in.
   */
  fun notifyLoginStorage(key: String, value: String) {
    val detail = org.json.JSONObject().put("key", key).put("value", value)
    webView?.post {
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('sn:login-storage',{detail:$detail}))",
        null,
      )
    }
  }

  /** The single source of PictureInPictureParams, used by every entry point and
   *  by every in-place update. */
  private fun buildPipParams(): PictureInPictureParams {
    val b = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
    pipSourceRect?.let { b.setSourceRectHint(it) }

    // Web content cannot draw usable controls inside a PiP window: taps there go
    // to the OS chrome. Close and expand are OS-provided; mute has to be ours.
    val iconRes = if (pipMuted) R.drawable.ic_pip_unmute else R.drawable.ic_pip_mute
    val label = if (pipMuted) "Unmute" else "Mute"
    val pending = PendingIntent.getBroadcast(
      this,
      0,
      Intent(ACTION_PIP_MUTE).setPackage(packageName),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    b.setActions(
      listOf(RemoteAction(Icon.createWithResource(this, iconRes), label, label, pending)),
    )

    // Android 12+ enters PiP itself on the way out, which is the only reliable
    // path for a gesture-nav home swipe: onUserLeaveHint is not guaranteed to be
    // delivered there. onUserLeaveHint below stays as the pre-31 fallback.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      b.setAutoEnterEnabled(pipEligible)
    }
    return b.build()
  }

  /** Push the current params without entering PiP. No-ops harmlessly if the
   *  activity is in a state that will not accept them. */
  private fun refreshPipParams() {
    runOnUiThread {
      try {
        setPictureInPictureParams(buildPipParams())
      } catch (_: Exception) {
        /* PiP unavailable on this device/config */
      }
    }
  }

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

    /** Mark whether leaving the app should enter system picture-in-picture.
     *  Pushes params too, since that is what carries autoEnterEnabled. */
    @JavascriptInterface
    fun setPipEligible(eligible: Boolean) {
      pipEligible = eligible
      refreshPipParams()
    }

    /**
     * Whether we are in the PiP window, readable SYNCHRONOUSLY.
     *
     * The `sn:pip` event and the `dataset.snPip` mirror both ride an async
     * evaluateJavascript, which races the WebView's own visibilitychange. The
     * lifecycle handler has to tell real backgrounding from PiP and must not
     * depend on winning that race, so it reads the activity directly.
     */
    @JavascriptInterface
    fun isInPip(): Boolean = isInPictureInPictureMode

    /** True once if the PiP window was closed rather than expanded. Reading it
     *  clears it, so the stream is only torn down for the dismissal it belongs
     *  to and not again on every later resume. */
    @JavascriptInterface
    fun consumePipClosed(): Boolean {
      val was = pipClosedPending
      pipClosedPending = false
      return was
    }

    /** The video's rect in DEVICE pixels, relative to the WebView. */
    @JavascriptInterface
    fun setPipSourceRect(l: Int, t: Int, r: Int, b: Int) {
      runOnUiThread {
        val off = IntArray(2)
        webView?.getLocationInWindow(off)
        pipSourceRect = Rect(l + off[0], t + off[1], r + off[0], b + off[1])
        try {
          setPictureInPictureParams(buildPipParams())
        } catch (_: Exception) {
          /* PiP unavailable on this device/config */
        }
      }
    }

    /** Flip the PiP mute action's icon to match the player. */
    @JavascriptInterface
    fun setPipMuted(muted: Boolean) {
      pipMuted = muted
      refreshPipParams()
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

    /** Enter system picture-in-picture on demand.
     *
     *  No UI calls this any more, and that is deliberate: the activity IS the
     *  PiP window, so entering it from a button necessarily takes StreamNook off
     *  screen, which reads as the app closing. In-app shrinking is the web
     *  layer's mini player; system PiP is what LEAVING the app does. Kept for
     *  the bridge surface and for anything that genuinely wants to hand off. */
    @JavascriptInterface
    fun enterPip() {
      runOnUiThread {
        if (!isInPictureInPictureMode) {
          try {
            enterPictureInPictureMode(buildPipParams())
          } catch (_: Exception) {
            /* PiP unavailable on this device/config */
          }
        }
      }
    }

    // ---- Notifications ---------------------------------------------------
    //
    // The in-app permission prompt can reach a dead end: once Android decides
    // the user has permanently declined, requesting again returns denied
    // without showing anything. A category can also be silenced in system
    // settings while the app-level permission is still granted. Neither state
    // is visible to the plugin's is_permission_granted, so the panel needs to
    // read both and be able to open the one screen that can undo them.

    /** App-level switch, separate from the runtime permission. */
    @JavascriptInterface
    fun areNotificationsEnabled(): Boolean =
      NotificationManagerCompat.from(this@MainActivity).areNotificationsEnabled()

    /**
     * OS importance for a single channel: 0 is IMPORTANCE_NONE, meaning the
     * user silenced that category. -1 when the channel does not exist yet.
     */
    @JavascriptInterface
    fun channelImportance(id: String): Int {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      return nm.getNotificationChannel(id)?.importance ?: -1
    }

    /**
     * True while Android would still show a rationale, i.e. the user has
     * declined but not permanently. Once this is false and the permission is
     * still missing, an in-app request is a silent no-op and system settings is
     * the only way back.
     */
    @JavascriptInterface
    fun shouldShowNotificationRationale(): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
      return shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
    }

    /** The per-app notification screen: the only exit from a blocked state. */
    @JavascriptInterface
    fun openNotificationSettings() {
      runOnUiThread {
        try {
          startActivity(
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
          )
        } catch (_: Exception) {
          /* OEM without the standard screen */
        }
      }
    }

    /** Straight to one category, for fixing a single silenced channel. */
    @JavascriptInterface
    fun openChannelSettings(id: String) {
      runOnUiThread {
        try {
          startActivity(
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
              .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
              .putExtra(Settings.EXTRA_CHANNEL_ID, id)
          )
        } catch (_: Exception) {
          openNotificationSettings()
        }
      }
    }

    // ---- Background delivery ---------------------------------------------
    //
    // This is not a nicety. In the Rare and Restricted standby buckets Android
    // withholds network from jobs entirely, and Restricted is one batched run
    // per day, so an app the user opens infrequently simply stops delivering.
    // Being on the battery-optimisation allowlist exempts an app from Doze AND
    // from standby-bucket restrictions, so this toggle is what decides whether
    // background notifications work at all.

    @JavascriptInterface
    fun isIgnoringBatteryOptimizations(): Boolean {
      val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
      return pm.isIgnoringBatteryOptimizations(packageName)
    }

    @JavascriptInterface
    fun requestIgnoreBatteryOptimizations() {
      runOnUiThread {
        try {
          startActivity(
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
              .setData(Uri.parse("package:$packageName"))
          )
        } catch (_: Exception) {
          // Some OEMs refuse the direct request. The list screen needs no
          // permission and always exists.
          try {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
          } catch (_: Exception) {
            /* nothing sensible left to open */
          }
        }
      }
    }

    @JavascriptInterface
    fun scheduleBackgroundChecks(intervalMinutes: Int) {
      NotifyScheduler.schedule(this@MainActivity, intervalMinutes.toLong())
    }

    @JavascriptInterface
    fun cancelBackgroundChecks() {
      NotifyScheduler.cancel(this@MainActivity)
    }

    /** One immediate poll, fired when the app returns to the foreground. */
    @JavascriptInterface
    fun runNotifyCheckNow() {
      NotifyScheduler.runOnce(this@MainActivity)
    }

    /**
     * Channel login from a tapped notification, or "" if there is none.
     *
     * Reading it clears it, the same contract as consumePipClosed. The web shell
     * drains this on mount, which is what covers the cold case: the tap launches
     * the activity and the WebView only exists a good while later, so pushing
     * would have nothing to push to.
     */
    @JavascriptInterface
    fun consumePendingChannel(): String {
      val channel = pendingChannel
      pendingChannel = null
      return channel ?: ""
    }
  }

  /**
   * A notification tap on a warm app arrives here rather than through onCreate.
   *
   * `super` first, and it is not optional: WryActivity forwards to
   * `Rust.onNewIntent` and TauriActivity forwards to `PluginManager`, which is
   * how the deep-link plugin sees `streamnook://` links. Skipping it would
   * silently break those.
   */
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    val channel = intent.getStringExtra(NotifyWorker.EXTRA_CHANNEL) ?: return
    if (channel.isEmpty()) return
    pendingChannel = channel
    // The shell is already up in this path, so hand it over rather than waiting
    // for something to drain it. The bridge stays the fallback if no handler is
    // registered yet.
    runOnUiThread {
      webView?.evaluateJavascript(
        "window.__SN_OPEN_CHANNEL__ && window.__SN_OPEN_CHANNEL__(${JSONObject.quote(channel)})",
        null,
      )
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Cold start from a notification tap. Stashed for the shell to drain once
    // it mounts; there is no WebView to talk to at this point.
    intent?.getStringExtra(NotifyWorker.EXTRA_CHANNEL)?.takeIf { it.isNotEmpty() }?.let {
      pendingChannel = it
    }

    // Push token, fetched once per launch so `push_register` always has the
    // current one on disk (onNewToken only fires on rotation). Guarded: on a
    // device without Play services, or a build without google-services.json,
    // this throws and push simply stays dormant behind the poll lane.
    try {
      com.google.firebase.messaging.FirebaseMessaging.getInstance().token
        .addOnSuccessListener { token -> SNMessagingService.writeToken(this, token) }
    } catch (e: Throwable) {
      android.util.Log.i(NotifyRenderer.TAG, "push unavailable: ${e.message}")
    }

    // targetSdk is 36, so the export flag is mandatory. NOT_EXPORTED keeps the
    // mute intent reachable only by our own PendingIntent.
    ContextCompat.registerReceiver(
      this,
      muteReceiver,
      IntentFilter(ACTION_PIP_MUTE),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )

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
  // On API 31+ autoEnterEnabled has usually already done this, hence the
  // isInPictureInPictureMode guard; this remains the path on 26..30.
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (pipEligible && !isInPictureInPictureMode) {
      try {
        enterPictureInPictureMode(buildPipParams())
      } catch (_: Exception) {
        /* PiP unavailable on this device/config */
      }
    }
  }

  /**
   * Entering PiP moves the activity to PAUSED, and `WryActivity.onPause()`
   * pauses the WebView along with it. In PiP that is wrong: the window is still
   * on screen. A paused WebView stops drawing and stops media, so the PiP window
   * freezes on whatever was last rendered - the tab you happened to be on, not
   * the player - and playback dies with it.
   *
   * Undo it while pipped. `onPause` and `onPictureInPictureModeChanged` are not
   * ordered against each other across OEMs and API levels, so both sites do it;
   * `WebView.onResume()` is idempotent.
   */
  override fun onPause() {
    super.onPause()
    if (isInPictureInPictureMode) webView?.onResume()
  }

  override fun onPictureInPictureModeChanged(
    isInPictureInPictureMode: Boolean,
    newConfig: android.content.res.Configuration,
  ) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    // See onPause: keep the WebView live so the window keeps drawing and playing.
    if (isInPictureInPictureMode) webView?.onResume()
    // Tell the web shell so it strips down to the bare player while pipped.
    val flag = if (isInPictureInPictureMode) "true" else "false"
    webView?.evaluateJavascript(
      "(function(){document.documentElement.dataset.snPip='" + flag +
        "';window.dispatchEvent(new CustomEvent('sn:pip',{detail:" + flag + "}));})()",
      null,
    )

    // Leaving PiP happens two ways and they mean opposite things:
    //   expand  -> the activity comes to the foreground (STARTED / RESUMED)
    //   close X -> the window is dismissed and the activity is on its way to
    //              stopped, so the lifecycle is still at CREATED here.
    // Dismissing the window is the viewer saying they are done with the stream.
    // Closing PiP does NOT finish the activity on this device (verified: the
    // process and the ActivityRecord both survive), so without this the stream
    // stays loaded and playing and reappears the next time the app is opened.
    if (!isInPictureInPictureMode && lifecycle.currentState == Lifecycle.State.CREATED) {
      // Belt: stop it now, so audio does not carry on in the background.
      webView?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('sn:pip-closed'))",
        null,
      )
      // Braces: the activity is stopping, so that script may not get to run.
      // This flag is read synchronously on the way back in and cannot be lost.
      pipClosedPending = true
    }
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

  override fun onDestroy() {
    try {
      unregisterReceiver(muteReceiver)
    } catch (_: IllegalArgumentException) {
      /* never registered */
    }
    super.onDestroy()
  }

  companion object {
    private const val ACTION_PIP_MUTE = "app.streamnook.PIP_MUTE"
  }
}
