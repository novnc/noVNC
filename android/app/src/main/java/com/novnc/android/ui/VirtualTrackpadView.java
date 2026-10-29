package com.novnc.android.ui;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.Vibrator;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.View;

/**
 * Full-screen relative touch surface overlaid on the VNC WebView.
 *
 * Implements desktop-grade trackpad touch ergonomics:
 *   one finger move      relative cursor navigation with fine scaling
 *   one finger tap       left click
 *   two finger tap       right click
 *   two finger dbl-tap   reset zoom (when zoomed)
 *   two finger pinch     continuous zoom in / zoom out (like Chrome Remote Desktop)
 *   two finger drag      pan viewport (when zoomed) / scroll wheel (when unzoomed)
 *   three finger tap     middle click
 *   three finger drag    scroll wheel (any zoom state)
 *   double tap + drag    press-and-hold drag (window move / text selection)
 *   long press           right click
 */
public class VirtualTrackpadView extends View implements Runnable {

    public interface TrackpadListener {
        void onPointerMoveRelative(int dx, int dy, int buttonMask);

        void onButtonPress(int mask);

        void onButtonRelease();

        void onClick(int mask, int count);

        void onScroll(int steps, float focusX, float focusY);

        void onPinchZoom(float scaleFactor, float focusX, float focusY, float panDx, float panDy);

        void onResetZoom();

        void onDirectTouchDown(float nx, float ny);

        void onDirectTouchMove(float nx, float ny);

        void onDirectTouchUp(float nx, float ny);

        void onDirectTouchTap(float nx, float ny, int mask);
    }

    private static final long LONG_PRESS_MS = 500;
    private static final long DOUBLE_TAP_MS = 320;
    private static final long TAP_MAX_MS = 350;
    private static final long MULTI_TAP_MAX_MS = 420;

    private TrackpadListener listener;
    private Vibrator vibrator;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private float sensitivity = 1.0f;
    private float tapSlopPx;
    private float doubleTapSlopPx;
    private float scrollStepPx;
    private float pinchSlopPx;

    private boolean isZoomed = false;
    private boolean isDirectTouchMode = false;
    private boolean invertScroll = false;
    private boolean hapticsEnabled = true;

    // Pointer bookkeeping
    private float lastX;
    private float lastY;
    private float downX;
    private float downY;
    private long downTime;
    private boolean moved;
    private boolean multiMoved;

    private boolean twoFinger;
    private boolean threeFinger;
    private boolean suppressUp;

    private boolean dragging;
    private boolean dragMoved;

    // Two-finger gesture tracking (pinch & pan vs two-finger scroll)
    private static final int GESTURE_NONE = 0;
    private static final int GESTURE_SCROLL = 1;
    private static final int GESTURE_PINCH = 2;
    private int twoFingerGesture = GESTURE_NONE;

    private float initialSpan;
    private float lastSpan;
    private float initialFocusX;
    private float initialFocusY;
    private float lastFocusX;
    private float lastFocusY;
    private boolean isPinchingOrPanning;
    private long lastTwoFingerTapTime = 0;

    private float scrollAccum;
    private float multiRefY = Float.NaN;
    private float multiStartY = Float.NaN;

    private long lastTapTime;
    private float lastTapX;
    private float lastTapY;

    // Ripple feedback
    private float rippleX, rippleY, rippleRadius;
    private int rippleAlpha;
    private final Paint ripplePaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private final Runnable longPressRunnable = this;

    /** Long-press handler: right click without releasing the finger. */
    @Override
    public void run() {
        if (moved || twoFinger || threeFinger || dragging) return;
        suppressUp = true;
        feedback(Color.parseColor("#f85149"));
        if (isDirectTouchMode) {
            float nx = Math.max(0f, Math.min(1f, downX / Math.max(1, getWidth())));
            float ny = Math.max(0f, Math.min(1f, downY / Math.max(1, getHeight())));
            if (listener != null) listener.onDirectTouchTap(nx, ny, 4); // right click
        } else {
            if (listener != null) listener.onClick(4, 1); // right click
        }
    }

