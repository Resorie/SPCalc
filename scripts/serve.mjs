import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] || '.');
const port = Number(process.env.PORT || 4173);
const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.md':'text/plain', '.png':'image/png', '.webp':'image/webp' };
createServer(async (req,res) => {
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(root,`.${pathname.endsWith('/') ? pathname+'index.html' : pathname}`);
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    const content=await readFile(file);
    res.writeHead(200,{'Content-Type':(mime[extname(file)]||'application/octet-stream'),'Cache-Control':'no-cache'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
