package com.novnc.android;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class ProfileManager {
    private static final String PREF_NAME = "novnc_profiles";
    private static final String KEY_PROFILES = "profiles_list";

    private final SharedPreferences prefs;

    public ProfileManager(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        ensureDefaultProfiles();
    }

    private void ensureDefaultProfiles() {
        if (!prefs.contains(KEY_PROFILES)) {
            List<ConnectionProfile> defaults = new ArrayList<>();
            // Pre-configured profile for user's remote server
            ConnectionProfile herms = ConnectionProfile.fromUrl(
                "Herms AG Remote",
                "wss://pranavkdileep-herms-ag.ms.fun/vnc/websockify",
                ""
            );
            defaults.add(herms);

            ConnectionProfile local = new ConnectionProfile("Local Websockify", "127.0.0.1", 6080, "websockify", "", false);
            defaults.add(local);

            saveAll(defaults);
        }
    }

    public List<ConnectionProfile> getProfiles() {
        List<ConnectionProfile> list = new ArrayList<>();
        String raw = prefs.getString(KEY_PROFILES, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.getJSONObject(i);
                list.add(ConnectionProfile.fromJson(obj));
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return list;
    }

    public void saveProfile(ConnectionProfile profile) {
        List<ConnectionProfile> list = getProfiles();
        boolean found = false;
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).getId().equals(profile.getId())) {
                list.set(i, profile);
                found = true;
                break;
            }
        }
        if (!found) {
            list.add(0, profile);
        }
        saveAll(list);
    }

    public void deleteProfile(String id) {
        List<ConnectionProfile> list = getProfiles();
        for (int i = 0; i < list.size(); i++) {
            if (list.get(i).getId().equals(id)) {
                list.remove(i);
                break;
            }
        }
        saveAll(list);
    }

    public ConnectionProfile getProfile(String id) {
        List<ConnectionProfile> list = getProfiles();
        for (ConnectionProfile p : list) {
            if (p.getId().equals(id)) {
                return p;
            }
        }
        return null;
    }

    /** Finds an already saved profile pointing at the same endpoint. */
    public ConnectionProfile findByEndpoint(String endpoint) {
        if (endpoint == null || endpoint.isEmpty()) return null;
        String needle = endpoint.trim();
        for (ConnectionProfile p : getProfiles()) {
            if (needle.equalsIgnoreCase(p.getEndpointString().trim())) {
                return p;
            }
        }
        return null;
    }

    private void saveAll(List<ConnectionProfile> list) {
        JSONArray arr = new JSONArray();
        for (ConnectionProfile p : list) {
            arr.put(p.toJson());
        }
        prefs.edit().putString(KEY_PROFILES, arr.toString()).apply();
    }
}
