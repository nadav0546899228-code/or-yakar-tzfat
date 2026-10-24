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
    if (fs.existsSync(path.join(out, 'assets', 'app.js'))) {
      console.log('esbuild לא זמין - משתמשים בגרסה הבנויה מראש שבתיקיית public');
      process.exit(0);
    }
    throw new Error('esbuild לא מותקן ואין גרסה בנויה בתיקיית public');
  }
}
fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

try {
await esbuild.build({
  entryPoints: [path.join(root, 'client', 'main.jsx')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  outfile: path.join(out, 'assets', 'app.js'),
  nodePaths: process.env.EXTRA_NODE_PATH ? [process.env.EXTRA_NODE_PATH] : [],
  logLevel: 'info',
});
} catch (e) {
  // אם הבנייה נכשלת (למשל בשרת הפרסום) - משתמשים בגרסה הבנויה מראש שנשמרת בגיט
  if (fs.existsSync(path.join(out, 'assets', 'app.js')) && !process.env.STRICT_BUILD) {
    console.warn('הבנייה נכשלה - משתמשים בגרסה הבנויה מראש שבתיקיית public:', e.message.split('\n')[0]);
    process.exit(0);
  }
  throw e;
}

const v = Date.now().toString(36);
fs.writeFileSync(path.join(out, 'index.html'), fs.readFileSync(path.join(root, 'client', 'index.html'), 'utf8').replaceAll('__V__', v));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  id: '/app', name: 'מוסדות אור יקר צפת', short_name: 'אור יקר', description: 'מערכת ניהול תורמים וגיוס משאבים',
  start_url: '/app', scope: '/', display: 'standalone', orientation: 'portrait', dir: 'rtl', lang: 'he',
  background_color: '#ffffff', theme_color: '#16357a',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
fs.writeFileSync(path.join(out, 'build.json'), JSON.stringify({ build_id: v, built_at: new Date().toISOString() }));
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /app\nDisallow: /login\nDisallow: /api\n');
console.log('build ok');
