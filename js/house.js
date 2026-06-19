import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

// House style definitions - much more variety
const HOUSE_STYLES = {
    cottage: {
        wallColor: [0.85, 0.78, 0.65],
        wallColorVar: 0.08,
        roofColor: [0.55, 0.25, 0.15],
        roofColorVar: 0.06,
        roofPitch: 0.6,
        hasChimney: true,
        windowRows: 1,
        sizeRange: [1.5, 2.8],
        heightRange: [1.8, 2.8],
    },
    medieval: {
        wallColor: [0.7, 0.65, 0.55],
        wallColorVar: 0.1,
        roofColor: [0.4, 0.2, 0.15],
        roofColorVar: 0.05,
        roofPitch: 0.8,
        hasChimney: true,
        windowRows: 2,
        sizeRange: [2.0, 3.5],
        heightRange: [2.5, 4.0],
    },
    modern: {
        wallColor: [0.9, 0.9, 0.88],
        wallColorVar: 0.05,
        roofColor: [0.3, 0.3, 0.35],
        roofColorVar: 0.04,
        roofPitch: 0.2,
        hasChimney: false,
        windowRows: 2,
        sizeRange: [2.0, 4.0],
        heightRange: [2.5, 3.5],
    },
    nordic: {
        wallColor: [0.6, 0.5, 0.35],
        wallColorVar: 0.07,
        roofColor: [0.2, 0.25, 0.2],
        roofColorVar: 0.05,
        roofPitch: 1.0,
        hasChimney: true,
        windowRows: 1,
        sizeRange: [1.8, 3.0],
        heightRange: [2.0, 3.0],
    },
    farm: {
        wallColor: [0.75, 0.7, 0.55],
        wallColorVar: 0.1,
        roofColor: [0.5, 0.3, 0.15],
        roofColorVar: 0.08,
        roofPitch: 0.5,
        hasChimney: true,
        windowRows: 1,
        sizeRange: [2.5, 4.5],
        heightRange: [2.0, 3.0],
    },
    tower: {
        wallColor: [0.65, 0.6, 0.55],
        wallColorVar: 0.08,
        roofColor: [0.45, 0.25, 0.12],
        roofColorVar: 0.05,
        roofPitch: 1.2,
        hasChimney: false,
        windowRows: 3,
        sizeRange: [1.2, 2.0],
        heightRange: [3.5, 6.0],
    },
    hut: {
        wallColor: [0.55, 0.45, 0.3],
        wallColorVar: 0.12,
        roofColor: [0.35, 0.3, 0.15],
        roofColorVar: 0.08,
        roofPitch: 0.9,
        hasChimney: false,
        windowRows: 0,
        sizeRange: [1.0, 1.8],
        heightRange: [1.3, 2.0],
    },
    villa: {
        wallColor: [0.92, 0.88, 0.82],
        wallColorVar: 0.04,
        roofColor: [0.6, 0.25, 0.18],
        roofColorVar: 0.05,
        roofPitch: 0.5,
        hasChimney: true,
        windowRows: 2,
        sizeRange: [3.0, 5.0],
        heightRange: [2.5, 3.5],
    }
};

// Settlement type configs
const SETTLEMENT_TYPES = {
    village: {
        density: 'low',
        spacing: 5.0,
        styles: ['cottage', 'farm', 'hut', 'nordic'],
        sizeMultiplier: 1.0,
    },
    suburban: {
        density: 'medium',
        spacing: 3.5,
        styles: ['cottage', 'modern', 'villa', 'nordic'],
        sizeMultiplier: 1.1,
    },
    city: {
        density: 'high',
        spacing: 2.5,
        styles: ['modern', 'tower', 'medieval'],
        sizeMultiplier: 1.3,
    }
};

class ProceduralHouse {
    constructor(scene, noise) {
        this.scene = scene;
        this.noise = noise;
        this.houses = [];
        this.placedPositions = []; // For collision avoidance
        this.interiorLights = []; // Interior light objects
        this.lightsOn = false;
        this.settlementType = 'village';
    }

    // Vary a color using noise for PCG effect
    varyColor(baseColor, variance, x, z) {
        const n = this.noise.noise2D(x * 0.37, z * 0.37);
        return baseColor.map(c => Math.max(0, Math.min(1, c + n * variance)));
    }

