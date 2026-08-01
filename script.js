// WebGL & Audio Contexts
let gl, audioCtx, analyser;
let canvas, uiCanvas, uiCtx;
let width, height;

// Shader Programs
let programs = {};
let buffers = {};
let textures = {};
let framebuffers = {};

// Particle Data
let particleCount = 200;
let particleData = {};

// State
let state = {
    audio: null,
    bgImage: null,
    bgType: 'image',
    isPlaying: false,
    startTime: 0,
    time: 0,

    // Audio Reactive - THE HIT
    beat: 0.0, // Flash intensity
    zoomPulse: 0.0, // Zoom punch value

    // Settings
    bloomThreshold: 0.6,
    bloomStrength: 1.5,
    bloomRadius: 1.0,
    exposure: 1.2,

    particleSpeed: 1.0,

    showVisualizer: true, // ENABLED BY DEFAULT matching reference
    recording: false
};

// Recording
let mediaRecorder;
let recordedChunks = [];

window.onload = async () => {
    initUI();
    initWebGL();
    await loadDefaultAssets();
    resize();
    render(0);
};

function initUI() {
    canvas = document.getElementById('glCanvas');
    uiCanvas = document.getElementById('uiCanvas');
    uiCtx = uiCanvas.getContext('2d');

    document.getElementById('bgInput').addEventListener('change', handleBgUpload);
    document.getElementById('audioInput').addEventListener('change', handleAudioUpload);

    bindSlider('bloomThreshold', v => state.bloomThreshold = v);
    bindSlider('bloomStrength', v => state.bloomStrength = v);
    bindSlider('bloomRadius', v => state.bloomRadius = v);
    bindSlider('exposure', v => state.exposure = v);
    bindSlider('softFocus', v => state.particleSpeed = v);

    const vizToggle = document.getElementById('showVisualizer');
    vizToggle.checked = true; // Checked by default
    vizToggle.addEventListener('change', e => state.showVisualizer = e.target.checked);

    document.getElementById('playBtn').addEventListener('click', togglePlay);
    document.getElementById('recordBtn').addEventListener('click', toggleRecord);

    window.addEventListener('resize', resize);

    const dropZone = document.getElementById('dragOverlay');
    window.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('active'); });
    window.addEventListener('dragleave', e => { e.preventDefault(); dropZone.classList.remove('active'); });
    window.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('active');
        handleDrop(e.dataTransfer.files);
    });
}

function bindSlider(id, callback) {
    const el = document.getElementById(id);
    if (!el) return;
    const displayId = 'val-' + id.replace(/([A-Z])/g, '-$1').toLowerCase();
    const display = document.getElementById(displayId);
    el.addEventListener('input', e => {
        const val = parseFloat(e.target.value);
        if (display) display.textContent = val.toFixed(1);
        callback(val);
    });
}

async function loadDefaultAssets() {
    try {
        await loadBackground('assets/default.png');
        await loadAudio('assets/default.wav');
    } catch (e) { console.warn(e); }
}

function initWebGL() {
    gl = canvas.getContext('webgl');
    if (!gl) alert("WebGL not supported");

    gl.getExtension('OES_texture_float');
    gl.getExtension('OES_texture_float_linear');

    programs.renderScene = createProgram(SHADERS.vertex, SHADERS.renderScene);
    programs.particle = createProgram(SHADERS.particleVertex, SHADERS.particleFragment);
    programs.highPass = createProgram(SHADERS.vertex, SHADERS.highPass);
    programs.blur = createProgram(SHADERS.vertex, SHADERS.blur);
    programs.composite = createProgram(SHADERS.vertex, SHADERS.composite);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    buffers.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    initParticles();
}

function initParticles() {
    const pos = new Float32Array(particleCount * 3);
    const alpha = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i++) {
        pos[i * 3 + 0] = (Math.random() * 2 - 1);
        pos[i * 3 + 1] = (Math.random() * 2 - 1);
        pos[i * 3 + 2] = Math.random() * 10.0 + 5.0;
        alpha[i] = Math.random() * 0.5 + 0.2;
    }
    buffers.particles = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    buffers.particleAlpha = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particleAlpha);
    gl.bufferData(gl.ARRAY_BUFFER, alpha, gl.STATIC_DRAW);
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    uiCanvas.width = width;
    uiCanvas.height = height;
    gl.viewport(0, 0, width, height);

    framebuffers.scene = createFramebuffer(width, height);
    framebuffers.highPass = createFramebuffer(width, height);
    const bloomW = width / 2;
    const bloomH = height / 2;
    framebuffers.blurA = createFramebuffer(bloomW, bloomH);
    framebuffers.blurB = createFramebuffer(bloomW, bloomH);
}

function createFramebuffer(w, h) {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
}

function createProgram(vsSource, fsSource) {
    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.linkProgram(prog);
    return prog;
}

function compileShader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
}

