# Feeding CalTopo / SARTopo from the mesh

## What this does

Meshtastic and MeshCore radios report position over LoRa. CalTopo and SARTopo do
not speak either protocol, but they do consume **APRS**. SARMesh sits in the
middle: it watches positions arriving on the mesh and re-emits the ones you have
put on the roster as APRS position reports.

```
 field radio ──LoRa──> your node ──USB/BLE/TCP──> SARMesh ──APRS──> CalTopo
```

Positions are picked up wherever they arrive — RF, MQTT, Bluetooth or serial —
because the bridge observes the same node store the rest of the app writes to.

## Three ways out, and which to use

The bridge can emit to three sinks at once. They are not equivalent, and the
difference matters legally as well as operationally.

### 1. Local APRS-IS server — the normal choice

SARMesh runs a TCP server speaking the APRS-IS protocol on `127.0.0.1:14580`.
Anything that can point at an APRS-IS server will connect and receive your
teams' positions: CalTopo Desktop, APRSIS32, YAAC, Xastir, PinPoint.

Nothing is transmitted over RF and nothing reaches the public APRS network, so
**no amateur radio licence is involved** and your team's positions stay on your
machine. Tactical callsigns like `TEAM1` or `K9-2` are fine here — they never
touch a regulated network.

This is the default, and it is what you want unless you have a specific reason
otherwise.

Configure the consumer with:

| Setting  | Value       |
| -------- | ----------- |
| Server   | `127.0.0.1` |
| Port     | `14580`     |
| Callsign | anything    |
| Passcode | `-1`        |

The server accepts any login and marks it unverified, because the feed is
one-way: the client receives, it never injects.

If another machine on the incident network needs the feed, change the bind
address from `127.0.0.1` to `0.0.0.0` on the APRS tab. Treat that as putting
team positions on the local network in clear.

### 2. KISS over TCP — for tools that want a TNC

Some software expects a hardware TNC rather than an APRS-IS feed. SARMesh can
serve KISS-framed AX.25 UI frames on `127.0.0.1:8001` for those. Internet-only
path elements (`TCPIP*`, `qAC`) are stripped, since they are meaningless on an
AX.25 link.

Use this only if your tool has no APRS-IS option.

### 3. Public APRS-IS — read this before enabling it

This pushes positions into the global APRS-IS network, which is how they would
reach cloud SARTopo, aprs.fi and every other APRS consumer worldwide.

**Two things to understand first:**

- It requires a **valid amateur radio callsign and its APRS-IS passcode**.
  Injecting under a callsign that is not yours, or under a made-up tactical
  call, is not acceptable use of the network. SARMesh refuses to start this sink
  without a callsign.
- Everything injected is **public and archived**. Subject locations, team
  positions and search areas become permanently visible on public map sites. For
  most SAR work that alone rules it out.

It is off by default. If the login comes back `unverified`, the passcode does not
match the callsign and the network will silently discard your packets.

## What gets beaconed

Only radios on the roster, on the **APRS** tab. Everything else on the mesh is
ignored, so a busy public mesh does not end up on your incident map.

For each roster entry you set:

- **Callsign** — the APRS source call, e.g. `TEAM1`, `K9-2`, `IC`. Coerced to
  APRS rules automatically (uppercase, max 6 characters plus an optional SSID),
  so "Team 1" becomes `TEAM1` rather than being rejected.
- **Team** — free text, appended to the APRS comment.
- **Type** — see below.
- **On** — a quick enable/disable without losing the configuration.

## Tracker types

Each tracked radio has a type describing what it is in the field. That single
choice drives two things:

- the **APRS symbol** other software renders
- the **icon SARMesh draws** in its own lists and map

so a K9 team looks like a dog everywhere, and nobody has to know that `/p` means
"rover".

| Type             | APRS symbol | Notes                                      |
| ---------------- | ----------- | ------------------------------------------ |
| Ground team      | `/[`        | Jogger / human — a person on foot          |
| K9 team          | `/p`        | "Rover (puppy)", the usual dog-team symbol |
| Hasty team       | `/b`        |                                            |
| UTV / ATV        | `/j`        | Jeep; the closest standard off-road symbol |
| Vehicle          | `/>`        | Car                                        |
| Truck            | `/k`        |                                            |
| Ambulance        | `/a`        |                                            |
| Helicopter       | `/X`        |                                            |
| Aircraft         | `/'`        | Small aircraft                             |
| Boat             | `/s`        |                                            |
| Command post     | `/W`        |                                            |
| Base             | `/-`        | House / QTH, for a fixed incident base     |
| Repeater / relay | `/#`        | Digipeater, for a deployed relay node      |

These symbol codes are from the APRS Protocol Reference 1.0.1 primary table. They
are what other APRS software renders, so they are not free to change once teams
rely on them.

## Beacon rules

Set on the APRS tab:

- **Minimum seconds between beacons** (default 30) — the floor between beacons
  for a single radio, so a chatty node cannot flood the map.
- **Drop fixes older than** (default 900s) — stale positions are worse than no
  position on an incident map. Radios re-report an old fix when GPS is lost.
- **Comment suffix** — appended to every beacon.

Positions with no GPS lock arrive as latitude/longitude `0,0` and are always
dropped.

## Frame format

Uncompressed APRS position reports with a zulu day/hour/minute timestamp, in
TNC2 monitor format:

```
TEAM1>APZSAR,TCPIP*:@141705z3944.35N/10459.42W[090/003/A=005279 Alpha via SARMesh
```

- `TEAM1` — source callsign from the roster
- `APZSAR` — destination. `APZ` is the reserved prefix for experimental
  applications, so SARMesh is identifiable and collides with no registered vendor
- `TCPIP*` — marks the packet as internet-injected, never RF-originated
- `@141705z` — fix time, day 14 at 17:05 UTC
- `3944.35N/10459.42W` — position, with `/` and `[` as the symbol
- `090/003` — course 090° true, 3 knots (converted from metres per second)
- `/A=005279` — altitude in feet (converted from metres)

## Verifying before you deploy

The APRS tab has a **Send test beacon** button. Start the bridge, point CalTopo
at it, send a test beacon at a known coordinate, and confirm it appears on the
map. Do this before the team leaves, not after.

The **Recent beacons** list shows the exact frames emitted, which is the first
place to look if something is not appearing.

## Troubleshooting

**Nothing appears in CalTopo.** Check the sink card on the APRS tab shows a
client count above zero — if it is zero, the consumer never connected, and the
problem is on its side. If a client is connected but no beacons are being sent,
check that the radio is on the roster, is enabled, and has a GPS fix.

**Positions appear but are old.** Raise "drop fixes older than", or check whether
the radio has actually lost GPS and is re-reporting its last known position.

**A radio beacons far too often.** Raise the minimum interval. The bridge rate
limits per radio, not globally.
