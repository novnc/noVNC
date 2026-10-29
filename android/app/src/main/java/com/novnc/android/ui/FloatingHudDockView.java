package com.novnc.android.ui;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.util.AttributeSet;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.ImageView;
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
        pillButton.setBackgroundResource(R.drawable.bg_card);
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

        ImageView pillMark = new ImageView(context);
        pillMark.setImageResource(R.drawable.ic_bolt);
        pillMark.setColorFilter(Color.parseColor("#EAA817"), PorterDuff.Mode.SRC_IN);
        LinearLayout.LayoutParams markLp = new LinearLayout.LayoutParams(dpToPx(22), dpToPx(22));
        markLp.setMarginEnd(dpToPx(7));
        pillButton.addView(pillMark, markLp);

        tvPillLabel = new TextView(context);
        tvPillLabel.setText("noVNC");
        tvPillLabel.setTextColor(Color.parseColor("#16243A"));
        tvPillLabel.setTextSize(14);
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

        // Leading compact brand mark collapses the menu
        ImageButton btnCollapseHead = createIconButton(R.drawable.ic_bolt, "Collapse menu", false);
        btnCollapseHead.setColorFilter(Color.parseColor("#EAA817"), PorterDuff.Mode.SRC_IN);
        btnCollapseHead.setOnClickListener(v -> collapse());
        layoutExpandedMenu.addView(btnCollapseHead);

        // Add action buttons to expanded menu
        layoutExpandedMenu.addView(createMenuButton(R.drawable.ic_keyboard, "Keyboard", () -> {
            if (listener != null) listener.onToggleQuickKeyboard();
        }));
        layoutExpandedMenu.addView(createMenuButton(R.drawable.ic_settings, "Keys", () -> {
            if (listener != null) listener.onToggleExtendedKeys();
        }));

        btnMouseMode = createMenuButton(R.drawable.ic_mouse, "Trackpad", () -> {
            if (listener != null) listener.onToggleMouseMode();
        });
        layoutExpandedMenu.addView(btnMouseMode);
        layoutExpandedMenu.addView(createMenuButton(R.drawable.ic_scale, "Scale/Fit", () -> {
            if (listener != null) listener.onToggleScaleMode();
        }));
        layoutExpandedMenu.addView(createMenuButton(R.drawable.ic_clipboard, "Clipboard", () -> {
            if (listener != null) listener.onOpenClipboard();
        }));
        layoutExpandedMenu.addView(createMenuButton(R.drawable.ic_cad, "Ctrl Alt Delete", () -> {
            if (listener != null) listener.onSendCtrlAltDel();
        }));
        layoutExpandedMenu.addView(createMenuButton(R.drawable.ic_settings, "Settings", () -> {
            if (listener != null) listener.onOpenSettings();
        }));

        Button btnDisc = createMenuButton(R.drawable.ic_close, "Disconnect", () -> {
            if (listener != null) listener.onDisconnect();
        });
        btnDisc.setOnClickListener(v -> {
            collapse();
            if (listener != null) listener.onDisconnect();
        });
        layoutExpandedMenu.addView(btnDisc);

        ImageButton btnClose = createIconButton(R.drawable.ic_close, "Close menu", false);
        btnClose.setOnClickListener(v -> collapse());
        layoutExpandedMenu.addView(btnClose);

        scrollExpandedMenu.addView(layoutExpandedMenu);

        addView(pillButton);
        addView(scrollExpandedMenu);

        // Click listener for the pill button (position is fixed, cannot be dragged)
        pillButton.setOnClickListener(v -> expand());
    }

    private Button createMenuButton(int iconRes, String label, Runnable action) {
        Button btn = new Button(getContext());
        btn.setText(label);
        btn.setTextSize(12);
        btn.setTextColor(Color.parseColor("#24344D"));
        btn.setAllCaps(false);
        btn.setBackgroundResource(R.drawable.bg_button_secondary);
        btn.setCompoundDrawablesWithIntrinsicBounds(iconRes, 0, 0, 0);
        btn.setCompoundDrawableTintList(android.content.res.ColorStateList.valueOf(Color.parseColor("#2164F3")));
        btn.setCompoundDrawablePadding(dpToPx(6));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(44)
        );
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btn.setLayoutParams(lp);
        btn.setPadding(dpToPx(10), 0, dpToPx(10), 0);
        btn.setContentDescription(label);
        btn.setOnClickListener(v -> {
            collapse();
            if (action != null) action.run();
        });
        return btn;
    }

    private ImageButton createIconButton(int iconRes, String description, boolean danger) {
        ImageButton button = new ImageButton(getContext());
        button.setImageResource(iconRes);
        button.setColorFilter(danger ? Color.parseColor("#BE3A46") : Color.parseColor("#52647E"), PorterDuff.Mode.SRC_IN);
        button.setBackgroundResource(danger ? R.drawable.bg_button_danger : R.drawable.bg_button_secondary);
        button.setContentDescription(description);
        button.setPadding(dpToPx(11), dpToPx(11), dpToPx(11), dpToPx(11));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dpToPx(44), dpToPx(44));
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        button.setLayoutParams(lp);
        return button;
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
            btnMouseMode.setText(trackpad ? "Trackpad" : "Direct Touch");
            btnMouseMode.setCompoundDrawablesWithIntrinsicBounds(trackpad ? R.drawable.ic_mouse : R.drawable.ic_touch, 0, 0, 0);
            btnMouseMode.setContentDescription(trackpad ? "Trackpad mode; tap to switch to direct touch" : "Direct touch mode; tap to switch to trackpad");
        }
    }

    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }
}
