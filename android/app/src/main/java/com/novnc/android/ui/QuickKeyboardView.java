package com.novnc.android.ui;

import android.content.Context;
import android.graphics.Color;
import android.util.AttributeSet;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;

import com.novnc.android.R;
import com.novnc.android.util.KeySyms;

/**
 * Quick keyboard popup: an IME-backed text field that types straight into the
 * remote desktop, plus a one-row strip of the desktop keys mobile keyboards
 * don't have (Esc, Tab, arrows, F-keys, ...).
 */
public class QuickKeyboardView extends LinearLayout {

    public static final int MOD_CTRL = 1;
    public static final int MOD_ALT = 2;
    public static final int MOD_SHIFT = 4;
    public static final int MOD_WIN = 8;

    public interface Listener {
        /** Send a complete key press (modifiers around it) to the remote. */
        void sendKeyCombo(int keysym, String code, int modifierMask);

        /** Send literal text to the remote clipboard/keyboard. */
        void sendText(String text, int modifierMask);

        void sendBackspaces(int count);

        void onCtrlAltDel();

        void onHideRequested();
    }

    private Listener listener;

    private RemoteInputEditText inputField;
    private final java.util.LinkedHashSet<Integer> latched = new java.util.LinkedHashSet<>();
    private final java.util.Map<Integer, Button> modifierButtons = new java.util.HashMap<>();

    public QuickKeyboardView(Context context) {
        super(context);
        init(context);
    }

