import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { useBridge } from './useBridge.js';
import Waveform from './components/Waveform.jsx';

const fmt = (n, places = 0) =>
  Number.isFinite(n) ? n.toFixed(places) : '--';

const timer = n =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(
    Math.floor(n % 60)
  ).padStart(2, '0')}`;

const videos = [
  'VR | High Dive Coaster POV',
  '360° High Speed Trains',
  '360 Tsunami After Asteroid Fall'
];

const videoDurations = [
  173000,
  66000,
  82000
];

const metricKeys = [
  'ecg_bpm',
  'pulse_bpm',
  'spo2',
  'resp_bpm',
  'rmssd',
  'lf_hf',
  'gsr',
  'eeg_alpha',
  'eeg_beta',
  'eeg_theta',
  'eeg_delta',
  'eeg_ratio',
  'stress'
];

const MAX_ROWS = 18000;

function Metric({
  name,
  value,
  unit,
  detail,
  color
}) {
  return (
    <article className={`metric-card card-${color}`}>
      <div className="metric-label">
        {name}
      </div>

      <div className="metric-value-row">
        <span className="metric-value">
          {value}
        </span>

        <span className="metric-unit">
          {unit}
        </span>
      </div>

      <div className="metric-subtext">
        {detail}
      </div>
    </article>
  );
}

function download(name, content, mime) {
  const url = URL.createObjectURL(
    new Blob([content], {
      type: mime
    })
  );

  const link = document.createElement('a');

  link.href = url;
  link.download = name;
  link.click();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export default function App() {
  const [bridgeEnabled, setBridgeEnabled] =
    useState(false);

  const [source, setSource] =
    useState('REAL');

  const [selectedId, setSelectedId] =
    useState('');

  const [ports, setPorts] =
    useState([]);

  const [port, setPort] =
    useState('');

  const [baud, setBaud] =
    useState('115200');

  const [busy, setBusy] =
    useState(false);

  const [notice, setNotice] = useState(
    'UI ready. Boards are optional for opening this dashboard.'
  );

  const [frames, setFrames] =
    useState({});

  const [clock, setClock] =
    useState(Date.now());

  const [participant, setParticipant] =
    useState('SUBJ-001');

  const [recording, setRecording] =
    useState(false);

  const [session, setSession] =
    useState(null);

  const [rows, setRows] =
    useState([]);

  const recordingRef = useRef({
    active: false
  });

  const onNotice = useCallback(
    message => {
      setNotice(message);
    },
    []
  );

  const onFrame = useCallback(packet => {
    setFrames(previousFrames => {
      const old =
        previousFrames[packet.device_id];

      const reset =
        !old ||
        old.boot_id !== packet.boot_id ||
        packet.sequence <= old.sequence ||
        packet.missing_packets > 0 ||
        packet.received_at -
          old.received_at >
          3000 ||
        old.video_id !== packet.video_id ||
        packet.scenario_ms <
          old.scenario_ms;

      const histories =
        reset ? {} : old.histories;

      const append = (
        key,
        values,
        maximum
      ) => [
        ...(histories[key] || []),
        ...values
      ].slice(-maximum);

      return {
        ...previousFrames,

        [packet.device_id]: {
          ...packet,

          histories: {
            ecg: append(
              'ecg',
              packet.samples.ecg,
              500
            ),

            resp: append(
              'resp',
              packet.samples.resp,
              500
            ),

            eeg: append(
              'eeg',
              packet.samples.eeg,
              500
            ),

            gsr: append(
              'gsr',
              packet.running &&
                Number.isFinite(
                  packet.metrics.gsr
                )
                ? [packet.metrics.gsr]
                : [],
              150
            ),

            pulse: append(
              'pulse',
              packet.running &&
                Number.isFinite(
                  packet.metrics.pulse_bpm
                )
                ? [
                    packet.metrics
                      .pulse_bpm
                  ]
                : [],
              150
            ),

            ecgBpm: append(
              'ecgBpm',
              packet.running &&
                Number.isFinite(
                  packet.metrics.ecg_bpm
                )
                ? [
                    packet.metrics.ecg_bpm
                  ]
                : [],
              150
            )
          }
        }
      };
    });

    const current =
      recordingRef.current;

    if (
      current.active &&
      current.deviceId ===
        packet.device_id &&
      packet.running
    ) {
      const row = {
        ...packet,
        participant:
          current.participant,
        session_id:
          current.sessionId
      };

      setRows(previousRows =>
        previousRows.length < MAX_ROWS
          ? [...previousRows, row]
          : previousRows
      );
    }
  }, []);

  const {
    online,
    devices
  } = useBridge(
    bridgeEnabled,
    onFrame,
    onNotice
  );

  const candidates = devices.filter(
    device =>
      (device.source === source || (source === 'PROFILE' && device.source === 'DUMMY')) &&
      device.device_id
  );

  const otherCandidates = devices.filter(
    device =>
      device.device_id &&
      !candidates.some(c => c.device_id === device.device_id)
  );

  const device =
    candidates.find(
      item =>
        item.device_id === selectedId
    ) || candidates[0];

  const frame = device
    ? frames[device.device_id]
    : undefined;

  const fresh = Boolean(
    online &&
      device?.status === 'connected' &&
      frame &&
      clock - frame.received_at < 3000
  );

  const connected = Boolean(
    online &&
      device?.status === 'connected'
  );

  const metrics =
    fresh ? frame.metrics : {};

  const histories =
    fresh ? frame.histories : {};

  const activeVideoId =
    fresh &&
    Number.isInteger(frame?.video_id) &&
    frame.video_id >= 0 &&
    frame.video_id < videos.length
      ? frame.video_id
      : 0;

  const activeVideoDuration =
    fresh &&
    Number.isFinite(
      frame?.video_duration_ms
    ) &&
    frame.video_duration_ms > 0
      ? frame.video_duration_ms
      : videoDurations[
          activeVideoId
        ];

  useEffect(() => {
    const intervalId = setInterval(
      () => {
        setClock(Date.now());
      },
      500
    );

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (
      rows.length >= MAX_ROWS &&
      recording
    ) {
      recordingRef.current.active =
        false;

      setRecording(false);

      setNotice(
        'Recording limit reached. Export this session before starting another.'
      );
    }
  }, [
    rows.length,
    recording
  ]);

  useEffect(() => {
    const warn = event => {
      if (rows.length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener(
      'beforeunload',
      warn
    );

    return () => {
      window.removeEventListener(
        'beforeunload',
        warn
      );
    };
  }, [rows.length]);

  async function run(task) {
    setBusy(true);

    try {
      await task();
    } catch (error) {
      setNotice(
        error.message ||
          'Unable to complete request.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function refreshPorts() {
    await run(async () => {
      const result =
        await api('ports');

      setPorts(result.ports);

      setPort(currentPort =>
        result.ports.some(
          item =>
            item.path === currentPort
        )
          ? currentPort
          : result.ports[0]?.path || ''
      );

      setNotice(
        result.ports.length
          ? 'Select the board port, then Connect USB.'
          : 'No serial ports found. Check the USB data cable and board driver.'
      );
    });
  }

  function command(
    action,
    extras = {}
  ) {
    if (!device) {
      return;
    }

    return run(async () => {
      await api('command', {
        device_id:
          device.device_id,
        action,
        ...extras
      });

      setNotice(
        `Board acknowledged: ${action}.`
      );
    });
  }

  function startRecording() {
    if (!fresh) {
      return;
    }

    if (
      rows.length &&
      !window.confirm(
        'Start a new recording? Export the current session first. Starting replaces the in-memory session.'
      )
    ) {
      return;
    }

    const info = {
      id: crypto.randomUUID(),

      participant:
        participant.trim() ||
        'SUBJ-001',

      source,

      deviceId:
        device.device_id,

      videoId:
        source === 'PROFILE'
          ? activeVideoId
          : null,

      videoName:
        source === 'PROFILE'
          ? videos[activeVideoId]
          : null,

      startedAt:
        new Date().toISOString()
    };

    setSession(info);
    setRows([]);
    setRecording(true);

    recordingRef.current = {
      active: true,
      deviceId:
        info.deviceId,
      participant:
        info.participant,
      sessionId:
        info.id
    };

    setNotice(
      'Recording received packets in this browser tab. Export before closing.'
    );
  }

  function stopRecording() {
    recordingRef.current.active =
      false;

    setRecording(false);

    setNotice(
      'Recording stopped. Export CSV / JSON or print the session summary.'
    );
  }

  function exportCsv() {
    const activeSession = session || {
      source: source || 'SESSION',
      id: 'export',
      participant: participant.trim() || 'SUBJ-001',
      deviceId: device?.device_id || 'UNKNOWN'
    };

    const headers = [
      'session_id',
      'participant',
      'source',
      'device_id',
      'boot_id',
      'sequence',
      'received_at',
      'uptime_ms',
      'video_id',
      'video_name',
      'video_duration_ms',
      'scenario_ms',
      'phase',
      ...metricKeys
    ];

    const quote = value => {
      const raw =
        value == null
          ? ''
          : String(value);

      const safe =
        /^[=+@\-]/.test(raw)
          ? `'${raw}`
          : raw;

      return `"${safe.replaceAll(
        '"',
        '""'
      )}"`;
    };

    const lines = rows.map(row =>
      headers
        .map(key => {
          let value;

          if (
            key === 'received_at'
          ) {
            value = new Date(
              row.received_at
            ).toISOString();
          } else if (
            Object.prototype.hasOwnProperty.call(
              row,
              key
            )
          ) {
            value = row[key];
          } else {
            value =
              row.metrics?.[key];
          }

          return quote(value);
        })
        .join(',')
    );

    download(
      `${activeSession.source}_${activeSession.id}.csv`,
      '\uFEFF' +
        [
          headers.join(','),
          ...lines
        ].join('\r\n'),
      'text/csv;charset=utf-8'
    );
  }

  function printSummary() {
    const activeSession = session || {
      source: source || 'SESSION',
      id: 'export',
      participant: participant.trim() || 'SUBJ-001',
      deviceId: device?.device_id || 'UNKNOWN',
      startedAt: new Date().toISOString()
    };

    const printWindow =
      window.open('', '_blank');

    if (!printWindow) {
      setNotice(
        'Allow pop-ups for this local application to print the report.'
      );

      return;
    }

    const documentReference =
      printWindow.document;

    documentReference.title =
      `${activeSession.source} session summary`;

    const style =
      documentReference.createElement(
        'style'
      );

    style.textContent =
      'body{font:14px Arial;padding:30px;color:#172033}' +
      'table{border-collapse:collapse;width:100%}' +
      'td,th{border:1px solid #cbd5e1;padding:10px;text-align:left}' +
      'h1{font-size:23px}';

    documentReference.head.append(
      style
    );

    const add = (
      tag,
      text
    ) => {
      const element =
        documentReference.createElement(
          tag
        );

      element.textContent = text;

      documentReference.body.append(
        element
      );

      return element;
    };

    add(
      'h1',
      `Lux Decibels — ${
        activeSession.source === 'PROFILE' || activeSession.source === 'DUMMY'
          ? 'REFERENCE PROFILE'
          : 'LIVE SENSOR'
      } session`
    );

    add(
      'p',
      `Participant: ${activeSession.participant} | Device: ${activeSession.deviceId}`
    );

    if (
      activeSession.source === 'PROFILE' || activeSession.source === 'DUMMY'
    ) {
      add(
        'p',
        `VR experience: ${
          activeSession.videoName ||
          'Unavailable'
        }`
      );
    }

    add(
      'p',
      `Start: ${activeSession.startedAt || new Date().toISOString()} | Received packets: ${rows.length}`
    );

    add(
      'p',
      'Summary of received packets only. Missing intervals are not reconstructed. This demo report makes no clinical classification.'
    );

    const table = add(
      'table',
      ''
    );

    const summaryRows = [
      [
        'Metric',
        'Mean of available values'
      ],

      ...metricKeys
        .filter(
          key =>
            key !== 'stress'
        )
        .map(key => {
          const values = rows
            .map(
              row =>
                row.metrics?.[key]
            )
            .filter(
              v => typeof v === 'number' && Number.isFinite(v)
            );

          return [
            key,

            values.length
              ? (
                  values.reduce(
                    (
                      total,
                      value
                    ) =>
                      total +
                      value,
                    0
                  ) /
                  values.length
                ).toFixed(2)
              : 'Unavailable'
          ];
        })
    ];

    for (
      const cells of summaryRows
    ) {
      const tableRow =
        documentReference.createElement(
          'tr'
        );

      for (
        const value of cells
      ) {
        const tableCell =
          documentReference.createElement(
            'td'
          );

        tableCell.textContent =
          value;

        tableRow.append(
          tableCell
        );
      }

      table.append(tableRow);
    }

    printWindow.focus();
    printWindow.print();
  }

  const samplesCaption =
    fresh
      ? `${frame.samples.rate_hz} Hz • ${
          source === 'PROFILE' || source === 'DUMMY'
            ? 'REFERENCE'
            : 'SENSOR'
        }`
      : 'No samples';

  const events = useMemo(() => {
    return rows
      .filter(
        (_, index) =>
          index % 25 === 0
      )
      .slice(-20)
      .reverse();
  }, [rows]);

  return (
    <>
      <header>
        <div className="header-left">
          <div className="logo-card">
            <img
              src="/logo.png"
              alt="Lux Decibels"
            />
          </div>

          <div className="header-titles">
            <h1>
              VR Biometric Telemetry System
            </h1>

            <p>
              Independent React application • USB telemetry
            </p>
          </div>
        </div>

        <div className="header-actions">
          <div className="mode-switch-group">
            {[
              'REAL',
              'PROFILE'
            ].map(mode => (
              <button
                key={mode}
                className={`btn-mode ${
                  source === mode
                    ? 'active'
                    : ''
                } ${
                  source === mode &&
                  mode === 'PROFILE'
                    ? 'video-active'
                    : ''
                }`}
                disabled={recording}
                onClick={() => {
                  setSource(mode);
                  setSelectedId('');
                }}
              >
                {mode === 'REAL'
                  ? 'Live Sensors (Hardware)'
                  : 'Reference Profiles (Dummy Board)'}
              </button>
            ))}
          </div>

          <span
            className={`badge ${
              fresh
                ? 'badge-online'
                : 'badge-offline'
            }`}
          >
            {fresh
              ? frame.running
                ? '● STREAMING'
                : '● PAUSED'
              : '● DISCONNECTED'}
          </span>

          <span className="badge badge-epoch">
            {new Date(
              clock
            ).toLocaleTimeString()}
          </span>
        </div>
      </header>

      <section
        className="connection-panel"
        aria-label="Device connection"
      >
        <div>
          <strong>
            Device connection
          </strong>

          <p>
            {online
              ? (candidates.length === 0 && otherCandidates.length > 0
                ? `Computer backend connected • Notice: A ${otherCandidates[0].source === 'PROFILE' || otherCandidates[0].source === 'DUMMY' ? 'Reference Profile (Dummy)' : 'Live Sensor'} board (${otherCandidates[0].device_id}) is connected. Switch mode above to view it.`
                : 'Computer backend connected')
              : bridgeEnabled
                ? 'Waiting for backend on port 3001…'
                : 'UI-only mode • no board needed'}
          </p>
        </div>

        <div className="connection-actions">
          <button
            className="btn-csv"
            disabled={bridgeEnabled}
            onClick={() =>
              setBridgeEnabled(true)
            }
          >
            Enable backend
          </button>

          <button
            className="btn-phase"
            disabled={
              !online || busy
            }
            onClick={refreshPorts}
          >
            Refresh ports
          </button>

          <select
            aria-label="Serial port"
            value={port}
            onChange={event =>
              setPort(
                event.target.value
              )
            }
          >
            <option value="">
              Select COM port
            </option>

            {ports.map(item => (
              <option
                key={item.path}
                value={item.path}
              >
                {item.path}
                {item.manufacturer
                  ? ` — ${item.manufacturer}`
                  : ''}
              </option>
            ))}
          </select>

          <select
            aria-label="Baud rate"
            value={baud}
            onChange={event =>
              setBaud(
                event.target.value
              )
            }
          >
            <option value="115200">
              115200 baud
            </option>
          </select>

          <button
            className="btn-csv"
            disabled={
              !online ||
              !port ||
              busy
            }
            onClick={() =>
              run(async () => {
                await api(
                  'connect',
                  {
                    path: port,
                    baudRate:
                      Number(baud)
                  }
                );

                setNotice(
                  'Port opened. Waiting for board identity…'
                );
              })
            }
          >
            Connect USB
          </button>

          <button
            className="btn-phase"
            disabled={
              !device ||
              busy ||
              recording
            }
            onClick={() =>
              run(async () => {
                await api(
                  'disconnect',
                  {
                    path:
                      device.path
                  }
                );

                setNotice(
                  'Device disconnected.'
                );
              })
            }
          >
            Disconnect
          </button>
        </div>

        {candidates.length > 0 && (
          <label className="device-select">
            {source} device

            <select
              aria-label="Device identity"
              disabled={recording}
              value={
                device?.device_id ||
                ''
              }
              onChange={event =>
                setSelectedId(
                  event.target.value
                )
              }
            >
              {candidates.map(
                candidate => (
                  <option
                    key={
                      candidate.device_id
                    }
                    value={
                      candidate.device_id
                    }
                  >
                    {
                      candidate.device_id
                    }{' '}
                    ({candidate.path})
                  </option>
                )
              )}
            </select>
          </label>
        )}
      </section>

      <div
        className="notice"
        role="status"
      >
        {notice}
      </div>

      {source === 'PROFILE' && (
        <div className="simulation-banner">
          REFERENCE PROFILE STREAM — Curated biometric response profiles for repeatable VR scenario evaluation.
        </div>
      )}

      {source === 'PROFILE' && (
        <section className="vr-video-bar">
          <div className="vr-bar-left">
            <span className="badge-scenario">
              VR EXPERIENCE
            </span>

            <select
              aria-label="VR experience"
              className="scenario-select"
              disabled={
                !connected ||
                busy ||
                recording
              }
              value={activeVideoId}
              onChange={event =>
                command(
                  'select_video',
                  {
                    video_id:
                      Number(
                        event.target
                          .value
                      )
                  }
                )
              }
            >
              {videos.map(
                (
                  name,
                  index
                ) => (
                  <option
                    key={name}
                    value={index}
                  >
                    {index + 1}.{' '}
                    {name}
                  </option>
                )
              )}
            </select>

            <span className="scene-pill">
              {fresh
                ? videos[
                    activeVideoId
                  ]
                : 'Waiting for profile controller'}
            </span>
          </div>

          <div className="vr-controls">
            <button
              className="btn-vr-action btn-vr-play"
              disabled={
                !connected ||
                busy
              }
              onClick={() =>
                command('play')
              }
            >
              ▶ Play
            </button>

            <button
              className="btn-vr-action btn-vr-pause"
              disabled={
                !connected ||
                busy
              }
              onClick={() =>
                command('pause')
              }
            >
              Ⅱ Pause
            </button>

            <button
              className="btn-vr-action btn-vr-stop"
              disabled={
                !connected ||
                busy
              }
              onClick={() =>
                command('reset')
              }
            >
              ↺ Reset
            </button>

            <span className="vr-timer">
              {timer(
                fresh &&
                  Number.isFinite(
                    frame?.scenario_ms
                  )
                  ? frame.scenario_ms /
                      1000
                  : 0
              )}
              {' / '}
              {timer(
                activeVideoDuration /
                  1000
              )}
            </span>
          </div>
        </section>
      )}

      <section className="workflow-bar">
        <div className="participant-box">
          <label htmlFor="participant">
            Participant ID:
          </label>

          <input
            id="participant"
            value={participant}
            maxLength={60}
            disabled={recording}
            onChange={event =>
              setParticipant(
                event.target.value
              )
            }
          />
        </div>

        <div className="phase-btn-group">
          {[
            'BASELINE',
            'EXPOSURE',
            'RECOVERY',
            'IDLE'
          ].map(
            (
              phaseName,
              index
            ) => (
              <button
                key={phaseName}
                disabled={
                  !connected ||
                  busy
                }
                className={`btn-phase ${
                  fresh &&
                  frame.phase ===
                    phaseName
                    ? 'active-phase'
                    : ''
                }`}
                onClick={() =>
                  command(
                    'phase',
                    {
                      phase:
                        phaseName
                    }
                  )
                }
              >
                {index === 3
                  ? 'Stop scenario'
                  : `${index + 1}. ${
                      phaseName.charAt(
                        0
                      ) +
                      phaseName
                        .slice(1)
                        .toLowerCase()
                    }`}
              </button>
            )
          )}
        </div>

        <div className="phase-timer-box">
          <span className="timer-label">
            Phase
          </span>

          <span className="timer-val">
            {fresh
              ? frame.phase
              : 'WAITING'}
          </span>
        </div>
      </section>

      <section className="metrics-grid">
        <Metric
          name="RESPIRATION (PRESSURE BELT)"
          value={fmt(
            metrics.resp_bpm
          )}
          unit="RPM"
          detail={
            fresh
              ? (source === 'REAL'
                  ? (frame.metrics?.resp_ok ? 'Belt active • RPM' : 'Check belt contact')
                  : `${source} • respiration rate`)
              : 'Waiting for sensor data'
          }
          color="green"
        />

        <Metric
          name="ECG HEART RATE (AD8232)"
          value={fmt(
            metrics.ecg_bpm
          )}
          unit="BPM"
          detail={
            fresh
              ? (source === 'REAL'
                  ? (frame.metrics?.ecg_leads ? 'AD8232 leads active' : 'Leads Off • Check pads')
                  : `${source} • ECG rate`)
              : 'No ECG data'
          }
          color="red"
        />

        <Metric
          name="OPTICAL PULSE & SpO₂"
          value={fmt(
            metrics.pulse_bpm
          )}
          unit="BPM"
          detail={
            fresh
              ? (source === 'REAL'
                  ? (frame.metrics?.finger ? `SpO₂: ${fmt(metrics.spo2)}% • Finger detected` : 'Place finger on MAX30102')
                  : `SpO₂: ${fmt(metrics.spo2)}% • ${source}`)
              : 'No finger data'
          }
          color="rose"
        />

        <Metric
          name="HRV (RMSSD & LF/HF)"
          value={fmt(
            metrics.rmssd,
            1
          )}
          unit="ms"
          detail={`LF/HF: ${fmt(
            metrics.lf_hf,
            2
          )}`}
          color="purple"
        />

        <Metric
          name="EDA / SKIN CONDUCTANCE"
          value={fmt(
            metrics.gsr,
            2
          )}
          unit="µS"
          detail={
            fresh
              ? (source === 'REAL'
                  ? (frame.metrics?.gsr_contact ? 'GSR electrodes active' : 'GSR disconnected')
                  : `${source} • skin conductance`)
              : 'Disconnected'
          }
          color="blue"
        />

        <Metric
          name="OVERALL STRESS INDEX"
          value={
            metrics.stress ||
            '--'
          }
          unit=""
          detail={`${
            metrics.response_level || (source === 'REAL' ? 'Live Multimodal' : 'EEG response')
          } • β/α: ${fmt(
            metrics.eeg_ratio,
            2
          )}`}
          color="cyan"
        />
      </section>

      <section className="charts-grid">
        <Waveform
          title="Respiration Belt Waveform"
          caption={
            samplesCaption
          }
          series={[
            {
              values:
                histories.resp ||
                []
            }
          ]}
        />

        <Waveform
          title="ECG Waveform"
          caption={
            samplesCaption
          }
          color="#ef4444"
          series={[
            {
              values:
                histories.ecg ||
                []
            }
          ]}
        />

        <Waveform
          title="Pulse Rate & ECG BPM Trend"
          caption="Pink: pulse • Cyan: ECG"
          min={40}
          max={160}
          color="#f43f5e"
          series={[
            {
              values:
                histories.pulse ||
                []
            },
            {
              values:
                histories.ecgBpm ||
                [],
              color: '#00e5ff'
            }
          ]}
        />

        <Waveform
          title="EDA / GSR Conductance Trend"
          caption="µS"
          min={0}
          max={12}
          color="#3b82f6"
          series={[
            {
              values:
                histories.gsr ||
                []
            }
          ]}
        />
      </section>

      <section className="eeg-card">
        <div className="eeg-left">
          Prefrontal EEG
        </div>

        <div className="eeg-bands">
          {[
            [
              'α',
              'eeg_alpha'
            ],
            [
              'β',
              'eeg_beta'
            ],
            [
              'θ',
              'eeg_theta'
            ],
            [
              'δ',
              'eeg_delta'
            ]
          ].map(
            ([
              label,
              key
            ]) => (
              <div
                className="eeg-band-pill"
                key={key}
              >
                <span>
                  {label}
                </span>

                <span>
                  {fmt(
                    metrics[key]
                  )}
                  %
                </span>
              </div>
            )
          )}

          <div className="eeg-band-pill">
            <span>
              β/α
            </span>

            <span>
              {fmt(
                metrics.eeg_ratio,
                2
              )}
            </span>
          </div>
        </div>

        <span className="chart-tag">
          {fresh
            ? (source === 'REAL' ? 'LIVE BIOAMP / SYNTH' : source)
            : 'No EEG data'}
        </span>
      </section>

      <section className="log-card-wrap">
        <div className="log-header">
          <h2>
            Session Event Log
          </h2>

          <div className="export-actions">
            <button
              className="btn-csv"
              disabled={
                !fresh ||
                recording ||
                !frame?.running
              }
              onClick={
                startRecording
              }
            >
              Start recording
            </button>

            <button
              className="btn-phase"
              disabled={!recording}
              onClick={
                stopRecording
              }
            >
              Stop recording
            </button>

            <button
              className="btn-csv"
              disabled={
                !rows.length
              }
              onClick={exportCsv}
            >
              Export CSV
            </button>

            <button
              className="btn-phase"
              disabled={
                !rows.length
              }
              onClick={() => {
                const activeSession = session || {
                  source: source || 'SESSION',
                  id: 'export',
                  participant: participant.trim() || 'SUBJ-001',
                  deviceId: device?.device_id || 'UNKNOWN'
                };

                download(
                  `${activeSession.source}_${activeSession.id}.json`,
                  JSON.stringify(
                    {
                      session: activeSession,
                      packets:
                        rows
                    },
                    null,
                    2
                  ),
                  'application/json'
                );
              }}
            >
              Export raw JSON
            </button>

            <button
              className="btn-pdf"
              disabled={
                !rows.length
              }
              onClick={
                printSummary
              }
            >
              Session PDF
            </button>
          </div>
        </div>

        <p className="storage-note">
          {recording
            ? '● Recording'
            : 'Not recording'}{' '}
          • {rows.length} packets captured. This milestone keeps recordings in this tab; export before closing. Event table shows up to 20 sampled entries.
        </p>

        <div className="table-scroll">
          <table className="log-table">
            <thead>
              <tr>
                {[
                  'TIME',
                  'PARTICIPANT',
                  'SOURCE',
                  'VIDEO',
                  'VIDEO TIME',
                  'PHASE',
                  'ECG BPM',
                  'PULSE BPM',
                  'SpO₂',
                  'GSR µS',
                  'RESP RPM',
                  'STRESS'
                ].map(heading => (
                  <th key={heading}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {events.map(row => (
                <tr
                  key={`${row.boot_id}-${row.sequence}`}
                >
                  <td>
                    {new Date(
                      row.received_at
                    ).toLocaleTimeString()}
                  </td>

                  <td>
                    {
                      row.participant
                    }
                  </td>

                  <td>
                    {row.source}
                  </td>

                  <td>
                    {row.source === 'PROFILE' || row.source === 'DUMMY'
                      ? row.video_name ||
                        videos[
                          row.video_id
                        ] ||
                        '--'
                      : '--'}
                  </td>

                  <td>
                    {Number.isFinite(
                      row.scenario_ms
                    )
                      ? timer(
                          row.scenario_ms /
                            1000
                        )
                      : '--'}
                  </td>

                  <td>
                    {row.phase}
                  </td>

                  <td>
                    {fmt(
                      row.metrics
                        .ecg_bpm
                    )}
                  </td>

                  <td>
                    {fmt(
                      row.metrics
                        .pulse_bpm
                    )}
                  </td>

                  <td>
                    {fmt(
                      row.metrics
                        .spo2
                    )}
                  </td>

                  <td>
                    {fmt(
                      row.metrics
                        .gsr,
                      2
                    )}
                  </td>

                  <td>
                    {fmt(
                      row.metrics
                        .resp_bpm
                    )}
                  </td>

                  <td>
                    {
                      row.metrics
                        .stress
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!events.length && (
            <p className="empty-log">
              Connect a board and start recording to capture session data.
            </p>
          )}
        </div>
      </section>

      <footer>
        <div>
          Lux Decibels • React UI runs on your computer
        </div>

        <div>
          {source} source •{' '}
          {fresh
            ? device.device_id
            : 'Device disconnected'}{' '}
          • Offline capable
        </div>
      </footer>
    </>
  );
}