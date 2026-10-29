package com.novnc.android.ui;

import android.view.KeyEvent;

import com.novnc.android.util.KeySyms;

/**
 * Translates Android {@link KeyEvent}s into X11/RFB keysyms.
 *
 * Printable characters are resolved through {@link KeyEvent#getUnicodeChar(int)}
 * with the Ctrl/Alt bits stripped, so the character itself carries the shift
 * state (sending "A" instead of Shift+"a", which is what VNC servers expect).
 */
public final class KeyMapper {

    public static final class Mapped {
        public final int keysym;
        public final String code;

        Mapped(int keysym, String code) {
            this.keysym = keysym;
            this.code = code;
        }
    }

    private KeyMapper() {}

    public static boolean isModifier(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_CTRL_LEFT:
            case KeyEvent.KEYCODE_CTRL_RIGHT:
            case KeyEvent.KEYCODE_ALT_LEFT:
            case KeyEvent.KEYCODE_ALT_RIGHT:
            case KeyEvent.KEYCODE_SHIFT_LEFT:
            case KeyEvent.KEYCODE_SHIFT_RIGHT:
            case KeyEvent.KEYCODE_META_LEFT:
            case KeyEvent.KEYCODE_META_RIGHT:
            case KeyEvent.KEYCODE_CAPS_LOCK:
            case KeyEvent.KEYCODE_NUM_LOCK:
                return true;
            default:
                return false;
        }
    }

    public static Mapped modifierKeySym(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_CTRL_LEFT:  return new Mapped(KeySyms.XK_Control_L, "ControlLeft");
            case KeyEvent.KEYCODE_CTRL_RIGHT: return new Mapped(KeySyms.XK_Control_R, "ControlRight");
            case KeyEvent.KEYCODE_ALT_LEFT:   return new Mapped(KeySyms.XK_Alt_L, "AltLeft");
            case KeyEvent.KEYCODE_ALT_RIGHT:  return new Mapped(KeySyms.XK_Alt_R, "AltRight");
            case KeyEvent.KEYCODE_SHIFT_LEFT: return new Mapped(KeySyms.XK_Shift_L, "ShiftLeft");
            case KeyEvent.KEYCODE_SHIFT_RIGHT:return new Mapped(KeySyms.XK_Shift_R, "ShiftRight");
            case KeyEvent.KEYCODE_META_LEFT:  return new Mapped(KeySyms.XK_Super_L, "MetaLeft");
            case KeyEvent.KEYCODE_META_RIGHT: return new Mapped(KeySyms.XK_Super_R, "MetaRight");
            default: return null;
        }
    }

    /**
     * @return the keysym for a non-modifier key, or {@code null} when the key
     *         has no meaningful remote representation.
     */
    public static Mapped map(KeyEvent event) {
        final int keyCode = event.getKeyCode();

        switch (keyCode) {
            case KeyEvent.KEYCODE_DEL:          return new Mapped(KeySyms.XK_BackSpace, "Backspace");
            case KeyEvent.KEYCODE_FORWARD_DEL:  return new Mapped(KeySyms.XK_Delete, "Delete");
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER: return new Mapped(KeySyms.XK_Return, "Enter");
            case KeyEvent.KEYCODE_TAB:          return new Mapped(KeySyms.XK_Tab, "Tab");
            case KeyEvent.KEYCODE_ESCAPE:       return new Mapped(KeySyms.XK_Escape, "Escape");
            case KeyEvent.KEYCODE_SPACE:        return new Mapped(KeySyms.XK_Space, "Space");
            case KeyEvent.KEYCODE_DPAD_LEFT:    return new Mapped(KeySyms.XK_Left, "ArrowLeft");
            case KeyEvent.KEYCODE_DPAD_UP:      return new Mapped(KeySyms.XK_Up, "ArrowUp");
            case KeyEvent.KEYCODE_DPAD_RIGHT:   return new Mapped(KeySyms.XK_Right, "ArrowRight");
            case KeyEvent.KEYCODE_DPAD_DOWN:    return new Mapped(KeySyms.XK_Down, "ArrowDown");
            case KeyEvent.KEYCODE_MOVE_HOME:
            case KeyEvent.KEYCODE_HOME:         return new Mapped(KeySyms.XK_Home, "Home");
            case KeyEvent.KEYCODE_MOVE_END:
            case KeyEvent.KEYCODE_ENDCALL:      return new Mapped(KeySyms.XK_End, "End");
            case KeyEvent.KEYCODE_PAGE_UP:      return new Mapped(KeySyms.XK_Prior, "PageUp");
            case KeyEvent.KEYCODE_PAGE_DOWN:    return new Mapped(KeySyms.XK_Next, "PageDown");
            case KeyEvent.KEYCODE_INSERT:       return new Mapped(KeySyms.XK_Insert, "Insert");
            case KeyEvent.KEYCODE_F1:  return new Mapped(KeySyms.XK_F1, "F1");
            case KeyEvent.KEYCODE_F2:  return new Mapped(KeySyms.XK_F2, "F2");
            case KeyEvent.KEYCODE_F3:  return new Mapped(KeySyms.XK_F3, "F3");
            case KeyEvent.KEYCODE_F4:  return new Mapped(KeySyms.XK_F4, "F4");
            case KeyEvent.KEYCODE_F5:  return new Mapped(KeySyms.XK_F5, "F5");
            case KeyEvent.KEYCODE_F6:  return new Mapped(KeySyms.XK_F6, "F6");
            case KeyEvent.KEYCODE_F7:  return new Mapped(KeySyms.XK_F7, "F7");
            case KeyEvent.KEYCODE_F8:  return new Mapped(KeySyms.XK_F8, "F8");
            case KeyEvent.KEYCODE_F9:  return new Mapped(KeySyms.XK_F9, "F9");
            case KeyEvent.KEYCODE_F10: return new Mapped(KeySyms.XK_F10, "F10");
            case KeyEvent.KEYCODE_F11: return new Mapped(KeySyms.XK_F11, "F11");
            case KeyEvent.KEYCODE_F12: return new Mapped(KeySyms.XK_F12, "F12");
            default:
                break;
        }

        // Printable / unicode fallback. Strip Ctrl and Alt so that Ctrl+C
        // resolves to the letter "c" (the caller wraps it with the modifier
        // keys) instead of the ETX control character.
        int meta = event.getMetaState() & ~(KeyEvent.META_CTRL_ON
                | KeyEvent.META_CTRL_LEFT_ON | KeyEvent.META_CTRL_RIGHT_ON
                | KeyEvent.META_ALT_ON | KeyEvent.META_ALT_LEFT_ON
                | KeyEvent.META_ALT_RIGHT_ON);

        int unicode = event.getUnicodeChar(meta);
        if (unicode == 0) {
            unicode = event.getUnicodeChar();
        }
        if (unicode > 0) {
            int keysym = (unicode > 0xff) ? (0x01000000 | unicode) : unicode;
            return new Mapped(keysym, domCode(keyCode));
        }

        return null;
    }

    /** Best-effort DOM `code` value, used by QEMU extended key events. */
    public static String domCode(int keyCode) {
        if (keyCode >= KeyEvent.KEYCODE_A && keyCode <= KeyEvent.KEYCODE_Z) {
            return "Key" + (char) ('A' + (keyCode - KeyEvent.KEYCODE_A));
        }
        if (keyCode >= KeyEvent.KEYCODE_0 && keyCode <= KeyEvent.KEYCODE_9) {
            return "Digit" + (keyCode - KeyEvent.KEYCODE_0);
        }
        switch (keyCode) {
            case KeyEvent.KEYCODE_MINUS:        return "Minus";
            case KeyEvent.KEYCODE_EQUALS:       return "Equal";
            case KeyEvent.KEYCODE_LEFT_BRACKET: return "BracketLeft";
            case KeyEvent.KEYCODE_RIGHT_BRACKET:return "BracketRight";
            case KeyEvent.KEYCODE_BACKSLASH:    return "Backslash";
            case KeyEvent.KEYCODE_SEMICOLON:    return "Semicolon";
            case KeyEvent.KEYCODE_APOSTROPHE:   return "Quote";
            case KeyEvent.KEYCODE_COMMA:        return "Comma";
            case KeyEvent.KEYCODE_PERIOD:       return "Period";
            case KeyEvent.KEYCODE_SLASH:        return "Slash";
            case KeyEvent.KEYCODE_GRAVE:        return "Backquote";
            default: return "";
        }
    }
}
