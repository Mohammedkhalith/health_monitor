import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';
import { WebSocketServer, WebSocket } from 'ws';
import { validatePacket, validateCommand } from './protocol.js';

const HOST = '127.0.0.1';
const PORT = 3001;

const dist = path.resolve(
  fileURLToPath(new URL('../frontend/dist/', import.meta.url))
);

const connections = new Map();
const pending = new Map();

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 1024
});

const HANDSHAKE_MS = 12000;

const log = (scope, message) => {
  console.log(
    `[${new Date().toISOString()}] [${scope}] ${message}`
  );
};

function serialSummary(c) {
  return (
    `bytes=${c.rxBytes}, ` +
    `lines=${c.rxLines}, ` +
    `invalidJSON=${c.invalidJSON}, ` +
    `invalidPackets=${c.invalidPackets}, ` +
    `telemetryBeforeHello=${c.telemetryBeforeHello}`
  );
}

function identify(c) {
  if (connections.get(c.path) !== c || !c.port.isOpen) {
    return;
  }

  // Avoid sending identify commands too quickly.
  if (Date.now() - c.lastIdentify < 900) {
    return;
  }

  c.lastIdentify = Date.now();

  const command = {
    type: 'command',
    id: 'identify',
    action: 'identify'
  };

  c.port.write(JSON.stringify(command) + '\n', error => {
    if (error) {
      closeConnection(
        c,
        `Identify write failed on ${c.path}: ${error.message}`
      );
    }
  });
}

function broadcast(data) {
  const value = JSON.stringify(data);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      if (client.bufferedAmount > 1024 * 1024) {
        client.close(1013, 'Client too slow; reconnect');
      } else {
        client.send(value);
      }
    }
  }
}

function snapshot() {
  return {
    type: 'devices',

    devices: [...connections.values()].map(c => ({
      path: c.path,
      device_id: c.identity?.device_id || null,
      source: c.identity?.source || null,
      status: c.status,
      firmware: c.identity?.firmware || null
    }))
  };
}

function notify(message) {
  broadcast({
    type: 'notice',
    message
  });
}

function closeConnection(c, reason) {
  if (connections.get(c.path) !== c) {
    return;
  }

  connections.delete(c.path);

  clearInterval(c.identifyTimer);
  clearTimeout(c.handshakeTimer);

  log(
    c.path,
    `${reason || 'Connection closed'}. ${serialSummary(c)}`
  );

  for (const [id, req] of pending) {
    if (req.connection === c) {
      clearTimeout(req.timer);
      pending.delete(id);

      req.reject(
        new Error('Board disconnected before acknowledgement')
      );
    }
  }

  if (c.port.isOpen) {
    c.port.close(() => {});
  }

  broadcast(snapshot());

  if (reason) {
    notify(reason);
  }
}

