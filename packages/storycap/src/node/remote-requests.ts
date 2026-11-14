import { promises as fs } from 'fs';
import path from 'path';
import type { CDPSession, HTTPRequest, Page, Protocol, Target } from 'puppeteer-core';
import { Logger } from './logger.js';

const contentTypes: Record<string, string> = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 *
 * Options for {@link RemoteRequestInterceptor}.
 *
 **/
export interface RemoteRequestOptions {
  /** Directory with local copies of remote resources, laid out as `<host><path>`. Empty to not serve fixtures. */
  remoteFixturesDir: string;
  /** Whether requests to other hosts without a fixture are aborted and reported, instead of passed through. */
  failOnRemoteRequest: boolean;
  /** Hosts that may still be requested from the network. */
  allowRemoteHosts: string[];
}

/**
 *
 * Returns whether the interceptor needs to be installed for the given options.
 *
 **/
export function shouldInterceptRemoteRequests(opt: RemoteRequestOptions) {
  return !!opt.remoteFixturesDir || opt.failOnRemoteRequest;
}

/**
 *
 * Returns the path of the fixture for a remote URL, `<fixturesDir>/<host><path>`, or null if the URL would escape the
 * fixtures directory. The query string is ignored, and `/` maps to `index`.
 *
 **/
export function fixturePathForUrl(fixturesDir: string, url: URL) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.endsWith('/')) pathname += 'index';

  const root = path.resolve(fixturesDir);
  const hostDir = path.resolve(root, url.hostname);
  const fixturePath = path.resolve(hostDir, '.' + pathname);
  if (!hostDir.startsWith(root + path.sep) || !fixturePath.startsWith(hostDir + path.sep)) return null;
  return fixturePath;
}

/**
 *
 * Returns the content type for a fixture file by its extension, or undefined to let the browser sniff it.
 *
 **/
export function contentTypeForFixture(fixturePath: string) {
  return contentTypes[path.extname(fixturePath).toLowerCase()];
}

async function isFile(filePath: string) {
  return fs.stat(filePath).then(
    stat => stat.isFile(),
    () => false,
  );
}

/**
 *
 * Finds the fixture file for a remote URL. A URL without an extension also matches a fixture with one added, e.g.
 * `fonts.googleapis.com/css2.css` for `https://fonts.googleapis.com/css2?family=...`, which sets its content type.
 *
 **/
export async function findFixture(fixturesDir: string, url: URL) {
  const fixturePath = fixturePathForUrl(fixturesDir, url);
  if (!fixturePath) return null;
  if (await isFile(fixturePath)) return fixturePath;
  if (path.extname(fixturePath)) return null;

  const dir = path.dirname(fixturePath);
  const base = path.basename(fixturePath);
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const match = entries.find(entry => path.parse(entry).name === base && contentTypeForFixture(entry));
  return match ? path.join(dir, match) : null;
}

/**
 *
 * What to do with a request, see {@link RemoteRequestInterceptor}.
 *
 **/
type RequestResolution = { action: 'continue' } | { action: 'respond'; fixturePath: string } | { action: 'block' };

/**
 *
 * Serves requests that leave the Storybook host from local fixtures, so captures never depend on remote hosts
 * (load timing, content they generate on the fly). Remote requests without a fixture are passed through, or aborted
 * and recorded with `failOnRemoteRequest`, so the run can fail on them.
 *
 * @remarks
 *
 * This covers the requests of the page and of the service workers in its browser. A service worker that answers the
 * page's requests itself, e.g. MSW's, fetches the ones it does not mock from the worker, where the page's interception
 * does not see them.
 *
 * Enabling request interception disables the page's cache, so local requests are repeated for every story.
 *
 **/
export class RemoteRequestInterceptor {
  private unmappedUrls = new Set<string>();
  private readonly warnedUrls = new Set<string>();
  private readonly localHost: string;

  constructor(
    private readonly page: Page,
    storybookUrl: string,
    private readonly opt: RemoteRequestOptions,
    private readonly logger: Logger,
  ) {
    this.localHost = new URL(storybookUrl).host;
  }

  /**
   *
   * Starts intercepting the requests of the page and of service workers started later. Call it before the page loads
   * anything, so no remote response is cached and no service worker runs yet.
   *
   **/
  async init() {
    this.page.browser().on('targetcreated', (target: Target) => {
      if (target.type() !== 'service_worker') return;
      this.interceptServiceWorker(target).catch(error =>
        this.logger.debug('Could not intercept the requests of service worker:', target.url(), error),
      );
    });
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      this.handlePageRequest(request).catch(error => {
        this.logger.debug('Could not handle request:', request.url(), error);
        if (!request.isInterceptResolutionHandled()) request.continue().catch(() => {});
      });
    });
    return this;
  }

  /**
   *
   * Returns the remote URLs requested without a fixture since the last call, and forgets them.
   *
   **/
  takeUnmappedUrls() {
    const urls = [...this.unmappedUrls];
    this.unmappedUrls = new Set();
    return urls;
  }

  private async handlePageRequest(request: HTTPRequest) {
    if (request.isInterceptResolutionHandled()) return;

    const resolution = await this.resolve(request.url(), request.method());
    if (resolution.action === 'respond') {
      await request.respond({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: contentTypeForFixture(resolution.fixturePath),
        body: await fs.readFile(resolution.fixturePath),
      });
    } else if (resolution.action === 'block') {
      await request.abort('blockedbyclient');
    } else {
      await request.continue();
    }
  }

  private async interceptServiceWorker(target: Target) {
    const session = await target.createCDPSession();
    session.on('Fetch.requestPaused', event => {
      this.handleServiceWorkerRequest(session, event).catch(error => {
        this.logger.debug('Could not handle service worker request:', event.request.url, error);
        session.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {});
      });
    });
    await session.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  }

  private async handleServiceWorkerRequest(session: CDPSession, event: Protocol.Fetch.RequestPausedEvent) {
    const { requestId } = event;
    const resolution = await this.resolve(event.request.url, event.request.method);
    if (resolution.action === 'respond') {
      const contentType = contentTypeForFixture(resolution.fixturePath);
      await session.send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Access-Control-Allow-Origin', value: '*' },
          ...(contentType ? [{ name: 'Content-Type', value: contentType }] : []),
        ],
        body: (await fs.readFile(resolution.fixturePath)).toString('base64'),
      });
    } else if (resolution.action === 'block') {
      await session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } else {
      await session.send('Fetch.continueRequest', { requestId });
    }
  }

  /**
   *
   * Decides how to answer a request, and records or warns about remote requests without a fixture.
   *
   **/
  private async resolve(requestUrl: string, method: string): Promise<RequestResolution> {
    const url = new URL(requestUrl);
    const isRemote = (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== this.localHost;
    if (!isRemote || this.opt.allowRemoteHosts.includes(url.hostname)) return { action: 'continue' };

    const fixturePath =
      this.opt.remoteFixturesDir && method === 'GET' ? await findFixture(this.opt.remoteFixturesDir, url) : null;
    if (fixturePath) return { action: 'respond', fixturePath };

    const urlWithoutQuery = `${url.origin}${url.pathname}`;
    if (this.opt.failOnRemoteRequest) {
      this.unmappedUrls.add(urlWithoutQuery);
      return { action: 'block' };
    }
    if (!this.warnedUrls.has(urlWithoutQuery)) {
      this.warnedUrls.add(urlWithoutQuery);
      this.logger.warn(`Remote request without fixture: ${this.logger.color.yellow(urlWithoutQuery)}`);
    }
    return { action: 'continue' };
  }
}
