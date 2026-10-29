package com.novnc.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.novnc.android.ui.ProfileEditDialog;

import java.util.List;

public class MainActivity extends Activity {

    private ProfileManager profileManager;
    private LinearLayout containerProfiles;
    private LinearLayout layoutEmptyState;
    private TextView tvProfileCount;

    // Quick connect fields
    private EditText etQuickHost;
    private EditText etQuickPort;
    private EditText etQuickPath;
    private EditText etQuickPassword;
    private Switch switchQuickSsl;
    private Switch switchQuickRemember;
    private LinearLayout layoutQuickAdvanced;
    private TextView tvToggleAdvanced;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        profileManager = new ProfileManager(this);

        initViews();
        setupQuickConnect();
        loadProfiles();
    }

    private void initViews() {
        containerProfiles = findViewById(R.id.container_profiles);
        layoutEmptyState = findViewById(R.id.layout_empty_state);
        tvProfileCount = findViewById(R.id.tv_profile_count);

        findViewById(R.id.fab_add_profile).setOnClickListener(v -> {
            ProfileEditDialog.show(this, null, profile -> {
                profileManager.saveProfile(profile);
                loadProfiles();
                Toast.makeText(this, "Profile added", Toast.LENGTH_SHORT).show();
            });
        });

        findViewById(R.id.btn_settings).setOnClickListener(v -> {
            startActivity(new Intent(this, SettingsActivity.class));
        });

        findViewById(R.id.btn_about).setOnClickListener(v -> showAboutDialog());
    }

    private void setupQuickConnect() {
        etQuickHost = findViewById(R.id.et_quick_host);
        etQuickPort = findViewById(R.id.et_quick_port);
        etQuickPath = findViewById(R.id.et_quick_path);
        etQuickPassword = findViewById(R.id.et_quick_password);
        switchQuickSsl = findViewById(R.id.switch_quick_ssl);
        switchQuickRemember = findViewById(R.id.switch_quick_remember);
        layoutQuickAdvanced = findViewById(R.id.layout_quick_advanced);
        tvToggleAdvanced = findViewById(R.id.tv_toggle_advanced);

        tvToggleAdvanced.setOnClickListener(v -> {
            if (layoutQuickAdvanced.getVisibility() == View.VISIBLE) {
                layoutQuickAdvanced.setVisibility(View.GONE);
                tvToggleAdvanced.setText("Options ▼");
            } else {
                layoutQuickAdvanced.setVisibility(View.VISIBLE);
                tvToggleAdvanced.setText("Options ▲");
            }
        });

        findViewById(R.id.btn_quick_connect).setOnClickListener(v -> {
            String hostInput = etQuickHost.getText().toString().trim();
            String portStr = etQuickPort.getText().toString().trim();
            String path = etQuickPath.getText().toString().trim();
            String pass = etQuickPassword.getText().toString();
            boolean ssl = switchQuickSsl.isChecked();

            if (hostInput.isEmpty()) {
                Toast.makeText(this, "Please enter a host address or full wss:// URL", Toast.LENGTH_SHORT).show();
                return;
            }

            ConnectionProfile quickProfile;
            if (hostInput.startsWith("ws://") || hostInput.startsWith("wss://")) {
                quickProfile = ConnectionProfile.fromUrl("Quick Session", hostInput, pass);
            } else {
                int port = 0;
                if (!portStr.isEmpty()) {
                    try {
                        port = Integer.parseInt(portStr);
                    } catch (NumberFormatException e) {
                        port = 0;
                    }
                }

                quickProfile = new ConnectionProfile(
                    "Quick Session (" + hostInput + ")",
                    hostInput,
                    port,
                    path.isEmpty() ? "websockify" : path,
                    pass,
                    ssl
                );
            }

            AppSettings settings = new AppSettings(this);
            quickProfile.setTrackpadMode(settings.isDefaultTrackpadMode());
            quickProfile.setScaleViewport(settings.isScaleViewport());
            quickProfile.setQualityLevel(settings.getQualityLevel());
            quickProfile.setCompressionLevel(settings.getCompressionLevel());

            boolean remember = switchQuickRemember == null || switchQuickRemember.isChecked();
            quickProfile.setRememberPassword(remember);

            ConnectionProfile toOpen = quickProfile;
            if (remember) {
                // Auto-save the connection so the host + password are
                // replayed on the next launch without retyping anything.
                ConnectionProfile existing = profileManager.findByEndpoint(
                        quickProfile.getEndpointString());
                if (existing != null) {
                    existing.setPassword(pass);
                    existing.setRememberPassword(true);
                    existing.setTrackpadMode(quickProfile.isTrackpadMode());
                    existing.setScaleViewport(quickProfile.isScaleViewport());
                    profileManager.saveProfile(existing);
                    // Reuse the saved record so a later credential save from
                    // the viewer updates it instead of adding a duplicate.
                    toOpen = existing;
                } else {
                    profileManager.saveProfile(quickProfile);
                }
                loadProfiles();
                Toast.makeText(this,
                        pass.isEmpty() ? "Connection saved" : "Connection and password saved",
                        Toast.LENGTH_SHORT).show();
            }

            startViewer(toOpen);
        });
    }

    private void loadProfiles() {
        containerProfiles.removeAllViews();
        List<ConnectionProfile> profiles = profileManager.getProfiles();

        if (profiles.isEmpty()) {
            layoutEmptyState.setVisibility(View.VISIBLE);
            tvProfileCount.setText("0 profiles");
            return;
        }

        layoutEmptyState.setVisibility(View.GONE);
        tvProfileCount.setText(profiles.size() + (profiles.size() == 1 ? " profile" : " profiles"));

        LayoutInflater inflater = LayoutInflater.from(this);
        for (ConnectionProfile profile : profiles) {
            View itemView = inflater.inflate(R.layout.item_connection_profile, containerProfiles, false);

            TextView tvName = itemView.findViewById(R.id.tv_profile_name);
            TextView tvEndpoint = itemView.findViewById(R.id.tv_profile_endpoint);
            TextView badgeProto = itemView.findViewById(R.id.badge_protocol);
            TextView badgeMode = itemView.findViewById(R.id.badge_mode);
            Button btnConnect = itemView.findViewById(R.id.btn_profile_connect);
            View btnEdit = itemView.findViewById(R.id.btn_profile_edit);
            View btnDelete = itemView.findViewById(R.id.btn_profile_delete);
            View statusDot = itemView.findViewById(R.id.view_profile_status_dot);
            ImageView profileIcon = itemView.findViewById(R.id.iv_profile_icon);

            tvName.setText(profile.getName());
            tvEndpoint.setText(profile.getEndpointString());
            badgeProto.setText(profile.isSsl() ? "WSS" : "WS");
            badgeMode.setText(profile.isTrackpadMode() ? "Trackpad" : "Direct Touch");
            boolean recentlyConnected = profile.getLastConnected() > 0;
            if (statusDot != null) {
                statusDot.setBackgroundResource(recentlyConnected
                        ? R.drawable.bg_status_online : R.drawable.bg_status_idle);
                statusDot.setContentDescription(recentlyConnected ? "Recently connected" : "Not connected");
            }
            if (profileIcon != null) {
                profileIcon.setColorFilter(getColor(recentlyConnected
                        ? R.color.accent_green : R.color.primary));
            }

            btnConnect.setOnClickListener(v -> {
                profile.setLastConnected(System.currentTimeMillis());
                profileManager.saveProfile(profile);
                startViewer(profile);
            });

            btnEdit.setOnClickListener(v -> {
                ProfileEditDialog.show(this, profile, updated -> {
                    profileManager.saveProfile(updated);
                    loadProfiles();
                });
            });

            btnDelete.setOnClickListener(v -> {
                new AlertDialog.Builder(this, R.style.DarkDialogTheme)
                    .setTitle("Delete Profile")
                    .setMessage("Remove \"" + profile.getName() + "\" from saved connections?")
                    .setPositiveButton("Delete", (d, w) -> {
                        profileManager.deleteProfile(profile.getId());
                        loadProfiles();
                    })
                    .setNegativeButton("Cancel", null)
                    .show();
            });

            containerProfiles.addView(itemView);
        }
    }

    private void startViewer(ConnectionProfile profile) {
        Intent intent = new Intent(this, VncViewerActivity.class);
        intent.putExtra("profile", profile);
        startActivity(intent);
    }

    private void showAboutDialog() {
        new AlertDialog.Builder(this, R.style.DarkDialogTheme)
            .setTitle("About noVNC Mobile")
            .setMessage("noVNC Mobile Client\n\n"
                + "• High-performance RFB remote desktop client\n"
                + "• Direct WebSocket (ws:// and wss://) protocol support\n"
                + "• Virtual Trackpad mode with subpixel motion & gesture clicks\n"
                + "• Extended Keyboard bar with sticky Ctrl/Alt/Shift/Super keys\n"
                + "• Two-way remote clipboard synchronization\n"
                + "• Compatible with websockify, QEMU, Proxmox, and TigerVNC\n\n"
                + "Powered by noVNC JavaScript RFB Engine.")
            .setPositiveButton("Close", null)
            .show();
    }
}
