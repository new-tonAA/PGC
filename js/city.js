import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

// =============================================
// City System - Lightweight, minimal draw calls
// =============================================

const VEHICLE_COLORS = [
    0xcc2222, 0x2255cc, 0x22cc44, 0xcccc22, 0xffffff,
    0x222222, 0xcc8822, 0x888888
];

// Shared geometries (created once, reused)
let _sharedGeo = null;
function getSharedGeos() {
    if (_sharedGeo) return _sharedGeo;
    _sharedGeo = {
        carBody: new THREE.BoxGeometry(1.2, 0.45, 0.7),
        carCabin: new THREE.BoxGeometry(0.6, 0.3, 0.6),
        poleThin: new THREE.CylinderGeometry(0.04, 0.05, 3.5, 5),
        poleMedium: new THREE.CylinderGeometry(0.05, 0.06, 3, 6),
        poleThick: new THREE.CylinderGeometry(0.08, 0.1, 1.5, 5),
        lampSphere: new THREE.SphereGeometry(0.15, 6, 4),
        trafficBox: new THREE.BoxGeometry(0.25, 0.6, 0.25),
        bulbSphere: new THREE.SphereGeometry(0.07, 6, 4),
        antenna: new THREE.CylinderGeometry(0.03, 0.05, 2, 4),
        railBar: new THREE.BoxGeometry(1, 0.05, 0.05),
        windowPlane: new THREE.PlaneGeometry(0.5, 0.55),
        dockPlank: new THREE.BoxGeometry(2.0, 0.1, 0.8),
        boatHull: new THREE.BoxGeometry(1.5, 0.3, 0.5),
        boatCabin: new THREE.BoxGeometry(0.4, 0.3, 0.35),
    };
    return _sharedGeo;
}

// Shared materials (no cloning!)
const Mats = {
    road: new THREE.MeshPhongMaterial({ color: 0x333338, shininess: 5 }),
    roadInt: new THREE.MeshPhongMaterial({ color: 0x333338 }),
    windowOn: new THREE.MeshPhongMaterial({
        color: 0xffdd88, emissive: 0xffdd88, emissiveIntensity: 0.6,
        transparent: true, opacity: 0.8, side: THREE.DoubleSide
    }),
    windowOff: new THREE.MeshPhongMaterial({
        color: 0x87ceeb, emissive: 0xffcc44, emissiveIntensity: 0.0,
        transparent: true, opacity: 0.7, side: THREE.DoubleSide
    }),
    streetPole: new THREE.MeshPhongMaterial({ color: 0x555555 }),
    lampOff: new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.3 }),
    lampOn: new THREE.MeshBasicMaterial({ color: 0xffeecc, transparent: true, opacity: 0.9 }),
    trafficPole: new THREE.MeshPhongMaterial({ color: 0x444444 }),
    trafficBox: new THREE.MeshPhongMaterial({ color: 0x222222 }),
    bulbDark: new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.3 }),
    antenna: new THREE.MeshPhongMaterial({ color: 0x888888 }),
    wood: new THREE.MeshPhongMaterial({ color: 0x6b4c2a }),
    woodDark: new THREE.MeshPhongMaterial({ color: 0x4a3520 }),
    boardwalk: new THREE.MeshPhongMaterial({ color: 0x8b6b3a }),
    rail: new THREE.MeshPhongMaterial({ color: 0xdddddd }),
    lighthouseWhite: new THREE.MeshPhongMaterial({ color: 0xffffff, flatShading: true }),
    lighthouseRed: new THREE.MeshPhongMaterial({ color: 0xcc2222 }),
    lighthouseLantern: new THREE.MeshPhongMaterial({
        color: 0xffeeaa, emissive: 0xffcc44, emissiveIntensity: 0.5,
        transparent: true, opacity: 0.8
    }),
    lighthouseDome: new THREE.MeshPhongMaterial({ color: 0x222222 }),
};

