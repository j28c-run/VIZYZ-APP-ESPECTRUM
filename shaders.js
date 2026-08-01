const SHADERS = {
    vertex: `
        attribute vec2 position;
        varying vec2 vUv;
        void main() {
            vUv = position * 0.5 + 0.5;
            vUv.y = 1.0 - vUv.y; 
            gl_Position = vec4(position, 0.0, 1.0);
        }
    `,

    // --- PARTICLE SHADERS ---
    particleVertex: `
        attribute vec3 position;
        attribute float alpha;
        uniform float time;
        uniform float speed;
        uniform vec2 resolution;
        varying float vAlpha;
        
        void main() {
            vAlpha = alpha;
            vec3 pos = position; // -1 to 1
            
            // Simple upward drift
            pos.y += time * speed * 0.1; 
            pos.y = -1.0 + mod(pos.y + 1.0, 2.0); // Wrap Y
            
            // Side sway
            pos.x += sin(time + pos.y * 3.0) * 0.02;

            gl_Position = vec4(pos.x, pos.y, 0.0, 1.0);
            gl_PointSize = position.z * (resolution.y / 1080.0) * 1.5;
        }
    `,

    particleFragment: `
        precision mediump float;
        varying float vAlpha;
        void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if(dist > 0.5) discard;
            float glow = 1.0 - (dist * 2.0);
            glow = pow(glow, 2.0); 
            gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * glow);
        }
    `,

    // --- PASS 1: Base Scene + ZOOM PUNCH ---
    renderScene: `
        precision mediump float;
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float zoomPulse; // 0.0 to 1.0 punch
        varying vec2 vUv;
        
        void main() {
            // Base slow zoom
            float baseScale = 1.0 + sin(time * 0.1) * 0.02;
            
            // ZOOM PUNCH
            // Adds immediate scale
            float scale = baseScale + zoomPulse;

            vec2 center = vec2(0.5);
            vec2 uv = (vUv - center) / scale + center;
            
            // Clamp to edge
            uv = clamp(uv, 0.001, 0.999);

            vec4 color = texture2D(tDiffuse, uv);
            gl_FragColor = color;
        }
    `,

    // --- PASS 2: High Pass ---
    highPass: `
        precision mediump float;
        uniform sampler2D tDiffuse;
        uniform float threshold;
        varying vec2 vUv;
        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            float brightness = max(tex.r, max(tex.g, tex.b));
            if(brightness > threshold) {
                gl_FragColor = vec4(tex.rgb, 1.0);
            } else {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
        }
    `,

    // --- PASS 3: Blur ---
    blur: `
        precision mediump float;
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform vec2 direction;
        uniform float radius; 
        varying vec2 vUv;
        void main() {
            vec4 color = vec4(0.0);
            vec2 off = vec2(1.3333333333333333) * direction;
            color += texture2D(tDiffuse, vUv) * 0.29411764705882354;
            color += texture2D(tDiffuse, vUv + (off / resolution) * radius) * 0.35294117647058826;
            color += texture2D(tDiffuse, vUv - (off / resolution) * radius) * 0.35294117647058826;
            gl_FragColor = color;
        }
    `,

    // --- PASS 4: Composite + FLASH ---
    composite: `
        precision mediump float;
        uniform sampler2D tBase;
        uniform sampler2D tBloom;
        
        uniform float exposure;
        uniform float bloomStrength;
        uniform float hit; // For FLASH
        
        varying vec2 vUv;

        void main() {
            vec3 base = texture2D(tBase, vUv).rgb;
            vec3 bloom = texture2D(tBloom, vUv).rgb;
            
            // Additive Bloom
            vec3 color = base + bloom * bloomStrength;
            
            // FLASH Effect on Hit
            // Adds white overlay based on hit intensity
            color += vec3(hit * 0.2); 

            // Tone Mapping
            color *= exposure;
            // Reinhard
            color = color / (color + vec3(1.0)); 
            // Gamma
            color = pow(color, vec3(1.0 / 2.2)); 

            gl_FragColor = vec4(color, 1.0);
        }
    `
};