    // Calculate terrain-facing direction for house orientation
    calculateTerrainOrientation(terrain, x, z) {
        // Sample heights around the position to get slope direction
        const delta = 1.0;
        const hL = terrain.getHeight(x - delta, z);
        const hR = terrain.getHeight(x + delta, z);
        const hF = terrain.getHeight(x, z + delta);
        const hB = terrain.getHeight(x, z - delta);

        // Slope vector (points downhill)
        const slopeX = hR - hL;
        const slopeZ = hF - hB;

        // House faces perpendicular to the slope (along contour line)
        // or if flat, face towards the nearest lower ground
        const slopeMag = Math.sqrt(slopeX * slopeX + slopeZ * slopeZ);

        if (slopeMag > 0.1) {
            // Face along contour (perpendicular to slope)
            return Math.atan2(-slopeX, slopeZ);
        } else {
            // Flat area - use noise for natural-looking orientation
            return this.noise.noise2D(x * 0.15, z * 0.15) * Math.PI;
        }
    }

    // Check if position is far enough from other houses
    isPositionValid(x, z, houseWidth, houseDepth) {
        const minDist = houseWidth * 0.7 + houseDepth * 0.7;
        for (const pos of this.placedPositions) {
            const dx = x - pos.x;
            const dz = z - pos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const requiredDist = minDist + pos.radius;
            if (dist < requiredDist) {
                return false;
            }
        }
        return true;
    }

