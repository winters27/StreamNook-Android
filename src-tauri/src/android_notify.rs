//! Android-only bridge for work that runs with no Tauri app around it.
//!
//! Notifications have to keep arriving after the app is closed, and at that
//! point there is no WebView to listen for an event and no `AppHandle` to emit
//! one. A Kotlin worker calls straight into this library instead, so everything
//! here must work with nothing but a JVM pointer: no app handle, no running
//! event loop, and no assumption that Tauri's activity ever started.
//!
//! The library is `libstreamnook_lib.so` (crate `streamnook_lib`), which the
//! Kotlin side loads itself rather than relying on the activity having done it.
#![cfg(target_os = "android")]

use jni::objects::JObject;
use jni::sys::jstring;
use jni::JNIEnv;

/// Liveness probe, called from `app.streamnook.NotifyBridge.ping`.
///
/// This exists to answer one question before anything is built on top of it:
/// whether `System.loadLibrary` and a plain JNI call both work from a worker
/// running in a cold process with no Activity. It deliberately touches nothing
/// else in the crate, so a failure means the load path is wrong rather than
/// some service having failed to initialise.
///
/// `NotifyBridge` is a Kotlin `object`, so its members compile to instance
/// methods on the class and the second argument is the singleton, not a
/// `JClass`. Marking the function `@JvmStatic` instead would move the symbol
/// onto `NotifyBridge$Companion` and this binding would silently never resolve.
#[no_mangle]
pub extern "system" fn Java_app_streamnook_NotifyBridge_ping<'local>(
    mut env: JNIEnv<'local>,
    _this: JObject<'local>,
) -> jstring {
    match env.new_string("streamnook-jni-ok") {
        Ok(s) => s.into_raw(),
        // Returning null rather than panicking: unwinding across the JNI
        // boundary is undefined, and the caller already treats null as failure.
        Err(_) => std::ptr::null_mut(),
    }
}
