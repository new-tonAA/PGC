import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

const VEHICLE_COLORS = [
    0xcc2222, 0x2255cc, 0x22cc44, 0xcccc22, 0xffffff,
    0x222222, 0xcc8822, 0x8822cc, 0x22cccc, 0x888888,
    0xcc4488, 0x44cc88
];

const VEHICLE_TYPES = ['sedan', 'sedan', 'sedan', 'bus', 'fire_truck', 'school_bus'];

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
        this.roadMat = null;
        this.roadDashMat = null;
        this.roadLineMat = null;
        this.roadSidewalkMat = null;
        this.roadPositions = [];
        this.halfSize = 0;
        this.roadWidth = 2.5;
        this.placedBuildings = [];
        this.snowAccum = 0;
        this.lighthouseGroup = null;
        this.roadPositionsX = [];
        this.roadPositionsZ = [];
    }

    generate(terrain, seed, vehicleCount, options = {}) {
        this.clear();
        this.noise = new SimplexNoise(seed);
        this.terrain = terrain;
        this.scene.add(this.group);
        this.roadDensity = options.roadDensity || 50;
        this.lightSpacing = options.lightSpacing || 12;
        this.buildingCount = options.buildingDensity || options.buildingCount || 8;
        const skipVehicles = options.skipVehicles || false;

        this.roadMat = new THREE.MeshStandardMaterial({
            color: 0x3a3a40,
            roughness: 0.85,
            metalness: 0.05,
        });

        this.roadDashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.roadLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

        const isIsland = terrain.terrainType === 'islands';

        if (isIsland) {
            this.generateIslandCity(terrain, vehicleCount);
        } else {
            this.generateGridCity(terrain, skipVehicles ? 0 : vehicleCount);
        }
    }

    generateGridCity(terrain, vehicleCount) {
        const halfSize = terrain.size * 0.28;
        const densityFactor = this.roadDensity / 50;
        const blockSize = Math.max(6, Math.round(10 / densityFactor));
        const roadWidth = 2.2;

        this.halfSize = halfSize;
        this.roadWidth = roadWidth;

        const rawPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += blockSize) {
            rawPositions.push(pos);
        }

        const allIntersections = [];
        for (const x of rawPositions) {
            for (const z of rawPositions) {
                const h = terrain.getHeight(x, z);
                if (h >= terrain.waterLevel + 0.5) {
                    allIntersections.push({ x, z, h });
                }
            }
        }

        if (allIntersections.length < 4) {
            this.intersections = [];
            return;
        }

        const interKey = (ix, iz) => `${Math.round(ix)},${Math.round(iz)}`;
        const interSet = new Set(allIntersections.map(i => interKey(i.x, i.z)));
        const adjacency = new Map();

        for (const inter of allIntersections) {
            const key = interKey(inter.x, inter.z);
            let neighbors = 0;
            const deltas = [[blockSize,0],[-blockSize,0],[0,blockSize],[0,-blockSize]];
            for (const [dx, dz] of deltas) {
                if (interSet.has(interKey(inter.x + dx, inter.z + dz))) {
                    neighbors++;
                }
            }
            adjacency.set(key, neighbors);
        }

        const isGridEdge = (x, z) => {
            return Math.abs(x - rawPositions[0]) < 0.5 || Math.abs(x - rawPositions[rawPositions.length-1]) < 0.5 ||
                   Math.abs(z - rawPositions[0]) < 0.5 || Math.abs(z - rawPositions[rawPositions.length-1]) < 0.5;
        };

        const validIntersections = allIntersections.filter(inter => {
            const key = interKey(inter.x, inter.z);
            const n = adjacency.get(key) || 0;
            return n >= 2 || (n >= 1 && isGridEdge(inter.x, inter.z));
        });

        if (validIntersections.length < 4) {
            this.intersections = allIntersections;
        } else {
            this.intersections = validIntersections;
        }

        const validXSet = new Set(this.intersections.map(i => i.x));
        const validZSet = new Set(this.intersections.map(i => i.z));
        const roadPositionsX = [...validXSet].sort((a, b) => a - b);
        const roadPositionsZ = [...validZSet].sort((a, b) => a - b);
        this.roadPositions = roadPositionsX;
        this.roadPositionsX = roadPositionsX;
        this.roadPositionsZ = roadPositionsZ;

        const roadPairs = new Set();

        for (const fixedZ of roadPositionsZ) {
            const intersOnRow = this.intersections.filter(i => Math.abs(i.z - fixedZ) < 0.1);
            if (intersOnRow.length < 2) continue;
            const sorted = intersOnRow.sort((a, b) => a.x - b.x);

            for (let i = 0; i < sorted.length - 1; i++) {
                const startInter = sorted[i];
                const endInter = sorted[i + 1];
                const pairKey = `${interKey(startInter.x, startInter.z)}->${interKey(endInter.x, endInter.z)}`;
                if (roadPairs.has(pairKey)) continue;

                let allAboveWater = true;
                const steps = Math.ceil(Math.abs(endInter.x - startInter.x) / 1.5);
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    const px = startInter.x + (endInter.x - startInter.x) * t;
                    if (terrain.getHeight(px, fixedZ) < terrain.waterLevel + 0.2) {
                        allAboveWater = false;
                        break;
                    }
                }
                if (allAboveWater) {
                    this.createRoadSegment(
                        new THREE.Vector3(startInter.x, 0, fixedZ),
                        new THREE.Vector3(endInter.x, 0, fixedZ),
                        roadWidth, terrain, false
                    );
                    roadPairs.add(pairKey);
                }
            }
        }

        for (const fixedX of roadPositionsX) {
            const intersOnCol = this.intersections.filter(i => Math.abs(i.x - fixedX) < 0.1);
            if (intersOnCol.length < 2) continue;
            const sorted = intersOnCol.sort((a, b) => a.z - b.z);

            for (let i = 0; i < sorted.length - 1; i++) {
                const startInter = sorted[i];
                const endInter = sorted[i + 1];
                const pairKey = `${interKey(startInter.x, startInter.z)}->${interKey(endInter.x, endInter.z)}`;
                if (roadPairs.has(pairKey)) continue;

                let allAboveWater = true;
                const steps = Math.ceil(Math.abs(endInter.z - startInter.z) / 1.5);
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    const pz = startInter.z + (endInter.z - startInter.z) * t;
                    if (terrain.getHeight(fixedX, pz) < terrain.waterLevel + 0.2) {
                        allAboveWater = false;
                        break;
                    }
                }
                if (allAboveWater) {
                    this.createRoadSegment(
                        new THREE.Vector3(fixedX, 0, startInter.z),
                        new THREE.Vector3(fixedX, 0, endInter.z),
                        roadWidth, terrain, true
                    );
                    roadPairs.add(pairKey);
                }
            }
        }

        for (const inter of this.intersections) {
            const h = terrain.getHeight(inter.x, inter.z);
            const n = adjacency.get(interKey(inter.x, inter.z)) || 0;
            this.createIntersection(inter.x, inter.z, h, roadWidth);
            if (n >= 3 && Math.random() < 0.6) {
                this.createTrafficLight(inter.x, inter.z, h, roadWidth);
            } else if (n >= 2 && Math.random() < 0.25) {
                this.createTrafficLight(inter.x, inter.z, h, roadWidth);
            }
        }

        const maxBuildings = this.buildingCount > 0 ? this.buildingCount : 999;
        let buildingPlaced = 0;

        for (let i = 0; i < roadPositionsX.length - 1; i++) {
            for (let j = 0; j < roadPositionsZ.length - 1; j++) {
                if (buildingPlaced >= maxBuildings) break;
                const x1 = roadPositionsX[i] + roadWidth / 2 + 0.8;
                const z1 = roadPositionsZ[j] + roadWidth / 2 + 0.8;
                const x2 = roadPositionsX[i + 1] - roadWidth / 2 - 0.8;
                const z2 = roadPositionsZ[j + 1] - roadWidth / 2 - 0.8;

                if (x2 - x1 < 2 || z2 - z1 < 2) continue;

                const centerX = (x1 + x2) / 2;
                const centerZ = (z1 + z2) / 2;
                const h = terrain.getHeight(centerX, centerZ);
                if (h < terrain.waterLevel + 0.3) continue;
                const distFromCenter = Math.sqrt(centerX * centerX + centerZ * centerZ);
                const heightFactor = Math.max(0.25, 1.0 - distFromCenter / (terrain.size * 0.45));
                this.generateBlock(x1, z1, x2, z2, h, heightFactor, terrain);
                buildingPlaced++;
            }
            if (buildingPlaced >= maxBuildings) break;
        }

        if (this.intersections.length > 0) {
            this.createLandmarkBuildings(terrain, roadPositionsX, roadPositionsZ);
        }

        const spacing = this.lightSpacing;
        const placedLightPositions = new Set();

        for (const road of this.roads) {
            const roadLen = road.length;
            const isHoriz = Math.abs(road.dir.z) < 0.1;
            const numLights = Math.max(1, Math.floor(roadLen / spacing));

            for (let l = 0; l < numLights; l++) {
                const t = (l + 0.5) / numLights;
                const lx = road.start.x + road.dir.x * roadLen * t;
                const lz = road.start.z + road.dir.z * roadLen * t;
                const lk = `${Math.round(lx)},${Math.round(lz)}`;
                if (placedLightPositions.has(lk)) continue;

                const lh = terrain.getHeight(lx, lz);
                if (lh < terrain.waterLevel + 0.3) continue;

                for (const side of [-1, 1]) {
                    const offset = side * (road.width / 2 + 0.6);
                    const slx = isHoriz ? lx : lx + offset;
                    const slz = isHoriz ? lz + offset : lz;
                    const slh = terrain.getHeight(slx, slz);
                    if (slh < terrain.waterLevel + 0.3) continue;
                    const armAngle = isHoriz
                        ? (side === -1 ? Math.PI / 2 : -Math.PI / 2)
                        : (side === -1 ? 0 : Math.PI);
                    this.createStreetLight(slx, slh, slz, terrain, armAngle);
                }
                placedLightPositions.add(lk);
            }
        }

        // Assign one-way directions based on grid cycle topology
        this.resolveRoadOneWayDirections(roadPositionsX, roadPositionsZ);

        this.generateVehicles(terrain, roadPositionsX, roadPositionsZ, halfSize, vehicleCount);
    }

    // ==========================================
    // RESOLVE ROAD ONE-WAY DIRECTIONS
    // Checkerboard pattern: each grid cell is a cycle. Adjacent cells
    // have opposite parity, guaranteeing shared road edges agree.
    // ==========================================
    resolveRoadOneWayDirections(xs, zs) {
        // Checkerboard: cell(col,row) CW if (col+row)%2==0. Handle negative indices.
        const cellCW = (c, r) => ((c < 0 ? (c % 2 + 2) % 2 : c) + (r < 0 ? (r % 2 + 2) % 2 : r)) % 2 === 0;

        for (const road of this.roads) {
            const isH = Math.abs(road.dir.z) < 0.1;
            const midX = (road.start.x + road.end.x) / 2;
            const midZ = (road.start.z + road.end.z) / 2;

            let col = -1, row = -1;
            let isCW;

            if (isH) {
                for (let c = 0; c < xs.length - 1; c++)
                    if (midX >= xs[c] - 0.5 && midX <= xs[c+1] + 0.5) { col = c; break; }
                for (let r = 0; r < zs.length; r++)
                    if (Math.abs(road.start.z - zs[r]) < 0.5) { row = r; break; }
                if (col < 0 || row < 0) { road.oneWay = 'start'; continue; }

                // Prefer cell ABOVE (bottom edge). Fallback: cell BELOW (top edge, invert).
                if (row < zs.length - 1) isCW = cellCW(col, row);
                else isCW = !cellCW(col, row - 1);

                // Horizontal: CW→east(x+), CCW→west(x-)
                road.oneWay = (isCW === (road.start.x < road.end.x)) ? 'start' : 'end';
            } else {
                for (let c = 0; c < xs.length; c++)
                    if (Math.abs(road.start.x - xs[c]) < 0.5) { col = c; break; }
                for (let r = 0; r < zs.length - 1; r++)
                    if (midZ >= zs[r] - 0.5 && midZ <= zs[r+1] + 0.5) { row = r; break; }
                if (col < 0 || row < 0) { road.oneWay = 'start'; continue; }

                // Prefer cell to the RIGHT (left edge). Fallback: cell LEFT (right edge, invert).
                if (col < xs.length - 1) isCW = cellCW(col, row);
                else isCW = !cellCW(col - 1, row);

                // Vertical: CW left-edge→south(z-), CCW left-edge→north(z+)
                // oneWay='start' means start→end is the correct direction.
                // CW: should go south, so start.z > end.z.
                // CCW: should go north, so start.z < end.z.
                const shouldGoNorth = !isCW;
                road.oneWay = (shouldGoNorth === (road.start.z < road.end.z)) ? 'start' : 'end';
            }
        }
    }

    findValidRoadSegments(fixedPos, roadPositions, terrain, isHorizontal) {
        const segments = [];
        const waterThreshold = terrain.waterLevel + 0.3;
        const margin = 1.0;

        const crossPositions = roadPositions.filter(rp => {
            const x = isHorizontal ? rp : fixedPos;
            const z = isHorizontal ? fixedPos : rp;
            return terrain.getHeight(x, z) >= waterThreshold;
        });

        if (crossPositions.length === 0) return segments;

        const sorted = [...crossPositions].sort((a, b) => a - b);

        for (let i = 0; i < sorted.length - 1; i++) {
            const startP = sorted[i];
            const endP = sorted[i + 1];

            let allAboveWater = true;
            const steps = Math.ceil(Math.abs(endP - startP) / 2);
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const p = startP + (endP - startP) * t;
                const x = isHorizontal ? p : fixedPos;
                const z = isHorizontal ? fixedPos : p;
                if (terrain.getHeight(x, z) < waterThreshold - margin) {
                    allAboveWater = false;
                    break;
                }
            }

            if (allAboveWater) {
                segments.push({
                    startX: startP - 1,
                    endX: endP + 1
                });
            }
        }

        for (const p of sorted) {
            const idx = sorted.indexOf(p);
            const hasPrev = idx > 0;
            const hasNext = idx < sorted.length - 1;

            if (!hasPrev) {
                if (terrain.getHeight(
                    isHorizontal ? p - 3 : fixedPos,
                    isHorizontal ? fixedPos : p - 3
                ) >= waterThreshold) {
                    segments.push({ startX: p - 3, endX: p });
                }
            }
            if (!hasNext) {
                if (terrain.getHeight(
                    isHorizontal ? p + 3 : fixedPos,
                    isHorizontal ? fixedPos : p + 3
                ) >= waterThreshold) {
                    segments.push({ startX: p, endX: p + 3 });
                }
            }
        }

        return segments;
    }

    generateIslandCity(terrain, vehicleCount) {
        const halfSize = terrain.size * 0.28;
        this.halfSize = halfSize;
        this.roadWidth = 2.2;
        this.roadPositions = [];

        this.createHarbor(terrain);
        this.createLighthouse(terrain);

        for (let i = 0; i < 20; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * halfSize * 0.45;
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;
            const h = terrain.getHeight(x, z);

            if (h < terrain.waterLevel + 0.5 || h > 4) continue;

            this.createIslandBuilding(x, h, z, terrain);
        }

        this.createBoats(terrain);
    }

    createRoadSegment(start, end, width, terrain, isVertical) {
        const dir = new THREE.Vector3().subVectors(end, start);
        const length = dir.length();
        dir.normalize();

        const segments = Math.max(2, Math.ceil(length / 4));
        const segLen = length / segments;

        for (let s = 0; s < segments; s++) {
            const t0 = s / segments;
            const t1 = (s + 1) / segments;
            const px0 = start.x + dir.x * length * t0;
            const pz0 = start.z + dir.z * length * t0;
            const px1 = start.x + dir.x * length * t1;
            const pz1 = start.z + dir.z * length * t1;

            const h0 = terrain.getHeight(px0, pz0);
            const h1 = terrain.getHeight(px1, pz1);
            const midH = (h0 + h1) / 2;
            const roadY = midH + 0.08;

            const segGeo = new THREE.PlaneGeometry(segLen, width);
            const seg = new THREE.Mesh(segGeo, this.roadMat);
            seg.rotation.x = -Math.PI / 2;

            const midX = (px0 + px1) / 2;
            const midZ = (pz0 + pz1) / 2;
            seg.position.set(midX, roadY, midZ);

            seg.rotation.z = Math.atan2(dir.z, dir.x);
            seg.receiveShadow = true;
            this.group.add(seg);
        }

        const dashCount = Math.floor(length / 2);
        for (let d = 0; d < dashCount; d++) {
            if (d % 2 === 0) continue;
            const t = (d + 0.5) / dashCount;
            const dashGeo = new THREE.PlaneGeometry(1.2, 0.08);
            const dash = new THREE.Mesh(dashGeo, this.roadDashMat);
            dash.rotation.x = -Math.PI / 2;

            const px = start.x + dir.x * length * t;
            const pz = start.z + dir.z * length * t;
            const dh = terrain.getHeight(px, pz);
            const dashY = dh + 0.10;
            dash.position.set(px, dashY, pz);
            dash.rotation.z = Math.atan2(dir.z, dir.x);
            this.group.add(dash);
        }

        const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
        const midH = terrain.getHeight(mid.x, mid.z);
        const roadY = midH + 0.09;

        for (const side of [-1, 1]) {
            const lineGeo = new THREE.PlaneGeometry(length, 0.12);
            const line = new THREE.Mesh(lineGeo, this.roadLineMat);
            line.rotation.x = -Math.PI / 2;

            const offset = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side * (width / 2 - 0.15));
            line.position.set(mid.x + offset.x, roadY + 0.01, mid.z + offset.z);
            line.rotation.z = Math.atan2(dir.z, dir.x);
            this.group.add(line);
        }

        this.roads.push({ start: start.clone(), end: end.clone(), width, dir: dir.clone(), length });
    }

    createIntersection(x, z, h, roadWidth) {
        const intGeo = new THREE.PlaneGeometry(roadWidth, roadWidth);
        const intersection = new THREE.Mesh(intGeo, this.roadMat);
        intersection.rotation.x = -Math.PI / 2;
        intersection.position.set(x, h + 0.08, z);
        intersection.receiveShadow = true;
        this.group.add(intersection);

        for (const rot of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
            const cosR = Math.cos(rot);
            const sinR = Math.sin(rot);
            for (let s = -2; s <= 2; s++) {
                const stripeGeo = new THREE.PlaneGeometry(0.18, roadWidth * 0.45);
                const stripe = new THREE.Mesh(stripeGeo, this.roadLineMat);
                stripe.rotation.x = -Math.PI / 2;
                stripe.rotation.z = rot;
                const offsetX = cosR * (roadWidth / 2 + 0.25);
                const offsetZ = sinR * (roadWidth / 2 + 0.25);
                const lateralOffset = s * 0.3;
                stripe.position.set(
                    x + offsetX - sinR * lateralOffset,
                    h + 0.1,
                    z + offsetZ + cosR * lateralOffset
                );
                this.group.add(stripe);
            }
        }
    }

    createTrafficLight(x, z, h, roadWidth) {
        const group = new THREE.Group();

        const poleGeo = new THREE.CylinderGeometry(0.05, 0.06, 3.5, 6);
        const poleMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 1.75;
        group.add(pole);

        const armGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.5, 4);
        const arm = new THREE.Mesh(armGeo, poleMat);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(0.75, 3.4, 0);
        group.add(arm);

        const boxGeo = new THREE.BoxGeometry(0.3, 0.9, 0.3);
        const boxMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
        const box = new THREE.Mesh(boxGeo, boxMat);
        box.position.set(1.3, 3.5, 0);
        group.add(box);

        const colors = [0xff0000, 0xffaa00, 0x00ff00];
        const bulbPositions = [3.7, 3.5, 3.3];
        const bulbs = [];

        for (let i = 0; i < 3; i++) {
            const bulbGeo = new THREE.SphereGeometry(0.1, 8, 6);
            const bulbMat = new THREE.MeshStandardMaterial({
                color: i === 0 ? 0xff0000 : 0x333333,
                emissive: i === 0 ? new THREE.Color(0xff0000) : new THREE.Color(0x000000),
                emissiveIntensity: i === 0 ? 1.2 : 0,
                roughness: 0.2,
                metalness: 0.1,
                transparent: true,
                opacity: 1.0,
            });
            const bulb = new THREE.Mesh(bulbGeo, bulbMat);
            bulb.position.set(1.46, bulbPositions[i], 0);
            group.add(bulb);
            bulbs.push(bulb);
        }

        const tLight = new THREE.PointLight(0xff0000, 0.5, 8, 2);
        tLight.position.set(1.5, 3.7, 0);
        group.add(tLight);

        group.position.set(x + roadWidth / 2 + 0.8, h + 0.08, z + roadWidth / 2 + 0.8);

        this.group.add(group);

        this.trafficLights.push({
            group,
            bulbs,
            pointLight: tLight,
            phase: Math.random() * 20,
            colors
        });
    }

    createStreetLight(x, h, z, terrain, roadDirection = null) {
        const actualH = terrain.getHeight(x, z);
        const baseY = actualH + 0.05;

        const group = new THREE.Group();

        const poleGeo = new THREE.CylinderGeometry(0.05, 0.07, 4.5, 8);
        const poleMat = new THREE.MeshPhongMaterial({ color: 0x444444 });
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.y = 2.25;
        pole.castShadow = true;
        group.add(pole);

        const armGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6);
        const arm = new THREE.Mesh(armGeo, poleMat);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(0.8, 4.35, 0);
        group.add(arm);

        const lampGeo = new THREE.BoxGeometry(0.6, 0.14, 0.35);
        const lampMat = new THREE.MeshStandardMaterial({
            color: 0xfff0dd,
            emissive: 0xffeedd,
            emissiveIntensity: 0,
            transparent: true,
            opacity: 0.35,
            roughness: 0.2,
            metalness: 0.2,
        });
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(0.8, 4.28, 0);
        group.add(lamp);

        const glowGeo = new THREE.CircleGeometry(1.2, 16);
        const glowMat = new THREE.MeshBasicMaterial({
            color: 0xffffcc,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(0.8, 4.15, 0);
        group.add(glow);

        const spotLight = new THREE.SpotLight(0xffeebb, 0, 35, Math.PI / 3, 0.5, 1.5);
        spotLight.position.set(0.8, 4.2, 0);
        spotLight.target.position.set(0.8, -0.5, 0);
        spotLight.castShadow = true;
        spotLight.shadow.mapSize.width = 512;
        spotLight.shadow.mapSize.height = 512;
        spotLight.shadow.camera.near = 0.5;
        spotLight.shadow.camera.far = 40;
        spotLight.shadow.bias = -0.0005;
        group.add(spotLight);
        group.add(spotLight.target);

        const sLight = new THREE.PointLight(0xffeebb, 0, 25, 1.8);
        sLight.position.set(0.8, 3.8, 0);
        sLight.castShadow = false;
        group.add(sLight);

        const coneGeo = new THREE.ConeGeometry(1.5, 0.08, 8);
        const coneMat = new THREE.MeshBasicMaterial({
            color: 0xffffdd,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.position.set(0.8, -0.02, 4.5);
        cone.rotation.x = -Math.PI;
        group.add(cone);

        if (roadDirection !== null) {
            group.rotation.y = roadDirection;
        }

        group.position.set(x, baseY, z);
        this.group.add(group);

        this.streetLightLamps.push({
            group, lamp, spotLight, pointLight: sLight, lampMat, glowMat, groundCone: cone, coneMat
        });
    }

    createLandmarkBuildings(terrain, roadPositionsX, roadPositionsZ) {
        if (roadPositionsX.length < 2 || roadPositionsZ.length < 2) return;

        const centerIdxX = Math.floor(roadPositionsX.length / 2);
        const centerIdxZ = Math.floor(roadPositionsZ.length / 2);
        const cx = roadPositionsX[centerIdxX];
        const cz = roadPositionsZ[centerIdxZ];
        const ch = terrain.getHeight(cx, cz);

        if (ch >= terrain.waterLevel + 0.3) {
            this.createCantonTower(cx + 4, ch, cz + 4, terrain);
        }

        if (roadPositionsX.length > 2 && roadPositionsZ.length > 2) {
            const mallIdx = Math.max(0, centerIdxX - 1);
            const mallIdxZ = Math.max(0, centerIdxZ - 1);
            const mx = roadPositionsX[mallIdx];
            const mz = roadPositionsZ[mallIdxZ];
            const mh = terrain.getHeight(mx, mz);
            if (mh >= terrain.waterLevel + 0.3) {
                this.createShoppingMall(mx, mh, mz, terrain);
            }
        }
    }

    createCantonTower(x, baseH, z, terrain) {
        const group = new THREE.Group();
        const totalH = 22;
        const baseR = 2.0;
        const midR = 0.8;
        const topR = 1.2;

        const segments = 20;
        for (let i = 0; i < segments; i++) {
            const t0 = i / segments;
            const t1 = (i + 1) / segments;
            const y0 = t0 * totalH;
            const y1 = t1 * totalH;

            let r0, r1;
            if (t0 < 0.5) {
                const s = t0 * 2;
                r0 = baseR * (1 - s) + midR * s;
            } else {
                const s = (t0 - 0.5) * 2;
                r0 = midR * (1 - s) + topR * s;
            }
            if (t1 < 0.5) {
                const s = t1 * 2;
                r1 = baseR * (1 - s) + midR * s;
            } else {
                const s = (t1 - 0.5) * 2;
                r1 = midR * (1 - s) + topR * s;
            }

            const segGeo = new THREE.CylinderGeometry(r1, r0, (y1 - y0), 8);
            const segMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(0.75, 0.7, 0.65),
                shininess: 80,
                transparent: true,
                opacity: 0.9
            });
            const seg = new THREE.Mesh(segGeo, segMat);
            seg.position.y = (y0 + y1) / 2;
            seg.castShadow = true;
            group.add(seg);
        }

        const antennaH = 5;
        const antennaGeo = new THREE.CylinderGeometry(0.08, 0.15, antennaH, 6);
        const antennaMat = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, shininess: 100 });
        const antenna = new THREE.Mesh(antennaGeo, antennaMat);
        antenna.position.y = totalH + antennaH / 2;
        group.add(antenna);

        const deckGeo = new THREE.TorusGeometry(topR + 0.3, 0.15, 8, 16);
        const deckMat = new THREE.MeshPhongMaterial({
            color: 0xdddddd,
            emissive: 0xffcc88,
            emissiveIntensity: 0.3
        });
        const deck = new THREE.Mesh(deckGeo, deckMat);
        deck.position.y = totalH * 0.72;
        deck.rotation.x = Math.PI / 2;
        group.add(deck);

        const windowMeshes = [];
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2;
            for (let row = 0; row < 8; row++) {
                const wy = 2 + row * 2.5;
                const wt = wy / totalH;
                let wr;
                if (wt < 0.5) {
                    const s = wt * 2;
                    wr = baseR * (1 - s) + midR * s;
                } else {
                    const s = (wt - 0.5) * 2;
                    wr = midR * (1 - s) + topR * s;
                }

                const wGeo = new THREE.PlaneGeometry(0.4, 0.6);
                const wMat = new THREE.MeshPhongMaterial({
                    color: 0xaaddff,
                    emissive: 0xffdd88,
                    emissiveIntensity: 0.0,
                    transparent: true,
                    opacity: 0.8,
                    side: THREE.DoubleSide
                });
                const w = new THREE.Mesh(wGeo, wMat);
                w.position.set(Math.cos(angle) * (wr + 0.02), wy, Math.sin(angle) * (wr + 0.02));
                w.rotation.y = -angle;
                group.add(w);
                windowMeshes.push(w);
            }
        }
        group.userData.windowMeshes = windowMeshes;

        const towerLight = new THREE.PointLight(0xffcc66, 0, 55, 2);
        towerLight.position.set(0, totalH * 0.7, 0);
        group.add(towerLight);
        group.userData.interiorLight = towerLight;

        const topLight = new THREE.PointLight(0xff4444, 0, 30, 2);
        topLight.position.set(0, totalH + antennaH, 0);
        group.add(topLight);
        group.userData.topLight = topLight;

        const topBulbGeo = new THREE.SphereGeometry(0.12, 6, 4);
        const topBulbMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
        const topBulb = new THREE.Mesh(topBulbGeo, topBulbMat);
        topBulb.position.set(0, totalH + antennaH, 0);
        group.add(topBulb);
        group.userData.topBulb = topBulb;

        group.position.set(x, baseH, z);
        this.group.add(group);
        this.cityBuildings.push(group);
        this.placedBuildings.push({ x, z, w: 5, d: 5 });
    }

    createShoppingMall(x, baseH, z, terrain) {
        const group = new THREE.Group();
        const width = 8;
        const depth = 6;
        const height = 5;

        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.85, 0.82, 0.78),
            shininess: 40
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = height / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const glassGeo = new THREE.BoxGeometry(width + 0.05, height * 0.4, depth + 0.05);
        const glassMat = new THREE.MeshPhongMaterial({
            color: 0x88bbdd,
            transparent: true,
            opacity: 0.5,
            shininess: 100,
            emissive: 0xffdd88,
            emissiveIntensity: 0.0
        });
        const glass = new THREE.Mesh(glassGeo, glassMat);
        glass.position.y = height * 0.2;
        group.add(glass);

        const windowMeshes = [glass];

        const signGeo = new THREE.BoxGeometry(width * 0.6, 0.8, 0.1);
        const signMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
        const sign = new THREE.Mesh(signGeo, signMat);
        sign.position.set(0, height + 0.5, depth / 2 + 0.06);
        group.add(sign);

        const signLight = new THREE.PointLight(0xff4444, 0, 20, 2);
        signLight.position.set(0, height + 0.5, depth / 2 + 1);
        group.add(signLight);
        group.userData.signLight = signLight;

        const roofGeo = new THREE.BoxGeometry(width + 0.5, 0.15, depth + 0.5);
        const roofMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = height + 0.075;
        group.add(roof);

        const interiorLight = new THREE.PointLight(0xffcc66, 0, 55, 2);
        interiorLight.position.set(0, height * 0.5, 0);
        interiorLight.castShadow = false;
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;

        group.userData.windowMeshes = windowMeshes;

        group.position.set(x, baseH, z);
        this.group.add(group);
        this.cityBuildings.push(group);
        this.placedBuildings.push({ x, z, w: width, d: depth });
    }

    generateBlock(x1, z1, x2, z2, baseH, heightFactor, terrain) {
        const blockW = x2 - x1;
        const blockD = z2 - z1;
        const cx = (x1 + x2) / 2;
        const cz = (z1 + z2) / 2;

        const noiseVal = this.noise.noise2D(cx * 0.1, cz * 0.1);
        const numBuildings = 1 + Math.floor(Math.abs(noiseVal) * 3);

        for (let i = 0; i < numBuildings; i++) {
            const bw = 2 + Math.random() * Math.min(blockW * 0.4, 4);
            const bd = 2 + Math.random() * Math.min(blockD * 0.4, 4);

            const bx = x1 + 0.5 + Math.random() * (blockW - bw - 1);
            const bz = z1 + 0.5 + Math.random() * (blockD - bd - 1);

            if (this.checkPenetration(bx, bz, bw, bd)) continue;

            const bh = terrain.getHeight(bx, bz);
            if (bh < terrain.waterLevel + 0.3) continue;

            const hNoise = this.noise.noise2D(bx * 0.15, bz * 0.15);
            const maxH = 4 + heightFactor * 18 + hNoise * 6;
            const height = Math.max(4, 3 + Math.random() * maxH);

            this.createSkyscraper(bx, bh, bz, bw, height, bd);
            this.placedBuildings.push({ x: bx, z: bz, w: bw, d: bd });
        }
    }

    createSkyscraper(x, baseH, z, width, height, depth) {
        const group = new THREE.Group();

        const isTall = height > 12;
        const isMedium = height > 6;

        const hNoise = this.noise.noise2D(x * 0.2, z * 0.2);
        const styleRoll = Math.random();

        let wallColor;
        let buildingStyle;

        if (isTall) {
            if (styleRoll < 0.15) {
                wallColor = new THREE.Color(0.4, 0.55, 0.65);
                buildingStyle = 'glass_blue';
            } else if (styleRoll < 0.3) {
                wallColor = new THREE.Color(0.5, 0.5, 0.48);
                buildingStyle = 'glass_silver';
            } else if (styleRoll < 0.42) {
                wallColor = new THREE.Color(0.35, 0.4, 0.45);
                buildingStyle = 'glass_dark';
            } else if (styleRoll < 0.54) {
                wallColor = new THREE.Color(0.6, 0.58, 0.55);
                buildingStyle = 'stepped';
            } else if (styleRoll < 0.65) {
                wallColor = new THREE.Color(0.45, 0.5, 0.55);
                buildingStyle = 'twin_tower';
            } else if (styleRoll < 0.76) {
                wallColor = new THREE.Color(0.55, 0.5, 0.48);
                buildingStyle = 'setback';
            } else if (styleRoll < 0.87) {
                wallColor = new THREE.Color(0.42, 0.52, 0.58);
                buildingStyle = 'crown';
            } else {
                wallColor = new THREE.Color(0.65, 0.6, 0.55);
                buildingStyle = 'dome_top';
            }
        } else if (isMedium) {
            if (styleRoll < 0.2) {
                wallColor = new THREE.Color(0.7, 0.68, 0.65);
                buildingStyle = 'concrete_light';
            } else if (styleRoll < 0.38) {
                wallColor = new THREE.Color(0.6, 0.58, 0.55);
                buildingStyle = 'concrete_dark';
            } else if (styleRoll < 0.54) {
                wallColor = new THREE.Color(0.75, 0.65, 0.55);
                buildingStyle = 'brick';
            } else if (styleRoll < 0.68) {
                wallColor = new THREE.Color(0.55, 0.6, 0.65);
                buildingStyle = 'modern_mid';
            } else if (styleRoll < 0.8) {
                wallColor = new THREE.Color(0.85, 0.82, 0.75);
                buildingStyle = 'cream_mid';
            } else if (styleRoll < 0.9) {
                wallColor = new THREE.Color(0.65, 0.55, 0.45);
                buildingStyle = 'shop_front';
            } else {
                wallColor = new THREE.Color(0.58, 0.62, 0.58);
                buildingStyle = 'green_roof';
            }
        } else {
            if (styleRoll < 0.15) {
                wallColor = new THREE.Color(0.65 + hNoise * 0.1, 0.6 + hNoise * 0.05, 0.55);
                buildingStyle = 'small_1';
            } else if (styleRoll < 0.3) {
                wallColor = new THREE.Color(0.8, 0.75, 0.65);
                buildingStyle = 'small_2';
            } else if (styleRoll < 0.45) {
                wallColor = new THREE.Color(0.5, 0.55, 0.5);
                buildingStyle = 'small_3';
            } else if (styleRoll < 0.6) {
                wallColor = new THREE.Color(0.9, 0.85, 0.7);
                buildingStyle = 'small_cream';
            } else if (styleRoll < 0.75) {
                wallColor = new THREE.Color(0.7, 0.5, 0.4);
                buildingStyle = 'small_brick';
            } else if (styleRoll < 0.88) {
                wallColor = new THREE.Color(0.6, 0.65, 0.6);
                buildingStyle = 'small_cottage';
            } else {
                wallColor = new THREE.Color(0.78, 0.72, 0.65);
                buildingStyle = 'small_balcony';
            }
        }

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

        if (isTall && buildingStyle === 'glass_blue') {
            const stripeCount = Math.floor(height / 2);
            for (let s = 0; s < stripeCount; s++) {
                const stripeGeo = new THREE.BoxGeometry(width + 0.02, 0.05, depth + 0.02);
                const stripeMat = new THREE.MeshPhongMaterial({
                    color: 0x5588aa, shininess: 100, transparent: true, opacity: 0.6
                });
                const stripe = new THREE.Mesh(stripeGeo, stripeMat);
                stripe.position.y = 1 + s * 2;
                group.add(stripe);
            }
        }

        if (isTall && buildingStyle === 'stepped') {
            const stepH = height * 0.4;
            const stepW = width * 0.6;
            const stepD = depth * 0.6;
            const stepGeo = new THREE.BoxGeometry(stepW, stepH, stepD);
            const stepMat = new THREE.MeshPhongMaterial({
                color: wallColor.clone().multiplyScalar(0.9), shininess: 60
            });
            const step = new THREE.Mesh(stepGeo, stepMat);
            step.position.y = height + stepH / 2;
            step.castShadow = true;
            group.add(step);
        }

        if (isTall && buildingStyle === 'twin_tower') {
            const towerH = height * 0.35;
            const towerW = width * 0.35;
            const towerD = depth * 0.8;
            for (const side of [-1, 1]) {
                const towerGeo = new THREE.BoxGeometry(towerW, towerH, towerD);
                const towerMat = new THREE.MeshPhongMaterial({
                    color: wallColor.clone().offsetHSL(0, 0, 0.05), shininess: 70
                });
                const tower = new THREE.Mesh(towerGeo, towerMat);
                tower.position.set(side * (width * 0.25), height + towerH / 2, 0);
                tower.castShadow = true;
                group.add(tower);
            }
        }

        if (isTall && buildingStyle === 'setback') {
            for (let s = 0; s < 3; s++) {
                const t = 1 - s * 0.2;
                const setH = height * 0.15;
                const setGeo = new THREE.BoxGeometry(width * t, setH, depth * t);
                const setMat = new THREE.MeshPhongMaterial({
                    color: wallColor.clone().offsetHSL(0, 0, 0.03 * s), shininess: 60
                });
                const setMesh = new THREE.Mesh(setGeo, setMat);
                setMesh.position.y = height + s * setH + setH / 2;
                setMesh.castShadow = true;
                group.add(setMesh);
            }
        }

        if (isTall && buildingStyle === 'crown') {
            const crownH = height * 0.15;
            const crownGeo = new THREE.CylinderGeometry(width * 0.35, width * 0.45, crownH, 8);
            const crownMat = new THREE.MeshPhongMaterial({
                color: 0x888888, shininess: 80
            });
            const crown = new THREE.Mesh(crownGeo, crownMat);
            crown.position.y = height + crownH / 2;
            crown.castShadow = true;
            group.add(crown);
        }

        if (isTall && buildingStyle === 'dome_top') {
            const domeR = Math.min(width, depth) * 0.4;
            const domeGeo = new THREE.SphereGeometry(domeR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            const domeMat = new THREE.MeshPhongMaterial({
                color: 0x88aa88, shininess: 60, transparent: true, opacity: 0.7
            });
            const dome = new THREE.Mesh(domeGeo, domeMat);
            dome.position.y = height;
            dome.castShadow = true;
            group.add(dome);
        }

        if (isMedium && buildingStyle === 'brick') {
            const rowH = 0.6;
            const rows = Math.floor(height / rowH);
            for (let r = 0; r < rows; r++) {
                const lineGeo = new THREE.BoxGeometry(width + 0.01, 0.03, depth + 0.01);
                const lineMat = new THREE.MeshPhongMaterial({ color: 0x554433 });
                const line = new THREE.Mesh(lineGeo, lineMat);
                line.position.y = r * rowH + 0.3;
                group.add(line);
            }
        }

        if (buildingStyle === 'cream_mid' || buildingStyle === 'small_cream') {
            const ledgeCount = Math.floor(height / 2.5);
            for (let l = 0; l < ledgeCount; l++) {
                const ledgeGeo = new THREE.BoxGeometry(width + 0.15, 0.08, depth + 0.15);
                const ledgeMat = new THREE.MeshPhongMaterial({ color: 0xddddcc });
                const ledge = new THREE.Mesh(ledgeGeo, ledgeMat);
                ledge.position.y = 1.5 + l * 2.5;
                group.add(ledge);
            }
        }

        if (buildingStyle === 'small_brick') {
            const rowH = 0.5;
            const rows = Math.floor(height / rowH);
            for (let r = 0; r < rows; r++) {
                const lineGeo = new THREE.BoxGeometry(width + 0.01, 0.02, depth + 0.01);
                const lineMat = new THREE.MeshPhongMaterial({ color: 0x664433 });
                const line = new THREE.Mesh(lineGeo, lineMat);
                line.position.y = r * rowH + 0.25;
                group.add(line);
            }
        }

        if (buildingStyle === 'shop_front') {
            const shopGeo = new THREE.BoxGeometry(width + 0.05, height * 0.2, depth + 0.05);
            const shopMat = new THREE.MeshPhongMaterial({ color: 0x445566, shininess: 50 });
            const shop = new THREE.Mesh(shopGeo, shopMat);
            shop.position.y = height * 0.1;
            group.add(shop);

            const awningGeo = new THREE.BoxGeometry(width + 0.3, 0.04, 0.8);
            const awningMat = new THREE.MeshPhongMaterial({ color: 0xcc4444 });
            const awning = new THREE.Mesh(awningGeo, awningMat);
            awning.position.set(0, height * 0.2, depth / 2 + 0.4);
            group.add(awning);
        }

        if (buildingStyle === 'green_roof') {
            const roofGeo = new THREE.BoxGeometry(width - 0.2, 0.15, depth - 0.2);
            const roofMat = new THREE.MeshPhongMaterial({ color: 0x336633 });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = height + 0.075;
            group.add(roof);

            for (let p = 0; p < 3; p++) {
                const plantGeo = new THREE.SphereGeometry(0.15, 5, 4);
                const plantMat = new THREE.MeshPhongMaterial({ color: 0x227722 });
                const plant = new THREE.Mesh(plantGeo, plantMat);
                plant.position.set(
                    (Math.random() - 0.5) * (width - 1),
                    height + 0.3,
                    (Math.random() - 0.5) * (depth - 1)
                );
                group.add(plant);
            }
        }

        if (buildingStyle === 'small_cottage') {
            const roofH = 1.0;
            const roofGeo = new THREE.ConeGeometry(Math.max(width, depth) * 0.65, roofH, 4);
            const roofMat = new THREE.MeshPhongMaterial({ color: 0x884422, flatShading: true });
            const roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = height + roofH / 2;
            roof.rotation.y = Math.PI / 4;
            roof.castShadow = true;
            group.add(roof);

            const chimGeo = new THREE.BoxGeometry(0.25, 0.7, 0.25);
            const chimMat = new THREE.MeshPhongMaterial({ color: 0x665544 });
            const chimney = new THREE.Mesh(chimGeo, chimMat);
            chimney.position.set(width * 0.25, height + roofH * 0.6, -depth * 0.25);
            group.add(chimney);
        }

        if (buildingStyle === 'small_balcony') {
            for (let b = 0; b < 2; b++) {
                const balcGeo = new THREE.BoxGeometry(width * 0.8, 0.06, 0.5);
                const balcMat = new THREE.MeshPhongMaterial({ color: 0x999999 });
                const balc = new THREE.Mesh(balcGeo, balcMat);
                balc.position.set(0, 1.5 + b * 1.5, depth / 2 + 0.25);
                group.add(balc);

                const railGeo = new THREE.BoxGeometry(width * 0.8, 0.3, 0.03);
                const railMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
                const rail = new THREE.Mesh(railGeo, railMat);
                rail.position.set(0, 1.65 + b * 1.5, depth / 2 + 0.48);
                group.add(rail);
            }
        }

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

        for (let row = 0; row < windowRows; row++) {
            const wy = 0.5 + row * 0.8;
            if (wy > height - 0.5) break;
            if (Math.random() < 0.08) continue;

            for (let col = 0; col < windowColsW; col++) {
                const wx = -width / 2 + 0.5 + col * (width / windowColsW);
                if (Math.random() < 0.12) continue;

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

        for (let row = 0; row < windowRows; row++) {
            const wy = 0.5 + row * 0.8;
            if (wy > height - 0.5) break;
            if (Math.random() < 0.08) continue;

            for (let col = 0; col < windowColsD; col++) {
                const wz = -depth / 2 + 0.5 + col * (depth / windowColsD);
                if (Math.random() < 0.12) continue;

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

        if (isTall) {
            const antennaH = 1.5 + Math.random() * 2;
            const antennaGeo = new THREE.CylinderGeometry(0.03, 0.05, antennaH, 4);
            const antennaMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            const antenna = new THREE.Mesh(antennaGeo, antennaMat);
            antenna.position.y = height + antennaH / 2;
            group.add(antenna);

            const topLight = new THREE.PointLight(0xff0000, 0, 25, 2);
            topLight.position.set(0, height + antennaH, 0);
            group.add(topLight);
            group.userData.topLight = topLight;

            const topBulbGeo = new THREE.SphereGeometry(0.08, 6, 4);
            const topBulbMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.5 });
            const topBulb = new THREE.Mesh(topBulbGeo, topBulbMat);
            topBulb.position.set(0, height + antennaH, 0);
            group.add(topBulb);
            group.userData.topBulb = topBulb;
        } else if (!isMedium) {
            const acGeo = new THREE.BoxGeometry(0.6, 0.4, 0.5);
            const acMat = new THREE.MeshPhongMaterial({ color: 0x888888 });
            for (let a = 0; a < 2; a++) {
                const ac = new THREE.Mesh(acGeo, acMat);
                ac.position.set(
                    (Math.random() - 0.5) * width * 0.6,
                    height + 0.2,
                    (Math.random() - 0.5) * depth * 0.6
                );
                group.add(ac);
            }
        } else {
            const roofDetail = Math.random();
            if (roofDetail < 0.3) {
                const pentGeo = new THREE.BoxGeometry(width * 0.5, 1.5, depth * 0.5);
                const pentMat = new THREE.MeshPhongMaterial({ color: 0x999999 });
                const pent = new THREE.Mesh(pentGeo, pentMat);
                pent.position.y = height + 0.75;
                pent.castShadow = true;
                group.add(pent);
            } else if (roofDetail < 0.6) {
                const tankGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.0, 8);
                const tankMat = new THREE.MeshPhongMaterial({ color: 0x666666 });
                const tank = new THREE.Mesh(tankGeo, tankMat);
                tank.position.set(width * 0.2, height + 0.5, depth * 0.2);
                group.add(tank);
            }
        }

        const interiorLight = new THREE.PointLight(0xffcc66, 0, 65, 2.0);
        interiorLight.position.set(0, height * 0.6, 0);
        interiorLight.castShadow = false;
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;

        group.position.set(x, baseH, z);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    createIslandBuilding(x, h, z, terrain) {
        const group = new THREE.Group();

        const width = 2 + Math.random() * 2;
        const depth = 2 + Math.random() * 2;
        const height = 2.5 + Math.random() * 3;

        const styleRoll = Math.random();
        let wallColor;
        if (styleRoll < 0.3) wallColor = new THREE.Color(0.9, 0.85, 0.75);
        else if (styleRoll < 0.6) wallColor = new THREE.Color(0.7, 0.8, 0.75);
        else wallColor = new THREE.Color(0.85, 0.75, 0.65);

        const bodyGeo = new THREE.BoxGeometry(width, height, depth);
        const bodyMat = new THREE.MeshPhongMaterial({ color: wallColor, flatShading: true });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = height / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        const roofH = Math.max(width, depth) * 0.5;
        const roofGeo = new THREE.ConeGeometry(Math.max(width, depth) * 0.7, roofH, 4);
        const roofMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.6, 0.25, 0.18), flatShading: true
        });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        group.add(roof);

        const windowMat = new THREE.MeshPhongMaterial({
            color: 0x87ceeb, emissive: 0xffdd88, emissiveIntensity: 0.0,
            transparent: true, opacity: 0.7, side: THREE.DoubleSide
        });
        const windowMeshes = [];
        const wGeo = new THREE.PlaneGeometry(0.35, 0.4);
        for (let side = 0; side < 4; side++) {
            const w = new THREE.Mesh(wGeo, windowMat.clone());
            if (side === 0) w.position.set(0, height * 0.5, depth / 2 + 0.01);
            else if (side === 1) { w.position.set(0, height * 0.5, -depth / 2 - 0.01); w.rotation.y = Math.PI; }
            else if (side === 2) { w.rotation.y = Math.PI / 2; w.position.set(width / 2 + 0.01, height * 0.5, 0); }
            else { w.rotation.y = -Math.PI / 2; w.position.set(-width / 2 - 0.01, height * 0.5, 0); }
            group.add(w);
            windowMeshes.push(w);
        }
        group.userData.windowMeshes = windowMeshes;

        const interiorLight = new THREE.PointLight(0xffcc66, 0, 40, 2);
        interiorLight.position.set(0, height * 0.5, 0);
        interiorLight.castShadow = false;
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;

        group.position.set(x, h, z);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    createHarbor(terrain) {
        const dockLen = 8;
        const dockW = 1.5;
        const dockGeo = new THREE.BoxGeometry(dockLen, 0.3, dockW);
        const dockMat = new THREE.MeshPhongMaterial({ color: 0x6b4f3a });
        const dock = new THREE.Mesh(dockGeo, dockMat);
        const dockAngle = Math.random() * Math.PI * 2;
        const dockR = terrain.size * 0.28;
        dock.position.set(
            Math.cos(dockAngle) * dockR,
            terrain.waterLevel + 0.15,
            Math.sin(dockAngle) * dockR
        );
        dock.rotation.y = dockAngle;
        dock.receiveShadow = true;
        this.group.add(dock);

        for (let i = 0; i < 4; i++) {
            const pileGeo = new THREE.CylinderGeometry(0.08, 0.1, 2, 6);
            const pileMat = new THREE.MeshPhongMaterial({ color: 0x4a3520 });
            const pile = new THREE.Mesh(pileGeo, pileMat);
            const t = (i + 0.5) / 4;
            pile.position.set(
                dock.position.x - Math.sin(dockAngle) * dockW * 0.3 + Math.cos(dockAngle) * dockLen * (t - 0.5),
                terrain.waterLevel - 0.5,
                dock.position.z + Math.cos(dockAngle) * dockW * 0.3 + Math.sin(dockAngle) * dockLen * (t - 0.5)
            );
            this.group.add(pile);
        }
    }

    createLighthouse(terrain) {
        const group = new THREE.Group();

        let lx = 0, lz = 0, lh = 0;
        for (let attempt = 0; attempt < 30; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const r = terrain.size * 0.2 + Math.random() * terrain.size * 0.08;
            lx = Math.cos(angle) * r;
            lz = Math.sin(angle) * r;
            lh = terrain.getHeight(lx, lz);
            if (lh > terrain.waterLevel + 0.5 && lh < 3) break;
        }

        const baseH = 1.5;
        const towerH = 8;
        const baseR = 1.2;
        const topR = 0.55;

        const baseGeo = new THREE.CylinderGeometry(baseR + 0.3, baseR + 0.2, baseH * 0.6, 8);
        const baseMat2 = new THREE.MeshPhongMaterial({ color: 0x666666, flatShading: true });
        const basePlatform = new THREE.Mesh(baseGeo, baseMat2);
        basePlatform.position.y = baseH * 0.3;
        basePlatform.castShadow = true;
        group.add(basePlatform);

        const towerGeo = new THREE.CylinderGeometry(topR, baseR, towerH, 12);
        const towerMat = new THREE.MeshPhongMaterial({ color: 0xeeeeee, flatShading: true, shininess: 30 });
        const tower = new THREE.Mesh(towerGeo, towerMat);
        tower.position.y = baseH + towerH / 2;
        tower.castShadow = true;
        group.add(tower);

        for (let s = 0; s < 4; s++) {
            const stripeH = towerH / 8;
            const stripeR = baseR + (topR - baseR) * (0.1 + s * 0.25);
            const stripeGeo = new THREE.CylinderGeometry(stripeR + 0.02, stripeR + 0.02, stripeH, 12);
            const stripeMat = new THREE.MeshPhongMaterial({ color: 0xcc2222, flatShading: true });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.y = baseH + towerH * (0.08 + s * 0.24);
            group.add(stripe);
        }

        const lanternGeo = new THREE.CylinderGeometry(0.8, 0.65, 1.4, 10);
        const lanternMat = new THREE.MeshPhongMaterial({
            color: 0xffffcc, transparent: true, opacity: 0.85,
            emissive: 0xffee88, emissiveIntensity: 0.6
        });
        const lantern = new THREE.Mesh(lanternGeo, lanternMat);
        lantern.position.y = baseH + towerH + 0.7;
        group.add(lantern);

        for (let g = 0; g < 8; g++) {
            const glassAngle = (g / 8) * Math.PI * 2;
            const glassGeo = new THREE.PlaneGeometry(0.4, 1.0);
            const glassMat = new THREE.MeshPhongMaterial({
                color: 0xffffdd, transparent: true, opacity: 0.5,
                emissive: 0xffeeaa, emissiveIntensity: 1.0, side: THREE.DoubleSide
            });
            const glass = new THREE.Mesh(glassGeo, glassMat);
            glass.position.set(
                Math.cos(glassAngle) * 0.6,
                baseH + towerH + 0.7,
                Math.sin(glassAngle) * 0.6
            );
            glass.rotation.y = glassAngle;
            group.add(glass);
        }

        const roofGeo = new THREE.ConeGeometry(0.9, 0.9, 10);
        const roofMat = new THREE.MeshPhongMaterial({ color: 0x333333, shininess: 50 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.y = baseH + towerH + 1.85;
        group.add(roof);

        const rodGeo = new THREE.CylinderGeometry(0.03, 0.05, 0.6, 6);
        const rodMat = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 100 });
        const rod = new THREE.Mesh(rodGeo, rodMat);
        rod.position.y = baseH + towerH + 2.35;
        group.add(rod);

        const topBulbGeo = new THREE.SphereGeometry(0.08, 6, 4);
        const topBulbMat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const topBulb = new THREE.Mesh(topBulbGeo, topBulbMat);
        topBulb.position.y = baseH + towerH + 2.65;
        group.add(topBulb);
        group.userData.topBulb = topBulb;

        const beamLight = new THREE.SpotLight(0xffffcc, 10, 80, Math.PI / 7, 0.25, 1.5);
        beamLight.position.set(0, baseH + towerH + 0.7, 0);
        beamLight.castShadow = false;
        const beamTarget = new THREE.Object3D();
        beamTarget.position.set(40, baseH - 2, 0);
        group.add(beamTarget);
        beamLight.target = beamTarget;
        group.add(beamLight);
        group.userData.beamLight = beamLight;
        group.userData.beamTarget = beamTarget;

        const lanternGlow = new THREE.PointLight(0xffffcc, 3, 30, 2);
        lanternGlow.position.set(0, baseH + towerH + 0.7, 0);
        group.add(lanternGlow);
        group.userData.lanternGlow = lanternGlow;

        const topLight = new THREE.PointLight(0xff2222, 0, 15, 2);
        topLight.position.set(0, baseH + towerH + 2.65, 0);
        group.add(topLight);
        group.userData.topLight = topLight;

        group.position.set(lx, lh, lz);
        this.group.add(group);
        this.cityBuildings.push(group);
        this.lighthouseGroup = group;
    }

    generateVehicles(terrain, roadPositionsX, roadPositionsZ, halfSize, vehicleCount) {
        const maxVehicles = vehicleCount != null ? vehicleCount : 5;
        if (this.roads.length === 0) return;

        for (let i = 0; i < maxVehicles; i++) {
            const road = this.roads[Math.floor(Math.random() * this.roads.length)];
            const isH = Math.abs(road.dir.z) < 0.1;
            const speed = 2 + Math.random() * 3;
            const goesEndToStart = road.oneWay === 'end';
            const lane = goesEndToStart ? -0.5 : 0.5;

            const t = 0.1 + Math.random() * 0.8;
            // Position on road centerline (always same regardless of direction)
            const rx = road.start.x + road.dir.x * road.length * t;
            const rz = road.start.z + road.dir.z * road.length * t;
            const rh = terrain.getHeight(rx, rz);
            if (rh < terrain.waterLevel + 0.3) continue;

            const vType = VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];
            const vehicle = this.createVehicle(isH, 1, vType);

            const px = isH ? rx : rx + lane;
            const pz = isH ? rz + lane : rz;
            vehicle.position.set(px, rh + 0.3, pz);

            vehicle.userData = {
                isHorizontal: isH,
                speed,
                currentSpeed: speed,
                halfSize,
                lane,
                isBoat: false,
                vehicleType: vType,
                road,
                progress: goesEndToStart ? 1.0 - t : t,
                reverse: goesEndToStart,
                turning: false,
                turnTimer: 0,
                stuckTimer: 0,
            };

            this.group.add(vehicle);
            this.vehicles.push(vehicle);
        }
    }

    createVehicle(isHorizontal, direction, vehicleType) {
        const group = new THREE.Group();
        const vType = vehicleType || 'sedan';

        if (vType === 'bus') {
            const bodyGeo = new THREE.BoxGeometry(2.5, 0.8, 0.8);
            const bodyMat = new THREE.MeshPhongMaterial({ color: 0x3366cc, shininess: 40 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.4;
            body.castShadow = true;
            group.add(body);

            const winGeo = new THREE.BoxGeometry(2.3, 0.35, 0.82);
            const winMat = new THREE.MeshPhongMaterial({ color: 0x88bbdd, transparent: true, opacity: 0.5, shininess: 100 });
            const win = new THREE.Mesh(winGeo, winMat);
            win.position.y = 0.7;
            group.add(win);

            const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8);
            const wheelMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
            for (const wp of [[-0.8, 0.1, 0.42], [-0.8, 0.1, -0.42], [0.8, 0.1, 0.42], [0.8, 0.1, -0.42]]) {
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.position.set(...wp);
                wheel.rotation.x = Math.PI / 2;
                group.add(wheel);
            }
        } else if (vType === 'fire_truck') {
            const bodyGeo = new THREE.BoxGeometry(2.2, 0.7, 0.8);
            const bodyMat = new THREE.MeshPhongMaterial({ color: 0xcc2222, shininess: 40 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.35;
            body.castShadow = true;
            group.add(body);

            const cabGeo = new THREE.BoxGeometry(0.7, 0.6, 0.78);
            const cabMat = new THREE.MeshPhongMaterial({ color: 0xcc2222, shininess: 40 });
            const cab = new THREE.Mesh(cabGeo, cabMat);
            cab.position.set(0.75, 0.7, 0);
            group.add(cab);

            const ladderGeo = new THREE.BoxGeometry(1.8, 0.05, 0.08);
            const ladderMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 80 });
            const ladder = new THREE.Mesh(ladderGeo, ladderMat);
            ladder.position.set(-0.1, 0.75, 0);
            group.add(ladder);

            const wheelGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8);
            const wheelMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
            for (const wp of [[-0.7, 0.1, 0.42], [-0.7, 0.1, -0.42], [0.7, 0.1, 0.42], [0.7, 0.1, -0.42]]) {
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.position.set(...wp);
                wheel.rotation.x = Math.PI / 2;
                group.add(wheel);
            }
        } else if (vType === 'school_bus') {
            const bodyGeo = new THREE.BoxGeometry(2.0, 0.7, 0.75);
            const bodyMat = new THREE.MeshPhongMaterial({ color: 0xddcc22, shininess: 40 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.35;
            body.castShadow = true;
            group.add(body);

            const winGeo = new THREE.BoxGeometry(1.8, 0.3, 0.77);
            const winMat = new THREE.MeshPhongMaterial({ color: 0x88bbdd, transparent: true, opacity: 0.5, shininess: 100 });
            const win = new THREE.Mesh(winGeo, winMat);
            win.position.y = 0.6;
            group.add(win);

            const stripeGeo = new THREE.BoxGeometry(2.02, 0.08, 0.76);
            const stripeMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.y = 0.25;
            group.add(stripe);

            const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8);
            const wheelMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
            for (const wp of [[-0.6, 0.08, 0.4], [-0.6, 0.08, -0.4], [0.6, 0.08, 0.4], [0.6, 0.08, -0.4]]) {
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.position.set(...wp);
                wheel.rotation.x = Math.PI / 2;
                group.add(wheel);
            }
        } else {
            const bodyGeo = new THREE.BoxGeometry(1.2, 0.4, 0.6);
            const colorIdx = Math.floor(Math.random() * VEHICLE_COLORS.length);
            const bodyMat = new THREE.MeshPhongMaterial({
                color: VEHICLE_COLORS[colorIdx], shininess: 60
            });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 0.2;
            body.castShadow = true;
            group.add(body);

            const cabinGeo = new THREE.BoxGeometry(0.6, 0.3, 0.55);
            const cabinMat = new THREE.MeshPhongMaterial({
                color: 0x88bbdd, transparent: true, opacity: 0.6, shininess: 100
            });
            const cabin = new THREE.Mesh(cabinGeo, cabinMat);
            cabin.position.set(-0.1, 0.45, 0);
            group.add(cabin);

            const wheelGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 8);
            const wheelMat = new THREE.MeshPhongMaterial({ color: 0x222222 });
            const wheelPositions = [
                [-0.35, 0.08, 0.32], [-0.35, 0.08, -0.32],
                [0.35, 0.08, 0.32], [0.35, 0.08, -0.32]
            ];
            for (const wp of wheelPositions) {
                const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                wheel.position.set(...wp);
                wheel.rotation.x = Math.PI / 2;
                group.add(wheel);
            }
        }

        const headlightGeo = new THREE.SphereGeometry(0.07, 8, 6);
        const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
        const hlMesh1 = new THREE.Mesh(headlightGeo, headlightMat);
        hlMesh1.position.set(direction * 0.65, 0.25, 0.2);
        group.add(hlMesh1);
        const hlMesh2 = new THREE.Mesh(headlightGeo, headlightMat);
        hlMesh2.position.set(direction * 0.65, 0.25, -0.2);
        group.add(hlMesh2);

        const hlSpot = new THREE.SpotLight(0xffffcc, 0, 30, Math.PI / 7, 0.4, 1.8);
        const hlTarget = new THREE.Object3D();
        hlTarget.position.set(direction * 12, -0.8, 0);
        group.add(hlTarget);
        hlSpot.target = hlTarget;
        hlSpot.position.set(direction * 0.65, 0.25, 0);
        hlSpot.castShadow = false;
        group.add(hlSpot);
        group.userData.headlight = hlSpot;

        const hlPoint = new THREE.PointLight(0xffffcc, 0, 12, 2);
        hlPoint.position.set(direction * 0.65, 0.25, 0);
        group.add(hlPoint);
        group.userData.headlightPoint = hlPoint;

        const tailGeo = new THREE.SphereGeometry(0.05, 6, 4);
        const tailMat = new THREE.MeshBasicMaterial({
            color: 0xff0000, transparent: true, opacity: 0.9
        });
        const tail1 = new THREE.Mesh(tailGeo, tailMat.clone());
        tail1.position.set(-direction * 0.65, 0.25, 0.2);
        group.add(tail1);
        const tail2 = new THREE.Mesh(tailGeo, tailMat.clone());
        tail2.position.set(-direction * 0.65, 0.25, -0.2);
        group.add(tail2);
        group.userData.tailLightMat = tailMat;

        if (!isHorizontal) {
            group.rotation.y = Math.PI / 2;
        }
        if (direction < 0) {
            group.rotation.y += Math.PI;
        }

        return group;
    }

    createBoats(terrain) {
        const boatCount = 3;
        for (let i = 0; i < boatCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = terrain.size * 0.3 + Math.random() * terrain.size * 0.1;
            const bx = Math.cos(angle) * r;
            const bz = Math.sin(angle) * r;

            const boatGroup = new THREE.Group();

            const hullGeo = new THREE.BoxGeometry(1.5, 0.4, 0.6);
            const hullMat = new THREE.MeshPhongMaterial({ color: 0x445566 });
            const hull = new THREE.Mesh(hullGeo, hullMat);
            hull.position.y = 0.2;
            boatGroup.add(hull);

            const bowGeo = new THREE.ConeGeometry(0.3, 0.6, 4);
            const bow = new THREE.Mesh(bowGeo, hullMat);
            bow.rotation.z = -Math.PI / 2;
            bow.position.set(1.0, 0.2, 0);
            boatGroup.add(bow);

            const mastGeo = new THREE.CylinderGeometry(0.03, 0.03, 2, 4);
            const mastMat = new THREE.MeshPhongMaterial({ color: 0x8b7355 });
            const mast = new THREE.Mesh(mastGeo, mastMat);
            mast.position.y = 1.2;
            boatGroup.add(mast);

            const sailGeo = new THREE.PlaneGeometry(0.8, 1.2);
            const sailMat = new THREE.MeshPhongMaterial({ color: 0xffffff, side: THREE.DoubleSide });
            const sail = new THREE.Mesh(sailGeo, sailMat);
            sail.position.set(0.4, 1.4, 0);
            boatGroup.add(sail);

            boatGroup.position.set(bx, terrain.waterLevel + 0.1, bz);
            boatGroup.userData = {
                isBoat: true,
                bobOffset: Math.random() * Math.PI * 2,
                sailAngle: angle
            };

            this.group.add(boatGroup);
            this.vehicles.push(boatGroup);
        }
    }

    setLights(on) {
        this.lightsOn = on;
    }

    regenerateVehicles(terrain, vehicleCount) {
        for (const v of this.vehicles) {
            this.group.remove(v);
            v.traverse((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => m.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            });
        }
        this.vehicles = [];

        if (terrain.terrainType === 'islands') {
            this.createBoats(terrain);
        } else {
            this.generateVehicles(terrain, this.roadPositionsX, this.roadPositionsZ, this.halfSize, vehicleCount);
        }
    }

    checkPenetration(objX, objZ, objW, objD) {
        for (const bld of this.placedBuildings) {
            const overlapX = Math.abs(objX - bld.x) < (objW / 2 + bld.w / 2 + 0.5);
            const overlapZ = Math.abs(objZ - bld.z) < (objD / 2 + bld.d / 2 + 0.5);
            if (overlapX && overlapZ) return true;
        }
        for (const road of this.roads) {
            const dx = objX - (road.start.x + road.end.x) / 2;
            const dz = objZ - (road.start.z + road.end.z) / 2;
            const isHRoad = Math.abs(road.start.z - road.end.z) < 0.1;
            if (isHRoad) {
                if (Math.abs(dz) < road.width / 2 + objD / 2 + 0.3) return true;
            } else {
                if (Math.abs(dx) < road.width / 2 + objW / 2 + 0.3) return true;
            }
        }
        return false;
    }

    // =====================================================================
    // FIX: 只允许从下一条路的 start 端进入（顺向衔接）
    //      彻底消除环路上的双向对撞
    //      仅在真正死路（无顺向出口）时才允许 reverse 掉头
    // =====================================================================
    // =========================================================================
    // 严格单向拓扑：
    //   road.oneWay='start' → 车必须从 r.start 进入，正向行驶
    //   road.oneWay='end'   → 车必须从 r.end   进入，反向行驶
    // =========================================================================
    findOutgoingRoad(currentRoad, endX, endZ) {
        const nodeEps = 2.5;
        const curIsH = Math.abs(currentRoad.dir.z) < 0.1;
        const candidates = [];

        for (const r of this.roads) {
            if (r === currentRoad) continue;

            // oneWay='start'：只允许从 r.start 进（reverse=false）
            // oneWay='end'  ：只允许从 r.end   进（reverse=true）
            const entryX = r.oneWay === 'end' ? r.end.x   : r.start.x;
            const entryZ = r.oneWay === 'end' ? r.end.z   : r.start.z;
            const needsReverse = r.oneWay === 'end';

            const d = (entryX - endX) ** 2 + (entryZ - endZ) ** 2;
            if (d < nodeEps * nodeEps) {
                candidates.push({ road: r, reverse: needsReverse });
            }
        }

        if (candidates.length === 0) return null;

        // 优先选转弯（减少同一方向排队）
        const turning = candidates.filter(c => (Math.abs(c.road.dir.z) < 0.1) !== curIsH);
        const pool = turning.length > 0 ? turning : candidates;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    update(time, delta) {
        const dt = Math.min(delta || 0.016, 0.05);

        for (let i = 0; i < this.vehicles.length; i++) {
            const v = this.vehicles[i];
            const ud = v.userData;
            if (ud.isBoat) {
                v.position.y += Math.sin(time * 0.8 + ud.bobOffset) * 0.002;
                v.rotation.z = Math.sin(time * 0.5 + ud.bobOffset) * 0.03;
                continue;
            }

            // 转弯动画：沿贝塞尔弧线平滑过渡
            if (ud.turning) {
                ud.turnTimer += dt;
                const t = Math.min(1, ud.turnTimer / 0.35);

                // 缓动函数
                const s = t * t * (3 - 2 * t);

                // 二次贝塞尔：B(t) = (1-t)²·P0 + 2(1-t)t·P1 + t²·P2
                const u = 1 - s;
                v.position.x = u*u * (ud.turnStartX||0) + 2*u*s * (ud.turnMidX||0) + s*s * (ud.turnEndX||0);
                v.position.z = u*u * (ud.turnStartZ||0) + 2*u*s * (ud.turnMidZ||0) + s*s * (ud.turnEndZ||0);
                v.position.y = (this.terrain
                    ? this.terrain.getHeight(v.position.x, v.position.z) + 0.3
                    : v.position.y);

                // 旋转平滑过渡
                const targetR = ud.turnTargetR || 0;
                let diff = targetR - v.rotation.y;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                v.rotation.y += diff * Math.min(1, dt * 12);

                if (t >= 1) {
                    ud.turning = false;
                    v.rotation.y = targetR;
                    ud.currentSpeed = Math.max(ud.currentSpeed, ud.speed * 0.3);
                }
                continue;
            }

            const road = ud.road;
            if (!road) continue;
            const isH = Math.abs(road.dir.z) < 0.1;

            let brakeDist = Infinity;

            const nextEndX = road.end.x, nextEndZ = road.end.z;
            const distToEnd = (1.0 - ud.progress) * road.length;
            for (const tl of this.trafficLights) {
                const tlx = tl.group.position.x, tlz = tl.group.position.z;
                const toL = Math.sqrt((tlx - v.position.x) ** 2 + (tlz - v.position.z) ** 2);
                if (toL < 8) {
                    const ph = (time + tl.phase) % 10;
                    const greenH = ph < 4.2;
                    if ((isH && !greenH) || (!isH && greenH)) {
                        if (toL < brakeDist) brakeDist = toL;
                    }
                }
            }

            for (let j = 0; j < this.vehicles.length; j++) {
                if (i === j) continue;
                const o = this.vehicles[j];
                if (o.userData.isBoat || o.userData.turning) continue;
                const odx = o.position.x - v.position.x;
                const odz = o.position.z - v.position.z;
                const od = Math.sqrt(odx * odx + odz * odz);
                if (od > 10) continue;

                if (o.userData.road === road) {
                    // 同路段：FIX - 只有同向车才让路（避免对向车互相刹车）
                    if (o.userData.reverse === ud.reverse) {
                        let gap;
                        if (ud.reverse) {
                            gap = (ud.progress - o.userData.progress) * road.length;
                        } else {
                            gap = (o.userData.progress - ud.progress) * road.length;
                        }
                        if (gap > 0 && gap < brakeDist) brakeDist = gap;
                    }
                    // 对向车：不刹车，由 findOutgoingRoad 的单向约束保证不会出现对向车
                } else {
                    const oRoad = o.userData.road;
                    if (!oRoad) continue;
                    const oEndX = oRoad.end.x, oEndZ = oRoad.end.z;
                    const sameNode = (Math.abs(nextEndX - oEndX) < 1.5 && Math.abs(nextEndZ - oEndZ) < 1.5);
                    if (sameNode && distToEnd < 5) {
                        const oDistToEnd = (1.0 - o.userData.progress) * oRoad.length;
                        if (oDistToEnd < distToEnd && od < brakeDist) brakeDist = od;
                    }
                    if (od < 2.5 && od < brakeDist) brakeDist = od;
                }
            }

            if (brakeDist < 1.5) ud.currentSpeed = 0;
            else if (brakeDist < 6) ud.currentSpeed = Math.max(0.1, ud.speed * (brakeDist - 1.5) / 4.5);
            else ud.currentSpeed += (ud.speed - ud.currentSpeed) * Math.min(1, dt * 4);

            // 反堵塞
            if (ud.currentSpeed < 0.05) {
                ud.stuckTimer = (ud.stuckTimer || 0) + dt;
                if (ud.stuckTimer > 3) {
                    // 找到车前方最近的路口重定向
                    const junctionX = ud.reverse ? road.start.x : road.end.x;
                    const junctionZ = ud.reverse ? road.start.z : road.end.z;
                    const res = this.findOutgoingRoad(road, junctionX, junctionZ);
                    if (res) {
                        ud.road = res.road;
                        ud.reverse = res.reverse;
                        ud.lane = res.reverse ? -0.5 : 0.5;
                        ud.progress = res.reverse ? 0.98 : 0.02;
                        ud.stuckTimer = 0;
                        ud.currentSpeed = ud.speed * 0.5;
                    }
                }
            } else {
                ud.stuckTimer = 0;
            }

            // 沿路段移动
            const move = ud.currentSpeed * dt * 2.5;
            const step = move / Math.max(road.length, 0.1);
            if (ud.reverse) {
                ud.progress -= step;
                if (ud.progress <= 0.0) { ud.progress = 0.0; }
            } else {
                ud.progress += step;
            }

            // =====================================================================
            // FIX: 路段末尾切换——严格保持单向衔接，lane 随 reverse 同步更新
            // =====================================================================
            if (ud.progress >= 1.0 || (ud.reverse && ud.progress <= 0.0)) {
                const atEnd = !ud.reverse; // true=到达end, false=到达start（逆向）
                const junctionX = atEnd ? road.end.x : road.start.x;
                const junctionZ = atEnd ? road.end.z : road.start.z;

                const savedX = v.position.x;
                const savedZ = v.position.z;

                let intersectionOccupied = false;
                for (let j = 0; j < this.vehicles.length; j++) {
                    if (i === j) continue;
                    const o = this.vehicles[j];
                    if (o.userData.isBoat) continue;
                    if ((o.position.x - junctionX) ** 2 + (o.position.z - junctionZ) ** 2 < 5.0) {
                        intersectionOccupied = true;
                        break;
                    }
                }

                if (intersectionOccupied) {
                    ud.currentSpeed = 0;
                    // 钉在路段末尾等待
                    ud.progress = atEnd ? 0.99 : 0.01;
                } else {
                    const result = this.findOutgoingRoad(road, junctionX, junctionZ);
                    if (result) {
                        const nextRoad = result.road;
                        const reverse  = result.reverse;
                        const beforeIsH = Math.abs(road.dir.z) < 0.1;
                        const afterIsH  = Math.abs(nextRoad.dir.z) < 0.1;

                        ud.road    = nextRoad;
                        ud.reverse = reverse;
                        // FIX: lane 与 reverse 保持一致
                        ud.lane    = reverse ? -0.5 : 0.5;

                        // 在新路段上计算初始 progress
                        // progress 始终 = 距离 start 的比例 (0=start, 1=end)
                        // reverse=true 时车从 end 进，progress 自然 ≈ 1.0，后续递减
                        if (afterIsH) {
                            ud.progress = (savedX - nextRoad.start.x) / Math.max(nextRoad.length, 0.1);
                        } else {
                            ud.progress = (savedZ - nextRoad.start.z) / Math.max(nextRoad.length, 0.1);
                        }
                        ud.progress = Math.max(0.01, Math.min(0.99, ud.progress));

                        // 转弯弧线：记录起点(旧路末端)、终点(新路入口)、控制点(路口外角)
                        if (beforeIsH !== afterIsH) {
                            ud.turning    = true;
                            ud.turnTimer  = 0;
                            // 起点 = 车在旧路末端的位置
                            ud.turnStartX = savedX;
                            ud.turnStartZ = savedZ;
                            // 终点 = 车在新路上的位置
                            const nIsH = afterIsH;
                            const npx = nextRoad.start.x + nextRoad.dir.x * nextRoad.length * ud.progress;
                            const npz = nextRoad.start.z + nextRoad.dir.z * nextRoad.length * ud.progress;
                            ud.turnEndX = nIsH ? npx : npx + ud.lane;
                            ud.turnEndZ = nIsH ? npz + ud.lane : npz;
                            // 控制点 = 路口外角：取 (endX, startZ) 或 (startX, endZ)
                            const caX = ud.turnEndX, caZ = ud.turnStartZ;
                            const cbX = ud.turnStartX, cbZ = ud.turnEndZ;
                            const caDist = Math.abs(caX - (ud.turnStartX+ud.turnEndX)/2) + Math.abs(caZ - (ud.turnStartZ+ud.turnEndZ)/2);
                            const cbDist = Math.abs(cbX - (ud.turnStartX+ud.turnEndX)/2) + Math.abs(cbZ - (ud.turnStartZ+ud.turnEndZ)/2);
                            ud.turnMidX = caDist > cbDist ? caX : cbX;
                            ud.turnMidZ = caDist > cbDist ? caZ : cbZ;
                            // 目标朝向
                            ud.turnTargetR = afterIsH
                                ? (reverse ? Math.PI : 0)
                                : (reverse ? -Math.PI/2 : Math.PI/2);
                        } else {
                            ud.turning = false;
                        }
                        ud.turnTimer = 0;
                        ud.stuckTimer = 0;
                    } else {
                        // 真正死路：重置到路段起点
                        ud.progress  = 0.02;
                        ud.reverse   = false;
                        ud.lane      = 0.5;
                        ud.stuckTimer = 0;
                    }
                }
            }

            // 根据当前路段更新世界坐标
            const curRoad = ud.road || road;
            const curIsH = Math.abs(curRoad.dir.z) < 0.1;
            const cpx = curRoad.start.x + curRoad.dir.x * curRoad.length * ud.progress;
            const cpz = curRoad.start.z + curRoad.dir.z * curRoad.length * ud.progress;
            v.position.x = curIsH ? cpx : cpx + ud.lane;
            v.position.z = curIsH ? cpz + ud.lane : cpz;
            v.position.y = (this.terrain ? this.terrain.getHeight(v.position.x, v.position.z) + 0.3 : v.position.y);

            // FIX: 朝向根据 reverse 和路向两维确定
            if (curIsH) {
                v.rotation.y = ud.reverse ? Math.PI : 0;
            } else {
                v.rotation.y = ud.reverse ? -Math.PI / 2 : Math.PI / 2;
            }
        }

        // 紧急推开（防重叠）
        for (let i = 0; i < this.vehicles.length; i++) {
            for (let j = i + 1; j < this.vehicles.length; j++) {
                const a = this.vehicles[i], b = this.vehicles[j];
                if (a.userData.isBoat || b.userData.isBoat) continue;
                const dx = a.position.x - b.position.x,
                    dz = a.position.z - b.position.z;
                const d = Math.sqrt(dx * dx + dz * dz);
                if (d < 2.0 && d > 0.01) {
                    const push = (2.0 - d) * 0.25;
                    a.position.x += (dx / d) * push;
                    a.position.z += (dz / d) * push;
                    b.position.x -= (dx / d) * push;
                    b.position.z -= (dz / d) * push;
                }
            }
        }

        // 交通灯循环
        const cycleTime = 10;
        for (const tl of this.trafficLights) {
            const phase = (time + tl.phase) % cycleTime;
            let activeIndex;
            if (phase < cycleTime * 0.42) {
                activeIndex = 2;
            } else if (phase < cycleTime * 0.5) {
                activeIndex = 1;
            } else {
                activeIndex = 0;
            }
            for (let i = 0; i < tl.bulbs.length; i++) {
                const isActive = i === activeIndex;
                tl.bulbs[i].material.color.set(isActive ? tl.colors[i] : 0x333333);
                tl.bulbs[i].material.opacity = isActive ? 1.0 : 0.3;
                tl.bulbs[i].material.emissive = isActive ? new THREE.Color(tl.colors[i]) : new THREE.Color(0x000000);
                tl.bulbs[i].material.emissiveIntensity = isActive ? 0.8 : 0;
            }
            tl.pointLight.color.set(tl.colors[activeIndex]);
            tl.pointLight.intensity = 1.5;
        }

        // 灯塔扫描光束
        for (const bld of this.cityBuildings) {
            if (bld.userData.beamLight && bld.userData.beamTarget) {
                const beamAngle = time * 0.7;
                const beamRadius = 45;
                bld.userData.beamTarget.position.set(
                    Math.cos(beamAngle) * beamRadius,
                    -5 + Math.sin(time * 0.3) * 1,
                    Math.sin(beamAngle) * beamRadius
                );
                const pulse = 8 + Math.sin(time * 1.8) * 2 + Math.sin(time * 3.7) * 1;
                bld.userData.beamLight.intensity = Math.max(5, pulse);
            }
            if (bld.userData.lanternGlow) {
                bld.userData.lanternGlow.intensity = 2.5 + Math.sin(time * 1.5) * 0.5 + Math.sin(time * 2.7) * 0.3;
            }
            if (bld.userData.topLight && bld.userData.topBulb) {
                const blinkPhase = time * 3;
                const blink = Math.sin(blinkPhase) > 0.3;
                bld.userData.topLight.intensity = blink ? 2.0 : 0.1;
                if (bld.userData.topBulb) {
                    bld.userData.topBulb.material.opacity = blink ? 1.0 : 0.15;
                }
            }
        }
    }

    updateSnowAccum(isSnowing, deltaTime) {
        if (isSnowing) {
            this.snowAccum = Math.min(1.0, (this.snowAccum || 0) + deltaTime * 0.04);
        } else {
            this.snowAccum = Math.max(0.0, (this.snowAccum || 0) - deltaTime * 0.08);
        }

        for (const bld of this.cityBuildings) {
            if (!bld.userData.snowData && this.snowAccum > 0.1) {
                let topY = -Infinity;
                bld.traverse(child => {
                    if (child.isMesh && child.geometry) {
                        const worldPos = new THREE.Vector3();
                        child.getWorldPosition(worldPos);
                        const localY = bld.worldToLocal(worldPos.clone()).y;
                        const geoParams = child.geometry.parameters;
                        if (geoParams) {
                            let meshTop = localY;
                            if (geoParams.height) meshTop += geoParams.height / 2;
                            if (geoParams.radius) meshTop += geoParams.radius;
                            if (geoParams.radiusTop) meshTop += Math.max(geoParams.radiusTop, 0);
                            if (meshTop > topY) {
                                topY = meshTop;
                            }
                        }
                    }
                });

                if (topY > 0) {
                    const bWidth = 3 + Math.random() * 2;
                    const bDepth = 3 + Math.random() * 2;
                    const snowGeo = new THREE.CylinderGeometry(
                        Math.max(bWidth, bDepth) * 0.45,
                        Math.max(bWidth, bDepth) * 0.55,
                        0.2, 8
                    );
                    const snowMat = new THREE.MeshPhongMaterial({
                        color: 0xf0f0f5,
                        flatShading: true,
                        transparent: true,
                        opacity: 0.95,
                        emissive: new THREE.Color(0x111122),
                        emissiveIntensity: 0.03
                    });
                    const snowMesh = new THREE.Mesh(snowGeo, snowMat);
                    snowMesh.position.y = topY + 0.1;
                    snowMesh.visible = false;
                    bld.add(snowMesh);
                    bld.userData.snowMesh = snowMesh;
                    bld.userData.snowData = { topY, bWidth, bDepth };
                }
            }

            if (bld.userData.snowMesh) {
                const sm = bld.userData.snowMesh;
                sm.visible = this.snowAccum > 0.12;
                if (sm.visible) {
                    const scale = 0.3 + this.snowAccum * 0.85;
                    sm.scale.set(scale, 0.5 + this.snowAccum * 1.2, scale);
                    sm.material.opacity = Math.min(0.95, this.snowAccum * 1.1);
                    sm.material.emissiveIntensity = this.snowAccum * 0.05;
                }
            }
        }
    }

    regenerateStreetLights(terrain) {
        for (const sl of this.streetLightLamps) {
            this.group.remove(sl.group);
            sl.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
        }
        this.streetLightLamps = [];
        const spacing = this.lightSpacing;
        const placed = new Set();
        for (const road of this.roads) {
            const len = road.length, isH = Math.abs(road.dir.z) < 0.1;
            const n = Math.max(1, Math.floor(len / spacing));
            for (let l = 0; l < n; l++) {
                const t = (l + 0.5) / n;
                const lx = road.start.x + road.dir.x * len * t;
                const lz = road.start.z + road.dir.z * len * t;
                const lk = Math.round(lx) + ',' + Math.round(lz);
                if (placed.has(lk)) continue;
                const lh = terrain.getHeight(lx, lz);
                if (lh < terrain.waterLevel + 0.3) continue;
                for (const side of [-1, 1]) {
                    const off = side * (road.width / 2 + 0.6);
                    const slx = isH ? lx : lx + off, slz = isH ? lz + off : lz;
                    const slh = terrain.getHeight(slx, slz);
                    if (slh < terrain.waterLevel + 0.3) continue;
                    const arm = isH ? (side === -1 ? Math.PI / 2 : -Math.PI / 2) : (side === -1 ? 0 : Math.PI);
                    this.createStreetLight(slx, slh, slz, terrain, arm);
                }
                placed.add(lk);
            }
        }
    }

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
        this.roadMat = null;
        this.roadDashMat = null;
        this.roadLineMat = null;
        this.roadSidewalkMat = null;
        this.roadPositions = [];
        this.roadPositionsX = [];
        this.roadPositionsZ = [];
        this.halfSize = 0;
        this.placedBuildings = [];
        this.snowAccum = 0;
        this.lighthouseGroup = null;
    }
}

export { CitySystem };