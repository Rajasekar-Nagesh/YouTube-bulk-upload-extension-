import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { VideoJob } from './types';
import { buildJobs, parseMetadata, parseSchedule } from './parsers';
import { loadDirectory, loadJobs, saveDirectory, saveJobs } from './storage';
import { disconnectGoogle, getChannel, getChromeProfile, getToken, uploadVideo } from './youtube';
import './style.css';

function App() {
  const [jobs, setJobs] = useState<VideoJob[]>([]);
  const [excel, setExcel] = useState<File | null>(null);
  const [word, setWord] = useState<File | null>(null);
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [channel, setChannel] = useState('Not connected');
  const [channelId, setChannelId] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Select your Downloads folder and import your schedule files.');
  const [error, setError] = useState('');
  const [autoStarted, setAutoStarted] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    loadJobs().then(setJobs);
    loadDirectory().then(async handle => {
      if (handle) {
        const permission = await handle.queryPermission({ mode: 'read' });
        if (permission === 'granted') setDir(handle);
      }
    });
  }, []);

  useEffect(() => { saveJobs(jobs).catch(() => {}); }, [jobs]);

  const stats = useMemo(() => ({
    total: jobs.length,
    uploaded: jobs.filter(job => job.status === 'uploaded').length,
    failed: jobs.filter(job => job.status === 'failed').length,
    pending: jobs.filter(job => job.status === 'queued' || job.status === 'uploading').length
  }), [jobs]);

  async function connect() {
    try {
      setError('');
      setMessage('Checking Chrome sign-in and connecting to YouTube…');
      const profile = await getChromeProfile();
      const token = await getToken(true);
      const target = await getChannel(token);
      setChannel(target.title);
      setChannelId(target.id);
      setGoogleEmail(profile.email);
      setConnected(true);
      setMessage(`Verified destination: ${target.title} (${target.id}) via ${profile.email}. Automatic uploads can now start.`);
    } catch (e) {
      setConnected(false);
      setChannel('Not connected');
      setChannelId('');
      setGoogleEmail('');
      setError((e as Error).message);
    }
  }

  async function switchGoogleChannel() {
    try {
      setError('');
      setConnected(false);
      setChannel('Not connected');
      setChannelId('');
      setGoogleEmail('');
      setAutoStarted(false);
      await disconnectGoogle();
      setMessage('Google authorization cache cleared. Click Connect YouTube and sign in again, selecting the intended channel identity if Google presents a channel chooser.');
    } catch (e) {
      setError(`Could not clear Google sign-in: ${(e as Error).message}`);
    }
  }

  async function chooseFolder() {
    try {
      setError('');
      const handle = await window.showDirectoryPicker({ id: 'youtube-downloads', startIn: 'downloads', mode: 'read' });
      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') throw new Error('Read access to the selected folder was not granted. Please select the folder again and allow access.');
      await saveDirectory(handle);
      setDir(handle);
      setMessage(`Folder selected: ${handle.name}`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    }
  }

  async function prepare() {
    if (!excel || !word || !dir) return;
    try {
      setBusy(true);
      setError('');
      setMessage('Reading Excel, Word and matching local video files…');
      const schedule = await parseSchedule(excel);
      const metadata = await parseMetadata(word);
      const next = await buildJobs(schedule, metadata, dir);
      setJobs(next);
      setAutoStarted(false);
      setMessage(`${next.length} videos matched successfully. ${connected ? 'Starting uploads automatically…' : 'Connect your YouTube channel to start automatic uploads.'}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (excel && word && dir) prepare();
  }, [excel, word, dir]);

  async function runQueue() {
    if (running.current || !jobs.length) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      const token = await getToken(false);
      const verified = await getChannel(token);
      if (!channelId || verified.id !== channelId) {
        throw new Error(`The authenticated YouTube destination changed. Expected ${channel} (${channelId}), but Google returned ${verified.title} (${verified.id}). Queue stopped to protect your channel.`);
      }
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.status === 'uploaded' || job.status === 'skipped') continue;
        setJobs(previous => previous.map(item => item.key === job.key ? { ...item, status: 'uploading', error: undefined } : item));
        try {
          const handle = await dir!.getFileHandle(job.filename);
          const file = await handle.getFile();
          const result = await uploadVideo(job, file, token, (progress, patch) =>
            setJobs(previous => previous.map(item => item.key === job.key ? { ...item, ...patch, progress } : item))
          );
          if (result.channelId !== channelId) {
            throw new Error(`YouTube did not confirm the expected destination. Returned channel ID: ${result.channelId || 'missing'}; expected: ${channelId}. Stop the batch and verify Google channel authorization before retrying.`);
          }
          setJobs(previous => previous.map(item => item.key === job.key ? { ...item, status: 'uploaded', progress: 100, videoId: result.id } : item));
        } catch (e) {
          const msg = (e as Error).message;
          setJobs(previous => previous.map(item => item.key === job.key ? { ...item, status: 'failed', error: msg } : item));
          setMessage(`Stopped at ${job.filename}. Fix the issue and retry failed uploads.`);
          break;
        }
      }
      setMessage('Upload queue finished. Check each video status below.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (connected && dir && jobs.length && !autoStarted) {
      setAutoStarted(true);
      runQueue();
    }
  }, [connected, dir, jobs.length, autoStarted]);

  async function connectAndStart() { await connect(); }

  async function retry() {
    setJobs(previous => previous.map(job => job.status === 'failed' ? { ...job, status: 'queued', error: undefined } : job));
    setAutoStarted(true);
    window.setTimeout(() => runQueue(), 0);
  }

  function reset() {
    if (busy) return;
    setJobs([]);
    setExcel(null);
    setWord(null);
    setAutoStarted(false);
    setMessage('Queue cleared. Import a new schedule.');
  }

  return (
    <main className="shell">
      <header>
        <div className="brand">
          <div className="logo">▶</div>
          <div><h1>YouTube Bulk Uploader</h1><p>Bulk publishing workspace</p></div>
        </div>
        <div className="connected">
          <span className={connected ? 'dot green' : 'dot'} />
          {connected ? <span>{channel}<small style={{ display: 'block', fontSize: 10, opacity: .7 }}>{googleEmail} · {channelId}</small></span> : 'Not connected'}
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">AUTOMATED PUBLISHING</span>
          <h2>Publish more.<br /><em>Upload less.</em></h2>
          <p>Match your video files with an Excel schedule and Word metadata. We upload privately and let YouTube publish at the scheduled time.</p>
        </div>
        <div className="hero-icon">▣<small>YOUTUBE<br />SCHEDULER</small></div>
      </section>

      <section className="stats">
        <div><b>{stats.total}</b><span>Total videos</span></div>
        <div><b>{stats.uploaded}</b><span>Uploaded</span></div>
        <div><b>{stats.pending}</b><span>Pending</span></div>
        <div><b>{stats.failed}</b><span>Failed</span></div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div><span className="eyebrow">01 / SETUP</span><h3>Prepare your upload batch</h3></div>
          <span className="pill">Automatic mode</span>
        </div>
        <div className="steps">
          <div className="step">
            <div className="step-title"><span className="number">1</span><div><b>Video folder</b><small>{dir ? `Selected: ${dir.name}` : 'Choose your Downloads folder'}</small></div></div>
            <button className="secondary" onClick={chooseFolder}>{dir ? 'Change folder' : 'Choose folder'}</button>
          </div>
          <div className="step">
            <div className="step-title"><span className="number">2</span><div><b>Excel schedule</b><small>{excel ? excel.name : 'Filename, upload date and upload time'}</small></div></div>
            <label className="file-btn">{excel ? 'Change Excel' : 'Choose Excel'}<input type="file" accept=".xlsx,.xls,.csv" onChange={e => setExcel(e.target.files?.[0] || null)} /></label>
          </div>
          <div className="step">
            <div className="step-title"><span className="number">3</span><div><b>Word metadata</b><small>{word ? word.name : 'Titles, descriptions and tags'}</small></div></div>
            <label className="file-btn">{word ? 'Change Word' : 'Choose Word'}<input type="file" accept=".docx" onChange={e => setWord(e.target.files?.[0] || null)} /></label>
          </div>
        </div>

        <div className="connect-row">
          <div><b>04 / YouTube account</b><small>{connected ? `Verified destination: ${channel} · ${channelId}` : 'Connect the exact channel that should receive uploads'}</small></div>
          <div className="actions">
            <button className="secondary" onClick={switchGoogleChannel} disabled={busy}>{connected ? 'Switch account / channel' : 'Reset Google sign-in'}</button>
            <button className={connected ? 'secondary' : 'primary'} onClick={connectAndStart} disabled={busy}>{connected ? 'Reconnect' : 'Connect YouTube'}</button>
          </div>
        </div>
        <p className="notice">Once the folder, Excel, Word and a verified single YouTube destination are ready, matching and uploads start automatically. The extension checks the authenticated channel ID before starting to prevent publishing to the wrong channel.</p>
        {message && <div className="message">{message}</div>}
        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <div className="section-head">
          <div><span className="eyebrow">02 / QUEUE</span><h3>Upload queue</h3></div>
          <div className="actions">
            <button className="secondary small" onClick={reset} disabled={busy || !jobs.length}>Clear</button>
            {stats.failed > 0 && <button className="primary small" onClick={retry} disabled={busy}>Retry failed</button>}
          </div>
        </div>
        {!jobs.length ? <div className="empty"><div>▤</div><b>Your queue is empty</b><span>Choose your folder, Excel schedule and Word metadata to begin.</span></div> :
          <div className="table-wrap">
            <table>
              <thead><tr><th>VIDEO / TITLE</th><th>SCHEDULE (IST)</th><th>STATUS</th></tr></thead>
              <tbody>{jobs.map(job => <tr key={job.key}>
                <td>
                  <b>{job.filename}</b><small>{job.title}</small>
                  {job.error && <small className="error-text">{job.error}</small>}
                  {job.videoId && <a href={`https://youtu.be/${job.videoId}`} target="_blank" rel="noreferrer">Open on YouTube ↗</a>}
                </td>
                <td>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(job.publishAt))}</td>
                <td><span className={`status ${job.status}`}>{job.status}</span>{job.status === 'uploading' && <div className="progress"><i style={{ width: `${job.progress}%` }} /></div>}</td>
              </tr>)}</tbody>
            </table>
          </div>
        }
      </section>
      <footer>Files are processed locally. Chrome manages OAuth tokens. Keep this dashboard tab open during uploads. The API must resolve to the intended channel before the queue starts.</footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
