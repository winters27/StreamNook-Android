package app.streamnook

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.net.URL

/**
 * Delivers notifications while the app is closed.
 *
 * The in-app path needs a live WebView: Rust polls, emits a Tauri event, and JS
 * turns it into a notification. Once the app is swiped away none of that exists,
 * so this worker calls straight into the Rust core over JNI instead. Rust owns
 * the whole decision (token refresh, which channels are new, what is muted) and
 * hands back a ready-to-post list; this class only renders it.
 *
 * Note it does NOT use the Tauri notification plugin. That plugin resolves its
 * icon fields as drawable resource names, so it cannot show a streamer's avatar
 * at all — posting directly is what lets these carry artwork.
 */
class NotifyWorker(
  private val context: Context,
  parameters: WorkerParameters,
) : CoroutineWorker(context, parameters) {

  override suspend fun doWork(): Result {
    val payload = try {
      // getDataDir(), matching what Tauri's app_data_dir() resolves to. Rust
      // verifies it and falls back to files/ rather than trusting this blindly.
      NotifyBridge.pollOnce(context.dataDir.absolutePath)
    } catch (e: Throwable) {
      // UnsatisfiedLinkError is the interesting failure here and it is an Error,
      // not an Exception, so catching Throwable is deliberate.
      Log.e(TAG, "JNI poll failed", e)
      null
    }

    val items = parse(payload)
    // Logged on every path, including the empty one. Rust returns [] for a
    // whole family of perfectly correct outcomes (nobody new is live, the app
    // is open and its own listener has it, notifications are off, not signed
    // in), and without this line a run that deliberately did nothing looks
    // exactly like a run that never happened.
    Log.i(TAG, "poll -> ${if (payload == null) "JNI FAILED" else "${items.size} to post"}")
    if (items.isNotEmpty()) {
      postAll(items)
    }

    // Always success. At a 15 minute period a retry buys nothing and spends
    // standby-bucket quota the next run needs.
    return Result.success()
  }

  private data class Item(
    val channelId: String,
    val login: String,
    val title: String,
    val body: String,
    val avatar: String?,
    /** OS category to post under, chosen by Rust. */
    val channel: String,
  )

  private fun parse(json: String?): List<Item> {
    if (json.isNullOrBlank()) return emptyList()
    return try {
      val arr = JSONArray(json)
      (0 until arr.length()).mapNotNull { i ->
        val o = arr.optJSONObject(i) ?: return@mapNotNull null
        val id = o.optString("channel_id")
        if (id.isEmpty()) return@mapNotNull null
        Item(
          channelId = id,
          login = o.optString("login"),
          title = o.optString("title"),
          body = o.optString("body"),
          avatar = o.optString("avatar").takeIf { it.isNotEmpty() },
          channel = o.optString("channel").takeIf { it.isNotEmpty() } ?: NotifyChannels.LIVE,
        )
      }
    } catch (e: Exception) {
      Log.e(TAG, "malformed poll payload", e)
      emptyList()
    }
  }

  private suspend fun postAll(items: List<Item>) {
    val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Created defensively: the worker can run in a process where the web shell
    // has never booted, so it cannot assume the channels already exist.
    NotifyChannels.ensure(nm)

    for (item in items) {
      val intent = Intent(context, MainActivity::class.java).apply {
        flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        // Only channels are openable. A badge has no login, so its tap just
        // brings the app up rather than trying to watch something.
        if (item.login.isNotEmpty()) putExtra(EXTRA_CHANNEL, item.login)
      }
      // The request code must vary per item too. Sharing one would make every
      // notification reuse the first intent, so they would all open the same
      // stream.
      val pending = PendingIntent.getActivity(
        context,
        item.channelId.hashCode(),
        intent,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )

      val builder = NotificationCompat.Builder(context, item.channel)
        .setSmallIcon(R.drawable.ic_stat_notify)
        .setContentTitle(item.title)
        .setContentText(item.body)
        .setAutoCancel(true)
        // Grouped per category, so a badge drop never collapses under "channels
        // going live" and vice versa.
        .setGroup(groupFor(item.channel))
        .setContentIntent(pending)
      loadBitmap(item.avatar)?.let { builder.setLargeIcon(it) }

      // Keyed on the item, so a second notification for the same channel or
      // badge replaces the first rather than stacking a duplicate.
      nm.notify(item.channelId.hashCode(), builder.build())
    }

    // One summary per category that actually produced something, so several
    // arriving at once collapse into a single row instead of filling the shade.
    for (channel in items.map { it.channel }.distinct()) {
      val summary = NotificationCompat.Builder(context, channel)
        .setSmallIcon(R.drawable.ic_stat_notify)
        .setGroup(groupFor(channel))
        .setGroupSummary(true)
        .setAutoCancel(true)
        .build()
      nm.notify(groupFor(channel).hashCode(), summary)
    }
  }

  private fun groupFor(channel: String) = "app.streamnook.GROUP.$channel"

  /** Best effort: a missing avatar costs a thumbnail, never the notification. */
  private suspend fun loadBitmap(url: String?): Bitmap? {
    if (url.isNullOrEmpty()) return null
    return withContext(Dispatchers.IO) {
      try {
        URL(url).openStream().use { BitmapFactory.decodeStream(it) }
      } catch (e: Exception) {
        Log.w(TAG, "avatar fetch failed", e)
        null
      }
    }
  }

  companion object {
    const val TAG = "SNNotify"
    const val EXTRA_CHANNEL = "sn_channel"
  }
}
