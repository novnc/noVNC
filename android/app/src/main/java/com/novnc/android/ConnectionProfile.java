package com.novnc.android;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.Serializable;
import java.util.UUID;

public class ConnectionProfile implements Serializable {
    private String id;
    private String name;
    private String rawUrl;
    private String host;
    private int port; // 0 means default / no port specified
    private String path;
    private String password;
    private boolean rememberPassword;
    private boolean ssl;
    private boolean trackpadMode;
    private boolean scaleViewport;
    private boolean viewOnly;
    private int qualityLevel; // 0-9
    private int compressionLevel; // 0-9
    private long lastConnected;

    public ConnectionProfile() {
        this.id = UUID.randomUUID().toString();
        this.name = "New Connection";
        this.rawUrl = "";
        this.host = "192.168.1.100";
        this.port = 6080;
        this.path = "websockify";
        this.password = "";
        this.rememberPassword = true;
        this.ssl = false;
        this.trackpadMode = true;
        this.scaleViewport = true;
        this.viewOnly = false;
        this.qualityLevel = 6;
        this.compressionLevel = 2;
        this.lastConnected = 0;
    }

    public ConnectionProfile(String name, String host, int port, String path, String password, boolean ssl) {
        this();
        this.name = name;
        this.host = host;
        this.port = port;
        this.path = (path != null) ? path : "";
        this.password = (password != null) ? password : "";
        this.ssl = ssl;
        this.rawUrl = buildUrl(ssl, host, port, path);
    }

    public static ConnectionProfile fromUrl(String name, String urlString, String password) {
        ConnectionProfile p = new ConnectionProfile();
        p.setName(name);
        p.setPassword(password);
        p.setRawUrl(urlString);
        p.parseAndApplyUrl(urlString);
        return p;
    }

    public void parseAndApplyUrl(String url) {
        if (url == null || url.trim().isEmpty()) return;
        url = url.trim();
        this.rawUrl = url;

        boolean isSsl = url.startsWith("wss://") || url.startsWith("https://");
        this.ssl = isSsl;

        String stripped = url;
        if (stripped.startsWith("wss://")) {
            stripped = stripped.substring(6);
        } else if (stripped.startsWith("ws://")) {
            stripped = stripped.substring(5);
        } else if (stripped.startsWith("https://")) {
            stripped = stripped.substring(8);
        } else if (stripped.startsWith("http://")) {
            stripped = stripped.substring(7);
        }

        int slashIdx = stripped.indexOf('/');
        String hostPortPart;
        if (slashIdx >= 0) {
            hostPortPart = stripped.substring(0, slashIdx);
            this.path = stripped.substring(slashIdx + 1);
        } else {
            hostPortPart = stripped;
            this.path = "";
        }

        int colonIdx = hostPortPart.indexOf(':');
        if (colonIdx >= 0) {
            this.host = hostPortPart.substring(0, colonIdx);
            try {
                this.port = Integer.parseInt(hostPortPart.substring(colonIdx + 1));
            } catch (NumberFormatException e) {
                this.port = 0;
            }
        } else {
            this.host = hostPortPart;
            this.port = 0; // No explicit port
        }
    }

    private static String buildUrl(boolean ssl, String host, int port, String path) {
        String proto = ssl ? "wss://" : "ws://";
        boolean omitPort = (port <= 0) || (ssl && port == 443) || (!ssl && port == 80);
        String portPart = omitPort ? "" : (":" + port);
        String pathPart = (path != null && !path.isEmpty()) ? (path.startsWith("/") ? path : ("/" + path)) : "";
        return proto + host + portPart + pathPart;
    }

    public JSONObject toJson() {
        JSONObject json = new JSONObject();
        try {
            json.put("id", id);
            json.put("name", name);
            json.put("rawUrl", getEndpointString());
            json.put("url", getEndpointString());
            json.put("host", host);
            json.put("port", port);
            json.put("path", path);
            json.put("password", rememberPassword ? password : "");
            json.put("rememberPassword", rememberPassword);
            json.put("ssl", ssl);
            json.put("trackpadMode", trackpadMode);
            json.put("scaleViewport", scaleViewport);
            json.put("viewOnly", viewOnly);
            json.put("qualityLevel", qualityLevel);
            json.put("compressionLevel", compressionLevel);
            json.put("lastConnected", lastConnected);
        } catch (JSONException e) {
            e.printStackTrace();
        }
        return json;
    }

    public static ConnectionProfile fromJson(JSONObject json) {
        ConnectionProfile p = new ConnectionProfile();
        p.id = json.optString("id", UUID.randomUUID().toString());
        p.name = json.optString("name", "Connection");
        p.rawUrl = json.optString("rawUrl", json.optString("url", ""));
        p.host = json.optString("host", "localhost");
        p.port = json.optInt("port", 0);
        p.path = json.optString("path", "websockify");
        p.rememberPassword = json.optBoolean("rememberPassword", true);
        p.password = p.rememberPassword ? json.optString("password", "") : "";
        p.ssl = json.optBoolean("ssl", false);
        p.trackpadMode = json.optBoolean("trackpadMode", true);
        p.scaleViewport = json.optBoolean("scaleViewport", true);
        p.viewOnly = json.optBoolean("viewOnly", false);
        p.qualityLevel = json.optInt("qualityLevel", 6);
        p.compressionLevel = json.optInt("compressionLevel", 2);
        p.lastConnected = json.optLong("lastConnected", 0);

        if (p.rawUrl != null && !p.rawUrl.isEmpty()) {
            p.parseAndApplyUrl(p.rawUrl);
        }
        return p;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getRawUrl() { return rawUrl; }
    public void setRawUrl(String rawUrl) { this.rawUrl = rawUrl; }

    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }

    public int getPort() { return port; }
    public void setPort(int port) { this.port = port; }

    public String getPath() { return path; }
    public void setPath(String path) { this.path = path; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public boolean isRememberPassword() { return rememberPassword; }
    public void setRememberPassword(boolean rememberPassword) { this.rememberPassword = rememberPassword; }

    /** True when a password is stored and will be replayed on reconnect. */
    public boolean hasSavedPassword() {
        return rememberPassword && password != null && !password.isEmpty();
    }

    public boolean isSsl() { return ssl; }
    public void setSsl(boolean ssl) { this.ssl = ssl; }

    public boolean isTrackpadMode() { return trackpadMode; }
    public void setTrackpadMode(boolean trackpadMode) { this.trackpadMode = trackpadMode; }

    public boolean isScaleViewport() { return scaleViewport; }
    public void setScaleViewport(boolean scaleViewport) { this.scaleViewport = scaleViewport; }

    public boolean isViewOnly() { return viewOnly; }
    public void setViewOnly(boolean viewOnly) { this.viewOnly = viewOnly; }

    public int getQualityLevel() { return qualityLevel; }
    public void setQualityLevel(int qualityLevel) { this.qualityLevel = qualityLevel; }

    public int getCompressionLevel() { return compressionLevel; }
    public void setCompressionLevel(int compressionLevel) { this.compressionLevel = compressionLevel; }

    public long getLastConnected() { return lastConnected; }
    public void setLastConnected(long lastConnected) { this.lastConnected = lastConnected; }

    public String getEndpointString() {
        if (rawUrl != null && !rawUrl.trim().isEmpty()) {
            return rawUrl.trim();
        }
        return buildUrl(ssl, host, port, path);
    }
}
