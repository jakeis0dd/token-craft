import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import OBR, { buildImageUpload, buildImage } from "@owlbear-rodeo/sdk";
import { startResponsiveActionHeight } from "./responsiveHeight";
import { startThemeSync } from "./theme";
import "./style.css";

type Shape = "circle" | "square";
const SIZE = 512;
const PREVIEW = 320;

function render(ctx: CanvasRenderingContext2D, image: HTMLImageElement, shape: Shape, color: string, border: number, zoom: number, offset: {x:number;y:number}, size: number) {
  ctx.clearRect(0, 0, size, size);
  const ratio = size / SIZE;
  const inset = border / 2 * ratio;
  const radius = (SIZE - border) / 2 * ratio;
  ctx.save();
  ctx.beginPath();
  if (shape === "circle") ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
  else ctx.rect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.clip();
  const scale = Math.max(SIZE / image.naturalWidth, SIZE / image.naturalHeight) * zoom * ratio;
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, (size-w)/2 + offset.x*ratio, (size-h)/2 + offset.y*ratio, w, h);
  ctx.restore();
  if (border > 0) {
    ctx.beginPath();
    if (shape === "circle") ctx.arc(size/2,size/2,radius,0,Math.PI*2);
    else ctx.rect(inset,inset,size-inset*2,size-inset*2);
    ctx.strokeStyle=color;
    ctx.lineWidth=border*ratio;
    ctx.stroke();
  }
}

