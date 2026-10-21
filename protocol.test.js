import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePacket, validateCommand, metricKeys } from './protocol.js';
const frame=()=>({schema_version:1,type:'telemetry',device_id:'PROFILE-TEST',boot_id:'boot1',source:'PROFILE',sequence:1,uptime_ms:1000,phase:'BASELINE',running:true,scenario_ms:1000,video_id:0,metrics:{...Object.fromEntries(metricKeys.map(k=>[k,72])),stress:'LOW'},samples:{rate_hz:50,start_uptime_ms:800,ecg:[2000,2300],resp:[1000,1100],eeg:[2000,2010]}});
test('accept a complete packet and null unavailable measurements',()=>{const p=frame();assert.equal(validatePacket(p),true);p.metrics.spo2=null;assert.equal(validatePacket(p),true);});
test('reject missing measurements, nonfinite numbers, and mismatched sample batches',()=>{const p=frame();delete p.metrics.spo2;assert.equal(validatePacket(p),false);p.metrics.spo2=NaN;assert.equal(validatePacket(p),false);p.metrics.spo2=98;p.samples.eeg=[];assert.equal(validatePacket(p),false);});
test('reject unsupported sources and protocol versions',()=>{const p=frame();p.source='FAKE';assert.equal(validatePacket(p),false);p.source='REAL';p.schema_version=2;assert.equal(validatePacket(p),false);});
test('accept DUMMY source for backward compatibility', () => {
  const p = frame();
  p.source = 'DUMMY';
  assert.equal(validatePacket(p), true);
});

test('validate phase and video selection commands', () => {
  assert.equal(
    validateCommand({
      device_id: 'PROFILE-TEST',
      action: 'phase',
      phase: 'EXPOSURE'
    }),
    true
  );

  assert.equal(
    validateCommand({
      device_id: 'PROFILE-TEST',
      action: 'phase',
      phase: 'WRONG'
    }),
    false
  );

  assert.equal(
    validateCommand({
      device_id: 'PROFILE-TEST',
      action: 'select_video',
      video_id: 2
    }),
    true
  );

  assert.equal(
    validateCommand({
      device_id: 'PROFILE-TEST',
      action: 'scene',
      scene: 1
    }),
    true
  );

  assert.equal(
    validateCommand({
      device_id: 'PROFILE-TEST',
      action: 'select_video',
      video_id: 4
    }),
    false
  );
});