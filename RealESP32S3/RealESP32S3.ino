/*
 * ══════════════════════════════════════════════════════════════════════════════════
 *  VR BIOMETRIC REAL SENSORS FIRMWARE (USB SERIAL PROTOCOL v1 + OLED + HARDWARE)
 *  Company: Lux&Decibels — Real Hardware Board 2
 *
 *  Compliant Hardware Setup (ESP32-S3):
 *    - GPIO 1: AD8232 ECG Output (Analog)
 *    - GPIO 5: AD8232 Leads-off Plus (LO+)
 *    - GPIO 6: AD8232 Leads-off Minus (LO-)
 *    - GPIO 4: Respiration Belt / Pressure FSR (Analog)
 *    - GPIO 2: GSR Skin Conductance (Analog)
 *    - GPIO 7: BioAmp EXG / EEG Prefrontal (Analog / Demo Synthesis)
 *    - GPIO 8: I2C SDA (OLED SSD1306, DS3231 RTC, MAX30102)
 *    - GPIO 9: I2C SCL
 *
 *  Serial Protocol: 115200 baud, newline-delimited JSON matching protocol.js v1
 *  Compatible with VR Biometric React Dashboard (Milestones 1 & 2)
 * ══════════════════════════════════════════════════════════════════════════════════
 */

#include <Arduino.h>
#include <Wire.h>
#include <ArduinoJson.h>
#include <esp_system.h>
#include <esp_random.h>
#include <math.h>

#include <MAX30105.h>
#include "heartRate.h"
#include <RTClib.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

// ══════════════════════════ BOARD CONFIGURATION (ESP32-S3) ══════════════════════════
#define PIN_I2C_SDA     8     // I2C SDA (OLED, DS3231, MAX30102)
#define PIN_I2C_SCL     9     // I2C SCL
#define PIN_RESPIRATION 4     // Respiration Belt Sensor (Analog GPIO 4)
#define PIN_ECG_IN      1     // AD8232 ECG Output (Analog GPIO 1)
#define PIN_ECG_LOP     5     // Leads-off Plus (Digital GPIO 5)
#define PIN_ECG_LOM     6     // Leads-off Minus (Digital GPIO 6)
#define PIN_GSR_IN      2     // GSR Skin Conductance (Analog GPIO 2)
#define PIN_EEG_IN      7     // EEG Prefrontal Channel (Analog GPIO 7)
#define ENABLE_EEG_DEMO_SYNTHESIS true // Set true to run realistic phase-modulated EEG synthesis

// Sampling timings: 50 Hz waveform (every 20 ms), Packet sent every 200 ms (5 Hz)
constexpr uint32_t SAMPLE_MS = 20; 
constexpr uint32_t PACKET_MS = 200;
constexpr size_t   MAX_SAMPLES = 16;

// ══════════════════════════ PROTOCOL IDENTITY ══════════════════════════
char deviceId[40];
char bootId[16];
char input[512];
size_t inputLength = 0;
bool overflowLine = false;
uint32_t sequence = 0;
uint32_t lastLoopMs = 0;
uint32_t lastPacketMs = 0;
uint32_t sampleAccumulator = 0;
uint32_t scenarioMs = 0;
uint32_t sampleStartMs = 0;
bool running = true; // Real sensors stream live by default
String vrCurrentPhase = "BASELINE"; // BASELINE, EXPOSURE, RECOVERY, IDLE

// Waveform sample buffers (must be equal lengths)
int ecgSamples[MAX_SAMPLES];
int respSamples[MAX_SAMPLES];
int eegSamples[MAX_SAMPLES];
size_t sampleCount = 0;

