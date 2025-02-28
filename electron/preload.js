const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    // Add any necessary IPC communication methods here if needed
    // For now, we don't need any as we're using the existing web app directly
  }
);