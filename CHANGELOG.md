# Changelog

## 0.6.2

- Added a **Requirements** section to DOCS.md (and a short pointer in the
  README) clarifying camera hardware needs: basic Smart Detections work
  on most current UniFi Protect cameras (G4 and up), not just newer
  "AI"/G6 models, while named face/plate watchlist entries specifically
  need Face Recognition / License Plate Recognition hardware.

## 0.6.1

- Added `icon.png` and `logo.png` for the add-on store listing, and this
  changelog.

## 0.6.0

- Renamed the project to **Protect Sentinel** (previously "Protect Night
  Watch v2"), for a clean identity of its own now that it's being shared
  publicly. Updated everywhere this touches: the add-on slug, MQTT device
  and entity names/topics, saved report filenames, the CLI command, and
  all documentation.
- Prepared for GitHub-based add-on repository sharing (installable via
  Settings → Add-ons → Add-on Store → Repositories, rather than only as a
  local folder).

## 0.5.0

- Added a status bar to the ingress panel, showing the most recent run's
  result at a glance — all quiet, a watchlist match, or an urgent
  sensitive-zone alert (matching the PDF's red banner styling) — without
  needing to open a PDF or check Home Assistant's entity list. Reads from
  a small state file the add-on writes itself, so it works identically
  whether or not MQTT is configured.

## 0.4.0 – 0.4.3

- Added **sensitive zones**: cameras that should see no activity at all
  overnight (a back garden, a fuel or materials store). Any smart
  detection there is forced to top significance, gets its own red
  "URGENT" banner at the top of the PDF (with real detection thumbnails),
  takes over the push-notification headline, and flips a dedicated MQTT
  binary sensor — distinct from the ordinary watchlist match.
- Added `sensitive_detect_types`, letting a sensitive camera react to a
  wider or narrower set of smart-detect types than the rest of the report
  (e.g. including "animal" for a garden camera without affecting every
  other camera's log).
- Refined the urgent banner's per-detection detail line to show real
  duration, confidence, and recognised name, rather than a static
  sentence repeated for every row.

## 0.1.0 – 0.3.9

Initial build, forked and substantially extended from
[WispAyr/protect-night-watch](https://github.com/WispAyr/protect-night-watch):

- Nightly PDF report of UniFi Protect smart-detection events during a
  configurable overnight window, with summary and detection-stills pages.
- Watch engine: named face/plate/camera watchlists, unknown-person
  flagging, cross-camera trail tracing, significance scoring, and
  night-over-night trend history.
- A morning brief, optional push notification, and optional email
  delivery.
- An ingress web panel for running a report on demand and browsing past
  PDFs, plus MQTT entity publishing (last run, incident/detection counts,
  watchlist match, status) via auto-discovery.
