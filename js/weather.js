import * as THREE from 'three';

// Rain vertex shader
const rainVertexShader = `
    attribute float aSpeed;
    attribute float aOffset;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uBounds;

    varying float vAlpha;

    void main() {
        vec3 pos = position;

        // Animate rain falling
        float t = mod(pos.y - uTime * aSpeed * 15.0 + aOffset * uBounds, uBounds);
        pos.y = t - uBounds * 0.5;

        // Wind effect
        pos.x += sin(uTime * 0.5 + aOffset * 6.28) * 1.5;

        vAlpha = smoothstep(0.0, 2.0, pos.y + uBounds * 0.5) *
                 smoothstep(uBounds, uBounds - 2.0, pos.y + uBounds * 0.5);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uPixelRatio * 2.0 * (100.0 / -mvPosition.z);
    }
`;

const rainFragmentShader = `
    varying float vAlpha;

    void main() {
        vec2 uv = gl_PointCoord - vec2(0.5);
        if (abs(uv.x) > 0.1 || abs(uv.y) > 0.5) discard;

        gl_FragColor = vec4(0.7, 0.8, 1.0, vAlpha * 0.5);
    }
`;

// Snow vertex shader
const snowVertexShader = `
    attribute float aSpeed;
    attribute float aOffset;
    attribute float aSize;

    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uBounds;

    varying float vAlpha;

    void main() {
        vec3 pos = position;

        // Animate snow falling
        float t = mod(pos.y - uTime * aSpeed * 4.0 + aOffset * uBounds, uBounds);
        pos.y = t - uBounds * 0.5;

        // Wobble
        pos.x += sin(uTime * 0.8 + aOffset * 6.28) * 1.0;
        pos.z += cos(uTime * 0.6 + aOffset * 3.14) * 0.8;

        vAlpha = smoothstep(0.0, 3.0, pos.y + uBounds * 0.5) *
                 smoothstep(uBounds, uBounds - 3.0, pos.y + uBounds * 0.5);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = aSize * uPixelRatio * (120.0 / -mvPosition.z);
    }
`;

const snowFragmentShader = `
    varying float vAlpha;

    void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;

        float alpha = (1.0 - dist * 2.0);
        alpha *= alpha;

        gl_FragColor = vec4(1.0, 1.0, 1.0, alpha * vAlpha * 0.8);
    }
`;

class WeatherSystem {
    constructor(scene, camera) {
        this.scene = scene;
        this.camera = camera;
        this.currentWeather = 'clear';
        this.particles = null;
        this.fog = null;
    }

    setWeather(type) {
        this.clear();
        this.currentWeather = type;

        switch (type) {
            case 'rain':
                this.createRain();
                break;
            case 'snow':
                this.createSnow();
                break;
            case 'fog':
                this.createFog();
                break;
            case 'clear':
            default:
                // No weather effects
                break;
        }
    }

    createRain(count = 6000) {
        const bounds = 50;
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        const offsets = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * bounds;
            positions[i * 3 + 1] = Math.random() * bounds;
            positions[i * 3 + 2] = (Math.random() - 0.5) * bounds;

            speeds[i] = 0.8 + Math.random() * 0.4;
            offsets[i] = Math.random();
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));

        const material = new THREE.ShaderMaterial({
            vertexShader: rainVertexShader,
            fragmentShader: rainFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: window.devicePixelRatio },
                uBounds: { value: bounds }
            },
            transparent: true,
            depthWrite: false,
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);

        // Darken the scene slightly for rain
        this.scene.fog = new THREE.FogExp2(0x555566, 0.015);
    }

    createSnow(count = 4000) {
        const bounds = 50;
        const positions = new Float32Array(count * 3);
        const speeds = new Float32Array(count);
        const offsets = new Float32Array(count);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * bounds;
            positions[i * 3 + 1] = Math.random() * bounds;
            positions[i * 3 + 2] = (Math.random() - 0.5) * bounds;

            speeds[i] = 0.3 + Math.random() * 0.5;
            offsets[i] = Math.random();
            sizes[i] = 2.5 + Math.random() * 5.0;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
        geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const material = new THREE.ShaderMaterial({
            vertexShader: snowVertexShader,
            fragmentShader: snowFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: window.devicePixelRatio },
                uBounds: { value: bounds }
            },
            transparent: true,
            depthWrite: false,
        });

        this.particles = new THREE.Points(geometry, material);
        this.scene.add(this.particles);

        // Light fog for snow - slightly denser for cozy feel
        this.scene.fog = new THREE.FogExp2(0xdddde8, 0.014);
    }

    createFog() {
        this.scene.fog = new THREE.FogExp2(0x888899, 0.035);
    }

    update(time) {
        if (this.particles) {
            this.particles.material.uniforms.uTime.value = time;
        }
    }

    clear() {
        if (this.particles) {
            this.scene.remove(this.particles);
            this.particles.geometry.dispose();
            this.particles.material.dispose();
            this.particles = null;
        }
        this.scene.fog = null;
    }
}

export { WeatherSystem };
