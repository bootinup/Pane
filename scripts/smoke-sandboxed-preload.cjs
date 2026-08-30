const path = require('path');
process.env.NODE_ENV = 'production';
const { app, BrowserWindow } = require('electron');

const preloadPath = path.resolve(__dirname, '..', 'main', 'dist', 'main', 'src', 'preload.js');
const defaultAppearance = {
  appearanceMode: 'system',
  theme: 'light-rounded',
  systemLightTheme: 'light-rounded',
  systemDarkTheme: 'dark',
};
const encodedAppearance = Buffer.from(JSON.stringify(defaultAppearance), 'utf8').toString('base64url');
const timeout = setTimeout(() => {
  console.error('Sandboxed preload smoke test timed out');
  app.exit(1);
}, 15_000);

async function run() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--pane-appearance=${encodedAppearance}`],
    },
  });
  let preloadFailure = null;
  window.webContents.on('preload-error', (_event, _preload, error) => {
    preloadFailure = error;
  });

  await window.loadURL('data:text/html,<html><body>preload-smoke</body></html>');
  const apiAvailable = await window.webContents.executeJavaScript(
    'typeof window.electronAPI === "object" && typeof window.electronAPI.getAppVersion === "function"',
  );
  const appearanceSnapshotAvailable = await window.webContents.executeJavaScript(
    'typeof window.electronAPI.appearanceSnapshot === "object"',
  );

  if (preloadFailure) {
    throw preloadFailure;
  }
  if (!apiAvailable) {
    throw new Error('Sandboxed preload did not expose window.electronAPI');
  }
  if (!appearanceSnapshotAvailable) {
    throw new Error('Sandboxed preload did not decode the appearance snapshot');
  }

  console.log('Sandboxed preload smoke test passed');
  window.destroy();
}

app.whenReady()
  .then(run)
  .then(() => {
    clearTimeout(timeout);
    app.quit();
  })
  .catch((error) => {
    clearTimeout(timeout);
    console.error(error);
    app.exit(1);
  });
