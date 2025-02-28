const { app, BrowserWindow, Menu, Tray } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

let mainWindow;
let tray;

function createWindow() {
  // Create window options
  const windowOptions = {
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };
  
  // Try to add the icon if it exists
  try {
    const iconPath = path.join(__dirname, 'assets/icon.png');
    if (require('fs').existsSync(iconPath)) {
      windowOptions.icon = iconPath;
    }
  } catch (error) {
    console.error('Failed to check icon path:', error);
  }
  
  mainWindow = new BrowserWindow(windowOptions);

  // Try to load the FastAPI server's URL
  mainWindow.loadURL('http://localhost:8000').catch(error => {
    console.error('Failed to connect to server:', error);
    
    // Show error page if server connection fails
    mainWindow.loadFile(path.join(__dirname, 'error.html'));
  });

  // Open DevTools in dev mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Voice Agent', click: () => { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } }
  ]);
  
  try {
    // On macOS, create a simple text-based tray icon as a fallback if no icon is found
    if (process.platform === 'darwin') {
      tray = new Tray(path.join(__dirname, 'assets/icon.png'));
    } else {
      // On Windows/Linux, use a temporary icon or fallback mechanism
      const fs = require('fs');
      const iconPath = path.join(__dirname, 'assets/icon.png');
      
      if (fs.existsSync(iconPath)) {
        tray = new Tray(iconPath);
      } else {
        // Skip tray creation if icon not found on non-macOS platforms
        console.log('Icon not found, skipping tray creation');
        return;
      }
    }
    
    tray.setToolTip('Voice Agent');
    tray.setContextMenu(contextMenu);
    
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    // Continue without tray icon
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});