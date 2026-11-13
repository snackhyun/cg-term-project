
window.onload = function init() 
{
  const canvas = document.getElementById( "gl-canvas" );

  const renderer = new THREE.WebGLRenderer({canvas});

  const fov = 75;
  const aspect = 2;  // the canvas default
  const near = 0.1;
  const far = 5;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.z = 2;

  const scene = new THREE.Scene();

  {
    const color = 0xFFFFFF;
    const intensity = 1;
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(-1, 2, 4);
    scene.add(light);
  }

  const boxWidth = 1;
  const boxHeight = 1;
  const boxDepth = 1;
  const geometry = new THREE.BoxGeometry(boxWidth, boxHeight, boxDepth);

  function vertexShader() {
	  return `
		varying vec3 vUv;
		void main() {
			vUv = position;
			vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
			gl_Position = projectionMatrix * modelViewPosition;
		}
		
	  `;
  }

  
  function fragmentShader() {
	  return `
		uniform vec3 colorA;
		uniform vec3 colorB;
		varying vec3 vUv;
		
		void main() {
			gl_FragColor = vec4(mix(colorA, colorB, vUv.z), 1.0);
		}
	  `;
  }

  function makeInstance(geometry, color, x) {
    let material;
	if(x == -2) {
		let uniforms = {};
		uniforms.colorA = {type: 'vec3', value: new THREE.Color(color)};
		uniforms.colorB = {type: 'vec3', value: new THREE.Color(0xACB6E5)};
		material = new THREE.ShaderMaterial({
			uniforms: uniforms,
			fragmentShader: fragmentShader(),
			vertexShader: vertexShader()			
		});
	} else {
		material = new THREE.MeshPhongMaterial({color});
	}

    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    cube.position.x = x;

    return cube;
  }

  const cubes = [
    makeInstance(geometry, 0x44aa88,  0),
    makeInstance(geometry, 0x8844aa, -2),
    makeInstance(geometry, 0xaa8844,  2),
  ];

  function render(time) {
    time *= 0.001;  // convert time to seconds

    cubes.forEach((cube, ndx) => {
      const speed = 1 + ndx * .1;
      const rot = time * speed;
      cube.rotation.x = rot;
      cube.rotation.y = rot;
    });

    renderer.render(scene, camera);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);	
}