// --- Asset Loading ---
function handleBgUpload(e) { loadBackgroundFile(e.target.files[0]); }
function handleAudioUpload(e) { loadAudioFile(e.target.files[0]); }
function handleDrop(files) {
    for (let f of files) {
        if (f.type.startsWith('image/') || f.type.startsWith('video/')) loadBackgroundFile(f);
        if (f.type.startsWith('audio/')) loadAudioFile(f);
    }
}
function loadBackgroundFile(file) {
    if (!file) return;
    loadBackground(URL.createObjectURL(file), file.type.startsWith('video/'));
}
function loadAudioFile(file) {
    if (!file) return;
    loadAudio(URL.createObjectURL(file));
}

function loadBackground(url, isVideo = false) {
    return new Promise((resolve) => {
        if (state.bgType === 'video' && state.bgImage) { state.bgImage.pause(); }
        let el;
        if (url.match(/\.(mp4|webm|mov)$/i) || isVideo) {
            el = document.createElement('video');
            el.loop = true;
            el.muted = true;
            el.playsInline = true;
            el.oncanplay = () => resolve();
            state.bgType = 'video';
        } else {
            el = new Image();
            el.onload = () => resolve();
            state.bgType = 'image';
        }
        el.crossOrigin = "Anonymous";
        el.src = url;
        state.bgImage = el;
        textures.base = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, textures.base);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        if (state.bgType === 'video') el.play();
    });
}

function loadAudio(url) {
    return new Promise((resolve) => {
        const audio = new Audio();
        audio.src = url;
        audio.crossOrigin = "Anonymous";
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(audio);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256; // Smaller FFT for smoother bars
        source.connect(analyser);
        analyser.connect(audioCtx.destination);
        state.audio = audio;
        audio.addEventListener('ended', () => { state.isPlaying = false; document.getElementById('playBtn').textContent = "▶ Play"; });
        resolve();
    });
}

// --- BEAT DETECTION ---
let prevVol = 0;
let beatHold = 0;

function updateAudioLogic() {
    if (!analyser || !state.isPlaying) {
        state.beat *= 0.9;
        state.zoomPulse *= 0.9;
        return;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);

    // Bass Detect
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += data[i]; // Lower band
    const vol = sum / 6;

    // Threshold
    if (vol > 160 && vol > prevVol + 10 && beatHold <= 0) {
        state.beat = 0.8; // Flash brightness
        state.zoomPulse = 0.15; // ZOOM HIT amt
        beatHold = 8;
    } else {
        state.beat *= 0.9; // Fast fade
        state.zoomPulse *= 0.85; // Fast recovery
        beatHold--;
    }
    prevVol = vol;
}

// --- Render Loop ---

function render(now) {
    requestAnimationFrame(render);
    state.time = now * 0.001;

    updateAudioLogic();

    if (!state.bgImage) return;
    if (state.bgType === 'video' || state.bgType === 'image') {
        gl.bindTexture(gl.TEXTURE_2D, textures.base);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.bgImage);
    }

    // PASS 1: Base Scene (Image + ZOOM PULSE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.scene.fbo);
    gl.viewport(0, 0, width, height);
    gl.useProgram(programs.renderScene);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures.base);
    gl.uniform1i(gl.getUniformLocation(programs.renderScene, "tDiffuse"), 0);
    gl.uniform1f(gl.getUniformLocation(programs.renderScene, "time"), state.time);
    gl.uniform1f(gl.getUniformLocation(programs.renderScene, "zoomPulse"), state.zoomPulse); // Correct Hit Effect

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // DRAW PARTICLES
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

    gl.useProgram(programs.particle);

    const posLoc = gl.getAttribLocation(programs.particle, "position");
    const alphaLoc = gl.getAttribLocation(programs.particle, "alpha");

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particles);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(posLoc);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.particleAlpha);
    gl.vertexAttribPointer(alphaLoc, 1, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(alphaLoc);

    gl.uniform1f(gl.getUniformLocation(programs.particle, "time"), state.time);
    gl.uniform1f(gl.getUniformLocation(programs.particle, "speed"), state.particleSpeed);
    gl.uniform2f(gl.getUniformLocation(programs.particle, "resolution"), width, height);

    gl.drawArrays(gl.POINTS, 0, particleCount);

    gl.disable(gl.BLEND);

    // PASS 2: High Pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.highPass.fbo);
    gl.viewport(0, 0, framebuffers.highPass.w, framebuffers.highPass.h);
    gl.useProgram(programs.highPass);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.quad);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.scene.tex);
    gl.uniform1i(gl.getUniformLocation(programs.highPass, "tDiffuse"), 0);
    gl.uniform1f(gl.getUniformLocation(programs.highPass, "threshold"), state.bloomThreshold);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // PASS 3: Blur
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.blurA.fbo);
    gl.viewport(0, 0, framebuffers.blurA.w, framebuffers.blurA.h);
    gl.useProgram(programs.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.highPass.tex);
    gl.uniform1i(gl.getUniformLocation(programs.blur, "tDiffuse"), 0);
    gl.uniform2f(gl.getUniformLocation(programs.blur, "resolution"), framebuffers.blurA.w, framebuffers.blurA.h);
    gl.uniform2f(gl.getUniformLocation(programs.blur, "direction"), 1.0, 0.0);
    gl.uniform1f(gl.getUniformLocation(programs.blur, "radius"), state.bloomRadius);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffers.blurB.fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.blurA.tex);
    gl.uniform2f(gl.getUniformLocation(programs.blur, "direction"), 0.0, 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // PASS 4: Composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(programs.composite);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.scene.tex);
    gl.uniform1i(gl.getUniformLocation(programs.composite, "tBase"), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, framebuffers.blurB.tex);
    gl.uniform1i(gl.getUniformLocation(programs.composite, "tBloom"), 1);

    gl.uniform1f(gl.getUniformLocation(programs.composite, "exposure"), state.exposure);
    gl.uniform1f(gl.getUniformLocation(programs.composite, "bloomStrength"), state.bloomStrength);
    gl.uniform1f(gl.getUniformLocation(programs.composite, "hit"), state.beat);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (state.showVisualizer) renderUI();
    else uiCtx.clearRect(0, 0, width, height);
}

