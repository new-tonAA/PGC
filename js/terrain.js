import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

// Vertex shader for terrain
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

// Fragment shader for terrain with height-based coloring + snow accumulation
const terrainFragmentShader = `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uAmbientColor;
    uniform float uWaterLevel;
    uniform float uTime;
    uniform float uSnowAccum; // 0.0 to 1.0 snow accumulation

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vHeight;

    void main() {
        float h = vHeight;

        // Height-based terrain colors
        vec3 deepWater = vec3(0.05, 0.15, 0.4);
        vec3 shallowWater = vec3(0.1, 0.35, 0.6);
        vec3 sand = vec3(0.76, 0.7, 0.5);
        vec3 grass = vec3(0.2, 0.5, 0.15);
        vec3 darkGrass = vec3(0.15, 0.35, 0.1);
        vec3 rock = vec3(0.45, 0.4, 0.35);
        vec3 snow = vec3(0.95, 0.95, 0.97);

        vec3 color;
        if (h < uWaterLevel - 1.0) {
            color = deepWater;
        } else if (h < uWaterLevel) {
            color = mix(deepWater, shallowWater, (h - uWaterLevel + 1.0));
        } else if (h < uWaterLevel + 0.5) {
            color = mix(shallowWater, sand, (h - uWaterLevel) / 0.5);
        } else if (h < 2.0) {
            color = mix(sand, grass, (h - uWaterLevel - 0.5) / max(2.0 - uWaterLevel - 0.5, 0.01));
        } else if (h < 5.0) {
            color = mix(grass, darkGrass, (h - 2.0) / 3.0);
        } else if (h < 8.0) {
            color = mix(darkGrass, rock, (h - 5.0) / 3.0);
        } else if (h < 11.0) {
            color = mix(rock, snow, (h - 8.0) / 3.0);
        } else {
            color = snow;
        }

        // Water shimmer
        if (h < uWaterLevel) {
            float shimmer = sin(vWorldPos.x * 3.0 + uTime * 2.0) *
                           cos(vWorldPos.z * 3.0 + uTime * 1.5) * 0.03;
            color += shimmer;
        }

        // Beach foam near shoreline
        float shoreDist = h - uWaterLevel;
        if (shoreDist > -0.3 && shoreDist < 0.8) {
            float foamZone = smoothstep(-0.3, 0.1, shoreDist) * smoothstep(0.8, 0.3, shoreDist);
            float foamPattern = sin(vWorldPos.x * 4.0 + uTime * 1.8) * cos(vWorldPos.z * 3.5 + uTime * 1.2);
            foamPattern = foamPattern * 0.5 + 0.5;
            float waveBreak = sin(uTime * 2.5 + vWorldPos.x * 0.8) * 0.5 + 0.5;
            float foamStrength = foamZone * foamPattern * 0.5 * waveBreak;
            vec3 foamColor = vec3(0.92, 0.96, 1.0);
            color = mix(color, foamColor, clamp(foamStrength, 0.0, 0.6));
        }

        // Snow accumulation effect - blend terrain color towards white
        if (h >= uWaterLevel + 0.3 && uSnowAccum > 0.0) {
            // Snow accumulates more on flat surfaces and lower elevations
            float slope = 1.0 - abs(vNormal.y); // 0 = flat, 1 = vertical
            float flatness = 1.0 - slope * 2.0;
            flatness = clamp(flatness, 0.0, 1.0);

            // More snow on flat ground, less on steep slopes
            float snowBlend = uSnowAccum * flatness;

            // Reduce snow on very high peaks (wind blows it off)
            float heightFactor = 1.0;
            if (h > 8.0) {
                heightFactor = 1.0 - (h - 8.0) * 0.05;
            }

            snowBlend *= clamp(heightFactor, 0.3, 1.0);

            // Snow color with slight variation
            vec3 snowColor = vec3(0.92, 0.94, 0.98);

            color = mix(color, snowColor, clamp(snowBlend, 0.0, 1.0));
        }

        // Simple lighting
        float diff = max(dot(vNormal, uSunDir), 0.0);
        float wrap = max(dot(vNormal, uSunDir) * 0.5 + 0.5, 0.0);

        vec3 lit = color * (uAmbientColor + uSunColor * wrap * 0.8);

        gl_FragColor = vec4(lit, 1.0);
    }
`;