function App() {
  useEffect(() => startThemeSync(), []);
  const [ready,setReady] = useState(false);
  const [image,setImage] = useState<HTMLImageElement|null>(null);
  const [name,setName] = useState("My Token");
  const [shape,setShape] = useState<Shape>("circle");
  const [color,setColor] = useState("#f5c84b");
  const [border,setBorder] = useState(12);
  const [noBorder,setNoBorder] = useState(false);
  const effectiveBorder = noBorder ? 0 : border;
  const [gridSize,setGridSize] = useState(1);
  const [zoom,setZoom] = useState(1);
  const [offset,setOffset] = useState({x:0,y:0});
  const [busy,setBusy] = useState(false);
  const [savedSignature,setSavedSignature] = useState<string|null>(null);
  const signature = JSON.stringify({name,shape,color,border,noBorder,gridSize,zoom,offset,image: image?.src});
  const savedCurrent = savedSignature === signature;
  const [message,setMessage] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
  const input = useRef<HTMLInputElement>(null);
  const zoomRef = useRef<(delta:number)=>void>(()=>{});
  zoomRef.current = delta => setZoom(z=>Math.min(4,Math.max(1,z*(delta<0?1.08:0.92))));
  useEffect(() => {
    const el=canvas.current;
    if(!el)return;
    const onWheel=(event:WheelEvent)=>{event.preventDefault(); if(image)zoomRef.current(event.deltaY);};
    el.addEventListener("wheel",onWheel,{passive:false});
    return ()=>el.removeEventListener("wheel",onWheel);
  },[image]);

  useEffect(() => {
    if (!OBR.isAvailable) return;
    return OBR.onReady(() => setReady(true));
  }, []);
  useEffect(() => {
    if (!ready) return;
    return startResponsiveActionHeight();
  }, [ready]);
  useEffect(() => {
    const ctx=canvas.current?.getContext("2d");
    if(ctx && image) render(ctx,image,shape,color,effectiveBorder,zoom,offset,PREVIEW);
    else ctx?.clearRect(0,0,PREVIEW,PREVIEW);
  },[image,shape,color,effectiveBorder,zoom,offset]);

  async function loadUrl(url:string, label:string) {
    const img=new Image();
    img.crossOrigin="anonymous";
    img.src=url;
    await img.decode();
    // Test whether the browser permits reading pixels before enabling export.
    const test=document.createElement("canvas"); test.width=test.height=1;
    const context=test.getContext("2d")!;
    context.drawImage(img,0,0,1,1); context.getImageData(0,0,1,1);
    setImage(img); setName(label.replace(/\.[^.]+$/,"") || "My Token");
    setZoom(1); setOffset({x:0,y:0}); setMessage("");
  }
  async function loadFile(file:File) {
    if(!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    const url=URL.createObjectURL(file);
    try { await loadUrl(url,file.name); } finally { URL.revokeObjectURL(url); }
  }
  async function pickExisting() {
    if(!ready) return setMessage("Open this extension inside Owlbear Rodeo to select existing images.");
    try {
      const picked=await OBR.assets.downloadImages(false,"","CHARACTER");
      if(picked.length) await loadUrl(picked[0].image.url,picked[0].name);
    } catch(e) { setMessage("Cannot read that image (possibly a CORS restriction): "+String(e)); }
  }
  async function makeFile() {
    if(!image) throw new Error("Choose an image first.");
    const output=document.createElement("canvas"); output.width=output.height=SIZE;
    render(output.getContext("2d")!,image,shape,color,effectiveBorder,zoom,offset,SIZE);
    const blob=await new Promise<Blob>((resolve,reject)=>output.toBlob(b=>b?resolve(b):reject(new Error("PNG export failed.")),"image/png"));
    return new File([blob],`${name.trim() || "Token"}.png`,{type:"image/png"});
  }
  async function saveLibrary() {
    if(!ready) return setMessage("Saving to Owlbear Rodeo requires opening the extension inside a room.");
    setBusy(true); setMessage("");
    try {
      const file=await makeFile();
      // Use the image center as the snapping/rotation origin, in image pixels.
      await OBR.assets.uploadImages([buildImageUpload(file).name(name).dpi(SIZE/gridSize).offset({x:SIZE/2,y:SIZE/2}).build()],"CHARACTER");
      setSavedSignature(signature);
      setMessage("Upload completed. Find your token in Characters. Add to Scene is now available; you will select the saved token in Owlbear’s picker.");
    } catch(e) { setMessage("Library save failed: "+String(e)); }
    finally {setBusy(false);}
  }
  async function addScene() {
    if(!ready || !savedCurrent) return setMessage("Save this version to your Characters library first.");
    setBusy(true); setMessage("");
    try {
      if(!await OBR.scene.isReady()) throw new Error("Open a scene first.");
      // The SDK does not return an asset URL from uploadImages. Ask the user to
      // choose the saved image instead of inventing a temporary scene URL.
      const picked=await OBR.assets.downloadImages(false,name,"CHARACTER");
      if(!picked.length) {
        setMessage("No image selected. Your saved token remains in Characters.");
        return;
      }
      const selected=picked[0];
      const [width,height,gridType]=await Promise.all([
        OBR.viewport.getWidth(),OBR.viewport.getHeight(),OBR.scene.grid.getType()
      ]);
      const center=await OBR.viewport.inverseTransformPoint({x:width/2,y:height/2});
      // On square grids, odd footprints center in a cell; even ones at a corner.
      const even=gridSize%2===0;
      const position=await OBR.scene.grid.snapPosition(
        center,1,gridType==="SQUARE"?even:true,gridType==="SQUARE"?!even:true
      );
      const item=buildImage(
        {width:selected.image.width,height:selected.image.height,mime:selected.image.mime,url:selected.image.url},
        {dpi:SIZE/gridSize,offset:{x:selected.image.width/2,y:selected.image.height/2}}
      ).name(selected.name).layer("CHARACTER").position(position).build();
      await OBR.scene.items.addItems([item]);
      setMessage(`Added selected image to the scene at ${gridSize}×${gridSize} grid squares.`);
    } catch(e) {setMessage("Scene placement failed: "+String(e)+" You can still drag your saved token from Characters.");}
    finally {setBusy(false);}
  }
  async function download() {
    try {const file=await makeFile();const url=URL.createObjectURL(file);const a=document.createElement("a");a.href=url;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch(e) {setMessage(String(e));}
  }
  return <main>
    <header><div className="logo"><img src={`${import.meta.env.BASE_URL}logo.png`} alt="Token Craft logo"/></div><div><h1>Token Craft</h1><small>Simple tokens for Owlbear Rodeo</small></div></header>
    <div className="sources"><button onClick={()=>input.current?.click()}>＋ Import new image</button><button onClick={pickExisting} disabled={!ready}>▧ Existing image</button></div>
    <input ref={input} hidden type="file" accept="image/*" onChange={async e=>{const f=e.target.files?.[0];if(f)try{await loadFile(f);}catch(err){setMessage(String(err));}e.target.value="";}}/>
    <section className="preview"><canvas ref={canvas} width={PREVIEW} height={PREVIEW} style={{touchAction:"none",cursor:image?"grab":"default"}} onPointerDown={e=>{if(!image)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y};}} onPointerMove={e=>{if(!drag.current)return;const r=e.currentTarget.getBoundingClientRect();setOffset({x:drag.current.ox+(e.clientX-drag.current.x)*SIZE/r.width,y:drag.current.oy+(e.clientY-drag.current.y)*SIZE/r.height});}} onPointerUp={()=>drag.current=null} onPointerCancel={()=>drag.current=null} />
      {!image&&<div className="empty">Import an image to start</div>}
      <p>Drag to position · Scroll to zoom</p>
    </section>
    <label>Token name<input value={name} onChange={e=>setName(e.target.value)} maxLength={80}/></label>
    <div className="line"><span>Crop shape</span><div className="switch"><button className={shape==="circle"?"active":""} onClick={()=>setShape("circle")}>◯ Circle</button><button className={shape==="square"?"active":""} onClick={()=>setShape("square")}>□ Square</button></div></div>
    <div className="line"><span>Token size</span><div className="switch">{[1,2,3,4].map(n=><button key={n} className={gridSize===n?"active":""} onClick={()=>setGridSize(n)}>{n}×{n}</button>)}</div></div>
    <div className="line"><span>Border color</span><div className="colors">{["#e45c5c","#48b878","#4c95ef","#f5c84b"].map(c=><button key={c} aria-label={c} aria-pressed={!noBorder&&color===c} className={!noBorder&&color===c?"chosen":""} style={{background:c}} onClick={()=>{setColor(c);setNoBorder(false);}}/>)}<button type="button" aria-label="No Border" title="No Border" aria-pressed={noBorder} className={`no-border${noBorder?" chosen":""}`} onClick={()=>setNoBorder(true)}/><input aria-label="Custom border color" type="color" value={color} onChange={e=>{setColor(e.target.value);setNoBorder(false);}}/></div></div>
    <label className="range">Border thickness <strong>{border}px</strong><input type="range" min="0" max="48" value={border} onChange={e=>setBorder(Number(e.target.value))}/></label>
    <label className="range">Zoom <strong>{zoom.toFixed(2)}×</strong><input type="range" min="1" max="4" step=".01" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
    <div className="actions"><button disabled={!image||busy||!ready} onClick={saveLibrary}>Save to Library</button><button className="primary" disabled={!image||busy||!ready||!savedCurrent} onClick={addScene}>Add to Scene</button></div>
    {image&&!savedCurrent&&<p className="message">Save to Library before adding this token to the scene.</p>}
    <button className="download" disabled={!image||busy} onClick={download}>Download PNG</button>
    {message&&<p role="status" className="message">{message}</p>}
    {!ready&&<p className="message">Standalone preview: PNG export works; Owlbear actions require installing the extension.</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<App/>);