    public VirtualTrackpadView(Context context) {
        super(context);
        init(context);
    }

    public VirtualTrackpadView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    public VirtualTrackpadView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init(context);
    }

    private void init(Context context) {
        setClickable(true);
        setFocusable(true);
        setFocusableInTouchMode(true);

        float density = getResources().getDisplayMetrics().density;
        tapSlopPx = 12f * density;
        doubleTapSlopPx = 32f * density;
        scrollStepPx = 14f * density;
        pinchSlopPx = 10f * density;

        try {
            vibrator = (Vibrator) context.getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Exception ignored) {
        }

        ripplePaint.setStyle(Paint.Style.STROKE);
        ripplePaint.setStrokeWidth(3.5f * density);
        ripplePaint.setColor(Color.parseColor("#2164F3"));
    }

    public void setTrackpadListener(TrackpadListener listener) {
        this.listener = listener;
    }

    public void setSensitivity(float factor) {
        this.sensitivity = Math.max(0.2f, Math.min(3.0f, factor));
    }

    public float getSensitivity() {
        return sensitivity;
    }

    public void setZoomed(boolean zoomed) {
        this.isZoomed = zoomed;
    }

    public boolean isZoomed() {
        return isZoomed;
    }

    public void setDirectTouchMode(boolean direct) {
        this.isDirectTouchMode = direct;
        reset();
    }

    public boolean isDirectTouchMode() {
        return isDirectTouchMode;
    }

    public void setInvertScroll(boolean invert) {
        this.invertScroll = invert;
    }

    public boolean isInvertScroll() {
        return invertScroll;
    }

    public void setHapticsEnabled(boolean enabled) {
        this.hapticsEnabled = enabled;
    }

    public boolean isHapticsEnabled() {
        return hapticsEnabled;
    }

    public void reset() {
        handler.removeCallbacks(longPressRunnable);
        if (dragging) {
            dragging = false;
            if (isDirectTouchMode) {
                float nx = Math.max(0f, Math.min(1f, lastX / Math.max(1, getWidth())));
                float ny = Math.max(0f, Math.min(1f, lastY / Math.max(1, getHeight())));
                if (listener != null) listener.onDirectTouchUp(nx, ny);
            } else {
                if (listener != null) listener.onButtonRelease();
            }
        }
        twoFinger = false;
        threeFinger = false;
        twoFingerGesture = GESTURE_NONE;
        suppressUp = false;
        isPinchingOrPanning = false;
        lastTapTime = 0;
        rippleAlpha = 0;
        invalidate();
    }

    private void feedback(int color) {
        if (hapticsEnabled && vibrator != null && vibrator.hasVibrator()) {
            try {
                vibrator.vibrate(18);
            } catch (Exception ignored) {
            }
        }
        rippleX = lastX;
        rippleY = lastY;
        rippleRadius = 14;
        rippleAlpha = 210;
        ripplePaint.setColor(color);
        postInvalidateOnAnimation();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (rippleAlpha > 0) {
            ripplePaint.setAlpha(rippleAlpha);
            canvas.drawCircle(rippleX, rippleY, rippleRadius, ripplePaint);
            rippleRadius += 5;
            rippleAlpha -= 22;
            if (rippleAlpha > 0) {
                postInvalidateOnAnimation();
            }
        }
    }

    @Override
    public boolean onTouchEvent(MotionEvent event) {
        switch (event.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                handleDown(event);
                return true;

            case MotionEvent.ACTION_POINTER_DOWN:
                handlePointerDown(event);
                return true;

            case MotionEvent.ACTION_MOVE:
                handleMove(event);
                return true;

            case MotionEvent.ACTION_POINTER_UP:
                handlePointerUp(event);
                return true;

            case MotionEvent.ACTION_UP:
                handleUp(event);
                return true;

            case MotionEvent.ACTION_CANCEL:
                handler.removeCallbacks(longPressRunnable);
                if (dragging) {
                    dragging = false;
                    if (listener != null) listener.onButtonRelease();
                }
                suppressUp = true;
                isPinchingOrPanning = false;
                return true;

            default:
                return super.onTouchEvent(event);
        }
    }

    private void handleDown(MotionEvent event) {
        if (getParent() != null) {
            getParent().requestDisallowInterceptTouchEvent(true);
        }
        lastX = downX = event.getX();
        lastY = downY = event.getY();
        downTime = SystemClock.uptimeMillis();
        moved = false;
        multiMoved = false;
        twoFinger = false;
        threeFinger = false;
        suppressUp = false;
        dragging = false;
        dragMoved = false;
        isPinchingOrPanning = false;
        scrollAccum = 0;
        multiRefY = Float.NaN;
        multiStartY = Float.NaN;

        long sinceTap = downTime - lastTapTime;
        float tapDist = (float) Math.hypot(lastX - lastTapX, lastY - lastTapY);

        if (sinceTap < DOUBLE_TAP_MS && tapDist < doubleTapSlopPx) {
            dragging = true;
            lastTapTime = 0;
            feedback(Color.parseColor("#3fb950"));
            if (isDirectTouchMode) {
                float nx = Math.max(0f, Math.min(1f, downX / Math.max(1, getWidth())));
                float ny = Math.max(0f, Math.min(1f, downY / Math.max(1, getHeight())));
                if (listener != null) listener.onDirectTouchDown(nx, ny);
            } else {
                if (listener != null) listener.onButtonPress(1);
            }
            return;
        }

        handler.postDelayed(longPressRunnable, LONG_PRESS_MS);
    }

    private void handlePointerDown(MotionEvent event) {
        if (getParent() != null) {
            getParent().requestDisallowInterceptTouchEvent(true);
        }
        handler.removeCallbacks(longPressRunnable);
        int count = event.getPointerCount();
        if (count == 2) {
            twoFinger = true;
            moved = true; // cancel the pending single tap
            multiMoved = false;
            twoFingerGesture = GESTURE_NONE;
            isPinchingOrPanning = false;

            float x0 = event.getX(0);
            float y0 = event.getY(0);
            float x1 = event.getX(1);
            float y1 = event.getY(1);

            initialSpan = (float) Math.hypot(x0 - x1, y0 - y1);
            lastSpan = initialSpan;

            initialFocusX = (x0 + x1) / 2f;
            initialFocusY = (y0 + y1) / 2f;
            lastFocusX = initialFocusX;
            lastFocusY = initialFocusY;

            scrollAccum = 0;
        } else if (count >= 3) {
            threeFinger = true;
            multiMoved = false;
            multiRefY = (event.getY(0) + event.getY(1) + event.getY(2)) / 3f;
            multiStartY = multiRefY;
            scrollAccum = 0;
        }
    }

    private void handleMove(MotionEvent event) {
        if (getParent() != null) {
            getParent().requestDisallowInterceptTouchEvent(true);
        }
        int count = event.getPointerCount();

        if (count >= 2) {
            if (count == 2) {
                float x0 = event.getX(0);
                float y0 = event.getY(0);
                float x1 = event.getX(1);
                float y1 = event.getY(1);

                float currentSpan = (float) Math.hypot(x0 - x1, y0 - y1);
                float currentFocusX = (x0 + x1) / 2f;
                float currentFocusY = (y0 + y1) / 2f;

                float spanDelta = Math.abs(currentSpan - initialSpan);
                float focusDist = (float) Math.hypot(currentFocusX - initialFocusX, currentFocusY - initialFocusY);
                float focusDistY = Math.abs(currentFocusY - initialFocusY);

                if (spanDelta > pinchSlopPx || focusDist > tapSlopPx) {
                    multiMoved = true;
                }

                // Disambiguate between two-finger scroll (parallel drag) vs pinch-zoom
                if (twoFingerGesture == GESTURE_NONE && multiMoved) {
                    if (spanDelta >= pinchSlopPx && spanDelta > focusDistY * 0.65f) {
                        twoFingerGesture = GESTURE_PINCH;
                        lastSpan = currentSpan;
                        lastFocusX = currentFocusX;
                        lastFocusY = currentFocusY;
                    } else if (focusDistY >= tapSlopPx && focusDistY > spanDelta * 1.2f) {
                        twoFingerGesture = GESTURE_SCROLL;
                        lastFocusY = currentFocusY;
                        lastFocusX = currentFocusX;
                        scrollAccum = 0;
                    }
                } else if (twoFingerGesture == GESTURE_SCROLL) {
                    if (spanDelta > pinchSlopPx * 1.8f && spanDelta > focusDistY) {
                        twoFingerGesture = GESTURE_PINCH;
                        lastSpan = currentSpan;
                        lastFocusX = currentFocusX;
                        lastFocusY = currentFocusY;
                    }
                }

                if (twoFingerGesture == GESTURE_SCROLL) {
                    float delta = currentFocusY - lastFocusY;
                    lastFocusY = currentFocusY;
                    lastFocusX = currentFocusX;
                    scrollAccum += delta;

                    int loopCount = 0;
                    while (Math.abs(scrollAccum) >= scrollStepPx && loopCount < 20) {
                        loopCount++;
                        int dir = (scrollAccum > 0) ? -1 : 1;
                        int steps = invertScroll ? -dir : dir;
                        if (scrollAccum > 0) {
                            scrollAccum -= scrollStepPx;
                        } else {
                            scrollAccum += scrollStepPx;
                        }
                        if (listener != null) {
                            listener.onScroll(steps, currentFocusX, currentFocusY);
                        }
                    }
                    if (loopCount >= 20) {
                        scrollAccum = 0;
                    }
                } else if (twoFingerGesture == GESTURE_PINCH) {
                    isPinchingOrPanning = true;

                    float scaleFactor = (lastSpan > 10f) ? (currentSpan / lastSpan) : 1.0f;
                    scaleFactor = Math.max(0.6f, Math.min(1.5f, scaleFactor));

                    float panDx = currentFocusX - lastFocusX;
                    float panDy = currentFocusY - lastFocusY;

                    if (listener != null) {
                        listener.onPinchZoom(scaleFactor, currentFocusX, currentFocusY, panDx, panDy);
                    }

                    lastSpan = currentSpan;
                    lastFocusX = currentFocusX;
                    lastFocusY = currentFocusY;
                }
            } else if (count >= 3) {
                // Three fingers: mouse wheel scroll
                float avgY = (event.getY(0) + event.getY(1) + event.getY(2)) / 3f;
                float avgX = (event.getX(0) + event.getX(1) + event.getX(2)) / 3f;
                if (!Float.isNaN(multiRefY)) {
                    float delta = avgY - multiRefY;
                    if (Math.abs(avgY - multiStartY) > tapSlopPx) {
                        multiMoved = true;
                    }
                    scrollAccum += delta;

                    int loopCount = 0;
                    while (Math.abs(scrollAccum) >= scrollStepPx && loopCount < 20) {
                        loopCount++;
                        int dir = (scrollAccum > 0) ? -1 : 1;
                        int steps = invertScroll ? -dir : dir;
                        if (scrollAccum > 0) {
                            scrollAccum -= scrollStepPx;
                        } else {
                            scrollAccum += scrollStepPx;
                        }
                        if (listener != null) listener.onScroll(steps, avgX, avgY);
                    }
                    if (loopCount >= 20) {
                        scrollAccum = 0;
                    }
                }
                multiRefY = avgY;
            }
            moved = true;
            return;
        }

        if (suppressUp || twoFinger) {
            return;
        }

        float x = event.getX();
        float y = event.getY();
        float dx = (x - lastX) * sensitivity;
        float dy = (y - lastY) * sensitivity;

        if (Math.hypot(x - downX, y - downY) > tapSlopPx) {
            moved = true;
            handler.removeCallbacks(longPressRunnable);
        }

        if (isDirectTouchMode) {
            if (moved) {
                lastX = x;
                lastY = y;
                float nx = Math.max(0f, Math.min(1f, x / Math.max(1, getWidth())));
                float ny = Math.max(0f, Math.min(1f, y / Math.max(1, getHeight())));
                if (listener != null) {
                    listener.onDirectTouchMove(nx, ny);
                }
            }
            return;
        }

        int idx = Math.round(dx);
        int idy = Math.round(dy);
        if (idx != 0 || idy != 0) {
            lastX = x;
            lastY = y;
            if (dragging) dragMoved = true;
            if (listener != null) {
                listener.onPointerMoveRelative(idx, idy, dragging ? 1 : 0);
            }
        }
    }

    private void handlePointerUp(MotionEvent event) {
        handler.removeCallbacks(longPressRunnable);
        int count = event.getPointerCount();
        long duration = SystemClock.uptimeMillis() - downTime;

        if (count >= 3 && !multiMoved && duration < MULTI_TAP_MAX_MS) {
            feedback(Color.parseColor("#d29922"));
            if (listener != null) listener.onClick(2, 1); // middle click
        } else if (count == 2 && !multiMoved && duration < MULTI_TAP_MAX_MS) {
            long now = SystemClock.uptimeMillis();
            if (isZoomed && (now - lastTwoFingerTapTime < DOUBLE_TAP_MS)) {
                // Double tap with 2 fingers resets zoom to fit (1.0x)
                feedback(Color.parseColor("#2164F3"));
                if (listener != null) listener.onResetZoom();
                lastTwoFingerTapTime = 0;
            } else {
                feedback(Color.parseColor("#f85149"));
                if (isDirectTouchMode) {
                    float nx = Math.max(0f, Math.min(1f, downX / Math.max(1, getWidth())));
                    float ny = Math.max(0f, Math.min(1f, downY / Math.max(1, getHeight())));
                    if (listener != null) listener.onDirectTouchTap(nx, ny, 4); // right click
                } else {
                    if (listener != null) listener.onClick(4, 1); // right click
                }
                lastTwoFingerTapTime = now;
            }
        }

        suppressUp = true;
        moved = true;

        int remaining = (event.getActionIndex() == 0) ? 1 : 0;
        if (remaining < count) {
            lastX = event.getX(remaining);
            lastY = event.getY(remaining);
        }
        multiRefY = Float.NaN;
        multiStartY = Float.NaN;
        isPinchingOrPanning = false;
        twoFingerGesture = GESTURE_NONE;
    }

    private void handleUp(MotionEvent event) {
        handler.removeCallbacks(longPressRunnable);
        long duration = SystemClock.uptimeMillis() - downTime;

        if (isDirectTouchMode) {
            twoFingerGesture = GESTURE_NONE;
            float x = event.getX();
            float y = event.getY();
            float nx = Math.max(0f, Math.min(1f, x / Math.max(1, getWidth())));
            float ny = Math.max(0f, Math.min(1f, y / Math.max(1, getHeight())));

            if (!moved && !suppressUp && duration < TAP_MAX_MS) {
                feedback(Color.parseColor("#2164F3"));
                if (listener != null) {
                    listener.onDirectTouchTap(nx, ny, 1);
                }
                lastTapTime = SystemClock.uptimeMillis();
                lastTapX = x;
                lastTapY = y;
            } else {
                if (listener != null) {
                    listener.onDirectTouchUp(nx, ny);
                }
                lastTapTime = 0;
            }
            return;
        }

        twoFingerGesture = GESTURE_NONE;
        if (dragging) {
            dragging = false;
            if (!dragMoved) {
                feedback(Color.parseColor("#2164F3"));
            }
            if (listener != null) listener.onButtonRelease();
            lastTapTime = 0;
            return;
        }

        if (!moved && !suppressUp && duration < TAP_MAX_MS) {
            feedback(Color.parseColor("#2164F3"));
            if (listener != null) listener.onClick(1, 1);
            lastTapTime = SystemClock.uptimeMillis();
            lastTapX = event.getX();
            lastTapY = event.getY();
            return;
        }

        lastTapTime = 0;
    }
}
