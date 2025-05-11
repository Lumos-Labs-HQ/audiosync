import { app, BrowserWindow } from 'electron';
import os from 'os';

// Get local IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.family === 'IPv4') {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function createWindow() {
  const localIP = getLocalIpAddress();
  console.log(`Local network IP: ${localIP}`);

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      autoplayPolicy: 'no-user-gesture-required',
      webgl: true,
      allowRunningInsecureContent: true,
    }
  });

  win.setTitle(`Audio Sync - Connect using ${localIP}:3001`);
  win.loadURL('http://localhost:5173');

  // Inject local IP after DOM is ready
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`window.localIP = "${localIP}"`);
  });

  win.webContents.openDevTools();

  // Optional: Set Chromium flags for autoplay
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
