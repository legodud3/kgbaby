// DOM Elements
const landingScreen = document.getElementById('landing-screen');
const monitorScreen = document.getElementById('monitor-screen');
const btnChild = document.getElementById('btn-child');
const btnParent = document.getElementById('btn-parent');
const roomIdInput = document.getElementById('room-id');
const roleDisplay = document.getElementById('role-display');
const statusIndicator = document.getElementById('connection-status');
const childControls = document.getElementById('child-controls');
const parentControls = document.getElementById('parent-controls');
const btnDim = document.getElementById('btn-dim');
const dimOverlay = document.getElementById('dim-overlay');
const btnStop = document.getElementById('btn-stop');
const btnListen = document.getElementById('btn-listen');
const volumeControl = document.getElementById('volume-control');
const volumeValueDisplay = document.getElementById('volume-value');
const audioStatus = document.getElementById('audio-status');
const vadStatus = document.getElementById('vad-status');
const vadSensitivity = document.getElementById('vad-sensitivity');
const vadValueDisplay = document.getElementById('vad-value');
const wakeLockVideo = document.getElementById('wake-lock-video');
const debugLog = document.getElementById('debug-log');

// State
let role = null;
let roomId = null;
let peer = null;
let currentCall = null;
let localStream = null;
let wakeLock = null;
let audioCtx = null;
let gainNode = null;
let analyser = null;
let reconnectInterval = null;
let vadInterval = null;
let lastNoiseTime = 0;
let isTransmitting = true;
let vadTrack = null;
let pendingRemoteStream = null;
let audioUnlocked = false;
let visualizerRafId = null;
let visualizerActive = false;
let statsInterval = null;
let statsLoopRunning = false;
let lastStats = null;
let lastAudioEnergy = null;
let lastAudioEnergyTs = null;
let childRetryTimeout = null;
let childRetryDelay = 3000;
let debugPanel = null;
let latestNetworkLabel = 'Network: Unknown';

// Constants
const MAX_LOG_ENTRIES = 200;
const STATS_INTERVAL_MS = 2500;
const SILENCE_WARN_MS = 12000;
const BITRATE_LEVELS = [32000, 48000, 64000];
const BITRATE_DEFAULT_INDEX = 2;
const BITRATE_STEP_DOWN_AFTER = 3; // consecutive bad intervals
const BITRATE_STEP_UP_AFTER = 4; // consecutive good intervals

const ICE_SERVERS = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['stun:stun2.l.google.com:19302', 'stun:stun3.l.google.com:19302'] }
];

const PEER_CONFIG = {
    debug: 2,
    secure: true,
    config: {
        iceServers: ICE_SERVERS
    }
};
const VAD_HOLD_TIME = 2000; // ms to keep mic open after noise stops

// Utility
function log(msg, isError = false) {
    const time = new Date().toLocaleTimeString();
    const fullMsg = `[${time}] ${msg}`;
    console.log(fullMsg);
    if (debugLog) {
        const p = document.createElement('div');
        p.textContent = fullMsg;
        p.style.color = isError ? '#ff5252' : '#69f0ae';
        p.style.borderBottom = '1px solid #333';
        p.style.padding = '2px 0';
        debugLog.appendChild(p);
        while (debugLog.children.length > MAX_LOG_ENTRIES) {
            debugLog.removeChild(debugLog.firstChild);
        }
        debugLog.scrollTop = debugLog.scrollHeight;
    }
}

// Event Listeners
btnChild.addEventListener('click', () => startSession('child'));
btnParent.addEventListener('click', () => startSession('parent'));
btnDim.addEventListener('click', toggleDim);
// Double-tap logic for dim overlay
let lastTap = 0;
dimOverlay.addEventListener('click', (e) => {
    const currentTime = new Date().getTime();
    const tapLength = currentTime - lastTap;
    if (tapLength < 500 && tapLength > 0) {
        toggleDim();
        e.preventDefault();
    }
    lastTap = currentTime;
});
btnStop.addEventListener('click', stopSession);
btnListen.addEventListener('click', resumeAudioContext);
if(vadSensitivity) {
    vadSensitivity.addEventListener('input', updateSensitivityLabel);
}
if(volumeControl) {
    volumeControl.addEventListener('input', updateVolumeLabel);
}

