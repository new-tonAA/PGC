import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

const VEHICLE_COLORS = [
    0xcc2222, 0x2255cc, 0x22cc44, 0xcccc22, 0xffffff,
    0x222222, 0xcc8822, 0x888888
];

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
        dockPlank: new THREE.BoxGeometry(2.0, 0.1, 0.8),
        boatHull: new THREE.BoxGeometry(1.5, 0.3, 0.5),
        boatCabin: new THREE.BoxGeometry(0.4, 0.3, 0.35),
        treeTrunk: new THREE.CylinderGeometry(0.12, 0.18, 2.0, 5),
        treeCanopy: new THREE.SphereGeometry(1.0, 6, 4),
    };
    return _sharedGeo;
}

const Mats = {
    road: new THREE.MeshPhongMaterial({ color: 0x222228, shininess: 15 }),
    roadLine: new THREE.MeshBasicMaterial({ color: 0xdddd44 }),
    sidewalk: new THREE.MeshPhongMaterial({ color: 0x888880, shininess: 5 }),
    crosswalk: new THREE.MeshBasicMaterial({ color: 0xeeeeee }),
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
    parkGround: new THREE.MeshPhongMaterial({ color: 0x3a7a3a }),
    treeTrunkMat: new THREE.MeshPhongMaterial({ color: 0x5a3a1a }),
    treeCanopyMat: new THREE.MeshPhongMaterial({ color: 0x2a6a2a, flatShading: true }),
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
        this.isFlatCity = false;
        this.geos = getSharedGeos();
    }

    generate(terrain, seed, vehicleCount, buildingDensity) {
        this.clear();
        this.noise = new SimplexNoise(seed);
        this.isFlatCity = terrain.terrainType === 'city';
        this.scene.add(this.group);
        this.roadDensity = 50;
        this.lightSpacing = 12;
        let bldDensity = buildingDensity;
        if (typeof buildingDensity === 'object' && buildingDensity !== null) {
            bldDensity = Math.max(1, buildingDensity.buildingDensity || buildingDensity.buildingCount || 8);
            this.roadDensity = buildingDensity.roadDensity || 50;
            this.lightSpacing = buildingDensity.lightSpacing || 12;
        }
        if (typeof bldDensity !== 'number') bldDensity = 8;

        const type = terrain.terrainType;
        if (type === 'islands') {
            this.generateIslandCity(terrain, vehicleCount);
        } else if (type === 'coastal') {
            this.generateCoastalCity(terrain, vehicleCount);
        } else {
            this.generateGridCity(terrain, vehicleCount, bldDensity, type === 'suburban');
        }
    }

    // ==========================================
    // GRID CITY - Cities Skylines feel
    // ==========================================
    generateGridCity(terrain, vehicleCount, buildingDensity, isSuburban) {
        const halfSize = isSuburban ? terrain.size * 0.28 : terrain.size * 0.4;
        const wl = terrain.waterLevel;
        const isCity = terrain.terrainType === 'city';

        // Primary road grid — responsive to Road Density slider
        const dens = (this.roadDensity || 50) / 50;
        const primarySpacing = Math.max(5, Math.round(isSuburban ? (10 / dens) : (8 / dens)));
        const primaryWidth = isSuburban ? 3 : 3.5;
        const primaryPos = [];
        for (let p = -halfSize; p <= halfSize; p += primarySpacing) {
            primaryPos.push(p);
        }

        // Secondary road grid (side streets) - only for city
        const secondaryWidth = 2;
        const secondaryPos = [];
        if (!isSuburban) {
            for (let i = 0; i < primaryPos.length - 1; i++) {
                secondaryPos.push((primaryPos[i] + primaryPos[i + 1]) / 2);
            }
        }

        const allPos = [...primaryPos, ...secondaryPos].sort((a, b) => a - b);
        const roadInfo = new Map();
        for (const p of primaryPos) roadInfo.set(p, { width: primaryWidth, primary: true });
        for (const p of secondaryPos) roadInfo.set(p, { width: secondaryWidth, primary: false });

        // Create road network
        const roadLen = halfSize * 2 + primarySpacing;
        for (const pos of allPos) {
            const ri = roadInfo.get(pos);
            this.createRoadPlane(0, pos, roadLen, ri.width, true, terrain, isCity);
            this.createRoadPlane(pos, 0, roadLen, ri.width, false, terrain, isCity);
        }

        // Sidewalks along primary roads
        for (const pos of primaryPos) {
            const pw = roadInfo.get(pos).width;
            // Horizontal road at z=pos: sidewalks offset in z
            this.createSidewalk(0, pos - pw / 2 - 0.7, roadLen, 0.7, true, terrain, isCity);
            this.createSidewalk(0, pos + pw / 2 + 0.7, roadLen, 0.7, true, terrain, isCity);
            // Vertical road at x=pos: sidewalks offset in x
            this.createSidewalk(pos - pw / 2 - 0.7, 0, roadLen, 0.7, false, terrain, isCity);
            this.createSidewalk(pos + pw / 2 + 0.7, 0, roadLen, 0.7, false, terrain, isCity);
        }

        // Intersections + traffic lights + crosswalks
        const primaryIdx = {};
        primaryPos.forEach((p, i) => primaryIdx[p] = i);

        for (const xPos of allPos) {
            for (const zPos of allPos) {
                const h = terrain.getHeight(xPos, zPos);
                if (h < wl + 0.3) continue;

                const xInfo = roadInfo.get(xPos);
                const zInfo = roadInfo.get(zPos);

                if (xInfo.primary && zInfo.primary) {
                    this.intersections.push({ x: xPos, z: zPos });

                    // Traffic light at every 2nd primary intersection
                    const xi = primaryIdx[xPos];
                    const zi = primaryIdx[zPos];
                    if ((xi + zi) % 2 === 0) {
                        this.createTrafficLight(xPos, zPos, h, primaryWidth);
                    }

                    // Crosswalks at primary intersections
                    this.createCrosswalk(xPos, zPos, h, xInfo.width, zInfo.width, isCity);
                }
            }
        }

        // Buildings with zoning - iterate over primary blocks
        for (let i = 0; i < primaryPos.length - 1; i++) {
            for (let j = 0; j < primaryPos.length - 1; j++) {
                const x1 = primaryPos[i], x2 = primaryPos[i + 1];
                const z1 = primaryPos[j], z2 = primaryPos[j + 1];

                // Block center (offset inward from roads)
                const cx = (x1 + x2) / 2;
                const cz = (z1 + z2) / 2;
                const h = terrain.getHeight(cx, cz);
                if (h < wl + 0.3) continue;

                const blockW = (x2 - x1) - primaryWidth;
                const blockD = (z2 - z1) - primaryWidth;

                // Zone by distance from center
                const dist = Math.sqrt(cx * cx + cz * cz);
                let zone, maxBldgs;
                if (isSuburban) {
                    zone = 'residential';
                    maxBldgs = 1;
                } else if (dist < 10) {
                    zone = 'downtown';
                    maxBldgs = 3;
                } else if (dist < 18) {
                    zone = 'commercial';
                    maxBldgs = 2;
                } else {
                    zone = 'residential';
                    maxBldgs = 1;
                }

                // Density from buildingDensity parameter
                const density = Math.min(1, buildingDensity / 15);
                const numBldgs = Math.max(1, Math.round(maxBldgs * density));

                // Park chance
                const parkChance = zone === 'residential' ? 0.15 : zone === 'commercial' ? 0.08 : 0.03;
                const nVal = this.noise.noise2D(cx * 0.5, cz * 0.5);
                if (nVal > (1 - parkChance * 4)) {
                    this.createPark(cx, h, cz, blockW, blockD, isCity);
                    continue;
                }

                // Place buildings within block
                for (let b = 0; b < numBldgs; b++) {
                    const offsetX = numBldgs > 1 ? (b % 2 === 0 ? -blockW * 0.2 : blockW * 0.2) : 0;
                    const offsetZ = numBldgs > 2 ? (b < 2 ? -blockD * 0.15 : blockD * 0.15) : 0;
                    const bx = cx + offsetX;
                    const bz = cz + offsetZ;
                    const bh = terrain.getHeight(bx, bz);
                    if (bh < wl + 0.3) continue;

                    this.createBuilding(bx, bh, bz, zone, dist, isCity);
                }
            }
        }

        // Street lights along primary roads
        for (const pos of primaryPos) {
            const pw = roadInfo.get(pos).width;
            for (let t = -halfSize; t <= halfSize; t += (this.lightSpacing || 12)) {
                const h1 = terrain.getHeight(t, pos);
                if (h1 > wl + 0.2) {
                    this.createStreetLight(t - pw / 2 - 1.2, h1, pos);
                }
                const h2 = terrain.getHeight(pos, t);
                if (h2 > wl + 0.2) {
                    this.createStreetLight(pos, h2, t - pw / 2 - 1.2);
                }
            }
        }

        // Vehicles on primary roads
        this.generateVehicles(terrain, primaryPos, halfSize, vehicleCount, isCity);
    }

    // ==========================================
    // ROAD PLANE - at terrain height
    // ==========================================
    createRoadPlane(x, z, length, width, isHorizontal, terrain, isCity) {
        const wl = terrain.waterLevel;
        const halfLen = length / 2;

        // Sample terrain height at road center
        const sampleX = isHorizontal ? 0 : x;
        const sampleZ = isHorizontal ? z : 0;
        const centerH = terrain.getHeight(sampleX, sampleZ);

        // For flat city terrain, use fixed height; for others, use terrain height
        const roadY = isCity ? 0.05 : Math.max(centerH, 0) + 0.05;

        // Check if any part of road is on land
        let onLand = false;
        const checkStep = 8;
        for (let t = -halfLen; t <= halfLen; t += checkStep) {
            const checkH = isHorizontal ? terrain.getHeight(t, z) : terrain.getHeight(x, t);
            if (checkH > wl + 0.2) onLand = true;
        }
        if (!onLand) return;

        // Road surface
        const road = new THREE.Mesh(
            new THREE.PlaneGeometry(length, width),
            Mats.road
        );
        road.rotation.x = -Math.PI / 2;
        if (!isHorizontal) road.rotation.y = Math.PI / 2;
        road.position.set(x, roadY, z);
        road.receiveShadow = true;
        this.group.add(road);

        // Center line (continuous yellow strip)
        const centerLine = new THREE.Mesh(
            new THREE.PlaneGeometry(length, 0.12),
            Mats.roadLine
        );
        centerLine.rotation.x = -Math.PI / 2;
        if (!isHorizontal) centerLine.rotation.y = Math.PI / 2;
        centerLine.position.set(x, roadY + 0.01, z);
        this.group.add(centerLine);
    }

    // ==========================================
    // SIDEWALK
    // ==========================================
    createSidewalk(x, z, length, width, isHorizontal, terrain, isCity) {
        const wl = terrain.waterLevel;
        const halfLen = length / 2;

        // Check land
        let onLand = false;
        for (let t = -halfLen; t <= halfLen; t += 8) {
            const h = isHorizontal ? terrain.getHeight(t, z) : terrain.getHeight(x, t);
            if (h > wl + 0.2) onLand = true;
        }
        if (!onLand) return;

        const sampleX = isHorizontal ? 0 : x;
        const sampleZ = isHorizontal ? z : 0;
        const centerH = terrain.getHeight(sampleX, sampleZ);
        const sidewalkY = isCity ? 0.08 : Math.max(centerH, 0) + 0.08;

        const sidewalk = new THREE.Mesh(
            new THREE.PlaneGeometry(length, width),
            Mats.sidewalk
        );
        sidewalk.rotation.x = -Math.PI / 2;
        if (!isHorizontal) sidewalk.rotation.y = Math.PI / 2;
        sidewalk.position.set(x, sidewalkY, z);
        sidewalk.receiveShadow = true;
        this.group.add(sidewalk);
    }

    // ==========================================
    // CROSSWALK - white bars at intersection
    // ==========================================
    createCrosswalk(x, z, h, roadWidthH, roadWidthV, isCity) {
        const y = isCity ? 0.06 : Math.max(h, 0) + 0.06;
        const barW = 0.4;
        const gap = 0.3;
        const crossLen = roadWidthV * 0.7;

        // Bars crossing the vertical road (horizontal orientation)
        for (let s = -crossLen / 2; s <= crossLen / 2; s += barW + gap) {
            const bar = new THREE.Mesh(
                new THREE.PlaneGeometry(barW, roadWidthH * 0.6),
                Mats.crosswalk
            );
            bar.rotation.x = -Math.PI / 2;
            bar.position.set(x + s, y, z);
            this.group.add(bar);
        }

        // Bars crossing the horizontal road (vertical orientation)
        const crossLen2 = roadWidthH * 0.7;
        for (let s = -crossLen2 / 2; s <= crossLen2 / 2; s += barW + gap) {
            const bar = new THREE.Mesh(
                new THREE.PlaneGeometry(roadWidthV * 0.6, barW),
                Mats.crosswalk
            );
            bar.rotation.x = -Math.PI / 2;
            bar.position.set(x, y, z + s);
            this.group.add(bar);
        }
    }

    // ==========================================
    // BUILDING - zone-based diversity
    // ==========================================
    createBuilding(x, baseH, z, zone, distFromCenter, isCity) {
        const group = new THREE.Group();
        const nVal = this.noise.noise2D(x * 0.15, z * 0.15);
        const absN = Math.abs(nVal);

        let width, depth, height, wallColor, shininess, flatShade;

        if (zone === 'downtown') {
            width = 2.5 + absN * 2.5;
            depth = 2.5 + Math.random() * 2;
            const heightBase = 8 + (1 - distFromCenter / 12) * 18;
            height = Math.max(6, heightBase + nVal * 4);
            const colors = [0x556677, 0x667788, 0x445566, 0x8090a0, 0x708898];
            wallColor = colors[Math.floor(absN * 10) % colors.length];
            shininess = 80;
            flatShade = false;
        } else if (zone === 'commercial') {
            width = 3 + Math.random() * 2;
            depth = 2.5 + Math.random() * 1.5;
            height = 4 + Math.random() * 6 + absN * 2;
            const colors = [0xb0a8a0, 0xa0a098, 0xc0b8a0, 0x909088, 0xb8b0a0];
            wallColor = colors[Math.floor(absN * 10) % colors.length];
            shininess = 30;
            flatShade = false;
        } else {
            // Residential
            width = 2 + Math.random() * 1.5;
            depth = 2 + Math.random() * 1;
            height = 2 + Math.random() * 3;
            const colors = [0xd8c8b0, 0xc0d0c0, 0xb8a898, 0xa0b8a0, 0xd0c0b0];
            wallColor = colors[Math.floor(absN * 10) % colors.length];
            shininess = 10;
            flatShade = true;
        }

        const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, height, depth),
            new THREE.MeshPhongMaterial({ color: wallColor, flatShading: flatShade, shininess })
        );
        body.position.y = height / 2;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // Window strips (all 4 faces)
        const windowMeshes = [];
        if (height > 3) {
            const stripH = Math.min(height * 0.55, 6);
            const stripW = width * 0.75;
            const sideW = depth * 0.75;

            const front = new THREE.Mesh(new THREE.PlaneGeometry(stripW, stripH), Mats.windowOff);
            front.position.set(0, height * 0.4, depth / 2 + 0.01);
            group.add(front);
            windowMeshes.push(front);

            const back = new THREE.Mesh(new THREE.PlaneGeometry(stripW, stripH), Mats.windowOff);
            back.position.set(0, height * 0.4, -depth / 2 - 0.01);
            back.rotation.y = Math.PI;
            group.add(back);
            windowMeshes.push(back);

            const left = new THREE.Mesh(new THREE.PlaneGeometry(sideW, stripH), Mats.windowOff);
            left.rotation.y = Math.PI / 2;
            left.position.set(width / 2 + 0.01, height * 0.4, 0);
            group.add(left);
            windowMeshes.push(left);

            const right = new THREE.Mesh(new THREE.PlaneGeometry(sideW, stripH), Mats.windowOff);
            right.rotation.y = -Math.PI / 2;
            right.position.set(-width / 2 - 0.01, height * 0.4, 0);
            group.add(right);
            windowMeshes.push(right);
        }
        group.userData.windowMeshes = windowMeshes;

        // Roof / top details based on zone
        if (zone === 'downtown' && height > 12) {
            // Tall skyscraper: antenna + top section
            const topW = width * 0.55, topD = depth * 0.55, topH = 2 + Math.random() * 2;
            const top = new THREE.Mesh(
                new THREE.BoxGeometry(topW, topH, topD),
                new THREE.MeshPhongMaterial({ color: wallColor & 0xcccccc, shininess: 60 })
            );
            top.position.y = height + topH / 2;
            group.add(top);

            const antenna = new THREE.Mesh(this.geos.antenna, Mats.antenna);
            antenna.position.y = height + topH + 1;
            group.add(antenna);
            group.userData.hasTopLight = true;
        } else if (zone === 'downtown' && height > 8) {
            // Medium downtown: step-back top
            const topW = width * 0.65, topD = depth * 0.65, topH = 1.5 + Math.random();
            const top = new THREE.Mesh(
                new THREE.BoxGeometry(topW, topH, topD),
                new THREE.MeshPhongMaterial({ color: wallColor & 0xbbbbbb })
            );
            top.position.y = height + topH / 2;
            group.add(top);
        } else if (zone === 'commercial' && height > 5) {
            // Flat roof with edge
            const edge = new THREE.Mesh(
                new THREE.BoxGeometry(width + 0.2, 0.2, depth + 0.2),
                new THREE.MeshPhongMaterial({ color: wallColor & 0xaaaaaa })
            );
            edge.position.y = height + 0.1;
            group.add(edge);
        } else {
            // Residential: sloped roof or flat with color
            if (absN > 0.3) {
                // Sloped roof
                const roofH = Math.max(width, depth) * 0.35;
                const roof = new THREE.Mesh(
                    new THREE.ConeGeometry(Math.max(width, depth) * 0.72, roofH, 4),
                    new THREE.MeshPhongMaterial({ color: 0x884433, flatShading: true })
                );
                roof.position.y = height + roofH / 2;
                roof.rotation.y = Math.PI / 4;
                group.add(roof);
            } else {
                // Flat roof
                const edge = new THREE.Mesh(
                    new THREE.BoxGeometry(width + 0.15, 0.15, depth + 0.15),
                    new THREE.MeshPhongMaterial({ color: wallColor & 0xcccccc })
                );
                edge.position.y = height + 0.075;
                group.add(edge);
            }
        }

        const yPos = isCity ? 0 : Math.max(baseH, 0);
        group.position.set(x, yPos, z);
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // PARK
    // ==========================================
    createPark(cx, h, cz, width, depth, isCity) {
        const y = isCity ? 0.06 : Math.max(h, 0) + 0.06;
        const parkW = Math.max(width, 2);
        const parkD = Math.max(depth, 2);

        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(parkW, parkD),
            Mats.parkGround
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(cx, y, cz);
        ground.receiveShadow = true;
        this.group.add(ground);

        // A few trees
        const treeCount = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < treeCount; i++) {
            const tx = cx + (Math.random() - 0.5) * parkW * 0.5;
            const tz = cz + (Math.random() - 0.5) * parkD * 0.5;
            const tree = new THREE.Group();
            const trunk = new THREE.Mesh(this.geos.treeTrunk, Mats.treeTrunkMat);
            trunk.position.y = 1.0;
            tree.add(trunk);
            const canopy = new THREE.Mesh(this.geos.treeCanopy, Mats.treeCanopyMat);
            canopy.position.y = 2.2;
            canopy.castShadow = true;
            tree.add(canopy);
            tree.position.set(tx, y, tz);
            this.group.add(tree);
        }
    }

    // ==========================================
    // ISLAND CITY
    // ==========================================
    generateIslandCity(terrain, vehicleCount) {
        const halfSize = terrain.size * 0.25;
        const angles = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
        for (const angle of angles) {
            const endR = halfSize * 0.5;
            const road = new THREE.Mesh(
                new THREE.PlaneGeometry(endR, 2.5),
                Mats.road
            );
            road.rotation.x = -Math.PI / 2;
            road.rotation.y = angle;
            const r = endR * 0.5;
            road.position.set(Math.cos(angle) * r, terrain.waterLevel + 0.5, Math.sin(angle) * r);
            this.group.add(road);
        }

        this.createHarbor(terrain);
        this.createLighthouse(terrain);

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

        const boatCount = Math.max(1, Math.min(vehicleCount, 5));
        this.createBoats(terrain, boatCount);
    }

    // ==========================================
    // COASTAL CITY - roads only on land
    // ==========================================
    generateCoastalCity(terrain, vehicleCount) {
        const sz = terrain.size;
        const wl = terrain.waterLevel;
        const halfSize = sz * 0.25;
        const roadWidth = 2.5;
        const blockSize = 10;

        // Boardwalk along coast
        const coastPoints = [];
        for (let x = -halfSize; x <= halfSize; x += 3) {
            for (let z = -halfSize; z <= halfSize; z += 1) {
                const h = terrain.getHeight(x, z);
                const hNext = terrain.getHeight(x, z - 1);
                if (h >= wl && h < wl + 1.5 && hNext < wl) {
                    coastPoints.push({ x, z, h });
                    break;
                }
            }
        }

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
                board.position.set(mx, Math.max((p1.h + (p2.h || p1.h)) / 2, wl) + 0.05, mz);
                board.receiveShadow = true;
                this.group.add(board);
            }
        }

        // Roads on land only
        const roadPositions = [];
        for (let pos = -halfSize; pos <= halfSize; pos += blockSize) {
            roadPositions.push(pos);
        }

        for (const pos of roadPositions) {
            this.createRoadPlane(0, pos, halfSize * 2 + blockSize, roadWidth, true, terrain, false);
            this.createRoadPlane(pos, 0, halfSize * 2 + blockSize, roadWidth, false, terrain, false);
        }

        // Intersections on land only
        for (let i = 0; i < roadPositions.length; i++) {
            for (let j = 0; j < roadPositions.length; j++) {
                const x = roadPositions[i], z = roadPositions[j];
                const h = terrain.getHeight(x, z);
                if (h < wl + 0.3) continue;
                this.intersections.push({ x, z });
                if ((i + j) % 2 === 0) {
                    this.createTrafficLight(x, z, h, roadWidth);
                }
            }
        }

        // Buildings on land
        let placed = 0;
        for (let i = 0; i < 30 && placed < 12; i++) {
            const x = -halfSize + Math.random() * halfSize * 2;
            const z = coastPoints.length > 0
                ? coastPoints[0].z + 2 + Math.random() * halfSize
                : Math.random() * halfSize;
            const h = terrain.getHeight(x, z);
            if (h < wl + 0.5 || h > 4) continue;
            const distFromCoast = h - wl;
            if (distFromCoast < 2) {
                this.createCoastalBuilding(x, h, z);
            } else {
                this.createIslandBuilding(x, h, z);
            }
            placed++;
        }

        this.createBeachFurniture(terrain);

        const boatCount = Math.max(1, Math.min(Math.floor(vehicleCount * 0.6), 6));
        this.createBoats(terrain, boatCount);

        // Street lights on land
        for (const pos of roadPositions) {
            for (let t = -halfSize; t <= halfSize; t += 14) {
                const hV = terrain.getHeight(pos, t);
                if (hV > wl + 0.3 && hV < 5) {
                    this.createStreetLight(pos, hV, t);
                }
            }
        }

        const carCount = Math.max(0, vehicleCount - boatCount);
        if (carCount > 0) {
            this.generateVehicles(terrain, roadPositions, halfSize, carCount, false);
        }
    }

    // ==========================================
    // ISLAND BUILDING
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

        const roofH = Math.max(width, depth) * 0.5;
        const roof = new THREE.Mesh(
            new THREE.ConeGeometry(Math.max(width, depth) * 0.72, roofH, 4),
            new THREE.MeshPhongMaterial({ color: 0x994c33, flatShading: true })
        );
        roof.position.y = height + roofH / 2;
        roof.rotation.y = Math.PI / 4;
        group.add(roof);

        const w1 = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.3, height * 0.35), Mats.windowOff);
        w1.position.set(-width * 0.25, height * 0.4, depth / 2 + 0.01);
        group.add(w1);
        const w2 = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.3, height * 0.35), Mats.windowOff);
        w2.position.set(width * 0.25, height * 0.4, depth / 2 + 0.01);
        group.add(w2);
        group.userData.windowMeshes = [w1, w2];

        group.position.set(x, Math.max(h * 0.15, 0), z);
        group.rotation.y = this.noise.noise2D(x * 0.15, z * 0.15) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // COASTAL BUILDING
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

        const roof = new THREE.Mesh(
            new THREE.BoxGeometry(width + 0.3, 0.15, depth + 0.3),
            new THREE.MeshPhongMaterial({ color: 0x5a4c40, flatShading: true })
        );
        roof.position.y = height + 0.075;
        group.add(roof);

        const rail = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.05), Mats.rail);
        rail.position.set(0, height * 0.45, depth / 2 + 0.3);
        group.add(rail);

        const w1 = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.25, height * 0.3), Mats.windowOff);
        w1.position.set(-width * 0.3, height * 0.4, depth / 2 + 0.01);
        group.add(w1);
        const w2 = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.25, height * 0.3), Mats.windowOff);
        w2.position.set(width * 0.3, height * 0.4, depth / 2 + 0.01);
        group.add(w2);
        group.userData.windowMeshes = [w1, w2];

        group.position.set(x, Math.max(h * 0.15, 0), z);
        group.rotation.y = this.noise.noise2D(x * 0.2, z * 0.2) * Math.PI;
        this.group.add(group);
        this.cityBuildings.push(group);
    }

    // ==========================================
    // BEACH FURNITURE
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
                new THREE.MeshPhongMaterial({ color: umbrellaColors[i % umbrellaColors.length], flatShading: true })
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

        const yPos = this.isFlatCity ? 0 : Math.max(h * 0.15, 0);
        group.position.set(x + roadWidth / 2 + 0.6, yPos, z + roadWidth / 2 + 0.6);
        this.group.add(group);
        this.trafficLights.push({ group, bulbs, x, z, phase: Math.random() * 20, colors: bulbColors });
    }

    // ==========================================
    // STREET LIGHT
    // ==========================================
    createStreetLight(x, h, z) {
        const group = new THREE.Group();
        const pole = new THREE.Mesh(this.geos.poleThin, Mats.streetPole);
        pole.position.y = 1.75;
        group.add(pole);

        // Lamp arm
        const arm = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.04, 0.04),
            Mats.streetPole
        );
        arm.position.set(0.4, 3.4, 0);
        group.add(arm);

        const lamp = new THREE.Mesh(this.geos.lampSphere, Mats.lampOff);
        lamp.position.set(0.8, 3.3, 0);
        group.add(lamp);

        const yPos = this.isFlatCity ? 0 : Math.max(h * 0.15, 0);
        group.position.set(x, yPos, z);
        this.group.add(group);
        this.streetLightGroups.push({ group, lamp });
    }

    // ==========================================
    // HARBOR
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
            plank.position.set(hx + dockDir.x * i, terrain.waterLevel + 0.15, hz + dockDir.z * i);
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
    // VEHICLES - follow traffic rules, can turn
    // ==========================================
    generateVehicles(terrain, roadPositions, halfSize, count, isCity) {
        for (let i = 0; i < count * 2 && this.vehicles.length < count; i++) {
            const isHorizontal = Math.random() < 0.5;
            const roadIndex = Math.floor(Math.random() * roadPositions.length);
            const roadPos = roadPositions[roadIndex];
            const color = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
            const t = -halfSize + Math.random() * halfSize * 2;
            const lane = (this.vehicles.length % 2 === 0 ? -1 : 1) * 0.5;

            const group = new THREE.Group();
            const body = new THREE.Mesh(this.geos.carBody, new THREE.MeshPhongMaterial({ color, flatShading: true }));
            body.position.y = 0.35;
            group.add(body);

            const cabin = new THREE.Mesh(this.geos.carCabin, new THREE.MeshPhongMaterial({ color, flatShading: true }));
            cabin.position.set(-0.05, 0.65, 0);
            group.add(cabin);

            let xPos, zPos;
            if (isHorizontal) {
                xPos = t; zPos = roadPos + lane;
                group.rotation.y = lane > 0 ? 0 : Math.PI;
            } else {
                xPos = roadPos + lane; zPos = t;
                group.rotation.y = lane > 0 ? Math.PI / 2 : -Math.PI / 2;
            }

            const h = terrain.getHeight(xPos, zPos);
            if (h < terrain.waterLevel + 0.3) continue;

            const yPos = isCity ? 0.05 : Math.max(h, 0) + 0.05;
            group.position.set(xPos, yPos + 0.02, zPos);

            group.userData = {
                isHorizontal,
                speed: 1.5 + Math.random() * 2,
                baseSpeed: 1.5 + Math.random() * 2,
                direction: lane > 0 ? 1 : -1,
                roadPos,
                lane,
                halfSize,
                stopped: false,
                turning: false,
                turnProgress: 0,
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
        for (const sl of this.streetLightGroups) {
            sl.lamp.material = on ? Mats.lampOn : Mats.lampOff;
        }
        for (const bld of this.cityBuildings) {
            if (bld.userData.windowMeshes) {
                const mat = on ? Mats.windowOn : Mats.windowOff;
                for (const w of bld.userData.windowMeshes) {
                    w.material = mat;
                }
            }
        }
    }

    // ==========================================
    // UPDATE (vehicles + traffic lights + lighthouse)
    // ==========================================
    update(time) {
        const redForHorizontal = [];
        const redForVertical = [];
        for (const tl of this.trafficLights) {
            const cycleTime = 8;
            const phase = (time + tl.phase) % cycleTime;
            const isGreenForH = phase < cycleTime * 0.45;
            redForHorizontal.push({ x: tl.x, z: tl.z, isRed: !isGreenForH });
            redForVertical.push({ x: tl.x, z: tl.z, isRed: isGreenForH });
        }

        for (const v of this.vehicles) {
            const ud = v.userData;
            if (ud.isBoat) {
                v.position.y += Math.sin(time * 0.8 + ud.bobOffset) * 0.001;
                v.rotation.z = Math.sin(time * 0.5 + ud.bobOffset) * 0.02;
                continue;
            }
            if (ud.isHorizontal === undefined) continue;

            // Check if near a red-light intersection - slow down / stop
            let shouldStop = false;
            const redLights = ud.isHorizontal ? redForHorizontal : redForVertical;
            for (const rl of redLights) {
                if (!rl.isRed) continue;
                const dx = Math.abs(v.position.x - rl.x);
                const dz = Math.abs(v.position.z - rl.z);
                const dist = ud.isHorizontal ? dz + dx * 0.3 : dx + dz * 0.3;
                if (dist < 3) {
                    if (dist < 1.5) {
                        shouldStop = true;
                    } else {
                        ud.speed = ud.baseSpeed * 0.3;
                    }
                    break;
                }
            }

            if (shouldStop) {
                ud.speed = 0;
            } else if (ud.speed < ud.baseSpeed) {
                ud.speed = Math.min(ud.speed + 0.05, ud.baseSpeed);
            }

            // Turn at intersections (random chance when passing through)
            if (!ud.turning && ud.speed > 0.5) {
                for (const inter of this.intersections) {
                    const dx = Math.abs(v.position.x - inter.x);
                    const dz = Math.abs(v.position.z - inter.z);
                    if (dx < 0.8 && dz < 0.8) {
                        // 25% chance to turn at each intersection
                        if (Math.random() < 0.002) {
                            ud.turning = true;
                            ud.turnFrom = { x: v.position.x, z: v.position.z };
                            ud.turnTargetX = inter.x;
                            ud.turnTargetZ = inter.z;
                            // Choose turn direction
                            const turnDir = Math.random() < 0.5 ? 1 : -1;
                            if (ud.isHorizontal) {
                                // Turn to vertical
                                ud.newIsHorizontal = false;
                                ud.newRoadPos = inter.x;
                                ud.newDirection = ud.direction * turnDir;
                                ud.newRotation = ud.newDirection > 0 ? Math.PI / 2 : -Math.PI / 2;
                            } else {
                                // Turn to horizontal
                                ud.newIsHorizontal = true;
                                ud.newRoadPos = inter.z;
                                ud.newDirection = ud.direction * turnDir;
                                ud.newRotation = ud.newDirection > 0 ? 0 : Math.PI;
                            }
                            ud.speed = ud.baseSpeed * 0.3; // Slow down for turn
                        }
                        break;
                    }
                }
            }

            // Execute turn
            if (ud.turning) {
                ud.turnProgress += 0.02;
                v.rotation.y += (ud.newRotation - v.rotation.y) * 0.1;

                if (ud.turnProgress > 0.5) {
                    ud.isHorizontal = ud.newIsHorizontal;
                    ud.roadPos = ud.newRoadPos;
                    ud.direction = ud.newDirection;
                    ud.turning = false;
                    ud.turnProgress = 0;
                    v.rotation.y = ud.newRotation;
                    ud.speed = ud.baseSpeed;
                }
            }

            // Move
            const move = ud.speed * ud.direction * 0.016;
            if (ud.isHorizontal) {
                v.position.x += move;
                if (v.position.x > ud.halfSize + 5) v.position.x = -ud.halfSize - 5;
                if (v.position.x < -ud.halfSize - 5) v.position.x = ud.halfSize + 5;
                // Snap to road lane
                v.position.z += (ud.roadPos + ud.lane - v.position.z) * 0.05;
            } else {
                v.position.z += move;
                if (v.position.z > ud.halfSize + 5) v.position.z = -ud.halfSize - 5;
                if (v.position.z < -ud.halfSize - 5) v.position.z = ud.halfSize + 5;
                v.position.x += (ud.roadPos + ud.lane - v.position.x) * 0.05;
            }
        }

        // Traffic light cycling
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

        // Lighthouse beam
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
    // ==========================================
    // REGENERATE VEHICLES (just vehicles, not buildings/roads)
    // ==========================================
    regenerateVehicles(terrain, vehicleCount) {
        for (const v of this.vehicles) {
            this.group.remove(v);
            v.traverse((child) => {
                if (child.geometry && !Object.values(this.geos).includes(child.geometry))
                    child.geometry.dispose();
                if (child.material) {
                    const isShared = Object.values(Mats).includes(child.material);
                    if (!isShared) child.material.dispose();
                }
            });
        }
        this.vehicles = [];
        if (terrain.terrainType === 'islands') {
            this.createBoats(terrain);
        } else {
            const primarySpacing = (terrain.terrainType === 'suburban') ? 10 : 8;
            const halfSize = terrain.size * 0.4;
            const primaryPos = [];
            for (let p = -halfSize; p <= halfSize; p += primarySpacing) primaryPos.push(p);
            this.generateVehicles(terrain, primaryPos, halfSize, vehicleCount, terrain.terrainType === 'city');
        }
    }

    // ==========================================
    // CLEAR
    // ==========================================
    clear() {
        this.group.traverse((child) => {
            if (child.geometry && !Object.values(this.geos).includes(child.geometry)) {
                child.geometry.dispose();
            }
            if (child.material) {
                const isShared = Object.values(Mats).includes(child.material);
                if (!isShared) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach(m => { if (!Object.values(Mats).includes(m)) m.dispose(); });
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

    updateSnowAccum(s, dt) { /* snow handled by terrain/house/vegetation shaders */ }
}

export { CitySystem };