class CitySystem {
    constructor(scene, noise) {
        this.scene = scene;
        this.noise = noise;
        this.group = new THREE.Group();
        this.vehicles = [];
        this.trafficLights = [];
        this.streetLightGroups = [];
        this.intersections = [];
        this.cityBuildings = [];
        this.lightsOn = false;
        this.geos = getSharedGeos();
    }

    generate(terrain, seed) {
        this.clear();
        this.noise = new SimplexNoise(seed);
        this.scene.add(this.group);

        const type = terrain.terrainType;
        if (type === 'islands') {
            this.generateIslandCity(terrain);
        } else if (type === 'coastal') {
            this.generateCoastalCity(terrain);
        } else {
            this.generateGridCity(terrain);
        }
    }

    // ==========================================
    // GRID CITY - minimal roads + buildings
    // ==========================================
    generateGridCity(terrain) {
        const halfSize = terrain.size * 0.3;
        const blockSize = 14; // Larger blocks = fewer buildings
        const roadWidth = 2.0;

        const roadPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += blockSize) {
            roadPositions.push(pos);
        }

        // Roads
        for (const pos of roadPositions) {
            const roadLen = halfSize * 2 + blockSize;
            const hRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(roadLen, roadWidth),
                Mats.road
            );
            hRoad.rotation.x = -Math.PI / 2;
            hRoad.position.set(0, 0.02, pos);
            hRoad.receiveShadow = true;
            this.group.add(hRoad);