function receive(c, line) {
  if (connections.get(c.path) !== c) {
    return;
  }

  c.rxLines++;

  let packet;

  try {
    packet = JSON.parse(line);
  } catch {
    c.invalidJSON++;

    // Show a maximum of three non-JSON/boot messages.
    if (c.invalidJSON <= 3) {
      log(
        c.path,
        `Non-JSON/boot line: ${JSON.stringify(
          line.slice(0, 180)
        )}`
      );
    }

    return;
  }

  if (!validatePacket(packet)) {
    c.invalidPackets++;

    if (c.invalidPackets <= 3) {
      log(
        c.path,
        `Rejected packet: ` +
        `type=${JSON.stringify(packet?.type)}, ` +
        `schema=${JSON.stringify(packet?.schema_version)}, ` +
        `source=${JSON.stringify(packet?.source)}. ` +
        `Does not match protocol.js.`
      );
    }

    return;
  }

  if (packet.type === 'hello') {
    const duplicate = [...connections.values()].some(
      other =>
        other !== c &&
        other.identity?.device_id === packet.device_id
    );

    if (duplicate) {
      closeConnection(
        c,
        'Duplicate device identity. Disconnect the duplicate board.'
      );

      return;
    }

    if (c.identity?.boot_id !== packet.boot_id) {
      c.sequence = -1;
      c.lastFrame = 0;
    }

    c.identity = packet;
    c.status = 'connected';
    c.connectedAt = Date.now();

    log(
      c.path,
      `HELLO accepted: ${packet.device_id}, ` +
      `source=${packet.source}, ` +
      `firmware=${packet.firmware}`
    );

    clearInterval(c.identifyTimer);
    clearTimeout(c.handshakeTimer);

    broadcast(snapshot());
    return;
  }

  const identityDoesNotMatch =
    !c.identity ||
    c.identity.device_id !== packet.device_id ||
    c.identity.source !== packet.source ||
    c.identity.boot_id !== packet.boot_id;

  if (identityDoesNotMatch) {
    if (packet.type === 'telemetry') {
      c.telemetryBeforeHello++;

      if (c.telemetryBeforeHello === 1) {
        log(
          c.path,
          'Valid telemetry received, but matching HELLO is still missing; requesting identify.'
        );
      }
    }

    identify(c);
    return;
  }

  if (packet.type === 'ack') {
    const req = pending.get(packet.id);

    if (req?.connection === c) {
      clearTimeout(req.timer);
      pending.delete(packet.id);

      if (packet.ok) {
        req.resolve(packet);
      } else {
        req.reject(
          new Error(
            packet.error || 'Command rejected by board'
          )
        );
      }
    }

    return;
  }

  if (packet.sequence <= c.sequence) {
    return;
  }

  const gap =
    c.sequence >= 0
      ? packet.sequence - c.sequence - 1
      : 0;

  c.sequence = packet.sequence;
  c.lastFrame = Date.now();

  if (!c.loggedTelemetry) {
    c.loggedTelemetry = true;

    log(
      c.path,
      `STREAMING: telemetry forwarded to browser; ` +
      `WebSocket clients=${wss.clients.size}`
    );
  }

  if (c.status !== 'connected') {
    c.status = 'connected';
    broadcast(snapshot());
  }

  broadcast({
    ...packet,
    received_at: c.lastFrame,
    missing_packets: gap
  });
}

