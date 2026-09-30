/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import { installProblems } from './tools/fetch_kws.mjs';
import { noDotfiles } from './tools/vite-no-dotfiles.mjs';

// The voice spotter's install (tools/fetch_kws.mjs) is two renames; a crash between them is detected
// here, not shipped: a public/kws that lost its committed files, a leftover staging directory, or
// public/kws and tools/.kws from different installs stop the build. A clone that never fetched builds
// fine (voice shows "not installed").
const kwsGuard = () => ({
    name: 'tapstone-kws-guard',
    apply: 'build',
    buildStart() {
        const bad = installProblems();
        if (bad.length) throw new Error(`the voice spotter's install is broken:\n  ${bad.join('\n  ')}\nrun: node tools/fetch_kws.mjs`);
    },
});
export default defineConfig({
    // noDotfiles: public/'s dotfiles (public/kws/.gitignore, .install) are build metadata; they don't ship.
    plugins: [iwsdkDev(), kwsGuard(), noDotfiles()],
    // XR_PORT lets a second dev server (another lane's IWER run) coexist with one on 8081.
    server: { host: '0.0.0.0', port: Number(process.env.XR_PORT) || 8081, open: false },
    build: {
        outDir: 'dist',
        sourcemap: process.env.NODE_ENV !== 'production',
        target: 'esnext',
        rollupOptions: {
            input: './index.html',
            // A missing export is only a warning to Rollup, and the build exits 0 (a planted bad
            // import proved it). Make it fatal, so a wrong IWSDK name fails the build.
            onwarn(w, warn) {
                if (w.code === 'MISSING_EXPORT') throw new Error(w.message);
                warn(w);
            },
        },
    },
    esbuild: { target: 'esnext' },
    // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
    // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
    // instanceof checks → "Only pmndrs/uikit components can be added as children".
    resolve: {
        dedupe: [
            'three',
            '@pmndrs/uikit',
            '@pmndrs/uikit-horizon',
            '@pmndrs/uikit-lucide',
        ],
    },
    optimizeDeps: {
        exclude: ['@babylonjs/havok'],
        include: [
            'three',
            '@pmndrs/uikit',
            '@pmndrs/uikit-horizon',
            '@pmndrs/uikit-lucide',
            '@drawcall/uikitml',
        ],
        esbuildOptions: { target: 'esnext' },
    },
    publicDir: 'public',
    base: './',
});
