const { app, BrowserWindow, Menu, Tray, globalShortcut } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

let mainWindow;
let tray;
let isAlwaysOnTop = false;

function createWindow() {
  const windowOptions = {
    width: 400,
    height: 650,
    resizable: true,
    minWidth: 400,
    minHeight: 500,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  };
  
  // add the icon if it exists
  try {
    const iconPath = path.join(__dirname, 'assets/icon.png');
    if (require('fs').existsSync(iconPath)) {
      windowOptions.icon = iconPath;
    }
  } catch (error) {
    console.error('Failed to check icon path:', error);
  }
  
  mainWindow = new BrowserWindow(windowOptions);

  // Try connecting to the server
  const serverUrl = 'http://localhost:8000';
  
  // First check if the server is available using fetch
  require('electron').net.fetch(serverUrl, { method: 'HEAD' })
    .then(() => {
      // Server is up, load the URL
      mainWindow.loadURL(serverUrl);
    })
    .catch(error => {
      console.error('Failed to connect to server:', error);
      
      // Show error page if server connection fails
      mainWindow.loadFile(path.join(__dirname, 'error.html'));
    });

  // DevTools toggled with keyboard shortcuts

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
  
  // Register global shortcuts
  // Ctrl+Shift+D to toggle DevTools
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools();
      }
    }
  });
  
  // Ctrl+Shift+T to toggle 'always on top' and 'visible on all workspaces'
  globalShortcut.register('CommandOrControl+Shift+T', () => {
    if (mainWindow) {
      isAlwaysOnTop = !isAlwaysOnTop;
      mainWindow.setAlwaysOnTop(isAlwaysOnTop);
      mainWindow.setVisibleOnAllWorkspaces(isAlwaysOnTop);
    }
  });
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Unregister shortcuts when app is about to quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
