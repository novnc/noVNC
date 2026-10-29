package com.novnc.android.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Color;
import android.util.AttributeSet;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.novnc.android.R;
import com.novnc.android.util.KeySyms;

public class ExtendedKeyboardView extends LinearLayout {

    public interface OnKeyEventListener {
        void onKey(int keysym, String code, boolean down);
        void onSendString(String text);
        void onSendCtrlAltDel();
        void onCloseRequested();
    }

    private OnKeyEventListener listener;

    private boolean ctrlActive = false;
    private boolean altActive = false;
    private boolean shiftActive = false;
    private boolean superActive = false;

    private Button btnCtrl;
    private Button btnAlt;
    private Button btnShift;
    private Button btnSuper;

    public ExtendedKeyboardView(Context context) {
        super(context);
        init(context);
    }

    public ExtendedKeyboardView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    public ExtendedKeyboardView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init(context);
    }

    public void setOnKeyEventListener(OnKeyEventListener listener) {
        this.listener = listener;
    }

    private void init(Context context) {
        setOrientation(VERTICAL);
        setBackgroundColor(Color.parseColor("#EE161b22"));
        int pad = dpToPx(6);
        setPadding(pad, pad, pad, pad);

        // Top Row: Sticky Modifiers & Quick Actions
        HorizontalScrollView scrollRow1 = new HorizontalScrollView(context);
        scrollRow1.setHorizontalScrollBarEnabled(false);
        LinearLayout row1 = new LinearLayout(context);
        row1.setOrientation(HORIZONTAL);
        row1.setGravity(Gravity.CENTER_VERTICAL);

        btnCtrl = createModifierButton(context, "Ctrl", KeySyms.XK_Control_L, "ControlLeft");
        btnAlt = createModifierButton(context, "Alt", KeySyms.XK_Alt_L, "AltLeft");
        btnShift = createModifierButton(context, "Shift", KeySyms.XK_Shift_L, "ShiftLeft");
        btnSuper = createModifierButton(context, "Win", KeySyms.XK_Super_L, "MetaLeft");

        row1.addView(btnCtrl);
        row1.addView(btnAlt);
        row1.addView(btnShift);
        row1.addView(btnSuper);

        row1.addView(createKeyButton(context, "Esc", KeySyms.XK_Escape, "Escape"));
        row1.addView(createKeyButton(context, "Tab", KeySyms.XK_Tab, "Tab"));
        row1.addView(createKeyButton(context, "Del", KeySyms.XK_Delete, "Delete"));
        row1.addView(createKeyButton(context, "Enter", KeySyms.XK_Return, "Enter"));

        // Instant shortcuts
        Button btnCad = createSpecialButton(context, "Ctrl+Alt+Del", () -> {
            if (listener != null) listener.onSendCtrlAltDel();
        });
        row1.addView(btnCad);

        Button btnText = createSpecialButton(context, "⌨ Send Text", this::showTextInputDialog);
        row1.addView(btnText);

        Button btnClose = createSpecialButton(context, "✕", () -> {
            if (listener != null) listener.onCloseRequested();
        });
        row1.addView(btnClose);

        scrollRow1.addView(row1);
        addView(scrollRow1);

        // Bottom Row: Navigation Arrows & Function Keys F1-F12
        HorizontalScrollView scrollRow2 = new HorizontalScrollView(context);
        scrollRow2.setHorizontalScrollBarEnabled(false);
        scrollRow2.setPadding(0, dpToPx(4), 0, 0);
        LinearLayout row2 = new LinearLayout(context);
        row2.setOrientation(HORIZONTAL);
        row2.setGravity(Gravity.CENTER_VERTICAL);

        // Arrow cluster
        row2.addView(createKeyButton(context, "▲", KeySyms.XK_Up, "ArrowUp"));
        row2.addView(createKeyButton(context, "▼", KeySyms.XK_Down, "ArrowDown"));
        row2.addView(createKeyButton(context, "◄", KeySyms.XK_Left, "ArrowLeft"));
        row2.addView(createKeyButton(context, "►", KeySyms.XK_Right, "ArrowRight"));

        row2.addView(createKeyButton(context, "Home", KeySyms.XK_Home, "Home"));
        row2.addView(createKeyButton(context, "End", KeySyms.XK_End, "End"));
        row2.addView(createKeyButton(context, "PgUp", KeySyms.XK_Prior, "PageUp"));
        row2.addView(createKeyButton(context, "PgDn", KeySyms.XK_Next, "PageDown"));

        // Function Keys F1 - F12
        int[] fKeys = {
            KeySyms.XK_F1, KeySyms.XK_F2, KeySyms.XK_F3, KeySyms.XK_F4,
            KeySyms.XK_F5, KeySyms.XK_F6, KeySyms.XK_F7, KeySyms.XK_F8,
            KeySyms.XK_F9, KeySyms.XK_F10, KeySyms.XK_F11, KeySyms.XK_F12
        };
        for (int i = 0; i < fKeys.length; i++) {
            final int keysym = fKeys[i];
            final String name = "F" + (i + 1);
            row2.addView(createKeyButton(context, name, keysym, name));
        }

        scrollRow2.addView(row2);
        addView(scrollRow2);
    }

    private Button createModifierButton(Context context, String label, int keysym, String code) {
        Button btn = new Button(context);
        btn.setText(label);
        btn.setTextSize(12);
        btn.setTextColor(Color.WHITE);
        btn.setBackgroundResource(R.drawable.bg_key_button);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(38)
        );
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btn.setLayoutParams(lp);
        btn.setPadding(dpToPx(10), 0, dpToPx(10), 0);

        btn.setOnClickListener(v -> {
            boolean newState;
            if (label.equals("Ctrl")) {
                ctrlActive = !ctrlActive;
                newState = ctrlActive;
            } else if (label.equals("Alt")) {
                altActive = !altActive;
                newState = altActive;
            } else if (label.equals("Shift")) {
                shiftActive = !shiftActive;
                newState = shiftActive;
            } else {
                superActive = !superActive;
                newState = superActive;
            }
            btn.setSelected(newState);
            if (listener != null) {
                listener.onKey(keysym, code, newState);
            }
        });
        return btn;
    }

    private Button createKeyButton(Context context, String label, int keysym, String code) {
        Button btn = new Button(context);
        btn.setText(label);
        btn.setTextSize(12);
        btn.setTextColor(Color.WHITE);
        btn.setBackgroundResource(R.drawable.bg_key_button);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(38)
        );
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btn.setLayoutParams(lp);
        btn.setPadding(dpToPx(10), 0, dpToPx(10), 0);

        btn.setOnClickListener(v -> {
            if (listener != null) {
                listener.onKey(keysym, code, true);
                postDelayed(() -> {
                    if (listener != null) {
                        listener.onKey(keysym, code, false);
                    }
                    releaseOneShotModifiers();
                }, 50);
            }
        });
        return btn;
    }

    private Button createSpecialButton(Context context, String label, Runnable action) {
        Button btn = new Button(context);
        btn.setText(label);
        btn.setTextSize(12);
        btn.setTextColor(Color.parseColor("#58a6ff"));
        btn.setBackgroundResource(R.drawable.bg_key_button);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            dpToPx(38)
        );
        lp.setMargins(dpToPx(3), 0, dpToPx(3), 0);
        btn.setLayoutParams(lp);
        btn.setPadding(dpToPx(10), 0, dpToPx(10), 0);
        btn.setOnClickListener(v -> action.run());
        return btn;
    }

    private void releaseOneShotModifiers() {
        // If modifiers were active, we keep them active if the user toggled them,
        // or user can tap again to release.
    }

    public void releaseAllModifiers() {
        if (ctrlActive) {
            ctrlActive = false;
            btnCtrl.setSelected(false);
            if (listener != null) listener.onKey(KeySyms.XK_Control_L, "ControlLeft", false);
        }
        if (altActive) {
            altActive = false;
            btnAlt.setSelected(false);
            if (listener != null) listener.onKey(KeySyms.XK_Alt_L, "AltLeft", false);
        }
        if (shiftActive) {
            shiftActive = false;
            btnShift.setSelected(false);
            if (listener != null) listener.onKey(KeySyms.XK_Shift_L, "ShiftLeft", false);
        }
        if (superActive) {
            superActive = false;
            btnSuper.setSelected(false);
            if (listener != null) listener.onKey(KeySyms.XK_Super_L, "MetaLeft", false);
        }
    }

    private void showTextInputDialog() {
        Context context = getContext();
        AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.DarkDialogTheme);
        builder.setTitle("Send Text to Remote Desktop");

        final EditText input = new EditText(context);
        input.setHint("Type text or shell command...");
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(Color.GRAY);
        input.setBackgroundResource(R.drawable.bg_edittext);
        int pad = dpToPx(12);
        input.setPadding(pad, pad, pad, pad);

        LinearLayout container = new LinearLayout(context);
        container.setOrientation(VERTICAL);
        container.setPadding(pad, pad, pad, pad);
        container.addView(input);
        builder.setView(container);

        builder.setPositiveButton("Send", (dialog, which) -> {
            String text = input.getText().toString();
            if (listener != null && !text.isEmpty()) {
                listener.onSendString(text);
            }
        });

        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss());
        builder.show();
    }

    private int dpToPx(int dp) {
        float density = getResources().getDisplayMetrics().density;
        return Math.round(dp * density);
    }
}
