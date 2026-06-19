import * as THREE from 'three';
import { SimplexNoise } from './noise.js';

// =============================================
// Vegetation System: Rich tree types + smart placement
// =============================================

// Biome zones for tree selection
const BIOME_TREES = {
    plains: {
        trees: ['oak', 'birch', 'pine', 'maple', 'bush'],
        weights: [0.25, 0.2, 0.2, 0.15, 0.2],
        density: 1.0,
        minHeight: -1.5,
        maxHeight: 6
    },
    mountains: {
        trees: ['pine', 'spruce', 'birch', 'dead', 'bush'],
        weights: [0.35, 0.25, 0.15, 0.1, 0.15],
        density: 0.7,
        minHeight: -4,
        maxHeight: 8
    },
    islands: {
        trees: ['palm', 'oak', 'bush', 'pine', 'cypress'],
        weights: [0.3, 0.2, 0.2, 0.15, 0.15],
        density: 0.8,
        minHeight: -1.5,
        maxHeight: 4
    },
    suburban: {
        trees: ['oak', 'maple', 'birch', 'bush', 'pine'],
        weights: [0.25, 0.2, 0.2, 0.2, 0.15],
        density: 0.6,
        minHeight: -2,
        maxHeight: 4
    },
    city: {
        trees: ['maple', 'birch', 'bush', 'oak'],
        weights: [0.3, 0.25, 0.25, 0.2],
        density: 0.3,
        minHeight: -2,
        maxHeight: 2
    },
    coastal: {
        trees: ['palm', 'oak', 'bush', 'willow', 'cypress'],
        weights: [0.25, 0.2, 0.25, 0.15, 0.15],
        density: 0.7,
        minHeight: -1.0,
        maxHeight: 4
    }
};

class VegetationSystem {
    constructor(scene, noise) {
        this.scene = scene;
        this.noise = noise;
        this.group = new THREE.Group();
        this.placedTrees = []; // Track positions for spacing
    }

    generate(terrain, options = {}) {
        this.clear();

        const terrainType = terrain.terrainType;
        const biome = BIOME_TREES[terrainType] || BIOME_TREES.plains;
        const isCityTerrain = terrainType === 'city' || (options.settlementType === 'city');
        const isIsland = terrainType === 'islands';

        // Determine tree count
        let treeCount;
        if (isCityTerrain) treeCount = 15;
        else if (isIsland) treeCount = 50;
        else if (options.settlementType === 'suburban') treeCount = 55;
        else treeCount = 75;

        treeCount = Math.floor(treeCount * biome.density);

        // Generate forest zones using noise
        // Areas where noise > threshold get more trees
        const forestNoise = new SimplexNoise(options.seed || 42);

        // Road positions from city system (to avoid)
        const roadPositions = options.roadPositions || [];

        let placed = 0;
        const maxAttempts = treeCount * 8;

        for (let attempt = 0; attempt < maxAttempts && placed < treeCount; attempt++) {
            // Distribute across the terrain
            const angle = Math.random() * Math.PI * 2;
            const dist = 3 + Math.random() * (terrain.size * 0.45);
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            const y = terrain.getHeight(x, z);

            // Height check
            if (y < terrain.waterLevel + 0.8 || y > biome.maxHeight) continue;

            // Slope check
            const delta = 0.8;
            const yN = terrain.getHeight(x + delta, z);
            const yS = terrain.getHeight(x - delta, z);
            const yE = terrain.getHeight(x, z + delta);
            const yW = terrain.getHeight(x, z - delta);
            const slope = Math.abs(y - yN) + Math.abs(y - yS) + Math.abs(y - yE) + Math.abs(y - yW);
            if (slope > 2.5) continue;

            // Forest zone check - use noise to create natural forest patches
            const forestVal = forestNoise.fbm(x * 0.03, z * 0.03, 3);
            // Edge of forest has scattered trees, center has dense
            if (forestVal < -0.2 && Math.random() < 0.7) continue; // Outside forest zone, less likely

            // Avoid houses
            let tooClose = false;
            if (options.housePositions) {
                for (const hp of options.housePositions) {
                    const dx = x - hp.x;
                    const dz = z - hp.z;
                    if (Math.sqrt(dx * dx + dz * dz) < hp.radius + 1.5) {
                        tooClose = true;
                        break;
                    }
                }
            }
            if (tooClose) continue;

            // Avoid roads
            if (roadPositions.length > 0) {
                for (const rp of roadPositions) {
                    const dx = Math.abs(x - rp.x);
                    const dz = Math.abs(z - rp.z);
                    // Roads are 2.5 wide + 1m buffer each side
                    if (dx < 2.5 || dz < 2.5) {
                        tooClose = true;
                        break;
                    }
                }
                if (tooClose) continue;
            }

            // Tree-to-tree spacing
            const minTreeDist = 1.5 + Math.random() * 1.5;
            for (const pt of this.placedTrees) {
                const dx = x - pt.x;
                const dz = z - pt.z;
                if (Math.sqrt(dx * dx + dz * dz) < minTreeDist) {
                    tooClose = true;
                    break;
                }
            }
            if (tooClose) continue;

            // Select tree type based on biome + noise
            const typeNoise = Math.abs(this.noise.noise2D(x * 0.19, z * 0.19));
            const treeType = this.selectTreeType(biome, typeNoise);

            // Island-specific: palm trees near coast
            let coastFactor = 0;
            if (isIsland) {
                const d = Math.sqrt(x * x + z * z) / (terrain.size * 0.5);
                coastFactor = d; // Higher near edge = more coast-like
            }

            // Size variation based on noise
            const sizeNoise = 0.7 + Math.abs(this.noise.noise2D(x * 0.31, z * 0.31)) * 0.6;

            // Create the tree
            const treeGroup = this.createTree(treeType, x, y, z, sizeNoise, coastFactor, isIsland);
            if (treeGroup) {
                this.group.add(treeGroup);
                this.placedTrees.push({ x, z });
                placed++;
            }
        }

        // Add ground cover (small bushes, flowers)
        this.generateGroundCover(terrain, biome, options, forestNoise);

        this.scene.add(this.group);
    }

