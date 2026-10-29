package com.novnc.android;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.Locale;

public class AppSettings {
    private static final String PREF_NAME = "novnc_app_settings";

    public static final String KEY_MOUSE_SPEED = "mouse_speed";
    public static final String KEY_POINTER_ACCEL = "pointer_acceleration";
    public static final String KEY_TRACKPAD_MODE = "default_trackpad_mode";
    public static final String KEY_SCALE_VIEWPORT = "default_scale_viewport";
    public static final String KEY_KEEP_AWAKE = "keep_screen_awake";
    public static final String KEY_HAPTICS = "haptics_enabled";
    public static final String KEY_INVERT_SCROLL = "invert_scroll";
    public static final String KEY_QUALITY = "default_quality";
    public static final String KEY_COMPRESSION = "default_compression";

    public static final float DEFAULT_MOUSE_SPEED = 0.4f;
    public static final boolean DEFAULT_POINTER_ACCEL = true;
    public static final boolean DEFAULT_TRACKPAD_MODE = true;
    public static final boolean DEFAULT_SCALE_VIEWPORT = true;
    public static final boolean DEFAULT_KEEP_AWAKE = true;
    public static final boolean DEFAULT_HAPTICS = true;
    public static final boolean DEFAULT_INVERT_SCROLL = false;
    public static final int DEFAULT_QUALITY = 6;
    public static final int DEFAULT_COMPRESSION = 2;

    private final SharedPreferences prefs;

    public AppSettings(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean("speed_default_04_applied", false)) {
            float current = prefs.getFloat(KEY_MOUSE_SPEED, -1f);
            if (current == -1f || Math.abs(current - 1.0f) < 0.05f) {
                prefs.edit().putFloat(KEY_MOUSE_SPEED, DEFAULT_MOUSE_SPEED).apply();
            }
            prefs.edit().putBoolean("speed_default_04_applied", true).apply();
        }
    }

    public float getMouseSpeed() {
        return prefs.getFloat(KEY_MOUSE_SPEED, DEFAULT_MOUSE_SPEED);
    }

    public void setMouseSpeed(float speed) {
        prefs.edit().putFloat(KEY_MOUSE_SPEED, Math.max(0.2f, Math.min(3.0f, speed))).apply();
    }

    public boolean isPointerAcceleration() {
        return prefs.getBoolean(KEY_POINTER_ACCEL, DEFAULT_POINTER_ACCEL);
    }

    public void setPointerAcceleration(boolean enabled) {
        prefs.edit().putBoolean(KEY_POINTER_ACCEL, enabled).apply();
    }

    public boolean isDefaultTrackpadMode() {
        return prefs.getBoolean(KEY_TRACKPAD_MODE, DEFAULT_TRACKPAD_MODE);
    }

    public void setDefaultTrackpadMode(boolean trackpad) {
        prefs.edit().putBoolean(KEY_TRACKPAD_MODE, trackpad).apply();
    }

    public boolean isScaleViewport() {
        return prefs.getBoolean(KEY_SCALE_VIEWPORT, DEFAULT_SCALE_VIEWPORT);
    }

    public void setScaleViewport(boolean scale) {
        prefs.edit().putBoolean(KEY_SCALE_VIEWPORT, scale).apply();
    }

    public boolean isKeepScreenAwake() {
        return prefs.getBoolean(KEY_KEEP_AWAKE, DEFAULT_KEEP_AWAKE);
    }

    public void setKeepScreenAwake(boolean awake) {
        prefs.edit().putBoolean(KEY_KEEP_AWAKE, awake).apply();
    }

    public boolean isHapticsEnabled() {
        return prefs.getBoolean(KEY_HAPTICS, DEFAULT_HAPTICS);
    }

    public void setHapticsEnabled(boolean enabled) {
        prefs.edit().putBoolean(KEY_HAPTICS, enabled).apply();
    }

    public boolean isInvertScroll() {
        return prefs.getBoolean(KEY_INVERT_SCROLL, DEFAULT_INVERT_SCROLL);
    }

    public void setInvertScroll(boolean invert) {
        prefs.edit().putBoolean(KEY_INVERT_SCROLL, invert).apply();
    }

    public int getQualityLevel() {
        return prefs.getInt(KEY_QUALITY, DEFAULT_QUALITY);
    }

    public void setQualityLevel(int quality) {
        prefs.edit().putInt(KEY_QUALITY, quality).apply();
    }

    public int getCompressionLevel() {
        return prefs.getInt(KEY_COMPRESSION, DEFAULT_COMPRESSION);
    }

    public void setCompressionLevel(int compression) {
        prefs.edit().putInt(KEY_COMPRESSION, compression).apply();
    }

    public void resetToDefaults() {
        prefs.edit().clear().apply();
    }

    public static String formatSpeed(float speed) {
        if (speed <= 0.45f) {
            return String.format(Locale.US, "%.1fx (Precision - Default)", speed);
        } else if (speed <= 0.75f) {
            return String.format(Locale.US, "%.1fx (Slow)", speed);
        } else if (speed >= 0.95f && speed <= 1.05f) {
            return "1.0x (Normal)";
        } else if (speed <= 1.55f) {
            return String.format(Locale.US, "%.1fx (Fast)", speed);
        } else if (speed <= 2.25f) {
            return String.format(Locale.US, "%.1fx (Very Fast)", speed);
        } else {
            return String.format(Locale.US, "%.1fx (Maximum)", speed);
        }
    }
}
