const path = require('path');
const { execFileSync } = require('child_process');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  hooks: {
    // Runs before `start` and `package`: compiles the Vue renderer into dist/renderer.
    generateAssets: async () => {
      const { build } = await import('vite');
      await build({ configFile: path.join(__dirname, 'vite.renderer.config.mjs') });
    },
    // There is no Developer ID certificate, so the finished bundle is ad-hoc signed. Flipping
    // fuses re-signs only the binary, leaving Info.plist outside the signature, and macOS
    // refuses Documents access to an app whose signature doesn't verify.
    postPackage: async (_config, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const dir of outputPaths) {
        const app = path.join(dir, 'RetroShelf.app');
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', app]);
        execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
      }
    },
  },
  packagerConfig: {
    asar: true,
    name: 'RetroShelf',
    appBundleId: 'com.velkymx.retroshelf',
    appCategoryType: 'public.app-category.games',
    // Packager adds the platform's extension (.icns on macOS, .ico on Windows).
    icon: 'build/icon',
    // Only the app code ships; tests, icon sources and the renderer sources (built into
    // dist/renderer) stay out of the bundle.
    ignore: [/^\/test(\/|$)/, /^\/build(\/|$)/, /^\/build\.mjs$/, /^\/forge\.config\.js$/, /^\/vite\.renderer\.config\.mjs$/, /^\/src\/renderer(\/|$)/],
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
