const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
if (!process.versions.electron) {
  const req = require('node:module').createRequire(path.resolve(__dirname, '../../../package.json'))
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pltr-concepts-'))
  const env = { ...process.env, APPDATA: directory, LOCALAPPDATA: directory, PLTR_PREVIEW_DATA: directory }
  delete env.ELECTRON_RUN_AS_NODE
  const child = require('node:child_process').spawn(req('electron'), [__filename], { env, windowsHide: true, stdio: 'inherit' })
  child.on('exit', code => process.exit(code || 0))
} else {
  const { app, BrowserWindow } = require('electron')
  app.disableHardwareAcceleration()
  app.setPath('userData', path.join(process.env.PLTR_PREVIEW_DATA, 'userData'))
  app.whenReady().then(async () => {
    const win = new BrowserWindow({ width:1600, height:1080, frame:false, useContentSize:true, show:false, webPreferences:{offscreen:true,backgroundThrottling:false} })
    try {
      await win.loadFile(path.join(__dirname,'preview.html'))
      win.webContents.debugger.attach('1.3')
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width:1600, height:1080, deviceScaleFactor:1, mobile:false })
      console.log('Viewport', await win.webContents.executeJavaScript('[innerWidth,innerHeight]'))
      for(const [id,filename] of [['terminal','01-terminal.png'],['ledger','02-ledger.png'],['atlas','03-atlas.png']]) {
        const bounds = await win.webContents.executeJavaScript(`
          document.querySelectorAll('.screen').forEach(el=>el.hidden=el.id!==${JSON.stringify(id)});
          window.renderAll();
          [...document.querySelectorAll('#${id} main, #${id} footer')].map(el=>({element:el.className,bottom:el.getBoundingClientRect().bottom}));
        `)
        await new Promise(resolve=>setTimeout(resolve,180))
        const target = path.join(__dirname,filename)
        const capture = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:1600,height:1080,scale:1} })
        fs.writeFileSync(target,Buffer.from(capture.data,'base64'))
        console.log(filename,JSON.stringify(bounds))
      }
      app.exit(0)
    } catch(error) { console.error(error); app.exit(1) }
  })
}
