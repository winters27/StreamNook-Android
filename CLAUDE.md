# StreamNook Android

This tree is the Android port of the StreamNook desktop client. It is a **derivation**, not a
separate product.

## Rule zero: read the desktop first

The desktop client is the reference implementation for behaviour, for visual language, and for
which backend contracts actually exist. Before writing any mobile surface:

1. **Grep `src/components/` for the feature name.** The desktop has almost always already solved
   it, often twice: a full component plus a compact badge or inline variant. Read both, then match
   them. Colours, icon set, stroke weights and glow treatments are part of the answer, not
   incidental.
2. **Verify every Tauri event name and command has a live emitter or handler** before listening for
   it: `rg "emit.*<event-name>" src-tauri/`. The desktop can carry a dead listener because other
   surfaces cover for it; a fresh shell usually cannot, and the failure is silent.
3. **Check the knowledge vault before replicating anything out of `App.tsx`.** Known-dead paths are
   already documented there.

Two caveats that make step 1 less mechanical than it sounds:

- The desktop's version may be a **local closure** rather than an export (`getGameBoxArt`,
  `BucketTile` both were). Extract it to a shared module and have the desktop import it back,
  rather than reimplementing.
- A helper that looks shared may have **no mobile-reachable inputs**. `deriveDropProgressDisplay`
  reads as platform-neutral but both of its feeds are plugin-only, which is desktop-only. Read the
  body, not just the name.

## Where things live

- `src/mobile/` is the mobile shell. Nothing here is imported by the desktop.
- `src/components/` is shared. Edits here must keep the desktop working; run the desktop gates.
- `src-tauri/` gates desktop-only commands with `#[cfg(desktop)]`. Capabilities are split into
  `capabilities/desktop.json` and `capabilities/mobile.json` by platform.
- `src-tauri/gen/android/` is committed. `tauri android init` regenerates it and will drop the
  edge-to-edge theme, the insets bridge and the network security config.

## Gates

```bash
npx tsc --noEmit && npx eslint src/mobile/
```

```bash
export NDK_HOME=/root/android-sdk/ndk/26.3.11579264
export PATH="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```

The Rust gate needs both halves of that second block. Without `--target`, cargo builds for the
host Linux target, which wants GTK and fails on a missing `gobject-2.0` that this tree has no
reason to install. Without the NDK toolchain on `PATH`, cc-rs cannot find
`aarch64-linux-android-clang`. `~/wsl_dev.sh` exports the same environment for `tauri android dev`.

`.env` is gitignored and must be hand-copied into any fresh clone (17 lines). Without it the build
succeeds and silently compiles empty secrets.
