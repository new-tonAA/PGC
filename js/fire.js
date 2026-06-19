import * as THREE from 'three';

// Fire vertex shader
const fireVertexShader = `
    attribute float aSize;
    attribute float aLife;
    attribute float aSpeed;

    uniform float uTime;
    uniform float uPixelRatio;

    varying float vLife;
    varying float vSpeed;

    void main() {
        vLife = aLife;
        vSpeed = aSpeed;

        vec3 pos = position;

        // Animate upward with noise-like motion
        float t = mod(uTime * aSpeed + aLife * 10.0, 1.0);
        pos.y += t * 3.0;
        pos.x += sin(t * 4.0 + aLife * 6.28) * 0.3 * t;
        pos.z += cos(t * 3.0 + aLife * 6.28) * 0.2 * t;

        // Shrink as rises
        float scale = (1.0 - t) * aSize;

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = scale * uPixelRatio * (200.0 / -mvPosition.z);
    }
`;

// Fire fragment shader
const fireFragmentShader = `
    varying float vLife;
    varying float vSpeed;

    void main() {
        float dist = length(gl_PointCoord - vec2(0.5));
        if (dist > 0.5) discard;

        float alpha = 1.0 - dist * 2.0;
        alpha *= alpha;

        // Fire color gradient: white -> yellow -> orange -> red -> dark
        float t = mod(vLife * 3.0 + vSpeed, 1.0);
        vec3 col;

        if (t < 0.15) {
            col = mix(vec3(1.0, 1.0, 0.9), vec3(1.0, 0.9, 0.3), t / 0.15);
        } else if (t < 0.4) {
            col = mix(vec3(1.0, 0.9, 0.3), vec3(1.0, 0.4, 0.0), (t - 0.15) / 0.25);
        } else if (t < 0.7) {
            col = mix(vec3(1.0, 0.4, 0.0), vec3(0.6, 0.1, 0.0), (t - 0.4) / 0.3);
        } else {
            col = mix(vec3(0.6, 0.1, 0.0), vec3(0.1, 0.0, 0.0), (t - 0.7) / 0.3);
            alpha *= (1.0 - (t - 0.7) / 0.3);
        }

        gl_FragColor = vec4(col, alpha * 0.7);
    }
`;

class FireSystem {
    constructor(scene) {
        this.scene = scene;
        this.fires = [];
        this.active = false;
    }

    createFire(position, count = 500) {
        const positions = new Float32Array(count * 3);
        const sizes = new Float32Array(count);
        const lives = new Float32Array(count);
        const speeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * 0.5;

            positions[i * 3] = Math.cos(angle) * radius;
            positions[i * 3 + 1] = Math.random() * 0.3;
            positions[i * 3 + 2] = Math.sin(angle) * radius;

            sizes[i] = 2.0 + Math.random() * 6.0;
            lives[i] = Math.random();
            speeds[i] = 0.5 + Math.random() * 1.5;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aLife', new THREE.BufferAttribute(lives, 1));
        geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));

        const material = new THREE.ShaderMaterial({
            vertexShader: fireVertexShader,
            fragmentShader: fireFragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uPixelRatio: { value: window.devicePixelRatio }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        });

        const points = new THREE.Points(geometry, material);
        points.position.copy(position);
        this.scene.add(points);
        this.fires.push(points);

        return points;
    }

    // Place fires near house chimneys
    placeFiresAtHouses(houses) {
        this.clear();

        for (const house of houses) {
            // Find chimney position (approximate)
            const chimneyPos = new THREE.Vector3();
            let hasChimney = false;

            house.traverse((child) => {
                if (child.geometry) {
                    const geo = child.geometry;
                    if (geo.parameters) {
                        // BoxGeometry with small size = chimney
                        if (geo.parameters.width !== undefined &&
                            geo.parameters.width < 0.5 &&
                            geo.parameters.height > 0.5) {
                            chimneyPos.copy(child.position);
                            hasChimney = true;
                        }
                    }
                }
            });

            if (hasChimney) {
                const worldPos = new THREE.Vector3(chimneyPos.x, chimneyPos.y + 0.5, chimneyPos.z);
                house.localToWorld(worldPos);
                this.createFire(worldPos, 200);
            } else {
                // Fire in front of house
                const frontPos = new THREE.Vector3(0, 0.2, 1.2);
                house.localToWorld(frontPos);
                this.createFire(frontPos, 300);
            }
        }

        this.active = true;
    }

    // Create a campfire at a specific position
    createCampfire(position) {
        // Fire pit ring
        const ringGeo = new THREE.RingGeometry(0.4, 0.6, 16);
        const ringMat = new THREE.MeshPhongMaterial({
            color: 0x555555,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(position);
        ring.position.y += 0.05;
        this.scene.add(ring);

        // Some logs
        for (let i = 0; i < 3; i++) {
            const logGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6);
            const logMat = new THREE.MeshPhongMaterial({ color: 0x3d2817 });
            const log = new THREE.Mesh(logGeo, logMat);
            log.position.copy(position);
            log.position.y += 0.08;
            log.rotation.z = Math.PI / 2;
            log.rotation.y = (i / 3) * Math.PI;
            this.scene.add(log);
        }

        this.createFire(position, 400);
        this.active = true;
    }

    update(time) {
        for (const fire of this.fires) {
            fire.material.uniforms.uTime.value = time;
        }
    }

    clear() {
        for (const fire of this.fires) {
            this.scene.remove(fire);
            fire.geometry.dispose();
            fire.material.dispose();
        }
        this.fires = [];
        this.active = false;
    }
}

export { FireSystem };