// Initialization
async function startSession(selectedRole) {
    try {
        configureTurnIfPresent();
        ensureDebugPanel();
        audioUnlocked = false;
        pendingRemoteStream = null;

        const roomName = roomIdInput.value.trim();
        if (!roomName) {
            alert('Please enter a Room Name');
            return;
        }

        debugLog.innerHTML = ''; // Clear previous logs
        log("Initializing...", false);

        // Initialize AudioContext on user gesture
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            // Optional: for some browsers we might need to resume it immediately
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
        }

        // Check if PeerJS loaded
        if (typeof Peer === 'undefined') {
            log("Error: PeerJS library not loaded. Check Internet connection.", true);
            return;
        }

        // IOS WAKE LOCK HACK: Play hidden video (Non-blocking)
        wakeLockVideo.play().then(() => {
            console.log('Video Wake Lock Active');
        }).catch((err) => {
            console.warn('Video Wake Lock Failed:', err);
            // This is non-critical, so we don't stop
        });

        role = selectedRole;
        roomId = roomName.toLowerCase().replace(/[^a-z0-9]/g, ''); // Sanitize
        
        // Check if ID is empty after sanitize
        if (!roomId) {
            log("Invalid Room Name. Use letters/numbers only.", true);
            return;
        }
        
        if (role === 'child') {
            initChild();
        } else {
            initParent();
        }

        requestWakeLock();
    } catch (e) {
        console.error(e);
        log(`App Error: ${e.message}`, true);
    }
}

function switchToMonitor() {
    landingScreen.classList.add('hidden');
    monitorScreen.classList.remove('hidden');
    roleDisplay.textContent = role === 'child' ? 'Child Unit (Sender)' : 'Parent Unit (Receiver)';
    if (role === 'child') {
        childControls.classList.remove('hidden');
    } else {
        parentControls.classList.remove('hidden');
    }
}

function stopSession() {
    if (peer) peer.destroy();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    if (vadTrack) vadTrack.stop();
    if (wakeLock) wakeLock.release();
    if (reconnectInterval) clearInterval(reconnectInterval);
    if (vadInterval) clearInterval(vadInterval);
    if (statsInterval) clearInterval(statsInterval);
    stopVisualizer();
    teardownAudioGraph();
    if (audioCtx) audioCtx.close();
    
    location.reload();
}

// Wake Lock
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            log('Screen Wake Lock active', false);
            wakeLock.addEventListener('release', () => {
                log('Screen Wake Lock released', true);
            });
        } catch (err) {
            console.error(`${err.name}, ${err.message}`);
            log(`WakeLock Error: ${err.message}`, true);
        }
    } else {
        log('WakeLock API not supported', true);
    }
}

function toggleDim() {
    dimOverlay.classList.toggle('hidden');
    if (!dimOverlay.classList.contains('hidden')) {
        dimOverlay.innerHTML = '<p>Double-tap to wake</p>';
    }
}

function updateSensitivityLabel() {
    const val = vadSensitivity.value;
    let label = 'Medium';
    if (val < 30) label = 'Low (Hears only loud noises)';
    else if (val > 70) label = 'High (Hears everything)';
    else label = 'Medium';
    vadValueDisplay.textContent = label;
}

function updateVolumeLabel() {
    const val = volumeControl.value;
    volumeValueDisplay.textContent = `${val}%`;
    if (gainNode) {
        gainNode.gain.setTargetAtTime(val / 100, audioCtx.currentTime, 0.05);
    }
}

// PeerJS & Logic
function getPeerId(r) {
    return `babymonitor-${roomId}-${r}`;
}

// --- CHILD LOGIC ---
function initChild() {
    const myId = `babymonitor-${roomId}-child`;
    log(`Creating Peer: ${myId}...`);
    
    if (peer) peer.destroy();
    peer = new Peer(myId, PEER_CONFIG);

    peer.on('open', (id) => {
        log('Peer Open. ID: ' + id, false);
        switchToMonitor();
        updateStatus(true); // Connected to signaling server
        resetChildRetry();
        startStreaming();
    });

    peer.on('error', (err) => {
        console.error('Peer Error:', err.type, err);
        if (err.type === 'unavailable-id') {
            log(`ID '${roomId}' taken.`, true);
            alert('Room Name Taken. Please choose another.');
            stopSession();
        } else if (err.type === 'peer-unavailable') {
            // Target not found, retry
            log('Parent not found. Retrying...', false);
            retryConnection();
        } else if (err.type === 'network') {
            log('Network Error.', true);
        } else {
            log(`Peer Error: ${err.type}`, true);
            updateStatus(false);
            // General error, retry initialization
            setTimeout(initChild, 5000);
        }
    });

    peer.on('disconnected', () => {
        log('Disconnected from Server. Reconnecting...', true);
        updateStatus(false);
        peer.reconnect();
    });
}

