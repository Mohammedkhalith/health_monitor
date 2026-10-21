# Serial JSON v1

Transport: serial at 115200 baud, UTF-8/ASCII JSON, one complete object followed by LF. Commands and telemetry share the same bidirectional serial port. Firmware contains no UI. Backend and React contain no simulation generator.

Every board message includes `schema_version:1`, `type`, `device_id`, `boot_id`, `source` (`REAL` or `DUMMY`). Device ID is stable across a board reboot; boot ID changes on boot. A replacement board has a new device ID. The supplied firmware always reports DUMMY.

## Identity

```json
{"schema_version":1,"type":"hello","device_id":"DUMMY-0123456789AB","boot_id":"aabbccdd","source":"DUMMY","firmware":"dummy-1.0.0"}
```

Backend sends `{"type":"command","id":"identify","action":"identify"}` while identifying. Board responds with hello, not ack. An 8-second identity timeout closes incompatible ports. Board startup text is ignored; only validated JSON is forwarded.

## Telemetry

- `sequence`: increasing integer per boot. Duplicates/out-of-order frames are discarded. Backend adds `missing_packets`.
- `uptime_ms`: unsigned board uptime; not wall clock time.
- `phase`: BASELINE / EXPOSURE / RECOVERY / IDLE.
- `running`: false when paused or finished.
- `scenario_ms`: simulated timeline position, 0–210000 in supplied firmware.
- `scene`: 0 beach, 1 alert, 2 tsunami, 3 recovery.
- `metrics`: all numeric metric keys must exist; unavailable values are null.
- `samples`: `rate_hz`, `start_uptime_ms`, and equal-length `ecg`, `resp`, `eeg` arrays. Maximum 256 values per array. The demo uses 50 Hz and usually 10 samples per 200 ms packet.

| Metric | Unit |
| --- | --- |
| pulse_bpm, ecg_bpm | beats/min |
| spo2 | percent |
| resp_bpm | breaths/min |
| rmssd | ms |
| lf_hf, eeg_ratio | ratio |
| gsr | µS |
| eeg_alpha, eeg_beta, eeg_theta, eeg_delta | percent |
| stress | string or null; DUMMY value is a scenario label |

Example packet:

```json
{"schema_version":1,"type":"telemetry","device_id":"DUMMY-0123456789AB","boot_id":"aabbccdd","source":"DUMMY","sequence":20,"uptime_ms":4200,"phase":"BASELINE","running":true,"scenario_ms":3700,"scene":0,"metrics":{"pulse_bpm":72,"ecg_bpm":72,"spo2":98,"resp_bpm":14,"rmssd":48,"lf_hf":1,"gsr":1.8,"eeg_alpha":66,"eeg_beta":14,"eeg_theta":12,"eeg_delta":8,"eeg_ratio":0.2121,"stress":"LOW"},"samples":{"rate_hz":50,"start_uptime_ms":4160,"ecg":[2000,2100,2300],"resp":[1700,1710,1720],"eeg":[2000,2040,1980]}}
```

Sample values are raw-like arbitrary ADC counts in the DUMMY firmware. They are not calibrated voltages. Do not reuse the demo's rate as a real ECG/EEG acquisition specification. The demo's SpO2, RMSSD, LF/HF and EEG bands are intentionally simulated, not derived from its synthetic waveforms.

Backend adds `received_at` (computer epoch milliseconds) and `missing_packets`. These remain in raw JSON exports. At >3 seconds without valid telemetry, the device becomes stale; UI clears live cards/graphs. Receiving a valid new frame recovers the stream. History resets on gaps/reboot to avoid drawing an unbroken line across missing data. Chart horizontal scale is a sample-order window, not an absolute clock axis.

## Commands and acknowledgements

```json
{"type":"command","id":"unique-request-id","action":"phase","phase":"EXPOSURE"}
```

Actions: identify, play, pause, reset, scene (`scene`:0..3), phase (`phase`:allowed string).

```json
{"schema_version":1,"type":"ack","device_id":"DUMMY-0123456789AB","boot_id":"aabbccdd","source":"DUMMY","id":"unique-request-id","ok":true}
```

Reject with `ok:false` and an `error` string. Backend waits 2.5 seconds for matching ack. It never treats a successful serial write alone as board acknowledgement.

## Backend endpoints

- GET `/api/ports`: OS serial ports.
- GET `/api/health`: backend health and connected-device list.
- POST `/api/connect`: `{ "path":"COM7", "baudRate":115200 }`.
- POST `/api/disconnect`: `{ "path":"COM7" }`.
- POST `/api/command`: `{ "device_id":"DUMMY-...", "action":"play" }`.
- WebSocket `/ws`: device-list changes, telemetry and notices.

Backend listens on 127.0.0.1:3001. Vite proxies `/api` and `/ws` during development; the same backend serves the React build for local production use.

Future REAL firmware must add truthful sensor quality/contact fields and supported measurements. Do not label guessed readings as REAL. The current packet validator supports numeric/null measurement values, but real sensor-specific status cards are part of the later REAL integration milestone.
