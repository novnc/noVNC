package com.novnc.android.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.novnc.android.AppSettings;
import com.novnc.android.ConnectionProfile;
import com.novnc.android.R;

public class ProfileEditDialog {

    public interface OnProfileSavedListener {
        void onProfileSaved(ConnectionProfile profile);
    }

    public static void show(Context context, ConnectionProfile existingProfile, OnProfileSavedListener listener) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.DarkCustomDialogTheme);
        View view = LayoutInflater.from(context).inflate(R.layout.dialog_profile_edit, null);
        builder.setView(view);

        AlertDialog dialog = builder.create();

        final boolean isNew = (existingProfile == null);
        final ConnectionProfile profile = isNew ? new ConnectionProfile() : existingProfile;

        TextView tvTitle = view.findViewById(R.id.tv_dialog_title);
        tvTitle.setText(isNew ? "New Server Profile" : "Edit Server Profile");

        EditText etName = view.findViewById(R.id.et_edit_name);
        EditText etHost = view.findViewById(R.id.et_edit_host);
        EditText etPort = view.findViewById(R.id.et_edit_port);
        EditText etPath = view.findViewById(R.id.et_edit_path);
        EditText etPass = view.findViewById(R.id.et_edit_password);

        Switch swSsl = view.findViewById(R.id.switch_edit_ssl);
        Switch swTrackpad = view.findViewById(R.id.switch_edit_trackpad);
        Switch swScale = view.findViewById(R.id.switch_edit_scale);
        Switch swViewOnly = view.findViewById(R.id.switch_edit_view_only);
        Switch swRemember = view.findViewById(R.id.switch_edit_remember);

        Button btnCancel = view.findViewById(R.id.btn_dialog_cancel);
        Button btnSave = view.findViewById(R.id.btn_dialog_save);

        if (!isNew) {
            etName.setText(profile.getName());
            if (profile.getRawUrl() != null && (profile.getRawUrl().startsWith("ws://") || profile.getRawUrl().startsWith("wss://"))) {
                etHost.setText(profile.getRawUrl());
            } else {
                etHost.setText(profile.getHost());
            }
            if (profile.getPort() > 0) {
                etPort.setText(String.valueOf(profile.getPort()));
            } else {
                etPort.setText("");
            }
            etPath.setText(profile.getPath());
            etPass.setText(profile.getPassword());
            swRemember.setChecked(profile.isRememberPassword());
            swSsl.setChecked(profile.isSsl());
            swTrackpad.setChecked(profile.isTrackpadMode());
            swScale.setChecked(profile.isScaleViewport());
            swViewOnly.setChecked(profile.isViewOnly());
        } else {
            AppSettings settings = new AppSettings(context);
            profile.setTrackpadMode(settings.isDefaultTrackpadMode());
            profile.setScaleViewport(settings.isScaleViewport());
            profile.setQualityLevel(settings.getQualityLevel());
            profile.setCompressionLevel(settings.getCompressionLevel());
            swTrackpad.setChecked(profile.isTrackpadMode());
            swScale.setChecked(profile.isScaleViewport());
        }

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        btnSave.setOnClickListener(v -> {
            String name = etName.getText().toString().trim();
            String hostInput = etHost.getText().toString().trim();
            String portStr = etPort.getText().toString().trim();
            String path = etPath.getText().toString().trim();
            String pass = etPass.getText().toString();

            if (hostInput.isEmpty()) {
                Toast.makeText(context, "Host address or URL cannot be empty", Toast.LENGTH_SHORT).show();
                return;
            }

            if (hostInput.startsWith("ws://") || hostInput.startsWith("wss://")) {
                profile.parseAndApplyUrl(hostInput);
                if (name.isEmpty()) {
                    name = profile.getHost();
                }
                profile.setName(name);
                profile.setPassword(pass);
                profile.setRememberPassword(swRemember.isChecked());
                profile.setTrackpadMode(swTrackpad.isChecked());
                profile.setScaleViewport(swScale.isChecked());
                profile.setViewOnly(swViewOnly.isChecked());
            } else {
                int port = 0;
                if (!portStr.isEmpty()) {
                    try {
                        port = Integer.parseInt(portStr);
                    } catch (NumberFormatException e) {
                        port = 0;
                    }
                }

                if (name.isEmpty()) {
                    name = hostInput + (port > 0 ? (":" + port) : "");
                }

                profile.setName(name);
                profile.setHost(hostInput);
                profile.setPort(port);
                profile.setPath(path.isEmpty() ? "websockify" : path);
                profile.setPassword(pass);
                profile.setRememberPassword(swRemember.isChecked());
                profile.setSsl(swSsl.isChecked());
                profile.setRawUrl(""); // Recalculate
                profile.setTrackpadMode(swTrackpad.isChecked());
                profile.setScaleViewport(swScale.isChecked());
                profile.setViewOnly(swViewOnly.isChecked());
            }

            if (listener != null) {
                listener.onProfileSaved(profile);
            }
            dialog.dismiss();
        });

        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            int screenWidth = context.getResources().getDisplayMetrics().widthPixels;
            int maxDialogWidth = (int) (context.getResources().getDisplayMetrics().density * 480);
            int width = Math.min((int) (screenWidth * 0.92f), maxDialogWidth);

            int screenHeight = context.getResources().getDisplayMetrics().heightPixels;
            int maxHeight = (int) (screenHeight * 0.86f);
            dialog.getWindow().setLayout(width, maxHeight);
        }
    }
}
