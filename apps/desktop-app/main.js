const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')

// Get local IP address
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal and non-IPv4 addresses
      if (iface.internal || iface.family !== 'IPv4') {
        continue;
      }
      return iface.address;
    }
  }
  return '127.0.0.1'; // Fallback to localhost
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
      // Enable hardware acceleration
      webgl: true,
      webSecurity: false, // Be careful with this in production!
    }
  })

  // Set window title with IP to make connection easier
  win.setTitle(`Audio Sync - Connect using ${localIP}:3001`)
  
  // Optimize for audio performance
  if (process.platform === 'win32') {
    // On Windows, we need to explicitly set process priority
    try {
      const { spawn } = require('child_process');
      spawn('wmic', ['process', 'where', `name='electron.exe' and ProcessId=${process.pid}`, 'CALL', 'setpriority', 'high']);
    } catch (e) {
      console.error('Failed to set process priority:', e);
    }
  }

  win.loadURL(`http://localhost:5173`)
  win.webContents.executeJavaScript(`console.log('Your local IP: ${localIP}'); window.localIP = '${localIP}'`)
  
  // Open DevTools for debugging
  win.webContents.openDevTools()
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
