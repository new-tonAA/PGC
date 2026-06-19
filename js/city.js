import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

// =============================================
// City System: Roads, Buildings, Street Furniture, Vehicles
// =============================================

const VEHICLE_COLORS = [
    0xcc2222, 0x2255cc, 0x22cc44, 0xcccc22, 0xffffff,
    0x222222, 0xcc8822, 0x8822cc, 0x22cccc, 0x888888,
    0xcc4488, 0x44cc88
];

class CitySystem {
    constructor(scene, noise) {
        this.scene = scene;
        this.noise = noise;
        this.group = new THREE.Group();
        this.vehicles = [];
        this.trafficLights = [];
        this.streetLightLamps = [];
        this.roads = [];
        this.intersections = [];
        this.cityBuildings = [];
        this.lightsOn = false;
    }

    generate(terrain, seed) {
        this.clear();
        this.noise = new SimplexNoise(seed);
        this.scene.add(this.group);

        const isIsland = terrain.terrainType === 'islands';

        if (isIsland) {
            this.generateIslandCity(terrain);
        } else {
            this.generateGridCity(terrain);
        }
    }

    // ==========================================
    // GRID CITY (for city/suburban terrain)
    // ==========================================
    generateGridCity(terrain) {
        const halfSize = terrain.size * 0.4;
        const blockSize = 10;
        const roadWidth = 2.5;
        const sidewalkWidth = 0.8;

        // Road positions
        const roadPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += blockSize) {
            roadPositions.push(pos);
        }

        // Generate road surfaces
        for (const pos of roadPositions) {
            // Horizontal road
            this.createRoadSegment(
                new THREE.Vector3(-halfSize - blockSize, 0.02, pos),
                new THREE.Vector3(halfSize + blockSize, 0.02, pos),
                roadWidth, terrain, false
            );
            // Vertical road
            this.createRoadSegment(
                new THREE.Vector3(pos, 0.02, -halfSize - blockSize),
                new THREE.Vector3(pos, 0.02, halfSize + blockSize),
                roadWidth, terrain, true
            );
        }

        // Generate intersections and traffic lights
        for (const x of roadPositions) {
            for (const z of roadPositions) {
                const h = terrain.getHeight(x, z);
                if (h < terrain.waterLevel + 0.3) continue;

                this.intersections.push({ x, z });
                this.createIntersection(x, z, h, roadWidth);
                this.createTrafficLight(x, z, h, roadWidth);
            }
        }

        // Generate buildings in blocks
        for (let i = 0; i < roadPositions.length - 1; i++) {
            for (let j = 0; j < roadPositions.length - 1; j++) {
                const x1 = roadPositions[i] + roadWidth / 2 + 1;
                const z1 = roadPositions[j] + roadWidth / 2 + 1;
                const x2 = roadPositions[i + 1] - roadWidth / 2 - 1;
                const z2 = roadPositions[j + 1] - roadWidth / 2 - 1;

                const centerX = (x1 + x2) / 2;
                const centerZ = (z1 + z2) / 2;
                const h = terrain.getHeight(centerX, centerZ);

                if (h < terrain.waterLevel + 0.3) continue;

                // Distance from center affects building height
                const distFromCenter = Math.sqrt(centerX * centerX + centerZ * centerZ);
                const heightFactor = Math.max(0.3, 1.0 - distFromCenter / (terrain.size * 0.5));

                this.generateBlock(x1, z1, x2, z2, h, heightFactor, terrain);
            }
        }

        // Street lights along roads
        for (const pos of roadPositions) {
            for (let t = -halfSize; t <= halfSize; t += 6) {
                const hH = terrain.getHeight(t, pos);
                if (hH > terrain.waterLevel + 0.3) {
                    this.createStreetLight(t - roadWidth / 2 - 0.5, hH, pos, terrain);
                    this.createStreetLight(t + roadWidth / 2 + 0.5, hH, pos, terrain);
                }
                const hV = terrain.getHeight(pos, t);
                if (hV > terrain.waterLevel + 0.3) {
                    this.createStreetLight(pos, hV, t - roadWidth / 2 - 0.5, terrain);
                    this.createStreetLight(pos, hV, t + roadWidth / 2 + 0.5, terrain);
                }
            }
        }