// --- RENDER VISUALIZER (Cinematic FILLED Glow) ---
function renderUI() {
    uiCtx.clearRect(0, 0, width, height);

    // Draw Cinematic Black Bars (Letterbox) - 10% height
    const barHeight = height * 0.1;
    uiCtx.fillStyle = "black";
    uiCtx.fillRect(0, 0, width, barHeight);
    uiCtx.fillRect(0, height - barHeight, width, barHeight);

    if (!analyser || !state.isPlaying) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Config: Bottom of the viewable area (above bottom bar)
    const bottomY = height - barHeight;
    const cx = width / 2;
    const maxH = height * 0.25; // Good height for impact

    // Gradient Fill for "Solid Body" look (White -> Cyan -> Transparent)
    // This matches the "Glowing Hill" look in the reference
    const gradient = uiCtx.createLinearGradient(0, bottomY - maxH, 0, bottomY);
    gradient.addColorStop(0, "rgba(255, 255, 255, 1.0)"); // Top White Hot
    gradient.addColorStop(0.3, "rgba(0, 255, 255, 0.8)"); // Cyan body
    gradient.addColorStop(1, "rgba(0, 255, 255, 0.0)"); // Fade out at bottom

    uiCtx.fillStyle = gradient;
    uiCtx.shadowBlur = 15;
    uiCtx.shadowColor = "rgba(0, 255, 255, 0.5)"; // Glow

    uiCtx.beginPath();
    uiCtx.moveTo(0, bottomY); // Start bottom left

    // Logic: Mirrored Spectrum
    // We render from Left edge -> Center -> Right Edge
    // Actually, simpler to draw Center -> Right, then mirror path? 
    // Let's calculate points to make a single smooth polygon.

    const activeBins = Math.floor(bufferLength * 0.6);
    const step = (width / 2) / activeBins;

    // LEFT SIDE (Reverse loop)
    for (let i = activeBins - 1; i >= 0; i--) {
        const v = dataArray[i] / 255.0;
        // Cubic smoothing or simple squares? Reference is soft.
        // Let's use v^2 for contrast
        const y = bottomY - (v * v * maxH);
        const x = cx - i * step;
        uiCtx.lineTo(x, y);
    }

    // RIGHT SIDE (Forward loop)
    for (let i = 0; i < activeBins; i++) {
        const v = dataArray[i] / 255.0;
        const y = bottomY - (v * v * maxH);
        const x = cx + i * step;
        uiCtx.lineTo(x, y);
    }

    uiCtx.lineTo(width, bottomY); // Bottom Right
    uiCtx.lineTo(0, bottomY); // Close loop
    uiCtx.fill(); // FILL IT for weight

    // Add a thin white line on top for definition?
    uiCtx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    uiCtx.lineWidth = 1;
    uiCtx.stroke();

    uiCtx.shadowBlur = 0;
}

// --- Toggle Logic ---
function togglePlay() {
    if (!state.audio) return;
    if (state.isPlaying) {
        state.audio.pause();
        if (state.bgType === 'video') state.bgImage.pause();
        state.isPlaying = false;
        document.getElementById('playBtn').textContent = "▶ Play";
    } else {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        state.audio.play();
        if (state.bgType === 'video') state.bgImage.play();
        state.isPlaying = true;
        document.getElementById('playBtn').textContent = "❚❚ Pause";
    }
}

function toggleRecord() {
    if (state.recording) {
        mediaRecorder.stop();
        state.recording = false;
        document.getElementById('recordBtn').textContent = "● Record";
    } else {
        startRecording();
        state.recording = true;
        document.getElementById('recordBtn').textContent = "■ Stop";
    }
}

function startRecording() {
    recordedChunks = [];
    const canvasStream = canvas.captureStream(60);
    mediaRecorder = new MediaRecorder(canvasStream, { mimeType: 'video/webm; codecs=vp9' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = saveVideo;
    mediaRecorder.start();
}

function saveVideo() {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lyric_wave_style.webm';
    a.click();
    URL.revokeObjectURL(url);
}