async function startStreaming() {
    try {
        if (!localStream) {
            log("Requesting Mic...", false);
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: true,
                    autoGainControl: true
                },
                video: false
            });
            log(`Mic Active. Tracks: ${localStream.getTracks().length}`, false);
        }
        
        setupVAD(localStream);
        connectToParent();
        
    } catch (err) {
        console.error('Failed to get media', err);
        log(`Mic Error: ${err.message}`, true);
        alert('Microphone access denied: ' + err.message);
    }
}

function setupVAD(stream) {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    // Clone the track for VAD so we can still analyze even when transmission is disabled
    if (vadTrack) vadTrack.stop();
    vadTrack = stream.getAudioTracks()[0].clone();
    const vadStream = new MediaStream([vadTrack]);
    const source = audioCtx.createMediaStreamSource(vadStream);
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Start loop
    if (vadInterval) clearInterval(vadInterval);
    
    visualize('child');

    let logCounter = 0;
    vadInterval = setInterval(() => {
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        analyser.getByteFrequencyData(dataArray);
        
        // Calculate RMS (volume)
        let sum = 0;
        for(let i = 0; i < bufferLength; i++) {
            sum += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sum / bufferLength);
        
        const sliderVal = parseInt(vadSensitivity.value);
        const threshold = 60 - (sliderVal * 0.55); 
        
        const now = Date.now();
        const audioTrack = stream.getAudioTracks()[0];
        
        if (logCounter % 50 === 0) {
            console.log(`VAD: RMS=${rms.toFixed(1)}, Threshold=${threshold.toFixed(1)}, Active=${isTransmitting}`);
        }
        logCounter++;

        if (rms > threshold) {
            lastNoiseTime = now;
            if (!isTransmitting) {
                isTransmitting = true;
                if (audioTrack) audioTrack.enabled = true;
                vadStatus.textContent = "Transmitting (Noise Detected)";
                vadStatus.style.color = "#ff5252";
                log("VAD: Noise detected, resuming transmission");
            }
        } else {
            if (isTransmitting && (now - lastNoiseTime > VAD_HOLD_TIME)) {
                isTransmitting = false;
                if (audioTrack) audioTrack.enabled = false;
                vadStatus.textContent = "Monitoring (Silence - Saving Data)";
                vadStatus.style.color = "#69f0ae";
                log("VAD: Silence detected, pausing transmission");
            }
        }
        
    }, 100);
}

function connectToParent() {
    if (currentCall) {
        currentCall.close();
    }

    const targetId = `babymonitor-${roomId}-parent`;
    log(`Calling Parent (${targetId})...`, false);
    
    const call = peer.call(targetId, localStream);
    currentCall = call;
    attachCallConnectionListeners(call, 'child');
    startStatsLoop(call, 'outbound');

    call.on('close', () => {
        log('Call lost/closed. Retrying...', true);
        if (statsInterval) clearInterval(statsInterval);
        retryConnection();
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        log(`Call Error: ${err.type}`, true);
        if (statsInterval) clearInterval(statsInterval);
        retryConnection();
    });
}

function retryConnection() {
    if (childRetryTimeout) return; // Already retrying
    const delay = childRetryDelay;
    log(`Reconnecting in ${Math.round(delay / 1000)}s...`, false);
    childRetryTimeout = setTimeout(() => {
        childRetryTimeout = null;
        connectToParent();
        childRetryDelay = Math.min(childRetryDelay * 2, 30000);
    }, delay);
}

function resetChildRetry() {
    if (childRetryTimeout) clearTimeout(childRetryTimeout);
    childRetryTimeout = null;
    childRetryDelay = 3000;
}

