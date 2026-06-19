import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

// =============================================
// City System - Optimized, simplified
// =============================================

const VEHICLE_COLORS = [
    0xcc2222, 0x2255cc, 0x22cc44, 0xcccc22, 0xffffff,
    0x222222, 0xcc8822, 0x888888
];

class CitySystem {
    constructor(scene, noise) {
        this.scene = scene;
        this.noise = noise;
        this.group = new THREE.Group();
        this.vehicles = [];
        this.trafficLights = [];
        this.streetLightLamps = [];
        this.intersections = [];
        this.cityBuildings = [];
        this.lightsOn = false;
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
    // GRID CITY - simple grid roads + buildings
    // ==========================================
    generateGridCity(terrain) {
        const halfSize = terrain.size * 0.4;
        const blockSize = 10;
        const roadWidth = 2.0;

        // Road positions
        const roadPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += blockSize) {
            roadPositions.push(pos);
        }

        // Roads - simple flat planes
        const roadMat = new THREE.MeshPhongMaterial({ color: 0x333338, shininess: 5 });
        for (const pos of roadPositions) {
            // H road
            const hRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(halfSize * 2 + blockSize, roadWidth),
                roadMat
            );
            hRoad.rotation.x = -Math.PI / 2;
            hRoad.position.set(0, 0.02, pos);
            hRoad.receiveShadow = true;
            this.group.add(hRoad);

            // V road
            const vRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(halfSize * 2 + blockSize, roadWidth),
                roadMat
            );
            vRoad.rotation.x = -Math.PI / 2;
            vRoad.rotation.y = Math.PI / 2;
            vRoad.position.set(pos, 0.02, 0);
            vRoad.receiveShadow = true;
            this.group.add(vRoad);
        }

        // Intersections + traffic lights (only key ones)
        const intMat = new THREE.MeshPhongMaterial({ color: 0x333338 });
        for (let i = 0; i < roadPositions.length; i++) {
            for (let j = 0; j < roadPositions.length; j++) {
                const x = roadPositions[i], z = roadPositions[j];
                const h = terrain.getHeight(x, z);
                if (h < terrain.waterLevel + 0.3) continue;

                this.intersections.push({ x, z });

                // Traffic light only on every 2nd intersection
                if ((i + j) % 2 === 0) {
                    this.createTrafficLight(x, z, h, roadWidth);
                }
            }
        }

        // Buildings in blocks
        for (let i = 0; i < roadPositions.length - 1; i++) {
            for (let j = 0; j < roadPositions.length - 1; j++) {
                const x1 = roadPositions[i] + roadWidth / 2 + 1;
                const z1 = roadPositions[j] + roadWidth / 2 + 1;
                const x2 = roadPositions[i + 1] - roadWidth / 2 - 1;
                const z2 = roadPositions[j + 1] - roadWidth / 2 - 1;

                const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
                const h = terrain.getHeight(cx, cz);
                if (h < terrain.waterLevel + 0.3) continue;

                const distFromCenter = Math.sqrt(cx * cx + cz * cz);
                const heightFactor = Math.max(0.3, 1.0 - distFromCenter / (terrain.size * 0.5));

                this.generateBlock(x1, z1, x2, z2, h, heightFactor, terrain);
            }
        }

        // Street lights (every 8 units along roads, not too dense)
        for (const pos of roadPositions) {
            for (let t = -halfSize; t <= halfSize; t += 8) {
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

        // Vehicles (limited count)
        this.generateVehicles(terrain, roadPositions, halfSize, 8);
    }

    // ==========================================
    // ISLAND CITY - harbor town
    // ==========================================
    generateIslandCity(terrain) {
        const halfSize = terrain.size * 0.35;

        // Simple cross roads from center
        const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        const roadMat = new THREE.MeshPhongMaterial({ color: 0x333338 });
        for (const angle of angles) {
            const endR = halfSize * 0.5;
            const roadGeo = new THREE.PlaneGeometry(endR, 2.0);
            const road = new THREE.Mesh(roadGeo, roadMat);
            road.rotation.x = -Math.PI / 2;
            road.rotation.y = angle;
            road.position.set(
                Math.cos(angle) * endR * 0.5,
                0.02,
                Math.sin(angle) * endR * 0.5
            );
            this.group.add(road);
        }

        // Harbor dock
        this.createHarbor(terrain);

        // Lighthouse
        this.createLighthouse(terrain);

        // Island buildings
        for (let i = 0; i < 15; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * halfSize * 0.4;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);
            if (h < terrain.waterLevel + 0.5 || h > 4) continue;
            this.createIslandBuilding(x, h, z);
        }

        // Boats
        this.createBoats(terrain);
    }

    // ==========================================
    // COASTAL CITY - seaside town with boardwalk
    // ==========================================
    generateCoastalCity(terrain) {
        const halfSize = terrain.size * 0.35;
        const roadWidth = 2.0;

        // Find coast line direction
        // Coast runs roughly along one edge - let's find where water meets land
        // Place a boardwalk along the coast
        const boardwalkPoints = [];
        const wl = terrain.waterLevel;

        // Scan for coastline along z direction
        for (let x = -halfSize; x <= halfSize; x += 2) {
            for (let z = -halfSize; z <= halfSize; z += 1) {
                const h = terrain.getHeight(x, z);
                const hNext = terrain.getHeight(x, z + 1);
                // Coast is where land transitions to water
                if (h >= wl && h < wl + 1.5 && hNext < wl) {
                    boardwalkPoints.push({ x, z, h });
                    break;
                }
            }
        }

        // Boardwalk along coast
        const boardMat = new THREE.MeshPhongMaterial({ color: 0x8b6b3a });
        for (let i = 0; i < boardwalkPoints.length - 1; i++) {
            const p1 = boardwalkPoints[i];
            const p2 = boardwalkPoints[i + 1];
            const dx = p2.x - p1.x;
            const dz = p2.z - p1.z;
            const len = Math.sqrt(dx * dx + dz * dz);
            const boardGeo = new THREE.PlaneGeometry(len, 2.5);
            const board = new THREE.Mesh(boardGeo, boardMat);
            board.rotation.x = -Math.PI / 2;
            board.rotation.y = Math.atan2(dx, dz);
            const mx = (p1.x + p2.x) / 2;
            const mz = (p1.z + p2.z) / 2;
            const mh = (p1.h + p2.h) / 2;
            board.position.set(mx, Math.max(mh, wl) + 0.05, mz);
            board.receiveShadow = true;
            this.group.add(board);
        }

        // Boardwalk rail posts
        for (const p of boardwalkPoints) {
            for (const side of [-1.2, 1.2]) {
                const postGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.2, 6);
                const postMat = new THREE.MeshPhongMaterial({ color: 0x6b4c2a });
                const post = new THREE.Mesh(postGeo, postMat);
                post.position.set(p.x + side, Math.max(p.h, wl) + 0.6, p.z - 0.5);
                this.group.add(post);
            }
        }

        // Road grid inland from coast
        const roadPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += 10) {
            roadPositions.push(pos);
        }
        const roadMat = new THREE.MeshPhongMaterial({ color: 0x333338 });
        for (const pos of roadPositions) {
            const hRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(halfSize * 2 + 10, roadWidth),
                roadMat
            );
            hRoad.rotation.x = -Math.PI / 2;
            hRoad.position.set(0, 0.02, pos);
            this.group.add(hRoad);

            const vRoad = new THREE.Mesh(
                new THREE.PlaneGeometry(halfSize * 2 + 10, roadWidth),
                roadMat
            );
            vRoad.rotation.x = -Math.PI / 2;
            vRoad.rotation.y = Math.PI / 2;
            vRoad.position.set(pos, 0.02, 0);
            this.group.add(vRoad);
        }

        // Coastal buildings - mix of seaside styles
        for (let i = 0; i < 25; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * halfSize * 0.7;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);
            if (h < terrain.waterLevel + 0.5 || h > 3.5) continue;

            // Near coast = smaller colorful buildings, inland = taller
            const nearCoast = Math.abs(z - terrain.waterLevel) < 3;
            if (nearCoast) {
                this.createCoastalBuilding(x, h, z);
            } else {
                this.createIslandBuilding(x, h, z);
            }
        }

        // Beach umbrellas near water
        this.createBeachFurniture(terrain);

        // Boats
        this.createBoats(terrain);

        // Street lights
        for (const pos of roadPositions) {
            for (let t = -halfSize; t <= halfSize; t += 8) {
                const hV = terrain.getHeight(pos, t);
                if (hV > terrain.waterLevel + 0.3 && hV < 4) {
                    this.createStreetLight(pos, hV, t);
                }
            }
        }

        // Few vehicles
        this.generateVehicles(terrain, roadPositions, halfSize, 5);
    }

    // ==========================================
    // BLOCK - generates 1-3 buildings per block
    // ==========================================
    generateBlock(x1, z1, x2, z2, baseH, heightFactor, terrain) {
        const blockW = x2 - x1;
        const blockD = z2 - z1;
        const cx = (x1 + x2) / 2;
        const cz = (z1 + z2) / 2;

        const numBuildings = 1 + Math.floor(Math.abs(this.noise.noise2D(cx * 0.1, cz * 0.1)) * 2);

        for (let i = 0; i < numBuildings; i++) {
            const bw = 2 + Math.random() * Math.min(blockW * 0.3, 3);
            const bd = 2 + Math.random() * Math.min(blockD * 0.3, 3);
            const bx = x1 + 1 + Math.random() * (blockW - bw - 2);
            const bz = z1 + 1 + Math.random() * (blockD - bd - 2);
            const bh = terrain.getHeight(bx, bz);
            if (bh < terrain.waterLevel + 0.3) continue;

            const hNoise = this.noise.noise2D(bx * 0.15, bz * 0.15);
            const maxH = 4 + heightFactor * 16 + hNoise * 4;
            const height = Math.max(3, 2 + Math.random() * maxH);

            this.createBuilding(bx, bh, bz, bw, height, bd);
        }
    }

    // ==========================================
    // BUILDING - simplified skyscraper
    // ==========================================
    createBuilding(x, baseH, z, width, height, depth) {
        const group = new THREE.Group();
        const isTall = height > 10;
        const isMedium = height > 6;

        // Wall color
        let wallColor;
        if (isTall) {
            const t = Math.random();
            wallColor = t < 0.33 ? new THREE.Color(0.4, 0.55, 0.65)
                : t < 0.66 ? new THREE.Color(0.5, 0.5, 0.48)
                : new THREE.Color(0.35, 0.4, 0.45);
        } else if (isMedium) {
            wallColor = Math.random() < 0.5
                ? new THREE.Color(0.7, 0.68, 0.65)
                : new THREE.Color(0.6, 0.58, 0.55);
        } else {
            wallColor = new THREE.Color(0.65, 0.6, 0.55);
        }

        // Body
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

        // Simplified windows - just a few emissive planes per face
        const windowMat = new THREE.MeshPhongMaterial({
            color: isTall ? 0x88bbdd : 0x87ceeb,
            emissive: 0xffdd88,
            emissiveIntensity: 0.0,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });

        const windowMeshes = [];
        const windowRows = Math.min(Math.floor(height / 1.2), 6); // Cap at 6 rows
        const windowColsW = Math.min(Math.floor(width / 1.0), 3);
        const windowColsD = Math.min(Math.floor(depth / 1.0), 3);

        for (let row = 0; row < windowRows; row++) {
            const wy = 0.8 + row * 1.2;
            if (wy > height - 0.8) break;

            // Front + back windows
            for (let col = 0; col < windowColsW; col++) {
                const wx = -width / 2 + 0.6 + col * (width / windowColsW);
                const wGeo = new THREE.PlaneGeometry(0.4, 0.5);
                const w1 = new THREE.Mesh(wGeo, windowMat.clone());
                w1.position.set(wx, wy, depth / 2 + 0.01);
                group.add(w1);
                windowMeshes.push(w1);

                const w2 = new THREE.Mesh(wGeo, windowMat.clone());
                w2.position.set(wx, wy, -depth / 2 - 0.01);
                w2.rotation.y = Math.PI;
                group.add(w2);
                windowMeshes.push(w2);
            }

            // Side windows
            for (let col = 0; col < windowColsD; col++) {
                const wz = -depth / 2 + 0.6 + col * (depth / windowColsD);
                const wGeo = new THREE.PlaneGeometry(0.4, 0.5);
                const w3 = new THREE.Mesh(wGeo, windowMat.clone());
                w3.rotation.y = Math.PI / 2;
                w3.position.set(width / 2 + 0.01, wy, wz);
                group.add(w3);
                windowMeshes.push(w3);

                const w4 = new THREE.Mesh(wGeo, windowMat.clone());
                w4.rotation.y = -Math.PI / 2;
                w4.position.set(-width / 2 - 0.01, wy, wz);
                group.add(w4);
                windowMeshes.push(w4);
            }
        }
        group.userData.windowMeshes = windowMeshes;

        // Roof details
        if (isTall) {
            // Simple antenna
            const antennaGeo = new THREE.CylinderGeometry(0.03, 0.05, 2, 4);
            const antenna = new THREE.Mesh(antennaGeo, new THREE.MeshPhongMaterial({ color: 0x888888 }));
            antenna.position.y = height + 1;
            group.add(antenna);

            // Red blink light
            const topLight = new THREE.PointLight(0xff0000, 0, 8, 2);
            topLight.position.y = height + 2;
            group.add(topLight);
            group.userData.topLight = topLight;
        } else {
            // Roof edge
            const edgeGeo = new THREE.BoxGeometry(width + 0.1, 0.15, depth + 0.1);
            const edge = new THREE.Mesh(edgeGeo, new THREE.MeshPhongMaterial({
                color: wallColor.clone().multiplyScalar(0.8)
            }));
            edge.position.y = height + 0.075;
            group.add(edge);
        }

        // Interior light (only 1 per building)
        const interiorLight = new THREE.PointLight(0xffcc66, 0, height, 2);
        interiorLight.position.set(0, height * 0.5, 0);
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;

        group.position.set(x, Math.max(baseH * 0.15, 0), z);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // ISLAND BUILDING - coastal town house
    // ==========================================
    createIslandBuilding(x, h, z) {
        const group = new THREE.Group();
        const n = this.noise.noise2D(x * 0.3, z * 0.3);
        const width = 1.5 + Math.random() * 2;
        const depth = 1.5 + Math.random() * 2;
        const height = 2 + Math.random() * 2.5 + n;

        // Coastal colors
        const colors = [
            [0.9, 0.85, 0.75], [0.75, 0.85, 0.9], [0.85, 0.82, 0.7],
            [0.7, 0.8, 0.72], [0.9, 0.78, 0.7]
        ];
        const wallCol = colors[Math.floor(Math.random() * colors.length)];

        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const body = new THREE.Mesh(bodyGeo, new THREE.MeshPhongMaterial({
            color: new THREE.Color(...wallCol), flatShading: true
        }));
        body.position.y = height / 2;
        body.castShadow = true;
        group.add(body);

        // Roof
        const roofH = Math.max(width, depth) * 0.5;
        const roofGeo = new THREE.ConeGeometry(Math.max(width, depth) * 0.72, roofH, 4);
        const roof = new THREE.Mesh(roofGeo, new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.6, 0.3, 0.2), flatShading: true
        }));
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        // 2 windows
        const windowMat = new THREE.MeshPhongMaterial({
            color: 0x87ceeb, emissive: 0xffcc44, emissiveIntensity: 0.0,
            transparent: true, opacity: 0.7, side: THREE.DoubleSide
        });
        const windowMeshes = [];
        const wGeo = new THREE.PlaneGeometry(0.35, 0.4);
        const w1 = new THREE.Mesh(wGeo, windowMat.clone());
        w1.position.set(-width * 0.25, 0.8, depth / 2 + 0.01);
        group.add(w1);
        windowMeshes.push(w1);
        const w2 = new THREE.Mesh(wGeo, windowMat.clone());
        w2.position.set(width * 0.25, 0.8, depth / 2 + 0.01);
        group.add(w2);
        windowMeshes.push(w2);
        group.userData.windowMeshes = windowMeshes;

        // Interior light
        const il = new THREE.PointLight(0xffcc66, 0, 8, 2);
        il.position.set(0, height * 0.5, 0);
        group.add(il);
        group.userData.interiorLight = il;

        group.position.set(x, Math.max(h * 0.15, 0), z);
        group.rotation.y = this.noise.noise2D(x * 0.15, z * 0.15) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // COASTAL BUILDING - seaside villa / beach house
    // ==========================================
    createCoastalBuilding(x, h, z) {
        const group = new THREE.Group();
        const width = 2 + Math.random() * 2;
        const depth = 2 + Math.random() * 1.5;
        const height = 2.5 + Math.random() * 2;

        // Bright seaside colors
        const colors = [
            [0.95, 0.92, 0.88], [0.7, 0.88, 0.92], [0.92, 0.88, 0.78],
            [0.88, 0.72, 0.65], [0.65, 0.85, 0.78]
        ];
        const wallCol = colors[Math.floor(Math.random() * colors.length)];

        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const body = new THREE.Mesh(bodyGeo, new THREE.MeshPhongMaterial({
            color: new THREE.Color(...wallCol), flatShading: true
        }));
        body.position.y = height / 2;
        body.castShadow = true;
        group.add(body);

        // Flat or slight pitch roof
        const roofGeo = new THREE.BoxGeometry(width + 0.3, 0.15, depth + 0.3);
        const roof = new THREE.Mesh(roofGeo, new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.35, 0.3, 0.28), flatShading: true
        }));
        roof.position.y = height + 0.075;
        group.add(roof);

        // Balcony railing (front)
        const railGeo = new THREE.BoxGeometry(width, 0.05, 0.05);
        const railMat = new THREE.MeshPhongMaterial({ color: 0xdddddd });
        const rail = new THREE.Mesh(railGeo, railMat);
        rail.position.set(0, height * 0.45, depth / 2 + 0.3);
        group.add(rail);

        // 2 front windows
        const windowMat = new THREE.MeshPhongMaterial({
            color: 0x88ccdd, emissive: 0xffcc44, emissiveIntensity: 0.0,
            transparent: true, opacity: 0.7, side: THREE.DoubleSide
        });
        const windowMeshes = [];
        const wGeo = new THREE.PlaneGeometry(0.5, 0.5);
        const w1 = new THREE.Mesh(wGeo, windowMat.clone());
        w1.position.set(-width * 0.3, height * 0.4, depth / 2 + 0.01);
        group.add(w1);
        windowMeshes.push(w1);
        const w2 = new THREE.Mesh(wGeo, windowMat.clone());
        w2.position.set(width * 0.3, height * 0.4, depth / 2 + 0.01);
        group.add(w2);
        windowMeshes.push(w2);
        group.userData.windowMeshes = windowMeshes;

        // Interior light
        const il = new THREE.PointLight(0xffcc66, 0, 8, 2);
        il.position.set(0, height * 0.5, 0);
        group.add(il);
        group.userData.interiorLight = il;

        group.position.set(x, Math.max(h * 0.15, 0), z);
        group.rotation.y = this.noise.noise2D(x * 0.2, z * 0.2) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // BEACH FURNITURE - umbrellas, chairs
    // ==========================================
    createBeachFurniture(terrain) {
        const wl = terrain.waterLevel;
        // Place a few umbrellas near coast
        for (let i = 0; i < 8; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = terrain.size * 0.2 + Math.random() * terrain.size * 0.15;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);

            // Must be on sand near water
            if (h < wl - 0.2 || h > wl + 1.0) continue;

            const group = new THREE.Group();

            // Umbrella pole
            const poleGeo = new THREE.CylinderGeometry(0.03, 0.04, 2.0, 5);
            const poleMat = new THREE.MeshPhongMaterial({ color: 0xcccccc });
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.y = 1.0;
            group.add(pole);

            // Umbrella canopy
            const umbrellaColors = [0xff4444, 0x4488ff, 0xffcc22, 0x44cc44, 0xff88cc];
            const umbrellaGeo = new THREE.ConeGeometry(1.2, 0.4, 8);
            const umbrella = new THREE.Mesh(umbrellaGeo, new THREE.MeshPhongMaterial({
                color: umbrellaColors[Math.floor(Math.random() * umbrellaColors.length)],
                flatShading: true
            }));
            umbrella.position.y = 2.0;
            group.add(umbrella);

            // Beach towel
            const towelGeo = new THREE.PlaneGeometry(1.0, 0.6);
            const towelColors = [0xff6666, 0x6688ff, 0xffaa44, 0x44cc88];
            const towel = new THREE.Mesh(towelGeo, new THREE.MeshPhongMaterial({
                color: towelColors[Math.floor(Math.random() * towelColors.length)]
            }));
            towel.rotation.x = -Math.PI / 2;
            towel.position.set(0.5, Math.max(h, wl) + 0.01, 0.3);
            group.add(towel);

            group.position.set(x, Math.max(h, wl) + 0.02, z);
            this.group.add(group);
        }
    }

    // ==========================================
    // TRAFFIC LIGHT - simplified
    // ==========================================
    createTrafficLight(x, z, h, roadWidth) {
        const group = new THREE.Group();

        const poleGeo = new THREE.CylinderGeometry(0.05, 0.06, 3, 6);
        const pole = new THREE.Mesh(poleGeo, new THREE.MeshPhongMaterial({ color: 0x444444 }));
        pole.position.y = 1.5;
        group.add(pole);

        const boxGeo = new THREE.BoxGeometry(0.25, 0.6, 0.25);
        const box = new THREE.Mesh(boxGeo, new THREE.MeshPhongMaterial({ color: 0x222222 }));
        box.position.y = 3.2;
        group.add(box);

        const colors = [0xff0000, 0xffaa00, 0x00ff00];
        const bulbs = [];
        for (let i = 0; i < 3; i++) {
            const bulbGeo = new THREE.SphereGeometry(0.07, 6, 4);
            const bulbMat = new THREE.MeshBasicMaterial({
                color: i === 0 ? 0xff0000 : 0x333333,
                transparent: true, opacity: i === 0 ? 1.0 : 0.3
            });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(0.14, 3.4 - i * 0.2, 0);
            group.add(bulb);
            bulbs.push(bulb);
        }

        const tLight = new THREE.PointLight(0xff0000, 0.3, 5, 2);
        tLight.position.set(0.3, 3.4, 0);
        group.add(tLight);

        group.position.set(x + roadWidth / 2 + 0.6, Math.max(h * 0.15, 0), z + roadWidth / 2 + 0.6);
        this.group.add(group);
        this.trafficLights.push({ group, bulbs, pointLight: tLight, phase: Math.random() * 20, colors });
    }

    // ==========================================
    // STREET LIGHT - simplified
    // ==========================================
    createStreetLight(x, h, z) {
        const group = new THREE.Group();

        const poleGeo = new THREE.CylinderGeometry(0.04, 0.05, 3.5, 5);
        const pole = new THREE.Mesh(poleGeo, new THREE.MeshPhongMaterial({ color: 0x555555 }));
        pole.position.y = 1.75;
        group.add(pole);

        // Simple lamp head
        const lampGeo = new THREE.SphereGeometry(0.15, 6, 4);
        const lampMat = new THREE.MeshBasicMaterial({
            color: 0xffeecc, transparent: true, opacity: 0.3
        });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.y = 3.5;
        group.add(lamp);

        const sLight = new THREE.PointLight(0xffddaa, 0, 10, 2);
        sLight.position.y = 3.5;
        group.add(sLight);

        group.position.set(x, Math.max(h * 0.15, 0), z);
        this.group.add(group);
        this.streetLightLamps.push({ group, lamp, pointLight: sLight, lampMat });
    }

    // ==========================================
    // HARBOR - simple dock
    // ==========================================
    createHarbor(terrain) {
        let bestAngle = 0, bestH = -Infinity;
        for (let a = 0; a < Math.PI * 2; a += 0.3) {
            const r = terrain.size * 0.28;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
            const h = terrain.getHeight(x, z);
            if (h > terrain.waterLevel && h > bestH && h < terrain.waterLevel + 2) {
                bestH = h;
                bestAngle = a;
            }
        }

        const hx = Math.cos(bestAngle) * terrain.size * 0.3;
        const hz = Math.sin(bestAngle) * terrain.size * 0.3;
        const dockDir = new THREE.Vector3(Math.cos(bestAngle), 0, Math.sin(bestAngle));

        // Simple dock - just a few planks
        for (let i = 0; i < 5; i++) {
            const plankGeo = new THREE.BoxGeometry(2.0, 0.1, 0.8);
            const plank = new THREE.Mesh(plankGeo, new THREE.MeshPhongMaterial({ color: 0x6b4c2a }));
            plank.position.set(
                hx + dockDir.x * i,
                terrain.waterLevel + 0.15,
                hz + dockDir.z * i
            );
            plank.rotation.y = bestAngle;
            this.group.add(plank);
        }

        // Dock posts
        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < 5; i += 2) {
                const postGeo = new THREE.CylinderGeometry(0.08, 0.1, 1.5, 5);
                const post = new THREE.Mesh(postGeo, new THREE.MeshPhongMaterial({ color: 0x4a3520 }));
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
            const r = terrain.size * 0.25;
            const x = Math.cos(a) * r, z = Math.sin(a) * r;
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

        // Tower
        const towerGeo = new THREE.CylinderGeometry(0.4, 0.7, 5, 8);
        const tower = new THREE.Mesh(towerGeo, new THREE.MeshPhongMaterial({
            color: 0xffffff, flatShading: true
        }));
        tower.position.y = 2.5;
        tower.castShadow = true;
        group.add(tower);

        // Red stripe
        const stripeGeo = new THREE.CylinderGeometry(0.65, 0.68, 1.0, 8);
        const stripe = new THREE.Mesh(stripeGeo, new THREE.MeshPhongMaterial({ color: 0xcc2222 }));
        stripe.position.y = 2;
        group.add(stripe);

        // Lantern
        const lanternGeo = new THREE.CylinderGeometry(0.5, 0.45, 0.6, 8);
        const lantern = new THREE.Mesh(lanternGeo, new THREE.MeshPhongMaterial({
            color: 0xffeeaa, emissive: 0xffcc44, emissiveIntensity: 0.5,
            transparent: true, opacity: 0.8
        }));
        lantern.position.y = 5.5;
        group.add(lantern);

        // Dome
        const domeGeo = new THREE.ConeGeometry(0.5, 0.4, 8);
        group.add(new THREE.Mesh(domeGeo, new THREE.MeshPhongMaterial({ color: 0x222222 })));
        group.children[group.children.length - 1].position.y = 5.9;

        // Beam
        const beamLight = new THREE.SpotLight(0xffffcc, 1.5, 50, Math.PI / 6, 0.5, 1);
        beamLight.position.y = 5.5;
        beamLight.target.position.set(lx + 20, lh * 0.15 + 3, lz);
        group.add(beamLight);
        group.add(beamLight.target);
        group.userData.beamLight = beamLight;

        group.position.set(lx, Math.max(lh * 0.15, 0), lz);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // BOATS - simplified
    // ==========================================
    createBoats(terrain) {
        const boatCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < boatCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = terrain.size * 0.15 + Math.random() * terrain.size * 0.2;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            if (terrain.getHeight(x, z) > terrain.waterLevel - 0.5) continue;

            const group = new THREE.Group();

            // Simple hull
            const hullGeo = new THREE.BoxGeometry(1.5, 0.3, 0.5);
            const hull = new THREE.Mesh(hullGeo, new THREE.MeshPhongMaterial({
                color: new THREE.Color().setHSL(Math.random(), 0.5, 0.4), flatShading: true
            }));
            hull.position.y = 0.1;
            group.add(hull);

            // Small cabin
            const cabinGeo = new THREE.BoxGeometry(0.4, 0.3, 0.35);
            const cabin = new THREE.Mesh(cabinGeo, new THREE.MeshPhongMaterial({ color: 0xeeeeee }));
            cabin.position.set(-0.2, 0.3, 0);
            group.add(cabin);

            group.position.set(x, terrain.waterLevel - 0.05, z);
            group.rotation.y = angle + Math.PI + Math.random() * 0.5;
            group.userData.bobOffset = Math.random() * Math.PI * 2;
            group.userData.isBoat = true;
            this.group.add(group);
            this.vehicles.push(group);
        }
    }

    // ==========================================
    // VEHICLES - simplified, limited count
    // ==========================================
    generateVehicles(terrain, roadPositions, halfSize, count) {
        const vehicleCount = count + Math.floor(Math.random() * 3);

        for (let i = 0; i < vehicleCount; i++) {
            const isHorizontal = Math.random() < 0.5;
            const roadIndex = Math.floor(Math.random() * roadPositions.length);
            const roadPos = roadPositions[roadIndex];
            const color = VEHICLE_COLORS[Math.floor(Math.random() * VEHICLE_COLORS.length)];
            const t = -halfSize + Math.random() * halfSize * 2;
            const lane = (Math.random() < 0.5 ? -1 : 1) * 0.5;

            const group = new THREE.Group();

            // Simple car body
            const bodyGeo = new THREE.BoxGeometry(1.2, 0.45, 0.7);
            const body = new THREE.Mesh(bodyGeo, new THREE.MeshPhongMaterial({ color, flatShading: true }));
            body.position.y = 0.35;
            group.add(body);

            // Cabin
            const cabinGeo = new THREE.BoxGeometry(0.6, 0.3, 0.6);
            const cabin = new THREE.Mesh(cabinGeo, new THREE.MeshPhongMaterial({ color, flatShading: true }));
            cabin.position.set(-0.05, 0.65, 0);
            group.add(cabin);

            const h = terrain.getHeight(
                isHorizontal ? t : roadPos + lane,
                isHorizontal ? roadPos + lane : t
            );

            let x, z;
            if (isHorizontal) {
                x = t; z = roadPos + lane;
                group.rotation.y = lane > 0 ? 0 : Math.PI;
            } else {
                x = roadPos + lane; z = t;
                group.rotation.y = lane > 0 ? Math.PI / 2 : -Math.PI / 2;
            }

            group.position.set(x, Math.max(h * 0.15 + 0.02, 0.02), z);
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
        const intensity = on ? 1.0 : 0;

        for (const sl of this.streetLightLamps) {
            sl.pointLight.intensity = intensity;
            sl.lampMat.opacity = on ? 0.9 : 0.3;
            sl.lampMat.color.set(on ? 0xffeecc : 0x888888);
        }

        for (const bld of this.cityBuildings) {
            const ud = bld.userData;
            if (ud.interiorLight) ud.interiorLight.intensity = on ? 1.2 : 0;
            if (ud.windowMeshes) {
                for (const w of ud.windowMeshes) {
                    w.material.emissiveIntensity = on ? 0.6 : 0.0;
                    w.material.color.set(on ? 0xffdd88 : 0x88bbdd);
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

        // Traffic lights
        for (const tl of this.trafficLights) {
            const cycleTime = 8;
            const phase = (time + tl.phase) % cycleTime;
            const activeIndex = phase < cycleTime * 0.45 ? 2 : phase < cycleTime * 0.5 ? 1 : 0;
            for (let i = 0; i < tl.bulbs.length; i++) {
                const isActive = i === activeIndex;
                tl.bulbs[i].material.color.set(isActive ? tl.colors[i] : 0x333333);
                tl.bulbs[i].material.opacity = isActive ? 1.0 : 0.3;
            }
            tl.pointLight.color.set(tl.colors[activeIndex]);
            tl.pointLight.intensity = 0.5;
        }

        // Lighthouse beam + red blink
        for (const bld of this.cityBuildings) {
            if (bld.userData.beamLight) {
                bld.userData.beamLight.target.position.x = Math.cos(time * 0.5) * 30;
                bld.userData.beamLight.target.position.z = Math.sin(time * 0.5) * 30;
            }
            if (bld.userData.topLight) {
                bld.userData.topLight.intensity = Math.sin(time * 2) > 0.5 ? 1.0 : 0;
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
        this.intersections = [];
        this.cityBuildings = [];
        this.lightsOn = false;
    }
}

export { CitySystem };
