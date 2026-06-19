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

// Fragment shader for terrain with height-based coloring
const terrainFragmentShader = `
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uAmbientColor;
    uniform float uWaterLevel;
    uniform float uTime;

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

        // Simple lighting
        float diff = max(dot(vNormal, uSunDir), 0.0);
        float wrap = max(dot(vNormal, uSunDir) * 0.5 + 0.5, 0.0);

        vec3 lit = color * (uAmbientColor + uSunColor * wrap * 0.8);

        gl_FragColor = vec4(lit, 1.0);
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

        this.material = new THREE.ShaderMaterial({
            vertexShader: terrainVertexShader,
            fragmentShader: terrainFragmentShader,
            uniforms: {
                uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
                uSunColor: { value: new THREE.Color(1.0, 0.95, 0.8) },
                uAmbientColor: { value: new THREE.Color(0.3, 0.35, 0.5) },
                uWaterLevel: { value: this.waterLevel },
                uTime: { value: 0 }
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
                // Very flat - roads need a level surface
                h = this.noise.fbm(x * scale * 0.2, z * scale * 0.2, 2) * 0.3;
                h = Math.max(h, 0);
                break;

            default:
                h = this.noise.fbm(x * scale, z * scale, 4) * 3;
        }

        return h;
    }

    // Get terrain slope at a point (returns gradient vector)
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

        // Water plane
        const waterGeo = new THREE.PlaneGeometry(this.size * 2, this.size * 2);
        waterGeo.rotateX(-Math.PI / 2);
        const waterMat = new THREE.MeshPhongMaterial({
            color: 0x1a6ea0,
            transparent: true,
            opacity: 0.6,
            shininess: 100,
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
    }

    setSunDirection(dir) {
        this.material.uniforms.uSunDir.value.copy(dir).normalize();
    }

    setSunColor(color) {
        this.material.uniforms.uSunColor.value.copy(color);
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

        // Sort by flatness (lower slope = better)
        candidates.sort((a, b) => a.slope - b.slope);

        // Return a random pick from the top candidates for variety
        const topN = Math.min(5, candidates.length);
        return candidates[Math.floor(Math.random() * topN)];
    }
}

export { ProceduralTerrain };
