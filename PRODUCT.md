# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users

Mobile users who connect to and control their remote desktops using a phone or tablet.

## Product Purpose

A native Android client for connecting to remote desktops through the noVNC/RFB protocol. Success means users can quickly connect, manage saved server profiles, and interact with a remote desktop using mobile-friendly input and controls.

## Capabilities and Constraints

- Supports WebSocket and secure WebSocket connections to VNC servers.
- Provides quick connect and saved server profiles, including optional remembered passwords.
- Supports virtual trackpad and direct touch, zoom and pan, remote keyboard controls, clipboard sync, and session settings.
- The user requested matching the attached screenshots for the main connection and profile screens, replacing emoji icons with SVG icons, and not introducing app elements absent from the references.
- Confirmed scope: omit unsupported reference-only features (recent screen previews, node/vault destinations, latency/RFB badges); retain only existing noVNC app functionality.
- This is a native Android project with bundled noVNC web assets for the remote desktop session.

## Brand Commitments

- Product name: noVNC Client.
- The supplied reference screenshots are binding visual direction for the connection and profile UI redesign.

## Evidence on Hand

- Existing Android source and assets under `android/`.
- User-provided screenshots of the connection manager and server profile dialog.

## Product Principles

- Make connecting to a saved or new server fast and predictable.
- Keep server configuration clear and usable on narrow mobile screens.
- Preserve remote desktop functionality while making native controls easy to reach.
- Do not add controls or content to the redesigned screens beyond the user's reference and existing required functions.

## Accessibility & Inclusion

Keep labels readable, controls touch-friendly, and switch state understandable without relying on color alone.

## Open Decisions

- The screenshots depict a light, blue-accent visual style; exact brand assets are not confirmed. Preserve the existing noVNC identity where possible and do not fabricate a logo asset.
- SVG icon rendering approach in native Android should respect the current project stack and Android compatibility.

## Reference Scope

The attached references cover the connection manager and the new server profile configuration dialog. No extra navigation destinations or product capabilities should be added beyond existing functionality.

<!-- Confirmed with the user for the Android client UI redesign. -->
