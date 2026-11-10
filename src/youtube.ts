import type { VideoJob } from './types';

export interface YouTubeChannel {
  id: string;
  title: string;
  customUrl?: string;
  thumbnail?: string;
}
export interface GoogleProfile { email: string; id: string; }

const API = 'https://www.googleapis.com/upload/youtube/v3/videos';

export async function getChromeProfile(): Promise<GoogleProfile> {
  // Keep this cast local: @types/chrome versions differ on the Promise overload.
  const getProfileUserInfo = chrome.identity.getProfileUserInfo as unknown as (
    details: { accountStatus: 'ANY' }
  ) => Promise<{ email: string; id: string }>;
  const profile = await getProfileUserInfo({ accountStatus: 'ANY' });
  if (!profile.email) {
    throw new Error('Chrome itself is not signed in. Sign in to the Chrome browser profile with the same personal Gmail account that owns your YouTube channel. Being signed in only on youtube.com is not enough for this extension authentication method. Then reload the extension and try again.');
  }
  return { email: profile.email, id: profile.id };
}

export async function getToken(interactive = true): Promise<string> {
  try {
    const result = await chrome.identity.getAuthToken({ interactive });
    if (!result.token) throw new Error('Google did not return an access token.');
    return result.token;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not signed in|not logged in/i.test(message)) {
      throw new Error('Chrome says the user is not signed in. Sign in to the Chrome browser profile itself with the same Gmail account as your YouTube channel (Chrome profile icon → Sign in), then reload this extension. A YouTube website session alone does not sign Chrome in.');
    }
    if (/bad client id|invalid_client/i.test(message)) {
      throw new Error('Google rejected the OAuth Client ID. Confirm the OAuth client type is Chrome Extension and its Item ID exactly matches the ID shown at chrome://extensions.');
    }
    if (/access_denied|not granted|denied/i.test(message)) {
      throw new Error('You did not grant the YouTube permissions. Check that this Gmail is listed under Google Auth Platform → Audience → Test users, then connect again.');
    }
    throw new Error(message);
  }
}

export async function disconnectGoogle(): Promise<void> {
  await chrome.identity.clearAllCachedAuthTokens();
}

function xhrPut(
  url: string,
  blob: Blob,
  start: number,
  end: number,
  total: number,
  token: string
): Promise<{ status: number; body: string; range: string | null }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Content-Range', `bytes ${start}-${end - 1}/${total}`);
    xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, range: xhr.getResponseHeader('Range') });
    xhr.onerror = () => reject(new Error('Network error during upload chunk.'));
    xhr.ontimeout = () => reject(new Error('Upload chunk timed out.'));
    xhr.timeout = 120000;
    xhr.send(blob);
  });
}

export async function uploadVideo(
  job: VideoJob,
  file: File,
  token: string,
  onProgress: (progress: number, patch: Partial<VideoJob>) => void
): Promise<{ id: string; channelId: string }> {
  let session = job.resumableUrl;
  let sent = job.bytesSent || 0;

  if (!session) {
    const body = {
      snippet: { title: job.title, description: job.description, tags: job.tags, categoryId: '22' },
      status: { privacyStatus: 'private', publishAt: job.publishAt, selfDeclaredMadeForKids: false }
    };
    const response = await fetch(`${API}?uploadType=resumable&part=snippet,status&notifySubscribers=false`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(file.size),
        'X-Upload-Content-Type': file.type || 'application/octet-stream'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`YouTube could not start upload (${response.status}): ${await response.text()}`);
    session = response.headers.get('Location') || undefined;
    if (!session) throw new Error('YouTube did not return a resumable upload URL.');
    sent = 0;
    onProgress(0, { resumableUrl: session, bytesSent: 0 });
  }

  const chunkSize = 8 * 1024 * 1024;
  while (sent < file.size) {
    const end = Math.min(sent + chunkSize, file.size);
    let attempt = 0;
    let result: { status: number; body: string; range: string | null } | undefined;
    while (attempt < 5) {
      try {
        result = await xhrPut(session, file.slice(sent, end), sent, end, file.size, token);
        if (result.status === 308 || result.status === 200 || result.status === 201) break;
        if (result.status >= 500 || result.status === 429) {
          attempt++;
          await new Promise(resolve => setTimeout(resolve, Math.min(15000, 1000 * 2 ** attempt)));
          continue;
        }
        throw new Error(`YouTube upload failed (${result.status}): ${result.body}`);
      } catch (error) {
        attempt++;
        if (attempt >= 5) throw error;
        await new Promise(resolve => setTimeout(resolve, Math.min(15000, 1000 * 2 ** attempt)));
      }
    }
    if (!result) throw new Error('Upload did not return a response.');
    if (result.status === 200 || result.status === 201) {
      const data = JSON.parse(result.body);
      if (!data.id) throw new Error('YouTube upload completed but returned no video ID.');
      onProgress(100, { bytesSent: file.size, resumableUrl: session });
      return { id: data.id, channelId: data.snippet?.channelId || '' };
    }
    const match = result.range?.match(/bytes=0-(\d+)/);
    sent = match ? Number(match[1]) + 1 : end;
    onProgress(Math.min(99, Math.round(sent / file.size * 100)), { bytesSent: sent, resumableUrl: session });
  }
  throw new Error('Upload ended without a completed video response.');
}

export async function getChannels(token: string): Promise<YouTubeChannel[]> {
  const response = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50', {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401 && /youtubeSignupRequired/i.test(body)) {
      throw new Error('Google authenticated your personal Gmail, but YouTube did not associate this OAuth token with a channel. Reconnect and choose the intended channel/Brand Account if Google offers a channel chooser. If the channel uses the newer YouTube Studio → Settings → Permissions role system, the YouTube Data API may not support delegated access for that channel.');
    }
    throw new Error(`Could not read YouTube channel (${response.status}): ${body}`);
  }
  const data = await response.json();
  const channels: YouTubeChannel[] = (data.items || []).map((item: any) => ({
    id: item.id,
    title: item.snippet?.title || 'Untitled channel',
    customUrl: item.snippet?.customUrl,
    thumbnail: item.snippet?.thumbnails?.default?.url
  }));
  if (!channels.length) {
    throw new Error('Google sign-in succeeded, but YouTube returned no channel for this OAuth identity. Your second channel may be a Brand Account. Reconnect and select the intended channel identity if Google offers a chooser. Do not start uploads until the expected channel appears here.');
  }
  if (channels.length > 1) {
    const names = channels.map(channel => `${channel.title} (${channel.id})`).join('; ');
    throw new Error(`This OAuth identity returned multiple channels: ${names}. The YouTube upload API does not accept a channel ID to override the authenticated channel. To prevent uploads going to the wrong channel, this extension requires OAuth to resolve to exactly one intended channel.`);
  }
  return channels;
}

export async function getChannel(token: string): Promise<YouTubeChannel> {
  const channels = await getChannels(token);
  return channels[0];
}