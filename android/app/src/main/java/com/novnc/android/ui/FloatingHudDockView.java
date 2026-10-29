package com.novnc.android.ui;

import android.content.Context;
import android.graphics.Color;
import android.util.AttributeSet;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.novnc.android.R;

public class FloatingHudDockView extends FrameLayout {

    public interface HudActionListener {
        /** Opens (or closes) the quick keyboard popup that types into the remote. */
        void onToggleQuickKeyboard();

        void onToggleExtendedKeys();
        void onToggleMouseMode();
        void onToggleScaleMode();
        void onOpenClipboard();
        void onSendCtrlAltDel();
        void onOpenSettings();
        void onDisconnect();
    }

    private HudActionListener listener;
    private boolean isExpanded = false;

    private LinearLayout pillButton;
    private TextView tvPillLabel;
    private HorizontalScrollView scrollExpandedMenu;
    private LinearLayout layoutExpandedMenu;
    private Button btnMouseMode;

    public FloatingHudDockView(Context context) {
        super(context);
        init(context);
    }

    public FloatingHudDockView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    public FloatingHudDockView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init(context);
    }

    public void setHudActionListener(HudActionListener listener) {
        this.listener = listener;
    }

    private void init(Context context) {
        // Collapsed Pill Button: fixed at default bottom-right location
        pillButton = new LinearLayout(context);
        pillButton.setOrientation(LinearLayout.HORIZONTAL);
        pillButton.setGravity(Gravity.CENTER_VERTICAL);
        pillButton.setBackgroundResource(R.drawable.bg_pill);
        pillButton.setElevation(dpToPx(6));
        pillButton.setClickable(true);
        pillButton.setFocusable(true);
        int padH = dpToPx(14);
        int padV = dpToPx(8);
        pillButton.setPadding(padH, padV, padH, padV);

        FrameLayout.LayoutParams lpPill = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.END
        );
        pillButton.setLayoutParams(lpPill);

        tvPillLabel = new TextView(context);
        tvPillLabel.setText("⚡ noVNC");
        tvPillLabel.setTextColor(Color.WHITE);
        tvPillLabel.setTextSize(13);
        tvPillLabel.setTypeface(null, android.graphics.Typeface.BOLD);
        pillButton.addView(tvPillLabel);

        // Expanded Horizontal Menu: opens docked to bottom-right
        scrollExpandedMenu = new HorizontalScrollView(context);
        scrollExpandedMenu.setHorizontalScrollBarEnabled(false);
        scrollExpandedMenu.setBackgroundResource(R.drawable.bg_hud_dock);
        scrollExpandedMenu.setElevation(dpToPx(8));
        scrollExpandedMenu.setVisibility(View.GONE);

        FrameLayout.LayoutParams lpMenu = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.END
        );
        scrollExpandedMenu.setLayoutParams(lpMenu);

        layoutExpandedMenu = new LinearLayout(context);
        layoutExpandedMenu.setOrientation(LinearLayout.HORIZONTAL);
        layoutExpandedMenu.setGravity(Gravity.CENTER_VERTICAL);
        int padM = dpToPx(4);
        layoutExpandedMenu.setPadding(padM, padM, padM, padM);

        // Leading pill in expanded menu to collapse back
        Button btnCollapseHead = new Button(context);
        btnCollapseHead.setText("⚡ noVNC ✕");
        btnCollapseHead.setTextSize(12);
        btnCollapseHead.setTextColor(Color.WHITE);
        btnCollapseHead.setBackgroundResource(R.drawable.bg_button_secondary);
        LinearLayout.LayoutParams lpH = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(36)
        );
        lpH.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btnCollapseHead.setLayoutParams(lpH);
        btnCollapseHead.setPadding(dpToPx(10), 0, dpToPx(10), 0);
        btnCollapseHead.setOnClickListener(v -> collapse());
        layoutExpandedMenu.addView(btnCollapseHead);

        // Add action buttons to expanded menu
        layoutExpandedMenu.addView(createMenuButton("⌨ Keyboard", () -> {
            if (listener != null) listener.onToggleQuickKeyboard();
        }));

        layoutExpandedMenu.addView(createMenuButton("🎛 Keys", () -> {
            if (listener != null) listener.onToggleExtendedKeys();
        }));

        btnMouseMode = createMenuButton("🖱 Mouse Mode", () -> {
            if (listener != null) listener.onToggleMouseMode();
        });
        layoutExpandedMenu.addView(btnMouseMode);

        layoutExpandedMenu.addView(createMenuButton("🔲 Scale/Fit", () -> {
            if (listener != null) listener.onToggleScaleMode();
        }));

        layoutExpandedMenu.addView(createMenuButton("📋 Clipboard", () -> {
            if (listener != null) listener.onOpenClipboard();
        }));

        layoutExpandedMenu.addView(createMenuButton("⚡ CAD", () -> {
            if (listener != null) listener.onSendCtrlAltDel();
        }));

        layoutExpandedMenu.addView(createMenuButton("⚙ Settings", () -> {
            if (listener != null) listener.onOpenSettings();
        }));

        // Disconnect button
        Button btnDisc = new Button(context);
        btnDisc.setText("🚪 Disconnect");
        btnDisc.setTextSize(12);
        btnDisc.setTextColor(Color.parseColor("#f85149"));
        btnDisc.setBackgroundResource(R.drawable.bg_button_danger);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(36)
        );
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btnDisc.setLayoutParams(lp);
        btnDisc.setPadding(dpToPx(12), 0, dpToPx(12), 0);
        btnDisc.setOnClickListener(v -> {
            collapse();
            if (listener != null) listener.onDisconnect();
        });
        layoutExpandedMenu.addView(btnDisc);

        // Trailing close button
        Button btnClose = new Button(context);
        btnClose.setText("✕");
        btnClose.setTextSize(14);
        btnClose.setTextColor(Color.WHITE);
        btnClose.setBackgroundResource(R.drawable.bg_button_secondary);
        LinearLayout.LayoutParams lpClose = new LinearLayout.LayoutParams(
            dpToPx(36),
            dpToPx(36)
        );
        lpClose.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btnClose.setLayoutParams(lpClose);
        btnClose.setOnClickListener(v -> collapse());
        layoutExpandedMenu.addView(btnClose);

        scrollExpandedMenu.addView(layoutExpandedMenu);

        addView(pillButton);
        addView(scrollExpandedMenu);

        // Click listener for the pill button (position is fixed, cannot be dragged)
        pillButton.setOnClickListener(v -> expand());
    }

    private Button createMenuButton(String label, Runnable action) {
        Button btn = new Button(getContext());
        btn.setText(label);
        btn.setTextSize(12);
        btn.setTextColor(Color.WHITE);
        btn.setBackgroundResource(R.drawable.bg_button_secondary);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(36)
        );
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btn.setLayoutParams(lp);
        btn.setPadding(dpToPx(12), 0, dpToPx(12), 0);
        btn.setOnClickListener(v -> {
            collapse();
            if (action != null) action.run();
        });
        return btn;
    }

    public void expand() {
        isExpanded = true;

        pillButton.animate().cancel();
        scrollExpandedMenu.animate().cancel();
        pillButton.animate().setListener(null);
        scrollExpandedMenu.animate().setListener(null);

        pillButton.setVisibility(View.GONE);
        pillButton.setAlpha(1f);

        scrollExpandedMenu.setVisibility(View.VISIBLE);
        scrollExpandedMenu.setAlpha(1f);
        scrollExpandedMenu.scrollTo(0, 0);
    }

    public void collapse() {
        isExpanded = false;

        pillButton.animate().cancel();
        scrollExpandedMenu.animate().cancel();
        pillButton.animate().setListener(null);
        scrollExpandedMenu.animate().setListener(null);

        scrollExpandedMenu.setVisibility(View.GONE);
        scrollExpandedMenu.setAlpha(1f);

        pillButton.setVisibility(View.VISIBLE);
        pillButton.setAlpha(1f);
    }

    public void toggle() {
        if (isExpanded) {
            collapse();
        } else {
            expand();
        }
    }

    public boolean isExpanded() {
        return isExpanded;
    }

    public void setMouseMode(boolean trackpad) {
        if (btnMouseMode != null) {
            btnMouseMode.setText(trackpad ? "🖱 Mouse Mode" : "👆 Direct Touch");
        }
    }

    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }
}