    public QuickKeyboardView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context);
    }

    public QuickKeyboardView(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init(context);
    }

    public void setListener(Listener listener) {
        this.listener = listener;
    }

    public RemoteInputEditText getInputField() {
        return inputField;
    }

    private void init(Context context) {
        setOrientation(VERTICAL);
        setBackgroundResource(R.drawable.bg_keyboard_panel);
        int pad = dp(8);
        setPadding(pad, pad, pad, pad);
        setElevation(dp(14));

        // ---------- Row 1: remote text input + actions ----------
        LinearLayout inputRow = new LinearLayout(context);
        inputRow.setOrientation(HORIZONTAL);
        inputRow.setGravity(Gravity.CENTER_VERTICAL);

        inputField = new RemoteInputEditText(context);
        inputField.setHint("Type here to send to the remote desktop…");
        inputField.setHintTextColor(Color.parseColor("#6e7681"));
        inputField.setTextColor(Color.WHITE);
        inputField.setTextSize(14);
        inputField.setBackgroundResource(R.drawable.bg_edittext);
        inputField.setPadding(dp(12), dp(8), dp(12), dp(8));
        LinearLayout.LayoutParams inputLp =
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        inputField.setLayoutParams(inputLp);
        inputField.setKeySink(new ImeSink(this));
        inputRow.addView(inputField);

        Button cadButton = new Button(context);
        cadButton.setText("⏻");
        cadButton.setTextSize(16);
        cadButton.setTextColor(Color.WHITE);
        cadButton.setBackgroundResource(R.drawable.bg_button_secondary);
        cadButton.setPadding(0, 0, 0, 0);
        LinearLayout.LayoutParams cadLp = new LinearLayout.LayoutParams(dp(44), dp(40));
        cadLp.setMargins(dp(6), 0, 0, 0);
        cadButton.setLayoutParams(cadLp);
        cadButton.setOnClickListener(v -> {
            if (listener != null) listener.onCtrlAltDel();
        });
        inputRow.addView(cadButton);

        Button hideButton = new Button(context);
        hideButton.setText("⌄");
        hideButton.setTextSize(16);
        hideButton.setTextColor(Color.WHITE);
        hideButton.setBackgroundResource(R.drawable.bg_button_secondary);
        hideButton.setPadding(0, 0, 0, 0);
        LinearLayout.LayoutParams hideLp = new LinearLayout.LayoutParams(dp(44), dp(40));
        hideLp.setMargins(dp(6), 0, 0, 0);
        hideButton.setLayoutParams(hideLp);
        hideButton.setOnClickListener(v -> {
            if (listener != null) listener.onHideRequested();
        });
        inputRow.addView(hideButton);

        addView(inputRow);

        // ---------- Row 2: desktop quick keys ----------
        HorizontalScrollView scroll = new HorizontalScrollView(context);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout.LayoutParams scrollLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        scrollLp.topMargin = dp(8);
        scroll.setLayoutParams(scrollLp);

        LinearLayout keys = new LinearLayout(context);
        keys.setOrientation(HORIZONTAL);
        keys.setGravity(Gravity.CENTER_VERTICAL);

        addModifier(keys, "Ctrl", MOD_CTRL);
        addModifier(keys, "Alt", MOD_ALT);
        addModifier(keys, "Shift", MOD_SHIFT);
        addModifier(keys, "Win", MOD_WIN);

        addKey(keys, "Esc", KeySyms.XK_Escape, "Escape");
        addKey(keys, "Tab", KeySyms.XK_Tab, "Tab");
        addKey(keys, "⌫", KeySyms.XK_BackSpace, "Backspace");
        addKey(keys, "↵", KeySyms.XK_Return, "Enter");
        addKey(keys, "Del", KeySyms.XK_Delete, "Delete");
        addKey(keys, "←", KeySyms.XK_Left, "ArrowLeft");
        addKey(keys, "↑", KeySyms.XK_Up, "ArrowUp");
        addKey(keys, "↓", KeySyms.XK_Down, "ArrowDown");
        addKey(keys, "→", KeySyms.XK_Right, "ArrowRight");
        addKey(keys, "Home", KeySyms.XK_Home, "Home");
        addKey(keys, "End", KeySyms.XK_End, "End");
        addKey(keys, "PgUp", KeySyms.XK_Prior, "PageUp");
        addKey(keys, "PgDn", KeySyms.XK_Next, "PageDown");

        int[] fKeys = {KeySyms.XK_F1, KeySyms.XK_F2, KeySyms.XK_F3, KeySyms.XK_F4,
                KeySyms.XK_F5, KeySyms.XK_F6, KeySyms.XK_F7, KeySyms.XK_F8,
                KeySyms.XK_F9, KeySyms.XK_F10, KeySyms.XK_F11, KeySyms.XK_F12};
        for (int i = 0; i < fKeys.length; i++) {
            String label = "F" + (i + 1);
            addKey(keys, label, fKeys[i], label);
        }

        scroll.addView(keys);
        addView(scroll);
    }

    /** Static (not inner) because older d8 releases cannot parse inner classes. */
    private static final class ImeSink implements RemoteInputEditText.KeySink {
        private final QuickKeyboardView owner;

        ImeSink(QuickKeyboardView owner) {
            this.owner = owner;
        }

        @Override
        public void onRemoteKey(KeyEvent event) {
            owner.handleImeKey(event);
        }

        @Override
        public void onRemoteText(String text) {
            if (owner.listener != null) {
                owner.listener.sendText(text, owner.takeLatched());
            }
        }

        @Override
        public void onRemoteBackspace(int count) {
            if (owner.listener != null) {
                owner.listener.sendBackspaces(count);
            }
        }
    }

    void handleImeKey(KeyEvent event) {
        if (listener == null) return;
        if (event.getAction() != KeyEvent.ACTION_DOWN) return;
        if (event.getRepeatCount() > 0) return;
        if (KeyMapper.isModifier(event.getKeyCode())) return;

        KeyMapper.Mapped mapped = KeyMapper.map(event);
        if (mapped == null) return;

        int mods = takeLatched();
        if (event.isCtrlPressed()) mods |= MOD_CTRL;
        if (event.isAltPressed()) mods |= MOD_ALT;
        if (event.isMetaPressed()) mods |= MOD_WIN;
        // Shift is already baked into the resolved character.

        listener.sendKeyCombo(mapped.keysym, mapped.code, mods);
    }

    private void addModifier(LinearLayout parent, String label, final int mask) {
        Button b = createKeyButton(label);
        b.setOnClickListener(v -> {
            if (latched.contains(mask)) {
                latched.remove(mask);
            } else {
                latched.add(mask);
            }
            b.setSelected(latched.contains(mask));
        });
        modifierButtons.put(mask, b);
        parent.addView(b);
    }

    private void addKey(LinearLayout parent, final String label, final int keysym, final String code) {
        Button b = createKeyButton(label);
        b.setOnClickListener(v -> {
            if (listener != null) {
                listener.sendKeyCombo(keysym, code, takeLatched());
            }
        });
        parent.addView(b);
    }

    private Button createKeyButton(String label) {
        Button b = new Button(getContext());
        b.setText(label);
        b.setTextSize(12);
        b.setTextColor(Color.WHITE);
        b.setBackgroundResource(R.drawable.bg_key_button);
        b.setGravity(Gravity.CENTER);
        b.setMinWidth(dp(38));
        b.setMinimumWidth(dp(38));
        b.setPadding(dp(10), 0, dp(10), 0);
        LinearLayout.LayoutParams lp =
                new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(38));
        lp.setMargins(dp(3), 0, dp(3), 0);
        b.setLayoutParams(lp);
        return b;
    }

    /** Returns the latched modifier bitmask and clears it (one-shot keys). */
    public int takeLatched() {
        if (latched.isEmpty()) return 0;
        int mask = 0;
        for (Integer m : latched) mask |= m;
        clearLatched();
        return mask;
    }

    public void clearLatched() {
        latched.clear();
        for (Button b : modifierButtons.values()) b.setSelected(false);
    }

    public void focusInput() {
        inputField.requestFocus();
        inputField.post(() -> {
            InputMethodManager imm =
                    (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
            if (imm != null) {
                imm.showSoftInput(inputField, InputMethodManager.SHOW_IMPLICIT);
            }
        });
    }

    public void hideInput() {
        inputField.clearFocus();
        InputMethodManager imm =
                (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null && inputField.getWindowToken() != null) {
            imm.hideSoftInputFromWindow(inputField.getWindowToken(), 0);
        }
    }

    public boolean isInputFocused() {
        return inputField != null && inputField.hasFocus();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
