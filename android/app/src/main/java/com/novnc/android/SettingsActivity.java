package com.novnc.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.widget.Button;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

public class SettingsActivity extends Activity implements SeekBar.OnSeekBarChangeListener {

    private AppSettings appSettings;

    private TextView tvSpeedVal;
    private SeekBar sbMouseSpeed;
    private Switch switchAccel;
    private Switch switchInvertScroll;
    private Switch switchHaptics;

    private Switch switchTrackpadMode;
    private Switch switchScaleViewport;
    private Switch switchKeepAwake;

    private TextView tvQualityVal;
    private SeekBar sbQuality;
    private TextView tvCompressionVal;
    private SeekBar sbCompression;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_settings);

        appSettings = new AppSettings(this);

        initViews();
        loadSettings();
    }

    private void initViews() {
        findViewById(R.id.btn_settings_back).setOnClickListener(v -> finish());

        tvSpeedVal = findViewById(R.id.tv_settings_speed_val);
        sbMouseSpeed = findViewById(R.id.sb_settings_mouse_speed);
        sbMouseSpeed.setOnSeekBarChangeListener(this);

        Button chipSlow = findViewById(R.id.chip_speed_precision);
        Button chipNorm = findViewById(R.id.chip_speed_normal);
        Button chipFast = findViewById(R.id.chip_speed_fast);
        Button chipUltra = findViewById(R.id.chip_speed_ultra);

        chipSlow.setOnClickListener(v -> setSpeed(0.4f));
        chipNorm.setOnClickListener(v -> setSpeed(1.0f));
        chipFast.setOnClickListener(v -> setSpeed(1.5f));
        chipUltra.setOnClickListener(v -> setSpeed(2.2f));

        switchAccel = findViewById(R.id.switch_settings_accel);
        switchAccel.setOnCheckedChangeListener((b, isChecked) -> appSettings.setPointerAcceleration(isChecked));

        switchInvertScroll = findViewById(R.id.switch_settings_invert_scroll);
        switchInvertScroll.setOnCheckedChangeListener((b, isChecked) -> appSettings.setInvertScroll(isChecked));

        switchHaptics = findViewById(R.id.switch_settings_haptics);
        switchHaptics.setOnCheckedChangeListener((b, isChecked) -> appSettings.setHapticsEnabled(isChecked));

        switchTrackpadMode = findViewById(R.id.switch_settings_trackpad_mode);
        switchTrackpadMode.setOnCheckedChangeListener((b, isChecked) -> appSettings.setDefaultTrackpadMode(isChecked));

        switchScaleViewport = findViewById(R.id.switch_settings_scale_viewport);
        switchScaleViewport.setOnCheckedChangeListener((b, isChecked) -> appSettings.setScaleViewport(isChecked));

        switchKeepAwake = findViewById(R.id.switch_settings_keep_awake);
        switchKeepAwake.setOnCheckedChangeListener((b, isChecked) -> appSettings.setKeepScreenAwake(isChecked));

        tvQualityVal = findViewById(R.id.tv_settings_quality_val);
        sbQuality = findViewById(R.id.sb_settings_quality);
        sbQuality.setOnSeekBarChangeListener(this);

        tvCompressionVal = findViewById(R.id.tv_settings_compression_val);
        sbCompression = findViewById(R.id.sb_settings_compression);
        sbCompression.setOnSeekBarChangeListener(this);

        findViewById(R.id.btn_settings_reset_defaults).setOnClickListener(v -> confirmReset());
    }

    private void loadSettings() {
        float speed = appSettings.getMouseSpeed();
        int progress = Math.round(speed * 10f);
        sbMouseSpeed.setProgress(Math.max(2, Math.min(30, progress)));
        tvSpeedVal.setText(AppSettings.formatSpeed(speed));

        switchAccel.setChecked(appSettings.isPointerAcceleration());
        switchInvertScroll.setChecked(appSettings.isInvertScroll());
        switchHaptics.setChecked(appSettings.isHapticsEnabled());

        switchTrackpadMode.setChecked(appSettings.isDefaultTrackpadMode());
        switchScaleViewport.setChecked(appSettings.isScaleViewport());
        switchKeepAwake.setChecked(appSettings.isKeepScreenAwake());

        int q = appSettings.getQualityLevel();
        sbQuality.setProgress(q);
        tvQualityVal.setText("Level " + q);

        int c = appSettings.getCompressionLevel();
        sbCompression.setProgress(c);
        tvCompressionVal.setText("Level " + c);
    }

    private void setSpeed(float speed) {
        speed = Math.max(0.2f, Math.min(3.0f, speed));
        sbMouseSpeed.setProgress(Math.round(speed * 10f));
        tvSpeedVal.setText(AppSettings.formatSpeed(speed));
        appSettings.setMouseSpeed(speed);
        Toast.makeText(this, "Mouse speed set to " + AppSettings.formatSpeed(speed), Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
        if (!fromUser) return;
        int id = seekBar.getId();
        if (id == R.id.sb_settings_mouse_speed) {
            float speed = Math.max(0.2f, progress / 10.0f);
            tvSpeedVal.setText(AppSettings.formatSpeed(speed));
            appSettings.setMouseSpeed(speed);
        } else if (id == R.id.sb_settings_quality) {
            tvQualityVal.setText("Level " + progress);
            appSettings.setQualityLevel(progress);
        } else if (id == R.id.sb_settings_compression) {
            tvCompressionVal.setText("Level " + progress);
            appSettings.setCompressionLevel(progress);
        }
    }

    @Override
    public void onStartTrackingTouch(SeekBar seekBar) {}

    @Override
    public void onStopTrackingTouch(SeekBar seekBar) {}

    private void confirmReset() {
        new AlertDialog.Builder(this, R.style.DarkDialogTheme)
                .setTitle("Reset Settings")
                .setMessage("Restore all preferences and mouse speed to default values?")
                .setPositiveButton("Reset", (d, w) -> {
                    appSettings.resetToDefaults();
                    loadSettings();
                    Toast.makeText(this, "Settings restored to defaults", Toast.LENGTH_SHORT).show();
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
}
