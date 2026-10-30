import * as THREE from "three";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Reflector } from "three/addons/objects/Reflector.js";
import { markSVG } from "./identity.mjs";

type Options = {
  canvas: HTMLCanvasElement;
  context: WebGL2RenderingContext;
  motion: boolean;
  quality: string;
  onFailure: () => void;
};
const tau = Math.PI * 2;
const noiseGLSL = `float hash(vec3 p){p=fract(p*.3183099+vec3(.1,.2,.3));p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*noise(p);p=p*2.03+vec3(1.2,3.4,2.3);a*=.5;}return v;}`;
export function createScene(container: HTMLElement, options: Options) {
  const mobile = () => container.clientWidth < 850;
  const initialLow =
    options.quality === "low" ||
    (options.quality === "auto" &&
      (mobile() ||
        ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ||
          8) < 4));
  let low = initialLow,
    motion = options.motion,
    disposed = false,
    visible = true,
    raf = 0,
    time = 0,
    last = 0,
    turnOffset = 0,
    turnTarget = 0;
  const pointer = new THREE.Vector2();
  const renderer = new THREE.WebGLRenderer({
    canvas: options.canvas,
    context: options.context,
    antialias: !initialLow,
    alpha: false,
    powerPreference: initialLow ? "low-power" : "default",
  });
  renderer.setClearColor(0x080d14, 1);
  renderer.setPixelRatio(Math.min(devicePixelRatio, initialLow ? 1.15 : 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1722, 0.016);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 220);
  const pmrem = new THREE.PMREMGenerator(renderer),
    room = new RoomEnvironment();
  const envTarget = pmrem.fromScene(room, 0.04);
  scene.environment = envTarget.texture;
  room.dispose();
  pmrem.dispose();
  const materials: THREE.Material[] = [];
  const track = <T extends THREE.Material>(mat: T) => {
    materials.push(mat);
    return mat;
  };
  const metal = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x8eafbd,
      metalness: 0.96,
      roughness: 0.17,
      clearcoat: 1,
      clearcoatRoughness: 0.15,
      envMapIntensity: 1.2,
    }),
  );
  const darkMetal = track(
    new THREE.MeshStandardMaterial({
      color: 0x111f2a,
      metalness: 0.9,
      roughness: 0.28,
      envMapIntensity: 0.55,
    }),
  );
  const silver = track(
    new THREE.MeshStandardMaterial({
      color: 0x9be3e7,
      metalness: 0.94,
      roughness: 0.19,
      envMapIntensity: 0.9,
    }),
  );
  const glass = track(
    new THREE.MeshPhysicalMaterial({
      color: 0x98cfcf,
      metalness: 0.5,
      roughness: 0.12,
      transparent: true,
      opacity: 0.14,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  const glow = (color: THREE.ColorRepresentation, intensity = 2) =>
    track(
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        metalness: 0.3,
        roughness: 0.35,
      }),
    );
  const teal = glow(0x60c7cc, 2.4),
    violet = glow(0x9785d7, 2.1),
    ember = glow(0xd99b6e, 2.6);
  scene.add(new THREE.HemisphereLight(0x7ba5be, 0x071018, 1.4));
  const key = new THREE.DirectionalLight(0xcdebf8, 3.4);
  key.position.set(-5, 10, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8b7bc9, 2.4);
  rim.position.set(8, 5, -3);
  scene.add(rim);
  const warm = new THREE.PointLight(0xffad72, 60, 22, 2);
  warm.position.set(7, 2.8, 1.2);
  scene.add(warm);
  const cool = new THREE.PointLight(0x6ce9ed, 65, 20, 2);
  cool.position.set(-1, 3.4, 2);
  scene.add(cool);
  const back = new THREE.PointLight(0xa4b7ff, 70, 28, 2);
  back.position.set(2, 7, -4);
  scene.add(back);
  // Original modeled DA; holes remain genuine voids at every viewing angle.
  const mark = new THREE.Group(),
    markPivot = new THREE.Group();
  mark.add(markPivot);
  scene.add(mark);
  const outlineData = new SVGLoader().parse(markSVG());
  outlineData.paths.forEach((path, index) =>
    SVGLoader.createShapes(path).forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 9,
        bevelEnabled: true,
        bevelSegments: 4,
        steps: 1,
        bevelSize: 1.1,
        bevelThickness: 1.2,
        curveSegments: 30,
      });
      geometry.translate(-66, -50, -4.5);
      geometry.scale(0.041, 0.041, 0.041);
      geometry.rotateX(Math.PI);
      const mesh = new THREE.Mesh(geometry, [metal, darkMetal]);
      markPivot.add(mesh);
      const edges = new THREE.EdgesGeometry(geometry, 32);
      const lines = new THREE.LineSegments(
        edges,
        track(
          new THREE.LineBasicMaterial({
            color: index ? 0xcbb5ed : 0xa9fff3,
            transparent: true,
            opacity: 0.6,
          }),
        ),
      );
      markPivot.add(lines);
      const inner = new THREE.Mesh(geometry, glass);
      inner.scale.setScalar(1.013);
      markPivot.add(inner);
    }),
  );
  // Thin architectural orbital traces pass in front of and behind the sculpture.
  const orbits = new THREE.Group();
  scene.add(orbits);
  for (let i = 0; i < 3; i++) {
    const geometry = new THREE.TorusGeometry(3.5 + i * 0.27, 0.008, 5, 144);
    const mesh = new THREE.Mesh(
      geometry,
      i === 1 ? violet : i === 2 ? ember : teal,
    );
    mesh.rotation.x = 1.22 + i * 0.12;
    mesh.rotation.y = 0.12 + i * 0.17;
    mesh.rotation.z = 0.3 + i * 0.21;
    orbits.add(mesh);
  }
  const orbitLights: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.029, 10, 10),
      i % 2 ? ember : teal,
    );
    orbits.add(mesh);
    orbitLights.push(mesh);
  }
  const platform = new THREE.Group();
  scene.add(platform);
  function cylinder(
    radius: number,
    height: number,
    y: number,
    material: THREE.Material,
    radiusTop = radius,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        radiusTop,
        radius,
        1,
        initialLow ? 64 : 112,
        1,
      ),
      material,
    );
    mesh.position.y = y;
    mesh.scale.y = height;
    platform.add(mesh);
    return mesh;
  }
  cylinder(4.3, 0.22, -0.14, darkMetal);
  cylinder(4.1, 0.12, 0.02, silver);
  cylinder(3.95, 0.13, 0.12, darkMetal);
  cylinder(3.8, 0.055, 0.21, metal);
  const topRing = new THREE.Mesh(
    new THREE.TorusGeometry(3.89, 0.014, 6, 160),
    teal,
  );
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = 0.23;
  platform.add(topRing);
  for (let j = 0; j < 44; j++) {
    const angle = (j / 44) * tau;
    const block = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.075, 0.11),
      j % 5 === 0 ? ember : j % 3 === 0 ? violet : darkMetal,
    );
    block.position.set(Math.cos(angle) * 4.15, -0.02, Math.sin(angle) * 4.15);
    block.rotation.y = -angle;
    platform.add(block);
  }
  // A shallow mirror plane grounds the mark with real scene reflections on desktop.
  let mirror: Reflector | undefined;
  if (!initialLow) {
    mirror = new Reflector(new THREE.PlaneGeometry(160, 160), {
      clipBias: 0.003,
      textureWidth: 1024,
      textureHeight: 512,
      color: 0x1c2a36,
    });
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = -0.38;
    scene.add(mirror);
  }
  const floorUniforms = {
    uTime: { value: 0 },
    uDark: { value: initialLow ? 0 : 1 },
  };
  const floorMaterial = track(
    new THREE.ShaderMaterial({
      uniforms: floorUniforms,
      transparent: true,
      depthWrite: true,
      vertexShader:
        "varying vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}",
      fragmentShader: `varying vec3 vWorld;uniform float uTime;uniform float uDark;${noiseGLSL}
void main(){vec2 p=vWorld.xz;float n=fbm(vec3(p*.65,uTime*.025));float streak=pow(max(0.,1.-abs(sin(p.x*.85+n*.35))),35.);float light=exp(-abs(p.x-3.)*.5)*exp(-abs(p.y-2.)*.1);float ripples=sin(p.y*9.+sin(p.x*1.3)+uTime*.28)*.018;vec3 col=mix(vec3(.018,.035,.047),vec3(.036,.07,.09),n);col+=vec3(.07,.19,.2)*streak*light+vec3(.3,.16,.08)*exp(-abs(p.x-6.)*.9)*streak*.3+max(ripples,0.);float fog=1.-exp(-length(p)*.022);col=mix(col,vec3(.035,.06,.084),fog);gl_FragColor=vec4(col,uDark>.5?.58:1.);}`,
    }),
  );
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(180, 180),
    floorMaterial,
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  scene.add(floor);
  // Hand-built scenery: a valley of layered terrain, glass fins, and observatory spires.
  const landscape = new THREE.Group();
  scene.add(landscape);
  let seed = 824;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let layer = 0; layer < 3; layer++)
    for (let side = -1; side <= 1; side += 2) {
      const positions: number[] = [],
        indices: number[] = [];
      const count = 36;
      for (let i = 0; i <= count; i++) {
        const x = side * (5 + i * 0.7),
          z = -11 - layer * 12 + Math.sin(i * 0.7) * 2,
          peak = 2.4 + rand() * 7 + layer * 1.5;
        positions.push(x, -0.5, z + 4, x, peak, z, x, -0.5, z - 6);
      }
      for (let i = 0; i < count; i++) {
        const a = i * 3,
          b = a + 3;
        indices.push(
          a,
          b,
          a + 1,
          a + 1,
          b,
          b + 1,
          a + 1,
          b + 1,
          a + 2,
          a + 2,
          b + 1,
          b + 2,
        );
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: layer === 0 ? 0x152632 : layer === 1 ? 0x203242 : 0x2b3b49,
          metalness: 0.35,
          roughness: 0.72,
          flatShading: true,
          side: THREE.DoubleSide,
        }),
      );
      landscape.add(new THREE.Mesh(geo, mat));
    }
  for (let i = 0; i < 27; i++) {
    const side = i % 2 ? 1 : -1,
      x = side * (7 + rand() * 13),
      z = -3 - rand() * 30,
      height = 2 + rand() * 10;
    const tower = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.34 + rand() * 0.7, height, 0.5 + rand() * 0.8),
      darkMetal,
    );
    body.position.y = height / 2;
    tower.add(body);
    const bevel = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, height * 0.7, 0.06),
      i % 5 === 0 ? ember : teal,
    );
    bevel.position.set(0.2, height * 0.6, 0.38);
    tower.add(bevel);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 4), metal);
    cap.position.y = height + 0.35;
    tower.add(cap);
    tower.position.set(x, -0.35, z);
    landscape.add(tower);
  }
  // Tall foreground ribs frame the observatory without covering the typography.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.37, 18, 1.4),
        darkMetal,
      );
      rib.position.set(side * (11 + i * 1.3), 5.3, -2 - i * 5);
      rib.rotation.z = side * -0.19;
      landscape.add(rib);
      const seam = new THREE.Mesh(
        new THREE.BoxGeometry(0.027, 5.5, 0.06),
        i === 1 ? ember : teal,
      );
      seam.position.set(side * (10.7 + i * 1.3), 6, -1.25 - i * 5);
      seam.rotation.z = side * -0.19;
      landscape.add(seam);
    }
  }
  // Procedural sky: animated cloud layers are shaded in 3D, rather than a flat image.
  const skyUniforms = { uTime: { value: 0 } };
  const skyMat = track(
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
      vertexShader:
        "varying vec3 vPos;void main(){vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec3 vPos;uniform float uTime;${noiseGLSL}
void main(){vec3 dir=normalize(vPos);float h=dir.y;float clouds=fbm(dir*7.+vec3(uTime*.004,0.,uTime*.002));float detail=fbm(dir*21.+vec3(0.,0.,uTime*.002));vec3 night=mix(vec3(.016,.031,.051),vec3(.05,.095,.14),1.-smoothstep(-.1,.8,h));float band=smoothstep(.39,.7,clouds+detail*.18)*(1.-smoothstep(-.1,.6,h));vec3 mist=mix(vec3(.08,.13,.2),vec3(.23,.21,.23),smoothstep(-.3,.6,dir.x));night+=mist*band*.55;float warm=exp(-length(vec2(dir.x-.6,(h-.12)*1.8))*6.);night+=vec3(.3,.14,.075)*warm*(.3+clouds*.7);gl_FragColor=vec4(night,1.);}`,
    }),
  );
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(130, 32, 24), skyMat));
  const moonMat = track(
    new THREE.ShaderMaterial({
      vertexShader:
        "varying vec3 vNormal;varying vec3 vPos;void main(){vNormal=normal;vPos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec3 vNormal;varying vec3 vPos;${noiseGLSL}
void main(){float crater=fbm(vPos*1.2)+noise(vPos*8.)*.12;float light=pow(max(dot(normalize(vNormal),normalize(vec3(-.4,.3,1.))),0.),2.);vec3 col=mix(vec3(.017,.035,.06),vec3(.28,.39,.5),crater)*(.25+light*.8);float edge=pow(1.-max(dot(normalize(vNormal),vec3(0,0,1)),0.),4.);col+=vec3(.12,.24,.34)*edge;gl_FragColor=vec4(col,1.);}`,
    }),
  );
  const moon = new THREE.Mesh(new THREE.SphereGeometry(8, 64, 48), moonMat);
  moon.position.set(13, 12, -38);
  scene.add(moon);
  const moonGlow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0x8db4df,
      transparent: true,
      opacity: 0.19,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  moonGlow.position.copy(moon.position);
  moonGlow.scale.set(23, 23, 1);
  scene.add(moonGlow);
  const stars = new Float32Array((initialLow ? 250 : 650) * 3);
  for (let i = 0; i < stars.length; i += 3) {
    stars[i] = (rand() - 0.5) * 160;
    stars[i + 1] = 6 + rand() * 60;
    stars[i + 2] = -30 - rand() * 80;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(stars, 3));
  const starMat = track(
    new THREE.PointsMaterial({
      color: 0xb4d4e7,
      size: 0.06,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true,
      depthWrite: false,
    }),
  );
  scene.add(new THREE.Points(starGeometry, starMat));
  const particlesGeometry = new THREE.BufferGeometry(),
    particlesPositions = new Float32Array((initialLow ? 65 : 180) * 3);
  for (let i = 0; i < particlesPositions.length; i += 3) {
    particlesPositions[i] = (rand() - 0.5) * 20;
    particlesPositions[i + 1] = rand() * 8;
    particlesPositions[i + 2] = (rand() - 0.5) * 14;
  }
  particlesGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(particlesPositions, 3),
  );
  const particleMat = track(
    new THREE.PointsMaterial({
      color: 0x9aeced,
      map: glowTexture(),
      size: 0.045,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const particles = new THREE.Points(particlesGeometry, particleMat);
  scene.add(particles);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(1, 1),
    initialLow ? 0.32 : 0.48,
    0.45,
    0.95,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  function resize() {
    const w = container.clientWidth,
      h = container.clientHeight;
    camera.aspect = w / h;
    if (mobile()) {
      camera.position.set(0, 4.1, 14.4);
      camera.lookAt(0, 2.55, 0);
      mark.position.set(0, 3, 0);
      platform.position.x = 0;
      orbits.position.set(0, 3, 0);
      mark.scale.setScalar(0.88);
      orbits.scale.setScalar(0.88);
    } else {
      camera.position.set(0.1, 4.6, 14.7);
      camera.lookAt(0.1, 2.1, 0);
      mark.position.set(3.6, 3.1, 0);
      platform.position.x = 3.6;
      orbits.position.set(3.6, 3.1, 0);
      mark.scale.setScalar(1);
      orbits.scale.setScalar(1);
    }
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    render();
  }
  function render() {
    if (disposed) return;
    mark.rotation.y = -0.13 + time * 0.09 + turnOffset + pointer.x * 0.07;
    mark.rotation.x = Math.sin(time * 0.18) * 0.025 + pointer.y * 0.025;
    mark.position.y = (mobile() ? 3 : 3.1) + Math.sin(time * 0.5) * 0.085;
    orbits.rotation.y = time * 0.035;
    orbits.rotation.z = Math.sin(time * 0.12) * 0.08;
    orbitLights.forEach((mesh, i) => {
      const a = time * 0.17 + (i * tau) / 4;
      mesh.position.set(
        Math.cos(a) * 3.6,
        Math.sin(a) * 0.8,
        Math.sin(a) * 3.3,
      );
    });
    particles.rotation.y = time * 0.012;
    skyUniforms.uTime.value = time;
    floorUniforms.uTime.value = time;
    composer.render();
  }
  function frame(now: number) {
    raf = 0;
    if (disposed || !motion || !visible || document.hidden) return;
    if (last && now - last < 1000 / (low ? 30 : 45)) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = last ? Math.min((now - last) / 1000, 0.06) : 0;
    last = now;
    time += dt;
    turnOffset += (turnTarget - turnOffset) * Math.min(dt * 4, 1);
    render();
    raf = requestAnimationFrame(frame);
  }
  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    if (motion && visible && !document.hidden && !disposed)
      raf = requestAnimationFrame(frame);
    else render();
  }
  const onPointer = (event: PointerEvent) => {
    if (!motion || event.pointerType === "touch") return;
    pointer.set(
      (event.clientX / innerWidth - 0.5) * 2,
      (event.clientY / innerHeight - 0.5) * 2,
    );
  };
  const onVisibility = () => schedule();
  const onLoss = (event: Event) => {
    event.preventDefault();
    container.dataset.status = "fallback";
    if (raf) cancelAnimationFrame(raf);
    options.onFailure();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const intersection = new IntersectionObserver(
    (entries) => {
      visible = entries[0].isIntersecting;
      schedule();
    },
    { rootMargin: "150px" },
  );
  intersection.observe(container);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("pointermove", onPointer, { passive: true });
  renderer.domElement.addEventListener("webglcontextlost", onLoss);
  resize();
  container.dataset.status = "ready";
  schedule();
  return {
    setMotion(value: boolean) {
      motion = value;
      schedule();
    },
    setQuality(q: string) {
      low = q === "low" || (q === "auto" && mobile());
      renderer.setPixelRatio(Math.min(devicePixelRatio, low ? 1 : 1.5));
      bloom.strength = low ? 0.26 : 0.48;
      if (mirror) mirror.visible = !low;
      resize();
    },
    turn() {
      if (!motion) {
        turnOffset += Math.PI / 5;
        turnTarget = turnOffset;
        render();
        return;
      }
      turnTarget += tau;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointermove", onPointer);
      renderer.domElement.removeEventListener("webglcontextlost", onLoss);
      scene.traverse((obj) => {
        if (
          obj instanceof THREE.Mesh ||
          obj instanceof THREE.LineSegments ||
          obj instanceof THREE.Points
        )
          obj.geometry.dispose();
      });
      materials.forEach((m) => m.dispose());
      moonGlow.material.map?.dispose();
      moonGlow.material.dispose();
      particleMat.map?.dispose();
      mirror?.getRenderTarget().dispose();
      envTarget.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.15, "rgba(255,255,255,.8)");
  g.addColorStop(0.45, "rgba(255,255,255,.12)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}