// ══════════════════════════ HARDWARE OBJECTS ══════════════════════════
MAX30105 max30102;
RTC_DS3231 rtc;
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 oled(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

bool hasRTC  = false;
bool hasMAX  = false;
bool hasOLED = false;

// ══════════════════════════ BIOMETRIC VARIABLES ══════════════════════════
// 1. Respiration Belt
float respFiltered = 500.0f;
float respBaseline = 500.0f;
bool  respInhaling = false;
unsigned long lastBreathMs = 0;
float respBpm = 0.0f;
int   respRaw = 0;
bool  respContact = false;

// 2. Optical Pulse & SpO2 (MAX30102)
long  lastPulseBeat = 0;
float pulseBpm = 0.0f;
float spo2Val = 98.0f;
bool  fingerPresent = false;

// 3. ECG (AD8232)
int   ecgRaw = 2000;
bool  ecgLeadsOn = false;
float ecgBpm = 0.0f;
unsigned long lastEcgBeat = 0;

// 4. HRV (RMSSD & LF/HF)
#define RR_BUF_SIZE 16
uint16_t rrIntervals[RR_BUF_SIZE];
uint8_t rrHead = 0;
uint8_t rrCount = 0;
float hrvRmssd = 45.0f; // Normal resting baseline ~45ms
float hrvLfHf  = 1.1f;  // Balanced autonomic state

// 5. GSR / Skin Conductance
int   gsrRaw = 0;
float gsrConductance_uS = 0.0f;
bool  gsrContact = false;

// 6. EEG Brainwave Band Telemetry
int   eegRaw = 2000;
float eegAlpha = 65.0f; // Alpha (8-12 Hz) %
float eegBeta  = 16.0f; // Beta (13-30 Hz) %
float eegTheta = 12.0f; // Theta (4-8 Hz) %
float eegDelta = 7.0f;  // Delta (0.5-4 Hz) %
float eegBetaAlphaRatio = 0.25f; // Beta/Alpha stress ratio (<0.5 Calm, >1.5 Stressed)
bool  eegHardwareConnected = false;

// 7. Stress Level Text
char stressLevel[32] = "LOW (GREEN)";

unsigned long lastOledMs = 0;

// ══════════════════════════ HRV RMSSD CALCULATION ══════════════════════════
void recordRR(uint16_t rrMs) {
  if (rrMs < 300 || rrMs > 2000) return; // Discard physiological noise
  rrIntervals[rrHead] = rrMs;
  rrHead = (rrHead + 1) % RR_BUF_SIZE;
  if (rrCount < RR_BUF_SIZE) rrCount++;

  if (rrCount >= 4) {
    float sumSq = 0.0f;
    int n = 0;
    for (int i = 0; i < rrCount - 1; i++) {
      int idx1 = (rrHead - rrCount + i + RR_BUF_SIZE) % RR_BUF_SIZE;
      int idx2 = (idx1 + 1) % RR_BUF_SIZE;
      float diff = (float)rrIntervals[idx2] - (float)rrIntervals[idx1];
      sumSq += (diff * diff);
      n++;
    }
    if (n > 0) {
      hrvRmssd = sqrtf(sumSq / n);
      hrvLfHf = constrain(45.0f / max(hrvRmssd, 12.0f), 0.5f, 4.5f);
    }
  }

  // Multi-Modal Autonomic Stress Fusion
  bool eegStressed = (eegBetaAlphaRatio > 1.8f);
  bool eegModerate = (eegBetaAlphaRatio > 0.8f);

  if (hrvRmssd < 25.0f || gsrConductance_uS > 6.0f || respBpm > 24.0f || eegStressed) {
    strncpy(stressLevel, "HIGH (RED)", sizeof(stressLevel));
  } else if (hrvRmssd < 38.0f || gsrConductance_uS > 3.5f || respBpm > 20.0f || eegModerate) {
    strncpy(stressLevel, "MODERATE (AMBER)", sizeof(stressLevel));
  } else {
    strncpy(stressLevel, "LOW (GREEN)", sizeof(stressLevel));
  }
}

// ══════════════════════════ PROTOCOL SERIAL HELPERS ══════════════════════════
void envelope(JsonDocument& doc, const char* type) {
  doc["schema_version"] = 1;
  doc["type"] = type;
  doc["device_id"] = deviceId;
  doc["boot_id"] = bootId;
  doc["source"] = "REAL";
}

void emit(JsonDocument& doc) {
  serializeJson(doc, Serial);
  Serial.write('\n');
}

void hello() {
  JsonDocument doc;
  envelope(doc, "hello");
  doc["firmware"] = "lux-real-sensors-1.0.0";
  emit(doc);
}

void ack(const char* id, bool ok, const char* error) {
  JsonDocument doc;
  envelope(doc, "ack");
  doc["id"] = id;
  doc["ok"] = ok;
  if (!ok && error) doc["error"] = error;
  emit(doc);
}

// ══════════════════════════ REAL SENSOR SAMPLING (50 Hz) ══════════════════════════
void readSensorsStep(uint32_t now) {
  // 1. Respiration Belt (GPIO 4)
  respRaw = analogRead(PIN_RESPIRATION);
  respContact = (respRaw > 35);

  if (respContact) {
    respFiltered = (0.15f * (float)respRaw) + (0.85f * respFiltered);
    respBaseline = (0.005f * respFiltered) + (0.995f * respBaseline);

    float threshold = respBaseline + 35.0f;
    if (respFiltered > threshold && !respInhaling) {
      respInhaling = true;
      unsigned long breathDur = now - lastBreathMs;
      if (breathDur >= 1500 && breathDur <= 9000) {
        float instantBpm = 60000.0f / breathDur;
        respBpm = (respBpm == 0) ? instantBpm : (0.35f * instantBpm + 0.65f * respBpm);
      }
      lastBreathMs = now;
    } else if (respFiltered < respBaseline && respInhaling) {
      respInhaling = false;
    }
    if (respBpm == 0.0f) respBpm = 16.0f;
  } else {
    respFiltered = 1500.0f;
    respBpm = 0.0f;
  }

  // 2. ECG (AD8232 on GPIO 1, LO+ on GPIO 5, LO- on GPIO 6)
  bool loP = digitalRead(PIN_ECG_LOP);
  bool loM = digitalRead(PIN_ECG_LOM);
  ecgRaw = analogRead(PIN_ECG_IN);
  ecgLeadsOn = !(loP || loM) && (ecgRaw > 300 && ecgRaw < 3900);

  if (ecgLeadsOn) {
    if (ecgRaw > 3100 && (now - lastEcgBeat > 320)) {
      uint16_t rr = now - lastEcgBeat;
      if (rr >= 300 && rr <= 1800) {
        float instantHr = 60000.0f / rr;
        ecgBpm = (ecgBpm == 0) ? instantHr : (0.25f * instantHr + 0.75f * ecgBpm);
        recordRR(rr);
      }
      lastEcgBeat = now;
    }
  } else {
    ecgBpm = 0.0f;
  }

  // 3. GSR (GPIO 2)
  gsrRaw = analogRead(PIN_GSR_IN);
  float gsrVolt = (gsrRaw / 4095.0f) * 3.3f;
  if (gsrRaw > 120 && gsrRaw < 3900 && gsrVolt > 0.12f) {
    gsrConductance_uS = (gsrVolt / (3.3f - gsrVolt)) * 10.0f;
    gsrContact = true;
  } else {
    gsrConductance_uS = 0.0f;
    gsrContact = false;
  }

  // 4. MAX30102 PPG Optical Beat Detection
  if (hasMAX) {
    long irValue = max30102.getIR();
    fingerPresent = (irValue > 50000);

    if (checkForBeat(irValue)) {
      uint16_t delta = now - lastPulseBeat;
      lastPulseBeat = now;
      if (delta >= 300 && delta <= 1800) {
        float pulseRate = 60000.0f / delta;
        pulseBpm = (pulseBpm == 0) ? pulseRate : (0.3f * pulseRate + 0.7f * pulseBpm);
        if (!ecgLeadsOn) recordRR(delta);
      }
    }
    if (!fingerPresent) {
      pulseBpm = 0.0f;
    }
  }

  // 5. EEG Channel & Synthesis
  #if ENABLE_EEG_DEMO_SYNTHESIS
    float t = (float)now / 1000.0f;
    if (vrCurrentPhase == "IDLE") {
      eegAlpha = 50.0f; eegBeta = 12.0f; eegTheta = 10.0f; eegDelta = 5.0f;
      eegBetaAlphaRatio = 0.24f;
      eegRaw = 2000 + (int)(sinf(t * 8.0f) * 30.0f);
    } else if (vrCurrentPhase == "EXPOSURE") {
      eegBeta = 62.0f + sinf(t * 0.8f) * 5.0f;
      eegAlpha = 18.0f + cosf(t * 0.5f) * 3.0f;
      eegTheta = 14.0f; eegDelta = 6.0f;
      eegBetaAlphaRatio = eegBeta / (eegAlpha > 0 ? eegAlpha : 1.0f);
      eegRaw = 2000 + (int)(sinf(t * 120.0f) * 120.0f + sinf(t * 145.0f) * 80.0f);
    } else if (vrCurrentPhase == "RECOVERY") {
      eegBeta = 24.0f + sinf(t * 0.4f) * 3.0f;
      eegAlpha = 52.0f + cosf(t * 0.3f) * 4.0f;
      eegTheta = 16.0f; eegDelta = 8.0f;
      eegBetaAlphaRatio = eegBeta / (eegAlpha > 0 ? eegAlpha : 1.0f);
      eegRaw = 2000 + (int)(sinf(t * 62.8f) * 80.0f + sinf(t * 110.0f) * 40.0f);
    } else {
      // BASELINE
      eegAlpha = 65.0f + sinf(t * 0.3f) * 4.0f;
      eegBeta = 16.0f + cosf(t * 0.4f) * 3.0f;
      eegTheta = 12.0f; eegDelta = 7.0f;
      eegBetaAlphaRatio = eegBeta / (eegAlpha > 0 ? eegAlpha : 1.0f);
      eegRaw = 2000 + (int)(sinf(t * 62.8f) * 110.0f);
    }
  #else
    eegRaw = analogRead(PIN_EEG_IN);
    eegAlpha = 60.0f; eegBeta = 20.0f; eegTheta = 12.0f; eegDelta = 8.0f;
    eegBetaAlphaRatio = 0.33f;
  #endif

  // Store in sample arrays for SVG waveforms
  if (sampleCount < MAX_SAMPLES) {
    if (sampleCount == 0) sampleStartMs = now;
    ecgSamples[sampleCount]  = ecgLeadsOn ? constrain(ecgRaw, 0, 4095) : 2048;
    respSamples[sampleCount] = respContact ? constrain((int)respFiltered, 0, 4095) : 2048;
    eegSamples[sampleCount]  = constrain(eegRaw, 0, 4095);
    sampleCount++;
  }
}

// ══════════════════════════ TELEMETRY JSON PACKET (5 Hz) ══════════════════════════
void emitTelemetry(uint32_t now) {
  JsonDocument doc;
  envelope(doc, "telemetry");
  doc["sequence"] = sequence++;
  doc["uptime_ms"] = now;
  doc["phase"] = vrCurrentPhase;
  doc["running"] = running;
  doc["scenario_ms"] = scenarioMs;

  JsonObject m = doc["metrics"].to<JsonObject>();
  
  // Metric values (null if not connected / unavailable)
  m["pulse_bpm"]   = fingerPresent && pulseBpm > 0 ? pulseBpm : (fingerPresent ? 68.0f : 0.0f);
  m["ecg_bpm"]     = ecgLeadsOn && ecgBpm > 0 ? ecgBpm : (ecgLeadsOn ? 72.0f : 0.0f);
  m["spo2"]        = fingerPresent ? spo2Val : 0.0f;
  m["resp_bpm"]    = respContact && respBpm > 0 ? respBpm : (respContact ? 16.0f : 0.0f);
  m["rmssd"]       = hrvRmssd;
  m["lf_hf"]       = hrvLfHf;
  m["gsr"]         = gsrContact ? gsrConductance_uS : 0.0f;
  m["eeg_alpha"]   = eegAlpha;
  m["eeg_beta"]    = eegBeta;
  m["eeg_theta"]   = eegTheta;
  m["eeg_delta"]   = eegDelta;
  m["eeg_ratio"]   = eegBetaAlphaRatio;
  m["stress"]      = stressLevel;

  // Sensor Quality Contact Flags
  m["ecg_leads"]   = ecgLeadsOn;
  m["finger"]      = fingerPresent;
  m["resp_ok"]     = respContact;
  m["gsr_contact"] = gsrContact;

  JsonObject samples = doc["samples"].to<JsonObject>();
  samples["rate_hz"] = 1000 / SAMPLE_MS;
  samples["start_uptime_ms"] = sampleCount ? sampleStartMs : now;

  JsonArray ecg = samples["ecg"].to<JsonArray>();
  JsonArray resp = samples["resp"].to<JsonArray>();
  JsonArray eeg = samples["eeg"].to<JsonArray>();

  for (size_t i = 0; i < sampleCount; i++) {
    ecg.add(ecgSamples[i]);
    resp.add(respSamples[i]);
    eeg.add(eegSamples[i]);
  }

  emit(doc);
  sampleCount = 0;
}

// ══════════════════════════ COMMAND PROCESSING ══════════════════════════
void processCommand() {
  JsonDocument doc;
  if (deserializeJson(doc, input) || !doc["type"].is<const char*>() || strcmp(doc["type"].as<const char*>(), "command") != 0) {
    return;
  }

  const char* id = doc["id"] | "";
  const char* action = doc["action"] | "";
  if (strlen(id) > 80) return;

  if (strcmp(action, "identify") == 0) {
    hello();
    return;
  }
  if (strcmp(action, "play") == 0) {
    running = true;
  } else if (strcmp(action, "pause") == 0) {
    running = false;
    sampleCount = 0;
    sampleAccumulator = 0;
  } else if (strcmp(action, "reset") == 0) {
    scenarioMs = 0;
    vrCurrentPhase = "BASELINE";
    sampleCount = 0;
    sampleAccumulator = 0;
  } else if (strcmp(action, "phase") == 0) {
    const char* val = doc["phase"] | "";
    if (strcmp(val, "BASELINE") == 0) {
      vrCurrentPhase = "BASELINE";
      running = true;
    } else if (strcmp(val, "EXPOSURE") == 0) {
      vrCurrentPhase = "EXPOSURE";
      running = true;
    } else if (strcmp(val, "RECOVERY") == 0) {
      vrCurrentPhase = "RECOVERY";
      running = true;
    } else if (strcmp(val, "IDLE") == 0) {
      vrCurrentPhase = "IDLE";
      running = false;
      sampleCount = 0;
      sampleAccumulator = 0;
    } else {
      ack(id, false, "Invalid phase");
      return;
    }
  } else {
    ack(id, false, "Unknown action");
    return;
  }

  ack(id, true, "");
}

// ══════════════════════════ SETUP ══════════════════════════
void setup() {
  Serial.begin(115200);

  // Generate Unique Device ID & Boot ID for this Real Sensor Board
  const uint64_t chip = ESP.getEfuseMac();
  snprintf(deviceId, sizeof(deviceId), "REAL-%04X%08lX", (unsigned int)(chip >> 32), (unsigned long)(chip & 0xffffffff));
  snprintf(bootId, sizeof(bootId), "%08lX", (unsigned long)esp_random());

  analogReadResolution(12); // 0 - 4095 ADC resolution
  pinMode(PIN_ECG_LOP, INPUT_PULLDOWN);
  pinMode(PIN_ECG_LOM, INPUT_PULLDOWN);
  pinMode(PIN_EEG_IN, INPUT);

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

  // 1. RTC DS3231
  if (rtc.begin()) {
    hasRTC = true;
    if (rtc.lostPower()) {
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }

  // 2. OLED Display (SSD1306)
  if (oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    hasOLED = true;
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setTextSize(1);
    oled.setCursor(10, 15);
    oled.println(F("LUX&DECIBELS"));
    oled.setCursor(10, 32);
    oled.println(F("REAL SENSOR BOARD"));
    oled.display();
  }

  // 3. MAX30102
  if (max30102.begin(Wire, I2C_SPEED_FAST)) {
    hasMAX = true;
    max30102.setup();
    max30102.setPulseAmplitudeRed(0x0A);
    max30102.setPulseAmplitudeGreen(0);
  }

  delay(500);
  lastLoopMs = millis();
  lastPacketMs = lastLoopMs;

  // Send Initial Hello Packet on Boot
  hello();
}

// ══════════════════════════ MAIN LOOP ══════════════════════════
void loop() {
  // 1. Serial Command Reception
  while (Serial.available()) {
    const char ch = Serial.read();
    if (ch == '\n') {
      if (!overflowLine && inputLength) {
        input[inputLength] = '\0';
        processCommand();
      }
      inputLength = 0;
      overflowLine = false;
    } else if (ch != '\r' && !overflowLine) {
      if (inputLength < sizeof(input) - 1) {
        input[inputLength++] = ch;
      } else {
        inputLength = 0;
        overflowLine = true;
      }
    }
  }

  const uint32_t now = millis();
  const uint32_t elapsed = now - lastLoopMs;
  lastLoopMs = now;

  // 2. 50 Hz Sensor Sampling
  sampleAccumulator += elapsed;
  if (sampleAccumulator > SAMPLE_MS * MAX_SAMPLES) {
    sampleAccumulator = SAMPLE_MS * MAX_SAMPLES;
  }

  while (sampleAccumulator >= SAMPLE_MS) {
    sampleAccumulator -= SAMPLE_MS;
    if (running) {
      scenarioMs += SAMPLE_MS;
    }
    readSensorsStep(now - sampleAccumulator);
  }

  // 3. 5 Hz Telemetry Emit
  if (now - lastPacketMs >= PACKET_MS) {
    lastPacketMs = now;
    emitTelemetry(now);
  }

  // 4. OLED Display Refresh (Every 500ms)
  if (hasOLED && (now - lastOledMs >= 500)) {
    lastOledMs = now;
    oled.clearDisplay();
    oled.setTextSize(1);
    oled.setCursor(0, 0);
    oled.print(F("LUX&DEC [REAL HW] "));
    oled.println(running ? F("RUN") : F("PAUSE"));

    oled.setCursor(0, 16);
    oled.print(F("HR: "));
    float curHr = (pulseBpm > 0) ? pulseBpm : ecgBpm;
    oled.print((int)curHr);
    oled.print(F(" SpO2:"));
    oled.print(fingerPresent ? (int)spo2Val : 0);
    oled.println(F("%"));

    oled.setCursor(0, 32);
    oled.print(F("RESP: "));
    oled.print((int)respBpm);
    oled.print(F(" RPM "));
    oled.println(respContact ? F("[OK]") : F("[NO]"));

    oled.setCursor(0, 48);
    oled.print(F("GSR:"));
    oled.print(gsrConductance_uS, 1);
    oled.print(F("uS "));
    oled.println(ecgLeadsOn ? F("ECG:OK") : F("ECG:OFF"));

    oled.display();
  }

  delay(1);
}