            const vRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(roadLen, roadWidth),
                Mats.road
            );
            vRoad.rotation.x = -Math.PI / 2;
            vRoad.rotation.y = Math.PI / 2;
            vRoad.position.set(pos, 0.02, 0);
            vRoad.receiveShadow = true;
            this.group.add(vRoad);
        }

        // Intersections + traffic lights (sparse)
        for (let i = 0; i < roadPositions.length; i++) {
            for (let j = 0; j < roadPositions.length; j++) {
                const x = roadPositions[i], z = roadPositions[j];
                const h = terrain.getHeight(x, z);
                if (h < terrain.waterLevel + 0.3) continue;
                this.intersections.push({ x, z });
                if ((i + j) % 3 === 0) {
                    this.createTrafficLight(x, z, h, roadWidth);
                }
            }
        }

        // 1 building per block
        for (let i = 0; i < roadPositions.length - 1; i++) {
            for (let j = 0; j < roadPositions.length - 1; j++) {
                const cx = (roadPositions[i] + roadPositions[i + 1]) / 2;
                const cz = (roadPositions[j] + roadPositions[j + 1]) / 2;
                const h = terrain.getHeight(cx, cz);
                if (h < terrain.waterLevel + 0.3) continue;

                const distFromCenter = Math.sqrt(cx * cx + cz * cz);
                const heightFactor = Math.max(0.3, 1.0 - distFromCenter / (terrain.size * 0.4));
                this.createBuilding(cx, h, cz, heightFactor);
            }
        }

        // Street lights (sparse, every 12 units)
        for (const pos of roadPositions) {
            for (let t = -halfSize; t <= halfSize; t += 12) {
                const hH = terrain.getHeight(t, pos);
                if (hH > terrain.waterLevel + 0.3) {
                    this.createStreetLight(t - roadWidth / 2 - 0.5, hH, pos);
                }
                const hV = terrain.getHeight(pos, t);
                if (hV > terrain.waterLevel + 0.3) {
                    this.createStreetLight(pos, hV, t - roadWidth / 2 - 0.5);
                }
            }
        }

        // Vehicles (max 6)
        this.generateVehicles(terrain, roadPositions, halfSize, 4);
    }

    // ==========================================
    // BUILDING - single mesh + 2 window strips
    // ==========================================
    createBuilding(x, baseH, z, heightFactor) {
        const group = new THREE.Group();

        // Size based on distance from center
        const nVal = this.noise.noise2D(x * 0.15, z * 0.15);
        const isTall = heightFactor > 0.6;
        const width = isTall ? 3 + Math.random() * 2 : 2 + Math.random() * 1.5;
        const depth = isTall ? 3 + Math.random() * 2 : 2 + Math.random() * 1.5;
        const height = Math.max(3, (isTall ? 6 + heightFactor * 14 + nVal * 4 : 3 + Math.random() * 4));

        // Wall color - use a few preset colors instead of random
        const wallColors = isTall
            ? [0x667788, 0x808078, 0x596468]
            : height > 6
                ? [0xb0a8a0, 0x989890]
                : [0xa39888];
        const wallColor = wallColors[Math.floor(Math.abs(nVal * 10)) % wallColors.length];

        // Body - single mesh
        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMat = new THREE.MeshPhongMaterial({
            color: wallColor,
            flatShading: !isTall,
            shininess: isTall ? 60 : 10
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = height / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Window strips - 2 strips per face instead of individual windows
        // Front window strip
        const stripH = Math.min(height * 0.6, 5);
        const stripW = width * 0.7;
        const frontStrip = new THREE.Mesh(
            new THREE.PlaneGeometry(stripW, stripH),
            Mats.windowOff
        );
        frontStrip.position.set(0, height * 0.45, depth / 2 + 0.01);
        group.add(frontStrip);

        // Back window strip
        const backStrip = new THREE.Mesh(
            new THREE.PlaneGeometry(stripW, stripH),
            Mats.windowOff
        );
        backStrip.position.set(0, height * 0.45, -depth / 2 - 0.01);
        backStrip.rotation.y = Math.PI;
        group.add(backStrip);

        // Side window strips
        const sideStripW = depth * 0.7;
        const sideStrip1 = new THREE.Mesh(
            new THREE.PlaneGeometry(sideStripW, stripH),
            Mats.windowOff
        );
        sideStrip1.rotation.y = Math.PI / 2;
        sideStrip1.position.set(width / 2 + 0.01, height * 0.45, 0);
        group.add(sideStrip1);

        const sideStrip2 = new THREE.Mesh(
            new THREE.PlaneGeometry(sideStripW, stripH),
            Mats.windowOff
        );
        sideStrip2.rotation.y = -Math.PI / 2;
        sideStrip2.position.set(-width / 2 - 0.01, height * 0.45, 0);
        group.add(sideStrip2);

        group.userData.windowMeshes = [frontStrip, backStrip, sideStrip1, sideStrip2];

        // Roof
        if (isTall) {
            const antenna = new THREE.Mesh(this.geos.antenna, Mats.antenna);
            antenna.position.y = height + 1;
            group.add(antenna);
            // Red blink - share one light for all tall buildings (handled in update)
            group.userData.hasTopLight = true;
        } else {
            const roofEdge = new THREE.Mesh(
                new THREE.BoxGeometry(width + 0.1, 0.15, depth + 0.1),
                new THREE.MeshPhongMaterial({ color: wallColor * 0.8 & 0xffffff })
            );
            roofEdge.position.y = height + 0.075;
            group.add(roofEdge);
        }

        // No per-building PointLight! (saves dozens of lights)
        // Night glow is handled by window material emissive change

        group.position.set(x, Math.max(baseH * 0.15, 0), z);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // ISLAND CITY - small harbor town
    // ==========================================
    generateIslandCity(terrain) {
        const halfSize = terrain.size * 0.25;

        // Cross roads
        const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        for (const angle of angles) {
            const endR = halfSize * 0.5;
            const road = new THREE.Mesh(
                new THREE.PlaneGeometry(endR, 2.0),
                Mats.road
            );
            road.rotation.x = -Math.PI / 2;
            road.rotation.y = angle;
            road.position.set(
                Math.cos(angle) * endR * 0.5,
                0.02,
                Math.sin(angle) * endR * 0.5
            );
            this.group.add(road);
        }

        this.createHarbor(terrain);
        this.createLighthouse(terrain);

        // 8 island buildings max
        let placed = 0;
        for (let i = 0; i < 20 && placed < 8; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * halfSize * 0.4;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);
            if (h < terrain.waterLevel + 0.5 || h > 4) continue;
            this.createIslandBuilding(x, h, z);
            placed++;
        }

        this.createBoats(terrain, 3);
    }

    // ==========================================
    // COASTAL CITY - seaside town
    // ==========================================
    generateCoastalCity(terrain) {
        const halfSize = terrain.size * 0.25;
        const roadWidth = 2.0;
        const wl = terrain.waterLevel;

        // Find coastline (just a few scan points)
        const coastPoints = [];
        for (let x = -halfSize; x <= halfSize; x += 4) {
            for (let z = -halfSize; z <= halfSize; z += 2) {
                const h = terrain.getHeight(x, z);
                const hNext = terrain.getHeight(x, z + 1);
                if (h >= wl && h < wl + 1.5 && hNext < wl) {
                    coastPoints.push({ x, z, h });
                    break;
                }
            }
        }

        // Boardwalk (simple flat path along coast)
        if (coastPoints.length > 1) {
            for (let i = 0; i < coastPoints.length - 1; i += 2) {
                const p1 = coastPoints[i];
                const p2 = coastPoints[Math.min(i + 2, coastPoints.length - 1)];
                const dx = p2.x - p1.x;
                const dz = p2.z - p1.z;
                const len = Math.sqrt(dx * dx + dz * dz);
                if (len < 0.5) continue;
                const board = new THREE.Mesh(
                    new THREE.PlaneGeometry(len, 2.5),
                    Mats.boardwalk
                );
                board.rotation.x = -Math.PI / 2;
                board.rotation.y = Math.atan2(dx, dz);
                const mx = (p1.x + p2.x) / 2;
                const mz = (p1.z + p2.z) / 2;
                const mh = (p1.h + (p2.h || p1.h)) / 2;
                board.position.set(mx, Math.max(mh, wl) + 0.05, mz);
                board.receiveShadow = true;
                this.group.add(board);
            }
        }

        // Simple road grid (fewer roads)
        const roadPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += 14) {
            roadPositions.push(pos);
        }
        for (const pos of roadPositions) {
            const roadLen = halfSize * 2 + 14;
            const hRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(roadLen, roadWidth),
                Mats.road
            );
            hRoad.rotation.x = -Math.PI / 2;
            hRoad.position.set(0, 0.02, pos);
            this.group.add(hRoad);

            const vRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(roadLen, roadWidth),
                Mats.road
            );
            vRoad.rotation.x = -Math.PI / 2;
            vRoad.rotation.y = Math.PI / 2;
            vRoad.position.set(pos, 0.02, 0);
            this.group.add(vRoad);
        }

        // Coastal buildings (max 12)
        let placed = 0;
        for (let i = 0; i < 25 && placed < 12; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * halfSize * 0.7;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);
            if (h < wl + 0.5 || h > 3.5) continue;
            if (Math.abs(z - wl) < 3) {
                this.createCoastalBuilding(x, h, z);
            } else {
                this.createIslandBuilding(x, h, z);
            }
            placed++;
        }

        this.createBeachFurniture(terrain);
        this.createBoats(terrain, 3);

        // Few street lights
        for (const pos of roadPositions) {
            for (let t = -halfSize; t <= halfSize; t += 14) {
                const hV = terrain.getHeight(pos, t);
                if (hV > wl + 0.3 && hV < 4) {
                    this.createStreetLight(pos, hV, t);
                }
            }
        }

        this.generateVehicles(terrain, roadPositions, halfSize, 3);
    }

    // ==========================================
    // ISLAND BUILDING - small coastal house
    // ==========================================
    createIslandBuilding(x, h, z) {
        const group = new THREE.Group();
        const width = 1.5 + Math.random() * 2;
        const depth = 1.5 + Math.random() * 2;
        const height = 2 + Math.random() * 2.5;

        const colors = [0xf0d8c0, 0xc0d8e8, 0xd8d0b8, 0xb8ccb8, 0xe0c8b0];
        const wallColor = colors[Math.floor(Math.random() * colors.length)];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshPhongMaterial({ color: wallColor, flatShading: true })
        );
        body.position.y = height / 2;
        body.castShadow = true;
        group.add(body);

        // Roof
        const roofH = Math.max(width, depth) * 0.5;
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(width, depth) * 0.72, roofH, 4),
            new THREE.MeshPhongMaterial({ color: 0x994c33, flatShading: true })
        );
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        // 2 windows (front face only, shared material)
        const wGeo = this.geos.windowPlane;
        const w1 = new THREE.Mesh(wGeo, Mats.windowOff);
        w1.position.set(-width * 0.25, height * 0.4, depth / 2 + 0.01);
        group.add(w1);
        const w2 = new THREE.Mesh(wGeo, Mats.windowOff);
        w2.position.set(width * 0.25, height * 0.4, depth / 2 + 0.01);
        group.add(w2);
        group.userData.windowMeshes = [w1, w2];

        group.position.set(x, Math.max(h * 0.15, 0), z);
        group.rotation.y = this.noise.noise2D(x * 0.15, z * 0.15) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // COASTAL BUILDING - seaside villa
    // ==========================================
    createCoastalBuilding(x, h, z) {
        const group = new THREE.Group();
        const width = 2 + Math.random() * 2;
        const depth = 2 + Math.random() * 1.5;
        const height = 2.5 + Math.random() * 2;

        const colors = [0xf0ece0, 0xb8dde8, 0xece0c8, 0xe0b8a0, 0xa0d8c8];
        const wallColor = colors[Math.floor(Math.random() * colors.length)];

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshPhongMaterial({ color: wallColor, flatShading: true })
        );
        body.position.y = height / 2;
        body.castShadow = true;
        group.add(body);

        // Flat roof
        const roof = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.3, 0.15, depth + 0.3),
            new THREE.MeshPhongMaterial({ color: 0x5a4c40, flatShading: true })
        );
        roof.position.y = height + 0.075;
        group.add(roof);

        // Balcony rail
        const rail = new THREE.Mesh(this.geos.railBar, Mats.rail);
        rail.scale.x = width;
        rail.position.set(0, height * 0.45, depth / 2 + 0.3);
        group.add(rail);

        // 2 front windows
        const wGeo = this.geos.windowPlane;
        const w1 = new THREE.Mesh(wGeo, Mats.windowOff);
        w1.position.set(-width * 0.3, height * 0.4, depth / 2 + 0.01);
        group.add(w1);
        const w2 = new THREE.Mesh(wGeo, Mats.windowOff);
        w2.position.set(width * 0.3, height * 0.4, depth / 2 + 0.01);
        group.add(w2);
        group.userData.windowMeshes = [w1, w2];

        group.position.set(x, Math.max(h * 0.15, 0), z);
        group.rotation.y = this.noise.noise2D(x * 0.2, z * 0.2) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // BEACH FURNITURE - just a few umbrellas
    // ==========================================
    createBeachFurniture(terrain) {
        const wl = terrain.waterLevel;
        const umbrellaColors = [0xff4444, 0x4488ff, 0xffcc22, 0x44cc44, 0xff88cc];

        for (let i = 0; i < 6; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = terrain.size * 0.15 + Math.random() * terrain.size * 0.1;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);
            if (h < wl - 0.2 || h > wl + 1.0) continue;

            const group = new THREE.Group();
            const pole = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.04, 2.0, 5),
                new THREE.MeshPhongMaterial({ color: 0xcccccc })
            );
            pole.position.y = 1.0;
            group.add(pole);

            const umbrella = new THREE.Mesh(
                new THREE.ConeGeometry(1.2, 0.4, 8),
                new THREE.MeshPhongMaterial({
                    color: umbrellaColors[i % umbrellaColors.length],
                    flatShading: true
                })
            );
            umbrella.position.y = 2.0;
            group.add(umbrella);

            group.position.set(x, Math.max(h, wl) + 0.02, z);
            this.group.add(group);
        }
    }

    // ==========================================
    // TRAFFIC LIGHT
    // ==========================================
    createTrafficLight(x, z, h, roadWidth) {
        const group = new THREE.Group();

        const pole = new THREE.Mesh(this.geos.poleMedium, Mats.trafficPole);
        pole.position.y = 1.5;
        group.add(pole);

        const box = new THREE.Mesh(this.geos.trafficBox, Mats.trafficBox);
        box.position.y = 3.2;
        group.add(box);

        const bulbColors = [0xff0000, 0xffaa00, 0x00ff00];
        const bulbs = [];
        for (let i = 0; i < 3; i++) {
            const isOn = i === 0;
            const mat = isOn
                ? new THREE.MeshBasicMaterial({ color: bulbColors[i], transparent: true, opacity: 1.0 })
                : Mats.bulbDark.clone();
            const bulb = new THREE.Mesh(this.geos.bulbSphere, mat);
            bulb.position.set(0.14, 3.4 - i * 0.2, 0);
            group.add(bulb);
            bulbs.push(bulb);
        }

        group.position.set(x + roadWidth / 2 + 0.6, Math.max(h * 0.15, 0), z + roadWidth / 2 + 0.6);
        this.group.add(group);
        this.trafficLights.push({ group, bulbs, phase: Math.random() * 20, colors: bulbColors });
    }

    // ==========================================
    // STREET LIGHT - no PointLight, just emissive
    // ==========================================
    createStreetLight(x, h, z) {
        const group = new THREE.Group();

        const pole = new THREE.Mesh(this.geos.poleThin, Mats.streetPole);
        pole.position.y = 1.75;
        group.add(pole);

        const lamp = new THREE.Mesh(this.geos.lampSphere, Mats.lampOff);
        lamp.position.y = 3.5;
        group.add(lamp);

        group.position.set(x, Math.max(h * 0.15, 0), z);
        this.group.add(group);
        this.streetLightGroups.push({ group, lamp });
    }

    // ==========================================
    // HARBOR - simple dock
    // ==========================================
    createHarbor(terrain) {
        let bestAngle = 0, bestH = -Infinity;
        for (let a = 0; a < Math.PI * 2; a += 0.3) {
            const r = terrain.size * 0.2;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            const h = terrain.getHeight(x, z);
            if (h > terrain.waterLevel && h > bestH && h < terrain.waterLevel + 2) {
                bestH = h;
                bestAngle = a;
            }
        }

        const hx = Math.cos(bestAngle) * terrain.size * 0.22;
        const hz = Math.sin(bestAngle) * terrain.size * 0.22;
        const dockDir = new THREE.Vector3(Math.cos(bestAngle), 0, Math.sin(bestAngle));

        for (let i = 0; i < 4; i++) {
            const plank = new THREE.Mesh(this.geos.dockPlank, Mats.wood);
            plank.position.set(
                hx + dockDir.x * i,
                terrain.waterLevel + 0.15,
                hz + dockDir.z * i
            );
            plank.rotation.y = bestAngle;
            this.group.add(plank);
        }

        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < 4; i += 2) {
                const post = new THREE.Mesh(this.geos.poleThick, Mats.woodDark);
                post.position.set(
                    hx + dockDir.x * i + dockDir.z * side * 1.0,
                    terrain.waterLevel - 0.3,
                    hz + dockDir.z * i - dockDir.x * side * 1.0
                );
                this.group.add(post);
            }
        }
    }

    // ==========================================
    // LIGHTHOUSE
    // ==========================================
    createLighthouse(terrain) {
        let bestAngle = Math.PI * 0.75, bestH = -Infinity;
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const r = terrain.size * 0.18;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            const h = terrain.getHeight(x, z);
            if (h > terrain.waterLevel + 1 && h > bestH && h < 5) {
                bestH = h;
                bestAngle = a;
            }
        }

        const lx = Math.cos(bestAngle) * terrain.size * 0.2;
        const lz = Math.sin(bestAngle) * terrain.size * 0.2;
        const lh = terrain.getHeight(lx, lz);

        const group = new THREE.Group();

        const tower = new THREE.Mesh(
            new THREE.CylinderGeometry(0.4, 0.7, 5, 8),
            Mats.lighthouseWhite
        );
        tower.position.y = 2.5;
        tower.castShadow = true;
        group.add(tower);

        const stripe = new THREE.Mesh(
            new THREE.CylinderGeometry(0.65, 0.68, 1.0, 8),
            Mats.lighthouseRed
        );
        stripe.position.y = 2;
        group.add(stripe);

        const lantern = new THREE.Mesh(
            new THREE.CylinderGeometry(0.5, 0.45, 0.6, 8),
            Mats.lighthouseLantern
        );
        lantern.position.y = 5.5;
        group.add(lantern);

        const dome = new THREE.Mesh(
            new THREE.ConeGeometry(0.5, 0.4, 8),
            Mats.lighthouseDome
        );
        dome.position.y = 5.9;
        group.add(dome);

        // SpotLight for beam (just 1 for lighthouse)
        const beam = new THREE.SpotLight(0xffffcc, 1.5, 40, Math.PI / 6, 0.5, 1);
        beam.position.y = 5.5;
        beam.target.position.set(lx + 20, lh * 0.15 + 3, lz);
        group.add(beam);
        group.add(beam.target);
        group.userData.beamLight = beam;

        group.position.set(lx, Math.max(lh * 0.15, 0), lz);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // BOATS
    // ==========================================
    createBoats(terrain, count) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = terrain.size * 0.12 + Math.random() * terrain.size * 0.15;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            if (terrain.getHeight(x, z) > terrain.waterLevel - 0.5) continue;

            const group = new THREE.Group();
            const hull = new THREE.Mesh(this.geos.boatHull, new THREE.MeshPhongMaterial({
                color: new THREE.Color().setHSL(Math.random(), 0.5, 0.4), flatShading: true
            }));
            hull.position.y = 0.1;
            group.add(hull);

            const cabin = new THREE.Mesh(this.geos.boatCabin, Mats.lighthouseWhite);
            cabin.position.set(-0.2, 0.3, 0);
            group.add(cabin);

            group.position.set(x, terrain.waterLevel - 0.05, z);
            group.rotation.y = angle + Math.PI;
            group.userData.bobOffset = Math.random() * Math.PI * 2;
            group.userData.isBoat = true;
            this.group.add(group);
            this.vehicles.push(group);
        }
    }

    // ==========================================
    // VEHICLES - minimal
    // ==========================================
    generateVehicles(terrain, roadPositions, halfSize, count) {
        for (let i = 0; i < count; i++) {
            const isHorizontal = Math.random() < 0.5;
            const roadIndex = Math.floor(Math.random() * roadPositions.length);
            const roadPos = roadPositions[roadIndex];
            const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
            const t = -halfSize + Math.random() * halfSize * 2;
            const lane = (i % 2 === 0 ? -1 : 1) * 0.5;

            const group = new THREE.Group();
            const body = new THREE.Mesh(this.geos.carBody, new THREE.MeshPhongMaterial({ color, flatShading: true }));
            body.position.y = 0.35;
            group.add(body);

            const cabin = new THREE.Mesh(this.geos.carCabin, new THREE.MeshPhongMaterial({ color, flatShading: true }));
            cabin.position.set(-0.05, 0.65, 0);
            group.add(cabin);

            const h = terrain.getHeight(
                isHorizontal ? t : roadPos + lane,
                isHorizontal ? roadPos + lane : t
            );

            let xPos, zPos;
            if (isHorizontal) {
                xPos = t; zPos = roadPos + lane;
                group.rotation.y = lane > 0 ? 0 : Math.PI;
            } else {
                xPos = roadPos + lane; zPos = t;
                group.rotation.y = lane > 0 ? Math.PI / 2 : -Math.PI / 2;
            }

            group.position.set(xPos, Math.max(h * 0.15 + 0.02, 0.02), zPos);
            group.userData = { isHorizontal, speed: 1.5 + Math.random() * 2, direction: lane > 0 ? 1 : -1, roadPos, lane, halfSize };

            this.group.add(group);
            this.vehicles.push(group);
        }
    }

    // ==========================================
    // LIGHTS CONTROL
    // ==========================================
    setLights(on) {
        this.lightsOn = on;

        for (const sl of this.streetLightGroups) {
            sl.lamp.material = on ? Mats.lampOn : Mats.lampOff;
        }

        for (const bld of this.cityBuildings) {
            if (bld.userData.windowMeshes) {
                const mat = on ? Mats.windowOn : Mats.windowOff;
                for (const w of bld.userData.windowMeshes) {
                    w.material = mat; // No cloning, just swap shared material
                }
            }
        }
    }

    // ==========================================
    // UPDATE
    // ==========================================
    update(time) {
        // Vehicles
        for (const v of this.vehicles) {
            const ud = v.userData;
            if (ud.isBoat) {
                v.position.y += Math.sin(time * 0.8 + ud.bobOffset) * 0.001;
                v.rotation.z = Math.sin(time * 0.5 + ud.bobOffset) * 0.02;
                continue;
            }
            if (ud.isHorizontal === undefined) continue;

            const move = ud.speed * ud.direction * 0.016;
            if (ud.isHorizontal) {
                v.position.x += move;
                if (v.position.x > ud.halfSize + 5) v.position.x = -ud.halfSize - 5;
                if (v.position.x < -ud.halfSize - 5) v.position.x = ud.halfSize + 5;
            } else {
                v.position.z += move;
                if (v.position.z > ud.halfSize + 5) v.position.z = -ud.halfSize - 5;
                if (v.position.z < -ud.halfSize - 5) v.position.z = ud.halfSize + 5;
            }
        }

        // Traffic lights (cycle through colors)
        for (const tl of this.trafficLights) {
            const cycleTime = 8;
            const phase = (time + tl.phase) % cycleTime;
            const activeIndex = phase < cycleTime * 0.45 ? 2 : phase < cycleTime * 0.5 ? 1 : 0;
            for (let i = 0; i < tl.bulbs.length; i++) {
                const isActive = i === activeIndex;
                tl.bulbs[i].material.color.set(isActive ? tl.colors[i] : 0x333333);
                tl.bulbs[i].material.opacity = isActive ? 1.0 : 0.3;
            }
        }

        // Lighthouse beam rotation
        for (const bld of this.cityBuildings) {
            if (bld.userData.beamLight) {
                bld.userData.beamLight.target.position.x = Math.cos(time * 0.5) * 30;
                bld.userData.beamLight.target.position.z = Math.sin(time * 0.5) * 30;
            }
        }
    }

    // ==========================================
    // CLEAR
    // ==========================================
    clear() {
        this.group.traverse((child) => {
            if (child.geometry) {
                // Don't dispose shared geometries
                if (!Object.values(this.geos).includes(child.geometry)) {
                    child.geometry.dispose();
                }
            }
            if (child.material) {
                // Don't dispose shared materials
                const isShared = Object.values(Mats).includes(child.material);
                if (!isShared) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => {
                            if (!Object.values(Mats).includes(m)) m.dispose();
                        });
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        this.scene.remove(this.group);

        this.group = new THREE.Group();
        this.vehicles = [];
        this.trafficLights = [];
        this.streetLightGroups = [];
        this.intersections = [];
        this.cityBuildings = [];
        this.lightsOn = false;
    }
}

export { CitySystem };