// ==========================================
// Ocean shader - animated waves, foam, caustics
// ==========================================
const oceanVertexShader = `
    uniform float uTime;
    uniform float uWaveHeight;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vWaveHeight;

    // Simple noise for wave shape
    vec3 mod289(vec3 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec2 mod289(vec2 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
    vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

    float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i  = floor(v + dot(v, C.yy));
        vec2 x0 = v -   i + dot(i, C.xx);
        vec2 i1;
        i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                dot(x12.zw,x12.zw)), 0.0);
        m = m*m;
        m = m*m;
        vec3 x = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x) - 0.5;
        vec3 ox = floor(x + 0.5);
        vec3 a0 = x - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0+h*h);
        vec3 g;
        g.x  = a0.x  * x0.x  + h.x  * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
    }

    void main() {
        vUv = uv;
        vec3 pos = position;

        // Multi-octave wave displacement
        float wave = 0.0;
        wave += snoise(pos.xz * 0.08 + uTime * 0.3) * 0.4;
        wave += snoise(pos.xz * 0.15 - uTime * 0.2) * 0.2;
        wave += snoise(pos.xz * 0.4 + uTime * 0.5) * 0.08;
        wave += snoise(pos.xz * 0.8 - uTime * 0.3) * 0.03;

        pos.y += wave * uWaveHeight;
        vWaveHeight = wave;

        // Approximate normal from wave derivatives
        float eps = 0.5;
        float hx = snoise((position.xz + vec2(eps, 0.0)) * 0.08 + uTime * 0.3) * 0.4
                  + snoise((position.xz + vec2(eps, 0.0)) * 0.15 - uTime * 0.2) * 0.2;
        float hz = snoise((position.xz + vec2(0.0, eps)) * 0.08 + uTime * 0.3) * 0.4
                  + snoise((position.xz + vec2(0.0, eps)) * 0.15 - uTime * 0.2) * 0.2;

        vec3 tangent = normalize(vec3(eps, hx * uWaveHeight - wave * uWaveHeight, 0.0));
        vec3 bitangent = normalize(vec3(0.0, hz * uWaveHeight - wave * uWaveHeight, eps));
        vNormal = normalize(cross(bitangent, tangent));

        vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const oceanFragmentShader = `
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uWaterColorDeep;
    uniform vec3 uWaterColorShallow;
    uniform float uOpacity;
    uniform float uWaterLevel;

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vWaveHeight;

    void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 normal = normalize(vNormal);

        // Fresnel effect - more reflective at grazing angles
        float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);
        fresnel = 0.02 + 0.98 * fresnel;

        // Sky reflection color
        vec3 skyColor = vec3(0.4, 0.6, 0.9);

        // Specular highlight from sun
        vec3 halfVec = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(normal, halfVec), 0.0), 256.0);
        float specBroad = pow(max(dot(normal, halfVec), 0.0), 32.0);

        // Water base color - depth variation
        float depthFactor = smoothstep(-2.0, 0.5, vWorldPos.y - uWaterLevel + 1.0);
        vec3 waterColor = mix(uWaterColorDeep, uWaterColorShallow, depthFactor);

        // Caustics-like pattern (subtle bright spots)
        float caustic1 = sin(vWorldPos.x * 2.0 + uTime * 0.8) * cos(vWorldPos.z * 2.5 + uTime * 0.6);
        float caustic2 = sin(vWorldPos.x * 3.5 - uTime * 0.5) * cos(vWorldPos.z * 1.8 + uTime * 0.9);
        float caustics = (caustic1 + caustic2) * 0.02 + 0.02;
        caustics = max(caustics, 0.0);

        // Foam on wave crests
        float foam = smoothstep(0.25, 0.5, vWaveHeight);
        // Foam also near edges
        vec3 foamColor = vec3(0.85, 0.9, 0.95);

        // Combine
        vec3 color = mix(waterColor, skyColor, fresnel);
        color += uSunColor * spec * 2.0; // Sharp specular
        color += uSunColor * specBroad * 0.15; // Broad specular
        color += caustics * waterColor * 2.0;
        color = mix(color, foamColor, foam * 0.6);

        // Diffuse lighting on water
        float diff = max(dot(normal, uSunDir), 0.0) * 0.3 + 0.7;
        color *= diff;

        gl_FragColor = vec4(color, uOpacity + foam * 0.3);
    }
