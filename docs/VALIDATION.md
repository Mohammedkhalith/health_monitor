# Validation

Validated on 2026-09-24 using Node.js 24.19.0 on Linux.

| Check | Result |
| --- | --- |
| Frontend dependency install from pinned package versions | Passed |
| React/Vite production build | Passed |
| Backend JavaScript syntax | Passed |
| Protocol tests: null values, missing metrics, invalid numbers, malformed batches, bad versions and commands | 4 tests passed |
| Local serial PTY → actual SerialPort backend → WebSocket | Passed with test-only serial fixture |
| Device handshake and identity | Passed |
| Command acknowledgement, play, pause, phase selection | Passed |
| Stale timeout and serial reconnect | Passed |
| Backend serving compiled React | Passed |
| Browser: empty readings before board connection | Passed |
| Browser: desktop and 390 px mobile layouts | Passed; mobile grid overflow fixed |
| Browser: serial fixture values visible in React | Passed |
| Browser: recording and DUMMY-labeled CSV download | Passed |
| Browser: disconnect clears values while captured export remains available | Passed |
| Browser runtime errors in covered workflow | None |
| ESP32-S3 compile | Not completed: required Arduino platform downloads were unavailable in this execution environment |
| ESP32-S3 physical upload / native USB / USB-UART | Not tested; no physical board attached |
| Windows physical COM-port driver | Not tested here |

The serial fixture was a development test only, not part of the delivered application. Neither backend nor React generates simulated measurements. The supplied DUMMY firmware is the intended producer of simulated readings.

Run Arduino IDE Verify before uploading. Software flow tests do not replace a successful board compile and hardware test.

`npm test` in backend reruns the included protocol tests. Screenshots in this folder show the standalone UI and the software-fixture streaming check; the latter is not evidence of a physical ESP32 test.
