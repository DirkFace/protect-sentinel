# Home Assistant Add-on: Protect Sentinel

Every morning, this add-on asks your UniFi Protect controller what its
cameras saw overnight, turns the answer into a PDF report, and — if you want
— emails it, pushes a phone notification, and publishes the headline numbers
as Home Assistant sensors. It's built for the "did anything happen last
night?" question, so you don't have to scrub the Protect timeline by hand
every morning.

This document covers everything: installation, configuration, what the
report actually contains, and how to set up watchlists, notifications, and
MQTT. If you're setting this up for the first time, read
[Getting started](#getting-started) first, then come back to the reference
sections as you need them.

---

## What it does, in one paragraph

Once a day (or on demand), it queries Protect for smart-detect events
between two times you set (e.g. 23:00–06:00), groups nearby detections on
the same camera into incidents, and renders an A4 PDF: headline counts, a
half-hour activity histogram, a per-camera summary, thumbnails of every
detection, a chronological incident log — plus, if you've configured them,
watchlist matches, cross-camera trail tracing, and a trend note comparing
tonight to recent nights. It can email that PDF, push a short "worth a look"
notification to your phone, and publish live counters as MQTT entities. A
sidebar panel lets you browse past reports and trigger a run on demand.

---

## Requirements

- A UniFi Protect controller (UniFi OS console, Cloud Key, or UDM/UNVR)
  reachable from Home Assistant, with a local account this add-on can log
  in as (see [Install](#1-install) for why it needs to be local rather
  than SSO, and MFA-free).
- **For the core report** (person/vehicle/animal detections, incidents,
  sensitive zones, camera-based watchlist entries): any camera with Smart
  Detections enabled. This is most current UniFi Protect cameras —
  G4-series and newer — not just the newer "AI"-branded or G6 line. G3
  cameras don't support Smart Detections at all, so they'll show as quiet
  all night even if they recorded plenty. Smart Detections also need to
  be turned on **per camera** in Protect itself, separately from having
  compatible hardware.
- **For named face/plate watchlist entries** (`face:Dirk`, `plate:AB12CDE`
  in `watch_list`): this needs Protect's Face Recognition or License
  Plate Recognition specifically, which is narrower than basic Smart
  Detections. You'll need either an AI-series camera (AI Bullet/360/Theta),
  a G5 Pro or G6 camera, or an older G3/G4/G5 camera paired with an AI
  Port or AI Key accessory. Without one of these, the rest of the add-on
  (person/vehicle/animal detection, sensitive zones, `camera:` watchlist
  entries) still works fine — you'd just have nothing to put in the named
  face/plate entries.
- Camera and licensing details change fairly often on Ubiquiti's side, so
  if you're unsure what your own hardware supports, check
  [Ubiquiti's own compatibility page](https://help.ui.com/hc/en-us/articles/360058867233-UniFi-Protect-Cameras-AI-Detections-and-Facial-Recognition)
  rather than relying solely on this document.

---

## Getting started

### 1. Install

Two ways to get this onto your system, depending on where you got it from:

**A — from a GitHub repository (recommended if you got a repo link):**

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**, open the
   **⋮** menu (top right) → **Repositories**, and paste the repository's
   GitHub URL. (Or use the "Add repository to Home Assistant" link in the
   repo's README, which does this in one click.)
2. Find **Protect Sentinel** under its own section in the store and
   click **Install**. This builds a small Docker image straight from the
   repo — it can take a couple of minutes the first time.
3. Once installed, go to the add-on's **Info** tab and enable **"Show in
   sidebar"** if you'd like the ingress panel (see below) one click away.

**B — from a local folder (if you have the files directly, no GitHub repo):**

1. Copy this add-on's folder (as `protect_sentinel`, or any slug you
   prefer) into your `addons` share — usually reachable over Samba, or via
   the **File editor** / **Studio Code Server** add-on if you don't have
   Samba set up.
2. In Home Assistant, go to **Settings → Add-ons → Add-on Store**, open the
   **⋮** menu (top right) and choose **Check for updates** / **Reload** so
   Supervisor picks up the new folder.
3. Find **Protect Sentinel** under "Local add-ons" and click **Install**.
   This builds a small Docker image from the folder — it can take a couple
   of minutes the first time.
4. Once installed, go to the add-on's **Info** tab and enable **"Show in
   sidebar"** if you'd like the ingress panel (see below) one click away.

### 2. Configure the essentials

Open the **Configuration** tab and fill in at minimum:

| Option | What to put |
|---|---|
| `protect_host` | Your UniFi Protect console's IP address, e.g. `192.168.1.134` |
| `protect_username` / `protect_password` | A **local** Protect account — not your Ubiquiti cloud login |
| `protect_verify_tls` | Leave `false` unless your controller has a proper trusted certificate |
| `timezone` | e.g. `Europe/London` — used for the night window and everything time-related in the report |
| `night_start` / `night_end` | The window to report on, as `HH:MM`, e.g. `23:00` and `06:00` (can cross midnight) |

Two things matter for `protect_username`/`protect_password`:

- **Use a dedicated local account with no MFA.** Create one on the console
  itself: **Settings → Admins → Add Admin → Local Access Only**, View Only
  rights on Protect is enough. The login flow can't complete a 2FA
  challenge — it'll fail with a clear error rather than hang, but save
  yourself the trouble and just use an MFA-free account.
- **Local account, not Ubiquiti cloud SSO.** `protect_host` should be the
  console's LAN address, not `unifi.ui.com`. `protect_api_key` is supported
  as an alternative (sent as `X-API-KEY`) if you'd rather generate one, but
  which endpoints accept it varies by firmware — the local account is the
  path known to work consistently.

Save, then go to **Info** and **Start** the add-on.

### 3. (Optional) Email

If you want the PDF emailed each morning, fill in the `smtp_*` and `mail_*`
options (see the [full reference](#configuration-reference) below). Leave
`mail_to` blank to skip email entirely — the PDF is still written to
`/share/protect_sentinel/` and browsable from the sidebar panel either
way.

### 4. Try it

Open the **Sentinel** sidebar panel and click **"Run report now"** — this
runs the full pipeline immediately against whatever your `night_start`/
`night_end` window currently covers, so you can see a real PDF without
waiting for the schedule.

The window is always computed fresh, anchored to **today's date** in your
configured timezone, at the moment you run it:

- If `night_start` is numerically **before** `night_end` (a same-day window,
  e.g. `13:00` → `15:00`), it covers exactly that clock range **today**. So
  setting `13:00`→`15:00` while it's 14:32 gives you today 13:00–15:00 —
  useful for testing against activity happening right now.
- If `night_start` is **after** `night_end` (an overnight window, e.g. the
  default `23:00`→`06:00`), it always covers **yesterday evening through
  this morning**, no matter what time of day you actually click "run".
  Running it at 3pm with the default settings still reports on last night.

So to test against "right now", temporarily switch to a same-day window
that brackets the current time, restart the add-on, run the report, then
**change it back** — otherwise the next scheduled run will silently use a
daytime slot instead of overnight.

---

## What's in the PDF report

- **Cover & summary** — headline counts (incidents, detections, cameras
  active), the busiest half-hour, a per-camera breakdown, and which cameras
  were quiet all night.
- **Watchlist banner** (only if `watch_list` has matches this run) — every
  face/plate/camera match, in one place.
- **Cross-camera trails banner & strips** — see
  [Cross-camera trails](#cross-camera-trails) below.
- **Detection stills** — thumbnails for every detection, grouped by camera,
  each captioned with time, duration, and confidence. A watch-list match
  gets a bold orange border and a `* Name` label; a face or vehicle Protect
  has already named (even if you haven't watch-listed it) gets a plain
  `(Name)` caption instead — see
  [Recognised names vs. watchlist matches](#recognised-names-vs-watchlist-matches).
- **Incident log** — every incident as a table row: start time, duration,
  camera, detection type (Person/Vehicle), an Index column, event count, and
  peak confidence. Index shows a watch-list hit (`* Dirk`) or, in brackets,
  whatever else Protect can offer: a name it's already put on the face or
  vehicle (`(Graham)`), the raw plate for an unnamed vehicle (`(FVG604E)`),
  or `(no match)` for a face that was detected but not recognised — `—`
  only when there's genuinely nothing to show.

## Watchlists

`watch_list` is a comma- or newline-separated list of rules:

```
face:Dirk
face:Loz
plate:SO64FVU
plate:Graham
camera:Front Door
```

- **`face:`** matches a name from a Protect **face group** you've already
  set up (Settings → detections in Protect itself). It's an exact,
  case-insensitive match against the recognised name.
- **`plate:`** matches **either** the raw plate string (`plate:SO64FVU`) or,
  once you've named that vehicle in Protect as a "known vehicle", its
  friendly name (`plate:Graham`) — whichever you use, it keeps working if
  you name the vehicle later. Note: matching is exact against the
  controller's single best OCR read; a genuine misread (0/O confusion, a
  dirty plate) won't match even if the plate is right — this is a known
  limitation, not a bug.
- **`camera:`** matches by camera name, for "tell me about anything on this
  one camera" without setting up face/plate recognition at all.

A watch-list match shows up **everywhere**: the PDF banner, bold-orange
thumbnails, the incident log's Index column, the morning email, the push
notification, and (if MQTT is configured) flips the `watch_match` binary
sensor on.

### Recognised names vs. watchlist matches

Independently of `watch_list`, **any** thumbnail of a face or vehicle
Protect has already named — a face group, or a "known vehicle" like
`Graham` or `Josh's van` — gets that name shown automatically, in plain
`(Name)` text, distinct from a highlighted watch-list hit. This applies
throughout the PDF (stills, trail strips, incident log) but **not** to
notifications or MQTT — those stay reserved for things you've actually
asked to be told about via `watch_list`.

The incident log's Index column goes a step further than the thumbnail
captions elsewhere, since a table row has more room and a clearer purpose:
alongside a recognised name, it also shows the **raw plate** for a vehicle
that was read but never named (`(FVG604E)`), and **`(no match)`** for a
person whose face was detected but didn't match any known group — so you
can tell "nothing to show" apart from "Protect saw something here, it just
couldn't put a name to it".

### Unknown-person flagging

Set `flag_unknown_person: true` to treat a person detection where a face
*was* detected but didn't match any known face group as a watch-list-style
hit (labelled "unrecognised"). This deliberately does **not** fire for a
person detection with no face data at all — that's a data limitation, not
someone worth flagging — so it only lights up when Protect genuinely
attempted recognition and came up empty.

### If a rule doesn't seem to match

Face and plate matching read Protect's own event data directly and need no
configuration to work. If your controller's firmware structures this data
differently and rules aren't matching, `face_name_field` / `plate_name_field`
let you override with a manual dot-path into the raw event — but check
first with the `inspect` command:

```
docker exec <container name> node run-app.mjs inspect --n 5
```

This dumps the last few raw events' JSON so you (or whoever's helping you)
can see the actual field layout.

## Sensitive zones

`sensitive_cameras` is a different concept from `watch_list` above, and
solves a different problem. `watch_list` is for tracking specific known
faces, plates, or cameras against a backdrop of otherwise-normal overnight
activity. A sensitive zone is a camera where the correct baseline is
**nothing at all** — a back garden, a fuel tank compound, a store of
valuable materials — so *any* smart detection there, matched or not,
confident or not, is itself the thing worth knowing about.

```
sensitive_cameras: Rear Garden, Fuel Compound
```

Comma-separated camera names or IDs. By default, a sensitive zone reacts to
whatever's already in `detect_types` — but you can give it its own list
instead:

```
sensitive_cameras: Rear Garden
sensitive_detect_types: person, vehicle, animal
```

`sensitive_detect_types` is independent of `detect_types`, and doesn't have
to overlap with it at all. This matters because a garden camera's correct
overnight baseline usually includes the occasional fox or cat — if you
folded `animal` into the global `detect_types` to catch that, every other
camera's incident log would fill up with wildlife too. Setting it only here
means the rear garden reacts to animals while the rest of the report
doesn't. Leave it blank to just reuse `detect_types`.

One trade-off worth knowing: a type you add here that isn't in the global
`detect_types` list still gets its own preview thumbnail in the urgent
banner (fetched independently, regardless of `max_thumbs_per_camera`) and
still drives the push notification and `sensitive_zone_alert` MQTT sensor
— but it won't get a row in the main incident table or appear in the by-
camera counts, since those are built entirely from the report's main
detection set. You'll see exactly what tripped it and a photo of it in the
urgent banner; you just won't find it listed again further down the report.

Any detection on one of these cameras that matches its type list:

- Is forced to the **top significance tier** regardless of confidence
  score or duration — a single low-confidence blip at 3am counts exactly
  as much as a sustained, high-confidence one, because the point isn't "how
  suspicious does this look", it's "this camera should be clear".
- Gets its own **red "URGENT — SENSITIVE ZONE ACTIVITY" banner** at the very
  top of the PDF, above even the watchlist banner — the first thing you see
  on the page, with a **preview thumbnail for every hit** so you can see at
  a glance what tripped it rather than reading a bare timestamp. Previews
  are fetched specifically for this banner and aren't subject to
  `max_thumbs_per_camera`; a busier-than-expected night caps the banner at
  8 previews with a "+N more" note, but every hit still counts toward
  significance, the push notification and the MQTT sensor below.
- Takes over the **push notification headline** ("URGENT — sensitive zone
  activity"), ahead of any ordinary watchlist match or notable incident.
- Flips a dedicated MQTT **`sensitive_zone_alert`** binary sensor — separate
  from `watch_match` — so you can wire an automation (a light, a siren, a
  more insistent notification) that fires *only* for this, not for every
  routine watchlist hit.

A camera can be both a sensitive zone and hold its own `camera:` watch_list
rule; the two aren't mutually exclusive, but for most sensitive-zone use
cases `sensitive_cameras` alone is what you want — it does not require
setting up face or plate recognition first.

## Cross-camera trails

When detections on different cameras happen close together in time
(configurable via `cross_camera_window_seconds`), they're chained into a
"probable trail" — e.g. someone leaving via the front camera and arriving
at the side camera moments later. This is a **heuristic**: time proximity
and camera adjacency, nothing more. It is explicitly **not** identity
tracking, and the PDF says so wherever a trail appears.

Each trail gets its own numbered thumbnail strip in the PDF — "Cross-camera
trails, in path order" — showing the actual detections left to right in the
order they happened, with arrows between them, so you can follow the path
visually rather than piecing it together from the by-camera stills grid.

## Trend history and the morning brief

The add-on keeps a small rolling history (`trend_lookback_nights`, default
14) of detection counts per hour, so it can note things like "3rd night
this week with activity around 03:00" — context for whether something is
routine or genuinely unusual. This feeds into each incident's significance
score (routine / notable / significant) and the one-line trend note in the
morning brief.

## Push notifications

Set `notify_service` to a Home Assistant notify target (the part after
`notify.`, e.g. `mobile_app_johns_iphone` — check
**Settings → Devices & Services → Mobile App**, or
**Developer Tools → Actions** and search "notify"). `homeassistant_api` is
already enabled in this add-on's manifest, so no extra HA-side permission
setup is needed.

The notification is deliberately short — a lock screen has far less room
than the PDF or email. It's either:

- **"All quiet overnight"** with a one-line detection count, or
- A headline count plus the one or two things actually worth a look, each
  condensed to a short phrase (e.g. `03:42 Front: unusual timing`).

Full detail — every incident, every reason, cross-camera trails — is still
in the PDF and the morning email; the push is just the "should I open this"
signal.

## MQTT entities

Set `mqtt_host` (plus `mqtt_username`/`mqtt_password` if your broker needs
them) to publish state via MQTT auto-discovery. This creates one "Protect
Sentinel" device with seven entities:

- `sensor.last_run` — timestamp of the last completed run
- `sensor.incidents` / `sensor.detections` — counts from that run
- `binary_sensor.watch_match` — on if any watch-list match fired
- `binary_sensor.sensitive_zone_alert` — on if any [sensitive
  zone](#sensitive-zones) camera recorded activity — kept separate from
  `watch_match` so an automation can react specifically to this without
  also firing on ordinary watchlist hits
- `sensor.brief` — the morning brief text
- `sensor.status` — availability, with a proper "offline" last-will state if
  the add-on crashes or stops

Leave `mqtt_host` blank to skip this entirely — nothing assumes a broker is
present.

## Using the ingress panel

Once started, a **Sentinel** icon appears in the HA sidebar (enable
"Show in sidebar" on the add-on's Info tab if it doesn't). It lists every
retained PDF report, lets you **download** any of them, and has a **"Run
report now"** button to trigger the pipeline on demand — handy for testing
changes without waiting for the schedule, or for pulling a report covering
right now rather than last night (see [Getting started](#4-try-it)).

Reports download rather than open inline — deliberately. A PDF rendered
inside the ingress panel's iframe hits a real iOS Safari limitation where an
embedded PDF only ever shows page 1 and won't scroll further; a download
hands the finished file to the OS's own PDF viewer instead, fully outside
any iframe, so multi-page scrolling works properly on every platform.

### Status bar

A small card above the "Run report now" button shows the most recent run's
result at a glance, without needing to open a PDF or check Home Assistant's
entity list:

- **No run yet** — muted, shown before the first run has ever completed.
- **All quiet** — calm styling; last run time plus detection/incident counts.
- **Watchlist match** — amber styling, adds the run's brief headline.
- **⚠ Urgent — sensitive zone activity** — red styling matching the PDF's
  urgent banner, shown whenever the last run flagged a
  [sensitive zone](#sensitive-zones).

This only ever shows the **most recent** run — there's no history here (the
PDFs below are the history). It works identically whether or not MQTT is
configured: it reads a small state file the add-on writes itself after every
run, the same values that get published as MQTT entities when
`mqtt_host` is set.

## Configuration reference

### Protect connection

| Option | Default | Notes |
|---|---|---|
| `protect_host` | — | Controller IP/hostname |
| `protect_port` | `443` | |
| `protect_username` / `protect_password` | — | A **local** Protect account |
| `protect_api_key` | — | Alternative to username/password, if you've generated one |
| `protect_verify_tls` | `false` | Set `true` only if your controller has a trusted cert |

### Report window & filtering

| Option | Default | Notes |
|---|---|---|
| `timezone` | `Europe/London` | IANA zone, used everywhere times are shown |
| `night_start` / `night_end` | `22:00` / `06:00` | `HH:MM`, can cross midnight |
| `detect_types` | `person` | Comma-separated: `person`, `vehicle`, `animal`, `package`, `licensePlate` |
| `min_score` | `0` | Confidence floor, 0–100 |
| `cluster_gap_seconds` | `60` | Detections on the same camera within this gap merge into one incident |
| `include_cameras` / `exclude_cameras` | — | Comma-separated camera name allow/deny list |

### Report content

| Option | Default | Notes |
|---|---|---|
| `report_title` | `Overnight Person Detection Report` | |
| `site_name` | — | Shown on the cover if set |
| `max_thumbs_per_camera` | `12` | Set `0` to disable stills entirely (much smaller/faster PDF) |
| `thumb_width` | `640` | Pixel width fetched from the controller |
| `include_event_table` | `true` | The full incident log page |
| `send_if_empty` | `true` | Whether to still email/notify on a genuinely empty night |
| `retain_days` | `30` | How long PDFs are kept in `/share/protect_sentinel/` |

### Email

| Option | Default |
|---|---|
| `smtp_host` / `smtp_port` / `smtp_secure` | — / `587` / `false` |
| `smtp_user` / `smtp_pass` | — |
| `mail_from` / `mail_to` / `mail_cc` | — |
| `mail_subject` | `{site}Overnight person detections — {date} ({count})` |

Leave `mail_to` blank to disable email.

### Scheduling & logging

| Option | Default |
|---|---|
| `cron` | `30 6 * * *` |
| `log_level` | `info` |

### Watch engine

| Option | Default | Notes |
|---|---|---|
| `watch_list` | — | See [Watchlists](#watchlists) |
| `face_name_field` / `plate_name_field` | — | Manual override only — leave blank |
| `flag_unknown_person` | `false` | See [Unknown-person flagging](#unknown-person-flagging) |
| `sensitive_cameras` | — | See [Sensitive zones](#sensitive-zones) |
| `sensitive_detect_types` | — (uses `detect_types`) | See [Sensitive zones](#sensitive-zones) |
| `cross_camera_window_seconds` | `45` | See [Cross-camera trails](#cross-camera-trails) |
| `trend_lookback_nights` | `14` | See [Trend history](#trend-history-and-the-morning-brief) |
| `morning_summary` | `true` | Adds the brief to the top of the email body |
| `notify_service` | — | See [Push notifications](#push-notifications) |

### MQTT

| Option | Default |
|---|---|
| `mqtt_host` | — (blank disables MQTT) |
| `mqtt_port` | `1883` |
| `mqtt_username` / `mqtt_password` | — |

---

## Notes & limits

- **Smart detections only.** Plain motion events aren't included — on most
  sites they're just noise, and a report nobody trusts gets ignored. This
  also means smart detection needs to be **enabled per camera** in Protect
  itself; a camera with only motion detection will show as quiet all night
  even if it recorded plenty.
- **Detections are not people.** Protect's classifier fires on reflections,
  heavy rain, foxes, and blowing tarpaulin. The confidence score is printed
  on every still so you can judge for yourself, and `min_score` lets you
  raise the floor if false positives are a nuisance.
- **A note on lawfulness.** If you're recording, retaining, and — via this
  add-on — distributing stills of identifiable people, make sure you're
  satisfied that's lawful where you are. In the UK that generally means a
  documented purpose, appropriate signage, and a retention period you can
  justify; `retain_days` exists for that reason.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `Controller demanded MFA` in the logs | The account has 2FA on — make a separate local, MFA-free account |
| `Login failed (HTTP 401)` | Wrong credentials, or an SSO account rather than a local one |
| Zero detections on a night you know was busy | Smart detection must be enabled **per camera** in Protect — motion alone doesn't count |
| Detections but no stills | Protect prunes thumbnails along with the recording — check retention covers the window, or set `max_thumbs_per_camera: 0` if you don't need stills |
| Report looks right, no email | `mail_to` is empty, or SMTP rejected the send — check the add-on logs |
| Opening a report from the sidebar panel shows `401: Unauthorized` when accessing remotely (Nabu Casa, or the companion app away from home) | Fixed as of 0.3.7 — older versions had a link that broke out of the authenticated ingress session into an external browser. Update if you're still seeing this. |
| A downloaded report only shows page 1 and won't scroll further | Fixed as of 0.3.8 — older versions rendered the PDF inline inside the ingress iframe, which iOS Safari only ever shows the first page of. Reports now download instead; open the downloaded file in your device's own PDF viewer. |

### I made a change and it doesn't seem to be having any effect

If you're installed **from a local folder** (see [Install](#1-install)) and
edited the source files directly (rather than just the **Configuration**
tab), a **restart** is not enough — Supervisor needs to rebuild the Docker
image from the folder. To be certain of a clean rebuild:

1. Delete the entire add-on folder from your `addons` share — not just the
   changed files inside it. Copying a new version *over* an existing folder
   with the same filenames can silently keep old files if your file
   manager (Explorer/Finder/Samba client) ever prompts "keep both" or "skip
   existing" during the copy — deleting first removes that risk entirely.
2. Copy the fresh folder in as a clean copy.
3. Fully **uninstall** the add-on in Home Assistant (not just stop it).
4. In the Add-on Store, use **Reload**, then install again.
5. Confirm the **Info** tab shows the version you expect before testing.

If you're installed **from a GitHub repository** instead, this copy-conflict
risk doesn't apply — Supervisor pulls a clean copy from the repo each time.
Use **Check for updates** on the repository (⋮ menu in the Add-on Store), or
a full uninstall/reinstall if an update doesn't show up promptly.

### The container logs mention `SUPERVISOR_TOKEN`

This means `homeassistant_api: true` isn't taking effect — check it's
present in this add-on's manifest (it should be, out of the box) and that
you've fully reinstalled after any change, per above.

### Face/plate watch rules aren't matching

Run the `inspect` command (see
[If a rule doesn't seem to match](#if-a-rule-doesnt-seem-to-match)) and
check the raw event's `metadata.detectedThumbnails` shape actually contains
the name/plate you expect. A common cause is a genuine OCR misread on the
plate (see the note under [Watchlists](#watchlists)) rather than a
configuration problem.

---

## Source

Built on top of the original
[protect-night-watch](https://github.com/WispAyr/protect-night-watch)
project, with a substantial watch/notification/ingress layer added on top.
