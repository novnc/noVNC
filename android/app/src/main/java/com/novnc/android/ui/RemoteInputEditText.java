package com.novnc.android.ui;

import android.content.Context;
import android.text.InputType;
import android.util.AttributeSet;
import android.view.KeyEvent;
import android.view.inputmethod.BaseInputConnection;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.widget.EditText;

/**
 * An EditText that never stores text: every IME commit / key press is forwarded
 * to the remote desktop instead. This is what makes the on-screen keyboard
 * behave like a real keyboard attached to the VNC session (no autocorrect,
 * no duplicated characters, correct modifiers).
 */
public class RemoteInputEditText extends EditText {

    public interface KeySink {
        void onRemoteKey(KeyEvent event);
        void onRemoteText(String text);
        void onRemoteBackspace(int count);
    }

    private KeySink sink;

    public RemoteInputEditText(Context context) {
        super(context);
        init();
    }

    public RemoteInputEditText(Context context, AttributeSet attrs) {
        super(context, attrs);
        init();
    }

    public RemoteInputEditText(Context context, AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);
        init();
    }

    private void init() {
        setSingleLine(true);
        setImeOptions(EditorInfo.IME_ACTION_NONE
                | EditorInfo.IME_FLAG_NO_EXTRACT_UI
                | EditorInfo.IME_FLAG_NO_FULLSCREEN);
        setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        setShowSoftInputOnFocus(true);
    }

    public void setKeySink(KeySink sink) {
        this.sink = sink;
    }

    public KeySink getKeySink() {
        return sink;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (sink != null && keyCode != KeyEvent.KEYCODE_BACK) {
            sink.onRemoteKey(event);
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (sink != null && keyCode != KeyEvent.KEYCODE_BACK) {
            sink.onRemoteKey(event);
            return true;
        }
        return super.onKeyUp(keyCode, event);
    }

    @Override
    public boolean onKeyMultiple(int keyCode, int repeatCount, KeyEvent event) {
        return sink != null;
    }

    @Override
    public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
        outAttrs.imeOptions = EditorInfo.IME_ACTION_NONE
                | EditorInfo.IME_FLAG_NO_EXTRACT_UI
                | EditorInfo.IME_FLAG_NO_FULLSCREEN;
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
        return new RemoteInputConnection(this);
    }

    private static final class RemoteInputConnection extends BaseInputConnection {
        private static final int SHADOW_LIMIT = 256;

        private final RemoteInputEditText target;

        /**
         * Shadow of what the remote desktop has received. The IME needs to
         * believe the field contains text, otherwise keyboards like Gboard
         * disable the delete key and stop sending backspaces altogether.
         */
        private final StringBuilder shadow = new StringBuilder();

        RemoteInputConnection(RemoteInputEditText target) {
            super(target, true);
            this.target = target;
        }

        private KeySink sink() {
            return target.sink;
        }

        @Override
        public boolean commitText(CharSequence text, int newCursorPosition) {
            KeySink s = sink();
            if (s != null && text != null && text.length() > 0) {
                String value = text.toString();
                shadow.append(value);
                if (shadow.length() > SHADOW_LIMIT) {
                    shadow.delete(0, shadow.length() - SHADOW_LIMIT);
                }
                s.onRemoteText(value);
            }
            return true;
        }

        @Override
        public boolean setComposingText(CharSequence text, int newCursorPosition) {
            // Swallow composing state: the remote desktop has no notion of it,
            // and letting it through would duplicate characters.
            return true;
        }

        @Override
        public boolean finishComposingText() {
            return true;
        }

        @Override
        public boolean setComposingRegion(int start, int end) {
            return true;
        }

        @Override
        public boolean deleteSurroundingText(int beforeLength, int afterLength) {
            KeySink s = sink();
            if (s != null) {
                int before = Math.max(0, beforeLength);
                int after = Math.max(0, afterLength);
                if (before > 0) {
                    int drop = Math.min(before, shadow.length());
                    shadow.delete(shadow.length() - drop, shadow.length());
                    s.onRemoteBackspace(before);
                }
                if (after > 0) {
                    for (int i = 0; i < after; i++) {
                        s.onRemoteKey(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_FORWARD_DEL));
                        s.onRemoteKey(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_FORWARD_DEL));
                    }
                }
            }
            return true;
        }

        @Override
        public boolean sendKeyEvent(KeyEvent event) {
            KeySink s = sink();
            if (s != null) {
                if (event.getAction() == KeyEvent.ACTION_DOWN
                        && event.getKeyCode() == KeyEvent.KEYCODE_DEL
                        && shadow.length() > 0) {
                    shadow.deleteCharAt(shadow.length() - 1);
                }
                s.onRemoteKey(event);
                return true;
            }
            return super.sendKeyEvent(event);
        }

        @Override
        public void closeConnection() {
            shadow.setLength(0);
            super.closeConnection();
        }

        @Override
        public boolean performEditorAction(int actionCode) {
            KeySink s = sink();
            if (s != null) {
                s.onRemoteText("\n");
                return true;
            }
            return true;
        }

        @Override
        public CharSequence getTextBeforeCursor(int n, int flags) {
            if (shadow.length() == 0) return "";
            int start = Math.max(0, shadow.length() - Math.max(n, 1));
            return shadow.substring(start);
        }

        @Override
        public CharSequence getTextAfterCursor(int n, int flags) {
            return "";
        }

        @Override
        public CharSequence getSelectedText(int flags) {
            return null;
        }

        @Override
        public int getCursorCapsMode(int reqModes) {
            return 0;
        }

        @Override
        public boolean setSelection(int start, int end) {
            return true;
        }

        @Override
        public boolean commitCompletion(android.view.inputmethod.CompletionInfo text) {
            return true;
        }
    }
}
