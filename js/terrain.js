import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { SimplexNoise } from './noise.js';

const terrainVertexShader = `
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vHeight;

    void main() {
        vUv = uv;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vNormal = normalize(normalMatrix * normal);
        vHeight = position.y;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const terrainFragmentShader = `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uAmbientColor;
    uniform float uWaterLevel;
    uniform float uTime;
    uniform float uSnowAccum;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vHeight;

    // Simple hash for noise in fragment shader
    float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float fbm2D(vec2 p) {
        float val = 0.0;
        float amp = 0.5;
        for (int i = 0; i < 4; i++) {
            val += amp * noise2D(p);
            p *= 2.0;
            amp *= 0.5;
        }
        return val;
    }

    void main() {
        float h = vHeight;

        vec3 deepWater = vec3(0.05, 0.15, 0.4);
        vec3 shallowWater = vec3(0.1, 0.35, 0.6);
        vec3 sand = vec3(0.76, 0.7, 0.5);
        vec3 grass = vec3(0.2, 0.5, 0.15);
        vec3 darkGrass = vec3(0.15, 0.35, 0.1);
        vec3 rock = vec3(0.45, 0.4, 0.35);
        vec3 snow = vec3(0.95, 0.95, 0.97);

        vec3 color;

        // Smooth transitions using smoothstep and noise for natural blending
        if (h < uWaterLevel - 1.0) {
            color = deepWater;
        } else if (h < uWaterLevel) {
            float t = smoothstep(uWaterLevel - 1.0, uWaterLevel, h);
            color = mix(deepWater, shallowWater, t);
        } else if (h < uWaterLevel + 0.5) {
            float t = smoothstep(uWaterLevel, uWaterLevel + 0.5, h);
            // Add noise for natural sand-water edge
            float edgeNoise = fbm2D(vWorldPos.xz * 0.5 + uTime * 0.05) * 0.3;
            t = clamp(t + edgeNoise, 0.0, 1.0);
            color = mix(shallowWater, sand, t);
        } else if (h < 2.0) {
            float range = max(2.0 - uWaterLevel - 0.5, 0.01);
            float t = smoothstep(uWaterLevel + 0.5, uWaterLevel + 0.5 + range, h);
            // Noise-based grass/sand transition for natural look
            float grassNoise = fbm2D(vWorldPos.xz * 2.0) * 0.4;
            t = clamp(t + grassNoise - 0.2, 0.0, 1.0);
            color = mix(sand, grass, t);
        } else if (h < 5.0) {
            float t = smoothstep(2.0, 5.0, h);
            // Add variation to grass colors
            float grassVar = fbm2D(vWorldPos.xz * 3.0) * 0.3;
            vec3 variedGrass = grass * (1.0 + grassVar * 0.5);
            vec3 variedDarkGrass = darkGrass * (1.0 - grassVar * 0.2);
            color = mix(variedGrass, variedDarkGrass, t);
        } else if (h < 8.0) {
            float t = smoothstep(5.0, 8.0, h);
            color = mix(darkGrass, rock, t);
        } else if (h < 11.0) {
            float t = smoothstep(8.0, 11.0, h);
            color = mix(rock, snow, t);
        } else {
            color = snow;
        }

        // Shimmer for underwater areas
        if (h < uWaterLevel) {
            float shimmer = sin(vWorldPos.x * 3.0 + uTime * 2.0) *
                           cos(vWorldPos.z * 3.0 + uTime * 1.5) * 0.03;
            color += shimmer;
        }

        // Improved snow accumulation blending
        if (h >= uWaterLevel + 0.3 && uSnowAccum > 0.0) {
            float slope = 1.0 - vNormal.y;
            // Better flatness: snow accumulates on flat surfaces, slides off steep ones
            float flatness = 1.0 - slope * 3.0;
            flatness = clamp(flatness, 0.0, 1.0);
            // Snow more likely at higher elevations
            float heightFactor = smoothstep(3.0, 11.0, h);
            // Add noise for natural snow patches
            float snowNoise = fbm2D(vWorldPos.xz * 2.0) * 0.4;
            float snowBlend = uSnowAccum * flatness * (heightFactor * 0.7 + 0.3 + snowNoise * 0.3);
            snowBlend = clamp(snowBlend, 0.0, 1.0);
            vec3 snowColor = vec3(0.92, 0.94, 0.98);
            color = mix(color, snowColor, snowBlend);
        }

        // Simulated ambient occlusion: darker in valleys/low areas
        float aoFactor = smoothstep(-2.0, 5.0, h);
        aoFactor = mix(0.7, 1.0, aoFactor);
        // Steeper slopes also slightly darker (self-shadowing)
        float slopeDarken = 1.0 - (1.0 - vNormal.y) * 0.15;
        aoFactor *= slopeDarken;
        color *= aoFactor;

        // Lighting with wrap diffuse
        float diff = max(dot(vNormal, uSunDir), 0.0);
        float wrap = max(dot(vNormal, uSunDir) * 0.5 + 0.5, 0.0);
        vec3 lit = color * (uAmbientColor + uSunColor * wrap * 0.8);
        gl_FragColor = vec4(lit, 1.0);
    }
