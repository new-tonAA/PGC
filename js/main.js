import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ProceduralTerrain } from './terrain.js';
import { ProceduralHouse, SETTLEMENT_TYPES } from './house.js';
import { FireSystem } from './fire.js';
import { WeatherSystem } from './weather.js';
import { SimplexNoise } from './noise.js';

class PCGWorld {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.terrain = null;
        this.houses = null;
        this.fire = null;
        this.weather = null;
        this.clock = new THREE.Clock();

        // State
        this.state = {
            terrainType: 'plains',
            settlementType: 'village',
            houseCount: 8,
            weather: 'clear',
            fireActive: false,
            lightsOn: false,
            timeOfDay: 12,
            seed: 42
        };

        this.init();
        this.setupUI();
        this.animate();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);

        // Camera
        this.camera = new THREE.PerspectiveCamera(
            60, window.innerWidth / window.innerHeight, 0.1, 500
        );
        this.camera.position.set(25, 20, 25);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        document.body.appendChild(this.renderer.domElement);

        // Controls
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 100;
        this.controls.target.set(0, 2, 0);

        // Lighting
        this.setupLighting();

        // Generate world
        this.generateWorld();

        // Resize handler
        window.addEventListener('resize', () => this.onResize());

        // Hide loading screen
        const loading = document.getElementById('loading');
        loading.style.opacity = '0';
        setTimeout(() => loading.style.display = 'none', 500);
    }

    setupLighting() {
        // Ambient light
        this.ambientLight = new THREE.AmbientLight(0x6688aa, 0.5);
        this.scene.add(this.ambientLight);

        // Sun directional light
        this.sunLight = new THREE.DirectionalLight(0xfff5e0, 1.2);
        this.sunLight.position.set(30, 40, 20);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 1;
        this.sunLight.shadow.camera.far = 120;
        this.sunLight.shadow.camera.left = -40;
        this.sunLight.shadow.camera.right = 40;
        this.sunLight.shadow.camera.top = 40;
        this.sunLight.shadow.camera.bottom = -40;
        this.scene.add(this.sunLight);

        // Hemisphere light for sky/ground
        this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5f0b, 0.4);
        this.scene.add(this.hemiLight);

        // Sky gradient (simple)
        this.updateTimeOfDay(this.state.timeOfDay);
    }

    updateTimeOfDay(time) {
        // Sun position based on time
        const angle = ((time - 6) / 12) * Math.PI;
        const sunY = Math.sin(angle);
        const sunX = Math.cos(angle);

        this.sunLight.position.set(sunX * 40, Math.max(sunY * 40, 1), 20);

        // Adjust lighting based on time
        if (time >= 6 && time <= 18) {
            // Day
            const dayFactor = Math.sin(angle);
            const warmth = time < 10 ? 0.8 : (time > 16 ? 0.6 : 1.0);

            this.sunLight.intensity = dayFactor * 1.5;
            this.sunLight.color.setHSL(0.1 * (1 - warmth), 0.3, 0.7 + dayFactor * 0.3);
            this.ambientLight.intensity = 0.3 + dayFactor * 0.3;
            this.hemiLight.intensity = 0.3 + dayFactor * 0.3;

            // Sky color
            const skyH = 0.58;
            const skyS = 0.5 + dayFactor * 0.3;
            const skyL = 0.3 + dayFactor * 0.4;
            this.scene.background.setHSL(skyH, skyS, skyL);

            // Sun direction for terrain shader
            const sunDir = new THREE.Vector3(sunX, Math.max(sunY, 0.1), 0.3).normalize();
            if (this.terrain) {
                this.terrain.setSunDirection(sunDir);
                this.terrain.setSunColor(this.sunLight.color.clone().multiplyScalar(this.sunLight.intensity));
                this.terrain.setAmbientColor(this.ambientLight.color.clone().multiplyScalar(this.ambientLight.intensity));
            }
        } else {
            // Night
            this.sunLight.intensity = 0.15;
            this.sunLight.color.setHSL(0.65, 0.4, 0.4);
            this.ambientLight.intensity = 0.15;
            this.ambientLight.color.setHSL(0.65, 0.3, 0.2);
            this.hemiLight.intensity = 0.1;
            this.scene.background.setHSL(0.65, 0.4, 0.08);

            if (this.terrain) {
                this.terrain.setSunDirection(new THREE.Vector3(0, 1, 0));
                this.terrain.setSunColor(new THREE.Color(0.1, 0.1, 0.2));
                this.terrain.setAmbientColor(new THREE.Color(0.05, 0.05, 0.15));
            }
        }

        // Sunset/sunrise tint
        if ((time >= 5 && time <= 7) || (time >= 17 && time <= 19)) {
            const sunsetFactor = time < 12
                ? 1 - Math.abs(time - 6)
                : 1 - Math.abs(time - 18);
            this.scene.background.lerpHSL(new THREE.Color(0xff6633), sunsetFactor * 0.3);
        }

        // Tone mapping exposure
        this.renderer.toneMappingExposure = time >= 6 && time <= 18
            ? 0.8 + Math.sin(angle) * 0.4
            : 0.4;

        // Auto-turn on interior lights at night
        if (this.houses && this.state.lightsOn) {
            const nightFactor = (time < 6 || time > 18) ? 1.0 : (time < 8 ? (8 - time) / 2 : (time > 17 ? (time - 17) / 1 : 0));
            for (const house of this.houses.houses) {
                if (house.userData.interiorLight) {
                    house.userData.interiorLight.intensity = nightFactor * 2.0;
                }
            }
        }
    }

    generateWorld() {
        // Clean up old terrain/water
        if (this.terrain) {
            if (this.terrain.mesh) this.scene.remove(this.terrain.mesh);
            if (this.terrain.waterMesh) this.scene.remove(this.terrain.waterMesh);
        }

        // Clean up old fire extra objects (ring, logs)
        if (this.fire) {
            this.fire.clear();
        }

        // Terrain
        this.terrain = new ProceduralTerrain(this.scene, {
            size: 80,
            resolution: 200,
            seed: this.state.seed,
            type: this.state.terrainType
        });

        // Houses
        if (!this.houses) {
            this.houses = new ProceduralHouse(this.scene, new SimplexNoise(this.state.seed));
        } else {
            this.houses.noise = new SimplexNoise(this.state.seed);
        }
        this.houses.settlementType = this.state.settlementType;
        this.houses.generateMultiple(this.terrain, this.state.houseCount);

        // Apply interior lights state
        if (this.state.lightsOn) {
            this.houses.setInteriorLights(true);
        }

        // Fire system
        if (!this.fire) {
            this.fire = new FireSystem(this.scene);
        }

        // Weather system
        if (!this.weather) {
            this.weather = new WeatherSystem(this.scene, this.camera);
        }
        this.weather.setWeather(this.state.weather);

        // Add trees (density depends on settlement type)
        this.generateTrees();

        // Apply time of day
        this.updateTimeOfDay(this.state.timeOfDay);

        // If fire was active, re-place
        if (this.state.fireActive) {
            this.fire.placeFiresAtHouses(this.houses.houses);
            const centerSpot = this.terrain.findFlatSpot(0, 0, 10);
            if (centerSpot) {
                this.fire.createCampfire(new THREE.Vector3(centerSpot.x, centerSpot.y, centerSpot.z));
            }
        }
    }

    generateTrees() {
        // Remove old trees
        if (this.treeGroup) {
            this.scene.remove(this.treeGroup);
        }
        this.treeGroup = new THREE.Group();

        // Tree count depends on settlement type (cities have fewer trees)
        let treeCount;
        switch (this.state.settlementType) {
            case 'city': treeCount = 15; break;
            case 'suburban': treeCount = 40; break;
            default: treeCount = 60;
        }

        for (let i = 0; i < treeCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 5 + Math.random() * 30;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            const y = this.terrain.getHeight(x, z);

            // Only place trees above water on grass
            if (y < this.terrain.waterLevel + 1.0 || y > 7) continue;

            // Check slope
            const yN = this.terrain.getHeight(x + 0.5, z);
            const yS = this.terrain.getHeight(x - 0.5, z);
            const slope = Math.abs(y - yN) + Math.abs(y - yS);
            if (slope > 1.5) continue;

            // Don't place too close to houses
            let tooClose = false;
            for (const house of this.houses.houses) {
                const dx = x - house.position.x;
                const dz = z - house.position.z;
                if (Math.sqrt(dx * dx + dz * dz) < 3.0) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;

            const treeType = Math.random();

            if (treeType < 0.5) {
                // Pine tree
                const trunkH = 1.0 + Math.random() * 0.5;
                const trunkGeo = new THREE.CylinderGeometry(0.08, 0.12, trunkH, 6);
                const trunkMat = new THREE.MeshPhongMaterial({ color: 0x4a3520, flatShading: true });
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                trunk.position.set(x, y + trunkH / 2, z);
                trunk.castShadow = true;
                this.treeGroup.add(trunk);

                const layers = 2 + Math.floor(Math.random() * 2);
                for (let l = 0; l < layers; l++) {
                    const coneH = 0.8 + Math.random() * 0.4;
                    const coneR = (0.5 - l * 0.1) * (0.8 + Math.random() * 0.4);
                    const coneGeo = new THREE.ConeGeometry(coneR, coneH, 6);
                    const shade = 0.15 + Math.random() * 0.1;
                    const coneMat = new THREE.MeshPhongMaterial({
                        color: new THREE.Color(shade * 0.4, shade, shade * 0.3),
                        flatShading: true
                    });
                    const cone = new THREE.Mesh(coneGeo, coneMat);
                    cone.position.set(x, y + trunkH + l * 0.5 + coneH / 2, z);
                    cone.castShadow = true;
                    this.treeGroup.add(cone);
                }
            } else {
                // Round tree
                const trunkH = 1.5 + Math.random() * 1.0;
                const trunkGeo = new THREE.CylinderGeometry(0.1, 0.15, trunkH, 6);
                const trunkMat = new THREE.MeshPhongMaterial({ color: 0x5a4030, flatShading: true });
                const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                trunk.position.set(x, y + trunkH / 2, z);
                trunk.castShadow = true;
                this.treeGroup.add(trunk);

                const crownR = 0.8 + Math.random() * 0.6;
                const crownGeo = new THREE.SphereGeometry(crownR, 7, 5);
                const shade = 0.18 + Math.random() * 0.12;
                const crownMat = new THREE.MeshPhongMaterial({
                    color: new THREE.Color(shade * 0.5, shade, shade * 0.3),
                    flatShading: true
                });
                const crown = new THREE.Mesh(crownGeo, crownMat);
                crown.position.set(x, y + trunkH + crownR * 0.5, z);
                crown.castShadow = true;
                this.treeGroup.add(crown);
            }
        }

        this.scene.add(this.treeGroup);
    }

    setupUI() {
        // Terrain buttons
        document.querySelectorAll('[data-terrain]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-terrain]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.terrainType = btn.dataset.terrain;
            });
        });

        // Settlement buttons
        document.querySelectorAll('[data-settlement]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-settlement]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.settlementType = btn.dataset.settlement;
            });
        });

        // Weather buttons
        document.querySelectorAll('[data-weather]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-weather]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.weather = btn.dataset.weather;
                this.weather.setWeather(this.state.weather);
            });
        });

        // House count
        const houseSlider = document.getElementById('houseCount');
        const houseVal = document.getElementById('houseCountVal');
        houseSlider.addEventListener('input', () => {
            this.state.houseCount = parseInt(houseSlider.value);
            houseVal.textContent = houseSlider.value;
        });

        // Fire toggle
        const fireBtn = document.getElementById('toggleFire');
        fireBtn.addEventListener('click', () => {
            this.state.fireActive = !this.state.fireActive;
            fireBtn.classList.toggle('active', this.state.fireActive);
            fireBtn.textContent = this.state.fireActive ? '关闭火焰' : '开启火焰';

            if (this.state.fireActive) {
                this.fire.placeFiresAtHouses(this.houses.houses);
                const centerSpot = this.terrain.findFlatSpot(0, 0, 10);
                if (centerSpot) {
                    this.fire.createCampfire(new THREE.Vector3(centerSpot.x, centerSpot.y, centerSpot.z));
                }
            } else {
                this.fire.clear();
            }
        });

        // Interior lights toggle
        const lightBtn = document.getElementById('toggleLights');
        lightBtn.addEventListener('click', () => {
            this.state.lightsOn = !this.state.lightsOn;
            lightBtn.classList.toggle('active', this.state.lightsOn);
            lightBtn.textContent = this.state.lightsOn ? '关闭灯光' : '开启灯光';
            this.houses.setInteriorLights(this.state.lightsOn);
        });

        // Time of day
        const timeSlider = document.getElementById('timeSlider');
        const timeVal = document.getElementById('timeVal');
        timeSlider.addEventListener('input', () => {
            this.state.timeOfDay = parseFloat(timeSlider.value);
            const h = Math.floor(this.state.timeOfDay);
            const m = Math.round((this.state.timeOfDay - h) * 60);
            timeVal.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            this.updateTimeOfDay(this.state.timeOfDay);
        });

        // Seed
        const seedSlider = document.getElementById('seedSlider');
        const seedVal = document.getElementById('seedVal');
        seedSlider.addEventListener('input', () => {
            this.state.seed = parseInt(seedSlider.value);
            seedVal.textContent = seedSlider.value;
        });

        // Regenerate
        document.getElementById('regenerate').addEventListener('click', () => {
            this.fire.clear();
            this.state.fireActive = false;
            fireBtn.classList.remove('active');
            fireBtn.textContent = '开启火焰';
            this.generateWorld();
        });
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const time = this.clock.getElapsedTime();

        this.controls.update();
        this.terrain.update(time);
        this.fire.update(time);
        this.weather.update(time);

        this.renderer.render(this.scene, this.camera);
    }
}

// Start the application
new PCGWorld();
