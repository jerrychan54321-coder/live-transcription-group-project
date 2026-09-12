// Run with Node and Playwright available on NODE_PATH. No speech models required.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let mode = 'success';
const uploads = [], actions = [];
const assetRequests = [];
let stopped = false;
const segment = { type: 'segment', source: 'recording', original: '<script>lecture</script>', corrected: 'Recorded lecture', translated: 'Bài giảng', language: 'Vietnamese', start: 125, end: 132, completed: 1, total: 1 };
const server = http.createServer((req, res) => {
  if (req.url === '/api/recording_jobs') {
    stopped = false; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({job_id: 'test-job'})); return;
  }
  if (req.url === '/api/recording_jobs/test-job/stop') {
    stopped = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({status: 'stopping'})); return;
  }
  if (req.url === '/api/upload_media') {
    let body = '';
    req.on('data', b => body += b.toString());
    req.on('end', async () => {
      uploads.push(body);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const send = e => res.write(JSON.stringify(e) + '\n');
      send({ type: 'status', stage: 'Preparing audio' });
      await new Promise(r => setTimeout(r, 250));
      send({ type: 'status', stage: 'Transcribing' });
      await new Promise(r => setTimeout(r, 250));
      if (stopped) {send({type: 'stopped', completed: 0}); res.end(); return;}
      if (mode === 'failure') send({ type: 'error', message: 'Engine unavailable' });
      else {
        if (mode !== 'empty') { send(segment); await new Promise(r => setTimeout(r, 250)); }
        send({ type: 'complete', total: mode === 'empty' ? 0 : 1 });
      }
      res.end();
    });
    return;
  }
  if (req.url.startsWith('/api/')) {
    actions.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ is_recording: false })); return;
  }
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/legacy') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/static/style.css"><script src="/static/app.js"></script><p>Previous UI assets</p>');
    return;
  }
  if (pathname.startsWith('/static/')) {
    assetRequests.push(req.url);
    if (!req.url.includes('?v=')) {
      res.setHeader('Cache-Control', 'max-age=86400');
      res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
      res.end(pathname.endsWith('.js') ? 'window.staleUI = true;' : 'body { color: black; }');
      return;
    }
  }
  const file = pathname === '/' ? 'static/index.html' : pathname.slice(1);
  if (!['static/index.html', 'static/app.js', 'static/style.css'].includes(file)) {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(path.join(__dirname, '..', file)));
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.WebSocket = class {
        constructor() {
          window.testSocket = this;
          setTimeout(() => {this.onopen(); this.emit({ type: 'devices', devices: [{ index: 0, name: 'Test microphone' }], selected: 0 }); this.emit({ type: 'state', is_recording: true, language: 'Chinese' });}, 0);
        }
        emit(data) { this.onmessage({ data: JSON.stringify(data) }); }
      };
      window.confirm = () => true;
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/legacy`);
    assert.equal(await page.evaluate(() => window.staleUI), true);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.evaluate(() => window.staleUI), undefined);
    assert.ok(assetRequests.some(url => url.startsWith('/static/app.js?v=')));
    assert.ok(assetRequests.some(url => url.startsWith('/static/style.css?v=')));
    assert.equal(await page.locator('#liveTab').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(23, 107, 96)');
    assert.equal(await page.locator('#liveTimestamps').evaluate(el => getComputedStyle(el).appearance), 'none');
    await page.waitForFunction(() => document.getElementById('connectionStatus').textContent.includes('Connected'));
    await page.evaluate(() => window.testSocket.emit({ type: 'result', source: 'live', original: 'Live words', corrected: 'Live words', translated: '实时', language: 'Chinese', elapsed_s: 65 }));
    assert.equal(await page.locator('#liveEnglishText').textContent(), 'Live words');
    assert.equal(await page.locator('#historyList .timestamp').textContent(), '01:05');
    await page.locator('#liveTimestamps').uncheck();
    assert.equal(await page.locator('#historyList .timestamp').isVisible(), false);
    const liveDownload = page.waitForEvent('download');
    await page.locator('#exportBtn').click();
    const liveText = fs.readFileSync(await (await liveDownload).path(), 'utf8');
    assert.ok(liveText.includes('Live words') && !liveText.includes('[01:05]'));
    await page.locator('#recordingTab').click();
    assert.equal(await page.locator('#liveWorkspace').isVisible(), false);
    assert.equal(await page.locator('#listeningBanner').isVisible(), true);
    await page.locator('#recordingLanguage').selectOption('Vietnamese');
    await page.locator('#mediaFileInput').setInputFiles({ name: 'lecture.wav', mimeType: 'audio/wav', buffer: Buffer.from('test') });
    assert.equal(uploads.length, 0);
    await page.locator('#segmentLength').selectOption('120');
    await page.locator('#startRecordingBtn').click();
    await page.waitForFunction(() => document.getElementById('uploadProgressText').textContent.includes('Preparing'));
    assert.equal(await page.locator('#recordingProgress').isVisible(), true);
    assert.equal(await page.locator('#stopLiveBtn').isEnabled(), true);
    await page.waitForFunction(() => document.getElementById('uploadProgressText').textContent === 'Complete');
    assert.equal(await page.locator('#recordingResults .timestamp').textContent(), '02:05–02:12');
    assert.equal(await page.locator('#historyList .history-item').count(), 1);
    assert.equal(await page.locator('#liveEnglishText').textContent(), 'Live words');
    assert.ok(uploads[0].includes('Vietnamese'));
    assert.ok(uploads[0].includes('120')); 
    assert.ok(!actions.includes('/api/set_language'));
    assert.equal(await page.locator('#recordingResults script').count(), 0);
    await page.locator('#recordingTimestamps').uncheck();
    const recordingDownload = page.waitForEvent('download');
    await page.locator('#recordingExportBtn').click();
    const recordingText = fs.readFileSync(await (await recordingDownload).path(), 'utf8');
    assert.ok(recordingText.includes('Recorded lecture') && !recordingText.includes('02:05') && !recordingText.includes('Live words'));
    await page.locator('#recordingTimestamps').check();
    await page.screenshot({ path: 'tests/recording-desktop.png', fullPage: true });
    mode = 'failure';
    await page.locator('#mediaFileInput').setInputFiles({ name: 'failed.wav', mimeType: 'audio/wav', buffer: Buffer.from('test') });
    await page.locator('#startRecordingBtn').click();
    await page.locator('#retryRecordingBtn').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#uploadProgressText').textContent()).includes('Engine unavailable'));
    assert.equal(await page.locator('#recordingResults .recording-document').count(), 2);
    mode = 'success';
    await page.locator('#retryRecordingBtn').click();
    await page.waitForFunction(() => document.getElementById('uploadProgressText').textContent === 'Complete');
    assert.equal(await page.locator('#recordingResults .recording-document').count(), 2);
    mode = 'empty';
    await page.locator('#mediaFileInput').setInputFiles({ name: 'silent.wav', mimeType: 'audio/wav', buffer: Buffer.from('test') });
    await page.locator('#startRecordingBtn').click();
    await page.waitForFunction(() => document.getElementById('uploadProgressText').textContent.includes('no speech detected'));
    mode = 'success';
    await page.locator('#mediaFileInput').setInputFiles({name: 'stop.wav', mimeType: 'audio/wav', buffer: Buffer.from('test')});
    await page.locator('#startRecordingBtn').click();
    await page.waitForFunction(() => document.getElementById('uploadProgressText').textContent.includes('Preparing'));
    await page.locator('#stopRecordingBtn').click();
    await page.waitForFunction(() => document.getElementById('uploadProgressText').textContent.includes('Stopped'));
    assert.ok(stopped);
    assert.equal(await page.getByRole('button', {name: 'Discard these results'}).count(), 1);
    assert.equal(await page.locator('#recordingExportBtn').isEnabled(), true);
    await page.locator('#stopLiveBtn').click();
    assert.ok(actions.includes('/api/stop'));
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await page.screenshot({ path: 'tests/recording-mobile.png', fullPage: true });
    await page.locator('#recordingClearBtn').click();
    assert.equal(await page.locator('#recordingResults .recording-document').count(), 0);
    await page.locator('#liveTab').click();
    assert.equal(await page.locator('#historyList .history-item').count(), 1);
    await page.evaluate(() => window.testSocket.emit({type: 'live_status', stage: 'Transcribing', active: true}));
    assert.equal(await page.locator('#liveSpinner').isVisible(), true);
    await page.evaluate(() => window.testSocket.emit({type: 'live_status', stage: 'Transcribing', active: false}));
    assert.equal(await page.locator('#liveSpinner').isVisible(), false);
    await page.locator('#liveTab').press('ArrowRight');
    assert.equal(await page.locator('#recordingWorkspace').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: stale-cache upgrade, styled tabs/toggles, workspace isolation, streaming progress, timestamps/exports, retry, empty audio, persistent stop, mobile layout, keyboard navigation, safe output rendering.');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); server.close(); process.exitCode = 1; });

