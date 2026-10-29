# noVNC Android Client App

A native Android client application built from the **noVNC** HTML5/RFB codebase, engineered for mobile usability using modern Native Android and Custom Components.

**Current version: 1.3.13** — Fixed noVNC Menu Button Position: The floating `⚡ noVNC` menu button is now locked in its fixed default location (bottom-right corner) with no option to move or drag it. Removed touch-drag tracking to prevent accidental displacements, and ensured it stays fixed in place without jumping across the screen when typing.

---

## 🌐 Live Download Portal & Cloudflare Tunnel

Download Landing Page: **[https://tommy-animation-recall-raised.trycloudflare.com](https://tommy-animation-recall-raised.trycloudflare.com)**  
Direct APK Download: **[https://tommy-animation-recall-raised.trycloudflare.com/novnc-android-client.apk](https://tommy-animation-recall-raised.trycloudflare.com/novnc-android-client.apk)**

Includes dynamic QR code scanning for phones, step-by-step installation instructions, and SHA-256 verification.

---

## 📱 Highlights & Usability Features

Standard mobile browsers running noVNC suffer from touch precision issues, lack of desktop keyboard keys, awkward browser overscroll, and missing connection management. This client solves these problems with custom components and native ergonomics:

### 1. Connection Manager & Profiles (`MainActivity`)
- **Saved Connection Profiles**: Store profiles with custom server names, hostnames/IPs, ports, paths, passwords, and encryption settings.
- **Quick Connect Card**: Instant connection without creating a profile.
- **Protocol Flexibility**: Full support for WebSocket (`ws://`) and secure WebSocket (`wss://`) endpoints.
- **Per-Connection Preferences**: Default mouse mode, scaling, and quality settings saved per host.

### 2. Dual-Mode Input with Virtual Trackpad (`VirtualTrackpadView`)
- **Accurate pointer mapping**: the trackpad works in *framebuffer* coordinates and writes
  `RFB.messages.pointerEvent()` straight to the socket. The previous build routed desktop
  coordinates through `rfb._sendMouse()`, which divides by the viewport scale again — every
  click landed at the wrong pixel (typically the far edge of the screen). That is fixed.
- **Virtual Laptop Trackpad Mode (Precision)**:
  - Relative cursor navigation with fine sub-pixel sensitivity when zoomed in.
  - **Single Tap** — left click (with accurate positioning move first).
  - **Two-Finger Tap** — right click.
  - **Two-Finger Pinch (Spread / Pinch)** — continuous smooth zoom in and zoom out (up to 5x) centered around your fingers, exactly like Chrome Remote Desktop (no +/- buttons).
  - **Two-Finger Drag (When Zoomed)** — pan the viewport smoothly to navigate anywhere on the desktop.
  - **Two-Finger Drag (When Unzoomed)** — mouse wheel scroll up/down.
  - **Two-Finger Double Tap** — instantly resets zoom back to 1.0x (fit-to-screen).
  - **Edge Auto-Pan** — when zoomed in, moving the cursor near the screen edge automatically slides the viewport to keep the cursor visible.
  - **Three-Finger Drag** — mouse wheel scroll in any zoom state.
  - **Three-Finger Tap** — middle click.
  - **Long Press** — right click (without lifting the finger).
  - **Double-Tap & Drag** — click-and-hold drag for moving windows / selecting text.
  - **Visual Feedback** — HUD displays active zoom level (e.g. `1.8x`), animated ripple feedback, and haptics per gesture.
- **Direct Touch Mode**: the overlay is removed entirely, so the WebView sees raw touches and
  noVNC's own gesture handler drives the pointer (correct absolute mapping for tablets/kiosks).

### 3. Quick Keyboard Popup (`QuickKeyboardView`) — new in 1.1.0
- **Types straight into the remote desktop**: tap ⌨ in the dock, the system keyboard opens and
  every character is forwarded to the VNC session. There is no local text buffer, so no
  autocorrect, no duplicated characters, no lost keystrokes.
- **One-shot modifier keys** (`Ctrl`, `Alt`, `Shift`, `Win`) that latch for the *next* key —
  press `Ctrl`, type `c`, and the remote shell receives a clean `Ctrl+C`.
- **Desktop key strip**: `Esc`, `Tab`, `⌫`, `↵`, `Del`, arrows, `Home`, `End`, `PgUp`, `PgDn`
  and `F1`–`F12`, all reachable without leaving the keyboard.
- **IME bridge**: `RemoteInputEditText` implements a shadow buffer so predictive keyboards keep
  their delete key enabled, then translates commits/backspaces into keysyms.

### 3b. Extended Desktop Keyboard Bar (`ExtendedKeyboardView`)
- **Sticky Modifier Keys**: `[ Ctrl ]`, `[ Alt ]`, `[ Shift ]`, `[ Win / Super ]` with visual latched state indicators.
- **Desktop Navigation Cluster**: Directional arrow keys (`▲`, `▼`, `◄`, `►`), `Home`, `End`, `PgUp`, `PgDn`.
- **Special Action Keys**: `[ Esc ]`, `[ Tab ]`, `[ Del ]`, `[ Enter ]`.
- **Function Keys Strip**: Complete `F1` through `F12` row.
- **Instant Shortcuts**: Dedicated `[ Ctrl+Alt+Del ]` button.
- **Quick Text Sender**: Dialog to type commands or passwords and dispatch them directly.

### 3c. Physical Keyboards
USB / Bluetooth / DeX keyboards are forwarded to the remote session, including `Ctrl`/`Alt`/`Win`
combinations — useful for tablets with a keyboard cover.

### 4. Floating Action HUD Dock (`FloatingHudDockView`)
- **Draggable Pill**: Sits unobtrusively on top of the remote session and can be dragged to any screen corner.
- **One-Tap Expansion**: Expands into quick-access buttons:
  - ⌨️ Quick Keyboard popup (types into the remote)
  - 🎛️ Extended special-key bar
  - 🖱️ Switch Mouse Mode (Trackpad vs Direct Touch)
  - 🔲 Toggle Viewport Scaling (Fit to Screen vs 1:1 Pixel Mapping)
  - 📋 Two-Way Clipboard Sync
  - ⚡ Instant Ctrl+Alt+Del
  - ⚙️ Session Settings
  - 🚪 Safe Disconnect with confirmation

### 5. Two-Way Clipboard Synchronization (`ClipboardDialog`)
- Live monitoring of remote clipboard events (`RFB clipboard` event).
- "Copy Remote to Phone": Copies remote desktop text to Android system clipboard.
- "Send to Remote": Transfers Android clipboard or typed text into the VNC server using `rfb.clipboardPasteFrom()`.

### 6. Dedicated Settings Page & Mouse Speed Options (`SettingsActivity`, `AppSettings`)
- **Global Settings Page**: Reachable via the "⚙" icon on the main screen or "⚙ Settings" in the session HUD.
- **Granular Mouse Speed Control**:
  - Continuous slider from **0.2x** to **3.0x** with real-time feedback (e.g. `1.0x Normal`, `1.5x Fast`).
  - **One-Tap Quick Presets**: `0.6x Precision`, `1.0x Normal`, `1.5x Fast`, `2.2x Ultra`.
  - Immediate real-time effect on cursor movement gain in the active session.
- **Pointer Acceleration**: Toggle dynamic cursor acceleration on quick finger swipes.
- **Scroll Direction Inversion**: Toggle natural vs traditional two-finger scroll direction.
- **Haptic Vibration Feedback**: Toggle tactile vibration feedback on taps, clicks, and gestures.
- **Session Defaults**: Configure default mouse mode (Trackpad vs Direct Touch), scaling mode, screen wake lock, image quality (1–9), and compression (0–9) across all connections.

### 7. Fullscreen Immersion & Performance
- **Edge-to-Edge Immersion**: Status bar and navigation bar auto-hidden via `SYSTEM_UI_FLAG_IMMERSIVE_STICKY`.
- **Screen WakeLock**: Prevents phone display from sleeping during active sessions.
- **Hardware Acceleration**: WebView configured with hardware acceleration enabled for smooth 60fps canvas rendering.
- **Ultra-Lightweight**: Entire APK is only **~223 KB** with zero bloat.

---

## 🛠 Project Architecture

```
android/
├── novnc-android-client.apk            # Pre-built, signed, ready-to-install APK
├── build.sh                            # One-command standalone build script
├── build.gradle                        # Root Gradle configuration
├── settings.gradle                     # Gradle settings
└── app/
    ├── build.gradle                    # App module Gradle configuration
    └── src/main/
        ├── AndroidManifest.xml         # Manifest (API 24-34, Internet/Vibrate/WakeLock)
        ├── assets/novnc/               # Embedded noVNC Web Core
        │   ├── index.html              # Custom bridge wrapper
        │   ├── core/                   # noVNC RFB protocol engine (ES modules)
        │   │   ├── rfb.js
        │   │   ├── websock.js
        │   │   ├── display.js
        │   │   ├── encodings.js
        │   │   ├── decoders/           # Raw, CopyRect, Tight, ZRLE, Hextile, JPEG, H264
        │   │   ├── crypto/             # AES, RSA, DES, DH, MD5
        │   │   └── input/              # Keysyms, XT scancodes, DOM key tables
        │   └── vendor/pako/            # Pure JS Zlib inflator/deflator
        ├── java/com/novnc/android/
        │   ├── MainActivity.java       # Connection profiles manager
        │   ├── VncViewerActivity.java  # Remote desktop session viewer
        │   ├── ConnectionProfile.java  # Profile model & JSON serializer
        │   ├── ProfileManager.java     # SharedPreferences persistence
        │   ├── AndroidBridge.java      # Bidirectional WebView <-> Native bridge
        │   ├── ui/
        │   │   ├── QuickKeyboardView.java      # IME-backed quick keyboard popup + key strip
        │   │   ├── RemoteInputEditText.java    # IME bridge (forwards text instead of storing it)
        │   │   ├── KeyMapper.java              # Android KeyEvent -> X11 keysym translation
        │   │   ├── ExtendedKeyboardView.java   # Custom desktop keys & sticky modifiers
        │   │   ├── VirtualTrackpadView.java    # Custom trackpad gesture overlay
        │   │   ├── FloatingHudDockView.java    # Draggable floating action dock
        │   │   ├── ClipboardDialog.java        # Two-way clipboard sync dialog
        │   │   ├── SessionSettingsDialog.java  # Live quality/scale/sensitivity settings
        │   │   └── ProfileEditDialog.java      # Profile creation/editing modal
        │   └── util/
        │       └── KeySyms.java        # X11/RFB keysym mapping constants
        └── res/                        # Material 3 dark-themed resources & layouts
```

---

## 🚀 Building & Installing

### Installing the pre-built APK
```bash
adb install android/novnc-android-client.apk
```

### Rebuilding with `build.sh` (fast standalone build)
```bash
./android/build.sh
```

### Running the bridge tests
```bash
./android/test.sh
```
The suite extracts the module script from `assets/novnc/index.html`, swaps the RFB
engine for a recorder, and asserts the exact framebuffer coordinates and button masks
produced by clicks, drags, scrolls and absolute touches.

### Building with Android Studio / Gradle
1. Open the `android` folder in Android Studio.
2. Let Gradle sync and select **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

---

## 🔌 Server Compatibility

Compatible with any VNC server or WebSocket bridge:
- **websockify**: `websockify 6080 localhost:5900`
- **Proxmox VE**: Built-in VNC console endpoints
- **QEMU / KVM**: `-vnc :1,websocket=5701`
- **Docker VNC containers**: (e.g. `dorowu/ubuntu-desktop-lxde-vnc`, `accetto/ubuntu-vnc-xfce-g3`)
- **TigerVNC / LibVNCServer**: With WebSocket support enabled
