const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');

// Allow override via env, but default to your local ShareX ffmpeg.exe
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'C:\\Users\\segun\\Desktop\\ShareX-18.0.0-portable\\ffmpeg.exe';

// Configuration
const PORT = process.env.PORT || 8080;
const RTMP_ENDPOINT = process.env.RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2'; // Default to YT, but usually overridden by client

const sendJson = (res, code, payload) => {
    res.writeHead(code, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(payload));
};

const runFfmpegCheck = (cb) => {
    let done = false;
    const proc = spawn(FFMPEG_PATH, ['-version']);
    const chunks = [];
    const timer = setTimeout(() => {
        if (done) return;
        done = true;
        try { proc.kill(); } catch {}
        cb(new Error('ffmpeg check timed out'));
    }, 2000);

    proc.stdout.on('data', (d) => chunks.push(d));
    proc.stderr.on('data', (d) => chunks.push(d));
    proc.on('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cb(err);
    });
    proc.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const out = Buffer.concat(chunks).toString('utf8');
        if (code === 0) cb(null, out);
        else cb(new Error(out || `ffmpeg exited with code ${code}`));
    });
};

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
        res.end();
        return;
    }

    if (req.url === '/health') {
        sendJson(res, 200, { ok: true, service: 'aether-relay' });
        return;
    }

    if (req.url === '/ffmpeg') {
        runFfmpegCheck((err, output) => {
            if (err) {
                sendJson(res, 500, { ok: false, error: String(err.message || err) });
                return;
            }
            sendJson(res, 200, { ok: true, version: output.split('\n')[0] });
        });
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('Aether Signaling & RTMP Gateway Active');
});

const wss = new WebSocket.Server({ server });

// Map: sessionId -> { clients: Set<WebSocket>, ffmpeg: ChildProcess, bytes: number, lastLog: number }
const sessions = new Map();

wss.on('connection', (ws) => {
    let currentSessionId = null;
    let isStreamer = false;

    console.log('Client connected');

    ws.on('message', (message) => {
        // 1. Handle Binary Data (Video Stream)
        if (Buffer.isBuffer(message)) {
            if (currentSessionId && sessions.has(currentSessionId)) {
                const session = sessions.get(currentSessionId);
                // Only write if FFmpeg is running and stdin is open
                if (session.ffmpeg && session.ffmpeg.stdin.writable) {
                    try {
                        session.ffmpeg.stdin.write(message);
                        session.bytes += message.length || 0;
                        const now = Date.now();
                        if (now - session.lastLog > 2000) {
                            console.log(`Stream [${currentSessionId}] in: ${Math.round(session.bytes / 1024)} KB`);
                            session.bytes = 0;
                            session.lastLog = now;
                        }
                    } catch (err) {
                        console.error('FFmpeg Write Error:', err);
                    }
                }
            }
            return;
        }

        // 2. Handle JSON Signaling Data
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'join':
                    currentSessionId = data.sessionId;
                    isStreamer = data.role === 'host'; 
                    
                    if (!sessions.has(currentSessionId)) {
                        sessions.set(currentSessionId, { clients: new Set(), ffmpeg: null, bytes: 0, lastLog: Date.now() });
                    }
                    sessions.get(currentSessionId).clients.add(ws);
                    
                    // Notify others
                    broadcastToSession(currentSessionId, ws, {
                        type: 'peer-joined',
                        role: data.role
                    });
                    break;

                case 'start-stream':
                    // Start FFmpeg process
                    if (isStreamer && data.streamKey) {
                        const destinations = Array.isArray(data.destinations) ? data.destinations : [];
                        startFFmpeg(currentSessionId, data.streamKey, destinations);
                    }
                    break;

                case 'stop-stream':
                    if (isStreamer) {
                        stopFFmpeg(currentSessionId);
                    }
                    break;

                case 'offer':
                case 'answer':
                case 'ice-candidate':
                case 'request-offer': 
                    broadcastToSession(currentSessionId, ws, data);
                    break;
            }
        } catch (e) {
            console.error('Error processing text message:', e);
        }
    });

    ws.on('close', () => {
        if (currentSessionId && sessions.has(currentSessionId)) {
            const session = sessions.get(currentSessionId);
            session.clients.delete(ws);
            
            // If host disconnects, kill the stream
            if (isStreamer) {
                stopFFmpeg(currentSessionId);
            }

            if (session.clients.size === 0) {
                sessions.delete(currentSessionId);
            } else {
                broadcastToSession(currentSessionId, ws, { type: 'peer-left' });
            }
        }
    });
});

function broadcastToSession(sessionId, senderWs, data) {
    if (!sessionId || !sessions.has(sessionId)) return;
    for (const client of sessions.get(sessionId).clients) {
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    }
}

function normalizeDestinations(streamKey, destinations) {
    const urls = [];
    if (streamKey) {
        urls.push(`${RTMP_ENDPOINT}/${streamKey}`);
    }
    if (Array.isArray(destinations)) {
        destinations.forEach((u) => {
            if (typeof u === 'string' && u.trim()) urls.push(u.trim());
        });
    }
    return urls;
}

function startFFmpeg(sessionId, streamKey, destinations = []) {
    const session = sessions.get(sessionId);
    if (session.ffmpeg) return; // Already running

    console.log(`Starting RTMP Stream for Session ${sessionId}`);
    const urls = normalizeDestinations(streamKey, destinations);
    if (urls.length === 0) {
        console.error('No RTMP destinations provided.');
        return;
    }
    console.log(`FFmpeg path: ${FFMPEG_PATH}`);
    console.log(`RTMP URL: ${RTMP_ENDPOINT}/******`);

    // FFmpeg options for low-latency webm -> rtmp
    const options = [
        '-i', '-',                 // Input from stdin
        '-c:v', 'libx264',         // Video Codec
        '-preset', 'ultrafast',    // Low latency preset
        '-tune', 'zerolatency',    // Low latency tune
        '-max_muxing_queue_size', '1024',
        '-bufsize', '500k',        // Control bitrate bursts
        '-r', '30',                // Force 30fps
        '-g', '60',                // Keyframe interval (2s)
        '-c:a', 'aac',             // Audio Codec
        '-ar', '44100',            // Audio Rate
        '-b:a', '128k',            // Audio Bitrate
    ];

    if (urls.length === 1) {
        options.push('-f', 'flv', urls[0]);
    } else {
        const teeTargets = urls.map(u => `[f=flv]${u}`).join('|');
        console.log(`RTMP Multicast: ${urls.length} destinations`);
        options.push('-f', 'tee', teeTargets);
    }

    const ffmpeg = spawn(FFMPEG_PATH, options);

    ffmpeg.on('error', (err) => {
        console.error('FFmpeg spawn error:', err);
    });

    ffmpeg.stderr.on('data', (data) => {
        // FFmpeg logs to stderr
        console.log(`FFmpeg [${sessionId}]: ${data}`);
    });

    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
        session.ffmpeg = null;
    });

    session.ffmpeg = ffmpeg;
}

function stopFFmpeg(sessionId) {
    const session = sessions.get(sessionId);
    if (session && session.ffmpeg) {
        console.log(`Stopping Stream for ${sessionId}`);
        session.ffmpeg.stdin.end();
        session.ffmpeg.kill();
        session.ffmpeg = null;
    }
}

server.listen(PORT, () => {
    console.log(`Aether Server running on port ${PORT}`);
    console.log(`Ready for WebRTC Signaling and RTMP Streaming`);
});