    selectTreeType(biome, noiseVal) {
        const cumWeights = [];
        let sum = 0;
        for (let i = 0; i < biome.weights.length; i++) {
            sum += biome.weights[i];
            cumWeights.push(sum);
        }
        const r = noiseVal * sum;
        for (let i = 0; i < cumWeights.length; i++) {
            if (r <= cumWeights[i]) return biome.trees[i];
        }
        return biome.trees[0];
    }

    createTree(type, x, y, z, sizeScale, coastFactor, isIsland) {
        switch (type) {
            case 'oak': return this.createOak(x, y, z, sizeScale);
            case 'pine': return this.createPine(x, y, z, sizeScale);
            case 'birch': return this.createBirch(x, y, z, sizeScale);
            case 'maple': return this.createMaple(x, y, z, sizeScale);
            case 'palm': return this.createPalm(x, y, z, sizeScale);
            case 'spruce': return this.createSpruce(x, y, z, sizeScale);
            case 'cypress': return this.createCypress(x, y, z, sizeScale);
            case 'dead': return this.createDeadTree(x, y, z, sizeScale);
            case 'bush': return this.createBush(x, y, z, sizeScale);
            case 'willow': return this.createWillow(x, y, z, sizeScale);
            default: return this.createOak(x, y, z, sizeScale);
        }
    }

