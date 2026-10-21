# Troubleshooting

| Problem | Action |
| --- | --- |
| `node` or `npm` not recognized | Install Node 24 LTS and reopen CMD / VS Code |
| `npm.ps1 cannot be loaded` in PowerShell | Use Windows CMD for the supplied commands, or use `npm.cmd`; no execution-policy change is needed |
| `ENOENT ... package.json` | You are in the wrong folder. Use the full `cd /d ...\frontend` or `...\backend` path |
| `npm ci` network failure | Initial dependency installation needs internet. Retry with working connectivity; retain the included lockfile |
| Unsupported Node engine | Upgrade to Node 24 LTS |
| Port 5173 / 3001 already in use | Close the older project terminal with Ctrl+C; keep one instance of each server |
| Blank page after double-clicking index.html | Use `npm run dev` and the localhost URL. React source is not a standalone file-open HTML page |
| Waiting for backend | Run `npm start` in backend; keep that CMD open. Use exactly the supplied URL/ports |
| COM port missing | Use a USB data cable, check the board power/connector, Windows Device Manager, and the appropriate USB bridge driver |
| Access denied / port busy | Close Arduino Serial Monitor, Serial Plotter, and other serial apps |
| Board opens but closes after 8 seconds | No compatible identity was received. Verify DUMMY firmware, correct USB connector, CDC setting and current COM port |
| No serial JSON with native USB | Enable USB CDC On Boot and use the native USB connector; re-upload and reset |
| No serial JSON with USB-to-UART bridge | Disable USB CDC On Boot for this sketch so Serial goes to UART0; re-upload |
| ArduinoJson.h missing | Library Manager → ArduinoJson by Benoit Blanchon → install 7.x |
| `JsonDocument` / `.to<JsonObject>()` compilation errors | Check that ArduinoJson 7.x is selected, not 6.x or an unrelated similarly named library |
| DUMMY board connected but cards empty | Select Dummy Board in the header, not Live Hardware |
| Scenario shows PAUSED | Click Play; the video timeline pauses at the end of its duration |
| Upload fails after application connected | Disconnect the device in the application or stop backend, then upload |
| COM changes after flashing | Refresh ports and select the new enumerated COM port |
| Replugged board not streaming | Refresh ports → select its port → Connect USB |
| Browser asks to leave page | A recording is held in the tab. Export CSV/JSON before leaving |
| Session PDF does nothing | Allow pop-ups for localhost; then select Save as PDF in print dialog |
| Old code still shows UI on board IP | You are opening the old ESP32 website. Open the computer URL 127.0.0.1:5173 or production 127.0.0.1:3001 |

If blocked, capture the complete error text, the command/folder used, board selection, ArduinoJson version, and the exact USB connector/CDC setting. Do not post Wi-Fi passwords; this package does not need them.
