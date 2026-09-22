# Protect Sentinel

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FDirkFace%2Fprotect-sentinel)

Every morning, this Home Assistant add-on asks your UniFi Protect controller
what its cameras saw overnight, turns the answer into a PDF report, and —
if you want — emails it, pushes a phone notification, and publishes the
headline numbers as Home Assistant sensors.

Built for the "did anything happen last night?" question, so you don't have
to scrub the Protect timeline by hand every morning. Includes named
face/plate/camera watchlists, sensitive-zone alerts for cameras that should
see nothing overnight, cross-camera trail tracing, a morning brief, and a
sidebar panel for browsing past reports and running one on demand.

Needs a UniFi Protect controller and cameras with Smart Detections enabled
(most current cameras, G4 and up — not just newer "AI"/G6 models). Named
face/plate watchlist entries specifically need Face Recognition or License
Plate Recognition hardware — see [Requirements](DOCS.md#requirements) in
DOCS.md for the details.

| Summary page | Detection stills |
|---|---|
| ![Summary page](https://raw.githubusercontent.com/DirkFace/protect-sentinel/main/docs/sample-summary.png) | ![Detection stills](https://raw.githubusercontent.com/DirkFace/protect-sentinel/main/docs/sample-stills.png) |

See **[DOCS.md](DOCS.md)** for installation, full configuration reference,
and a walkthrough of everything the report and watch engine can do.
See **[CHANGELOG.md](CHANGELOG.md)** for version history.

---

Originally based on [protect-night-watch](https://github.com/WispAyr/protect-night-watch)
by WispAyr (MIT licensed), substantially extended with watchlists,
sensitive-zone alerts, cross-camera trail tracing, MQTT entities, and more.
