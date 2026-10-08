import { buildPhotoRig, poseFromFrame, type AvatarFrame, type PhotoRig } from "@tlai/avatar";
import type { PhotoLook } from "@tlai/shared";
import { useEffect, useMemo, useRef, useState } from "react";

const TEX_VS = `#version 300 es
in vec2 a_pos; in vec2 a_uv; uniform vec4 u_map; uniform vec2 u_size; out vec2 v_uv;
void main() { vec2 p = a_pos * u_map.x + u_map.yz; v_uv = a_uv; gl_Position = vec4(p / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); }`;
const TEX_FS = `#version 300 es
precision mediump float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 o;
void main() { o = texture(u_tex, v_uv); }`;
const COL_VS = `#version 300 es
in vec2 a_pos; in vec4 a_col; uniform vec4 u_map; uniform vec2 u_size; out vec4 v_col;
void main() { vec2 p = a_pos * u_map.x + u_map.yz; v_col = a_col; gl_Position = vec4(p / u_size * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); }`;
const COL_FS = `#version 300 es
precision mediump float; in vec4 v_col; out vec4 o; void main() { o = v_col; }`;

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

interface GlState {
  gl: WebGL2RenderingContext;
  tex: WebGLProgram;
  col: WebGLProgram;
  texVao: WebGLVertexArrayObject;
  colVao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  colPosBuf: WebGLBuffer;
  colColBuf: WebGLBuffer;
}

/**
 * A realistic host animated from one portrait photo (mesh warp driven by the same
 * controller as the cartoon: lip sync, blinks, brows, small head turns, breathing).
 */
export function PhotoAvatar({ frame, photo }: { frame: AvatarFrame; photo: PhotoLook }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GlState | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadError, setError] = useState("");
  const { rig, rigError } = useMemo<{ rig: PhotoRig | null; rigError: string }>(() => {
    try {
      return { rig: buildPhotoRig(photo.landmarks, photo.width, photo.height), rigError: "" };
    } catch (e) {
      return { rig: null, rigError: (e as Error).message };
    }
  }, [photo.landmarks, photo.width, photo.height]);
  const error = rigError || loadError;

  useEffect(() => {
    const img = new Image();
    img.onload = () => setImage(img);
    img.onerror = () => setError("โหลดรูปตัวละครไม่ได้");
    img.src = photo.imageUrl;
  }, [photo.imageUrl]);

  // GL setup per photo
  useEffect(() => {
    const c = canvas.current;
    if (!c || !rig || !image) return;
    const gl = c.getContext("webgl2", { premultipliedAlpha: false, antialias: true, preserveDrawingBuffer: true });
    if (!gl) return setError("เครื่องนี้ไม่รองรับ WebGL2");
    let tex: WebGLProgram;
    let col: WebGLProgram;
    try {
      tex = program(gl, TEX_VS, TEX_FS);
      col = program(gl, COL_VS, COL_FS);
    } catch (e) {
      return setError(`แสดงตัวละครไม่ได้: ${(e as Error).message}`);
    }
    const texVao = gl.createVertexArray()!;
    gl.bindVertexArray(texVao);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rig.rest, gl.DYNAMIC_DRAW);
    const aPos = gl.getAttribLocation(tex, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, rig.uv, gl.STATIC_DRAW);
    const aUv = gl.getAttribLocation(tex, "a_uv");
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    const idx = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, rig.triangles, gl.STATIC_DRAW);

    const colVao = gl.createVertexArray()!;
    gl.bindVertexArray(colVao);
    const colPosBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colPosBuf);
    const cPos = gl.getAttribLocation(col, "a_pos");
    gl.enableVertexAttribArray(cPos);
    gl.vertexAttribPointer(cPos, 2, gl.FLOAT, false, 0, 0);
    const colColBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, colColBuf);
    const cCol = gl.getAttribLocation(col, "a_col");
    gl.enableVertexAttribArray(cCol);
    gl.vertexAttribPointer(cCol, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    glRef.current = { gl, tex, col, texVao, colVao, posBuf, colPosBuf, colColBuf };
    return () => {
      // Free this photo's resources but keep the context: the same canvas is reused for the next photo.
      for (const b of [posBuf, uvBuf, idx, colPosBuf, colColBuf]) gl.deleteBuffer(b);
      gl.deleteVertexArray(texVao);
      gl.deleteVertexArray(colVao);
      gl.deleteTexture(t);
      gl.deleteProgram(tex);
      gl.deleteProgram(col);
      glRef.current = null;
    };
  }, [rig, image]);

  // Draw every frame
  useEffect(() => {
    const g = glRef.current;
    const c = canvas.current;
    if (!g || !c || !rig) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(c.clientWidth * dpr);
    const H = Math.round(c.clientHeight * dpr);
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    // Cover the stage, keep the face centred and in the upper third, with a little overscan for sway.
    const f = rig.faceBox;
    const s = Math.max(W / photo.width, H / photo.height, (0.26 * H) / f.h) * 1.03;
    const ox = Math.min(0, Math.max(W - photo.width * s, W / 2 - f.cx * s));
    const oy = Math.min(0, Math.max(H - photo.height * s, 0.36 * H - f.cy * s));
    const pos = rig.deform(poseFromFrame(frame));
    const mouth = rig.mouth(pos);
    const { gl } = g;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const prog of [g.col, g.tex]) {
      gl.useProgram(prog);
      gl.uniform4f(gl.getUniformLocation(prog, "u_map"), s, ox, oy, 0);
      gl.uniform2f(gl.getUniformLocation(prog, "u_size"), W, H);
    }
    if (mouth.positions.length) {
      gl.useProgram(g.col);
      gl.bindVertexArray(g.colVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.colPosBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mouth.positions), gl.STREAM_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.colColBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mouth.colors), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, mouth.positions.length / 2);
    }
    gl.useProgram(g.tex);
    gl.bindVertexArray(g.texVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, pos);
    gl.drawElements(gl.TRIANGLES, rig.triangles.length, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  });

  if (error) return <div className="photo-error">{error}</div>;
  return <canvas ref={canvas} className="photo-avatar" />;
}