    // ==========================================
    // OAK - Round canopy, thick trunk
    // ==========================================
    createOak(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (1.8 + Math.random() * 0.8) * sizeScale;
        const trunkR = 0.12 * sizeScale;

        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 7);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x4a3520, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Main canopy - large sphere
        const canopyR = (1.2 + Math.random() * 0.5) * sizeScale;
        const shade = 0.15 + Math.random() * 0.1;
        const canopyGeo = new THREE.SphereGeometry(canopyR, 8, 6);
        const canopyMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(shade * 0.5, shade * 1.1, shade * 0.35),
            flatShading: true
        });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = trunkH + canopyR * 0.6;
        canopy.castShadow = true;
        group.add(canopy);

        // Secondary canopy blobs for natural shape
        for (let i = 0; i < 3; i++) {
            const blobR = canopyR * (0.5 + Math.random() * 0.3);
            const blobGeo = new THREE.SphereGeometry(blobR, 6, 5);
            const blobShade = shade + (Math.random() - 0.5) * 0.04;
            const blobMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(blobShade * 0.5, blobShade * 1.1, blobShade * 0.35),
                flatShading: true
            });
            const blob = new THREE.Mesh(blobGeo, blobMat);
            blob.position.set(
                (Math.random() - 0.5) * canopyR,
                trunkH + canopyR * 0.5 + Math.random() * canopyR * 0.3,
                (Math.random() - 0.5) * canopyR
            );
            blob.castShadow = true;
            group.add(blob);
        }

        // Low branches
        for (let b = 0; b < 2; b++) {
            const branchAngle = Math.random() * Math.PI * 2;
            const branchH = trunkH * (0.5 + b * 0.2);
            const branchLen = (0.6 + Math.random() * 0.4) * sizeScale;
            const branchGeo = new THREE.CylinderGeometry(0.03, 0.05, branchLen, 4);
            const branch = new THREE.Mesh(branchGeo, trunkMat);
            branch.position.set(
                Math.cos(branchAngle) * branchLen * 0.4,
                branchH,
                Math.sin(branchAngle) * branchLen * 0.4
            );
            branch.rotation.z = Math.PI / 4 * (Math.random() > 0.5 ? 1 : -1);
            branch.rotation.y = branchAngle;
            group.add(branch);
        }

        group.position.set(x, y, z);
        // Slight random lean
        group.rotation.z = (Math.random() - 0.5) * 0.05;
        group.rotation.x = (Math.random() - 0.5) * 0.05;
        return group;
    }

    // ==========================================
    // PINE - Layered cones
    // ==========================================
    createPine(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (2.0 + Math.random() * 1.0) * sizeScale;
        const trunkR = 0.08 * sizeScale;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 6);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x3a2815, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Multiple cone layers
        const layers = 3 + Math.floor(Math.random() * 2);
        for (let l = 0; l < layers; l++) {
            const t = l / layers;
            const coneH = (1.0 + Math.random() * 0.4) * sizeScale;
            const coneR = (0.7 - t * 0.25) * sizeScale * (0.8 + Math.random() * 0.3);
            const coneGeo = new THREE.ConeGeometry(coneR, coneH, 7);
            const shade = 0.12 + Math.random() * 0.08 + t * 0.03;
            const coneMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(shade * 0.3, shade * 0.9, shade * 0.25),
                flatShading: true
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.y = trunkH * (0.35 + t * 0.65) + coneH * 0.3;
            cone.castShadow = true;
            group.add(cone);
        }

        group.position.set(x, y, z);
        group.rotation.z = (Math.random() - 0.5) * 0.03;
        return group;
    }

    // ==========================================
    // BIRCH - White trunk, golden/light leaves
    // ==========================================
    createBirch(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (2.5 + Math.random() * 1.0) * sizeScale;
        const trunkR = 0.07 * sizeScale;

        // White bark with dark marks
        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.8, trunkR, trunkH, 8);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0xe8e0d0, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Dark bark marks
        for (let m = 0; m < 4; m++) {
            const markGeo = new THREE.PlaneGeometry(trunkR * 1.5, 0.1);
            const markMat = new THREE.MeshPhongMaterial({
                color: 0x333333, side: THREE.DoubleSide
            });
            const mark = new THREE.Mesh(markGeo, markMat);
            const markAngle = Math.random() * Math.PI * 2;
            mark.position.set(
                Math.cos(markAngle) * trunkR * 0.9,
                0.5 + Math.random() * (trunkH - 1),
                Math.sin(markAngle) * trunkR * 0.9
            );
            mark.rotation.y = markAngle;
            group.add(mark);
        }

        // Light, airy canopy - golden/green
        const canopyR = (0.8 + Math.random() * 0.4) * sizeScale;
        const canopyGeo = new THREE.SphereGeometry(canopyR, 7, 5);
        const canopyMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.4 + Math.random() * 0.1, 0.6 + Math.random() * 0.1, 0.2),
            flatShading: true
        });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = trunkH + canopyR * 0.4;
        canopy.scale.set(1, 0.7, 1); // Flatter
        canopy.castShadow = true;
        group.add(canopy);

        // Drooping branch tips
        for (let b = 0; b < 3; b++) {
            const bAngle = Math.random() * Math.PI * 2;
            const bR = canopyR * (0.4 + Math.random() * 0.3);
            const blobGeo = new THREE.SphereGeometry(bR, 5, 4);
            const blobMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(0.45, 0.65, 0.22), flatShading: true
            });
            const blob = new THREE.Mesh(blobGeo, blobMat);
            blob.position.set(
                Math.cos(bAngle) * canopyR * 0.7,
                trunkH + canopyR * 0.2 - Math.random() * 0.3,
                Math.sin(bAngle) * canopyR * 0.7
            );
            blob.castShadow = true;
            group.add(blob);
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // MAPLE - Dense round canopy, red-orange tint
    // ==========================================
    createMaple(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (1.5 + Math.random() * 0.8) * sizeScale;
        const trunkR = 0.1 * sizeScale;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 6);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x5a3d20, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Dense round canopy with warm tones
        const canopyR = (1.3 + Math.random() * 0.5) * sizeScale;
        const warmth = Math.random();
        let r, g, b;
        if (warmth < 0.3) {
            // Green
            r = 0.12; g = 0.45; b = 0.1;
        } else if (warmth < 0.6) {
            // Orange-green
            r = 0.3; g = 0.45; b = 0.1;
        } else {
            // Reddish
            r = 0.35; g = 0.3; b = 0.1;
        }

        // Main canopy
        const canopyGeo = new THREE.IcosahedronGeometry(canopyR, 1);
        const canopyMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(r, g, b), flatShading: true
        });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = trunkH + canopyR * 0.5;
        canopy.castShadow = true;
        group.add(canopy);

        // Extra blobs
        for (let i = 0; i < 2; i++) {
            const blobR = canopyR * (0.5 + Math.random() * 0.3);
            const blobGeo = new THREE.SphereGeometry(blobR, 6, 5);
            const blobMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(
                    r + (Math.random() - 0.5) * 0.05,
                    g + (Math.random() - 0.5) * 0.05,
                    b + (Math.random() - 0.5) * 0.03
                ), flatShading: true
            });
            const blob = new THREE.Mesh(blobGeo, blobMat);
            blob.position.set(
                (Math.random() - 0.5) * canopyR * 0.8,
                trunkH + canopyR * 0.3 + Math.random() * canopyR * 0.3,
                (Math.random() - 0.5) * canopyR * 0.8
            );
            blob.castShadow = true;
            group.add(blob);
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // PALM - Curved trunk, fan leaves
    // ==========================================
    createPalm(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (3.0 + Math.random() * 2.0) * sizeScale;
        const trunkR = 0.1 * sizeScale;

        // Curved trunk using multiple segments
        const segments = 5;
        const curveAmount = (Math.random() - 0.5) * 0.8;
        let currentY = 0;
        let currentX = 0;

        for (let s = 0; s < segments; s++) {
            const segH = trunkH / segments;
            const t = s / segments;
            const segR = trunkR * (1 - t * 0.3);

            const segGeo = new THREE.CylinderGeometry(segR * 0.8, segR, segH, 6);
            const segMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(0.55 + t * 0.1, 0.38 + t * 0.05, 0.2),
                flatShading: true
            });
            const seg = new THREE.Mesh(segGeo, segMat);
            currentX += Math.sin(curveAmount) * segH * 0.3;
            currentY += segH;
            seg.position.set(currentX, currentY - segH / 2, 0);
            seg.rotation.z = -curveAmount * 0.2;
            seg.castShadow = true;
            group.add(seg);
        }

        // Ring marks on trunk
        for (let r = 0; r < 6; r++) {
            const ringY = trunkH * (0.2 + r * 0.12);
            const ringGeo = new THREE.TorusGeometry(trunkR * (1 - r * 0.05) * 1.1, 0.015, 4, 8);
            const ringMat = new THREE.MeshPhongMaterial({ color: 0x3a2510 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(currentX * (ringY / trunkH), ringY, 0);
            ring.rotation.x = Math.PI / 2;
            group.add(ring);
        }

        // Palm fronds - 6-8 drooping leaves
        const frondCount = 6 + Math.floor(Math.random() * 3);
        for (let f = 0; f < frondCount; f++) {
            const frondAngle = (f / frondCount) * Math.PI * 2 + Math.random() * 0.3;
            const frondLen = (2.0 + Math.random() * 1.0) * sizeScale;
            const droop = 0.4 + Math.random() * 0.3;

            // Create frond from elongated triangles
            const frondShape = new THREE.Shape();
            frondShape.moveTo(0, 0);
            frondShape.lineTo(frondLen * 0.3, 0.15);
            frondShape.lineTo(frondLen, 0);
            frondShape.lineTo(frondLen * 0.3, -0.15);
            frondShape.closePath();

            const frondGeo = new THREE.ShapeGeometry(frondShape);
            const frondMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(0.15 + Math.random() * 0.05, 0.5 + Math.random() * 0.1, 0.1),
                side: THREE.DoubleSide
            });
            const frond = new THREE.Mesh(frondGeo, frondMat);
            frond.position.set(currentX, trunkH - 0.1, 0);
            frond.rotation.y = frondAngle;
            frond.rotation.x = droop;
            frond.rotation.z = (Math.random() - 0.5) * 0.2;
            group.add(frond);

            // Leaflets along frond
            for (let lf = 1; lf < 6; lf++) {
                const lfT = lf / 6;
                const leafGeo = new THREE.PlaneGeometry(0.3 * (1 - lfT) * sizeScale, 0.08);
                const leafMat = new THREE.MeshPhongMaterial({
                    color: new THREE.Color(0.18, 0.55, 0.12),
                    side: THREE.DoubleSide
                });
                for (const side of [-1, 1]) {
                    const leaf = new THREE.Mesh(leafGeo, leafMat);
                    leaf.position.set(
                        currentX + Math.cos(frondAngle) * frondLen * lfT * 0.8,
                        trunkH - 0.1 - lfT * droop * 0.5,
                        Math.sin(frondAngle) * frondLen * lfT * 0.8
                    );
                    leaf.rotation.y = frondAngle + side * 0.4;
                    leaf.rotation.x = droop + side * 0.2;
                    group.add(leaf);
                }
            }
        }

        // Coconuts
        for (let c = 0; c < 3; c++) {
            const cocoGeo = new THREE.SphereGeometry(0.08 * sizeScale, 5, 4);
            const cocoMat = new THREE.MeshPhongMaterial({ color: 0x6b4c2a });
            const coco = new THREE.Mesh(cocoGeo, cocoMat);
            coco.position.set(
                currentX + (Math.random() - 0.5) * 0.3,
                trunkH - 0.3,
                (Math.random() - 0.5) * 0.3
            );
            group.add(coco);
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // SPRUCE - Tall narrow pine
    // ==========================================
    createSpruce(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (2.5 + Math.random() * 1.5) * sizeScale;
        const trunkR = 0.06 * sizeScale;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.5, trunkR, trunkH, 6);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x3a2515, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Many narrow cone layers
        const layers = 5 + Math.floor(Math.random() * 3);
        for (let l = 0; l < layers; l++) {
            const t = l / layers;
            const coneH = (0.8 + Math.random() * 0.3) * sizeScale;
            const coneR = (0.5 - t * 0.3) * sizeScale * (0.8 + Math.random() * 0.2);
            const coneGeo = new THREE.ConeGeometry(coneR, coneH, 7);
            const shade = 0.1 + t * 0.03 + Math.random() * 0.05;
            const coneMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(shade * 0.25, shade * 0.85, shade * 0.2),
                flatShading: true
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.y = trunkH * (0.2 + t * 0.75) + coneH * 0.2;
            cone.castShadow = true;
            group.add(cone);
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // CYPRESS - Tall narrow columnar
    // ==========================================
    createCypress(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (3.0 + Math.random() * 1.5) * sizeScale;
        const trunkR = 0.06 * sizeScale;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.5, trunkR * 1.2, trunkH * 0.6, 6);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x4a3020, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH * 0.3;
        trunk.castShadow = true;
        group.add(trunk);

        // Columnar foliage - elongated cone
        const foliageH = (3.5 + Math.random() * 1.0) * sizeScale;
        const foliageR = (0.5 + Math.random() * 0.2) * sizeScale;
        const foliageGeo = new THREE.ConeGeometry(foliageR, foliageH, 8);
        const shade = 0.12 + Math.random() * 0.06;
        const foliageMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(shade * 0.2, shade * 0.8, shade * 0.18),
            flatShading: true
        });
        const foliage = new THREE.Mesh(foliageGeo, foliageMat);
        foliage.position.y = trunkH * 0.5 + foliageH * 0.4;
        foliage.castShadow = true;
        group.add(foliage);

        // Slight bulges
        for (let b = 0; b < 2; b++) {
            const bulgeR = foliageR * (0.6 + Math.random() * 0.3);
            const bulgeGeo = new THREE.SphereGeometry(bulgeR, 6, 5);
            const bulgeMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(shade * 0.22, shade * 0.85, shade * 0.2),
                flatShading: true
            });
            const bulge = new THREE.Mesh(bulgeGeo, bulgeMat);
            bulge.position.set(
                (Math.random() - 0.5) * foliageR * 0.5,
                trunkH * (0.4 + b * 0.3),
                (Math.random() - 0.5) * foliageR * 0.5
            );
            bulge.castShadow = true;
            group.add(bulge);
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // DEAD TREE - Bare branches
    // ==========================================
    createDeadTree(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (2.0 + Math.random() * 1.5) * sizeScale;
        const trunkR = 0.08 * sizeScale;

        // Twisted trunk
        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.6, trunkR, trunkH, 5);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x5a4a3a, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Bare branches
        const branchCount = 3 + Math.floor(Math.random() * 4);
        for (let b = 0; b < branchCount; b++) {
            const branchAngle = Math.random() * Math.PI * 2;
            const branchH = trunkH * (0.4 + Math.random() * 0.5);
            const branchLen = (0.5 + Math.random() * 1.0) * sizeScale;

            const branchGeo = new THREE.CylinderGeometry(0.02, 0.04, branchLen, 4);
            const branch = new THREE.Mesh(branchGeo, trunkMat);
            branch.position.set(
                Math.cos(branchAngle) * branchLen * 0.3,
                branchH,
                Math.sin(branchAngle) * branchLen * 0.3
            );
            branch.rotation.z = (Math.PI / 4 + Math.random() * 0.3) * (Math.cos(branchAngle) > 0 ? 1 : -1);
            branch.rotation.y = branchAngle;
            branch.castShadow = true;
            group.add(branch);

            // Sub-branches
            if (Math.random() < 0.6) {
                const subLen = branchLen * 0.5;
                const subGeo = new THREE.CylinderGeometry(0.01, 0.02, subLen, 3);
                const sub = new THREE.Mesh(subGeo, trunkMat);
                sub.position.set(
                    Math.cos(branchAngle + 0.5) * branchLen * 0.5,
                    branchH + branchLen * 0.2,
                    Math.sin(branchAngle + 0.5) * branchLen * 0.5
                );
                sub.rotation.z = Math.PI / 3;
                sub.rotation.y = branchAngle + 0.5;
                group.add(sub);
            }
        }

        group.position.set(x, y, z);
        group.rotation.z = (Math.random() - 0.5) * 0.1;
        return group;
    }

    // ==========================================
    // BUSH - Low round shrub
    // ==========================================
    createBush(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const bushR = (0.4 + Math.random() * 0.5) * sizeScale;
        const shade = 0.12 + Math.random() * 0.1;

        // Main bush body
        const bushGeo = new THREE.SphereGeometry(bushR, 7, 5);
        const bushMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(shade * 0.4, shade, shade * 0.25),
            flatShading: true
        });
        const bush = new THREE.Mesh(bushGeo, bushMat);
        bush.position.y = bushR * 0.6;
        bush.scale.y = 0.7;
        bush.castShadow = true;
        group.add(bush);

        // Additional smaller blobs
        for (let i = 0; i < 2; i++) {
            const blobR = bushR * (0.4 + Math.random() * 0.3);
            const blobGeo = new THREE.SphereGeometry(blobR, 5, 4);
            const blobMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(shade * 0.4 + Math.random() * 0.02, shade + Math.random() * 0.03, shade * 0.25),
                flatShading: true
            });
            const blob = new THREE.Mesh(blobGeo, blobMat);
            blob.position.set(
                (Math.random() - 0.5) * bushR,
                blobR * 0.5,
                (Math.random() - 0.5) * bushR
            );
            blob.castShadow = true;
            group.add(blob);
        }

        // Occasional flowers
        if (Math.random() < 0.3) {
            for (let f = 0; f < 4; f++) {
                const flowerGeo = new THREE.SphereGeometry(0.04, 4, 3);
                const flowerColors = [0xff4466, 0xffcc22, 0xff88cc, 0xffff88, 0xffffff];
                const flowerMat = new THREE.MeshPhongMaterial({
                    color: flowerColors[Math.floor(Math.random() * flowerColors.length)]
                });
                const flower = new THREE.Mesh(flowerGeo, flowerMat);
                const fAngle = Math.random() * Math.PI * 2;
                flower.position.set(
                    Math.cos(fAngle) * bushR * 0.8,
                    bushR * 0.4 + Math.random() * bushR * 0.3,
                    Math.sin(fAngle) * bushR * 0.8
                );
                group.add(flower);
            }
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // WILLOW - Drooping branches
    // ==========================================
    createWillow(x, y, z, sizeScale) {
        const group = new THREE.Group();

        const trunkH = (2.0 + Math.random() * 0.8) * sizeScale;
        const trunkR = 0.1 * sizeScale;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 6);
        const trunkMat = new THREE.MeshPhongMaterial({ color: 0x4a3525, flatShading: true });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = trunkH / 2;
        trunk.castShadow = true;
        group.add(trunk);

        // Canopy top
        const canopyR = (1.0 + Math.random() * 0.4) * sizeScale;
        const canopyGeo = new THREE.SphereGeometry(canopyR, 7, 5);
        const canopyMat = new THREE.MeshPhongMaterial({
            color: new THREE.Color(0.18, 0.5, 0.15), flatShading: true
        });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = trunkH + canopyR * 0.3;
        canopy.scale.y = 0.6;
        canopy.castShadow = true;
        group.add(canopy);

        // Drooping willow branches
        const branchCount = 8 + Math.floor(Math.random() * 6);
        for (let b = 0; b < branchCount; b++) {
            const angle = (b / branchCount) * Math.PI * 2 + Math.random() * 0.3;
            const branchLen = (1.5 + Math.random() * 1.5) * sizeScale;

            // Create drooping line using small segments
            const segCount = 5;
            for (let s = 0; s < segCount; s++) {
                const t = s / segCount;
                const nextT = (s + 1) / segCount;
                const segLen = branchLen / segCount;

                // Droop curve
                const droopY = -t * t * branchLen * 0.5;
                const nextDroopY = -nextT * nextT * branchLen * 0.5;

                const segGeo = new THREE.CylinderGeometry(0.01, 0.015, segLen, 3);
                const segMat = new THREE.MeshPhongMaterial({
                    color: new THREE.Color(0.15 + t * 0.03, 0.42 + t * 0.05, 0.12),
                    flatShading: true
                });
                const seg = new THREE.Mesh(segGeo, segMat);

                const px = Math.cos(angle) * canopyR * 0.6 + Math.cos(angle) * t * canopyR;
                const pz = Math.sin(angle) * canopyR * 0.6 + Math.sin(angle) * t * canopyR;
                seg.position.set(px, trunkH + droopY - segLen * 0.3, pz);
                seg.rotation.x = droopY * 0.2;
                seg.rotation.z = -Math.cos(angle) * t * 0.5;
                group.add(seg);
            }

            // Leaf cluster at end of branch
            const leafGeo = new THREE.SphereGeometry(0.15 * sizeScale, 4, 3);
            const leafMat = new THREE.MeshPhongMaterial({
                color: new THREE.Color(0.2, 0.5, 0.15), flatShading: true
            });
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            const endX = Math.cos(angle) * canopyR * 1.6;
            const endZ = Math.sin(angle) * canopyR * 1.6;
            leaf.position.set(endX, trunkH - branchLen * 0.4, endZ);
            group.add(leaf);
        }

        group.position.set(x, y, z);
        return group;
    }

    // ==========================================
    // Ground cover - small plants, flowers, grass patches
    // ==========================================
    generateGroundCover(terrain, biome, options, forestNoise) {
        const coverCount = 30 + Math.floor(Math.random() * 20);

        for (let i = 0; i < coverCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 4 + Math.random() * (terrain.size * 0.4);
            const x = Math.cos(angle) * dist;
            const z = Math.sin(angle) * dist;

            const y = terrain.getHeight(x, z);
            if (y < terrain.waterLevel + 0.5 || y > 5) continue;

            // Check forest zone
            const fv = forestNoise.fbm(x * 0.03, z * 0.03, 3);
            if (fv < 0 && Math.random() < 0.5) continue;

            const type = Math.random();

            if (type < 0.4) {
                // Grass tuft
                const grassGroup = new THREE.Group();
                const bladeCount = 3 + Math.floor(Math.random() * 4);
                for (let b = 0; b < bladeCount; b++) {
                    const bladeH = 0.2 + Math.random() * 0.3;
                    const bladeGeo = new THREE.PlaneGeometry(0.05, bladeH);
                    const shade = 0.2 + Math.random() * 0.15;
                    const bladeMat = new THREE.MeshPhongMaterial({
                        color: new THREE.Color(shade * 0.5, shade, shade * 0.3),
                        side: THREE.DoubleSide
                    });
                    const blade = new THREE.Mesh(bladeGeo, bladeMat);
                    blade.position.set(
                        (Math.random() - 0.5) * 0.2,
                        bladeH / 2,
                        (Math.random() - 0.5) * 0.2
                    );
                    blade.rotation.y = Math.random() * Math.PI;
                    blade.rotation.x = (Math.random() - 0.5) * 0.3;
                    grassGroup.add(blade);
                }
                grassGroup.position.set(x, y, z);
                this.group.add(grassGroup);
            } else if (type < 0.7) {
                // Flower patch
                const flowerGroup = new THREE.Group();
                const stemH = 0.15 + Math.random() * 0.2;
                const stemGeo = new THREE.CylinderGeometry(0.01, 0.01, stemH, 3);
                const stemMat = new THREE.MeshPhongMaterial({ color: 0x3a7a2a });
                const stem = new THREE.Mesh(stemGeo, stemMat);
                stem.position.y = stemH / 2;
                flowerGroup.add(stem);

                const flowerGeo = new THREE.SphereGeometry(0.04, 5, 4);
                const flowerColors = [0xff4466, 0xffcc22, 0xff88cc, 0xcc66ff, 0xff6644, 0xffffff];
                const flowerMat = new THREE.MeshPhongMaterial({
                    color: flowerColors[Math.floor(Math.random() * flowerColors.length)]
                });
                const flower = new THREE.Mesh(flowerGeo, flowerMat);
                flower.position.y = stemH + 0.02;
                flowerGroup.add(flower);

                // Multiple flowers in a patch
                for (let f = 1; f < 3; f++) {
                    const f2 = flower.clone();
                    f2.position.set((Math.random() - 0.5) * 0.2, stemH * (0.7 + Math.random() * 0.3), (Math.random() - 0.5) * 0.2);
                    flowerGroup.add(f2);
                }

                flowerGroup.position.set(x, y, z);
                this.group.add(flowerGroup);
            } else {
                // Small rock
                const rockGeo = new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.15, 0);
                const shade = 0.35 + Math.random() * 0.15;
                const rockMat = new THREE.MeshPhongMaterial({
                    color: new THREE.Color(shade, shade * 0.95, shade * 0.9),
                    flatShading: true
                });
                const rock = new THREE.Mesh(rockGeo, rockMat);
                rock.position.set(x, y + 0.05, z);
                rock.scale.y = 0.5 + Math.random() * 0.3;
                rock.rotation.y = Math.random() * Math.PI;
                this.group.add(rock);
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
        this.placedTrees = [];
    }
}

export { VegetationSystem };
