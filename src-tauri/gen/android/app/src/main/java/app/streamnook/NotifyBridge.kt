package app.streamnook

/**
 * JNI door into the Rust core for code that runs with no Activity.
 *
 * The notification worker can start in a cold process, so the library is loaded
 * here rather than relying on Tauri's activity having loaded it already.
 * `System.loadLibrary` is a no-op when the library is already mapped, so this is
 * safe whether the app is running or not.
 *
 * Kept as a plain `object` with ordinary members on purpose: an `object`'s
 * methods compile to instance methods on this class, so the native symbol is
 * exactly `Java_app_streamnook_NotifyBridge_<name>` and the second JNI argument
 * is the singleton rather than a class.
 *
 * The shape that does NOT work is a `companion object`: `@JvmStatic` there puts
 * the native method on `NotifyBridge$Companion`, so the Rust symbol never
 * resolves and it fails at call time rather than at build time. Verify with
 * `javap -p -s` on the compiled class before trusting either arrangement.
 */
object NotifyBridge {
  init {
    System.loadLibrary("streamnook_lib")
  }

  /** Returns a fixed string when the library loaded and JNI is wired up. */
  external fun ping(): String
}
