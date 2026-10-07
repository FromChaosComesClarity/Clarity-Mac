# cnc-ddraw

`ddraw.dll` from [cnc-ddraw](https://github.com/FunkyFr3sh/cnc-ddraw) **v7.1.0.0**
(release asset `cnc-ddraw.zip`, 2024-12-28), unmodified. MIT licensed, see `LICENSE`.

SHA-256 `85e0f7d530dfda134793a57cb3e76b0287dcc96892ee57162dd68f47283b03a9`

Used by the Road Rash launch fix (`applyRoadRashFix` in `packages/core/installer-engine.js`):
it is placed beside the game so a 640x480 DirectDraw game can fill the screen without the
display mode ever changing. To update, replace the DLL from a newer release, update the
version and hash above, and re-test Road Rash.
