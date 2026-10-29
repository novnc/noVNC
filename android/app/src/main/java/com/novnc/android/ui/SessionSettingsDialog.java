package com.novnc.android.ui;

import android.app.AlertDialog;
import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import com.novnc.android.AppSettings;
import com.novnc.android.R;

public class SessionSettingsDialog {

    public interface SettingsChangeListener {
        void onTrackpadModeToggled(boolean enabled);
        void onTrackpadSpeedChanged(float speed);
        void onInvertScrollToggled(boolean enabled);
        void onScaleModeToggled(boolean enabled);
        void onViewOnlyToggled(boolean enabled);
        void onWakeLockToggled(boolean enabled);
        void onQualityChanged(int quality);
        void onCompressionChanged(int compression);
    }

    public interface OnProgressCallback {
        void onProgress(int progress, boolean fromUser);
    }

    private static class SeekBarChangeHelper implements SeekBar.OnSeekBarChangeListener {
        private final OnProgressCallback callback;

        public SeekBarChangeHelper(OnProgressCallback callback) {
            this.callback = callback;
        }

        @Override
        public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
            callback.onProgress(progress, fromUser);
        }

        @Override public void onStartTrackingTouch(SeekBar seekBar) {}
        @Override public void onStopTrackingTouch(SeekBar seekBar) {}
    }

    public static void show(
            Context context,
            boolean isTrackpad,
            float trackpadSpeed,
            boolean isScale,
            boolean isViewOnly,
            boolean isWakeLock,
            int quality,
            int compression,
            SettingsChangeListener listener
    ) {
        AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.DarkCustomDialogTheme);
        View view = LayoutInflater.from(context).inflate(R.layout.dialog_session_settings, null);
        builder.setView(view);

        AlertDialog dialog = builder.create();

        Switch swTrackpad = view.findViewById(R.id.switch_session_trackpad);
        TextView tvSpeed = view.findViewById(R.id.tv_trackpad_sensitivity_label);
        SeekBar sbSpeed = view.findViewById(R.id.sb_trackpad_speed);

        Switch swScale = view.findViewById(R.id.switch_session_scale);
        Switch swInvert = view.findViewById(R.id.switch_session_invert_scroll);
        Switch swViewOnly = view.findViewById(R.id.switch_session_view_only);
        Switch swWakeLock = view.findViewById(R.id.switch_session_wakelock);

        TextView tvQuality = view.findViewById(R.id.tv_quality_label);
        SeekBar sbQuality = view.findViewById(R.id.sb_quality);

        TextView tvCompression = view.findViewById(R.id.tv_compression_label);
        SeekBar sbCompression = view.findViewById(R.id.sb_compression);

        Button btnDone = view.findViewById(R.id.btn_settings_done);

        swTrackpad.setChecked(isTrackpad);
        swTrackpad.setOnCheckedChangeListener((b, isChecked) -> {
            if (listener != null) listener.onTrackpadModeToggled(isChecked);
        });

        int speedProgress = Math.round(trackpadSpeed * 10.0f);
        sbSpeed.setProgress(Math.max(2, Math.min(30, speedProgress)));
        tvSpeed.setText("Mouse Speed: " + AppSettings.formatSpeed(trackpadSpeed));

        sbSpeed.setOnSeekBarChangeListener(new SeekBarChangeHelper((progress, fromUser) -> {
            float val = Math.max(0.2f, progress / 10.0f);
            tvSpeed.setText("Mouse Speed: " + AppSettings.formatSpeed(val));
            if (fromUser && listener != null) {
                listener.onTrackpadSpeedChanged(val);
            }
        }));

        Button btnSlow = view.findViewById(R.id.btn_speed_slow);
        Button btnNorm = view.findViewById(R.id.btn_speed_normal);
        Button btnFast = view.findViewById(R.id.btn_speed_fast);
        Button btnUltra = view.findViewById(R.id.btn_speed_ultra);

        if (btnSlow != null) {
            btnSlow.setOnClickListener(v -> {
                sbSpeed.setProgress(4);
                tvSpeed.setText("Mouse Speed: " + AppSettings.formatSpeed(0.4f));
                if (listener != null) listener.onTrackpadSpeedChanged(0.4f);
            });
        }
        if (btnNorm != null) {
            btnNorm.setOnClickListener(v -> {
                sbSpeed.setProgress(10);
                tvSpeed.setText("Mouse Speed: " + AppSettings.formatSpeed(1.0f));
                if (listener != null) listener.onTrackpadSpeedChanged(1.0f);
            });
        }
        if (btnFast != null) {
            btnFast.setOnClickListener(v -> {
                sbSpeed.setProgress(15);
                tvSpeed.setText("Mouse Speed: " + AppSettings.formatSpeed(1.5f));
                if (listener != null) listener.onTrackpadSpeedChanged(1.5f);
            });
        }
        if (btnUltra != null) {
            btnUltra.setOnClickListener(v -> {
                sbSpeed.setProgress(22);
                tvSpeed.setText("Mouse Speed: " + AppSettings.formatSpeed(2.2f));
                if (listener != null) listener.onTrackpadSpeedChanged(2.2f);
            });
        }

        if (swInvert != null) {
            AppSettings settings = new AppSettings(context);
            swInvert.setChecked(settings.isInvertScroll());
            swInvert.setOnCheckedChangeListener((b, isChecked) -> {
                settings.setInvertScroll(isChecked);
                if (listener != null) listener.onInvertScrollToggled(isChecked);
            });
        }

        swScale.setChecked(isScale);
        swScale.setOnCheckedChangeListener((b, isChecked) -> {
            if (listener != null) listener.onScaleModeToggled(isChecked);
        });

        swViewOnly.setChecked(isViewOnly);
        swViewOnly.setOnCheckedChangeListener((b, isChecked) -> {
            if (listener != null) listener.onViewOnlyToggled(isChecked);
        });

        swWakeLock.setChecked(isWakeLock);
        swWakeLock.setOnCheckedChangeListener((b, isChecked) -> {
            if (listener != null) listener.onWakeLockToggled(isChecked);
        });

        sbQuality.setProgress(quality);
        tvQuality.setText("JPEG Quality: " + quality);
        sbQuality.setOnSeekBarChangeListener(new SeekBarChangeHelper((progress, fromUser) -> {
            tvQuality.setText("JPEG Quality: " + progress);
            if (fromUser && listener != null) listener.onQualityChanged(progress);
        }));

        sbCompression.setProgress(compression);
        tvCompression.setText("Compression Level: " + compression);
        sbCompression.setOnSeekBarChangeListener(new SeekBarChangeHelper((progress, fromUser) -> {
            tvCompression.setText("Compression Level: " + progress);
            if (fromUser && listener != null) listener.onCompressionChanged(progress);
        }));

        btnDone.setOnClickListener(v -> dialog.dismiss());

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
