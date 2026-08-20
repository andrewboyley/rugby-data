// Satteld up a WebGL layer for drawing team-colored metaballs (blobs) around player nodes.
// Uses additive blending of soft discs per node, colored by team, to produce fusing blobs.

import type { Sigma } from "sigma";
import type Graph from "graphology";

/**
 * Create a metaballs layer.
 * @param canvas The canvas element (created via sigma.createLayer("metaballs", "canvas", ...)).
 * @returns An object with update and kill methods.
 */
export function createMetaballs(
  canvas: HTMLCanvasElement,
  opts: {
    getTeams: () => Record<number, { name: string; color: string; alternateColor?: string }>;
    getNodeColor: () => string;
    getAlphaMin: () => number;
    getAlphaMax: () => number;
    getWinRates: () => Map<string, number>;
    getShowEdges: () => boolean;
    getMatchEventId: () => number | null;
  }
) {
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let vboQuad: WebGLBuffer | null = null; // quad corner positions
  let vboInstancePos: WebGLBuffer | null = null; // per-instance position (viewport pixels)
  let vboInstanceRadius: WebGLBuffer | null = null; // per-instance radius (pixels)
  let vboInstanceColor: WebGLBuffer | null = null; // per-instance color (rgb)
  let instanceCount = 0;
  let width = 0;
  let height = 0;

  // Vertex shader: passes through quad corners and instance data.
  const vertexShaderSource = `#version 300 es
    precision highp float;
    layout(location = 0) in vec2 a_corner; // quad corner in [-1,1] (will be scaled by radius and shifted by position)
    layout(location = 1) in vec2 a_pos;    // instance position in viewport pixels
    layout(location = 2) in float a_radius;// instance radius in pixels
    layout(location = 3) in vec3 a_color;  // instance color (rgb)
    uniform vec2 u_viewport; // viewport size (width, height) in pixels
    out vec2 v_pos;
    out float v_radius;
    out vec3 v_color;
    void main() {
      // Convert instance position from viewport pixels to clip space [-1,1]
      vec2 clipPos = (2.0 * a_pos / u_viewport) - 1.0;
      clipPos.y = -clipPos.y; // flip Y because viewport Y increases downward, clip Y increases upward
      // Apply corner offset (in pixels) scaled by radius and converted to clip space
      vec2 cornerClip = (2.0 * (a_corner * a_radius) / u_viewport);
      cornerClip.y = -cornerClip.y;
      vec2 finalPos = clipPos + cornerClip;
      gl_Position = vec4(finalPos, 0.0, 1.0);
      v_pos = a_pos;
      v_radius = a_radius;
      v_color = a_color;
    }
  `;

  // Fragment shader: smooth disc with additive blending.
  const fragmentShaderSource = `#version 300 es
    precision highp float;
    in vec2 v_pos;
    in float v_radius;
    in vec3 v_color;
    out vec4 outColor;
    void main() {
      vec2 d = gl_FragCoord.xy - v_pos; // pixel distance from fragment to circle center
      float dist = length(d);
      // Soft disc: full inside, smooth fade to zero at radius
      float alpha = 1.0 - smoothstep(v_radius * 0.5, v_radius, dist);
      outColor = vec4(v_color, alpha);
    }
  `;

  // Initialize WebGL context and compile shaders.
  function initGL() {
    gl = canvas.getContext("webgl2");
    if (!gl) {
      return;
    }

    // Create shader program
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    if (!vertexShader) {
      throw new Error("Unable to create vertex shader");
    }
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
      throw new Error("Vertex shader error: " + gl.getShaderInfoLog(vertexShader));
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fragmentShader) {
      throw new Error("Unable to create fragment shader");
    }
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
      throw new Error("Fragment shader error: " + gl.getShaderInfoLog(fragmentShader));
    }

    program = gl.createProgram();
    if (!program) {
      throw new Error("Unable to create shader program");
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("Shader program error: " + gl.getProgramInfoLog(program));
    }

    // Get attribute locations
    // We'll bind attributes manually via glBindAttribLocation before linking? Actually we can query after link.
    // But we set layout(location=...) in the shaders, so we can use those locations.

    // Create VAO and VBOs
    vao = gl.createVertexArray();
    if (!vao) {
      throw new Error("Unable to create VAO");
    }
    gl.bindVertexArray(vao);

    // Quad corner positions: [-1,-1], [1,-1], [-1,1], [1,1] (triangle strip)
    const quadCorners = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1
    ]);
    vboQuad = gl.createBuffer();
    if (!vboQuad) {
      throw new Error("Unable to create VBO for quad");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboQuad);
    gl.bufferData(gl.ARRAY_BUFFER, quadCorners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); // a_corner
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Instance buffers (will be updated each frame)
    vboInstancePos = gl.createBuffer();
    if (!vboInstancePos) {
      throw new Error("Unable to create VBO for instance positions");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboInstancePos);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW); // initial size 0
    gl.enableVertexAttribArray(1); // a_pos
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1); // update once per instance

    vboInstanceRadius = gl.createBuffer();
    if (!vboInstanceRadius) {
      throw new Error("Unable to create VBO for instance radii");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboInstanceRadius);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2); // a_radius
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(2, 1);

    vboInstanceColor = gl.createBuffer();
    if (!vboInstanceColor) {
      throw new Error("Unable to create VBO for instance colors");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, vboInstanceColor);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3); // a_color
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);

    // Set blending for additive metaballs effect
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // additive blending
    gl.disable(gl.DEPTH_TEST);
  }

  // Resize the viewport to match the host (graph) size.
  function resize() {
    if (!gl) return;
    const host = canvas.parentElement;
    const rectW = host ? host.clientWidth : canvas.clientWidth;
    const rectH = host ? host.clientHeight : canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    width = Math.round(rectW * dpr);
    height = Math.round(rectH * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = rectW + "px";
      canvas.style.height = rectH + "px";
    }
    gl.viewport(0, 0, width, height);
  }

  // Update instance buffers with node data.
  function updateInstanceData(sigma: Sigma, graph: Graph) {
    if (!gl) return;
    // Gather data for each node: position (viewport pixels), radius (pixels), color (team color).
    const positions: number[] = [];
    const radii: number[] = [];
    const colors: number[] = [];

    graph.forEachNode((_, attributes) => {
      // Get node position in viewport pixels
      const posAttr = { x: attributes.x, y: attributes.y };
      const viewportPos = sigma.graphToViewport(posAttr);
      // Get node screen radius
      const sizeAttr = attributes.size ?? 1;
      const radius = sigma.scaleSize(sizeAttr as number);
      // Get team color (fallback to default node color if team missing)
      const teamId = attributes.team ?? null;
      let colorVec: [number, number, number] = [0.5, 0.5, 0.5]; // gray fallback
      if (teamId !== null) {
        const teams = opts.getTeams();
        const team = teams[teamId];
        if (team && team.color) {
          // Convert hex color to rgb 0-1
          const hex = team.color.replace("#", "");
          const r = parseInt(hex.substring(0, 2), 16) / 255;
          const g = parseInt(hex.substring(2, 4), 16) / 255;
          const b = parseInt(hex.substring(4, 6), 16) / 255;
          colorVec = [r, g, b];
        }
      }
      // Append data
      positions.push(viewportPos.x, viewportPos.y);
      radii.push(radius);
      colors.push(colorVec[0], colorVec[1], colorVec[2]);
    });

    instanceCount = positions.length / 2;

    // Update buffers (orphan then bufferData for efficiency)
    if (vboInstancePos) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vboInstancePos);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.DYNAMIC_DRAW);
    }
    if (vboInstanceRadius) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vboInstanceRadius);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(radii), gl.DYNAMIC_DRAW);
    }
    if (vboInstanceColor) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vboInstanceColor);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.DYNAMIC_DRAW);
    }
  }

  // Public update method: call from sigma afterRender hook.
  function update(sigma: Sigma, graph: Graph) {
    if (!gl || !program || !vao) return;
    resize();
    // Use the program
    gl.useProgram(program);
    // Set viewport uniform
    const viewportLoc = gl.getUniformLocation(program, "u_viewport");
    if (viewportLoc !== null) {
      gl.uniform2f(viewportLoc, width, height);
    }
    // Update instance data
    updateInstanceData(sigma, graph);
    // Draw instances
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
    gl.bindVertexArray(null);
  }

  // Clean up WebGL resources.
  function kill() {
    if (!gl) return;
    if (program) gl.deleteProgram(program);
    if (vao) gl.deleteVertexArray(vao);
    if (vboQuad) gl.deleteBuffer(vboQuad);
    if (vboInstancePos) gl.deleteBuffer(vboInstancePos);
    if (vboInstanceRadius) gl.deleteBuffer(vboInstanceRadius);
    if (vboInstanceColor) gl.deleteBuffer(vboInstanceColor);
    gl = null;
    program = null;
    vao = null;
    vboQuad = null;
    vboInstancePos = null;
    vboInstanceRadius = null;
    vboInstanceColor = null;
  }

  // Initialize GL now
  initGL();

  return { update, kill };
}