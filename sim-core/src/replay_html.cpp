#include "fluidsim/sim_core.hpp"

#include <ostream>

namespace fluidsim {

void writeReplayHtml(std::ostream& output, const ReplayCapture& capture) {
  output << R"HTML(<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FluidSim Viscous Finger Tank Replay</title>
  <style>
    :root{color-scheme:dark;--bg:#061019;--panel:rgba(8,23,34,.82);--border:rgba(128,188,221,.18);--text:#eef8fc;--muted:#88a8bb;--accent:#7ee8ff;--warm:#ffd18a;--danger:#ff948a}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:"Segoe UI Variable Display","Segoe UI",Aptos,sans-serif;color:var(--text);background:radial-gradient(circle at top left,rgba(92,178,225,.14),transparent 28%),radial-gradient(circle at bottom right,rgba(13,76,121,.24),transparent 30%),linear-gradient(180deg,#08131d 0%,#03070c 100%)}
    .page{width:min(1480px,calc(100vw - 32px));margin:18px auto 28px;display:grid;gap:16px}
    .hero,.controls,.metrics,.stage-shell,.note{border:1px solid var(--border);background:var(--panel);backdrop-filter:blur(18px);border-radius:24px;box-shadow:0 20px 80px rgba(0,0,0,.32)}
    .hero{padding:24px 26px 22px;display:grid;gap:10px}.eyebrow{margin:0;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted)}h1{margin:0;font-size:clamp(28px,5vw,54px);line-height:.98}.lede{margin:0;max-width:900px;color:var(--muted);font-size:15px;line-height:1.6}
    .controls{padding:16px 18px;display:grid;gap:14px}.button-row,.status-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
    button{border:none;border-radius:999px;padding:10px 16px;font:inherit;color:var(--text);background:linear-gradient(135deg,rgba(94,196,241,.34),rgba(45,104,186,.3));cursor:pointer;transition:transform 120ms ease,filter 120ms ease}
    button.secondary{background:rgba(255,255,255,.06)}button:hover{transform:translateY(-1px);filter:brightness(1.05)}
    .status-pill{padding:9px 14px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--muted);font-size:13px}.status-pill strong{color:var(--text)}
    .range-row{display:grid;gap:8px}.range-row label{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:14px}input[type="range"]{width:100%;accent-color:var(--accent)}
    .metrics{padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.metric-card{padding:14px 15px;border-radius:18px;background:rgba(8,20,29,.78);border:1px solid rgba(115,176,207,.16)}.metric-card span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}.metric-card strong{display:block;font-size:21px;line-height:1.15}
    .stage-shell{padding:18px;display:grid;gap:12px}canvas{width:100%;height:min(74vh,920px);display:block;border-radius:20px;background:linear-gradient(180deg,rgba(8,19,30,.95),rgba(3,8,13,1))}
    .note{padding:14px 16px;color:var(--muted);font-size:13px;line-height:1.5}.note strong{color:var(--warm);font-weight:600}.unsupported{color:var(--danger)}
  </style>
</head>
<body>
  <div class="page">
    <section class="hero">
      <p class="eyebrow">Offline Replay Artifact</p>
      <h1>FluidSim Viscous Finger Tank</h1>
      <p class="lede">This artifact starts on a hero frame and lets the GPU progressively refine the liquid surface, glass, spray, and branching low-viscosity tracer. Press play for a faster preview, or leave it paused and let the accumulation climb for a more expensive offline look.</p>
    </section>
    <section class="controls">
      <div class="button-row">
        <button id="play-toggle" type="button">Play Preview</button>
        <button id="step-back" type="button" class="secondary">Step Back</button>
        <button id="step-forward" type="button" class="secondary">Step Forward</button>
        <button id="hero-toggle" type="button" class="secondary">Jump To Hero Frame</button>
      </div>
      <div class="status-row">
        <div class="status-pill"><strong id="mode-label">Paused</strong> <span id="mode-detail">Accumulating cinematic render</span></div>
        <div class="status-pill"><strong id="sample-count">0</strong> samples on current frame</div>
        <div class="status-pill" id="gpu-label"><strong>Renderer</strong> <span>Starting</span></div>
      </div>
      <div class="range-row">
        <label for="frame-slider"><span>Replay Frame</span><strong id="frame-label">0 / 0</strong></label>
        <input id="frame-slider" type="range" min="0" max="0" value="0">
      </div>
    </section>
    <section class="metrics" id="metrics"></section>
    <section class="stage-shell"><canvas id="stage" width="1600" height="960" aria-label="Offline fluid replay"></canvas></section>
    <section class="note"><strong>What changed:</strong> this replay now carries a surface tracer field inspired by viscous-fingering literature, so injected fluid forms branching concentration paths instead of a uniform fill. The viewer shades those fingers with WebGL2 progressive accumulation. Leave the frame paused if you want it to spend real GPU time cleaning up the highlights and refractions.<div id="unsupported-note" class="unsupported" hidden>WebGL2 is unavailable here, so the artifact can only fall back to a lightweight 2D preview.</div></section>
  </div>
  <script>
    const replayData = )HTML";
  output << serializeReplayCapture(capture);
  output << R"HTML(;
    const canvas=document.getElementById('stage'),playToggle=document.getElementById('play-toggle'),stepBack=document.getElementById('step-back'),stepForward=document.getElementById('step-forward'),heroToggle=document.getElementById('hero-toggle'),frameSlider=document.getElementById('frame-slider'),frameLabel=document.getElementById('frame-label'),metricsHost=document.getElementById('metrics'),modeLabel=document.getElementById('mode-label'),modeDetail=document.getElementById('mode-detail'),sampleCountLabel=document.getElementById('sample-count'),gpuLabel=document.getElementById('gpu-label'),unsupportedNote=document.getElementById('unsupported-note');
    const frames=replayData.frames,tank=replayData.config.tankSize,surfaceWidth=replayData.config.gridResolution[0],surfaceDepth=replayData.config.gridResolution[2],heroFrameIndex=Math.max(0,Math.min(frames.length-1,Math.floor(frames.length*.72))),playbackFrameDuration=Math.max(40,replayData.config.fixedTimeStep*Math.max(1,replayData.captureStride)*1000),targetSamples=2048,dpr=Math.min(window.devicePixelRatio||1,1.6);
    let frameIndex=heroFrameIndex,playbackAccumulator=0,lastTime=performance.now(),isPlaying=false,currentFrame=frames[frameIndex];
    const clamp=(v,min,max)=>Math.min(max,Math.max(min,v)),mix=(a,b,t)=>a+(b-a)*t,fmt=(v,s,d=2)=>`${Number(v).toFixed(d)}${s}`;
    function buildMetricCards(frame,sampleCount){const cards=[['Frame',`${frame.frameIndex} / ${replayData.stepCount}`],['Fill Height',fmt(frame.fillHeight,' m',3)],['Finger Mix',`${Math.round((frame.fingerMix||0)*1000)/10}%`],['Spray Particles',`${frame.particles.length}`],['Surface Grid',`${surfaceWidth} x ${surfaceDepth}`],['Mass Error',fmt(frame.massLedger.error,' kg',5)],['Accumulation',`${sampleCount} / ${targetSamples}`]];metricsHost.innerHTML=cards.map(([label,value])=>`<article class="metric-card"><span>${label}</span><strong>${value}</strong></article>`).join('')}
    function resizeCanvas(){const width=Math.max(1,Math.floor(canvas.clientWidth*dpr)),height=Math.max(1,Math.floor(canvas.clientHeight*dpr));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}}
    function updateFrameLabel(){frameLabel.textContent=`${frameIndex+1} / ${frames.length}`;frameSlider.value=frameIndex}
    function updateModeLabel(sampleCount){if(isPlaying){modeLabel.textContent='Preview';modeDetail.textContent='Realtime playback with fast shading'}else{modeLabel.textContent='Paused';modeDetail.textContent=sampleCount>=targetSamples?'Hero frame settled':'Accumulating cinematic render'}}
    function create2dFallback(){const ctx=canvas.getContext('2d');function project(point){const scale=Math.min((canvas.width-200)/(tank.x+tank.z*1.0),(canvas.height-180)/(tank.y+tank.z*.52));return{x:canvas.width*.57+(point.x-point.z*.8)*scale,y:canvas.height*.88-(point.y+point.z*.35)*scale}}function drawFrame(frame){ctx.clearRect(0,0,canvas.width,canvas.height);const bg=ctx.createLinearGradient(0,0,0,canvas.height);bg.addColorStop(0,'#0a1823');bg.addColorStop(1,'#03080d');ctx.fillStyle=bg;ctx.fillRect(0,0,canvas.width,canvas.height);const hw=tank.x*.5,hd=tank.z*.5,top=[project({x:-hw,y:frame.fillHeight,z:hd}),project({x:hw,y:frame.fillHeight,z:hd}),project({x:hw,y:frame.fillHeight,z:-hd}),project({x:-hw,y:frame.fillHeight,z:-hd})];ctx.beginPath();ctx.moveTo(top[0].x,top[0].y);top.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.fillStyle='rgba(102,207,255,.35)';ctx.fill();ctx.strokeStyle='rgba(190,239,255,.78)';ctx.lineWidth=2;ctx.stroke();frame.particles.forEach(p=>{const q=project(p.position),r=Math.max(1.8,p.radius*canvas.height*.9),g=ctx.createRadialGradient(q.x,q.y,0,q.x,q.y,r*3);g.addColorStop(0,'rgba(241,252,255,.96)');g.addColorStop(.35,'rgba(126,226,255,.88)');g.addColorStop(1,'rgba(67,174,220,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(q.x,q.y,r*3,0,Math.PI*2);ctx.fill()})}return{reset(){},setFrame(frame){drawFrame(frame);buildMetricCards(frame,0);sampleCountLabel.textContent='0';updateModeLabel(0)},tick(){}}}
    function createWebglRenderer(){
      const gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:true,stencil:false,powerPreference:'high-performance',preserveDrawingBuffer:false});if(!gl){unsupportedNote.hidden=false;return create2dFallback()}if(!gl.getExtension('EXT_color_buffer_float'))unsupportedNote.hidden=false;const debug=gl.getExtension('WEBGL_debug_renderer_info');if(debug){const label=(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)||'WebGL2').replace(/^ANGLE \(/i,'').replace(/\)$/i,'');gpuLabel.innerHTML=`<strong>Renderer</strong> <span>${label}</span>`}
      const liquidVs=`#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;layout(location=1) in vec3 aNormal;layout(location=2) in float aFinger;uniform mat4 uViewProj;out vec3 vWorldPos;out vec3 vNormal;out float vFinger;void main(){vWorldPos=aPosition;vNormal=aNormal;vFinger=aFinger;gl_Position=uViewProj*vec4(aPosition,1.0);}`;
      const liquidFs=`#version 300 es
precision highp float;in vec3 vWorldPos;in vec3 vNormal;in float vFinger;uniform vec3 uCameraPos;uniform vec3 uLightDir;uniform float uTime;uniform float uSampleIndex;uniform vec3 uTankSize;out vec4 fragColor;float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453123);}vec3 sky(vec3 dir){float sun=pow(max(dot(normalize(dir),normalize(vec3(-0.32,0.84,0.28))),0.0),140.0);float h=clamp(dir.y*0.5+0.5,0.0,1.0);vec3 s=mix(vec3(0.015,0.032,0.05),vec3(0.12,0.23,0.34),h);s+=sun*vec3(1.0,0.88,0.72);return s;}void main(){vec3 n=normalize(vNormal),v=normalize(uCameraPos-vWorldPos);float noise=hash(vec3(gl_FragCoord.xy*0.017,uSampleIndex*0.031+uTime*0.1));vec3 t=normalize(abs(n.y)>0.95?cross(n,vec3(1,0,0)):cross(n,vec3(0,1,0)));vec3 b=normalize(cross(n,t));vec2 j=vec2(cos(noise*6.28318),sin(noise*6.28318))*0.08;vec3 m=normalize(n+t*j.x+b*j.y);float fresnel=pow(1.0-max(dot(v,m),0.0),5.0);vec3 reflected=sky(reflect(-v,m));float floorMask=clamp(1.0-vWorldPos.y/max(uTankSize.y,0.001),0.0,1.0);float caustic=(sin(vWorldPos.x*13.0+uTime*0.7+noise*4.0)*0.5+0.5)*(sin(vWorldPos.z*11.0-uTime*0.5+noise*3.0)*0.5+0.5);vec3 refracted=mix(vec3(0.035,0.12,0.19),vec3(0.06,0.35,0.48),floorMask);refracted+=caustic*floorMask*0.12*vec3(0.6,1.0,0.95);float diffuse=max(dot(normalize(uLightDir),m),0.0);float specular=pow(max(dot(reflect(-normalize(uLightDir),m),v),0.0),64.0);float finger=clamp(vFinger,0.0,1.0);vec3 tracer=mix(vec3(0.02,0.20,0.24),vec3(0.93,0.72,0.22),smoothstep(0.05,0.92,finger));vec3 tint=mix(refracted,reflected,0.16+0.66*fresnel);tint=mix(tint,tint+tracer*(0.22+0.58*finger),finger*(0.42+0.24*fresnel));tint+=diffuse*vec3(0.02,0.08,0.12);tint+=specular*vec3(1.0,0.96,0.9)*(0.18+0.62*fresnel);fragColor=vec4(tint,0.98);}`;
      const particleVs=`#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;uniform mat4 uViewProj;uniform vec3 uCameraPos;void main(){vec4 clip=uViewProj*vec4(aPosition,1.0);gl_Position=clip;float dist=length(uCameraPos-aPosition);gl_PointSize=clamp(620.0/max(dist,0.2),2.0,26.0);}`;
      const particleFs=`#version 300 es
precision highp float;out vec4 fragColor;void main(){vec2 uv=gl_PointCoord*2.0-1.0;float d=dot(uv,uv);if(d>1.0)discard;float a=exp(-d*3.8);vec3 c=mix(vec3(0.12,0.58,0.82),vec3(0.9,0.98,1.0),a);fragColor=vec4(c,a*0.6);}`;
      const lineVs=`#version 300 es
precision highp float;layout(location=0) in vec3 aPosition;uniform mat4 uViewProj;void main(){gl_Position=uViewProj*vec4(aPosition,1.0);}`;
      const lineFs=`#version 300 es
precision highp float;uniform vec4 uColor;out vec4 fragColor;void main(){fragColor=uColor;}`;
      const quadVs=`#version 300 es
precision highp float;const vec2 P[3]=vec2[3](vec2(-1,-1),vec2(3,-1),vec2(-1,3));out vec2 vUv;void main(){vec2 p=P[gl_VertexID];vUv=p*0.5+0.5;gl_Position=vec4(p,0,1);}`;
      const combineFs=`#version 300 es
precision highp float;in vec2 vUv;uniform sampler2D uCurrent;uniform sampler2D uHistory;uniform float uSampleCount;out vec4 fragColor;void main(){vec3 c=texture(uCurrent,vUv).rgb,h=texture(uHistory,vUv).rgb;float blend=1.0/(uSampleCount+1.0);fragColor=vec4(mix(h,c,blend),1.0);}`;
      const presentFs=`#version 300 es
precision highp float;in vec2 vUv;uniform sampler2D uTexture;out vec4 fragColor;vec3 tonemap(vec3 x){return clamp((x*(2.15*x+0.05))/(x*(2.4*x+0.62)+0.12),0.0,1.0);}void main(){vec3 c=texture(uTexture,vUv).rgb;fragColor=vec4(pow(tonemap(c),vec3(1.0/2.2)),1.0);}`;
    )HTML";
  output << R"HTML(
      const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Shader compile failed.');return shader};
      const createProgram=(vs,fs)=>{const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vs));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fs));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Program link failed.');return program};
      const uniforms=(program,names)=>Object.fromEntries(names.map(name=>[name,gl.getUniformLocation(program,name)]));
      const liquidProgram=createProgram(liquidVs,liquidFs),particleProgram=createProgram(particleVs,particleFs),lineProgram=createProgram(lineVs,lineFs),combineProgram=createProgram(quadVs,combineFs),presentProgram=createProgram(quadVs,presentFs);
      const liquidU=uniforms(liquidProgram,['uViewProj','uCameraPos','uLightDir','uTime','uSampleIndex','uTankSize']),particleU=uniforms(particleProgram,['uViewProj','uCameraPos']),lineU=uniforms(lineProgram,['uViewProj','uColor']),combineU=uniforms(combineProgram,['uCurrent','uHistory','uSampleCount']),presentU=uniforms(presentProgram,['uTexture']);
      const liquidVao=gl.createVertexArray(),liquidPos=gl.createBuffer(),liquidNrm=gl.createBuffer(),liquidFgr=gl.createBuffer();let liquidVertexCount=0;
      gl.bindVertexArray(liquidVao);gl.bindBuffer(gl.ARRAY_BUFFER,liquidPos);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,liquidNrm);gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);gl.bindBuffer(gl.ARRAY_BUFFER,liquidFgr);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,1,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
      const particleVao=gl.createVertexArray(),particleBuf=gl.createBuffer();let particleCount=0;gl.bindVertexArray(particleVao);gl.bindBuffer(gl.ARRAY_BUFFER,particleBuf);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindVertexArray(null);
      const lineVertices=new Float32Array([ -tank.x*.5,0,-tank.z*.5, tank.x*.5,0,-tank.z*.5, tank.x*.5,0,-tank.z*.5, tank.x*.5,tank.y,-tank.z*.5, tank.x*.5,tank.y,-tank.z*.5, -tank.x*.5,tank.y,-tank.z*.5, -tank.x*.5,tank.y,-tank.z*.5, -tank.x*.5,0,-tank.z*.5, -tank.x*.5,0,tank.z*.5, tank.x*.5,0,tank.z*.5, tank.x*.5,0,tank.z*.5, tank.x*.5,tank.y,tank.z*.5, tank.x*.5,tank.y,tank.z*.5, -tank.x*.5,tank.y,tank.z*.5, -tank.x*.5,tank.y,tank.z*.5, -tank.x*.5,0,tank.z*.5, -tank.x*.5,0,-tank.z*.5, -tank.x*.5,0,tank.z*.5, tank.x*.5,0,-tank.z*.5, tank.x*.5,0,tank.z*.5, -tank.x*.5,tank.y,-tank.z*.5, -tank.x*.5,tank.y,tank.z*.5, tank.x*.5,tank.y,-tank.z*.5, tank.x*.5,tank.y,tank.z*.5 ]);
      const lineVao=gl.createVertexArray(),lineBuf=gl.createBuffer();gl.bindVertexArray(lineVao);gl.bindBuffer(gl.ARRAY_BUFFER,lineBuf);gl.bufferData(gl.ARRAY_BUFFER,lineVertices,gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);gl.bindVertexArray(null);const lineVertexCount=lineVertices.length/3;
      let sceneFbo=null,sceneTex=null,depthRb=null,accumTex=[null,null],accumFbo=[null,null],accumIndex=0,sampleCount=0;
      const tex=(w,h)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,w,h,0,gl.RGBA,gl.HALF_FLOAT,null);return t};
      const fbo=(texture)=>{const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Framebuffer incomplete.');return f};
      function rebuildFramebuffers(){resizeCanvas();const width=canvas.width,height=canvas.height;[sceneTex,...accumTex].forEach(t=>t&&gl.deleteTexture(t));[sceneFbo,...accumFbo].forEach(f=>f&&gl.deleteFramebuffer(f));if(depthRb)gl.deleteRenderbuffer(depthRb);sceneTex=tex(width,height);sceneFbo=fbo(sceneTex);depthRb=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depthRb);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,width,height);gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFbo);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depthRb);accumTex=[tex(width,height),tex(width,height)];accumFbo=[fbo(accumTex[0]),fbo(accumTex[1])];accumIndex=0;sampleCount=0}
      const perspective=(fovy,aspect,near,far)=>{const f=1/Math.tan(fovy*.5),r=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(near+far)*r,-1,0,0,near*far*r*2,0])};
      const normalize=v=>{const l=Math.hypot(v[0],v[1],v[2])||1;return[v[0]/l,v[1]/l,v[2]/l]},sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
      const lookAt=(eye,target,up)=>{const z=normalize(sub(eye,target)),x=normalize(cross(up,z)),y=cross(z,x);return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1])};
      const mul=(a,b)=>{const out=new Float32Array(16);for(let c=0;c<4;c+=1){for(let r=0;r<4;r+=1){out[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3]}}return out};
      function buildFrameGeometry(frame){const heights=frame.surfaceHeights.length?frame.surfaceHeights:Array(surfaceWidth*surfaceDepth).fill(frame.fillHeight),positions=[],normals=[],spray=new Float32Array(frame.particles.length*3),heightAt=(x,z)=>heights[clamp(z,0,surfaceDepth-1)*surfaceWidth+clamp(x,0,surfaceWidth-1)],world=(x,z,y)=>[mix(-tank.x*.5,tank.x*.5,x/(surfaceWidth-1)),y,mix(-tank.z*.5,tank.z*.5,z/(surfaceDepth-1))],normalAt=(x,z)=>normalize(cross(sub(world(x,z+1,heightAt(x,z+1)),world(x,z-1,heightAt(x,z-1))),sub(world(x+1,z,heightAt(x+1,z)),world(x-1,z,heightAt(x-1,z)))));const push=(p,n)=>{positions.push(p[0],p[1],p[2]);normals.push(n[0],n[1],n[2])},tri=(a,b,c,na,nb,nc)=>{push(a,na);push(b,nb);push(c,nc)},side=(topA,topB,bottomA,bottomB,normal)=>{tri(bottomA,bottomB,topB,normal,normal,normal);tri(bottomA,topB,topA,normal,normal,normal)};
        for(let z=0;z<surfaceDepth-1;z+=1){for(let x=0;x<surfaceWidth-1;x+=1){const a=world(x,z,heightAt(x,z)),b=world(x+1,z,heightAt(x+1,z)),c=world(x+1,z+1,heightAt(x+1,z+1)),d=world(x,z+1,heightAt(x,z+1)),na=normalAt(x,z),nb=normalAt(x+1,z),nc=normalAt(x+1,z+1),nd=normalAt(x,z+1);tri(a,b,c,na,nb,nc);tri(a,c,d,na,nc,nd)}}
        for(let x=0;x<surfaceWidth-1;x+=1){const fa=world(x,surfaceDepth-1,heightAt(x,surfaceDepth-1)),fb=world(x+1,surfaceDepth-1,heightAt(x+1,surfaceDepth-1)),fba=[fa[0],0,fa[2]],fbb=[fb[0],0,fb[2]];side(fa,fb,fba,fbb,[0,0,1]);const ba=world(x,0,heightAt(x,0)),bb=world(x+1,0,heightAt(x+1,0)),bba=[ba[0],0,ba[2]],bbb=[bb[0],0,bb[2]];side(bb,ba,bbb,bba,[0,0,-1])}
        for(let z=0;z<surfaceDepth-1;z+=1){const la=world(0,z,heightAt(0,z)),lb=world(0,z+1,heightAt(0,z+1)),lba=[la[0],0,la[2]],lbb=[lb[0],0,lb[2]];side(lb,la,lbb,lba,[-1,0,0]);const ra=world(surfaceWidth-1,z,heightAt(surfaceWidth-1,z)),rb=world(surfaceWidth-1,z+1,heightAt(surfaceWidth-1,z+1)),rba=[ra[0],0,ra[2]],rbb=[rb[0],0,rb[2]];side(ra,rb,rba,rbb,[1,0,0])}
        frame.particles.forEach((p,i)=>{spray[i*3]=p.position.x;spray[i*3+1]=p.position.y;spray[i*3+2]=p.position.z});gl.bindBuffer(gl.ARRAY_BUFFER,liquidPos);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.DYNAMIC_DRAW);gl.bindBuffer(gl.ARRAY_BUFFER,liquidNrm);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(normals),gl.DYNAMIC_DRAW);liquidVertexCount=positions.length/3;gl.bindBuffer(gl.ARRAY_BUFFER,particleBuf);gl.bufferData(gl.ARRAY_BUFFER,spray,gl.DYNAMIC_DRAW);particleCount=frame.particles.length}
      function resetAccumulation(){sampleCount=0;accumIndex=0;buildMetricCards(currentFrame,sampleCount);sampleCountLabel.textContent=String(sampleCount);updateModeLabel(sampleCount)}
      function setCurrentFrame(frame){currentFrame=frame;buildFrameGeometry(frame);resetAccumulation()}
    )HTML";
  output << R"HTML(
      function renderScene(viewProj,cameraPos,sampleIndex,time){gl.bindFramebuffer(gl.FRAMEBUFFER,sceneFbo);gl.viewport(0,0,canvas.width,canvas.height);gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.clearColor(.03,.06,.09,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.useProgram(liquidProgram);gl.uniformMatrix4fv(liquidU.uViewProj,false,viewProj);gl.uniform3f(liquidU.uCameraPos,cameraPos[0],cameraPos[1],cameraPos[2]);gl.uniform3f(liquidU.uLightDir,-.4,.9,.3);gl.uniform1f(liquidU.uTime,time);gl.uniform1f(liquidU.uSampleIndex,sampleIndex);gl.uniform3f(liquidU.uTankSize,tank.x,tank.y,tank.z);gl.bindVertexArray(liquidVao);gl.drawArrays(gl.TRIANGLES,0,liquidVertexCount);gl.useProgram(lineProgram);gl.uniformMatrix4fv(lineU.uViewProj,false,viewProj);gl.uniform4f(lineU.uColor,.84,.94,1,.9);gl.bindVertexArray(lineVao);gl.drawArrays(gl.LINES,0,lineVertexCount);if(particleCount>0){gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE);gl.useProgram(particleProgram);gl.uniformMatrix4fv(particleU.uViewProj,false,viewProj);gl.uniform3f(particleU.uCameraPos,cameraPos[0],cameraPos[1],cameraPos[2]);gl.bindVertexArray(particleVao);gl.drawArrays(gl.POINTS,0,particleCount);gl.disable(gl.BLEND)}}
      function present(texture){gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.disable(gl.DEPTH_TEST);gl.useProgram(presentProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(presentU.uTexture,0);gl.drawArrays(gl.TRIANGLES,0,3)}
      function accumulate(timeSeconds){const cameraJitter=(sampleCount%5)*.0006,cameraPos=[tank.x*(1.25+cameraJitter),tank.y*.95+cameraJitter*8,tank.z*1.85-cameraJitter*10],target=[0,tank.y*.28,0],projection=perspective(.68,canvas.width/canvas.height,.01,20),view=lookAt(cameraPos,target,[0,1,0]),viewProj=mul(projection,view);renderScene(viewProj,cameraPos,sampleCount,timeSeconds);const writeIndex=(accumIndex+1)%2;gl.bindFramebuffer(gl.FRAMEBUFFER,accumFbo[writeIndex]);gl.viewport(0,0,canvas.width,canvas.height);gl.disable(gl.DEPTH_TEST);gl.useProgram(combineProgram);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,sceneTex);gl.uniform1i(combineU.uCurrent,0);gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,accumTex[accumIndex]);gl.uniform1i(combineU.uHistory,1);gl.uniform1f(combineU.uSampleCount,sampleCount);gl.drawArrays(gl.TRIANGLES,0,3);accumIndex=writeIndex;sampleCount+=1;buildMetricCards(currentFrame,sampleCount);sampleCountLabel.textContent=String(sampleCount);updateModeLabel(sampleCount);present(accumTex[accumIndex])}
      rebuildFramebuffers();setCurrentFrame(currentFrame);
      return{reset(){rebuildFramebuffers();setCurrentFrame(currentFrame)},setFrame(frame){setCurrentFrame(frame)},tick(timeSeconds){if(canvas.width===0||canvas.height===0)return;const maxSamples=isPlaying?1:6,desired=isPlaying?1:targetSamples,toRun=clamp(desired-sampleCount,1,maxSamples);for(let i=0;i<toRun;i+=1){if(sampleCount>=desired)break;accumulate(timeSeconds+i*.0007)}}}
    }
    resizeCanvas();frameSlider.max=Math.max(0,frames.length-1);updateFrameLabel();
    let renderer=createWebglRenderer();renderer.setFrame(currentFrame);buildMetricCards(currentFrame,0);sampleCountLabel.textContent='0';updateModeLabel(0);
    function setFrameByIndex(nextIndex){frameIndex=clamp(nextIndex,0,frames.length-1);currentFrame=frames[frameIndex];updateFrameLabel();renderer.setFrame(currentFrame)}
    playToggle.addEventListener('click',()=>{isPlaying=!isPlaying;playToggle.textContent=isPlaying?'Pause Preview':'Play Preview';renderer.setFrame(currentFrame)});
    heroToggle.addEventListener('click',()=>{isPlaying=false;playToggle.textContent='Play Preview';setFrameByIndex(heroFrameIndex)});
    stepBack.addEventListener('click',()=>{isPlaying=false;playToggle.textContent='Play Preview';setFrameByIndex((frameIndex-1+frames.length)%frames.length)});
    stepForward.addEventListener('click',()=>{isPlaying=false;playToggle.textContent='Play Preview';setFrameByIndex((frameIndex+1)%frames.length)});
    frameSlider.addEventListener('input',event=>{isPlaying=false;playToggle.textContent='Play Preview';setFrameByIndex(Number(event.target.value))});
    window.addEventListener('resize',()=>{resizeCanvas();renderer.reset()});
    function tick(now){const delta=now-lastTime;lastTime=now;if(isPlaying&&frames.length>1){playbackAccumulator+=delta;while(playbackAccumulator>=playbackFrameDuration){playbackAccumulator-=playbackFrameDuration;setFrameByIndex((frameIndex+1)%frames.length)}}renderer.tick(now*.001);requestAnimationFrame(tick)}
    setFrameByIndex(heroFrameIndex);requestAnimationFrame(tick);
  </script>
</body>
</html>
    )HTML";
}

}  // namespace fluidsim
