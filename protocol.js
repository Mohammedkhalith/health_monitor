export const phases = [
  'BASELINE',
  'EXPOSURE',
  'RECOVERY',
  'IDLE'
];

export const metricKeys = [
  'pulse_bpm',
  'ecg_bpm',
  'spo2',
  'resp_bpm',
  'rmssd',
  'lf_hf',
  'gsr',
  'eeg_alpha',
  'eeg_beta',
  'eeg_theta',
  'eeg_delta',
  'eeg_ratio'
];

const idOk = value => {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{1,64}$/.test(value)
  );
};

const finite = value => {
  return (
    typeof value === 'number' &&
    Number.isFinite(value)
  );
};

export function validatePacket(packet) {
  if (
    !packet ||
    packet.schema_version !== 1 ||
    !['REAL', 'PROFILE', 'DUMMY'].includes(packet.source) ||
    !idOk(packet.device_id) ||
    !idOk(packet.boot_id)
  ) {
    return false;
  }

  if (packet.type === 'hello') {
    return (
      typeof packet.firmware === 'string' &&
      packet.firmware.length <= 80
    );
  }

  if (packet.type === 'ack') {
    return (
      typeof packet.id === 'string' &&
      packet.id.length <= 80 &&
      typeof packet.ok === 'boolean'
    );
  }

  if (
    packet.type !== 'telemetry' ||
    !Number.isSafeInteger(packet.sequence) ||
    packet.sequence < 0 ||
    !finite(packet.uptime_ms) ||
    packet.uptime_ms < 0
  ) {
    return false;
  }

 if (
  !phases.includes(packet.phase) ||
  typeof packet.running !== 'boolean' ||
  !finite(packet.scenario_ms) ||
  packet.scenario_ms < 0
) {
  return false;
}

/*
 * PROFILE / DUMMY controller must identify the selected video / scene if provided.
 *
 * 0 = High Dive Coaster
 * 1 = High Speed Trains
 * 2 = Tsunami After Asteroid Fall
 */
if (
  (packet.source === 'PROFILE' || packet.source === 'DUMMY') &&
  packet.video_id !== undefined &&
  (
    !Number.isInteger(packet.video_id) ||
    packet.video_id < 0 ||
    packet.video_id > 2
  )
) {
  return false;
}

  if (
    !packet.metrics ||
    metricKeys.some(key => {
      return (
        packet.metrics[key] !== null &&
        !finite(packet.metrics[key])
      );
    })
  ) {
    return false;
  }

  if (
    packet.metrics.stress !== null &&
    (
      typeof packet.metrics.stress !== 'string' ||
      packet.metrics.stress.length > 40
    )
  ) {
    return false;
  }

  if (
    !packet.samples ||
    !finite(packet.samples.rate_hz) ||
    packet.samples.rate_hz <= 0 ||
    packet.samples.rate_hz > 4000 ||
    !finite(packet.samples.start_uptime_ms)
  ) {
    return false;
  }

  for (const key of ['ecg', 'resp', 'eeg']) {
    if (
      !Array.isArray(packet.samples[key]) ||
      packet.samples[key].length > 256 ||
      !packet.samples[key].every(finite)
    ) {
      return false;
    }
  }

  return (
    packet.samples.ecg.length ===
      packet.samples.resp.length &&
    packet.samples.ecg.length ===
      packet.samples.eeg.length
  );
}

export function validateCommand(command) {
  if (
    !command ||
    !idOk(command.device_id)
  ) {
    return false;
  }

  if (
    ['play', 'pause', 'reset'].includes(
      command.action
    )
  ) {
    return true;
  }

  if (command.action === 'phase') {
    return phases.includes(command.phase);
  }

  /*
   * scene or select_video is used as the selected video ID:
   * 0 = High Dive Coaster
   * 1 = High Speed Trains
   * 2 = Tsunami After Asteroid Fall
   *
   * Value 3 is retained for protocol compatibility.
   */
  if (command.action === 'select_video' || command.action === 'scene') {
    const videoId = command.video_id !== undefined ? command.video_id : command.scene;
    return (
      Number.isInteger(videoId) &&
      videoId >= 0 &&
      videoId <= 3
    );
  }

  return false;
}