import { useEffect, useRef, useState } from 'react';

// Opt-in connection means milestone 1 works without a backend or board.
export function useBridge(enabled, onFrame, onNotice) {
  const [online, setOnline] = useState(false);
  const [devices, setDevices] = useState([]);
  const onFrameRef = useRef(onFrame);
  const onNoticeRef = useRef(onNotice);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    onNoticeRef.current = onNotice;
  }, [onNotice]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false, socket, retry;
    function connect() {
      const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${scheme}://${location.host}/ws`);
      socket.onopen = () => { if (!disposed) setOnline(true); };
      socket.onmessage = event => {
        if (disposed) return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'devices') setDevices(msg.devices);
          else if (msg.type === 'telemetry') onFrameRef.current?.(msg);
          else if (msg.type === 'notice') onNoticeRef.current?.(msg.message);
        } catch { onNoticeRef.current?.('Invalid message received from local backend.'); }
      };
      socket.onerror = () => {}; // onclose owns retry; no overlapping sockets.
      socket.onclose = () => {
        if (disposed) return;
        setOnline(false); setDevices([]);
        retry = setTimeout(connect, 2000);
      };
    }
    connect();
    return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, [enabled]);
  return { online, devices };
}
