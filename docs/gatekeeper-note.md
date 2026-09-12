### ⚠️ macOS will refuse to open this at first

These builds are ad-hoc signed and not notarised. Gatekeeper blocks them, and because there
is no Developer ID for it to make an exception against, **no "Open Anyway" button appears** in
System Settings → Privacy & Security. Right-click → Open does not help either; Apple removed
that bypass in macOS 15.

Clearing the quarantine flag is the only route. After dragging the app to `/Applications`:

```console
xattr -dr com.apple.quarantine "/Applications/Clarity Game Manager.app"
```

`-r` is not optional: the flag is set on every file inside the bundle, not just the bundle
itself, so a non-recursive removal leaves it blocked.

This applies to every download. Re-downloading or updating re-applies the flag, so expect to
run it again.
