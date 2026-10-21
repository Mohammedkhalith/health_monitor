# 🩺 IoT-Based Health Monitoring System

## 📌 Project Overview

The **IoT-Based Health Monitoring System** is an embedded systems project designed to monitor and visualize physiological parameters using sensors, an ESP32-S3 microcontroller, MQTT communication, and a web-based dashboard.

The system collects sensor readings, transmits data through the MQTT protocol, and displays the readings on a live health monitoring dashboard.

## 🎯 Objectives

- Monitor heart rate in real time.
- Acquire ECG signals for heart activity visualization.
- Measure Galvanic Skin Response (GSR).
- Monitor breathing activity.
- Transmit sensor data using MQTT.
- Display live readings on a web dashboard.
- Explore IoT-based remote health monitoring.

## 🛠️ Hardware Requirements

| Component | Purpose |
|---|---|
| ESP32-S3 N16R8 | Main microcontroller |
| MAX30102 | Heart rate and SpO₂ sensing |
| AD8232 ECG Sensor | ECG signal acquisition |
| GSR Sensor | Skin conductance measurement |
| Breathing Sensor | Breathing activity measurement |
| DS3231 RTC | Date and time tracking |
| OLED Display (optional) | Local data display |
| Breadboard and jumper wires | Circuit connections |
| USB cable | Power and programming |

## 💻 Software Requirements

- Arduino IDE or Visual Studio Code with PlatformIO
- ESP32 board support package
- Mosquitto MQTT Broker
- MQTT client library for ESP32
- MQTT.js for browser-based MQTT over WebSockets
- HTML, CSS, and JavaScript
- Web browser for dashboard visualization

## ⚙️ System Architecture

1. Sensors collect physiological signals.
2. The ESP32-S3 reads and processes the sensor data.
3. The ESP32 connects to the Wi-Fi network.
4. Sensor readings are published to the Mosquitto MQTT broker.
5. The web dashboard subscribes to MQTT topics through WebSockets.
6. The dashboard updates the displayed values in real time.

**Data flow:**

Sensors → ESP32-S3 → Wi-Fi → MQTT Broker → WebSocket → Web Dashboard

## 📊 Parameters Monitored

| Parameter | Sensor | Description |
|---|---|---|
| Heart Rate (BPM) | MAX30102 | Estimated heart rate |
| SpO₂ (%) | MAX30102 | Estimated blood oxygen saturation |
| ECG | AD8232 | Electrical activity waveform |
| GSR | GSR Sensor | Skin conductance response |
| Breathing | Breathing Sensor | Breathing-related signal |
| Date and Time | DS3231 | Timestamp information |

*Actual measurements depend on sensor availability, wiring, calibration, and firmware implementation.*

## 📡 MQTT Configuration

Example MQTT configuration:

- MQTT TCP Port: `1883`
- MQTT WebSocket Port: `9001`
- Example sensor topic: `biometric/data`
- Example status topic: `biometric/status`

Example JSON message:

```json
{
  "pulse_hr": 75,
  "spo2": 98,
  "ecg_raw": 2048,
  "gsr": 1200,
  "breathing": 18
}
```

The example values are illustrative and do not represent actual patient measurements. Configure the broker address, Wi-Fi credentials, topics, and JSON fields to match your implementation.

## 🌐 Live Dashboard

The web dashboard is intended to display incoming sensor readings and update automatically when new MQTT messages arrive.

Dashboard features may include:

- Real-time sensor values
- ECG waveform visualization
- Heart rate and SpO₂ indicators
- Breathing and GSR readings
- MQTT connection status
- Historical graphs, if data storage is implemented

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd <YOUR_PROJECT_FOLDER>
```

Replace the placeholders with your actual GitHub repository URL and project folder.

### 2. Configure the ESP32

1. Open the ESP32 firmware project in Arduino IDE or PlatformIO.
2. Install the required libraries.
3. Configure your Wi-Fi SSID and password.
4. Set the MQTT broker IP address and port.
5. Verify the sensor pin assignments.
6. Build and upload the firmware to the ESP32-S3.

### 3. Configure Mosquitto

Configure Mosquitto with an MQTT listener on port `1883` and a WebSocket listener on port `9001`.

Ensure that the broker's WebSocket listener is configured for WebSocket transport and that the firewall permits access from authorized devices.

### 4. Run the Web Dashboard

1. Open the dashboard project folder.
2. Configure the MQTT WebSocket URL to point to your broker, for example:

   `ws://YOUR_BROKER_IP:9001`

3. Serve the HTML files using a local development server.
4. Open the dashboard in your browser.
5. Verify that the ESP32 publishes data to the configured MQTT topics.

Use authenticated connections and `wss://` when deploying over HTTPS with a properly configured secure WebSocket endpoint.


Adjust the structure to match the files in your actual repository.

## 🔒 Safety and Limitations

- This project is intended for educational and experimental use.
- It is not a medical device and must not be used to diagnose, treat, or make emergency medical decisions.
- Sensor readings can be affected by movement, electrical noise, poor contact, and calibration.
- Do not publish Wi-Fi passwords, MQTT credentials, or other secrets to GitHub.
- Protect the MQTT broker with authentication and appropriate network access controls.

## 🔮 Future Enhancements

- Cloud-based health data storage
- Historical data visualization
- Alert notifications for configurable thresholds
- Mobile-friendly dashboard
- Secure remote monitoring
- Data export and reporting
- Improved signal filtering and sensor calibration

## 👨‍💻 Applications

- Embedded systems learning
- IoT and MQTT experimentation
- Biomedical sensor prototyping
- Real-time data visualization
- Academic and engineering projects

## 📄 License

Choose a suitable open-source license for your project, such as the MIT License, and add a `LICENSE` file if you intend to distribute the code under that license.

---

**Project:** IoT-Based Health Monitoring System  
**Controller:** ESP32-S3  
**Communication:** MQTT over Wi-Fi  
**Dashboard:** Web-based real-time visualization


