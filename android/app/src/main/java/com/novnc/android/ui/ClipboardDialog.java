package com.novnc.android.ui;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Toast;

import com.novnc.android.R;

public class ClipboardDialog {

    public interface ClipboardActionListener {
        void onSendClipboardToRemote(String text);
    }

    public static void show(Context context, String remoteClipboardText, ClipboardActionListener listener) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.DarkCustomDialogTheme);
        View view = LayoutInflater.from(context).inflate(R.layout.dialog_clipboard, null);
        builder.setView(view);

        AlertDialog dialog = builder.create();

        EditText etRemote = view.findViewById(R.id.et_remote_clipboard);
        EditText etSend = view.findViewById(R.id.et_send_clipboard);
        Button btnCopyRemote = view.findViewById(R.id.btn_copy_remote_to_device);
        Button btnPastePhone = view.findViewById(R.id.btn_paste_from_device);
        Button btnSend = view.findViewById(R.id.btn_send_to_remote);
        Button btnClose = view.findViewById(R.id.btn_dialog_close);

        etRemote.setText(remoteClipboardText != null ? remoteClipboardText : "");

        ClipboardManager cm = (ClipboardManager) context.getSystemService(Context.CLIPBOARD_SERVICE);

        btnCopyRemote.setOnClickListener(v -> {
            String text = etRemote.getText().toString();
            if (!text.isEmpty() && cm != null) {
                ClipData clip = ClipData.newPlainText("noVNC Remote", text);
                cm.setPrimaryClip(clip);
                Toast.makeText(context, "Copied remote text to phone clipboard", Toast.LENGTH_SHORT).show();
            }
        });

        btnPastePhone.setOnClickListener(v -> {
            if (cm != null && cm.hasPrimaryClip() && cm.getPrimaryClip().getItemCount() > 0) {
                CharSequence text = cm.getPrimaryClip().getItemAt(0).getText();
                if (text != null) {
                    etSend.setText(text);
                }
            } else {
                Toast.makeText(context, "Phone clipboard is empty", Toast.LENGTH_SHORT).show();
            }
        });

        btnSend.setOnClickListener(v -> {
            String text = etSend.getText().toString();
            if (listener != null) {
                listener.onSendClipboardToRemote(text);
                Toast.makeText(context, "Sent to remote clipboard", Toast.LENGTH_SHORT).show();
            }
            dialog.dismiss();
        });

        if (btnClose != null) {
            btnClose.setOnClickListener(v -> dialog.dismiss());
        }

        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
            int maxDialogWidth = (int) (context.getResources().getDisplayMetrics().density * 440);
            int width = Math.min((int) (screenWidth * 0.90f), maxDialogWidth);
            dialog.getWindow().setLayout(width, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }
}
