package app.streamnook

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

/**
 * Delivers notifications while the app is closed.
 *
 * The in-app path needs the WebView alive: Rust polls, emits a Tauri event, and
 * JS turns it into a notification. Once the app is swiped away none of that
 * exists, so this worker calls straight into the Rust core over JNI instead.
 *
 * Right now it only proves the load path works. The real poll lands once that
 * is confirmed on hardware, because everything else depends on it.
 */
class NotifyWorker(
  context: Context,
  parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {

  override suspend fun doWork(): Result {
    // The open question this worker exists to answer: whether the Rust library
    // loads and binds from a process that Android started for the job alone,
    // with no Activity and nothing else initialised.
    val reply = try {
      NotifyBridge.ping()
    } catch (e: Throwable) {
      // UnsatisfiedLinkError is the interesting failure and it is an Error, not
      // an Exception, so catching Throwable is deliberate here.
      Log.e(TAG, "JNI bridge unavailable from worker", e)
      null
    }
    Log.i(TAG, "ping -> ${reply ?: "FAILED"}")

    // Always success. At a 15 minute period a retry buys nothing and spends
    // standby-bucket quota that the next run needs.
    return Result.success()
  }

  companion object {
    const val TAG = "SNNotify"
  }
}