async function connectPort(portPath, baudRate) {
  if (
    typeof portPath !== 'string' ||
    portPath.length > 250 ||
    baudRate !== 115200
  ) {
    throw new Error(
      'Select a serial port and 115200 baud'
    );
  }

  if (connections.has(portPath)) {
    throw new Error('This port is already open');
  }

  const port = new SerialPort({
    path: portPath,
    baudRate,
    autoOpen: false,
    rtscts: false,
    xon: false,
    xoff: false
  });

  const c = {
    path: portPath,
    port,
    identity: null,
    status: 'identifying',

    buffer: '',
    dropping: false,

    sequence: -1,
    lastFrame: 0,

    rxBytes: 0,
    rxLines: 0,
    invalidJSON: 0,
    invalidPackets: 0,
    telemetryBeforeHello: 0,

    lastIdentify: 0,
    loggedTelemetry: false,

    identifyTimer: null,
    handshakeTimer: null
  };

  connections.set(portPath, c);

  log(
    portPath,
    `Opening serial port at ${baudRate} baud`
  );

  port.on('data', data => {
    if (connections.get(portPath) !== c) {
      return;
    }

    c.rxBytes += data.length;

    if (c.rxBytes === data.length) {
      log(portPath, 'First serial bytes received');
    }

    c.buffer += data.toString('utf8');

    if (c.buffer.length > 65536) {
      c.buffer = '';
      c.dropping = true;
    }

    let lineEnd;
    while ((lineEnd = c.buffer.indexOf('\n')) !== -1) {
      const line = c.buffer.slice(0, lineEnd).trim();
      c.buffer = c.buffer.slice(lineEnd + 1);

      if (!c.dropping && line) {
        receive(c, line);
      }
      c.dropping = false;
    }
  });

  port.on('error', error => {
    closeConnection(
      c,
      `Serial error on ${portPath}: ${error.message}`
    );
  });

  port.on('close', () => {
    closeConnection(
      c,
      `${portPath} disconnected. ` +
      `Select the available port to reconnect.`
    );
  });

  try {
    await new Promise((resolve, reject) => {
      port.open(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    closeConnection(c);
    throw error;
  }

  if (connections.get(portPath) !== c) {
    if (port.isOpen) {
      port.close(() => {});
    }

    throw new Error(
      'Connection was cancelled while the port was opening'
    );
  }

  log(portPath, 'Serial port opened');

  let info;

  try {
    const availablePorts = await SerialPort.list();

    info = availablePorts.find(
      availablePort =>
        availablePort.path === portPath
    );
  } catch (error) {
    log(
      portPath,
      `Port identification unavailable: ${error.message}`
    );
  }

  if (connections.get(portPath) !== c) {
    throw new Error(
      'Connection closed during setup'
    );
  }

  const vendor = info?.vendorId
    ?.toLowerCase()
    .replace(/^0x/, '');

  /*
   * Known external USB-UART bridges:
   * 10c4 = Silicon Labs CP210x
   * 1a86 = CH340/CH341
   * 0403 = FTDI
   */
  const releaseReset =
    process.env.VR_SERIAL_RELEASE_RESET === '1' ||
    (
      process.env.VR_SERIAL_RELEASE_RESET !== '0' &&
      ['10c4', '1a86', '0403'].includes(vendor)
    );

  log(
    portPath,
    `USB vendor=${vendor || 'unknown'}, ` +
    `manufacturer=${info?.manufacturer || 'unknown'}`
  );

  if (releaseReset) {
    await new Promise(resolve => {
      port.set(
        {
          dtr: false,
          rts: false
        },
        error => {
          if (error) {
            log(
              portPath,
              `Could not release DTR/RTS: ${error.message}`
            );
          } else {
            log(
              portPath,
              'DTR/RTS released for USB-UART bridge'
            );
          }

          resolve();
        }
      );
    });
  }

  if (connections.get(portPath) !== c) {
    throw new Error(
      'Connection closed during setup'
    );
  }

  /*
   * The board may send HELLO immediately after the
   * serial port is opened.
   */
  if (!c.identity) {
    c.identifyTimer = setInterval(() => {
      identify(c);
    }, 1000);

    c.handshakeTimer = setTimeout(() => {
      let reason;

      if (!c.rxBytes) {
        reason =
          'No serial bytes received. ' +
          'Check board port and reset state; ' +
          'press EN once while connecting.';
      } else if (c.telemetryBeforeHello) {
        reason =
          'Valid telemetry arrived, but no matching HELLO. ' +
          'Check board identify command response.';
      } else if (!c.rxLines) {
        reason =
          'Serial bytes arrived but no complete ' +
          'newline-terminated packet.';
      } else {
        reason =
          'Serial data arrived but no valid HELLO. ' +
          'Check terminal boot/rejected-packet logs and firmware.';
      }

      closeConnection(
        c,
        `${reason} ${serialSummary(c)}`
      );
    }, HANDSHAKE_MS);

    identify(c);
  }

  broadcast(snapshot());
}

async function sendCommand(data) {
  if (!validateCommand(data)) {
    throw new Error('Invalid command');
  }

  const c = [...connections.values()].find(
    connection =>
      connection.identity?.device_id === data.device_id
  );

  if (!c || c.status !== 'connected') {
    throw new Error('Device is not connected');
  }

  const id = randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);

      reject(
        new Error('Board acknowledgement timed out')
      );
    }, 2500);

    pending.set(id, {
      connection: c,
      timer,
      resolve,
      reject
    });

   const boardCommand = {
  type: 'command',
  id,
  action: data.action
};

if (data.phase !== undefined) {
  boardCommand.phase = data.phase;
}

if (data.video_id !== undefined) {
  boardCommand.video_id = data.video_id;
}

if (data.scene !== undefined) {
  boardCommand.scene = data.scene;
}

c.port.write(
  JSON.stringify(boardCommand) + '\n',
  error => {
    if (error && pending.has(id)) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    }
  }
);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  });

  res.end(JSON.stringify(data));
}

function originAllowed(origin) {
  // Local command-line/testing requests may have no Origin.
  if (!origin) {
    return true;
  }

  return [
    'http://127.0.0.1:5173',
    'http://localhost:5173',
    'http://127.0.0.1:3001',
    'http://localhost:3001'
  ].includes(origin);
}

async function readBody(req) {
  if (
    !req.headers['content-type']
      ?.startsWith('application/json')
  ) {
    throw new Error('JSON body required');
  }

  let text = '';

  for await (const chunk of req) {
    text += chunk;

    if (text.length > 4096) {
      throw new Error('Request too large');
    }
  }

  return JSON.parse(text);
}

