const u16=(b:Uint8Array,o:number)=>b[o]|(b[o+1]<<8);
const u32=(b:Uint8Array,o:number)=>(b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0;
function bytesToString(b:Uint8Array){return new TextDecoder("utf-8").decode(b);}
async function inflateRaw(data:Uint8Array){
  const DS=(globalThis as any).DecompressionStream;
  if(!DS) throw new Error("当前浏览器不支持 Word 文件解压，请使用最新版 Chrome / Edge。");
  const stream=new Blob([data as any]).stream().pipeThrough(new DS("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function readZipEntry(buf:ArrayBuffer,name:string){
  const b=new Uint8Array(buf); let e=-1;
  for(let i=b.length-22;i>=Math.max(0,b.length-65558);i--){if(u32(b,i)===0x06054b50){e=i;break;}}
  if(e<0) throw new Error("这不是有效的 Word .docx 文件。");
  const cdSize=u32(b,e+12), cdOffset=u32(b,e+16); let p=cdOffset;
  while(p<cdOffset+cdSize){
    if(u32(b,p)!==0x02014b50) break;
    const method=u16(b,p+10), csize=u32(b,p+20), nlen=u16(b,p+28), xlen=u16(b,p+30), clen=u16(b,p+32), local=u32(b,p+42);
    const n=bytesToString(b.slice(p+46,p+46+nlen));
    if(n===name){
      if(u32(b,local)!==0x04034b50) throw new Error("Word 文件结构异常。");
      const ln=u16(b,local+26), lx=u16(b,local+28); const start=local+30+ln+lx; const packed=b.slice(start,start+csize);
      if(method===0) return packed;
      if(method===8) return await inflateRaw(packed);
      throw new Error("Word 文件使用了暂不支持的压缩方式。");
    }
    p+=46+nlen+xlen+clen;
  }
  throw new Error("Word 文件中没有找到 word/document.xml。");
}
export async function docxToText(file:File):Promise<string>{
  const buf=await file.arrayBuffer(); const xmlBytes=await readZipEntry(buf,"word/document.xml");
  const xml=bytesToString(xmlBytes); const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.querySelector("parsererror")) throw new Error("Word 文档内容无法读取。");
  const paragraphs=[...doc.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","p")];
  const text = paragraphs.map(p => [...p.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main","t")].map(n => n.textContent || "").join("")).join("\n");
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
}
