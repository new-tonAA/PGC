import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
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
        this.sunMesh = null;
        this.sky = null;
        this.starField = null;

        this.state = {
            terrainType: 'plains',
            settlementType: 'village',
            houseCount: 2,
            vehicleCount: 5,
            ringCount: 1,
            lightSpacing: 12,
            weather: 'clear',
            fireActive: false,
            lightsOn: true,
            timeOfDay: 12,
            seed: 42,
            starDensity: 0
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
        this.camera.position.set(20, 15, 20);

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
        this.controls.maxDistance = 100;
        this.controls.target.set(0, 2, 0);

        this.setupLighting();
        this.createStarField();
        this.createSky();
        this.generateWorld();

        window.addEventListener('resize', () => this.onResize());

        const loading = document.getElementById('loading');
        loading.style.opacity = '0';
        setTimeout(() => loading.style.display = 'none', 500);
    }

    createSky() {
        this.sky = new Sky();
        this.sky.scale.setScalar(450000);
        this.scene.add(this.sky);

        const sunGeo = new THREE.SphereGeometry(3, 16, 16);
        const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
        this.sunMesh = new THREE.Mesh(sunGeo, sunMat);
        this.scene.add(this.sunMesh);
    }

    createStarField() {
        const count = 3000;
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = 180;
            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = Math.abs(r * Math.cos(phi));
            positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            sizes[i] = 0.5 + Math.random() * 2.0;
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

        const mat = new THREE.ShaderMaterial({
            vertexShader: `
                attribute float aSize;
                uniform float uDensity;
                uniform float uTime;
                varying float vTwinkle;
                void main() {
                    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                    gl_Position = projectionMatrix * mvPos;
                    gl_PointSize = aSize * uDensity * (200.0 / -mvPos.z);
                    vTwinkle = sin(uTime * (1.0 + aSize) + position.x * 10.0) * 0.3 + 0.7;
                }
            `,
            fragmentShader: `
                uniform float uDensity;
                varying float vTwinkle;
                void main() {
                    float d = length(gl_PointCoord - vec2(0.5));
                    if (d > 0.5) discard;
                    float alpha = (1.0 - d * 2.0);
                    alpha *= alpha;
                    gl_FragColor = vec4(1.0, 1.0, 0.95, alpha * vTwinkle * uDensity);
                }
            `,
            uniforms: {
                uDensity: { value: 0.0 },
                uTime: { value: 0 }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        this.starField = new THREE.Points(geo, mat);
        this.scene.add(this.starField);
    }

    setupLighting() {
        this.ambientLight = new THREE.AmbientLight(0x6688aa, 0.5);
        this.scene.add(this.ambientLight);

        this.sunLight = new THREE.DirectionalLight(0xfff5e0, 1.5);
        this.sunLight.position.set(30, 40, 20);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 100;
        this.sunLight.shadow.camera.left = -30;
        this.sunLight.shadow.camera.right = 30;
        this.sunLight.shadow.camera.top = 30;
        this.sunLight.shadow.camera.bottom = -30;
        this.sunLight.shadow.bias = -0.0003;
        this.sunLight.shadow.normalBias = 0.02;
        this.scene.add(this.sunLight);

        this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a5f0b, 0.5);
        this.scene.add(this.hemiLight);

        this.updateTimeOfDay(this.state.timeOfDay);
    }

    updateTimeOfDay(time) {
        // Sun orbits in a full circle - realistic rotation
        // time=12 = noon (sun at highest), time=0/24 = midnight (sun at lowest)
        const sunAngle = ((time - 6) / 24) * Math.PI * 2;
        const sunY = Math.sin(sunAngle);
        const sunX = Math.cos(sunAngle);
        const sunZ = Math.sin(sunAngle * 0.5) * 0.15;

        const sunDistance = 400;
        const sunPos = new THREE.Vector3(
            sunX * sunDistance,
            sunY * sunDistance,
            sunZ * sunDistance
        );

        // Update Sky shader with dynamic turbidity
        if (this.sky) {
            const skyUniforms = this.sky.material.uniforms;
            const sunElevation = sunY;
            // More turbidity at low sun angles (hazy sunrise/sunset)
            skyUniforms['turbidity'].value = 2 + Math.max(0, 1 - sunElevation) * 6;
            skyUniforms['rayleigh'].value = 0.8 + Math.max(0, 1 - sunElevation) * 1.5;
            skyUniforms['mieCoefficient'].value = 0.005 + Math.max(0, 1 - sunElevation) * 0.02;
            skyUniforms['mieDirectionalG'].value = 0.8;

            const sunDirection = sunPos.clone().normalize();
            skyUniforms['sunPosition'].value.copy(sunDirection.multiplyScalar(400));
        }

        // Sun light follows the orbit
        const sunLightPos = sunPos.clone().normalize().multiplyScalar(60);
        this.sunLight.position.copy(sunLightPos);

        // Visual sun mesh
        if (this.sunMesh) {
            this.sunMesh.position.copy(this.sunLight.position);
            this.sunMesh.visible = sunY > -0.05;
            // Sun size increases near horizon (atmospheric lensing effect)
            const horizonFactor = Math.max(0, 1 - Math.abs(sunY) * 2);
            this.sunMesh.scale.setScalar(1 + horizonFactor * 1.5);
            this.sunMesh.material.color.setHSL(0.12, 0.8, 0.6 + horizonFactor * 0.3);
        }

        const isDaytime = sunY > 0.02;
        const dayFactor = Math.max(0, Math.min(1, sunY));
        const sunElevation = sunY;

        // Smooth dawn/dusk transitions
        const dawnStart = 4.5, dawnEnd = 7, duskStart = 17, duskEnd = 19.5;
        const isDawn = time >= dawnStart && time <= dawnEnd;
        const isDusk = time >= duskStart && time <= duskEnd;
        const dawnFactor = isDawn ? Math.min(1, (time - dawnStart) / (dawnEnd - dawnStart)) : 0;
        const duskFactor = isDusk ? Math.min(1, (duskEnd - time) / (duskEnd - duskStart)) : 0;
        const twilightFactor = Math.max(dawnFactor, duskFactor);
        const lowSunFactor = Math.max(0, 1.0 - Math.abs(sunElevation) * 3.5);
        const isTwilight = isDawn || isDusk;

        if (isDaytime) {
            // Sun color: warm at sunrise/sunset, white at noon
            const sunWarmth = lowSunFactor * 0.9;
            this.sunLight.intensity = 0.1 + dayFactor * 1.6;
            this.sunLight.color.setHSL(
                0.08 + sunWarmth * 0.05,           // hue: slightly warmer at low angles
                0.2 + sunWarmth * 0.5,             // saturation: more colorful sunrise/sunset
                0.55 + dayFactor * 0.35 - sunWarmth * 0.15 // lightness: brighter at noon
            );

            // Ambient light
            this.ambientLight.intensity = 0.15 + dayFactor * 0.35;
            this.ambientLight.color.setHSL(
                isTwilight ? 0.07 : 0.55,
                isTwilight ? 0.2 + lowSunFactor * 0.2 : 0.25,
                0.2 + dayFactor * 0.3
            );

            // Hemisphere light
            this.hemiLight.intensity = 0.2 + dayFactor * 0.35;
            this.hemiLight.color.setHSL(
                isTwilight ? 0.07 : 0.55,
                isTwilight ? 0.25 : 0.3,
                0.4 + dayFactor * 0.3
            );
            this.hemiLight.groundColor.setHSL(
                isTwilight ? 0.08 : 0.35,
                0.3,
                0.1 + dayFactor * 0.15
            );

            // Scene background
            if (isTwilight) {
                this.scene.background.setHSL(
                    0.06 + (1 - twilightFactor) * 0.5,
                    0.3 + twilightFactor * 0.3,
                    0.25 + dayFactor * 0.4
                );
            } else {
                this.scene.background.setHSL(0.55, 0.35, 0.45 + dayFactor * 0.35);
            }

            // Terrain shader updates
            const sunDir = new THREE.Vector3(sunX, Math.max(sunY, 0.05), sunZ).normalize();
            if (this.terrain) {
                this.terrain.setSunDirection(sunDir);
                this.terrain.setSunColor(this.sunLight.color.clone().multiplyScalar(this.sunLight.intensity));
                this.terrain.setAmbientColor(this.ambientLight.color.clone().multiplyScalar(this.ambientLight.intensity));
                this.terrain.setSkyColor(new THREE.Color(isTwilight ? 0.6 : 0.4, isTwilight ? 0.4 : 0.6, isTwilight ? 0.3 : 0.9));
            }
        } else {
            // Nighttime — pitch black, only artificial lights illuminate the scene
            const nightDepth = Math.min(1, Math.abs(sunY) * 2);
            // Kill ALL natural scene lighting — roads, rocks, trees only visible via streetlights
            this.sunLight.intensity = 0;
            this.sunLight.color.setHSL(0.6, 0.05, 0.15);
            this.ambientLight.intensity = 0;
            this.ambientLight.color.setHSL(0.6, 0.08, 0.03);
            this.hemiLight.intensity = 0;
            this.hemiLight.color.setHSL(0.6, 0.05, 0.03);

            if (this.terrain) {
                this.terrain.setSunDirection(new THREE.Vector3(0, 0.5, 0));
                this.terrain.setSunColor(new THREE.Color(0, 0, 0));
                this.terrain.setAmbientColor(new THREE.Color(0, 0, 0));
                this.terrain.setSkyColor(new THREE.Color(0, 0, 0));
            }

            this.scene.background.setHSL(0.62, 0.12, 0.04 + nightDepth * 0.02);
        }

        // Tone mapping exposure
        if (isDaytime) {
            this.renderer.toneMappingExposure = 0.4 + dayFactor * 0.8;
        } else if (isTwilight) {
            this.renderer.toneMappingExposure = 0.35;
        } else {
            this.renderer.toneMappingExposure = 0.2;
        }

        // Star field visibility
        const starDensity = this.state.starDensity / 100;
        const isNight = time < 4.5 || time > 19.5;
        if (this.starField) {
            let starAlpha = 0;
            if (isNight) {
                starAlpha = starDensity;
            } else if (isDawn) {
                starAlpha = starDensity * Math.max(0, 1 - dawnFactor);
            } else if (isDusk) {
                starAlpha = starDensity * duskFactor;
            }
            this.starField.material.uniforms.uDensity.value = starAlpha;
        }

        // Manage all lights based on time and toggle state
        this.updateAllLights(time);
    }

    updateAllLights(time) {
        let nightFactor = (time < 6 || time > 18) ? 1.0 :
            (time < 8 ? (8 - time) / 2 : (time > 16 ? (time - 16) / 2 : 0));
        // Keep a minimum glow when lights are on — so the brightness slider always has visible effect
        if (this.state.lightsOn) nightFactor = Math.max(0.1, nightFactor);
        // lightSpacing slider controls global light brightness (6=dim, 12=normal, 24=bright)
        const brightnessMult = this.state.lightSpacing / 12;

        if (this.state.lightsOn) {
            // House interior lights
            if (this.houses) {
                for (const house of this.houses.houses) {
                    if (house.userData.interiorLight) {
                        house.userData.interiorLight.intensity = nightFactor * 15.0 * brightnessMult;
                    }
                }
            }
            // City building lights - stronger for visible ground illumination
            if (this.city) {
                for (const bld of this.city.cityBuildings) {
                    // Canton Tower has its own light handling in city.update()
                    if (bld.userData.isTower) continue;
                    if (bld.userData.interiorLight) {
                        bld.userData.interiorLight.intensity = nightFactor * 15.0 * brightnessMult;
                    }
                    if (bld.userData.windowMeshes) {
                        for (const w of bld.userData.windowMeshes) {
                            w.material.emissiveIntensity = nightFactor * 1.5 * brightnessMult;
                        }
                    }
                    if (bld.userData.signLight) {
                        bld.userData.signLight.intensity = nightFactor * 8.0 * brightnessMult;
                    }
                    if (bld.userData.beamLight) {
                        bld.userData.beamLight.intensity = nightFactor * 12.0 * brightnessMult;
                    }
                    if (bld.userData.topLight) {
                        bld.userData.topLight.intensity = nightFactor * 4.0 * brightnessMult;
                    }
                    if (bld.userData.lanternGlow) {
                        bld.userData.lanternGlow.intensity = nightFactor * 4.0 * brightnessMult;
                    }
                }
                // Street lights - bright ground illumination
                for (const sl of this.city.streetLightLamps) {
                    if (sl.spotLight) {
                        sl.spotLight.intensity = nightFactor * 18.0 * brightnessMult;
                    }
                    if (sl.pointLight) {
                        sl.pointLight.intensity = nightFactor * 10.0 * brightnessMult;
                    }
                    if (sl.lampMat) {
                        const isOn = nightFactor > 0.15;
                        sl.lampMat.opacity = isOn ? 0.95 : 0.25;
                        sl.lampMat.color.set(isOn ? 0xffffdd : 0x666666);
                        if (sl.lampMat.emissive !== undefined) {
                            sl.lampMat.emissive.set(isOn ? 0xffffcc : 0x000000);
                            sl.lampMat.emissiveIntensity = isOn ? nightFactor * 2.5 * brightnessMult : 0;
                        }
                    }
                }
                // Vehicle headlights
                for (const v of this.city.vehicles) {
                    if (v.userData.headlight) {
                        v.userData.headlight.intensity = nightFactor * 15.0 * brightnessMult;
                    }
                    if (v.userData.headlightPoint) {
                        v.userData.headlightPoint.intensity = nightFactor * 6.0 * brightnessMult;
                    }
                    if (v.userData.tailLightMat) {
                        v.userData.tailLightMat.emissiveIntensity = nightFactor * 1.2 * brightnessMult;
                    }
                }
            }
        } else {
            // Lights off - zero everything
            if (this.houses) {
                for (const house of this.houses.houses) {
                    if (house.userData.interiorLight) {
                        house.userData.interiorLight.intensity = 0;
                    }
                }
            }
            if (this.city) {
                for (const bld of this.city.cityBuildings) {
                    if (bld.userData.isTower) continue;
                    if (bld.userData.interiorLight) {
                        bld.userData.interiorLight.intensity = 0;
                    }
                    if (bld.userData.windowMeshes) {
                        for (const w of bld.userData.windowMeshes) {
                            w.material.emissiveIntensity = 0;
                        }
                    }
                    if (bld.userData.signLight) bld.userData.signLight.intensity = 0;
                    if (bld.userData.beamLight) bld.userData.beamLight.intensity = 0;
                    if (bld.userData.topLight) bld.userData.topLight.intensity = 0;
                    if (bld.userData.lanternGlow) bld.userData.lanternGlow.intensity = 0;
                }
                for (const sl of this.city.streetLightLamps) {
                    if (sl.spotLight) sl.spotLight.intensity = 0;
                    if (sl.pointLight) sl.pointLight.intensity = 0;
                    if (sl.lampMat) {
                        sl.lampMat.opacity = 0.25;
                        sl.lampMat.color.set(0x666666);
                        if (sl.lampMat.emissive !== undefined) {
                            sl.lampMat.emissiveIntensity = 0;
                        }
                    }
                }
                for (const v of this.city.vehicles) {
                    if (v.userData.headlight) {
                        v.userData.headlight.intensity = 0;
                    }
                    if (v.userData.headlightPoint) {
                        v.userData.headlightPoint.intensity = 0;
                    }
                    if (v.userData.tailLightMat) {
                        v.userData.tailLightMat.emissiveIntensity = 0;
                    }
                }
            }
        }
    }

    needsCitySystem() {
        return this.state.settlementType === 'city' ||
               this.state.terrainType === 'city';
    }

    generateWorld() {
        // Full regeneration - terrain + everything
        if (this.terrain) {
            if (this.terrain.mesh) this.scene.remove(this.terrain.mesh);
            if (this.terrain.waterMesh) this.scene.remove(this.terrain.waterMesh);
        }
        if (this.fire) this.fire.clear();
        if (this.city) this.city.clear();
        if (this.vegetation) this.vegetation.clear();
        if (this.houses) this.houses.clear();

        this.terrain = new ProceduralTerrain(this.scene, {
            size: 30,
            resolution: 120,
            seed: this.state.seed,
            type: this.state.terrainType,
            renderer: this.renderer
        });

        this.city = new CitySystem(this.scene, new SimplexNoise(this.state.seed));

        if (this.needsCitySystem()) {
            this.city.generate(this.terrain, this.state.seed, this.state.vehicleCount, {
                buildingDensity: this.state.houseCount,
                ringCount: this.state.ringCount,
                lightSpacing: this.state.lightSpacing
            });
            if (this.state.lightsOn) {
                this.city.setLights(true);
            }
            // Set ring count slider max
            const rcSlider = document.getElementById('ringCount');
            if (rcSlider && this.city.maxRingCount) {
                rcSlider.max = this.city.maxRingCount;
                if (this.state.ringCount > this.city.maxRingCount) {
                    this.state.ringCount = this.city.maxRingCount;
                    rcSlider.value = this.city.maxRingCount;
                }
            }
            // Sync slider to actual regular building count (landmarks not counted)
            const slider = document.getElementById('houseCount');
            const label = document.getElementById('houseCountVal');
            const actual = this.city.activeBuildingCount();
            if (slider) { slider.max = this.city.buildingSlots.length; slider.value = actual; }
            if (label) label.textContent = actual;
            this.state.houseCount = actual;
        }

        this.houses = new ProceduralHouse(this.scene, new SimplexNoise(this.state.seed));

        if (!this.needsCitySystem() || this.state.terrainType === 'islands') {
            this.houses.settlementType = this.state.settlementType;
            const count = this.state.terrainType === 'islands'
                ? Math.min(this.state.houseCount, 5)
                : this.state.houseCount;
            this.houses.generateMultiple(this.terrain, count);

            if (this.state.lightsOn) {
                this.houses.setInteriorLights(true);
            }
            const hSlider = document.getElementById('houseCount');
            const hLabel = document.getElementById('houseCountVal');
            const hActual = this.houses.houses.length;
            if (hSlider) { hSlider.max = 30; hSlider.value = hActual; }
            if (hLabel) hLabel.textContent = hActual;
            this.state.houseCount = hActual;
        }

        this.fire = new FireSystem(this.scene);
        this.weather = new WeatherSystem(this.scene, this.camera);
        this.weather.setWeather(this.state.weather);
        this.vegetation = new VegetationSystem(this.scene, new SimplexNoise(this.state.seed));

        const housePositions = this.houses.houses.map(h => ({
            x: h.position.x,
            z: h.position.z,
            radius: h.userData.boundingRadius || 3
        }));

        const roadPositions = [];
        const roadSegments = [];
        if (this.needsCitySystem() && this.city.intersections) {
            for (const inter of this.city.intersections) {
                roadPositions.push({ x: inter.x, z: inter.z });
            }
            if (this.city.roads) {
                for (const road of this.city.roads) {
                    roadSegments.push({
                        start: { x: road.start.x, z: road.start.z },
                        end: { x: road.end.x, z: road.end.z },
                        width: road.width || this.city.roadWidth || 2.2
                    });
                }
            }
        }

        // Include city building positions for tree avoidance
        if (this.city && this.city.cityBuildings) {
            for (const bld of this.city.cityBuildings) {
                housePositions.push({ x: bld.position.x, z: bld.position.z, radius: 4.0 });
            }
        }

        const streetLightPositions = [];
        if (this.city && this.city.streetLightLamps) {
            for (const sl of this.city.streetLightLamps) {
                streetLightPositions.push({ x: sl.group.position.x, z: sl.group.position.z, radius: 1.2 });
            }
        }

        this.vegetation.generate(this.terrain, {
            seed: this.state.seed,
            settlementType: this.state.settlementType,
            housePositions,
            roadPositions,
            roadSegments,
            streetLightPositions
        });

        this.updateTimeOfDay(this.state.timeOfDay);

        if (this.state.fireActive) {
            this.fire.placeFiresAtHouses(this.houses.houses);
            const centerSpot = this.terrain.findFlatSpot(0, 0, 10);
            if (centerSpot) {
                this.fire.createCampfire(new THREE.Vector3(centerSpot.x, centerSpot.y, centerSpot.z));
            }
        }
    }

    regenerateTerrain() {
        if (this.terrain) {
            if (this.terrain.mesh) this.scene.remove(this.terrain.mesh);
            if (this.terrain.waterMesh) this.scene.remove(this.terrain.waterMesh);
        }
        this.terrain = new ProceduralTerrain(this.scene, {
            size: 30,
            resolution: 120,
            seed: this.state.seed,
            type: this.state.terrainType,
            renderer: this.renderer
        });
        this.updateTimeOfDay(this.state.timeOfDay);

        // Reposition houses and buildings to new terrain heights
        if (this.houses) {
            for (const house of this.houses.houses) {
                const h = this.terrain.getHeight(house.position.x, house.position.z);
                house.position.y = h;
            }
        }
        if (this.city && this.city.cityBuildings) {
            for (const bld of this.city.cityBuildings) {
                const h = this.terrain.getHeight(bld.position.x, bld.position.z);
                bld.position.y = h;
            }
        }
        if (this.city && this.city.vehicles) {
            for (const v of this.city.vehicles) {
                if (!v.userData.isBoat) {
                    const h = this.terrain.getHeight(v.position.x, v.position.z);
                    v.position.y = h + 0.3;
                }
            }
        }
    }

    regenerateSettlement() {
        // Save vehicle count to preserve across settlement regeneration
        const savedVehicleCount = this.state.vehicleCount;

        if (this.city) this.city.clear();
        if (this.houses) this.houses.clear();
        if (this.vegetation) this.vegetation.clear();

        if (this.needsCitySystem()) {
            // Regenerate city layout (roads + buildings) without vehicles
            this.city.generate(this.terrain, this.state.seed, 0, {
                buildingDensity: this.state.houseCount,
                ringCount: this.state.ringCount,
                lightSpacing: this.state.lightSpacing,
                skipVehicles: true
            });
            if (this.state.lightsOn) this.city.setLights(true);
            this.city.regenerateVehicles(this.terrain, savedVehicleCount);
            // Set ring count slider max
            const rcSlider2 = document.getElementById('ringCount');
            if (rcSlider2 && this.city.maxRingCount) {
                rcSlider2.max = this.city.maxRingCount;
                if (this.state.ringCount > this.city.maxRingCount) {
                    this.state.ringCount = this.city.maxRingCount;
                    rcSlider2.value = this.city.maxRingCount;
                }
            }
            // Sync slider to regular building count
            const slider = document.getElementById('houseCount');
            const label = document.getElementById('houseCountVal');
            const actual = this.city.activeBuildingCount();
            if (slider) { slider.max = this.city.buildingSlots.length; slider.value = actual; }
            if (label) label.textContent = actual;
            this.state.houseCount = actual;
        }

        if (!this.needsCitySystem() || this.state.terrainType === 'islands') {
            this.houses.settlementType = this.state.settlementType;
            const count = this.state.terrainType === 'islands'
                ? Math.min(this.state.houseCount, 5)
                : this.state.houseCount;
            this.houses.generateMultiple(this.terrain, count);
            if (this.state.lightsOn) this.houses.setInteriorLights(true);
            const hSlider = document.getElementById('houseCount');
            const hLabel = document.getElementById('houseCountVal');
            const hActual = this.houses.houses.length;
            if (hSlider) { hSlider.max = 30; hSlider.value = hActual; }
            if (hLabel) hLabel.textContent = hActual;
            this.state.houseCount = hActual;
        }

        const housePositions = this.houses.houses.map(h => ({
            x: h.position.x, z: h.position.z,
            radius: h.userData.boundingRadius || 3
        }));
        // Include city building positions for tree avoidance
        if (this.city && this.city.cityBuildings) {
            for (const bld of this.city.cityBuildings) {
                housePositions.push({ x: bld.position.x, z: bld.position.z, radius: 4.0 });
            }
        }
        const roadPositions = [];
        const roadSegments = [];
        if (this.needsCitySystem() && this.city.intersections) {
            for (const inter of this.city.intersections) {
                roadPositions.push({ x: inter.x, z: inter.z });
            }
            if (this.city.roads) {
                for (const road of this.city.roads) {
                    roadSegments.push({
                        start: { x: road.start.x, z: road.start.z },
                        end: { x: road.end.x, z: road.end.z },
                        width: road.width || this.city.roadWidth || 2.2
                    });
                }
            }
        }
        const streetLightPositions2 = [];
        if (this.city && this.city.streetLightLamps) {
            for (const sl of this.city.streetLightLamps) {
                streetLightPositions2.push({
                    x: sl.group.position.x, z: sl.group.position.z, radius: 1.2
                });
            }
        }
        this.vegetation.generate(this.terrain, {
            seed: this.state.seed,
            settlementType: this.state.settlementType,
            housePositions,
            roadPositions,
            roadSegments,
            streetLightPositions: streetLightPositions2
        });

        // Apply current light state to all lights
        this.updateTimeOfDay(this.state.timeOfDay);
    }

    regenerateVehicles() {
        if (!this.city || !this.needsCitySystem()) return;
        this.city.regenerateVehicles(this.terrain, this.state.vehicleCount);
        this.updateTimeOfDay(this.state.timeOfDay);
    }

    updateHouseCount() {
        // City mode: slider controls number of regular buildings (landmarks always present)
        if (this.needsCitySystem() && this.state.terrainType !== 'islands' && this.city && this.city.buildingSlots) {
            const target = Math.max(0, Math.min(this.city.buildingSlots.length, this.state.houseCount));
            const current = this.city.activeBuildingCount();
            if (target > current) {
                this.city.addBuildings(target - current);
            } else if (target < current) {
                this.city.removeBuildings(current - target);
            }
            const label = document.getElementById('houseCountVal');
            if (label) label.textContent = this.city.activeBuildingCount();
            this.updateTimeOfDay(this.state.timeOfDay);
            return;
        }

        if (!this.houses) return;
        const newCount = this.state.terrainType === 'islands'
            ? Math.min(this.state.houseCount, 5)
            : this.state.houseCount;
        const oldCount = this.houses.houses.length;

        if (newCount > oldCount) {
            this.houses.settlementType = this.state.settlementType;
            this.houses.addHouses(this.terrain, newCount - oldCount);
        } else if (newCount < oldCount) {
            this.houses.removeHouses(oldCount - newCount);
        }

        const label = document.getElementById('houseCountVal');
        const slider = document.getElementById('houseCount');
        const actual = this.houses.houses.length;
        if (label) label.textContent = actual;
        if (slider) { slider.value = actual; slider.max = 30; }
        this.state.houseCount = actual;

        if (this.state.lightsOn) this.houses.setInteriorLights(true);
        this.updateTimeOfDay(this.state.timeOfDay);
    }

    scheduleRegen() {
        if (this._regenTimer) clearTimeout(this._regenTimer);
        this._regenTimer = setTimeout(() => {
            this.generateWorld();
        }, 150);
    }

    regenerateVegetation() {
        if (!this.vegetation) return;
        this.vegetation.clear();
        const buildingPositions = [];
        if (this.city && this.city.cityBuildings) {
            for (const bld of this.city.cityBuildings) {
                buildingPositions.push({ x: bld.position.x, z: bld.position.z, radius: 4.0 });
            }
        }
        const roadPositions = [], roadSegments = [], streetLightPositions = [];
        if (this.city) {
            if (this.city.roads) {
                for (const road of this.city.roads) roadSegments.push({
                    start: { x: road.start.x, z: road.start.z },
                    end: { x: road.end.x, z: road.end.z },
                    width: road.width || 2.2
                });
            }
            if (this.city.streetLightLamps) {
                for (const sl of this.city.streetLightLamps) {
                    streetLightPositions.push({ x: sl.group.position.x, z: sl.group.position.z, radius: 1.2 });
                }
            }
        }
        this.vegetation.generate(this.terrain, {
            seed: this.state.seed, settlementType: this.state.settlementType,
            housePositions: buildingPositions, roadPositions, roadSegments, streetLightPositions
        });
    }

    setupUI() {
        document.querySelectorAll('[data-terrain]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-terrain]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.terrainType = btn.dataset.terrain;

                if (btn.dataset.terrain === 'city') {
                    this.state.settlementType = 'city';
                } else if (btn.dataset.terrain === 'islands') {
                    this.state.settlementType = 'village';
                } else {
                    this.state.settlementType = 'village';
                }
                this.generateWorld();
            });
        });

        document.querySelectorAll('[data-settlement]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('[data-settlement]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.state.settlementType = btn.dataset.settlement;
                this.regenerateSettlement();
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
        houseSlider.addEventListener('change', () => {
            this.updateHouseCount();
        });

        const vehicleSlider = document.getElementById('vehicleCount');
        const vehicleVal = document.getElementById('vehicleCountVal');
        if (vehicleSlider) {
            vehicleSlider.addEventListener('input', () => {
                this.state.vehicleCount = parseInt(vehicleSlider.value);
                vehicleVal.textContent = vehicleSlider.value;
            });
            vehicleSlider.addEventListener('change', () => {
                this.regenerateVehicles();
            });
        }

        const ringCountSlider = document.getElementById('ringCount');
        const ringCountVal = document.getElementById('ringCountVal');
        if (ringCountSlider) {
            ringCountSlider.addEventListener('input', () => {
                this.state.ringCount = parseInt(ringCountSlider.value);
                ringCountVal.textContent = ringCountSlider.value;
            });
            ringCountSlider.addEventListener('change', () => {
                this.scheduleRegen();
            });
        }

        const lightSpacingSlider = document.getElementById('lightSpacing');
        const lightSpacingVal = document.getElementById('lightSpacingVal');
        if (lightSpacingSlider) {
            lightSpacingSlider.addEventListener('input', () => {
                this.state.lightSpacing = parseInt(lightSpacingSlider.value);
                lightSpacingVal.textContent = lightSpacingSlider.value;
                if (this.city) this.city.lightSpacing = this.state.lightSpacing;
                this.updateTimeOfDay(this.state.timeOfDay);
            });
        }

        const fireBtn = document.getElementById('toggleFire');
        fireBtn.addEventListener('click', () => {
            this.state.fireActive = !this.state.fireActive;
            fireBtn.classList.toggle('active', this.state.fireActive);
            fireBtn.textContent = this.state.fireActive ? 'Fire ON' : 'Fire OFF';
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
            lightBtn.textContent = this.state.lightsOn ? 'Lights ON' : 'Lights OFF';
            this.houses.setInteriorLights(this.state.lightsOn);
            this.city.setLights(this.state.lightsOn);
            this.updateTimeOfDay(this.state.timeOfDay);
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
        seedSlider.addEventListener('change', () => {
            this.generateWorld();
        });

        const starSlider = document.getElementById('starSlider');
        const starVal = document.getElementById('starVal');
        if (starSlider) {
            starSlider.addEventListener('input', () => {
                this.state.starDensity = parseInt(starSlider.value);
                starVal.textContent = starSlider.value;
                this.updateTimeOfDay(this.state.timeOfDay);
            });
        }
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
        if (this.terrain)  this.terrain.update(time);
        if (this.fire)     this.fire.update(time);
        if (this.weather)  this.weather.update(time);
        if (this.city)     this.city.update(time, deltaTime);

        if (this.starField) {
            this.starField.material.uniforms.uTime.value = time;
        }

        const isSnowing = this.state.weather === 'snow';
        if (this.terrain) {
            this.terrain.updateSnowAccum(isSnowing, deltaTime);
        }

        if (this.vegetation) {
            this.vegetation.updateSnowAccum(isSnowing, deltaTime);
        }

        if (this.houses) {
            this.houses.updateSnowAccum(isSnowing, deltaTime);
        }

        // Update city building snow accumulation
        if (this.city) {
            this.city.updateSnowAccum(isSnowing, deltaTime);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

new PCGWorld();