// --- PARENT LOGIC ---
function initParent() {
    const myId = `babymonitor-${roomId}-parent`;
    log(`Creating Peer: ${myId}...`);
    
    if (peer) peer.destroy();
    peer = new Peer(myId, PEER_CONFIG);

    peer.on('open', (id) => {
        log('Peer Open. Waiting for Child...', false);
        switchToMonitor();
        updateStatus(true); 
        audioStatus.textContent = "Waiting for Child unit...";
        btnListen.style.display = 'none';
    });

    peer.on('call', (call) => {
        log(`Incoming Call from ${call.peer}`, false);
        call.answer(); 
        handleIncomingCall(call);
    });
    
    peer.on('error', (err) => {
        console.error(err);
        if (err.type === 'unavailable-id') {
             log(`ID '${roomId}' taken.`, true);
             alert('Room Name Taken.');
             stopSession();
        } else {
            log(`Peer Error: ${err.type}`, true);
            updateStatus(false);
        }
    });
    
    peer.on('disconnected', () => {
         log('Disconnected. Reconnecting...', true);
         peer.reconnect();
    });
}

function handleIncomingCall(call) {
    if (currentCall) {
        currentCall.close();
    }
    currentCall = call;
    attachCallConnectionListeners(call, 'parent');
    startStatsLoop(call, 'inbound');
    
    call.on('stream', (remoteStream) => {
        console.log('Stream received');
        pendingRemoteStream = remoteStream;
        updateStatus(true, 'active');
        statusIndicator.style.backgroundColor = '#69f0ae';
        if (audioUnlocked) {
            startPlayback(remoteStream);
        } else {
            audioStatus.textContent = "Tap 'Start Listening' to hear audio";
            btnListen.style.display = 'block';
        }
    });

    call.on('close', () => {
        console.log('Call closed');
        updateStatus(true); // Still connected to server, just lost call
        audioStatus.textContent = "Signal Lost. Waiting for Child...";
        stopVisualizer();
        statusIndicator.style.backgroundColor = '#ffcc00'; // Yellow/Orange for waiting
        pendingRemoteStream = null;
        if (statsInterval) clearInterval(statsInterval);
    });

    call.on('error', (err) => {
        console.error('Call error:', err);
        if (statsInterval) clearInterval(statsInterval);
    });
}

// Audio Handling
function startPlayback(stream) {
    const remoteAudio = document.getElementById('remote-audio');
    if (!remoteAudio) return;

    pendingRemoteStream = stream;
    remoteAudio.srcObject = stream;
    remoteAudio.muted = false;

    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    teardownAudioGraph();
    const source = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    gainNode = audioCtx.createGain();
    const initialVolume = volumeControl ? parseInt(volumeControl.value) : 100;
    gainNode.gain.setValueAtTime(initialVolume / 100, audioCtx.currentTime);
    source.connect(analyser);
    analyser.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    visualize('parent');

    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    remoteAudio.play().then(() => {
        btnListen.style.display = 'none';
        audioStatus.textContent = "Audio Connected";
    }).catch(err => {
        console.warn('Audio play blocked:', err);
        audioStatus.textContent = "Tap 'Start Listening' to hear audio";
        btnListen.style.display = 'block';
    });
}

function resumeAudioContext() {
    audioUnlocked = true;
    const remoteAudio = document.getElementById('remote-audio');
    if (remoteAudio) {
        remoteAudio.muted = false;
        remoteAudio.play().catch(e => console.error('Audio play failed:', e));
    }

    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().then(() => {
            btnListen.style.display = 'none';
            audioStatus.textContent = "Audio Connected";
        });
    } else {
        btnListen.style.display = 'none';
        audioStatus.textContent = "Audio Connected";
    }

    if (pendingRemoteStream) {
        startPlayback(pendingRemoteStream);
    }
}

