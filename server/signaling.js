const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');

// Configuration
const PORT = process.env.PORT || 8080;
const RTMP_ENDPOINT = process.env.RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2'; // Default to YT, but usually overridden by client

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Aether Signaling & RTMP Gateway Active');
});

const wss = new WebSocket.Server({ server });

// Map: sessionId -> { clients: Set<WebSocket>, ffmpeg: ChildProcess }
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
                        sessions.set(currentSessionId, { clients: new Set(), ffmpeg: null });
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
                        startFFmpeg(currentSessionId, data.streamKey);
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

function startFFmpeg(sessionId, streamKey) {
    const session = sessions.get(sessionId);
    if (session.ffmpeg) return; // Already running

    console.log(`Starting RTMP Stream for Session ${sessionId}`);
    const rtmpUrl = `${RTMP_ENDPOINT}/${streamKey}`;

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
        '-f', 'flv',               // Output format for RTMP
        rtmpUrl
    ];

    const ffmpeg = spawn('ffmpeg', options);

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