`;

class ProceduralTerrain {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.renderer = options.renderer || null;
        this.size = options.size || 30;
        this.resolution = options.resolution || 120;
        this.noise = new SimplexNoise(options.seed || 42);
        this.terrainType = options.type || 'plains';
        this.waterLevel = options.waterLevel || -2;
        this._cachedWaterLevel = this.waterLevel;
        this.hasWater = true;

        this.mesh = null;
        this.waterMesh = null;
        this.snowAccum = 0;

        this.material = new THREE.ShaderMaterial({
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
            uniforms: {
                uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
                uSunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
                uAmbientColor: { value: new THREE.Color(0.3, 0.35, 0.5) },
                uWaterLevel: { value: this.waterLevel },
                uTime: { value: 0 },
                uSnowAccum: { value: 0 }
            }
        });

        this.generate();
    }

    getHeight(x, z) {
        const scale = 0.04;
        let h;

        switch (this.terrainType) {
            case 'plains':
                h = this.noise.fbm(x * scale, z * scale, 4) * 4;
                h += this.noise.fbm(x * scale * 3, z * scale * 3, 2) * 0.5;
                h = Math.max(h, -0.5);
                break;

            case 'mountains':
                h = this.noise.fbm(x * scale, z * scale, 6) * 12;
                h = Math.abs(h);
                h = h * h * 0.15;
                h += this.noise.fbm(x * scale * 2, z * scale * 2, 3) * 2;
                break;

            case 'islands':
                const dist = Math.sqrt(x * x + z * z) / (this.size * 0.5);
                const falloff = Math.max(0, 1 - dist * dist);
                h = this.noise.fbm(x * scale, z * scale, 5) * 6;
                h = h * falloff - 2;
                break;

            case 'city':
                return 0; // completely flat for city
            default:
                h = this.noise.fbm(x * scale, z * scale, 4) * 3;
        }

        return h;
    }

    getGradient(x, z) {
        const delta = 0.5;
        const hL = this.getHeight(x - delta, z);
        const hR = this.getHeight(x + delta, z);
        const hF = this.getHeight(x, z + delta);
        const hB = this.getHeight(x, z - delta);
        return {
            dx: (hR - hL) / (2 * delta),
            dz: (hF - hB) / (2 * delta)
        };
    }

    generate() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
        }
        if (this.waterMesh) {
            this.scene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
            this.waterMesh.material.dispose();
        }

        // Set water levels per terrain type
        switch (this.terrainType) {
            case 'islands':
                this.waterLevel = 0;
                this.hasWater = true;
                break;
            case 'coastal':
                this.waterLevel = -1;
                this.hasWater = true;
                break;
            case 'mountains':
                this.waterLevel = -10;
                this.hasWater = false;
                break;
            case 'plains':
                this.waterLevel = -10;
                this.hasWater = false;
                break;
            case 'suburban':
            case 'city':
                this.waterLevel = -10;
                this.hasWater = false;
                break;
            default:
                this.waterLevel = -3;
                this.hasWater = true;
        }

        const geo = new THREE.PlaneGeometry(
            this.size, this.size, this.resolution, this.resolution
        );
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position.array;
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const z = positions[i + 2];
            positions[i + 1] = this.getHeight(x, z);
        }

        geo.computeVertexNormals();

        this.material.uniforms.uWaterLevel.value = this.waterLevel;
        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.receiveShadow = true;
        this.scene.add(this.mesh);

        if (this.hasWater) {
            this.createOcean();
        } else {
            this.waterMesh = null;
        }
    }

    createOcean() {
        const isIsland = this.terrainType === 'islands';
        const waterSize = isIsland ? this.size * 1.5 : this.size;

        const waterGeo = new THREE.PlaneGeometry(waterSize, waterSize);

        this.waterMesh = new Water(waterGeo, {
            textureWidth: 256,
            textureHeight: 256,
            waterNormals: new THREE.TextureLoader().load(
                'https://unpkg.com/three@0.160.0/examples/textures/waternormals.jpg',
                (texture) => {
                    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
                }
            ),
            sunDirection: new THREE.Vector3(0.5, 0.8, 0.3).normalize(),
            sunColor: 0xffffff,
            waterColor: isIsland ? 0x001a2e : 0x001e0f,
            distortionScale: isIsland ? 4.0 : 3.2,
            fog: false,
            alpha: isIsland ? 0.92 : 0.88,
            clipBias: 0.0,
        });

        this.waterMesh.rotation.x = -Math.PI / 2;
        this.waterMesh.position.y = this.waterLevel;
        this.scene.add(this.waterMesh);
    }

    setSeed(seed) {
        this.noise = new SimplexNoise(seed);
    }

    setType(type) {
        this.terrainType = type;
    }

    update(time) {
        this.material.uniforms.uTime.value = time;
        this.material.uniforms.uSnowAccum.value = this.snowAccum;

        if (this.waterMesh) {
            this.waterMesh.material.uniforms['time'].value += 1.0 / 60.0;
        }
    }

    updateSnowAccum(isSnowing, deltaTime) {
        if (isSnowing) {
            this.snowAccum = Math.min(1.0, this.snowAccum + deltaTime * 0.033);
        } else {
            this.snowAccum = Math.max(0.0, this.snowAccum - deltaTime * 0.067);
        }
    }

    setSunDirection(dir) {
        this.material.uniforms.uSunDir.value.copy(dir).normalize();
        if (this.waterMesh && this.waterMesh.material.uniforms['sunDirection']) {
            this.waterMesh.material.uniforms['sunDirection'].value.copy(dir).normalize();
        }
    }

    setSunColor(color) {
        this.material.uniforms.uSunColor.value.copy(color);
        if (this.waterMesh && this.waterMesh.material.uniforms['sunColor']) {
            this.waterMesh.material.uniforms['sunColor'].value.copy(color);
        }
    }

    setAmbientColor(color) {
        this.material.uniforms.uAmbientColor.value.copy(color);
    }

    setSkyColor(color) {
        // Water plugin doesn't use a separate sky color uniform
        // It uses sunDirection and sunColor for reflections
    }

    findFlatSpot(centerX = 0, centerZ = 0, radius = 30) {
        const candidates = [];
        const attempts = 150;
        const halfSize = this.size * 0.5;

        for (let attempt = 0; attempt < attempts; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * radius;
            const x = centerX + Math.cos(angle) * dist;
            const z = centerZ + Math.sin(angle) * dist;

            // Skip if outside terrain bounds
            if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) continue;

            const h = this.getHeight(x, z);

            // Better slope calculation using gradient magnitude
            const grad = this.getGradient(x, z);
            const slopeMag = Math.sqrt(grad.dx * grad.dx + grad.dz * grad.dz);

            // Only consider spots above water and not too steep
            if (h > this.waterLevel + 0.5 && slopeMag < 1.5) {
                // Preference for spots near center (closer to roads)
                const distFromCenter = Math.sqrt(x * x + z * z);
                const centerPreference = 1.0 - distFromCenter / radius;

                // Preference for slightly elevated spots (not in valleys)
                const elevationPreference = Math.min(h / 3.0, 1.0);

                // Combined score: lower is better (slope dominates, center/elevation as bonuses)
                const score = slopeMag * 2.0 - centerPreference - elevationPreference * 0.5;

                candidates.push({ x, y: h, z, slope: slopeMag, score });
            }
        }

        if (candidates.length === 0) return null;

        // Sort by score (best = lowest)
        candidates.sort((a, b) => a.score - b.score);
        // Pick from top candidates with some randomness
        const topN = Math.min(5, candidates.length);
        return candidates[Math.floor(Math.random() * topN)];
    }
}

export { ProceduralTerrain };