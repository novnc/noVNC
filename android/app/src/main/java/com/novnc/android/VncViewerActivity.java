package com.novnc.android;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.InputMethodManager;
import android.webkit.ConsoleMessage;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Locale;

import com.novnc.android.ui.ClipboardDialog;
import com.novnc.android.ui.ExtendedKeyboardView;
import com.novnc.android.ui.FloatingHudDockView;
import com.novnc.android.ui.KeyMapper;
import com.novnc.android.ui.QuickKeyboardView;
import com.novnc.android.ui.SessionSettingsDialog;
import com.novnc.android.ui.VirtualTrackpadView;
import com.novnc.android.util.KeySyms;

import org.json.JSONObject;

public class VncViewerActivity extends Activity implements
        AndroidBridge.BridgeListener,
        VirtualTrackpadView.TrackpadListener,
        ExtendedKeyboardView.OnKeyEventListener,
        QuickKeyboardView.Listener,
        FloatingHudDockView.HudActionListener,
        SessionSettingsDialog.SettingsChangeListener {

    private WebView webView;
    private VirtualTrackpadView trackpadView;
    private QuickKeyboardView quickKeyboardView;
    private ExtendedKeyboardView extendedKeyboardView;
    private FloatingHudDockView floatingHudView;
    private View bottomKeyboards;

    private View hudTopBar;
    private View statusDot;
    private TextView tvHudStatus;
    private TextView tvHudResolution;

    private ConnectionProfile profile;
    private AndroidBridge bridge;
    private PowerManager.WakeLock wakeLock;

    private String remoteClipboard = "";
    private boolean isConnected = false;
    private boolean isTrackpadMode = true;
    private boolean isScaleViewport = true;
    private boolean isViewOnly = false;
    private int qualityLevel = 6;
    private int compressionLevel = 2;
    private float pointerGain = 0.4f;
    private String baseResolution = "";
    private float currentZoom = 1.0f;

    private boolean sessionStarted = false;
    private final Handler watchdogHandler = new Handler(Looper.getMainLooper());
    private Runnable watchdogRunnable;

    /**
     * Height (px) of the remote session surface when the system keyboard is
     * closed. The WebView and the track surface are pinned to this height so
     * that the IME overlays the desktop instead of shrinking it to a strip.
     */
    private int sessionSurfaceHeight = 0;
    private int sessionSurfaceWidth = 0;

    private static class VncWebChromeClient extends WebChromeClient {
        @Override
        public boolean onConsoleMessage(ConsoleMessage cm) {
            Log.d("noVNC-JS", "[" + cm.messageLevel() + "] " + cm.message()
                    + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
            return true;
        }
    }

    private static class WatchdogTask implements Runnable {
        private final VncViewerActivity activity;

        WatchdogTask(VncViewerActivity activity) {
            this.activity = activity;
        }

        @Override
        public void run() {
            if (!activity.isConnected && !activity.isFinishing()) {
                Log.w("noVNC-Viewer", "Connection watchdog: still connecting after 10s");
                activity.tvHudStatus.setText("Connecting (negotiating RFB session)…");
            }
        }
    }

    private static class VncWebViewClient extends WebViewClient {
        private final VncViewerActivity activity;

        VncWebViewClient(VncViewerActivity activity) {
            this.activity = activity;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            Log.d("noVNC-Viewer", "WebView onPageFinished: " + url);
            activity.ensureSessionStarted();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            Log.e("noVNC-Viewer", "WebView resource error: " + error.getDescription()
                    + " code=" + error.getErrorCode() + " url=" + (request != null ? request.getUrl() : ""));
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            Log.w("noVNC-Viewer", "WebView SSL error: " + error);
            handler.proceed(); // Trust certificate for local/self-signed setups
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Android 11+ can deliver the IME inset without resizing the window, so
        // the desktop keeps its full size and the keyboard just overlays it.
        // Older releases have no reliable IME inset with adjustNothing, so they
        // keep adjustResize (the session surface is still pinned to full height
        // by applyImeLayout, which is what prevents the desktop from shrinking).
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
        } else {
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        }
        enableImmersiveMode();

        setContentView(R.layout.activity_vnc_viewer);

        profile = (ConnectionProfile) getIntent().getSerializableExtra("profile");
        if (profile == null) {
            profile = new ConnectionProfile();
        }

        AppSettings appSettings = new AppSettings(this);
        pointerGain = appSettings.getMouseSpeed();
        isScaleViewport = profile.isScaleViewport();
        isViewOnly = profile.isViewOnly();
        qualityLevel = profile.getQualityLevel();
        compressionLevel = profile.getCompressionLevel();

        setupWakeLock();
        initViews();
        setupWebView();
        setupInputHandlers();
    }

    private void enableImmersiveMode() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveMode();
        }
    }

    private void setupWakeLock() {
        if (!new AppSettings(this).isKeepScreenAwake()) {
            return;
        }
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ON_AFTER_RELEASE,
                        "noVNC:SessionLock");
                wakeLock.acquire(120 * 60 * 1000L);
            }
        } catch (Exception ignored) {
        }
    }

    private void initViews() {
        webView = findViewById(R.id.webview_vnc);
        trackpadView = findViewById(R.id.view_trackpad);
        quickKeyboardView = findViewById(R.id.view_quick_keyboard);
        extendedKeyboardView = findViewById(R.id.view_extended_keyboard);
        floatingHudView = findViewById(R.id.view_floating_hud);
        bottomKeyboards = findViewById(R.id.layout_bottom_keyboards);

        hudTopBar = findViewById(R.id.hud_top_bar);
        statusDot = findViewById(R.id.status_indicator_dot);
        tvHudStatus = findViewById(R.id.tv_hud_status);
        tvHudResolution = findViewById(R.id.tv_hud_resolution);

        setStatusIndicator(Color.parseColor("#d29922"),
                "Connecting to " + profile.getName() + "…", "");

        AppSettings settings = new AppSettings(this);
        trackpadView.setHapticsEnabled(settings.isHapticsEnabled());
        trackpadView.setInvertScroll(settings.isInvertScroll());

        applyMouseMode(profile.isTrackpadMode());

        bottomKeyboards.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
            applyImeLayout(findViewById(R.id.root_viewer));
            updateHudOffset();
        });
        installImeWatcher();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);

        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        webView.setBackgroundColor(Color.parseColor("#0d1117"));

        bridge = new AndroidBridge();
        bridge.setListener(this);
        webView.addJavascriptInterface(bridge, "AndroidBridge");

        webView.setWebChromeClient(new VncWebChromeClient());
        webView.setWebViewClient(new VncWebViewClient(this));

        webView.loadUrl("file:///android_asset/novnc/index.html");
    }

    private void setupInputHandlers() {
        trackpadView.setTrackpadListener(this);
        extendedKeyboardView.setOnKeyEventListener(this);
        quickKeyboardView.setListener(this);
        floatingHudView.setHudActionListener(this);
    }

    // ================= Keyboard plumbing =================

    private void runJs(String script) {
        if (webView != null) {
            webView.evaluateJavascript(script, null);
        }
    }

    private void jsKey(int keysym, String code, boolean down) {
        runJs(String.format("novnc.sendKey(%d,%s,%b)",
                keysym, JSONObject.quote(code == null ? "" : code), down));
    }

    @Override
    public void sendKeyCombo(int keysym, String code, int modifierMask) {
        if (modifierMask < 0) return;

        if ((modifierMask & QuickKeyboardView.MOD_CTRL) != 0) jsKey(KeySyms.XK_Control_L, "ControlLeft", true);
        if ((modifierMask & QuickKeyboardView.MOD_ALT) != 0) jsKey(KeySyms.XK_Alt_L, "AltLeft", true);
        if ((modifierMask & QuickKeyboardView.MOD_SHIFT) != 0) jsKey(KeySyms.XK_Shift_L, "ShiftLeft", true);
        if ((modifierMask & QuickKeyboardView.MOD_WIN) != 0) jsKey(KeySyms.XK_Super_L, "MetaLeft", true);

        jsKey(keysym, code, true);
        jsKey(keysym, code, false);

        if ((modifierMask & QuickKeyboardView.MOD_WIN) != 0) jsKey(KeySyms.XK_Super_L, "MetaLeft", false);
        if ((modifierMask & QuickKeyboardView.MOD_SHIFT) != 0) jsKey(KeySyms.XK_Shift_L, "ShiftLeft", false);
        if ((modifierMask & QuickKeyboardView.MOD_ALT) != 0) jsKey(KeySyms.XK_Alt_L, "AltLeft", false);
        if ((modifierMask & QuickKeyboardView.MOD_CTRL) != 0) jsKey(KeySyms.XK_Control_L, "ControlLeft", false);
    }

    @Override
    public void sendText(String text, int modifierMask) {
        if (text == null || text.isEmpty()) return;
        String quoted = JSONObject.quote(text);

        if (modifierMask != 0) {
            if ((modifierMask & QuickKeyboardView.MOD_CTRL) != 0) jsKey(KeySyms.XK_Control_L, "ControlLeft", true);
            if ((modifierMask & QuickKeyboardView.MOD_ALT) != 0) jsKey(KeySyms.XK_Alt_L, "AltLeft", true);
        }
        runJs("novnc.sendString(" + quoted + ")");
        if ((modifierMask & QuickKeyboardView.MOD_ALT) != 0) jsKey(KeySyms.XK_Alt_L, "AltLeft", false);
        if ((modifierMask & QuickKeyboardView.MOD_CTRL) != 0) jsKey(KeySyms.XK_Control_L, "ControlLeft", false);
    }

    @Override
    public void sendBackspaces(int count) {
        for (int i = 0; i < Math.max(1, count); i++) {
            jsKey(KeySyms.XK_BackSpace, "Backspace", true);
            jsKey(KeySyms.XK_BackSpace, "Backspace", false);
        }
    }

    @Override
    public void onCtrlAltDel() {
        runJs("novnc.sendCtrlAltDel()");
        Toast.makeText(this, "Sent Ctrl+Alt+Del", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onSendCtrlAltDel() {
        onCtrlAltDel();
    }

    @Override
    public void onHideRequested() {
        hideQuickKeyboard();
    }

    /**
     * Hardware keyboards (USB/Bluetooth/DeX) are forwarded straight to the
     * remote session, unless the quick keyboard field already owns the event.
     */
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();

        if (keyCode == KeyEvent.KEYCODE_BACK
                || keyCode == KeyEvent.KEYCODE_VOLUME_UP
                || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN
                || keyCode == KeyEvent.KEYCODE_VOLUME_MUTE
                || keyCode == KeyEvent.KEYCODE_POWER) {
            return super.dispatchKeyEvent(event);
        }

        if (!isConnected) {
            return super.dispatchKeyEvent(event);
        }

        if (quickKeyboardView != null && quickKeyboardView.isInputFocused()) {
            // The EditText's IME bridge is already forwarding these.
            return super.dispatchKeyEvent(event);
        }

        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            if (event.getRepeatCount() > 0) return true;
            if (KeyMapper.isModifier(keyCode)) return true;

            KeyMapper.Mapped mapped = KeyMapper.map(event);
            if (mapped == null) return super.dispatchKeyEvent(event);

            int mods = 0;
            if (event.isCtrlPressed()) mods |= QuickKeyboardView.MOD_CTRL;
            if (event.isAltPressed()) mods |= QuickKeyboardView.MOD_ALT;
            if (event.isMetaPressed()) mods |= QuickKeyboardView.MOD_WIN;

            sendKeyCombo(mapped.keysym, mapped.code, mods);
            return true;
        }

        if (event.getAction() == KeyEvent.ACTION_UP) {
            if (KeyMapper.isModifier(keyCode)) return true;
            return KeyMapper.map(event) != null || super.dispatchKeyEvent(event);
        }

        return super.dispatchKeyEvent(event);
    }

    // ================= Quick keyboard =================

    private void showQuickKeyboard() {
        extendedKeyboardView.setVisibility(View.GONE);
        quickKeyboardView.setVisibility(View.VISIBLE);
        applyImeLayout(findViewById(R.id.root_viewer));
        updateHudOffset();
        quickKeyboardView.post(() -> {
            quickKeyboardView.focusInput();
            applyImeLayout(findViewById(R.id.root_viewer));
            updateHudOffset();
        });
    }

    private void hideQuickKeyboard() {
        quickKeyboardView.hideInput();
        quickKeyboardView.setVisibility(View.GONE);
        applyImeLayout(findViewById(R.id.root_viewer));
        updateHudOffset();
    }

    private void toggleQuickKeyboard() {
        if (quickKeyboardView.getVisibility() == View.VISIBLE) {
            hideQuickKeyboard();
        } else {
            showQuickKeyboard();
        }
    }

    private void updateHudOffset() {
        if (bottomKeyboards == null || floatingHudView == null) return;
        bottomKeyboards.post(() -> {
            boolean isBottomKbVisible = (quickKeyboardView != null && quickKeyboardView.getVisibility() == View.VISIBLE)
                    || (extendedKeyboardView != null && extendedKeyboardView.getVisibility() == View.VISIBLE);
            // Keep noVNC menu button fixed at its default location; hide while typing
            floatingHudView.setTranslationX(0f);
            floatingHudView.setTranslationY(0f);
            floatingHudView.setVisibility(isBottomKbVisible ? View.GONE : View.VISIBLE);
        });
    }

    /**
     * Keeps the remote desktop entirely visible and moved TOP OF the keyboard.
     *
     * When the software keyboard or in-app keyboard bar appears at the bottom
     * of the screen, the content screen (WebView + VirtualTrackpadView) is resized
     * to occupy the remaining vertical height above the keyboard. Because noVNC
     * centers the desktop within the viewport, the remote desktop smoothly moves
     * to the area above the keyboard without any overlap, and without sacrificing
     * horizontal scale in portrait mode.
     */
    private void installImeWatcher() {
        final View root = findViewById(R.id.root_viewer);
        if (root == null) return;

        root.getViewTreeObserver().addOnGlobalLayoutListener(() -> applyImeLayout(root));

        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.post(() -> applyImeLayout(root));
            return insets;
        });
    }

    private void applyImeLayout(View root) {
        if (webView == null || trackpadView == null || bottomKeyboards == null) return;

        int rootWidth = root.getWidth();
        int rootHeight = root.getHeight();
        if (rootWidth <= 0 || rootHeight <= 0) return;

        // Track natural un-shrunk baseline height for the current orientation
        boolean widthChanged = (rootWidth != sessionSurfaceWidth);
        if (widthChanged || sessionSurfaceHeight <= 0) {
            sessionSurfaceWidth = rootWidth;
            sessionSurfaceHeight = rootHeight;
        } else if (rootHeight > sessionSurfaceHeight) {
            sessionSurfaceHeight = rootHeight;
        }

        int imeHeight = imeHeightPx(root);
        boolean windowResizedForIme = rootHeight < sessionSurfaceHeight;

        boolean isBottomKbVisible = (quickKeyboardView != null && quickKeyboardView.getVisibility() == View.VISIBLE)
                || (extendedKeyboardView != null && extendedKeyboardView.getVisibility() == View.VISIBLE);

        int kbBarHeight = 0;
        if (isBottomKbVisible) {
            kbBarHeight = bottomKeyboards.getHeight();
            if (kbBarHeight <= 0) {
                bottomKeyboards.measure(
                        View.MeasureSpec.makeMeasureSpec(rootWidth, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED)
                );
                kbBarHeight = bottomKeyboards.getMeasuredHeight();
            }
        }

        // Lift the keyboard stack exactly onto the IME when the window is not resized
        float wanted = (imeHeight > 0 && !windowResizedForIme) ? -imeHeight : 0f;
        if (bottomKeyboards.getTranslationY() != wanted) {
            bottomKeyboards.setTranslationY(wanted);
        }

        // Compute total obstruction height at the bottom of the screen
        int totalBottomCovered = 0;
        if (windowResizedForIme) {
            totalBottomCovered = (sessionSurfaceHeight - rootHeight) + kbBarHeight;
        } else {
            totalBottomCovered = imeHeight + kbBarHeight;
        }

        // Available vertical space for the remote desktop strictly above the keyboard
        int availableHeight = sessionSurfaceHeight - totalBottomCovered;
        if (availableHeight <= 0) availableHeight = rootHeight;

        // Move the content screen (WebView + trackpadView) TOP OF the keyboard
        applySessionSurfaceHeight(availableHeight);

        // Hide top status bar when typing to avoid cluttering the desktop viewport
        if (hudTopBar != null) {
            boolean hideTopBar = (imeHeight > 0) || (availableHeight < sessionSurfaceHeight * 0.75f && isBottomKbVisible);
            hudTopBar.setVisibility(hideTopBar ? View.GONE : View.VISIBLE);
        }

        updateHudOffset();
    }

    /**
     * Height of the soft keyboard in pixels, or 0 when it is not showing.
     * Uses the modern IME inset when available and falls back to the visible
     * display frame for older releases.
     */
    private int imeHeightPx(View root) {
        int legacy = 0;
        android.graphics.Rect visible = new android.graphics.Rect();
        root.getWindowVisibleDisplayFrame(visible);
        if (visible.bottom > 0) {
            legacy = Math.max(0, root.getRootView().getHeight() - visible.bottom);
        }

        int inset = 0;
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsets wi = root.getRootWindowInsets();
            if (wi != null) {
                inset = wi.getInsets(android.view.WindowInsets.Type.ime()).bottom;
            }
        }

        int ime = Math.max(inset, legacy);
        // Ignore tiny deltas such as the navigation bar.
        return ime > 40 ? ime : 0;
    }

    private void applySessionSurfaceHeight(int heightPx) {
        if (heightPx <= 0) return;

        int targetHeight = (sessionSurfaceHeight > 0 && heightPx >= sessionSurfaceHeight)
                ? ViewGroup.LayoutParams.MATCH_PARENT
                : heightPx;

        ViewGroup.LayoutParams lp = webView.getLayoutParams();
        if (lp != null && lp.height != targetHeight) {
            lp.height = targetHeight;
            webView.setLayoutParams(lp);
            webView.requestLayout();
            runJs("if (window.novnc && window.novnc.relayout) novnc.relayout();");
        }

        lp = trackpadView.getLayoutParams();
        if (lp != null && lp.height != targetHeight) {
            lp.height = targetHeight;
            trackpadView.setLayoutParams(lp);
            trackpadView.requestLayout();
        }
    }

    private void applyMouseMode(boolean trackpad) {
        this.isTrackpadMode = trackpad;
        trackpadView.setVisibility(View.VISIBLE);
        trackpadView.setDirectTouchMode(!trackpad);
        trackpadView.bringToFront();
        trackpadView.requestFocus();

        if (hudTopBar != null) hudTopBar.bringToFront();
        if (bottomKeyboards != null) bottomKeyboards.bringToFront();
        if (floatingHudView != null) {
            floatingHudView.bringToFront();
            floatingHudView.setMouseMode(trackpad);
        }

        runJs("novnc.setTrackpadMode(" + trackpad + ")");
        runJs("novnc.setPointerSensitivity(" + pointerGain + ")");
        runJs("novnc.setPointerAcceleration(" + new AppSettings(this).isPointerAcceleration() + ")");
    }

    private void setStatusIndicator(int color, String text, String resolution) {
        tvHudStatus.setText(text);
        tvHudResolution.setText(resolution);
        GradientDrawable dot = new GradientDrawable();
        dot.setShape(GradientDrawable.OVAL);
        dot.setColor(color);
        statusDot.setBackground(dot);
    }

    // ================= Trackpad =================

    @Override
    public void onPointerMoveRelative(int dx, int dy, int buttonMask) {
        runJs(String.format("novnc.movePointerRelative(%d,%d,%d)", dx, dy, buttonMask));
    }

    @Override
    public void onButtonPress(int mask) {
        runJs(String.format("novnc.mousePress(%d)", mask));
    }

    @Override
    public void onButtonRelease() {
        runJs("novnc.mouseRelease()");
    }

    @Override
    public void onClick(int mask, int count) {
        runJs(String.format("novnc.mouseClick(%d,%d)", mask, count));
    }

    @Override
    public void onScroll(int steps, float focusX, float focusY) {
        float nx = Math.max(0f, Math.min(1f, focusX / Math.max(1, trackpadView.getWidth())));
        float ny = Math.max(0f, Math.min(1f, focusY / Math.max(1, trackpadView.getHeight())));
        runJs(String.format(Locale.US, "novnc.mouseScroll(%d,%.4f,%.4f)", steps, nx, ny));
    }

    @Override
    public void onPinchZoom(float scaleFactor, float focusX, float focusY, float panDx, float panDy) {
        runJs(String.format(Locale.US, "novnc.applyPinchZoom(%.4f,%.1f,%.1f,%.1f,%.1f)",
                scaleFactor, focusX, focusY, panDx, panDy));
    }

    @Override
    public void onResetZoom() {
        runJs("novnc.resetZoom()");
    }

    @Override
    public void onDirectTouchDown(float nx, float ny) {
        runJs(String.format(Locale.US, "novnc.directTouchDown(%.4f,%.4f)", nx, ny));
    }

    @Override
    public void onDirectTouchMove(float nx, float ny) {
        runJs(String.format(Locale.US, "novnc.directTouchMove(%.4f,%.4f)", nx, ny));
    }

    @Override
    public void onDirectTouchUp(float nx, float ny) {
        runJs(String.format(Locale.US, "novnc.directTouchUp(%.4f,%.4f)", nx, ny));
    }

    @Override
    public void onDirectTouchTap(float nx, float ny, int mask) {
        runJs(String.format(Locale.US, "novnc.directTouchTap(%.4f,%.4f,%d)", nx, ny, mask));
    }

    // ================= Extended keyboard =================

    @Override
    public void onKey(int keysym, String code, boolean down) {
        jsKey(keysym, code, down);
    }

    @Override
    public void onSendString(String text) {
        sendText(text, 0);
    }

    @Override
    public void onCloseRequested() {
        extendedKeyboardView.setVisibility(View.GONE);
        applyImeLayout(findViewById(R.id.root_viewer));
        updateHudOffset();
    }

    // ================= HUD =================

    @Override
    public void onToggleQuickKeyboard() {
        toggleQuickKeyboard();
    }

    @Override
    public void onToggleExtendedKeys() {
        quickKeyboardView.hideInput();
        quickKeyboardView.setVisibility(View.GONE);
        if (extendedKeyboardView.getVisibility() == View.VISIBLE) {
            extendedKeyboardView.setVisibility(View.GONE);
        } else {
            extendedKeyboardView.setVisibility(View.VISIBLE);
        }
        applyImeLayout(findViewById(R.id.root_viewer));
        updateHudOffset();
    }

    @Override
    public void onToggleMouseMode() {
        boolean newMode = !isTrackpadMode;
        applyMouseMode(newMode);
        Toast.makeText(this,
                newMode ? "Trackpad mode (Mouse)" : "Direct touch mode",
                Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onToggleScaleMode() {
        if (currentZoom > 1.05f) {
            runJs("novnc.resetZoom()");
            Toast.makeText(this, "Zoom reset to 1.0x", Toast.LENGTH_SHORT).show();
            return;
        }
        isScaleViewport = !isScaleViewport;
        runJs("novnc.setScaleViewport(" + isScaleViewport + ")");
        Toast.makeText(this,
                isScaleViewport ? "Fit to screen" : "1:1 pixels",
                Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onOpenClipboard() {
        ClipboardDialog.show(this, remoteClipboard, text -> {
            runJs("novnc.clipboardPaste(" + JSONObject.quote(text) + ")");
        });
    }

    @Override
    public void onOpenSettings() {
        SessionSettingsDialog.show(
                this,
                isTrackpadMode,
                pointerGain,
                isScaleViewport,
                isViewOnly,
                wakeLock != null && wakeLock.isHeld(),
                qualityLevel,
                compressionLevel,
                this);
    }

    @Override
    public void onDisconnect() {
        confirmDisconnect();
    }

    // ================= Session settings =================

    @Override
    public void onTrackpadModeToggled(boolean enabled) {
        applyMouseMode(enabled);
    }

    @Override
    public void onTrackpadSpeedChanged(float speed) {
        pointerGain = speed;
        runJs("novnc.setPointerSensitivity(" + speed + ")");
        new AppSettings(this).setMouseSpeed(speed);
        Toast.makeText(this, "Mouse speed: " + AppSettings.formatSpeed(speed), Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onInvertScrollToggled(boolean enabled) {
        if (trackpadView != null) {
            trackpadView.setInvertScroll(enabled);
        }
    }

    @Override
    public void onScaleModeToggled(boolean enabled) {
        isScaleViewport = enabled;
        runJs("novnc.setScaleViewport(" + enabled + ")");
    }

    @Override
    public void onViewOnlyToggled(boolean enabled) {
        isViewOnly = enabled;
        runJs("novnc.setViewOnly(" + enabled + ")");
    }

    @Override
    public void onWakeLockToggled(boolean enabled) {
        if (enabled && (wakeLock == null || !wakeLock.isHeld())) {
            setupWakeLock();
        } else if (!enabled && wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    @Override
    public void onQualityChanged(int quality) {
        qualityLevel = quality;
        runJs("novnc.setQuality(" + quality + ")");
    }

    @Override
    public void onCompressionChanged(int compression) {
        compressionLevel = compression;
        runJs("novnc.setCompression(" + compression + ")");
    }

    // ================= Bridge callbacks =================

    synchronized void ensureSessionStarted() {
        if (sessionStarted) return;
        sessionStarted = true;
        Log.d("noVNC-Viewer", "ensureSessionStarted -> dispatching novnc.connect");

        String json = profile.toJson().toString();
        AppSettings settings = new AppSettings(this);
        runJs("if (window.novnc && window.novnc.connect) { " +
                "  novnc.connect(" + json + "); " +
                "  novnc.setTrackpadMode(" + isTrackpadMode + "); " +
                "  novnc.setPointerSensitivity(" + pointerGain + "); " +
                "  novnc.setPointerAcceleration(" + settings.isPointerAcceleration() + "); " +
                "} else { " +
                "  console.error('window.novnc is not defined yet'); " +
                "}");

        startConnectionWatchdog();
    }

    private void startConnectionWatchdog() {
        cancelConnectionWatchdog();
        watchdogRunnable = new WatchdogTask(this);
        watchdogHandler.postDelayed(watchdogRunnable, 10000);
    }

    private void cancelConnectionWatchdog() {
        if (watchdogRunnable != null) {
            watchdogHandler.removeCallbacks(watchdogRunnable);
            watchdogRunnable = null;
        }
    }

    @Override
    public void onPageLoaded() {
        ensureSessionStarted();
    }

    @Override
    public void onConnected(String desktopName, int width, int height) {
        cancelConnectionWatchdog();
        isConnected = true;
        currentZoom = 1.0f;
        String name = (desktopName != null && !desktopName.isEmpty()) ? desktopName : profile.getName();
        baseResolution = (width > 0 && height > 0) ? (width + "x" + height) : "";
        setStatusIndicator(Color.parseColor("#3fb950"), name, baseResolution);

        hudTopBar.postDelayed(() -> hudTopBar.animate().alpha(0.35f).setDuration(500).start(), 4000);
        hudTopBar.setOnClickListener(v -> {
            hudTopBar.animate().alpha(1.0f).setDuration(200).start();
            hudTopBar.postDelayed(() -> hudTopBar.animate().alpha(0.35f).setDuration(500).start(), 3000);
        });
    }

    @Override
    public void onDisconnected(boolean clean, String reason) {
        cancelConnectionWatchdog();
        sessionStarted = false;
        isConnected = false;
        if (isFinishing()) return;

        setStatusIndicator(Color.parseColor("#f85149"), "Disconnected", "");
        hudTopBar.setAlpha(1.0f);

        String msg = (reason != null && !reason.isEmpty())
                ? reason
                : (clean ? "Session closed." : "Connection lost.");

        new AlertDialog.Builder(this, R.style.DarkDialogTheme)
                .setTitle("Disconnected")
                .setMessage(msg)
                .setPositiveButton("Exit", (d, w) -> finish())
                .setNegativeButton("Reconnect", (d, w) -> {
                    setStatusIndicator(Color.parseColor("#d29922"), "Reconnecting…", "");
                    sessionStarted = false;
                    ensureSessionStarted();
                })
                .setCancelable(false)
                .show();
    }

    @Override
    public void onError(String error) {
        Log.e("noVNC-Viewer", "Engine error: " + error);
        if (!isConnected && !isFinishing()) {
            setStatusIndicator(Color.parseColor("#f85149"), "Connection failed", "");
            Toast.makeText(this, "Engine error: " + error, Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onCredentialsRequired() {
        final LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(20 * getResources().getDisplayMetrics().density);
        container.setPadding(pad, pad / 2, pad, 0);

        final EditText input = new EditText(this);
        input.setHint("VNC password");
        input.setInputType(android.text.InputType.TYPE_CLASS_TEXT
                | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        input.setBackgroundResource(R.drawable.bg_edittext);
        container.addView(input);

        final CheckBox remember = new CheckBox(this);
        remember.setText("Remember password");
        remember.setTextColor(Color.WHITE);
        remember.setChecked(profile == null || profile.isRememberPassword());
        container.addView(remember);

        TextView hint = new TextView(this);
        hint.setText("Saved on this device and replayed automatically on reconnect.");
        hint.setTextSize(11);
        hint.setTextColor(Color.parseColor("#8b949e"));
        container.addView(hint);

        new AlertDialog.Builder(this, R.style.DarkDialogTheme)
                .setTitle("Password required")
                .setView(container)
                .setPositiveButton("Unlock", (dialog, which) -> {
                    String pw = input.getText().toString();
                    runJs("novnc.sendCredentials(" + JSONObject.quote(pw) + ")");
                    if (profile != null) {
                        boolean keep = remember.isChecked();
                        profile.setRememberPassword(keep);
                        profile.setPassword(keep ? pw : "");
                        if (keep && !pw.isEmpty()) {
                            new ProfileManager(this).saveProfile(profile);
                            Toast.makeText(this, "Password saved for "
                                    + profile.getName(), Toast.LENGTH_SHORT).show();
                        }
                    }
                })
                .setNegativeButton("Cancel", (dialog, which) -> finish())
                .show();
    }

    @Override
    public void onDesktopName(String name) {
        if (isConnected && name != null && !name.isEmpty()) {
            tvHudStatus.setText(name);
        }
    }

    @Override
    public void onBell() {
        try {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) v.vibrate(100);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onClipboard(String text) {
        remoteClipboard = text;
        Toast.makeText(this, "Remote clipboard updated", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onSecurityFailure(int status, String reason) {
        setStatusIndicator(Color.parseColor("#f85149"), "Auth failure", "");
        Toast.makeText(this, "Authentication failed: " + reason, Toast.LENGTH_LONG).show();
    }

    @Override
    public void onCursorMoved(int x, int y, int maxW, int maxH) {
    }

    @Override
    public void onZoomChanged(float zoom) {
        currentZoom = zoom;
        if (trackpadView != null) {
            trackpadView.setZoomed(zoom > 1.05f);
        }
        if (tvHudResolution != null && isConnected) {
            if (zoom > 1.05f) {
                tvHudResolution.setText(String.format(Locale.US, "%.1fx", zoom));
            } else if (!baseResolution.isEmpty()) {
                tvHudResolution.setText(baseResolution);
            }
        }
    }

    private void confirmDisconnect() {
        new AlertDialog.Builder(this, R.style.DarkDialogTheme)
                .setTitle(R.string.confirm_disconnect_title)
                .setMessage(R.string.confirm_disconnect_message)
                .setPositiveButton("Disconnect", (d, w) -> {
                    runJs("novnc.disconnect()");
                    finish();
                })
                .setNegativeButton("Stay", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (quickKeyboardView.getVisibility() == View.VISIBLE) {
            hideQuickKeyboard();
            return;
        }
        if (extendedKeyboardView.getVisibility() == View.VISIBLE) {
            extendedKeyboardView.setVisibility(View.GONE);
            updateHudOffset();
            return;
        }
        if (floatingHudView.isExpanded()) {
            floatingHudView.collapse();
            return;
        }
        confirmDisconnect();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        cancelConnectionWatchdog();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (webView != null) {
            runJs("novnc.disconnect()");
            webView.destroy();
        }
    }
}