// Visualizer
function visualize(prefix) {
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const bars = document.querySelectorAll(`#${prefix}-visualizer .bar`);
    const dbMeterFill = document.getElementById(`${prefix}-db-level`);

    visualizerActive = true;
    function draw() {
        if (!analyser || !visualizerActive) return;
        visualizerRafId = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        
        const levelPercent = Math.min(100, (average / 150) * 100);
        if (dbMeterFill) {
            dbMeterFill.style.width = `${levelPercent}%`;
            
            if (levelPercent > 85) dbMeterFill.style.backgroundColor = '#ff5252';
            else if (levelPercent > 60) dbMeterFill.style.backgroundColor = '#ffcc00';
            else dbMeterFill.style.backgroundColor = '#69f0ae';
        }

        for (let i = 0; i < bars.length; i++) {
            const startIdx = Math.floor(i * (bufferLength / bars.length));
            let maxVal = 0;
            for(let j=0; j < (bufferLength/bars.length); j++) {
                if(dataArray[startIdx + j] > maxVal) maxVal = dataArray[startIdx + j];
            }
            
            const height = Math.max(5, (maxVal / 255) * 100);
            bars[i].style.height = `${height}%`;
            
            if (maxVal > 200) {
                bars[i].style.backgroundColor = '#ff5252';
            } else {
                bars[i].style.backgroundColor = '#64ffda';
            }
        }
    }
    draw();
}

function stopVisualizer() {
    visualizerActive = false;
    if (visualizerRafId) cancelAnimationFrame(visualizerRafId);
    visualizerRafId = null;

    const allBars = document.querySelectorAll('.audio-visualizer .bar');
    allBars.forEach(bar => {
        bar.style.height = '5px';
        bar.style.backgroundColor = '#64ffda';
    });
    const allMeters = document.querySelectorAll('.meter-fill');
    allMeters.forEach(meter => {
        meter.style.width = '0%';
    });
}

function updateStatus(isConnected, type = 'server') {
    if (isConnected) {
        statusIndicator.classList.remove('disconnected');
        statusIndicator.classList.add('connected');
    } else {
        statusIndicator.classList.add('disconnected');
        statusIndicator.classList.remove('connected');
    }
}

function teardownAudioGraph() {
    if (analyser) {
        try { analyser.disconnect(); } catch (e) {}
    }
    if (gainNode) {
        try { gainNode.disconnect(); } catch (e) {}
    }
    analyser = null;
    gainNode = null;
}

function ensureDebugPanel() {
    const urlParams = new URLSearchParams(window.location.search);
    const debugEnabled = urlParams.get('debug') === '1';
    if (!debugEnabled || !monitorScreen || debugPanel) return;

    debugPanel = document.createElement('div');
    debugPanel.id = 'debug-panel';
    debugPanel.textContent = 'Debug: Initializing...';
    monitorScreen.appendChild(debugPanel);
}

function updateDebugPanel(lines) {
    if (!debugPanel) return;
    debugPanel.textContent = lines.join(' | ');
}

function configureTurnIfPresent() {
    if (!window.TURN_CONFIG) return;
    const turn = window.TURN_CONFIG;
    if (!turn.urls) return;
    PEER_CONFIG.config.iceServers = [
        ...ICE_SERVERS,
        { urls: turn.urls, username: turn.username, credential: turn.credential }
    ];
}

function attachCallConnectionListeners(call, roleLabel) {
    if (!call || !call.peerConnection) return;
    const pc = call.peerConnection;
    pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        log(`ICE state: ${state}`, state === 'failed');
        if (state === 'failed' || state === 'disconnected') {
            audioStatus.textContent = "Connection unstable. Reconnecting...";
            if (roleLabel === 'child') {
                retryConnection();
            }
        }
    };
    pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        log(`Connection state: ${state}`, state === 'failed');
        if (state === 'failed') {
            audioStatus.textContent = "Connection failed. Reconnecting...";
            if (roleLabel === 'child') {
                retryConnection();
            }
        }
    };
}

