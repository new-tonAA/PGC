import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ProceduralTerrain } from './terrain.js';
import { ProceduralHouse, SETTLEMENT_TYPES } from './house.js';
import { FireSystem } from './fire.js';
import { WeatherSystem } from './weather.js';
import { CitySystem } from './city.js';
import { VegetationSystem } from './vegetation.js';
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
        this.city = null;
        this.vegetation = null;
        this.clock = new THREE.Clock();

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
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb);

        this.camera = new THREE.PerspectiveCamera(
            60, window.innerWidth / window.innerHeight, 0.1, 500
        );
        this.camera.position.set(25, 20, 25);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        document.body.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2.1;
        this.controls.minDistance = 5;
        this.controls.maxDistance = 120;
        this.controls.target.set(0, 2, 0);

        this.setupLighting();
        this.generateWorld();

        window.addEventListener('resize', () => this.onResize());

        const loading = document.getElementById('loading');
        loading.style.opacity = '0';
        setTimeout(() => loading.style.display = 'none', 500);
    }

    setupLighting() {
        this.ambientLight = new THREE.AmbientLight(0x6688aa, 0.5);
        this.scene.add(this.ambientLight);

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

        this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5f0b, 0.4);
        this.scene.add(this.hemiLight);

        this.updateTimeOfDay(this.state.timeOfDay);
    }

    updateTimeOfDay(time) {
        const angle = ((time - 6) / 12) * Math.PI;
        const sunY = Math.sin(angle);
        const sunX = Math.cos(angle);

        this.sunLight.position.set(sunX * 40, Math.max(sunY * 40, 1), 20);

        if (time >= 6 && time <= 18) {
            const dayFactor = Math.sin(angle);
            const warmth = time < 10 ? 0.8 : (time > 16 ? 0.6 : 1.0);

            this.sunLight.intensity = dayFactor * 1.5;
            this.sunLight.color.setHSL(0.1 * (1 - warmth), 0.3, 0.7 + dayFactor * 0.3);
            this.ambientLight.intensity = 0.3 + dayFactor * 0.3;
            this.hemiLight.intensity = 0.3 + dayFactor * 0.3;

            const skyH = 0.58;
            const skyS = 0.5 + dayFactor * 0.3;
            const skyL = 0.3 + dayFactor * 0.4;
            this.scene.background.setHSL(skyH, skyS, skyL);

            const sunDir = new THREE.Vector3(sunX, Math.max(sunY, 0.1), 0.3).normalize();
            if (this.terrain) {
                this.terrain.setSunDirection(sunDir);
                this.terrain.setSunColor(this.sunLight.color.clone().multiplyScalar(this.sunLight.intensity));
                this.terrain.setAmbientColor(this.ambientLight.color.clone().multiplyScalar(this.ambientLight.intensity));
            }
        } else {
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

        if ((time >= 5 && time <= 7) || (time >= 17 && time <= 19)) {
            const sunsetFactor = time < 12
                ? 1 - Math.abs(time - 6)
                : 1 - Math.abs(time - 18);
            this.scene.background.lerpHSL(new THREE.Color(0xff6633), sunsetFactor * 0.3);
        }

        this.renderer.toneMappingExposure = time >= 6 && time <= 18
            ? 0.8 + Math.sin(angle) * 0.4
            : 0.4;

        // Auto lights at night
        if (this.state.lightsOn) {
            const nightFactor = (time < 6 || time > 18) ? 1.0 :
                (time < 8 ? (8 - time) / 2 : (time > 17 ? (time - 17) / 1 : 0));
            if (this.houses) {
                for (const house of this.houses.houses) {
                    if (house.userData.interiorLight) {
                        house.userData.interiorLight.intensity = nightFactor * 2.0;
                    }
                }
            }
            if (this.city) {
                for (const bld of this.city.cityBuildings) {
                    if (bld.userData.interiorLight) {
                        bld.userData.interiorLight.intensity = nightFactor * 2.0;
                    }
                    if (bld.userData.windowMeshes) {
                        for (const w of bld.userData.windowMeshes) {
                            w.material.emissiveIntensity = nightFactor * 0.6;
                        }
                    }
                }
                for (const sl of this.city.streetLightLamps) {
                    sl.pointLight.intensity = nightFactor * 1.2;
                    sl.lampMat.opacity = nightFactor > 0.3 ? 0.9 : 0.3;
                    sl.lampMat.color.set(nightFactor > 0.3 ? 0xffeecc : 0x888888);
                }
            }
        }
    }

    needsCitySystem() {
        return this.state.settlementType === 'city' ||
               this.state.terrainType === 'islands' ||
               this.state.terrainType === 'city';
    }

    generateWorld() {
        // Cleanup
        if (this.terrain) {
            if (this.terrain.mesh) this.scene.remove(this.terrain.mesh);
            if (this.terrain.waterMesh) this.scene.remove(this.terrain.waterMesh);
        }
        if (this.fire) this.fire.clear();
        if (this.city) this.city.clear();
        if (this.vegetation) this.vegetation.clear();

        // Terrain
        this.terrain = new ProceduralTerrain(this.scene, {
            size: 80,
            resolution: 200,
            seed: this.state.seed,
            type: this.state.terrainType
        });

        // City system
        if (!this.city) {
            this.city = new CitySystem(this.scene, new SimplexNoise(this.state.seed));
        }

        if (this.needsCitySystem()) {
            this.city.generate(this.terrain, this.state.seed);
            if (this.state.lightsOn) {
                this.city.setLights(true);
            }
        }

        // Houses
        if (!this.houses) {
            this.houses = new ProceduralHouse(this.scene, new SimplexNoise(this.state.seed));
        } else {
            this.houses.noise = new SimplexNoise(this.state.seed);
        }

        if (!this.needsCitySystem() || this.state.terrainType === 'islands') {
            this.houses.settlementType = this.state.settlementType;
            const count = this.state.terrainType === 'islands'
                ? Math.min(this.state.houseCount, 5)
                : this.state.houseCount;
            this.houses.generateMultiple(this.terrain, count);

            if (this.state.lightsOn) {
                this.houses.setInteriorLights(true);
            }
        } else {
            this.houses.clear();
        }

        // Fire system
        if (!this.fire) {
            this.fire = new FireSystem(this.scene);
        }

        // Weather
        if (!this.weather) {
            this.weather = new WeatherSystem(this.scene, this.camera);
        }
        this.weather.setWeather(this.state.weather);

        // Vegetation (new system)
        if (!this.vegetation) {
            this.vegetation = new VegetationSystem(this.scene, new SimplexNoise(this.state.seed));
        } else {
            this.vegetation.noise = new SimplexNoise(this.state.seed);
        }

        // Gather house positions for vegetation avoidance
        const housePositions = this.houses.houses.map(h => ({
            x: h.position.x,
            z: h.position.z,
            radius: h.userData.boundingRadius || 3
        }));

        // Get road positions from city system for avoidance
        const roadPositions = [];
        if (this.needsCitySystem() && this.city.intersections) {
            for (const inter of this.city.intersections) {
                roadPositions.push({ x: inter.x, z: inter.z });
            }
        }

        this.vegetation.generate(this.terrain, {
            seed: this.state.seed,
            settlementType: this.state.settlementType,
            housePositions,
            roadPositions
        });

        this.updateTimeOfDay(this.state.timeOfDay);

        // Fire
        if (this.state.fireActive) {
            this.fire.placeFiresAtHouses(this.houses.houses);
            const centerSpot = this.terrain.findFlatSpot(0, 0, 10);
            if (centerSpot) {
                this.fire.createCampfire(new THREE.Vector3(centerSpot.x, centerSpot.y, centerSpot.z));
            }
        }
    }

    setupUI() {
        document.querySelectorAll('[data-terrain]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-terrain]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.terrainType = btn.dataset.terrain;

                if (btn.dataset.terrain === 'city') {
                    this.state.settlementType = 'city';
                    document.querySelectorAll('[data-settlement]').forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-settlement="city"]').classList.add('active');
                } else if (btn.dataset.terrain === 'islands') {
                    this.state.settlementType = 'village';
                    document.querySelectorAll('[data-settlement]').forEach(b => b.classList.remove('active'));
                    document.querySelector('[data-settlement="village"]').classList.add('active');
                }
            });
        });

        document.querySelectorAll('[data-settlement]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-settlement]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.settlementType = btn.dataset.settlement;
            });
        });

        document.querySelectorAll('[data-weather]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-weather]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.weather = btn.dataset.weather;
                this.weather.setWeather(this.state.weather);
            });
        });

        const houseSlider = document.getElementById('houseCount');
        const houseVal = document.getElementById('houseCountVal');
        houseSlider.addEventListener('input', () => {
            this.state.houseCount = parseInt(houseSlider.value);
            houseVal.textContent = houseSlider.value;
        });

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

        const lightBtn = document.getElementById('toggleLights');
        lightBtn.addEventListener('click', () => {
            this.state.lightsOn = !this.state.lightsOn;
            lightBtn.classList.toggle('active', this.state.lightsOn);
            lightBtn.textContent = this.state.lightsOn ? '关闭灯光' : '开启灯光';
            this.houses.setInteriorLights(this.state.lightsOn);
            this.city.setLights(this.state.lightsOn);
        });

        const timeSlider = document.getElementById('timeSlider');
        const timeVal = document.getElementById('timeVal');
        timeSlider.addEventListener('input', () => {
            this.state.timeOfDay = parseFloat(timeSlider.value);
            const h = Math.floor(this.state.timeOfDay);
            const m = Math.round((this.state.timeOfDay - h) * 60);
            timeVal.textContent = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            this.updateTimeOfDay(this.state.timeOfDay);
        });

        const seedSlider = document.getElementById('seedSlider');
        const seedVal = document.getElementById('seedVal');
        seedSlider.addEventListener('input', () => {
            this.state.seed = parseInt(seedSlider.value);
            seedVal.textContent = seedSlider.value;
        });

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

        const deltaTime = this.clock.getDelta();
        const time = this.clock.getElapsedTime();

        this.controls.update();
        this.terrain.update(time);
        this.fire.update(time);
        this.weather.update(time);
        this.city.update(time);

        const isSnowing = this.state.weather === 'snow';
        if (this.terrain) {
            this.terrain.updateSnowAccum(isSnowing, deltaTime);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

new PCGWorld();