        // Vehicles on roads
        this.generateVehicles(terrain, roadPositions, halfSize);
    }

    // ==========================================
    // ISLAND CITY (harbor town)
    // ==========================================
    generateIslandCity(terrain) {
        // Find the largest island area
        const halfSize = terrain.size * 0.35;
        const blockSize = 12;
        const roadWidth = 2.2;

        // Main coastal road (ring road around island)
        const coastAngles = 36;
        for (let i = 0; i < coastAngles; i++) {
            const a1 = (i / coastAngles) * Math.PI * 2;
            const a2 = ((i + 1) / coastAngles) * Math.PI * 2;
            const r1 = halfSize * 0.55;
            const r2 = halfSize * 0.55;

            const x1 = Math.cos(a1) * r1, z1 = Math.sin(a1) * r1;
            const x2 = Math.cos(a2) * r2, z2 = Math.sin(a2) * r2;
            const h1 = terrain.getHeight(x1, z1);
            const h2 = terrain.getHeight(x2, z2);

            if (h1 > terrain.waterLevel + 0.3 && h2 > terrain.waterLevel + 0.3) {
                this.createRoadSegment(
                    new THREE.Vector3(x1, Math.max(h1, h2) * 0.3 + 0.02, z1),
                    new THREE.Vector3(x2, Math.max(h1, h2) * 0.3 + 0.02, z2),
                    roadWidth, terrain, false
                );
            }
        }

        // Cross roads from center
        const crossRoadAngles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        for (const angle of crossRoadAngles) {
            const startR = 2;
            const endR = halfSize * 0.55;
            this.createRoadSegment(
                new THREE.Vector3(Math.cos(angle) * startR, 0.02, Math.sin(angle) * startR),
                new THREE.Vector3(Math.cos(angle) * endR, 0.02, Math.sin(angle) * endR),
                roadWidth, terrain, true
            );
        }

        // Harbor / Dock
        this.createHarbor(terrain);

        // Lighthouse
        this.createLighthouse(terrain);

        // Island buildings (smaller, coastal town style)
        for (let i = 0; i < 25; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * halfSize * 0.45;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);

            if (h < terrain.waterLevel + 0.5 || h > 4) continue;

            this.createIslandBuilding(x, h, z, terrain);
        }

        // Street lights along cross roads
        for (const angle of crossRoadAngles) {
            for (let r = 4; r < halfSize * 0.5; r += 6) {
                const x = Math.cos(angle) * r;
                const z = Math.sin(angle) * r;
                const h = terrain.getHeight(x, z);
                if (h > terrain.waterLevel + 0.5) {
                    this.createStreetLight(x + 1.5, h, z, terrain);
                    this.createStreetLight(x - 1.5, h, z, terrain);
                }
            }
        }

        // Boats on water
        this.createBoats(terrain);
    }

    // ==========================================
    // ROAD SEGMENT
    // ==========================================
    createRoadSegment(start, end, width, terrain, isVertical) {
        const dir = new THREE.Vector3().subVectors(end, start);
        const length = dir.length();
        dir.normalize();

        // Road surface
        const roadGeo = new THREE.PlaneGeometry(length, width);
        const roadMat = new THREE.MeshPhongMaterial({
            color: 0x333338,
            shininess: 10,
        });
        const road = new THREE.Mesh(roadGeo, roadMat);
        road.rotation.x = -Math.PI / 2;

        const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const h = terrain.getHeight(mid.x, mid.z);
        road.position.set(mid.x, Math.max(start.y, h * 0.15 + 0.03), mid.z);

        if (!isVertical) {
            road.rotation.z = Math.atan2(dir.z, dir.x);
        } else {
            road.rotation.z = Math.atan2(dir.z, dir.x);
        }

        road.receiveShadow = true;
        this.group.add(road);

        // Center line (dashed)
        const dashCount = Math.floor(length / 2);
        for (let d = 0; d < dashCount; d++) {
            if (d % 2 === 0) continue;
            const t = (d + 0.5) / dashCount;
            const dashGeo = new THREE.PlaneGeometry(1.2, 0.08);
            const dashMat = new THREE.MeshBasicMaterial({ color: 0xcccc44 });
            const dash = new THREE.Mesh(dashGeo, dashMat);
            dash.rotation.x = -Math.PI / 2;

            const px = start.x + dir.x * length * t;
            const pz = start.z + dir.z * length * t;
            const dh = terrain.getHeight(px, pz);
            dash.position.set(px, Math.max(start.y + 0.01, dh * 0.15 + 0.04), pz);
            dash.rotation.z = road.rotation.z;
            this.group.add(dash);
        }

        // Sidewalks
        for (const side of [-1, 1]) {
            const swGeo = new THREE.BoxGeometry(length, 0.12, 0.6);
            const swMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            const sw = new THREE.Mesh(swGeo, swMat);

            const offset = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side * (width / 2 + 0.3));
            sw.position.set(mid.x + offset.x, road.position.y + 0.06, mid.z + offset.z);
            sw.rotation.y = Math.atan2(dir.x, dir.z);
            sw.receiveShadow = true;
            this.group.add(sw);
        }

        this.roads.push({ start: start.clone(), end: end.clone(), width, dir: dir.clone(), length });
    }

    // ==========================================
    // INTERSECTION
    // ==========================================
    createIntersection(x, z, h, roadWidth) {
        const intGeo = new THREE.PlaneGeometry(roadWidth, roadWidth);
        const intMat = new THREE.MeshPhongMaterial({ color: 0x333338 });
        const intersection = new THREE.Mesh(intGeo, intMat);
        intersection.rotation.x = -Math.PI / 2;
        intersection.position.set(x, h * 0.15 + 0.04, z);
        intersection.receiveShadow = true;
        this.group.add(intersection);

        // Crosswalk markings
        for (const rot of [0, Math.PI / 2]) {
            for (let s = -3; s <= 3; s++) {
                const stripeGeo = new THREE.PlaneGeometry(0.3, roadWidth * 0.8);
                const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
                const stripe = new THREE.Mesh(stripeGeo, stripeMat);
                stripe.rotation.x = -Math.PI / 2;
                stripe.rotation.z = rot;
                const offset = rot === 0 ? 0.9 : 0;
                const offsetZ = rot === Math.PI / 2 ? 0.9 : 0;
                stripe.position.set(
                    x + Math.cos(rot + Math.PI / 2) * (roadWidth / 2 + 0.5) + s * 0.35 * Math.cos(rot),
                    h * 0.15 + 0.05,
                    z + Math.sin(rot + Math.PI / 2) * (roadWidth / 2 + 0.5) + s * 0.35 * Math.sin(rot)
                );
                this.group.add(stripe);
            }
        }
    }

    // ==========================================
    // TRAFFIC LIGHT
    // ==========================================
    createTrafficLight(x, z, h, roadWidth) {
        const group = new THREE.Group();

        // Pole
        const poleGeo = new THREE.CylinderGeometry(0.05, 0.06, 3.2, 6);
        const poleMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.6;
        group.add(pole);

        // Light box
        const boxGeo = new THREE.BoxGeometry(0.3, 0.8, 0.3);
        const boxMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.y = 3.4;
        group.add(box);

        // Light bulbs
        const colors = [0xff0000, 0xffaa00, 0x00ff00];
        const bulbPositions = [3.6, 3.4, 3.2];
        const bulbs = [];

        for (let i = 0; i < 3; i++) {
            const bulbGeo = new THREE.SphereGeometry(0.08, 8, 6);
            const bulbMat = new THREE.MeshBasicMaterial({
                color: i === 0 ? 0xff0000 : 0x333333,
                transparent: true,
                opacity: i === 0 ? 1.0 : 0.3
            });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(0.16, bulbPositions[i], 0);
            group.add(bulb);
            bulbs.push(bulb);
        }

        // Point light for the active bulb
        const tLight = new THREE.PointLight(0xff0000, 0.5, 5, 2);
        tLight.position.set(0.3, 3.6, 0);
        group.add(tLight);

        group.position.set(x + roadWidth / 2 + 0.8, h * 0.15, z + roadWidth / 2 + 0.8);

        this.group.add(group);

        this.trafficLights.push({
            group,
            bulbs,
            pointLight: tLight,
            phase: Math.random() * 20,
            colors
        });
    }

    // ==========================================
    // STREET LIGHT
    // ==========================================
    createStreetLight(x, h, z, terrain) {
        const actualH = terrain.getHeight(x, z);
        const baseY = actualH * 0.15;

        const group = new THREE.Group();

        // Pole
        const poleGeo = new THREE.CylinderGeometry(0.04, 0.06, 4.0, 6);
        const poleMat = new THREE.MeshPhongMaterial({ color: 0x555555 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 2.0;
        group.add(pole);

        // Arm
        const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4);
        const arm = new THREE.Mesh(armGeo, poleMat);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(0.6, 3.9, 0);
        group.add(arm);

        // Lamp head
        const lampGeo = new THREE.BoxGeometry(0.4, 0.1, 0.25);
        const lampMat = new THREE.MeshBasicMaterial({
            color: 0xffeecc,
            transparent: true,
            opacity: 0.3
        });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(0.6, 3.85, 0);
        group.add(lamp);

        // Point light
        const sLight = new THREE.PointLight(0xffddaa, 0, 12, 2);
        sLight.position.set(0.6, 3.7, 0);
        group.add(sLight);

        group.position.set(x, baseY, z);
        this.group.add(group);

        this.streetLightLamps.push({ group, lamp, pointLight: sLight, lampMat });
    }

    // ==========================================
    // CITY BLOCK BUILDINGS (skyscrapers etc.)
    // ==========================================
    generateBlock(x1, z1, x2, z2, baseH, heightFactor, terrain) {
        const blockW = x2 - x1;
        const blockD = z2 - z1;
        const cx = (x1 + x2) / 2;
        const cz = (z1 + z2) / 2;

        // Number of buildings in this block
        const noiseVal = this.noise.noise2D(cx * 0.1, cz * 0.1);
        const numBuildings = 1 + Math.floor(Math.abs(noiseVal) * 3);

        for (let i = 0; i < numBuildings; i++) {
            const bw = 2 + Math.random() * Math.min(blockW * 0.4, 4);
            const bd = 2 + Math.random() * Math.min(blockD * 0.4, 4);

            // Random position within block
            const bx = x1 + 0.5 + Math.random() * (blockW - bw - 1);
            const bz = z1 + 0.5 + Math.random() * (blockD - bd - 1);
            const bh = terrain.getHeight(bx, bz);

            if (bh < terrain.waterLevel + 0.3) continue;

            // Height based on distance from center + noise
            const hNoise = this.noise.noise2D(bx * 0.15, bz * 0.15);
            const maxH = 4 + heightFactor * 18 + hNoise * 6;
            const height = Math.max(4, 3 + Math.random() * maxH);

            this.createSkyscraper(bx, bh, bz, bw, height, bd);
        }
    }

    createSkyscraper(x, baseH, z, width, height, depth) {
        const group = new THREE.Group();

        // Choose building type based on height
        const isTall = height > 12;
        const isMedium = height > 6;

        // Building body
        const hNoise = this.noise.noise2D(x * 0.2, z * 0.2);

        // Glass/steel colors for tall, concrete for medium, brick for short
        let wallColor;
        if (isTall) {
            const glassTint = Math.random();
            if (glassTint < 0.33) wallColor = new THREE.Color(0.4, 0.55, 0.65); // Blue glass
            else if (glassTint < 0.66) wallColor = new THREE.Color(0.5, 0.5, 0.48); // Silver
            else wallColor = new THREE.Color(0.35, 0.4, 0.45); // Dark glass
        } else if (isMedium) {
            const concrete = Math.random();
            if (concrete < 0.5) wallColor = new THREE.Color(0.7, 0.68, 0.65);
            else wallColor = new THREE.Color(0.6, 0.58, 0.55);
        } else {
            wallColor = new THREE.Color(0.65 + hNoise * 0.1, 0.6 + hNoise * 0.05, 0.55);
        }

        // Main structure
        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMat = new THREE.MeshPhongMaterial({
            color: wallColor,
            flatShading: !isTall,
            shininess: isTall ? 80 : 10,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = height / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Window grid (emissive for night)
        const windowRows = Math.floor(height / 0.8);
        const windowColsW = Math.floor(width / 0.8);
        const windowColsD = Math.floor(depth / 0.8);

        const windowMat = new THREE.MeshPhongMaterial({
            color: isTall ? 0x88bbdd : 0x87ceeb,
            emissive: 0xffdd88,
            emissiveIntensity: 0.0,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });

        const windowMeshes = [];

        // Front & back
        for (let row = 0; row < windowRows; row++) {
            const wy = 0.5 + row * 0.8;
            if (wy > height - 0.5) break;
            // Skip some windows randomly
            if (Math.random() < 0.1) continue;

            for (let col = 0; col < windowColsW; col++) {
                const wx = -width / 2 + 0.5 + col * (width / windowColsW);
                if (Math.random() < 0.15) continue;

                const wGeo = new THREE.PlaneGeometry(0.35, 0.5);
                const wMat = windowMat.clone();
                const w1 = new THREE.Mesh(wGeo, wMat);
                w1.position.set(wx, wy, depth / 2 + 0.01);
                group.add(w1);
                windowMeshes.push(w1);

                const w2 = new THREE.Mesh(wGeo, wMat.clone());
                w2.position.set(wx, wy, -depth / 2 - 0.01);
                w2.rotation.y = Math.PI;
                group.add(w2);
                windowMeshes.push(w2);
            }
        }

        // Left & right
        for (let row = 0; row < windowRows; row++) {
            const wy = 0.5 + row * 0.8;
            if (wy > height - 0.5) break;
            if (Math.random() < 0.1) continue;

            for (let col = 0; col < windowColsD; col++) {
                const wz = -depth / 2 + 0.5 + col * (depth / windowColsD);
                if (Math.random() < 0.15) continue;

                const wGeo = new THREE.PlaneGeometry(0.35, 0.5);
                const wMat = windowMat.clone();
                const w3 = new THREE.Mesh(wGeo, wMat);
                w3.rotation.y = Math.PI / 2;
                w3.position.set(width / 2 + 0.01, wy, wz);
                group.add(w3);
                windowMeshes.push(w3);

                const w4 = new THREE.Mesh(wGeo, wMat.clone());
                w4.rotation.y = -Math.PI / 2;
                w4.position.set(-width / 2 - 0.01, wy, wz);
                group.add(w4);
                windowMeshes.push(w4);
            }
        }

        group.userData.windowMeshes = windowMeshes;

        // Roof details
        if (isTall) {
            // Antenna / spire
            const antennaGeo = new THREE.CylinderGeometry(0.03, 0.05, 2, 4);
            const antennaMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            const antenna = new THREE.Mesh(antennaGeo, antennaMat);
            antenna.position.y = height + 1;
            group.add(antenna);

            // Red blinking light on top
            const topLight = new THREE.PointLight(0xff0000, 0, 8, 2);
            topLight.position.y = height + 2;
            group.add(topLight);
            group.userData.topLight = topLight;

            // AC units on roof
            for (let a = 0; a < 2; a++) {
                const acGeo = new THREE.BoxGeometry(0.5, 0.3, 0.4);
                const acMat = new THREE.MeshPhongMaterial({ color: 0x777777 });
                const ac = new THREE.Mesh(acGeo, acMat);
                ac.position.set((Math.random() - 0.5) * width * 0.6, height + 0.15, (Math.random() - 0.5) * depth * 0.6);
                group.add(ac);
            }
        } else {
            // Flat roof edge
            const edgeGeo = new THREE.BoxGeometry(width + 0.1, 0.15, depth + 0.1);
            const edgeMat = new THREE.MeshPhongMaterial({ color: wallColor.clone().multiplyScalar(0.8) });
            const edge = new THREE.Mesh(edgeGeo, edgeMat);
            edge.position.y = height + 0.075;
            group.add(edge);
        }

        // Interior light
        const interiorLight = new THREE.PointLight(0xffcc66, 0, height * 1.5, 2);
        interiorLight.position.set(0, height * 0.5, 0);
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;

        // Position
        const baseY = baseH * 0.15;
        group.position.set(x, baseY, z);

        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // ISLAND BUILDING (coastal town)
    // ==========================================
    createIslandBuilding(x, h, z, terrain) {
        const n = this.noise.noise2D(x * 0.3, z * 0.3);
        const width = 1.5 + Math.random() * 2;
        const depth = 1.5 + Math.random() * 2;
        const height = 2 + Math.random() * 3 + n;

        const group = new THREE.Group();

        // Coastal colors
        const colors = [
            [0.9, 0.85, 0.75], // White
            [0.75, 0.85, 0.9], // Light blue
            [0.85, 0.82, 0.7], // Cream
            [0.7, 0.8, 0.72], // Seafoam
            [0.9, 0.78, 0.7], // Salmon
        ];
        const wallCol = colors[Math.floor(Math.random() * colors.length)];

        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...wallCol),
            flatShading: true
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = height / 2;
        body.castShadow = true;
        group.add(body);

        // Roof
        const roofH = Math.max(width, depth) * 0.5;
        const roofGeo = new THREE.ConeGeometry(Math.max(width, depth) * 0.72, roofH, 4);
        const roofMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.6, 0.3, 0.2),
            flatShading: true
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        // Windows
        const windowMat = new THREE.MeshPhongMaterial({
            color: 0x87ceeb,
            emissive: 0xffcc44,
            emissiveIntensity: 0.0,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });
        const windowMeshes = [];
        for (let row = 0; row < 2; row++) {
            const wy = 0.7 + row * 0.9;
            if (wy > height - 0.5) break;
            const wGeo = new THREE.PlaneGeometry(0.35, 0.4);
            const w1 = new THREE.Mesh(wGeo, windowMat.clone());
            w1.position.set(-width * 0.25, wy, depth / 2 + 0.01);
            group.add(w1);
            windowMeshes.push(w1);
            const w2 = new THREE.Mesh(wGeo, windowMat.clone());
            w2.position.set(width * 0.25, wy, depth / 2 + 0.01);
            group.add(w2);
            windowMeshes.push(w2);
        }
        group.userData.windowMeshes = windowMeshes;

        const interiorLight = new THREE.PointLight(0xffcc66, 0, 8, 2);
        interiorLight.position.set(0, height * 0.5, 0);
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;

        group.position.set(x, h * 0.15, z);
        group.rotation.y = this.noise.noise2D(x * 0.15, z * 0.15) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // HARBOR
    // ==========================================
    createHarbor(terrain) {
        // Find a good harbor spot (water edge)
        let bestAngle = 0, bestH = -Infinity;
        for (let a = 0; a < Math.PI * 2; a += 0.3) {
            const r = terrain.size * 0.28;
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            const h = terrain.getHeight(x, z);
            if (h > terrain.waterLevel && h > bestH && h < terrain.waterLevel + 2) {
                bestH = h;
                bestAngle = a;
            }
        }

        const hx = Math.cos(bestAngle) * terrain.size * 0.3;
        const hz = Math.sin(bestAngle) * terrain.size * 0.3;

        // Dock planks
        const dockLen = 8;
        const dockDir = new THREE.Vector3(Math.cos(bestAngle), 0, Math.sin(bestAngle));
        for (let i = 0; i < dockLen; i++) {
            const plankGeo = new THREE.BoxGeometry(2.5, 0.1, 0.8);
            const plankMat = new THREE.MeshPhongMaterial({ color: 0x6b4c2a });
            const plank = new THREE.Mesh(plankGeo, plankMat);
            plank.position.set(
                hx + dockDir.x * i - dockDir.z * 0,
                terrain.waterLevel + 0.15,
                hz + dockDir.z * i
            );
            plank.rotation.y = bestAngle;
            this.group.add(plank);
        }

        // Dock posts
        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < dockLen; i += 2) {
                const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.5, 6);
                const postMat = new THREE.MeshPhongMaterial({ color: 0x4a3520 });
                const post = new THREE.Mesh(postGeo, postMat);
                post.position.set(
                    hx + dockDir.x * i + dockDir.z * side * 1.2,
                    terrain.waterLevel - 0.3,
                    hz + dockDir.z * i - dockDir.x * side * 1.2
                );
                this.group.add(post);
            }
        }
    }

    // ==========================================
    // LIGHTHOUSE
    // ==========================================
    createLighthouse(terrain) {
        // Place lighthouse on a coastal high point
        let bestAngle = Math.PI * 0.75, bestH = -Infinity;
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const r = terrain.size * 0.25;
            const x = Math.cos(a) * r;
            const z = Math.sin(a) * r;
            const h = terrain.getHeight(x, z);
            if (h > terrain.waterLevel + 1 && h > bestH && h < 5) {
                bestH = h;
                bestAngle = a;
            }
        }

        const lx = Math.cos(bestAngle) * terrain.size * 0.28;
        const lz = Math.sin(bestAngle) * terrain.size * 0.28;
        const lh = terrain.getHeight(lx, lz);

        const group = new THREE.Group();

        // Tapered tower
        const towerGeo = new THREE.CylinderGeometry(0.4, 0.7, 6, 8);
        const towerMat = new THREE.MeshPhongMaterial({
            color: 0xffffff,
            flatShading: true
        });
        const tower = new THREE.Mesh(towerGeo, towerMat);
        tower.position.y = 3;
        tower.castShadow = true;
        group.add(tower);

        // Red stripes
        for (let s = 0; s < 3; s++) {
            const stripeGeo = new THREE.CylinderGeometry(0.6 - s * 0.07, 0.65 - s * 0.07, 1.0, 8);
            const stripeMat = new THREE.MeshPhongMaterial({ color: 0xcc2222 });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.y = 1 + s * 2;
            group.add(stripe);
        }

        // Lantern room
        const lanternGeo = new THREE.CylinderGeometry(0.55, 0.5, 0.8, 8);
        const lanternMat = new THREE.MeshPhongMaterial({
            color: 0xffeeaa,
            emissive: 0xffcc44,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 0.8
        });
        const lantern = new THREE.Mesh(lanternGeo, lanternMat);
        lantern.position.y = 6.4;
        group.add(lantern);

        // Dome
        const domeGeo = new THREE.ConeGeometry(0.55, 0.5, 8);
        const domeMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
        const dome = new THREE.Mesh(domeGeo, domeMat);
        dome.position.y = 7.05;
        group.add(dome);

        // Lighthouse beam light
        const beamLight = new THREE.SpotLight(0xffffcc, 2, 60, Math.PI / 6, 0.5, 1);
        beamLight.position.y = 6.4;
        beamLight.target.position.set(lx + 20, lh * 0.15 + 3, lz);
        group.add(beamLight);
        group.add(beamLight.target);
        group.userData.beamLight = beamLight;

        group.position.set(lx, lh * 0.15, lz);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // BOATS
    // ==========================================
    createBoats(terrain) {
        const boatCount = 5 + Math.floor(Math.random() * 4);
        for (let i = 0; i < boatCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = terrain.size * 0.15 + Math.random() * terrain.size * 0.2;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            // Only on water
            if (terrain.getHeight(x, z) > terrain.waterLevel - 0.5) continue;

            const group = new THREE.Group();

            // Hull
            const hullGeo = new THREE.BoxGeometry(1.5, 0.4, 0.6);
            const hullMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color().setHSL(Math.random(), 0.5, 0.4),
                flatShading: true
            });
            const hull = new THREE.Mesh(hullGeo, hullMat);
            hull.position.y = 0.1;
            group.add(hull);

            // Bow (tapered front)
            const bowGeo = new THREE.ConeGeometry(0.3, 0.6, 4);
            const bowMat = new THREE.MeshPhongMaterial({ color: hullMat.color, flatShading: true });
            const bow = new THREE.Mesh(bowGeo, bowMat);
            bow.rotation.z = Math.PI / 2;
            bow.rotation.y = Math.PI / 4;
            bow.position.set(0.9, 0.1, 0);
            group.add(bow);

            // Cabin
            const cabinGeo = new THREE.BoxGeometry(0.5, 0.35, 0.45);
            const cabinMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee });
            const cabin = new THREE.Mesh(cabinGeo, cabinMat);
            cabin.position.set(-0.2, 0.35, 0);
            group.add(cabin);

            group.position.set(x, terrain.waterLevel - 0.05, z);
            group.rotation.y = angle + Math.PI + Math.random() * 0.5;
            group.userData.bobOffset = Math.random() * Math.PI * 2;
            group.userData.isBoat = true;
            this.group.add(group);
            this.vehicles.push(group); // Reuse vehicles array for animation
        }
    }

    // ==========================================
    // VEHICLES
    // ==========================================
    generateVehicles(terrain, roadPositions, halfSize) {
        const vehicleCount = 12 + Math.floor(Math.random() * 8);

        for (let i = 0; i < vehicleCount; i++) {
            // Pick a random road
            const isHorizontal = Math.random() < 0.5;
            const roadIndex = Math.floor(Math.random() * roadPositions.length);
            const roadPos = roadPositions[roadIndex];

            const color = VEHICLE_COLORS[Math.floor(Math.random() * VEHICLE_COLORS.length)];

            // Random position along road
            const t = -halfSize + Math.random() * halfSize * 2;
            const lane = (Math.random() < 0.5 ? -1 : 1) * 0.5;

            const isLarge = Math.random() < 0.2; // 20% chance of bus/truck

            const group = new THREE.Group();

            if (isLarge) {
                // Bus
                const bodyGeo = new THREE.BoxGeometry(2.5, 0.9, 0.9);
                const bodyMat = new THREE.MeshPhongMaterial({ color, flatShading: true });
                const body = new THREE.Mesh(bodyGeo, bodyMat);
                body.position.y = 0.55;
                body.castShadow = true;
                group.add(body);

                // Windows
                for (let w = 0; w < 5; w++) {
                    const wGeo = new THREE.PlaneGeometry(0.3, 0.3);
                    const wMat = new THREE.MeshPhongMaterial({ color: 0x88bbee, transparent: true, opacity: 0.7, side: THREE.DoubleSide });
                    const win = new THREE.Mesh(wGeo, wMat);
                    win.position.set(-1.0 + w * 0.5, 0.7, 0.46);
                    group.add(win);
                }
            } else {
                // Car
                const bodyGeo = new THREE.BoxGeometry(1.2, 0.45, 0.7);
                const bodyMat = new THREE.MeshPhongMaterial({ color, flatShading: true });
                const body = new THREE.Mesh(bodyGeo, bodyMat);
                body.position.y = 0.35;
                body.castShadow = true;
                group.add(body);

                // Cabin
                const cabinGeo = new THREE.BoxGeometry(0.6, 0.35, 0.6);
                const cabinMat = new THREE.MeshPhongMaterial({ color, flatShading: true });
                const cabin = new THREE.Mesh(cabinGeo, cabinMat);
                cabin.position.set(-0.05, 0.7, 0);
                group.add(cabin);

                // Windshield
                const wsGeo = new THREE.PlaneGeometry(0.55, 0.3);
                const wsMat = new THREE.MeshPhongMaterial({ color: 0x88bbee, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
                const ws = new THREE.Mesh(wsGeo, wsMat);
                ws.rotation.x = -0.2;
                ws.position.set(0.3, 0.7, 0);
                ws.rotation.y = Math.PI / 2;
                group.add(ws);
            }

            // Wheels
            for (const wx of [-0.35, 0.35]) {
                for (const wz of [-0.3, 0.3]) {
                    const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8);
                    const wheelMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
                    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                    wheel.rotation.x = Math.PI / 2;
                    wheel.position.set(wx, 0.12, wz);
                    group.add(wheel);
                }
            }

            // Headlights
            for (const hz of [-0.2, 0.2]) {
                const hlGeo = new THREE.SphereGeometry(0.06, 6, 4);
                const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
                const hl = new THREE.Mesh(hlGeo, hlMat);
                hl.position.set(0.6, 0.35, hz);
                group.add(hl);
            }

            // Tail lights
            for (const hz of [-0.2, 0.2]) {
                const tlGeo = new THREE.SphereGeometry(0.05, 6, 4);
                const tlMat = new THREE.MeshBasicMaterial({ color: 0xff2222 });
                const tl = new THREE.Mesh(tlGeo, tlMat);
                tl.position.set(-0.6, 0.35, hz);
                group.add(tl);
            }

            const h = terrain.getHeight(
                isHorizontal ? t : roadPos + lane,
                isHorizontal ? roadPos + lane : t
            );

            let x, z;
            if (isHorizontal) {
                x = t;
                z = roadPos + lane;
                group.rotation.y = lane > 0 ? 0 : Math.PI;
            } else {
                x = roadPos + lane;
                z = t;
                group.rotation.y = lane > 0 ? Math.PI / 2 : -Math.PI / 2;
            }

            group.position.set(x, Math.max(h * 0.15 + 0.02, 0.02), z);

            // Animation data
            const speed = 1.5 + Math.random() * 3;
            const direction = lane > 0 ? 1 : -1;
            group.userData = {
                isHorizontal,
                speed,
                direction,
                roadPos,
                lane,
                halfSize
            };

            this.group.add(group);
            this.vehicles.push(group);
        }
    }

    // ==========================================
    // LIGHTS CONTROL
    // ==========================================
    setLights(on) {
        this.lightsOn = on;
        const intensity = on ? 1.2 : 0;

        for (const sl of this.streetLightLamps) {
            sl.pointLight.intensity = intensity;
            sl.lampMat.opacity = on ? 0.9 : 0.3;
            sl.lampMat.color.set(on ? 0xffeecc : 0x888888);
        }

        for (const bld of this.cityBuildings) {
            const ud = bld.userData;
            if (ud.interiorLight) {
                ud.interiorLight.intensity = on ? 1.5 : 0;
            }
            if (ud.windowMeshes) {
                for (const w of ud.windowMeshes) {
                    w.material.emissiveIntensity = on ? 0.6 : 0.0;
                    w.material.color.set(on ? 0xffdd88 : 0x88bbdd);
                }
            }
        }
    }

    // ==========================================
    // UPDATE (animation)
    // ==========================================
    update(time) {
        // Animate vehicles
        for (const v of this.vehicles) {
            const ud = v.userData;

            if (ud.isBoat) {
                // Boat bobbing
                const baseY = v.position.y;
                v.position.y = baseY + Math.sin(time * 0.8 + ud.bobOffset) * 0.02;
                v.rotation.z = Math.sin(time * 0.5 + ud.bobOffset) * 0.02;
                continue;
            }

            if (!ud.isHorizontal && !ud.isHorizontal === undefined) continue;

            const moveSpeed = ud.speed * ud.direction * 0.016;

            if (ud.isHorizontal) {
                v.position.x += moveSpeed;
                if (v.position.x > ud.halfSize + 5) v.position.x = -ud.halfSize - 5;
                if (v.position.x < -ud.halfSize - 5) v.position.x = ud.halfSize + 5;
            } else {
                v.position.z += moveSpeed;
                if (v.position.z > ud.halfSize + 5) v.position.z = -ud.halfSize - 5;
                if (v.position.z < -ud.halfSize - 5) v.position.z = ud.halfSize + 5;
            }
        }

        // Animate traffic lights
        const cycleTime = 8; // seconds per full cycle
        for (const tl of this.trafficLights) {
            const phase = (time + tl.phase) % cycleTime;
            let activeIndex;

            if (phase < cycleTime * 0.45) {
                activeIndex = 2; // Green
            } else if (phase < cycleTime * 0.5) {
                activeIndex = 1; // Yellow
            } else {
                activeIndex = 0; // Red
            }

            for (let i = 0; i < tl.bulbs.length; i++) {
                const isActive = i === activeIndex;
                tl.bulbs[i].material.color.set(isActive ? tl.colors[i] : 0x333333);
                tl.bulbs[i].material.opacity = isActive ? 1.0 : 0.3;
            }

            tl.pointLight.color.set(tl.colors[activeIndex]);
            tl.pointLight.intensity = 0.8;
        }

        // Lighthouse beam rotation
        for (const bld of this.cityBuildings) {
            if (bld.userData.beamLight) {
                bld.userData.beamLight.target.position.x = Math.cos(time * 0.5) * 30;
                bld.userData.beamLight.target.position.z = Math.sin(time * 0.5) * 30;
            }
            // Skyscraper top red blink
            if (bld.userData.topLight) {
                bld.userData.topLight.intensity = Math.sin(time * 2) > 0.5 ? 1.5 : 0;
            }
        }
    }

    // ==========================================
    // CLEAR
    // ==========================================
    clear() {
        this.group.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
        this.scene.remove(this.group);

        this.group = new THREE.Group();
        this.vehicles = [];
        this.trafficLights = [];
        this.streetLightLamps = [];
        this.roads = [];
        this.intersections = [];
        this.cityBuildings = [];
        this.lightsOn = false;
    }
}

export { CitySystem };