    generate(position, terrain, style = null) {
        const settlement = SETTLEMENT_TYPES[this.settlementType];

        // Pick style based on settlement type + noise
        const availableStyles = settlement.styles;
        const styleIndex = Math.floor(
            Math.abs(this.noise.noise2D(position.x * 0.23, position.z * 0.23)) * availableStyles.length
        );
        const chosenStyle = style || availableStyles[styleIndex % availableStyles.length];
        const s = HOUSE_STYLES[chosenStyle];

        const group = new THREE.Group();
        group.userData = { style: chosenStyle, hasChimney: s.hasChimney };

        // PCG-varied dimensions
        const sizeNoise = this.noise.noise2D(position.x * 0.41, position.z * 0.41);
        const widthFactor = 1.0 + sizeNoise * 0.2;
        const width = (s.sizeRange[0] + Math.random() * (s.sizeRange[1] - s.sizeRange[0])) * widthFactor * settlement.sizeMultiplier;
        const depth = (s.sizeRange[0] + Math.random() * (s.sizeRange[1] - s.sizeRange[0])) * 0.8 * settlement.sizeMultiplier;
        const height = (s.heightRange[0] + Math.random() * (s.heightRange[1] - s.heightRange[0])) * settlement.sizeMultiplier;

        // PCG-varied colors
        const wallCol = this.varyColor(s.wallColor, s.wallColorVar, position.x, position.z);
        const roofCol = this.varyColor(s.roofColor, s.roofColorVar, position.x + 100, position.z + 100);

        // Walls
        const wallGeo = new THREE.BoxGeometry(width, height, depth);
        const wallMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(...wallCol),
            flatShading: true
        });
        const walls = new THREE.Mesh(wallGeo, wallMat);
        walls.position.y = height / 2;
        walls.castShadow = true;
        walls.receiveShadow = true;
        group.add(walls);

        // Roof - use different shapes based on style
        const roofHeight = Math.max(width, depth) * s.roofPitch;
        let roof;

        if (chosenStyle === 'modern') {
            // Flat roof
            const flatRoofGeo = new THREE.BoxGeometry(width + 0.2, 0.15, depth + 0.2);
            const roofMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(...roofCol),
                flatShading: true
            });
            roof = new THREE.Mesh(flatRoofGeo, roofMat);
            roof.position.y = height + 0.075;
        } else if (chosenStyle === 'tower') {
            // Tall cone
            const coneGeo = new THREE.ConeGeometry(width * 0.7, roofHeight, 8);
            const roofMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(...roofCol),
                flatShading: true
            });
            roof = new THREE.Mesh(coneGeo, roofMat);
            roof.position.y = height + roofHeight / 2;
        } else {
            // Standard hipped roof (4-sided cone)
            const roofGeo = new THREE.ConeGeometry(
                Math.max(width, depth) * 0.72,
                roofHeight,
                4
            );
            const roofMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(...roofCol),
                flatShading: true
            });
            roof = new THREE.Mesh(roofGeo, roofMat);
            roof.position.y = height + roofHeight / 2;
            roof.rotation.y = Math.PI / 4;
        }
        roof.castShadow = true;
        group.add(roof);

        // Door
        const doorGeo = new THREE.PlaneGeometry(0.5, 0.9);
        const doorMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.3 + Math.random() * 0.1, 0.2 + Math.random() * 0.05, 0.1),
            side: THREE.DoubleSide
        });
        const door = new THREE.Mesh(doorGeo, doorMat);
        door.position.set(0, 0.45, depth / 2 + 0.01);
        group.add(door);

        // Windows with emissive for interior light effect
        const windowGeo = new THREE.PlaneGeometry(0.35, 0.35);
        const windowMat = new THREE.MeshPhongMaterial({
            color: 0x87ceeb,
            emissive: 0xffcc44,
            emissiveIntensity: 0.0, // Will be toggled
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.8
        });

        const windowMeshes = [];

        for (let row = 0; row < s.windowRows; row++) {
            const wy = 0.6 + row * 0.7;
            if (wy > height - 0.3) break;

            // Front windows
            if (width > 2.2) {
                const w1 = new THREE.Mesh(windowGeo, windowMat.clone());
                w1.position.set(-width * 0.25, wy, depth / 2 + 0.01);
                group.add(w1);
                windowMeshes.push(w1);

                const w2 = new THREE.Mesh(windowGeo, windowMat.clone());
                w2.position.set(width * 0.25, wy, depth / 2 + 0.01);
                group.add(w2);
                windowMeshes.push(w2);
            } else {
                const w = new THREE.Mesh(windowGeo, windowMat.clone());
                w.position.set(0, wy, depth / 2 + 0.01);
                group.add(w);
                windowMeshes.push(w);
            }

            // Side windows
            if (depth > 2.0) {
                const sideGeo = new THREE.PlaneGeometry(0.3, 0.3);
                const ws1 = new THREE.Mesh(sideGeo, windowMat.clone());
                ws1.rotation.y = Math.PI / 2;
                ws1.position.set(width / 2 + 0.01, wy, 0);
                group.add(ws1);
                windowMeshes.push(ws1);

                const ws2 = new THREE.Mesh(sideGeo, windowMat.clone());
                ws2.rotation.y = -Math.PI / 2;
                ws2.position.set(-width / 2 - 0.01, wy, 0);
                group.add(ws2);
                windowMeshes.push(ws2);
            }
        }

        group.userData.windowMeshes = windowMeshes;

        // Chimney
        if (s.hasChimney) {
            const chimneyH = 0.8 + Math.random() * 0.4;
            const chimneyGeo = new THREE.BoxGeometry(0.3, chimneyH, 0.3);
            const chimneyMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(0.4 + Math.random() * 0.15, 0.25 + Math.random() * 0.1, 0.12),
                flatShading: true
            });
            const chimney = new THREE.Mesh(chimneyGeo, chimneyMat);
            chimney.position.set(width * 0.3, height + roofHeight * 0.6, -depth * 0.3);
            chimney.castShadow = true;
            group.add(chimney);
        }

        // Interior point light
        const interiorLight = new THREE.PointLight(0xffcc66, 0, 8, 2);
        interiorLight.position.set(0, height * 0.6, 0);
        group.add(interiorLight);
        group.userData.interiorLight = interiorLight;
        this.interiorLights.push(interiorLight);

        // Calculate terrain-based orientation
        const orientation = this.calculateTerrainOrientation(terrain, position.x, position.z);

        // Position and rotate
        group.position.set(position.x, position.y, position.z);
        group.rotation.y = orientation;

        // Store bounding info for collision
        const boundingRadius = Math.max(width, depth) * 0.75;
        group.userData.boundingRadius = boundingRadius;

        this.scene.add(group);
        this.houses.push(group);
        this.placedPositions.push({ x: position.x, z: position.z, radius: boundingRadius });

        return group;
    }

    generateMultiple(terrain, count = 8) {
        this.clear();

        const settlement = SETTLEMENT_TYPES[this.settlementType];
        const maxAttempts = count * 20; // More attempts to find valid spots

        let placed = 0;
        for (let attempt = 0; attempt < maxAttempts && placed < count; attempt++) {
            const spot = terrain.findFlatSpot(0, 0, terrain.size * 0.4);
            if (!spot) continue;

            // Check minimum spacing based on settlement type
            const minSpacing = settlement.spacing;
            if (!this.isPositionValid(spot.x, spot.z, minSpacing, minSpacing)) continue;

            this.generate(spot, terrain);
            placed++;
        }
    }

    // Toggle interior lights on/off
    setInteriorLights(on) {
        this.lightsOn = on;
        for (const house of this.houses) {
            const ud = house.userData;
            if (ud.interiorLight) {
                ud.interiorLight.intensity = on ? 1.5 : 0;
            }
            if (ud.windowMeshes) {
                for (const w of ud.windowMeshes) {
                    w.material.emissiveIntensity = on ? 0.8 : 0.0;
                    w.material.color.set(on ? 0xffdd88 : 0x87ceeb);
                }
            }
        }
    }

    clear() {
        for (const house of this.houses) {
            this.scene.remove(house);
            house.traverse((child) => {
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
        this.houses = [];
        this.placedPositions = [];
        this.interiorLights = [];
    }
}

export { ProceduralHouse, SETTLEMENT_TYPES };
