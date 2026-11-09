import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { contentTypeForFixture, findFixture, fixturePathForUrl } from './remote-requests';

describe(fixturePathForUrl, () => {
  const root = path.resolve('fixtures');

  it('maps the host and path and ignores the query', () => {
    expect(fixturePathForUrl(root, new URL('https://images.example.com/flags/de.svg?v=1'))).toBe(
      path.join(root, 'images.example.com', 'flags', 'de.svg'),
    );
  });

  it('maps a path ending with a slash to index', () => {
    expect(fixturePathForUrl(root, new URL('https://example.com/'))).toBe(path.join(root, 'example.com', 'index'));
  });

  it('decodes the path', () => {
    expect(fixturePathForUrl(root, new URL('https://example.com/a%20b.png'))).toBe(
      path.join(root, 'example.com', 'a b.png'),
    );
  });

  it('never leaves the host directory', () => {
    expect(fixturePathForUrl(root, new URL('https://example.com/%2e%2e/other.com/a.png'))).toBe(
      path.join(root, 'example.com', 'other.com', 'a.png'),
    );
    expect(fixturePathForUrl(root, new URL('https://example.com/a%2f..%2f..%2fb.png'))).toBeNull();
  });
});

describe(contentTypeForFixture, () => {
  it('uses the extension', () => {
    expect(contentTypeForFixture('a/b.WOFF2')).toBe('font/woff2');
    expect(contentTypeForFixture('a/css2.css')).toBe('text/css');
  });

  it('leaves unknown types to the browser', () => {
    expect(contentTypeForFixture('a/favicon/www.example.com')).toBeUndefined();
  });
});

describe(findFixture, () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'storycap-fixtures-'));
    await fs.mkdir(path.join(root, 'avatar.example.com', 'favicon'), { recursive: true });
    await fs.writeFile(path.join(root, 'avatar.example.com', 'favicon', 'www.example.com'), 'icon');
    await fs.mkdir(path.join(root, 'fonts.example.com'), { recursive: true });
    await fs.writeFile(path.join(root, 'fonts.example.com', 'css2.css'), 'css');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds the exact path', async () => {
    expect(await findFixture(root, new URL('https://avatar.example.com/favicon/www.example.com'))).toBe(
      path.join(root, 'avatar.example.com', 'favicon', 'www.example.com'),
    );
  });

  it('finds a fixture with an extension added for a path without one', async () => {
    expect(await findFixture(root, new URL('https://fonts.example.com/css2?family=Material+Symbols'))).toBe(
      path.join(root, 'fonts.example.com', 'css2.css'),
    );
  });

  it('returns null without a fixture', async () => {
    expect(await findFixture(root, new URL('https://fonts.example.com/missing.woff2'))).toBeNull();
    expect(await findFixture(root, new URL('https://unknown.example.com/a'))).toBeNull();
  });
});
