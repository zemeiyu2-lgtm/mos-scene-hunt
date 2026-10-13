# Real-device acceptance checklist (v1)

This checklist is for validating the mobile-first GPS game on an actual phone before any production merge. Automated browser tests do not replace outdoor GPS and device-sharing checks.

## Safety rules

- Test only on the preview build; do not merge or deploy to production as part of this checklist.
- Use a disposable test game and test save where possible.
- Do not clear browser data, uninstall the app, or reset storage while checking save persistence.
- Ask for location permission only while using the game. If permission is denied, confirm the UI explains how to enable it.
- Do not publish personal location coordinates in screenshots or bug reports.

## Test setup

- Device and OS:
- Browser:
- Build / commit:
- UI locale: English / 简体中文
- Network: Wi-Fi / mobile data / offline
- Test date and approximate area (no exact home address):

## Required checks

### 1. First launch and language

- [ ] Open the preview on a phone in a fresh browser profile.
- [ ] Confirm the first-visit UI defaults to English.
- [ ] Switch to 简体中文 and confirm the home screen and navigation update.
- [ ] Refresh and confirm the selected UI language remains selected.
- [ ] Switch back to English and confirm game-authored titles, clues, answers, and rewards do not get silently rewritten.

### 2. Location permission and GPS

- [ ] Start a test hunt outdoors in an open area.
- [ ] Grant location permission and confirm the game obtains a location.
- [ ] Deny permission once and confirm a useful recovery message appears.
- [ ] Walk between two safe nearby points and confirm the displayed position updates.
- [ ] Confirm distance-to-target and arrival-radius behavior at a real location.
- [ ] Repeat in a dense/covered area only as an additional test; GPS drift is expected and must not be mistaken for exact indoor positioning.
- [ ] Confirm no test requires entering private property or crossing unsafe roads.

### 3. Save and progress preservation

- [ ] Start a test game and make progress.
- [ ] Refresh the page; confirm the game and progress remain available.
- [ ] Change UI language; confirm progress, inventory, and rewards remain unchanged.
- [ ] Close and reopen the browser; confirm the save is still present.
- [ ] Record any difference between same-browser persistence and cross-device behavior; do not assume saves sync across devices.

### 4. Sharing and QR

- [ ] Create or select a test game package.
- [ ] Use the share action and confirm the resulting link opens on the same phone.
- [ ] Open the link on a second device or a private browser profile.
- [ ] Confirm the intended game/package is loaded and no creator-only data is accidentally exposed.
- [ ] If QR generation is available, scan it using the phone camera and confirm it opens the same intended link.
- [ ] Confirm UI language changes do not rewrite the shared game content.

### 5. Mobile usability

- [ ] Check the home screen and primary actions at narrow phone width.
- [ ] Confirm buttons are readable, tappable, and not obscured by browser controls or the bottom navigation.
- [ ] Check challenge input, submit/feedback, reward view, and return navigation.
- [ ] Rotate the phone if supported and confirm the current task remains usable.
- [ ] Check that long Chinese and English labels do not overlap or clip.

### 6. Offline / weak network (only where supported)

- [ ] After opening the game once, temporarily disable the network.
- [ ] Record which screens remain available and which correctly require a connection.
- [ ] Re-enable the network and confirm the app recovers without losing the current test progress.
- [ ] Do not claim full offline play unless the complete required game flow has been verified offline.

## Results template

For each failed check, record:

- Check number:
- Expected behavior:
- Actual behavior:
- Device / OS / browser:
- UI locale:
- Reproduction steps:
- Screenshot or short recording (remove exact coordinates and personal information):
- Severity: blocker / major / minor

## Release gate

Do not merge the feature branch or deploy to production solely because CI passes. At minimum, complete language persistence, real GPS, save preservation, and share/QR checks on a phone. Record any known limitations and fix blockers before release.
