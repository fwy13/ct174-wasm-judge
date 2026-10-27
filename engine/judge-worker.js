/* Based on binji/wasm-clang shared.js (Apache-2.0). Local worker, no server compilation. */
importScripts('./shared.js');
let api=null;
const files=['clang','lld','memfs','sysroot.tar'];
function report(kind,more={}){postMessage({kind,...more});}
const options={
 async readBuffer(name){const res=await fetch('./'+name);if(!res.ok)throw new Error('Không tải được '+name+' (HTTP '+res.status+'). Chạy scripts/fetch-engine.sh.');return res.arrayBuffer();},
 async compileStreaming(name){return WebAssembly.compile(await options.readBuffer(name));},
 hostWrite(s){if(api)api._capture+=s;}
};
function cleanLog(s){return s.replace(/\x1b\[[0-9;]*m/g,'');}
self.onmessage=async e=>{
 if(e.data?.kind!=='start')return;
 try{
  api=new API(options);api._capture='';
  await api.ready;
  // The provided project uses clang -cc1 and WASI. Keep one compiler and linker per submission.
  // Compile in actual C mode, rather than the upstream C++ demo default.
  const input='submission.c',obj='submission.o',wasm='submission.wasm';
  api.memfs.addFile(input,e.data.code);
  const clang=await api.getModule(api.clangFilename);
  await api.run(clang,'clang','-cc1','-emit-obj',...api.clangCommonArgs,'-triple=wasm32-wasi','-O2','-o',obj,'-x','c',input);
  // Error diagnostics are emitted through the memfs hostWrite callback.
  const compLog=cleanLog(api._capture);
  let objectPresent=true;try{api.memfs.getFileContents(obj);}catch(_){objectPresent=false;}
  if(!objectPresent||/\berror:/i.test(compLog)){report('compiled',{ok:false,logs:compLog});return;}
  await api.link(obj,wasm);
  const linkerLog=cleanLog(api._capture);
  let wasmBytes;try{wasmBytes=api.memfs.getFileContents(wasm).slice();}catch(_){report('compiled',{ok:false,logs:linkerLog});return;}
  const program=await WebAssembly.compile(wasmBytes);
  report('compiled',{ok:true,logs:linkerLog});
  for(let i=0;i<e.data.tests.length;i++){
   api.memfs.setStdinStr(e.data.tests[i]);api._capture='';
   const start=performance.now();let detail;
   try {await api.run(program,wasm);}catch(err){detail=String(err?.message||err);}
   const elapsedMs=Math.round(performance.now()-start);
   // api.run adds a command banner and timing logs; stdout starts after that banner.
   let raw=cleanLog(api._capture);
   const commandLine=wasm+'\n';const marker=raw.indexOf(commandLine);
   if(marker>=0)raw=raw.slice(marker+commandLine.length);
   raw=raw.replace(/\n$/, ''); // strip api.run separator newline
   report('case',{index:i,stdout:raw,elapsedMs,detail});
   if(detail)return;
  }
  report('done');
 }catch(err){report('error',{detail:String(err?.stack||err)});}
};
