const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("boatDesktop", {
  health: () => ipcRenderer.invoke("boat:health"),
  backup: {
    createLocal: () => ipcRenderer.invoke("boat:backup:create-local"),
  },
  license: {
    getDeviceId: () => ipcRenderer.invoke("boat:license:get-device-id"),
  },
  pos: {
    listProducts: () => ipcRenderer.invoke("boat:pos:list-products"),
    upsertProduct: (payload) => ipcRenderer.invoke("boat:pos:upsert-product", payload),
  },
  customers: {
    list: () => ipcRenderer.invoke("boat:customers:list"),
    create: (payload) => ipcRenderer.invoke("boat:customers:create", payload),
  },
  sessions: {
    getActive: (payload) => ipcRenderer.invoke("boat:session:get-active", payload),
    open: (payload) => ipcRenderer.invoke("boat:session:open", payload),
    close: (payload) => ipcRenderer.invoke("boat:session:close", payload),
  },
  retail: {
    createSale: (payload) => ipcRenderer.invoke("boat:retail:sale:create", payload),
  },
  retailCustomers: {
    list: () => ipcRenderer.invoke("boat:retail-customers:list"),
    create: (payload) => ipcRenderer.invoke("boat:retail-customers:create", payload),
    update: (payload) => ipcRenderer.invoke("boat:retail-customers:update", payload),
    remove: (payload) => ipcRenderer.invoke("boat:retail-customers:delete", payload),
  },
  syncQueue: {
    list: () => ipcRenderer.invoke("boat:sync-queue:list"),
    listPending: () => ipcRenderer.invoke("boat:sync-queue:list-pending"),
    setStatus: (payload) => ipcRenderer.invoke("boat:sync-queue:set-status", payload),
  },
  localStore: {
    select: (payload) => ipcRenderer.invoke("boat:local-store:select", payload),
    upsert: (payload) => ipcRenderer.invoke("boat:local-store:upsert", payload),
    update: (payload) => ipcRenderer.invoke("boat:local-store:update", payload),
    delete: (payload) => ipcRenderer.invoke("boat:local-store:delete", payload),
  },
});