const server = http.createServer(
  async (req, res) => {
    try {
      if (!originAllowed(req.headers.origin)) {
        return json(res, 403, {
          error:
            'Only the local application may access this backend'
        });
      }

      const url = new URL(
        req.url,
        `http://${HOST}:${PORT}`
      );

      if (
        req.method === 'GET' &&
        url.pathname === '/api/ports'
      ) {
        return json(res, 200, {
          ports: await SerialPort.list()
        });
      }

      if (
        req.method === 'GET' &&
        url.pathname === '/api/health'
      ) {
        return json(res, 200, {
          ok: true,
          ...snapshot()
        });
      }

      if (req.method === 'POST') {
        const data = await readBody(req);

        if (url.pathname === '/api/connect') {
          await connectPort(
            data.path,
            data.baudRate
          );

          return json(res, 200, {
            ok: true
          });
        }

        if (url.pathname === '/api/disconnect') {
          const c = connections.get(data.path);

          if (c) {
            closeConnection(c);
          }

          return json(res, 200, {
            ok: true
          });
        }

        if (url.pathname === '/api/command') {
          const ack = await sendCommand(data);

          return json(res, 200, {
            ok: true,
            ack
          });
        }
      }

      if (
        req.method !== 'GET' ||
        url.pathname.startsWith('/api/')
      ) {
        return json(res, 404, {
          error: 'Not found'
        });
      }

      const pathname = decodeURIComponent(
        url.pathname
      );

      const file = path.resolve(
        dist,
        pathname === '/'
          ? 'index.html'
          : `.${pathname}`
      );

      if (
        !file.startsWith(dist + path.sep) &&
        file !== path.join(dist, 'index.html')
      ) {
        return json(res, 403, {
          error: 'Invalid path'
        });
      }

      try {
        const bytes = await readFile(file);

        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
          '.json': 'application/json',
          '.ico': 'image/x-icon',
          '.woff2': 'font/woff2',
          '.woff': 'font/woff'
        };

        res.writeHead(200, {
          'Content-Type':
            types[path.extname(file)] ||
            'application/octet-stream',

          'Cache-Control': 'no-cache'
        });

        res.end(bytes);
      } catch {
        json(res, 404, {
          error:
            'UI build not found. ' +
            'Run npm run build in frontend, ' +
            'or use frontend npm run dev for development.'
        });
      }
    } catch (error) {
      if (!res.headersSent) {
        json(res, 400, {
          error: error.message
        });
      }
    }
  }
);

server.on('upgrade', (req, socket, head) => {
  socket.on('error', error => {
    log(
      'WS',
      `Socket error: ${error.message}`
    );
  });

  if (
    req.url !== '/ws' ||
    !originAllowed(req.headers.origin)
  ) {
    log(
      'WS',
      `Upgrade rejected: ` +
      `path=${req.url}, ` +
      `origin=${req.headers.origin || '(none)'}`
    );

    socket.destroy();
    return;
  }

  wss.handleUpgrade(
    req,
    socket,
    head,
    ws => {
      log(
        'WS',
        `Browser connected; ` +
        `clients=${wss.clients.size}`
      );

      ws.on('error', error => {
        log(
          'WS',
          `Client error: ${error.message}`
        );
      });

      ws.on('close', code => {
        log(
          'WS',
          `Browser disconnected; code=${code}`
        );
      });

      ws.send(
        JSON.stringify(snapshot())
      );
    }
  );
});

wss.on('error', error => {
  log(
    'WS',
    `Server error: ${error.message}`
  );
});

const timer = setInterval(() => {
  for (const c of connections.values()) {
    const latestTime =
      c.lastFrame ||
      c.connectedAt ||
      0;

    if (
      c.identity &&
      Date.now() - latestTime > 3000 &&
      c.status === 'connected'
    ) {
      c.status = 'stale';
      broadcast(snapshot());
    }
  }
}, 500);

server.on('error', error => {
  console.error(
    `Backend cannot start: ${error.message}`
  );

  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(
    `VR backend ready: ` +
    `http://${HOST}:${PORT} ` +
    `(USB diagnostic build 1.0.2; ` +
    `no simulated data generated here)`
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(timer);

    for (
      const c of [...connections.values()]
    ) {
      closeConnection(c);
    }

    for (const ws of wss.clients) {
      ws.terminate();
    }

    server.close(() => {
      process.exit(0);
    });
  });
}