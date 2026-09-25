# Changelog

## 0.9.1

- Replaced the README's sample screenshots (shown on the GitHub page and
  the Home Assistant Info tab) — they still had the old "Night Watch"
  branding. Regenerated from a real report: the summary page now shows
  the Sentinel icon/name and a sensitive-zone urgent banner, and the
  stills page shows the matching orange-highlighted urgent detection.

## 0.9.0

- The ingress panel's report list now shows a one-line summary under each
  PDF's date — the same headline used in the morning brief and push
  notification (e.g. "3 incidents worth a look out of 9 total.") — so a
  specific past night is easy to find without opening each report to
  remember what it was. Written as a small sidecar file alongside each
  PDF; older reports just show with no summary line. Restyled the list
  from a table to stacked cards so the extra line wraps cleanly on a
  phone screen as well as desktop.

## 0.8.0

- Added `push_critical_on_urgent`, sending sensitive-zone-alert pushes as
  critical notifications — bypassing silent mode/Do Not Disturb and
  showing at the top of the lock screen — on both iOS and Android from
  one toggle. Off by default. Requires a one-time permission granted on
  the phone itself for the DND bypass to actually take effect (see
  DOCS.md); without it, the push still arrives louder and more
  immediately, just not guaranteed to break through Do Not Disturb.

## 0.7.0

- Redesigned push notifications to escalate by severity instead of
  listing raw incident data. Quiet, routine, "worth a look", and flagged-
  watchlist nights now get a short headline plus a generic "check the
  report" nudge, rather than timestamps and camera names crowding a phone
  lock screen. Sensitive-zone alerts are the one exception — urgent
  enough to include the actual time/camera by default — controllable via
  the new `push_full_detail_on_urgent` option.

## 0.6.4

- Dropped "UNIFI PROTECT" from the PDF's own header — to avoid any
  impression of Ubiquiti endorsement, it now shows the Protect Sentinel
  icon and name instead. (The report still names UniFi Protect
  descriptively elsewhere, e.g. in the README/DOCS — this only affects
  the report's own masthead.)

## 0.6.3

- Fixed the PDF's own header, which still read "UNIFI PROTECT · OVERNIGHT
  WATCH" — a rename leftover that slipped past earlier text sweeps because
  it was in a different case ("OVERNIGHT WATCH") than what those searches
  looked for. Now reads "UNIFI PROTECT · SENTINEL", with no baked-in
  assumption that the report window is overnight.

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
