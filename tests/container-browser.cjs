// End-to-end test against a RUNNING container; uses a speech file, not the user's microphone.
// Set TEST_AUDIO_FILE to a WAV file and optionally APP_URL (default localhost:8000).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const audio = path.resolve(process.env.TEST_AUDIO_FILE || 'tmp/container-test.wav');
  const base = process.env.APP_URL || 'http://localhost:8000';
  assert.ok(fs.existsSync(audio), 'Provide a WAV file through TEST_AUDIO_FILE');
  const browser = await chromium.launch({ headless: true, channel: 'msedge', args: [
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    `--use-file-for-fake-audio-capture=${audio}`,
  ] });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => !document.getElementById('toggleRecordBtn').disabled, null, { timeout: 180000 });
    await page.locator('#toggleRecordBtn').click();
    await page.waitForFunction(() => document.querySelectorAll('#historyList .history-item').length > 0, null, { timeout: 90000 });
    await page.locator('#toggleRecordBtn').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#historyList .hist-trans')].some(el =>
      /[\u3400-\u9fff]/.test(el.textContent)), null, { timeout: 120000 });
    const original = await page.locator('#historyList .hist-en').allTextContents();
    console.log('Browser microphone transcription:', original.join(' '));
    assert.ok(original.join(' ').length > 10);
    assert.equal(await page.evaluate(() => microphone.stream), null, 'Microphone tracks released after stop');
    assert.deepEqual(errors, []);
    fs.mkdirSync('tmp', { recursive: true });
    await page.screenshot({ path: 'tmp/container-browser.png', fullPage: true });

    // Recording upload uses the same real engines but stays independent of the live session.
    const job = await (await page.request.post(`${base}/api/recording_jobs`)).json();
    const upload = await page.request.post(`${base}/api/upload_media`, { timeout: 180000, multipart: {
      job_id: job.job_id, language: 'Vietnamese', mode: 'translate', segment_seconds: '30',
      file: { name: 'speech.wav', mimeType: 'audio/wav', buffer: fs.readFileSync(audio) },
    } });
    assert.equal(upload.status(), 200);
    const events = (await upload.text()).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events.at(-1).type, 'complete');
    const translated = events.find(event => event.type === 'segment');
    assert.ok(translated?.translated && translated.translationState !== 'failed', JSON.stringify(events));
    console.log('Vietnamese recording translation:', translated.translated);
    console.log('Container browser and recording checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
