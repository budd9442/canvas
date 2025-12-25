/* eslint-disable react/no-unknown-property */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';

extend({ MeshLineGeometry, MeshLineMaterial });

export default function Lanyard({ position = [0, 0, 30], gravity = [0, -40, 0], fov = 20, transparent = true }: { position?: [number, number, number], gravity?: [number, number, number], fov?: number, transparent?: boolean }) {
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

    useEffect(() => {
        const handleResize = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    return (
        <div className="w-full h-full relative z-10">
            {/* @ts-ignore */}
            <Canvas
                camera={{ position: position, fov: fov }}
                dpr={[1, isMobile ? 1.5 : 2] as any}
                // @ts-ignore
                gl={{ alpha: transparent, antialias: true }}
                onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)}
            >
                <ambientLight intensity={Math.PI} />
                <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
                    <Band isMobile={isMobile} />
                </Physics>
                <Environment blur={0.75}>
                    <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
                    <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
                    <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
                    <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
                </Environment>
            </Canvas>
        </div>
    );
}

function Band({ maxSpeed = 50, minSpeed = 0, isMobile = false }) {
    const band = useRef<any>(null);
    const fixed = useRef<any>(null);
    const j1 = useRef<any>(null);
    const j2 = useRef<any>(null);
    const j3 = useRef<any>(null);
    const card = useRef<any>(null);

    const vec = new THREE.Vector3(), ang = new THREE.Vector3(), rot = new THREE.Vector3(), dir = new THREE.Vector3();
    const segmentProps: any = { type: 'dynamic', canSleep: true, colliders: false, angularDamping: 4, linearDamping: 4 };

    const [curve] = useState(() => new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]));
    const [dragged, drag] = useState<THREE.Vector3 | false>(false);
    const [hovered, hover] = useState(false);

    useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
    useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
    useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
    useSphericalJoint(j3, card, [[0, 0, 0], [0, 1.5, 0]]);

    useEffect(() => {
        if (hovered) {
            document.body.style.cursor = dragged ? 'grabbing' : 'grab';
            return () => void (document.body.style.cursor = 'auto');
        }
    }, [hovered, dragged]);

    useFrame((state, delta) => {
        if (dragged) {
            vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
            dir.copy(vec).sub(state.camera.position).normalize();
            vec.add(dir.multiplyScalar(state.camera.position.length()));

            [card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp());

            card.current?.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z });
        }

        if (fixed.current) {
            [j1, j2].forEach((ref: any) => {
                if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
                const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
                ref.current.lerped.lerp(ref.current.translation(), delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed)));
            });

            if (j3.current && j2.current && j1.current && fixed.current) {
                // @ts-ignore
                curve.points[0].copy(j3.current.translation());
                // @ts-ignore
                curve.points[1].copy(j2.current.lerped);
                // @ts-ignore
                curve.points[2].copy(j1.current.lerped);
                curve.points[3].copy(fixed.current.translation());

                if (band.current) {
                    band.current.geometry.setPoints(curve.getPoints(isMobile ? 16 : 32));
                }
            }

            if (card.current) {
                ang.copy(card.current.angvel());
                rot.copy(card.current.rotation());
                card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z });
            }
        }
    });

    // @ts-ignore
    curve.curveType = 'chordal';

    return (
        <>
            <group position={[0, 4, 0]}>
                <RigidBody ref={fixed} {...segmentProps} type="fixed" />
                <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}><BallCollider args={[0.1]} /></RigidBody>
                <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}><BallCollider args={[0.1]} /></RigidBody>
                <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}><BallCollider args={[0.1]} /></RigidBody>

                <RigidBody position={[2, 0, 0]} ref={card} {...segmentProps} type={dragged ? 'kinematicPosition' : 'dynamic'}>
                    <CuboidCollider args={[0.8, 1.125, 0.01]} />
                    <group
                        scale={2.25}
                        position={[0, -1.2, -0.05]}
                        onPointerOver={() => hover(true)}
                        onPointerOut={() => hover(false)}
                        onPointerUp={(e: any) => {
                            e.target.releasePointerCapture(e.pointerId);
                            drag(false);
                        }}
                        onPointerDown={(e: any) => {
                            e.target.setPointerCapture(e.pointerId);
                            drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current!.translation())));
                        }}
                    >
                        <mesh>
                            <boxGeometry args={[0.7, 1.0, 0.05]} />
                            <meshPhysicalMaterial color="#ffffff" clearcoat={1} clearcoatRoughness={0.15} roughness={0.2} metalness={0.1} />
                        </mesh>
                        <mesh position={[0, 0.55, 0]}>
                            <boxGeometry args={[0.3, 0.1, 0.06]} />
                            <meshStandardMaterial color="#333" roughness={0.5} metalness={0.8} />
                        </mesh>
                        <mesh position={[0, 0.1, 0.03]}>
                            <circleGeometry args={[0.2, 32]} />
                            <meshBasicMaterial color="#4f46e5" />
                        </mesh>
                        <mesh position={[0, -0.2, 0.03]}>
                            <planeGeometry args={[0.5, 0.05]} />
                            <meshBasicMaterial color="#94a3b8" />
                        </mesh>
                        <mesh position={[0, -0.3, 0.03]}>
                            <planeGeometry args={[0.3, 0.05]} />
                            <meshBasicMaterial color="#cbd5e1" />
                        </mesh>
                    </group>
                </RigidBody>
            </group>
            <mesh ref={band}>
                {/* @ts-ignore */}
                <meshLineGeometry />
                {/* @ts-ignore */}
                <meshLineMaterial color="white" depthTest={false} resolution={isMobile ? [1000, 2000] : [1000, 1000]} lineWidth={1} />
            </mesh>
        </>
    );
}
