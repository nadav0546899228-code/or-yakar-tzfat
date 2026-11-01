// בניית הצד הלקוח לתיקיית public (esbuild - מהיר, ללא תלויות כבדות).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'public');
let esbuild;
try { esbuild = await import('esbuild'); } catch {
  try { esbuild = await import(process.env.ESBUILD_PATH); } catch {
    // בפרסום ייתכן שכלי הבנייה לא מותקנים - תיקיית public כבר בנויה מראש ונשמרת בגיט
    if (fs.existsSync(path.join(out, 'assets', 'main.js'))) {
      console.log('esbuild לא זמין - משתמשים בגרסה הבנויה מראש שבתיקיית public');
      process.exit(0);
    }
    throw new Error('esbuild לא מותקן ואין גרסה בנויה בתיקיית public');
  }
}
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });
const v = Date.now().toString(36);
const tmp = path.join(root, '.build-tmp');
fs.rmSync(tmp, { recursive: true, force: true });

try {
await esbuild.build({
  entryPoints: [path.join(root, 'client', 'main.jsx')],
  bundle: true,
  minify: true,
  // פיצול קוד: האתר הציבורי טוען רק את מה שהוא צריך, והמערכת (CRM) נטענת רק כשנכנסים אליה
  format: 'esm',
  splitting: true,
  chunkNames: 'chunk-[hash]',
  entryNames: 'main',
  legalComments: 'none',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"', __BUILD_ID__: JSON.stringify(v) },
  outdir: tmp,
  nodePaths: process.env.EXTRA_NODE_PATH ? process.env.EXTRA_NODE_PATH.split(':').filter(Boolean) : [],
  logLevel: 'info',
});
} catch (e) {
  // אם הבנייה נכשלת (למשל בשרת הפרסום) - משתמשים בגרסה הבנויה מראש שנשמרת בגיט
  if (fs.existsSync(path.join(out, 'assets', 'main.js')) && !process.env.STRICT_BUILD) {
    console.warn('הבנייה נכשלה - משתמשים בגרסה הבנויה מראש שבתיקיית public:', e.message.split('\n')[0]);
    process.exit(0);
  }
  throw e;
}

// הבנייה הצליחה: מחליפים את הקבצים הישנים בחדשים (קטעי קוד עם גיבוב בשם מצטברים אחרת בכל בנייה)
for (const f of fs.readdirSync(path.join(out, 'assets'))) {
  if (/^(chunk-|main\.|app\.)/.test(f)) fs.rmSync(path.join(out, 'assets', f));
}
for (const f of fs.readdirSync(tmp)) fs.renameSync(path.join(tmp, f), path.join(out, 'assets', f));
fs.rmSync(tmp, { recursive: true, force: true });
// דחיסה מראש (Brotli + Gzip) - השרת מגיש את הגרסה הדחוסה לפי מה שהדפדפן תומך
const zlib = await import('node:zlib');
for (const f of fs.readdirSync(path.join(out, 'assets'))) {
  if (!/\.(js|css)$/.test(f)) continue;
  const full = path.join(out, 'assets', f);
  const buf = fs.readFileSync(full);
  fs.writeFileSync(`${full}.br`, zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }));
  fs.writeFileSync(`${full}.gz`, zlib.gzipSync(buf, { level: 9 }));
}
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync(path.join(root, 'client', 'index.html'), 'utf8').replaceAll('__V__', v));
const manifest = (dev) => JSON.stringify({
  id: dev ? '/app?env=dev' : '/app', name: dev ? 'אור יקר - אתר פיתוח' : 'מוסדות אור יקר צפת', short_name: dev ? 'אור יקר פיתוח' : 'אור יקר', description: 'מערכת ניהול תורמים וגיוס משאבים',
  start_url: '/app', scope: '/', display: 'standalone', orientation: 'portrait', dir: 'rtl', lang: 'he',
  background_color: '#ffffff', theme_color: '#16357a',
  icons: [
    { src: `/icon-192.png?v=${v}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `/icon-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `/icon-maskable-512.png?v=${v}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2);
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), manifest(false));
fs.writeFileSync(path.join(out, 'manifest-dev.webmanifest'), manifest(true));
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ build_id: v, built_at: new Date().toISOString() }));
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /app\nDisallow: /login\nDisallow: /api\n');
console.log('build ok');
