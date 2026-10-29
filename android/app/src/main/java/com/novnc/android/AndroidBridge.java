package com.novnc.android;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;

public class AndroidBridge {
    private static final String TAG = "noVNC-AndroidBridge";

    public interface BridgeListener {
        void onPageLoaded();
        void onConnected(String desktopName, int width, int height);
        void onDisconnected(boolean clean, String reason);
        void onCredentialsRequired();
        void onDesktopName(String name);
        void onBell();
        void onClipboard(String text);
        void onSecurityFailure(int status, String reason);
        void onCursorMoved(int x, int y, int maxW, int maxH);
        void onError(String error);
        void onZoomChanged(float zoom);
    }

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private BridgeListener listener;

    public void setListener(BridgeListener listener) {
        this.listener = listener;
    }

    @JavascriptInterface
    public void onPageLoaded() {
        mainHandler.post(() -> {
            if (listener != null) listener.onPageLoaded();
        });
    }

    @JavascriptInterface
    public void onConnected(String desktopName, int width, int height) {
        mainHandler.post(() -> {
            if (listener != null) listener.onConnected(desktopName, width, height);
        });
    }

    @JavascriptInterface
    public void onDisconnected(boolean clean, String reason) {
        mainHandler.post(() -> {
            if (listener != null) listener.onDisconnected(clean, reason);
        });
    }

    @JavascriptInterface
    public void onCredentialsRequired() {
        mainHandler.post(() -> {
            if (listener != null) listener.onCredentialsRequired();
        });
    }

    @JavascriptInterface
    public void onDesktopName(String name) {
        mainHandler.post(() -> {
            if (listener != null) listener.onDesktopName(name);
        });
    }

    @JavascriptInterface
    public void onBell() {
        mainHandler.post(() -> {
            if (listener != null) listener.onBell();
        });
    }

    @JavascriptInterface
    public void onClipboard(String text) {
        mainHandler.post(() -> {
            if (listener != null) listener.onClipboard(text);
        });
    }

    @JavascriptInterface
    public void onSecurityFailure(int status, String reason) {
        mainHandler.post(() -> {
            if (listener != null) listener.onSecurityFailure(status, reason);
        });
    }

    @JavascriptInterface
    public void onCursorMoved(int x, int y, int maxW, int maxH) {
        mainHandler.post(() -> {
            if (listener != null) listener.onCursorMoved(x, y, maxW, maxH);
        });
    }

    @JavascriptInterface
    public void onError(String error) {
        mainHandler.post(() -> {
            if (listener != null) listener.onError(error);
        });
    }

    @JavascriptInterface
    public void onZoomChanged(double zoom) {
        mainHandler.post(() -> {
            if (listener != null) listener.onZoomChanged((float) zoom);
        });
    }

    @JavascriptInterface
    public void log(String tag, String msg) {
        Log.d(TAG, "[" + tag + "] " + msg);
    }
}
