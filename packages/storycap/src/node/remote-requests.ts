import { promises as fs } from 'fs';
import path from 'path';
import type { HTTPRequest, Page } from 'puppeteer-core';
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
 * Serves requests that leave the Storybook host from local fixtures, so captures never depend on remote hosts
 * (load timing, content they generate on the fly). Remote requests without a fixture are passed through, or aborted
 * and recorded with `failOnRemoteRequest`, so the run can fail on them.
 *
 * @remarks
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

  async init() {
    // Responses loaded before the interception, e.g. a remote stylesheet in the preview head, would otherwise still be
    // served from the memory cache when the page is loaded again, bypassing the fixtures.
    const session = await this.page.createCDPSession();
    await session.send('Network.clearBrowserCache');
    await session.detach();
    await this.page.setRequestInterception(true);
    this.page.on('request', request => {
      this.handle(request).catch(error => {
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

  private async handle(request: HTTPRequest) {
    if (request.isInterceptResolutionHandled()) return;

    const url = new URL(request.url());
    const isRemote = (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== this.localHost;
    if (!isRemote || this.opt.allowRemoteHosts.includes(url.hostname)) {
      await request.continue();
      return;
    }

    const fixturePath =
      this.opt.remoteFixturesDir && request.method() === 'GET'
        ? await findFixture(this.opt.remoteFixturesDir, url)
        : null;
    if (fixturePath) {
      await request.respond({
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: contentTypeForFixture(fixturePath),
        body: await fs.readFile(fixturePath),
      });
      return;
    }

    const urlWithoutQuery = `${url.origin}${url.pathname}`;
    if (this.opt.failOnRemoteRequest) {
      this.unmappedUrls.add(urlWithoutQuery);
      await request.abort('blockedbyclient');
      return;
    }
    if (!this.warnedUrls.has(urlWithoutQuery)) {
      this.warnedUrls.add(urlWithoutQuery);
      this.logger.warn(`Remote request without fixture: ${this.logger.color.yellow(urlWithoutQuery)}`);
    }
    await request.continue();
  }
}
