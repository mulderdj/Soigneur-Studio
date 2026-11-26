import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');

// Emits manifest.webmanifest, PWA icons, and /sw.js with the real built asset
// manifest and content hash — no inline importmap and no heavy PWA runtime.
function soigneurPwaPlugin() {
    return {
        name: 'soigneur-pwa',
        apply: 'build',
        generateBundle(_options, bundle) {
            // 1. Emit PWA icons referenced by manifest.webmanifest
            const logoDir = path.join(SRC, 'images', 'logo');
            const manifestSrc = fs.readFileSync(path.join(SRC, 'manifest.webmanifest'), 'utf8');
            const manifestJson = JSON.parse(manifestSrc);
            const iconFiles = [];
            for(const icon of manifestJson.icons ?? []) {
                const rel = icon.src.replace(/^(\.\/|\/)/, '');
                const abs = path.join(SRC, rel);
                if(!fs.existsSync(abs)) continue;
                const source = fs.readFileSync(abs);
                this.emitFile({type: 'asset', fileName: rel, source});
                iconFiles.push(`/${rel}`);
            }
            this.emitFile({type: 'asset', fileName: 'manifest.webmanifest', source: manifestSrc});

            // 2. Collect every real emitted file for the SW precache manifest & version hash
            const hash = crypto.createHash('sha256');
            const files = new Set(['/', '/manifest.webmanifest', ...iconFiles]);
            for(const [fileName, item] of Object.entries(bundle)) {
                if(fileName.endsWith('.map')) continue;
                if(item.type === 'chunk' && !item.code.trim()) continue;
                files.add(`/${fileName}`);
                hash.update(fileName);
                hash.update(item.type === 'chunk' ? item.code : item.source);
            }
            hash.update(manifestSrc);
            const version = hash.digest('hex').slice(0, 12);

            // 3. Emit /sw.js at root scope with injected manifest and version
            const swSrc = fs.readFileSync(path.join(SRC, 'sw.js'), 'utf8')
                .replace('__SOIGNEUR_MANIFEST__', JSON.stringify([...files].sort()))
                .replace('__SOIGNEUR_VERSION__', JSON.stringify(version));
            this.emitFile({type: 'asset', fileName: 'sw.js', source: swSrc});
        },
    };
}

function httpsConfig() {
    if(process.env.VITE_HTTPS !== '1') return undefined;
    return {
        cert: fs.readFileSync(path.join(ROOT, 'dev_cert', 'cert.pem')),
        key: fs.readFileSync(path.join(ROOT, 'dev_cert', 'key.pem')),
    };
}

export default defineConfig({
    root: SRC,
    base: '/',
    plugins: [soigneurPwaPlugin()],
    worker: {
        format: 'es',
    },
    server: {
        port: 1234,
        strictPort: true,
        https: httpsConfig(),
        proxy: {
            '/api': 'http://localhost:3000',
        },
    },
    build: {
        outDir: path.join(ROOT, 'dist'),
        emptyOutDir: true,
        target: 'es2022',
        rollupOptions: {
            input: {
                main: path.join(SRC, 'index.html'),
                privacy: path.join(SRC, 'privacy.html'),
            },
        },
    },
});