function startStatsLoop(call, direction) {
    if (!call || !call.peerConnection) return;
    if (statsInterval) clearInterval(statsInterval);
    if (statsLoopRunning) statsLoopRunning = false;
    lastStats = null;
    lastAudioEnergy = null;
    lastAudioEnergyTs = null;
    let badCount = 0;
    let goodCount = 0;
    let bitrateIndex = BITRATE_DEFAULT_INDEX;

    statsInterval = setInterval(async () => {
        if (statsLoopRunning) return;
        statsLoopRunning = true;
        try {
            if (!call.peerConnection) return;
            const stats = await call.peerConnection.getStats(null);
            let outbound = null;
            let inbound = null;
            let candidatePair = null;

            stats.forEach(report => {
                if (report.type === 'outbound-rtp' && report.kind === 'audio') outbound = report;
                if (report.type === 'inbound-rtp' && report.kind === 'audio') inbound = report;
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.selected) candidatePair = report;
            });

            const now = Date.now();
            let bitrate = null;
            let rtt = candidatePair ? candidatePair.currentRoundTripTime : null;
            let jitter = inbound ? inbound.jitter : null;
            let packetsLost = inbound ? inbound.packetsLost : null;
            let packetsReceived = inbound ? inbound.packetsReceived : null;
            let bytes = direction === 'outbound' ? outbound?.bytesSent : inbound?.bytesReceived;

            if (lastStats && bytes != null) {
                const timeDelta = (now - lastStats.timeMs) / 1000;
                const bytesDelta = bytes - lastStats.bytes;
                if (timeDelta > 0 && bytesDelta >= 0) {
                    bitrate = Math.round((bytesDelta * 8) / timeDelta);
                }
            }

            if (bytes != null) lastStats = { timeMs: now, bytes };

            const lossRatio = packetsReceived ? packetsLost / Math.max(1, packetsReceived + packetsLost) : 0;
            const isBad = (lossRatio > 0.05) || (rtt != null && rtt > 0.35);
            if (isBad) {
                badCount += 1;
                goodCount = 0;
            } else {
                goodCount += 1;
                badCount = 0;
            }

            if (direction === 'outbound') {
                if (badCount >= BITRATE_STEP_DOWN_AFTER && bitrateIndex > 0) {
                    bitrateIndex -= 1;
                    applyMaxBitrate(call.peerConnection, BITRATE_LEVELS[bitrateIndex]);
                    badCount = 0;
                }
                if (goodCount >= BITRATE_STEP_UP_AFTER && bitrateIndex < BITRATE_LEVELS.length - 1) {
                    bitrateIndex += 1;
                    applyMaxBitrate(call.peerConnection, BITRATE_LEVELS[bitrateIndex]);
                    goodCount = 0;
                }
            }

            latestNetworkLabel = isBad ? 'Network: Poor' : 'Network: Good';

            if (inbound) {
                const totalEnergy = inbound.totalAudioEnergy;
                const totalSamples = inbound.totalSamplesReceived;
                const remoteAudio = document.getElementById('remote-audio');
                if (totalEnergy != null && totalSamples != null) {
                    if (lastAudioEnergy != null) {
                        const energyDelta = totalEnergy - lastAudioEnergy;
                        if (energyDelta < 0.0001 && (now - lastAudioEnergyTs) > SILENCE_WARN_MS) {
                            const needsUnlock = (audioCtx && audioCtx.state === 'suspended') || (remoteAudio && remoteAudio.paused) || (remoteAudio && remoteAudio.muted);
                            if (needsUnlock) {
                                audioStatus.textContent = "Tap 'Start Listening' to resume audio";
                                btnListen.style.display = 'block';
                            }
                        } else {
                            lastAudioEnergyTs = now;
                        }
                    } else {
                        lastAudioEnergyTs = now;
                    }
                    lastAudioEnergy = totalEnergy;
                }
            }

            updateDebugPanel([
                latestNetworkLabel,
                bitrate ? `Bitrate: ${(bitrate / 1000).toFixed(1)}kbps` : 'Bitrate: n/a',
                rtt != null ? `RTT: ${(rtt * 1000).toFixed(0)}ms` : 'RTT: n/a',
                jitter != null ? `Jitter: ${(jitter * 1000).toFixed(0)}ms` : 'Jitter: n/a',
                packetsLost != null ? `Loss: ${packetsLost}` : 'Loss: n/a'
            ]);
        } finally {
            statsLoopRunning = false;
        }
    }, STATS_INTERVAL_MS);
}

function applyMaxBitrate(peerConnection, maxBitrate) {
    try {
        const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'audio');
        if (!sender) return;
        const parameters = sender.getParameters();
        if (!parameters.encodings) parameters.encodings = [{}];
        parameters.encodings[0].maxBitrate = maxBitrate;
        sender.setParameters(parameters);
        log(`Set max bitrate to ${Math.round(maxBitrate / 1000)}kbps`, false);
    } catch (e) {
        console.warn('Failed to set max bitrate', e);
    }
}