`;


class ProceduralTerrain {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.size = options.size || 80;
        this.resolution = options.resolution || 200;
        this.noise = new SimplexNoise(options.seed || 42);
        this.terrainType = options.type || 'plains';
        this.waterLevel = options.waterLevel || -2;
        this._cachedWaterLevel = this.waterLevel;

        this.mesh = null;
        this.waterMesh = null;
        this.snowAccum = 0; // Current snow accumulation level

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

            case 'suburban':
                h = this.noise.fbm(x * scale * 0.5, z * scale * 0.5, 3) * 1.5;
                h += this.noise.fbm(x * scale * 2, z * scale * 2, 2) * 0.2;
                h = Math.max(h, 0);
                break;

            case 'city':
                h = this.noise.fbm(x * scale * 0.2, z * scale * 0.2, 2) * 0.3;
                h = Math.max(h, 0);
                break;

            case 'coastal':
                // Clear land-sea split: north = land, south = sea, beach zone in middle
                const sz = this.size;
                const coastLineZ = sz * -0.15; // Shoreline at this z
                const distFromCoast = z - coastLineZ;
                const beachW = 5;

                if (distFromCoast > beachW) {
                    // Inland - gentle rolling terrain
                    h = this.noise.fbm(x * scale * 0.5, z * scale * 0.5, 3) * 2.5;
                    h += this.noise.fbm(x * scale * 2, z * scale * 2, 2) * 0.3;
                } else if (distFromCoast > 0) {
                    // Beach zone - smooth transition from waterLevel to land
                    const t = distFromCoast / beachW;
                    h = this.waterLevel + t * 1.5;
                    h += this.noise.fbm(x * scale, z * scale, 2) * 0.2 * t;
                } else {
                    // Ocean floor - well below water
                    const t = Math.min(1, Math.abs(distFromCoast) / (sz * 0.3));
                    h = this.waterLevel - 0.5 - t * 3;
                    h += this.noise.fbm(x * scale * 0.3, z * scale * 0.3, 2) * 0.2;
                }
                break;

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
        // Remove old terrain
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
        }
        if (this.waterMesh) {
            this.scene.remove(this.waterMesh);
            this.waterMesh.geometry.dispose();
        }

        // Set water level based on terrain type
        switch (this.terrainType) {
            case 'islands':
                this.waterLevel = 0;
                break;
            case 'mountains':
                this.waterLevel = -5;
                break;
            case 'suburban':
            case 'city':
                this.waterLevel = -3;
                break;
            case 'coastal':
                this.waterLevel = -0.5;
                break;
            default:
                this.waterLevel = -2;
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

        // Ocean with GLSL shader
        this.createOcean();
    }

    createOcean() {
        const waterSize = this.size * 2;
        const waterRes = 128; // Enough resolution for waves

        const waterGeo = new THREE.PlaneGeometry(waterSize, waterSize, waterRes, waterRes);
        waterGeo.rotateX(-Math.PI / 2);

        // Island terrain gets different water colors
        const isIsland = this.terrainType === 'islands';
        const isCoastal = this.terrainType === 'coastal';
        const isCity = this.terrainType === 'city' || this.terrainType === 'suburban';

        const deepColor = isIsland
            ? new THREE.Color(0.02, 0.12, 0.35)
            : isCoastal
                ? new THREE.Color(0.02, 0.15, 0.4)
            : isCity
                ? new THREE.Color(0.03, 0.1, 0.3)
                : new THREE.Color(0.05, 0.15, 0.4);

        const shallowColor = isIsland
            ? new THREE.Color(0.05, 0.45, 0.65)
            : isCoastal
                ? new THREE.Color(0.08, 0.42, 0.62)
            : isCity
                ? new THREE.Color(0.08, 0.3, 0.5)
                : new THREE.Color(0.1, 0.35, 0.6);

        const opacity = isIsland ? 0.75 : isCoastal ? 0.72 : 0.7;

        const waterMat = new THREE.ShaderMaterial({
            vertexShader: oceanVertexShader,
            fragmentShader: oceanFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
                uSunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
                uWaterColorDeep: { value: deepColor },
                uWaterColorShallow: { value: shallowColor },
                uOpacity: { value: opacity },
                uWaterLevel: { value: this.waterLevel },
                uWaveHeight: { value: isIsland ? 0.6 : isCoastal ? 0.35 : isCity ? 0.2 : 0.4 }
            },
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
        this.waterMesh.position.y = this.waterLevel - 0.1;
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

        // Update ocean
        if (this.waterMesh) {
            this.waterMesh.material.uniforms.uTime.value = time;
        }
    }

    // Update snow accumulation
    updateSnowAccum(isSnowing, deltaTime) {
        if (isSnowing) {
            // Accumulate over ~30 seconds
            this.snowAccum = Math.min(1.0, this.snowAccum + deltaTime * 0.033);
        } else {
            // Melt over ~15 seconds
            this.snowAccum = Math.max(0.0, this.snowAccum - deltaTime * 0.067);
        }
    }

    setSunDirection(dir) {
        this.material.uniforms.uSunDir.value.copy(dir).normalize();
        if (this.waterMesh) {
            this.waterMesh.material.uniforms.uSunDir.value.copy(dir).normalize();
        }
    }

    setSunColor(color) {
        this.material.uniforms.uSunColor.value.copy(color);
        if (this.waterMesh) {
            this.waterMesh.material.uniforms.uSunColor.value.copy(color);
        }
    }

    setAmbientColor(color) {
        this.material.uniforms.uAmbientColor.value.copy(color);
    }

    // Find a flat spot for house placement - improved with multiple candidates
    findFlatSpot(centerX = 0, centerZ = 0, radius = 30) {
        const candidates = [];
        const attempts = 150;

        for (let attempt = 0; attempt < attempts; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = Math.random() * radius;
            const x = centerX + Math.cos(angle) * dist;
            const z = centerZ + Math.sin(angle) * dist;

            const h = this.getHeight(x, z);
            const hN = this.getHeight(x + 1, z);
            const hS = this.getHeight(x - 1, z);
            const hE = this.getHeight(x, z + 1);
            const hW = this.getHeight(x, z - 1);

            const slope = Math.abs(h - hN) + Math.abs(h - hS) +
                         Math.abs(h - hE) + Math.abs(h - hW);

            if (h > this.waterLevel + 0.5 && slope < 2.0) {
                candidates.push({ x, y: h, z, slope });
            }
        }

        if (candidates.length === 0) return null;

        candidates.sort((a, b) => a.slope - b.slope);
        const topN = Math.min(5, candidates.length);
        return candidates[Math.floor(Math.random() * topN)];
    }
}

export { ProceduralTerrain };
